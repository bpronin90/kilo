-- Bounds and throttle on client metadata accepted by consent_grant (issue #597).
--
-- Defends #572 claim 13: before this work kilo.consent_grant wrote caller-
-- supplied app_version / platform / surface verbatim into the append-only
-- kilo.consent_events ledger with no size, character, or enum limit, and a
-- granted caller could re-affirm the same active revision in a loop, appending
-- unbounded rows. This suite proves the six things the fix must guarantee:
--
--   1. maximum valid metadata is accepted (no false rejection of real clients);
--   2. oversize / out-of-charset / non-enum metadata is rejected;
--   3. redundant re-affirmations are throttled (the ledger is bounded);
--   4. a legitimate re-consent transition still succeeds even when the throttle
--      bucket for that user is already exhausted.
--   5. the bounds deploy safely over the pre-existing append-only ledger: they
--      are NOT VALID, so adding them never scans/aborts on an out-of-contract
--      legacy row, yet every new write is still rejected (finding 1);
--   6. consent_grant serializes a user's concurrent grants on a per-user
--      transaction advisory lock BEFORE it classifies the transition, so
--      concurrent first grants cannot each bypass the throttle (finding 2).
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/consent-grant-metadata-bounds.test.sql

begin;

select plan(25);

\set user_c '99999999-9999-9999-9999-999999999999'
\set user_t 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set user_l 'dddddddd-dddd-dddd-dddd-dddddddddddd'
\set user_x 'cccccccc-cccc-cccc-cccc-cccccccccccc'

insert into auth.users (id) values (:'user_c'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_t'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_l'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_x'::uuid) on conflict do nothing;

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

-- ---------------------------------------------------------------------------
-- 4. The bounds deploy safely over the pre-existing append-only ledger
-- ---------------------------------------------------------------------------
--
-- Finding 1: kilo.consent_events was unbounded and append-only before this
-- migration, so a single out-of-contract legacy row (an over-length app_version,
-- an unsupported platform, a non-slug surface recorded during the unbounded
-- period) would abort an immediately-validated ALTER TABLE and the protected
-- consent_grant function would never install. The fix adds every bound NOT VALID.
-- This block proves both halves of that: the bounds are marked NOT VALID, so
-- deploy never scans the historical rows; and NOT VALID still rejects every new
-- write. It reproduces the deploy directly -- drop the app_version bound, seed an
-- out-of-contract legacy row exactly as the unbounded period could have, then
-- re-add the bound -- so the assertions exercise the real deploy hazard rather
-- than merely asserting a catalog flag.

select is(
  (select bool_and(not convalidated) from pg_constraint
     where conrelid = 'kilo.consent_events'::regclass
       and conname in (
         'consent_events_app_version_bounds',
         'consent_events_platform_enum',
         'consent_events_surface_bounds'
       )),
  true,
  'all three metadata bounds are NOT VALID, so deploy never scans the pre-existing append-only ledger'
);

-- Reproduce the historical unbounded state: remove the bound and record a legacy
-- row that violates the new contract (a 200-char app_version).
alter table kilo.consent_events drop constraint consent_events_app_version_bounds;
insert into kilo.consent_events
     (user_id, event_type, catalog_revision, material_version, copy_sha256, surface, app_version, platform)
   values (:'user_l'::uuid, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement', repeat('X', 200), 'ios');

-- Re-adding the bound NOT VALID must succeed despite the out-of-contract legacy
-- row -- this is exactly what keeps the migration (and the protected function)
-- deployable.
select lives_ok(
  $$ alter table kilo.consent_events add constraint consent_events_app_version_bounds
       check (app_version is null
              or (char_length(app_version) between 1 and 32
                  and app_version ~ '^[0-9A-Za-z][0-9A-Za-z.+_-]*$'))
       not valid $$,
  'the NOT VALID bound installs even with an out-of-contract legacy row already in the ledger'
);

-- An immediately-validated equivalent constraint would abort on that same legacy
-- row -- the concrete failure NOT VALID avoids at deploy time.
select throws_ok(
  $$ alter table kilo.consent_events add constraint consent_events_app_version_validated_probe
       check (app_version is null or char_length(app_version) between 1 and 32) $$,
  '23514', null,
  'an immediately-validated equivalent bound aborts on the legacy row (why NOT VALID is required at deploy)'
);

-- NOT VALID still enforces the contract on every new write.
select throws_ok(
  format($f$ insert into kilo.consent_events
       (user_id, event_type, catalog_revision, material_version, copy_sha256, surface, app_version, platform)
     values (%L, 'granted', 1, 1, repeat('a', 64), 'cloud_sync_enablement', repeat('Y', 200), 'ios') $f$,
     :'user_l'::uuid),
  '23514', null,
  'a new out-of-contract write is still rejected under the NOT VALID bound'
);

-- The append-only ledger keeps the legacy row; NOT VALID neither purges nor
-- rewrites history, it only bounds the future.
select is(
  (select count(*) from kilo.consent_events where user_id = :'user_l'::uuid),
  1::bigint,
  'the out-of-contract legacy row is retained (NOT VALID leaves history intact)'
);

-- ---------------------------------------------------------------------------
-- 5. consent_grant serializes concurrent first grants before classifying
-- ---------------------------------------------------------------------------
--
-- Finding 2: the consent_state FOR UPDATE lock only serializes callers once a
-- state row exists. On a user's very first grant there is no row, so concurrent
-- first-grant transactions would each observe no state, each classify as a
-- genuine transition, each bypass the throttle, and each append a ledger row.
-- The fix takes a per-user transaction-scoped advisory lock BEFORE reading and
-- classifying state, so the first caller to acquire it appends its transition
-- and commits the granted state while every other concurrent caller blocks here,
-- then serializes, observes the now-granted state, and is throttled as a
-- redundant re-affirmation (bounded by block 2 above).
--
-- The lock is transaction-scoped and this suite runs inside a single
-- transaction, so the lock a grant takes is still held and observable in
-- pg_locks after the call returns. That is exactly the lock a second concurrent
-- first grant for the same user would have to wait on. The keys mirror the
-- function: classid = hashtext('kilo.consent_grant'), objid = hashtext(uid), and
-- the two-key form's objsubid = 2 -- a distinct advisory space from the
-- rate_limit_check single-key lock, so the two never cross-collide. Against the
-- pre-fix function this count is 0, so the assertion is a live regression guard.

select pg_temp.as_user(:'user_x'::uuid);

select lives_ok(
  $$ select kilo.consent_grant(1, '0.98.3', 'ios') $$,
  'a first grant for a fresh user succeeds'
);

reset role;

select is(
  (select count(*) from pg_locks
     where locktype = 'advisory'
       and classid = hashtext('kilo.consent_grant')::oid
       and objid = hashtext((:'user_x')::text)::oid
       and objsubid = 2),
  1::bigint,
  'consent_grant holds a per-user transaction advisory lock, serializing concurrent first grants before transition classification'
);

select * from finish();
rollback;
