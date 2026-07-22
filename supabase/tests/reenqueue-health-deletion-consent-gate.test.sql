-- Operator re-enqueue refuses accounts whose consent state does not authorize
-- health deletion (issue #598, follow-up to #572 claim 13).
--
-- The bug this file exists to prevent: kilo.reenqueue_health_deletion() would
-- rearm or freshly enqueue a purge job for ANY account, without checking consent
-- state. The worker then deletes the scoped health rows. So one operator call
-- against a currently `granted` account would erase health data the user still
-- consents to keep.
--
-- Properties under test:
--   * a currently `granted` account is refused, fail closed, with an explicit
--     reason -- no job is created or rearmed;
--   * `needs_reconsent` (scope changed, no withdrawal) is likewise refused;
--   * an account with no consent_state row is refused;
--   * a `deletion_pending` account with a failed withdrawal job is recoverable:
--     the existing job is rearmed, not duplicated;
--   * a `deletion_pending` account whose job row is gone gets an idempotent
--     operator job re-created (the authorizing state IS the evidence);
--   * a `withdrawn` account is authorized (re-purge if rows reappear), and the
--     re-enqueue pins the account to `deletion_pending` so it cannot be re-granted
--     while a purge job is queued -- closing the withdrawn -> re-enqueue -> re-grant
--     race flagged in the #598 review (worker claims by job status and deletes by
--     user_id without re-checking consent).
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/reenqueue-health-deletion-consent-gate.test.sql

begin;

select plan(21);

\set granted   '11111111-1111-1111-1111-111111111111'
\set reconsent '22222222-2222-2222-2222-222222222222'
\set pending   '33333333-3333-3333-3333-333333333333'
\set orphaned  '44444444-4444-4444-4444-444444444444'
\set withdrawn '55555555-5555-5555-5555-555555555555'
\set nostate   '66666666-6666-6666-6666-666666666666'

insert into auth.users (id) values
  (:'granted'::uuid), (:'reconsent'::uuid), (:'pending'::uuid),
  (:'orphaned'::uuid), (:'withdrawn'::uuid), (:'nostate'::uuid)
on conflict do nothing;

update kilo.health_sync_config
  set mode = 'consent_required', required_material_version = 1,
      minimum_consent_protocol_version = 0, purge_enabled = false
  where id = true;

-- Consent-state fixtures spanning every branch of the gate.
insert into kilo.consent_state (user_id, status, current_catalog_revision,
  current_material_version, granted_at)
values
  (:'granted'::uuid,   'granted',          1, 1, now()),
  (:'reconsent'::uuid, 'needs_reconsent',  1, 1, now()),
  (:'pending'::uuid,   'deletion_pending', 1, 1, now()),
  (:'orphaned'::uuid,  'deletion_pending', 1, 1, now()),
  (:'withdrawn'::uuid, 'withdrawn',        1, 1, now())
on conflict (user_id) do update set status = excluded.status;

-- The granted account has live cloud health data. It must survive.
insert into kilo.weight_entries (user_id, id, weight_value)
  values (:'granted'::uuid, 'g1', 80), (:'granted'::uuid, 'g2', 81);

-- A legitimate, recoverable failed withdrawal job for the deletion_pending user.
insert into kilo.health_data_deletion_jobs (user_id, reason, status, attempts,
  last_error, next_attempt_at)
values (:'pending'::uuid, 'withdrawal', 'failed', 3, '2 scoped rows remain',
  now() + interval '1 hour');

-- Impersonation helper for the re-grant leg of the race test. Both claim GUCs are
-- set because auth.uid() reads the JSON `request.jwt.claims` in some Postgres image
-- versions and the scalar `request.jwt.claim.sub` in others; setting only one
-- yields a NULL uid and a vacuously "authenticated" call.
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
-- Granted: refused, fail closed, with an explicit reason
-- ---------------------------------------------------------------------------

select throws_ok(
  format('select kilo.reenqueue_health_deletion(%L)', :'granted'),
  '23514',
  'reenqueue_health_deletion refused: consent state granted does not authorize health deletion for user ' || :'granted',
  'a currently granted account is refused with an explicit, state-naming reason'
);

select is(
  (select count(*) from kilo.health_data_deletion_jobs where user_id = :'granted'::uuid),
  0::bigint,
  'the refusal created no deletion job for the granted account'
);

select is(
  (select count(*) from kilo.weight_entries where user_id = :'granted'::uuid),
  2::bigint,
  'the granted account still has its cloud health data (nothing was queued to erase it)'
);

-- ---------------------------------------------------------------------------
-- needs_reconsent: refused (scope changed, but the user never withdrew)
-- ---------------------------------------------------------------------------

