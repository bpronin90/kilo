-- Withdrawal, purge, quarantine, and evidence lifecycle tests (issue #487).
--
-- Withdrawal is the part users are most likely to be lied to about: an app says
-- "sync off" and quietly keeps the cloud copy. These tests assert the opposite —
-- access is blocked immediately, a durable job is created, the state cannot reach
-- `withdrawn` until deletion is VERIFIED, and a partial purge retries rather than
-- silently declaring success.
--
-- They also pin down the existing-user cutover, whose failure mode is worse than
-- a bug: purging a user whose 30-day window was never actually started, or
-- extending someone's window forever by retrying a notice.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/consent-lifecycle.test.sql

begin;

select plan(42);

\set user_a '99999999-9999-9999-9999-999999999999'
\set user_b 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set user_c 'cccccccc-cccc-cccc-cccc-cccccccccccc'
\set user_d 'dddddddd-dddd-dddd-dddd-dddddddddddd'

insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_b'::uuid) on conflict do nothing;

-- Both claim GUCs are set on purpose: Supabase's auth.uid() has read the JSON
-- `request.jwt.claims` in some Postgres image versions and the scalar
-- `request.jwt.claim.sub` in others. Setting only one yields a NULL uid, which
-- would turn every "the user cannot do X" assertion below into a test that passes
-- simply because nobody was logged in.
create or replace function pg_temp.as_user(p_user uuid)
  returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role authenticated';
end $$;

-- Guard the guard: a broken impersonation helper must fail loudly, not silently
-- make the rest of the file vacuous.
select pg_temp.as_user(:'user_a'::uuid);
select is(auth.uid(), :'user_a'::uuid, 'the test harness actually authenticates as the intended user');
reset role;

update kilo.health_sync_config
  set mode = 'consent_required', required_material_version = 1,
      minimum_consent_protocol_version = 0, purge_enabled = false
  where id = true;

-- ---------------------------------------------------------------------------
-- Grant, then withdraw
-- ---------------------------------------------------------------------------

select pg_temp.as_user(:'user_a'::uuid);
select kilo.consent_grant(1, '1.2.3', 'android');

insert into kilo.weight_entries (user_id, id, weight_value)
  values (:'user_a'::uuid, 'w1', 80), (:'user_a'::uuid, 'w2', 81);
insert into kilo.user_health_profile (user_id, fatigue_multiplier)
  values (:'user_a'::uuid, 1.5)
  on conflict (user_id) do update set fatigue_multiplier = 1.5;

select is(
  (select count(*) from kilo.weight_entries where user_id = :'user_a'::uuid),
  2::bigint,
  'granted user has cloud health data'
);

select lives_ok(
  $$ select kilo.consent_withdraw() $$,
  'a user can withdraw their own consent'
);

select is(
  (select status from kilo.consent_state where user_id = :'user_a'::uuid),
  'deletion_pending',
  'withdrawal moves the state to deletion_pending'
);

-- The point of the immediate transition: access dies before the purge even runs.
select is(
  (select count(*) from kilo.weight_entries),
  0::bigint,
  'withdrawal blocks health reads IMMEDIATELY, before any purge work happens'
);

select throws_ok(
  $$ insert into kilo.weight_entries (user_id, id, weight_value)
     values ('99999999-9999-9999-9999-999999999999', 'w3', 82) $$,
  '42501', null,
  'withdrawal blocks new health writes immediately'
);

select is(
  (select kilo.health_sync_preflight() ->> 'code'),
  'HEALTH_DATA_DELETION_PENDING',
  'preflight reports the pending deletion distinctly'
);

-- Re-granting from deletion_pending would race the purge and could leave the user
-- "granted" over a half-deleted dataset.
select throws_ok(
  $$ select kilo.consent_grant(1, '1.2.3', 'android') $$,
  null, null,
  'a user cannot re-grant while deletion is pending'
);

reset role;

-- Asserted by existence, not by "the newest event": occurred_at is now(), which is
-- transaction time, so the grant and the withdrawal share a timestamp inside this
-- test and "order by occurred_at desc limit 1" would be a coin flip. In production
-- they are separate transactions.
select is(
  (select count(*) from kilo.consent_events
    where user_id = :'user_a'::uuid and event_type = 'withdrawn'),
  1::bigint,
  'withdrawal appends a withdrawal event to the ledger'
);

select isnt(
  (select grant_event_id from kilo.consent_events
    where user_id = :'user_a'::uuid and event_type = 'withdrawn' limit 1),
  null,
  'the withdrawal event names the grant it withdraws'
);

select is(
  (select count(*) from kilo.health_data_deletion_jobs
    where user_id = :'user_a'::uuid and status = 'pending'),
  1::bigint,
  'withdrawal creates exactly one durable deletion job'
);

-- ---------------------------------------------------------------------------
-- The purge must be verified, not asserted
-- ---------------------------------------------------------------------------

-- Simulate a worker that crashed after deleting only some tables. Completing the
-- job now must FAIL: the state may not reach `withdrawn` while rows remain.
delete from kilo.weight_entries where user_id = :'user_a'::uuid and id = 'w1';

select is(
  (kilo.complete_health_deletion_job(
    (select id from kilo.health_data_deletion_jobs where user_id = :'user_a'::uuid limit 1)
  ) ->> 'ok')::boolean,
  false,
  'completing a job with rows still present is refused'
);

select is(
  (select status from kilo.consent_state where user_id = :'user_a'::uuid),
  'deletion_pending',
  'a partial purge leaves the user in deletion_pending, never withdrawn'
);

select is(
  (select status from kilo.health_data_deletion_jobs where user_id = :'user_a'::uuid limit 1),
  'failed',
  'a partial purge marks the job failed so cron retries it'
);

-- The operator path: re-enqueue the SAME idempotent job. It cannot forge a grant.
select is(
  (kilo.reenqueue_health_deletion(:'user_a'::uuid) ->> 'ok')::boolean,
  true,
  'the operator can re-enqueue a wedged purge'
);

select is(
  (select status from kilo.health_data_deletion_jobs where user_id = :'user_a'::uuid limit 1),
  'pending',
  're-enqueue returns the job to pending'
);

select is(
  (select count(*) from kilo.health_data_deletion_jobs where user_id = :'user_a'::uuid),
  1::bigint,
  're-enqueue reuses the same job rather than racing a second one'
);

-- Regression: clearing the legacy columns AFTER deleting the canonical row
-- resurrects it. Nulling the six columns is a health-value change, so it fires
-- kilo.mirror_profile_to_health, which UPSERTS user_health_profile straight back
-- into existence. The purge then never reaches zero rows, the withdrawal is wedged
-- in deletion_pending forever, and account deletion 500s on every retry.
-- _shared/health-data-scope.ts clears the columns FIRST for exactly this reason;
-- this asserts the trap is real so nobody "tidies" that order later.
delete from kilo.user_health_profile where user_id = :'user_a'::uuid;

update kilo.user_profile set
  current_deload_note_raw_text = null, current_deload_note_saved_at = null,
  current_deload_note_updated_at = null, fatigue_multiplier = null,
  tracked_lifts = null, current_workout_note_id = null
where user_id = :'user_a'::uuid;

select is(
  (select count(*) from kilo.user_health_profile where user_id = :'user_a'::uuid),
  1::bigint,
  'clearing legacy columns after the delete RESURRECTS the canonical row (the trap)'
);

-- Now purge in the order the shared scope actually uses: legacy columns first,
-- gated tables second (user_health_profile last).
update kilo.user_profile set
  current_deload_note_raw_text = null, current_deload_note_saved_at = null,
  current_deload_note_updated_at = null, fatigue_multiplier = null,
  tracked_lifts = null, current_workout_note_id = null
where user_id = :'user_a'::uuid;

delete from kilo.weight_entries where user_id = :'user_a'::uuid;
delete from kilo.user_health_profile where user_id = :'user_a'::uuid;

select is(
  (select count(*) from kilo.user_health_profile where user_id = :'user_a'::uuid),
  0::bigint,
  'clearing legacy columns first leaves the canonical row deleted'
);

select is(
  (kilo.complete_health_deletion_job(
    (select id from kilo.health_data_deletion_jobs where user_id = :'user_a'::uuid limit 1)
  ) ->> 'ok')::boolean,
  true,
  'completing a job with zero scoped rows succeeds'
);

select is(
  (select status from kilo.consent_state where user_id = :'user_a'::uuid),
  'withdrawn',
  'deletion_pending -> withdrawn only after verified deletion'
);

select isnt(
  (select cloud_data_deleted_at from kilo.consent_state where user_id = :'user_a'::uuid),
  null,
  'cloud_data_deleted_at is recorded'
);

-- The account and its non-health settings survive: withdrawal is not deletion.
select is(
  (select count(*) from auth.users where id = :'user_a'::uuid),
  1::bigint,
  'withdrawal preserves the account'
);

-- Re-granting from `withdrawn` is allowed; from deletion_pending it was not.
select pg_temp.as_user(:'user_a'::uuid);

select lives_ok(
  $$ select kilo.consent_grant(1, '1.2.3', 'android') $$,
  'a user can grant again after a completed withdrawal'
);

select is(
  (select status from kilo.consent_state where user_id = :'user_a'::uuid),
  'granted',
  're-grant restores access'
);

reset role;

-- ---------------------------------------------------------------------------
-- Per-account quarantine
-- ---------------------------------------------------------------------------

insert into kilo.consent_state (user_id, status) values (:'user_b'::uuid, 'needs_reconsent')
  on conflict (user_id) do update set status = 'needs_reconsent';

select is(
  (select count(*) from kilo.quarantine_accounts_without_notice() where user_id = :'user_b'::uuid),
  1::bigint,
  'a quarantined account with no recorded notice is surfaced for alerting, not purged'
);

select kilo.record_consent_notice(:'user_b'::uuid, 'notice_sent');

select is(
  (select quarantine_expires_at::date - quarantine_started_at::date
     from kilo.consent_state where user_id = :'user_b'::uuid),
  30,
  'the quarantine window is exactly 30 days from the recorded notice'
);

-- Retrying a notice must not extend the window. Anchoring once is what makes the
-- window a bounded remediation rather than an open-ended grace period.
create temp table quarantine_before as
  select quarantine_expires_at from kilo.consent_state where user_id = :'user_b'::uuid;

select kilo.record_consent_notice(:'user_b'::uuid, 'consent_capable_denial');

select is(
  (select quarantine_expires_at from kilo.consent_state where user_id = :'user_b'::uuid),
  (select quarantine_expires_at from quarantine_before),
  'a retried notice does not reset or extend the quarantine window'
);

-- The anchor is write-once even against a direct privileged UPDATE, not merely
-- against record_consent_notice()'s coalesce. Moving a user's expiry is how an
-- account gets purged early, so nothing may be able to move it.
select throws_ok(
  $$ update kilo.consent_state set quarantine_expires_at = now() + interval '90 days'
     where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  null, null,
  'the quarantine expiry cannot be moved, even by a service-role UPDATE'
);

-- Simulate the 30 days elapsing. The immutability trigger is exactly what stops a
-- normal UPDATE here, so the harness disables it for this one statement rather
-- than weakening the invariant it just proved.
alter table kilo.consent_state disable trigger consent_state_quarantine_immutable;
update kilo.consent_state
  set quarantine_expires_at = now() - interval '1 day'
  where user_id = :'user_b'::uuid;
alter table kilo.consent_state enable trigger consent_state_quarantine_immutable;

-- Purge is a SEPARATE flag from the gate mode. A gate defect must be pausable
-- without risking mass deletion of users' cloud health data.
select is(
  kilo.enqueue_expired_quarantine_purges(),
  0,
  'an expired window does NOT purge while purge_enabled is false'
);

update kilo.health_sync_config set purge_enabled = true where id = true;

select is(
  kilo.enqueue_expired_quarantine_purges(),
  1,
  'arming purge enqueues the expired account'
);

select is(
  (select reason from kilo.health_data_deletion_jobs where user_id = :'user_b'::uuid limit 1),
  'quarantine_expiry',
  'the quarantine purge is recorded as an operational event, not a consent event'
);

select is(
  (select count(*) from kilo.consent_events where user_id = :'user_b'::uuid),
  0::bigint,
  'an existing user is never synthetically consented or given a fabricated event'
);

-- ---------------------------------------------------------------------------
-- Account deletion cascades the consent ledger (issue #519)
-- ---------------------------------------------------------------------------
--
-- consent_events.user_id is auth.users(id) ON DELETE CASCADE, but the append-only
-- trigger raised on every delete, so deleting a consented user's auth.users row
-- failed with the append-only violation and permanently broke account deletion.
-- The forward migration relaxes the trigger for exactly the FK-cascade case while
-- keeping direct mutation append-only. These tests exercise the real parent delete
-- and pin both the allowed cascade and the still-rejected direct mutations.

-- user_a is currently granted and has real consent events; use them to prove the
-- append-only guarantee still holds against direct mutation.
select throws_ok(
  $$ delete from kilo.consent_events
       where user_id = '99999999-9999-9999-9999-999999999999' $$,
  '23514', 'kilo.consent_events is append-only',
  'a direct DELETE against consent_events is still rejected as append-only'
);

select throws_ok(
  $$ update kilo.consent_events set surface = 'tamper'
       where user_id = '99999999-9999-9999-9999-999999999999' $$,
  '23514', 'kilo.consent_events is append-only',
  'an UPDATE against consent_events is still rejected as append-only'
);

-- Control: an auth user with no consent history has always deleted fine and must
-- keep doing so.
insert into auth.users (id) values (:'user_c'::uuid) on conflict do nothing;

select lives_ok(
  $$ delete from auth.users where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'a control auth user with no consent history deletes successfully'
);

select is(
  (select count(*) from auth.users where id = :'user_c'::uuid),
  0::bigint,
  'the control auth user is gone'
);

-- The regression itself: a consented user with a real ledger row must delete and
-- cascade the ledger, instead of failing with the append-only violation.
insert into auth.users (id) values (:'user_d'::uuid) on conflict do nothing;

select pg_temp.as_user(:'user_d'::uuid);
select kilo.consent_grant(1, '1.2.3', 'android');
reset role;

select cmp_ok(
  (select count(*) from kilo.consent_events where user_id = :'user_d'::uuid),
  '>', 0::bigint,
  'the consented user has a real consent event before deletion'
);

select lives_ok(
  $$ delete from auth.users where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$,
  'deleting a consented auth user succeeds instead of raising the append-only violation'
);

select is(
  (select count(*) from kilo.consent_events where user_id = :'user_d'::uuid),
  0::bigint,
  'the cascade erased all of the deleted user''s consent events'
);

select is(
  (select count(*) from kilo.consent_state where user_id = :'user_d'::uuid),
  0::bigint,
  'the cascade erased the deleted user''s consent state'
);

select is(
  (select count(*) from auth.users where id = :'user_d'::uuid),
  0::bigint,
  'the consented auth user is gone'
);

select * from finish();
rollback;
