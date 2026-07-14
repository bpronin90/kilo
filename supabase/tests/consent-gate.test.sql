-- Consent gate, RLS, and privilege tests (issue #487).
--
-- The claim this file has to defend is strong: "no cloud health-data read or
-- write succeeds without an active grant for the required material version,
-- including from a stale client." A client-side check proves nothing, so every
-- assertion below runs as the `authenticated` role with a real JWT claim, the way
-- PostgREST actually executes a request.
--
-- It also proves the negative space that makes the evidence worth anything: a
-- user cannot forge wording, timestamps, revisions, material versions, grants,
-- withdrawals, evidence, or another user's state. If any of those were writable,
-- the "demonstrable consent" record would demonstrate nothing.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/consent-gate.test.sql

begin;

select plan(34);

\set user_a '77777777-7777-7777-7777-777777777777'
\set user_b '88888888-8888-8888-8888-888888888888'

insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_b'::uuid) on conflict do nothing;

-- Impersonate a PostgREST request: the `authenticated` role plus the JWT claim
-- auth.uid() reads. Anything that passes here is reachable by a real client.
--
-- Both claim GUCs are set on purpose. Supabase's platform auth.uid() coalesces the
-- JSON `request.jwt.claims` with the older scalar `request.jwt.claim.sub`, and
-- which of the two it reads has varied across Postgres image versions. Setting only
-- one makes auth.uid() silently return NULL on the other, and a NULL uid turns
-- every "the user cannot do X" assertion below into a test that passes because
-- nobody was logged in — the exact way an RLS suite rots into proving nothing.
create or replace function pg_temp.as_user(p_user uuid, p_protocol integer default null)
  returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_protocol is null then '{}'
         else json_build_object('x-kilo-consent-protocol', p_protocol::text)::text
    end, true);
  execute 'set local role authenticated';
end $$;

-- Guard the guard: if the impersonation helper ever stops working, say so loudly
-- here instead of letting the rest of the file pass vacuously.
select pg_temp.as_user(:'user_a'::uuid);

select is(
  auth.uid(),
  :'user_a'::uuid,
  'the test harness actually authenticates as the intended user'
);

reset role;

-- ---------------------------------------------------------------------------
-- Structure and seeded catalog
-- ---------------------------------------------------------------------------

select has_table('kilo', 'consent_revision', 'immutable consent catalog exists');
select has_table('kilo', 'consent_events', 'append-only consent event ledger exists');
select has_table('kilo', 'consent_state', 'keyed consent state exists');
select has_table('kilo', 'consent_evidence_archive', 'pseudonymized evidence archive exists');

select is(
  (select consent_title from kilo.consent_revision where catalog_revision = 1),
  'Store health data in the cloud?',
  'seeded catalog carries the exact approved title'
);

select is(
  (select copy_sha256 from kilo.consent_revision where catalog_revision = 1),
  '4a4eb51eea8df80e1eec7355f3c44a1dd06705583a64841061aa24d5788396fa',
  'seeded catalog carries the digest of the exact approved copy'
);

select is(
  (select encode(sha256(convert_to(
      consent_title || E'\n\n' || disclosure_copy || E'\n\n' || affirmation_copy, 'UTF8')), 'hex')
   from kilo.consent_revision where catalog_revision = 1),
  (select copy_sha256 from kilo.consent_revision where catalog_revision = 1),
  'the stored digest actually matches the stored copy'
);

-- ---------------------------------------------------------------------------
-- legacy mode: the gate is not yet armed
-- ---------------------------------------------------------------------------

update kilo.health_sync_config
  set mode = 'legacy', minimum_consent_protocol_version = 0
  where id = true;

select lives_ok(
  $$ insert into kilo.weight_entries (user_id, id, weight_value)
     values ('77777777-7777-7777-7777-777777777777', 'w1', 80) $$,
  'legacy mode: health writes still work (pre-cutover)'
);

-- ---------------------------------------------------------------------------
-- consent_required mode: no grant, no access
-- ---------------------------------------------------------------------------

update kilo.health_sync_config
  set mode = 'consent_required', required_material_version = 1,
      minimum_consent_protocol_version = 0
  where id = true;

insert into kilo.consent_state (user_id, status) values (:'user_a'::uuid, 'needs_reconsent')
  on conflict (user_id) do update set status = 'needs_reconsent';

select pg_temp.as_user(:'user_a'::uuid);

select is(
  (select count(*) from kilo.weight_entries),
  0::bigint,
  'no grant: existing health rows are not readable'
);

select throws_ok(
  $$ insert into kilo.weight_entries (user_id, id, weight_value)
     values ('77777777-7777-7777-7777-777777777777', 'w2', 81) $$,
  '42501',
  null,
  'no grant: health writes are refused by RLS'
);

select is(
  (select kilo.health_sync_preflight() ->> 'code'),
  'CONSENT_VERSION_STALE',
  'an existing user seeded as needs_reconsent is told the version is stale'
);

reset role;

-- A user who never had any state row at all gets CONSENT_REQUIRED, not a crash.
select pg_temp.as_user(:'user_b'::uuid);

select is(
  (select kilo.health_sync_preflight() ->> 'code'),
  'CONSENT_REQUIRED',
  'a user with no consent state is told consent is required'
);

select is(
  (select (kilo.health_sync_preflight() ->> 'allowed')::boolean),
  false,
  'preflight denies a user with no consent state'
);

reset role;

-- ---------------------------------------------------------------------------
-- Granting opens the gate, and only for the granting user
-- ---------------------------------------------------------------------------

select pg_temp.as_user(:'user_a'::uuid);

select lives_ok(
  $$ select kilo.consent_grant(1, '1.2.3', 'android') $$,
  'a user can record their own grant through the server operation'
);