select throws_ok(
  format('select kilo.reenqueue_health_deletion(%L)', :'reconsent'),
  '23514',
  'reenqueue_health_deletion refused: consent state needs_reconsent does not authorize health deletion for user ' || :'reconsent',
  'a needs_reconsent account is refused: quarantine expiry, not the operator path, handles it'
);

select is(
  (select count(*) from kilo.health_data_deletion_jobs where user_id = :'reconsent'::uuid),
  0::bigint,
  'the refusal created no deletion job for the needs_reconsent account'
);

-- ---------------------------------------------------------------------------
-- No consent state row at all: refused
-- ---------------------------------------------------------------------------

select throws_ok(
  format('select kilo.reenqueue_health_deletion(%L)', :'nostate'),
  '23514',
  'reenqueue_health_deletion refused: no consent state for user ' || :'nostate' || '; health deletion is not authorized',
  'an account with no consent state is refused'
);

select is(
  (select count(*) from kilo.health_data_deletion_jobs where user_id = :'nostate'::uuid),
  0::bigint,
  'the refusal created no deletion job for the stateless account'
);

-- ---------------------------------------------------------------------------
-- Null argument: refused
-- ---------------------------------------------------------------------------

select throws_ok(
  'select kilo.reenqueue_health_deletion(null)',
  '23514',
  'reenqueue_health_deletion refused: a target user id is required',
  'a null target is refused before touching any row'
);

-- ---------------------------------------------------------------------------
-- deletion_pending with a failed job: the legitimate recovery path
-- ---------------------------------------------------------------------------

select lives_ok(
  format('select kilo.reenqueue_health_deletion(%L)', :'pending'),
  'a deletion_pending account with a failed withdrawal job is accepted'
);

select is(
  (select count(*) from kilo.health_data_deletion_jobs where user_id = :'pending'::uuid),
  1::bigint,
  'the existing failed job is rearmed, not duplicated'
);

select is(
  (select status from kilo.health_data_deletion_jobs where user_id = :'pending'::uuid),
  'pending',
  'the recovered job is moved back to pending'
);

select is(
  (select reason from kilo.health_data_deletion_jobs where user_id = :'pending'::uuid),
  'withdrawal',
  'recovery preserves the original withdrawal reason (no operator_reenqueue row minted)'
);

select ok(
  (select last_error is null from kilo.health_data_deletion_jobs where user_id = :'pending'::uuid),
  'the rearmed job has its last_error cleared'
);

select ok(
  (select next_attempt_at <= now() from kilo.health_data_deletion_jobs where user_id = :'pending'::uuid),
  'the rearmed job is due now, not sitting out its backoff window'
);

-- ---------------------------------------------------------------------------
-- deletion_pending with NO job row: the authorizing state IS the evidence
-- ---------------------------------------------------------------------------

select lives_ok(
  format('select kilo.reenqueue_health_deletion(%L)', :'orphaned'),
  'a deletion_pending account with no open job is accepted (state authorizes it)'
);

select is(
  (select reason from kilo.health_data_deletion_jobs where user_id = :'orphaned'::uuid),
  'operator_reenqueue',
  'a fresh operator_reenqueue job is created when none existed'
);

-- ---------------------------------------------------------------------------
-- withdrawn: authorized (re-purge if scoped rows ever reappear), and the
-- re-enqueue pins the account to deletion_pending so it cannot be re-granted
-- while a purge job is queued (#598 review regression).
-- ---------------------------------------------------------------------------

-- A single call: accepted, and it echoes the deletion-authorizing status read
-- before the in-transaction state transition.
select is(
  (select (kilo.reenqueue_health_deletion(:'withdrawn'::uuid)) ->> 'consent_status'),
  'withdrawn',
  'a withdrawn account is authorized and the result echoes its consent status'
);

-- The re-enqueue moved the state to deletion_pending in the same transaction.
select is(
  (select status from kilo.consent_state where user_id = :'withdrawn'::uuid),
  'deletion_pending',
  'the re-enqueue pinned the withdrawn account to deletion_pending'
);

select is(
  (select count(*) from kilo.health_data_deletion_jobs
     where user_id = :'withdrawn'::uuid and status in ('pending', 'running')),
  1::bigint,
  'a purge job is queued for the re-enqueued account'
);

-- The race, closed: with the state now deletion_pending, the user re-granting is
-- refused. Without the state transition the account would move withdrawn -> granted
-- while the job sits queued, and the worker would erase the freshly consented rows.
select pg_temp.as_user(:'withdrawn'::uuid);
select throws_ok(
  $$ select kilo.consent_grant(1, '1.2.3', 'android') $$,
  '23514',
  'health data deletion is pending',
  'the re-enqueued account cannot be re-granted while its purge job is queued'
);
reset role;

select is(
  (select status from kilo.consent_state where user_id = :'withdrawn'::uuid),
  'deletion_pending',
  'the blocked re-grant left the account deletion_pending, never granted'
);

select * from finish();
rollback;
