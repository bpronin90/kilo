-- Bounds and throttle on client metadata accepted by consent_grant (issue #597).
--
-- Defends #572 claim 13: before this work kilo.consent_grant wrote caller-
-- supplied app_version / platform / surface verbatim into the append-only
-- kilo.consent_events ledger with no size, character, or enum limit, and a
-- granted caller could re-affirm the same active revision in a loop, appending
-- unbounded rows. This suite proves the four things the fix must guarantee:
--
--   1. maximum valid metadata is accepted (no false rejection of real clients);
--   2. oversize / out-of-charset / non-enum metadata is rejected;
--   3. redundant re-affirmations are throttled (the ledger is bounded);
--   4. a legitimate re-consent transition still succeeds even when the throttle
--      bucket for that user is already exhausted.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/consent-grant-metadata-bounds.test.sql

begin;

select plan(18);

\set user_c '99999999-9999-9999-9999-999999999999'
\set user_t 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

insert into auth.users (id) values (:'user_c'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_t'::uuid) on conflict do nothing;

-- Impersonate a PostgREST request exactly as the consent-gate suite does: the
-- `authenticated` role plus both JWT claim GUCs, so auth.uid() resolves the way
-- it does for a real client and nothing passes vacuously under a NULL uid.
create or replace function pg_temp.as_user(p_user uuid)
  returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Length + character/enum bounds on the ledger columns
-- ---------------------------------------------------------------------------
--
-- Exercised as direct table inserts under the owning/superuser test role, which
-- isolates the CHECK constraints from RLS and from the consent_grant control
-- flow: this block asserts the bounds themselves, the later blocks assert the
-- RPC behavior. Revision 1 / material version 1 is the seeded active catalog row.

-- Maximum valid app_version (32 chars, allowed charset) is accepted.
select lives_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface, app_version, platform)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement', %L, 'ios') $f$,
     :'user_c'::uuid, 'v' || repeat('1', 31)),
  'app_version at the 32-char limit is accepted'
);

-- app_version one char over the limit is rejected.
select throws_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface, app_version, platform)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement', %L, 'ios') $f$,
     :'user_c'::uuid, 'v' || repeat('1', 32)),
  '23514', null,
  'app_version over 32 chars is rejected'
);

-- app_version with an out-of-charset character (space) is rejected.
select throws_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface, app_version, platform)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement', 'v 1', 'ios') $f$,
     :'user_c'::uuid),
  '23514', null,
  'app_version with a disallowed character is rejected'
);

-- A real Platform.OS value is accepted.
select lives_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface, platform)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement', 'web') $f$,
     :'user_c'::uuid),
  'platform value web is accepted'
);

select lives_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface, platform)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement', 'macos') $f$,
     :'user_c'::uuid),
  'platform value macos is accepted'
);

-- A platform outside the enum is rejected.
select throws_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface, platform)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement', 'linux') $f$,
     :'user_c'::uuid),
  '23514', null,
  'a platform outside the enum is rejected'
);

-- Maximum valid surface slug (64 chars) is accepted.
select lives_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface)
     values (%L, 'granted', 1, 1, repeat('a', 64), %L) $f$,
     :'user_c'::uuid, 'a' || repeat('b', 63)),
  'surface slug at the 64-char limit is accepted'
);

-- surface one char over the limit is rejected.
select throws_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface)
     values (%L, 'granted', 1, 1, repeat('a', 64), %L) $f$,
     :'user_c'::uuid, 'a' || repeat('b', 64)),
  '23514', null,
  'surface over 64 chars is rejected'
);

-- surface with an out-of-charset character (uppercase) is rejected.
select throws_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'Cloud_Sync') $f$,
     :'user_c'::uuid),
  '23514', null,
  'surface with a disallowed character is rejected'
);

-- The shipping client default surface is a valid slug (compatibility guard).
select lives_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement') $f$,
     :'user_c'::uuid),
  'the shipping default surface cloud_sync_enablement is accepted'
);

-- The direct-insert fixtures above belong to user_c; the ledger is append-only
-- (deleting them is itself refused), so the throttle block below counts grants
-- for user_t only and is unaffected by them.

-- ---------------------------------------------------------------------------
-- 2. Redundant re-affirmations are throttled
-- ---------------------------------------------------------------------------
--
-- All calls run as user_t through the server RPC. The first grant is a genuine
-- transition (no prior state) and is never throttled. Each subsequent call
-- re-affirms the identical granted state (same active revision, same material
-- version) and consumes the per-user throttle bucket; the 4th redundant call is
-- refused, bounding how fast the append-only ledger can grow.

select pg_temp.as_user(:'user_t'::uuid);

select lives_ok(
  $$ select kilo.consent_grant(1, '0.98.3', 'android') $$,
  'first grant (a genuine transition) succeeds and is not throttled'
);

select lives_ok(
  $$ select kilo.consent_grant(1, '0.98.3', 'android') $$,
  'redundant re-affirmation 1 of 3 is admitted'
);

select lives_ok(
  $$ select kilo.consent_grant(1, '0.98.3', 'android') $$,
  'redundant re-affirmation 2 of 3 is admitted'
);

select lives_ok(
  $$ select kilo.consent_grant(1, '0.98.3', 'android') $$,
  'redundant re-affirmation 3 of 3 is admitted'
);

select throws_ok(
  $$ select kilo.consent_grant(1, '0.98.3', 'android') $$,
  '23514', 'consent grant re-affirmation throttled',
  'a 4th redundant re-affirmation within the window is throttled'
);

reset role;

select is(
  (select count(*) from kilo.consent_events where user_id = :'user_t'::uuid),
  4::bigint,
  'the throttle bounds the ledger: only 4 grant rows were appended'
);

-- ---------------------------------------------------------------------------
-- 3. A legitimate re-consent transition is never blocked by the throttle
-- ---------------------------------------------------------------------------
--
-- The user_t throttle bucket is now exhausted. Move the account out of the
-- granted state (as a real re-consent flow would, e.g. a scope-change
-- needs_reconsent), then re-grant. Because that is a genuine transition it must
-- bypass the throttle and succeed despite the exhausted bucket.

update kilo.consent_state set status = 'needs_reconsent'
  where user_id = :'user_t'::uuid;

select pg_temp.as_user(:'user_t'::uuid);

select lives_ok(
  $$ select kilo.consent_grant(1, '0.98.3', 'android') $$,
  'a real re-consent transition succeeds even with the throttle bucket exhausted'
);

reset role;

select is(
  (select status from kilo.consent_state where user_id = :'user_t'::uuid),
  'granted',
  'the re-consent transition restored the granted state'
);

select * from finish();
rollback;