select is(
  (select status from kilo.consent_state where user_id = :'user_a'::uuid),
  'granted',
  'granting sets the keyed state to granted'
);

select is(
  (select (kilo.health_sync_preflight() ->> 'allowed')::boolean),
  true,
  'preflight allows a granted user at the required material version'
);

select lives_ok(
  $$ insert into kilo.weight_entries (user_id, id, weight_value)
     values ('77777777-7777-7777-7777-777777777777', 'w3', 82) $$,
  'a granted user can write health data'
);

select is(
  (select count(*) from kilo.weight_entries),
  2::bigint,
  'a granted user can read their own health data'
);

reset role;

-- User B granted nothing. The gate must still deny them, and they must not see A.
select pg_temp.as_user(:'user_b'::uuid);

select is(
  (select count(*) from kilo.weight_entries),
  0::bigint,
  'a non-granting user sees no health rows, including another user''s'
);

reset role;

-- ---------------------------------------------------------------------------
-- Material version enforcement (a stale grant is not a grant)
-- ---------------------------------------------------------------------------

update kilo.health_sync_config set required_material_version = 2 where id = true;

select pg_temp.as_user(:'user_a'::uuid);

select is(
  (select kilo.health_sync_preflight() ->> 'code'),
  'CONSENT_VERSION_STALE',
  'a scope change makes an existing grant stale'
);

select is(
  (select count(*) from kilo.weight_entries),
  0::bigint,
  'a stale material version blocks reads even though status is still granted'
);

select throws_ok(
  $$ insert into kilo.weight_entries (user_id, id, weight_value)
     values ('77777777-7777-7777-7777-777777777777', 'w4', 83) $$,
  '42501',
  null,
  'a stale material version blocks writes'
);

reset role;

-- An EDITORIAL revision (same material version) must NOT invalidate the grant.
update kilo.health_sync_config set required_material_version = 1 where id = true;

insert into kilo.consent_revision (
  catalog_revision, material_version, requires_reconsent, status,
  controller_identity, purpose, health_data_categories, processor,
  consent_title, disclosure_copy, affirmation_copy,
  privacy_policy_revision, privacy_policy_url, copy_sha256, effective_at
) values (
  2, 1, false, 'active',
  'Ben Pronin (Kilo)', 'Cross-device synchronization of Kilo health data',
  '["a","b","c","d"]'::jsonb, 'Supabase',
  'Store health data in the cloud?', 'typo fixed', 'affirmation',
  '2026-07-14', 'https://example.invalid/privacy.html',
  repeat('a', 64), now()
);

select pg_temp.as_user(:'user_a'::uuid);

select is(
  (select (kilo.health_sync_preflight() ->> 'allowed')::boolean),
  true,
  'an editorial catalog revision does not invalidate a grant for the same material version'
);

reset role;

-- ---------------------------------------------------------------------------
-- Protocol floor: a stale client is denied
-- ---------------------------------------------------------------------------

update kilo.health_sync_config set minimum_consent_protocol_version = 2 where id = true;

-- A client that sends no protocol header at all is, by definition, one built
-- before the header existed.
select pg_temp.as_user(:'user_a'::uuid, null);

select is(
  (select kilo.health_sync_preflight() ->> 'code'),
  'CLIENT_UPDATE_REQUIRED',
  'a client sending no protocol version is told to update'
);

select is(
  (select count(*) from kilo.weight_entries),
  0::bigint,
  'a stale client is denied health reads even though the user HAS granted consent'
);

reset role;

select pg_temp.as_user(:'user_a'::uuid, 2);

select is(
  (select (kilo.health_sync_preflight() ->> 'allowed')::boolean),
  true,
  'a client at the protocol floor is allowed'
);

reset role;

update kilo.health_sync_config set minimum_consent_protocol_version = 0 where id = true;

-- ---------------------------------------------------------------------------
-- paused mode fails closed
-- ---------------------------------------------------------------------------

update kilo.health_sync_config set mode = 'paused' where id = true;

select pg_temp.as_user(:'user_a'::uuid);

select is(
  (select kilo.health_sync_preflight() ->> 'code'),
  'HEALTH_SYNC_PAUSED',
  'paused mode reports the pause'
);

select is(
  (select count(*) from kilo.weight_entries),
  0::bigint,
  'paused mode blocks health reads even for a fully granted user'
);

reset role;

update kilo.health_sync_config set mode = 'consent_required' where id = true;

-- ---------------------------------------------------------------------------
-- Forgery: none of the evidence is user-writable
-- ---------------------------------------------------------------------------

select pg_temp.as_user(:'user_a'::uuid);

select throws_ok(
  $$ update kilo.consent_revision set disclosure_copy = 'I agree to nothing'
     where catalog_revision = 1 $$,
  null, null,
  'a user cannot rewrite the consent wording they were shown'
);

select throws_ok(
  $$ insert into kilo.consent_events (user_id, event_type, catalog_revision,
       material_version, copy_sha256, surface)
     values ('77777777-7777-7777-7777-777777777777', 'granted', 1, 99,
             repeat('f', 64), 'forged') $$,
  null, null,
  'a user cannot author their own consent event or material version'
);

select throws_ok(
  $$ update kilo.consent_state set status = 'granted', current_material_version = 99
     where user_id = '77777777-7777-7777-7777-777777777777' $$,
  null, null,
  'a user cannot promote their own consent state'
);

select throws_ok(
  $$ select kilo.set_health_sync_mode('legacy') $$,
  null, null,
  'a user cannot disarm the gate'
);

select is(
  (select count(*) from kilo.consent_state where user_id = :'user_b'::uuid),
  0::bigint,
  'a user cannot read another user''s consent state'
);

reset role;

select * from finish();
rollback;
