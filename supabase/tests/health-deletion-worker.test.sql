-- The purge queue actually drains (issue #487, review finding P1).
--
-- The bug this file exists to prevent: a queue with no consumer. The original
-- schedule re-opened `failed` jobs back to `pending` and stopped there — it never
-- invoked health-data-delete. Every symptom of a healthy system was present (jobs
-- queued, cron running, no errors) while not one row was ever deleted. A user who
-- withdrew consent would sit in `deletion_pending` forever, having been told their
-- cloud health data was being erased.
--
-- So "cron runs" is not the property under test. The properties are:
--   * a due job causes the worker to actually be INVOKED;
--   * a job retries until the gated set is empty, with no attempt cap;
--   * backoff is honored, so retrying forever is not a hot loop;
--   * a dead worker's job is reclaimed;
--   * an unconfigured worker is LOUD, not silent;
--   * one full cron cycle carries a queued job through to verified completion.
--
-- pg_net queues into net.http_request_queue and a background worker drains it.
-- Inside this uncommitted transaction that worker cannot see our rows, so the queue
-- is a reliable record of exactly what would have been sent.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/health-deletion-worker.test.sql

begin;

select plan(37);

\set user_a 'cccccccc-cccc-cccc-cccc-cccccccccccc'
\set user_b 'dddddddd-dddd-dddd-dddd-dddddddddddd'

insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_b'::uuid) on conflict do nothing;

update kilo.health_sync_config
  set mode = 'consent_required', required_material_version = 1,
      minimum_consent_protocol_version = 0, purge_enabled = false
  where id = true;

insert into kilo.consent_state (user_id, status, current_catalog_revision,
  current_material_version, granted_at)
values (:'user_a'::uuid, 'deletion_pending', 1, 1, now())
on conflict (user_id) do update set status = 'deletion_pending';

-- Some cloud health data to erase.
insert into kilo.weight_entries (user_id, id, weight_value)
  values (:'user_a'::uuid, 'w1', 80), (:'user_a'::uuid, 'w2', 81);
insert into kilo.user_health_profile (user_id, fatigue_multiplier)
  values (:'user_a'::uuid, 1.5)
  on conflict (user_id) do update set fatigue_multiplier = 1.5;

-- ---------------------------------------------------------------------------
-- No work, no call
-- ---------------------------------------------------------------------------

select is(
  kilo.dispatch_health_deletion_worker(),
  null,
  'an empty queue does not invoke the worker at all'
);

-- ---------------------------------------------------------------------------
-- An unconfigured worker must be loud, not silent
-- ---------------------------------------------------------------------------

insert into kilo.health_data_deletion_jobs (user_id, reason)
values (:'user_a'::uuid, 'withdrawal');

-- No Vault secrets yet. This is the state a fresh deploy is in, and it is exactly
-- the state in which a silent no-op would strand every withdrawal.
select is(
  kilo.dispatch_health_deletion_worker(),
  null,
  'an unconfigured worker does not pretend to have dispatched'
);

select is(
  (select count(*) from kilo.health_deletion_backlog(interval '0 seconds')),
  1::bigint,
  'the undispatched job is visible in the operator backlog (this is the alarm)'
);

-- ---------------------------------------------------------------------------
-- Configured: a due job actually invokes health-data-delete
-- ---------------------------------------------------------------------------

select vault.create_secret('https://ogzhnscdqcdrhfqcobuv.supabase.co', 'kilo_functions_base_url', 'test');
select vault.create_secret('test-service-role-key', 'kilo_service_role_key', 'test');

select isnt(
  kilo.dispatch_health_deletion_worker(),
  null,
  'a due job dispatches an actual worker invocation'
);

select is(
  (select count(*) from net.http_request_queue
    where url = 'https://ogzhnscdqcdrhfqcobuv.supabase.co/functions/v1/health-data-delete'),
  1::bigint,
  'the invocation targets the health-data-delete Edge Function'
);

select is(
  (select method::text from net.http_request_queue
    where url like '%health-data-delete' limit 1),
  'POST',
  'the worker is invoked with POST'
);

-- The worker authenticates as service_role. Without this the function would fall
-- through to its user-mode branch and reject the call.
select ok(
  (select (headers ->> 'Authorization') = 'Bearer test-service-role-key'
   from net.http_request_queue where url like '%health-data-delete' limit 1),
  'the invocation carries the service-role bearer token from Vault'
);

-- ---------------------------------------------------------------------------
-- Backoff is honored, and there is no attempt cap
-- ---------------------------------------------------------------------------

-- A job that just failed is not retried immediately.
update kilo.health_data_deletion_jobs set
  status = 'failed', attempts = 3, next_attempt_at = now() + interval '10 minutes'
where user_id = :'user_a'::uuid;

select is(
  (kilo.drain_health_deletion_jobs() ->> 'reopened')::int,
  0,
  'a job still inside its backoff window is not retried'
);

select is(
  (select status from kilo.health_data_deletion_jobs where user_id = :'user_a'::uuid),
  'failed',
  'the backed-off job stays failed until its window elapses'
);

-- Once the window elapses it is retried — and the attempt count does not matter.
-- An attempt cap would abandon a user's erasure request, leaving their health data
-- in the cloud with no lawful basis and no way out of deletion_pending.
update kilo.health_data_deletion_jobs set
  attempts = 500, next_attempt_at = now() - interval '1 second'
where user_id = :'user_a'::uuid;

select is(
  (kilo.drain_health_deletion_jobs() ->> 'reopened')::int,
  1,
  'a job is retried after 500 attempts: there is no cap on erasure'
);

select is(
  (select status from kilo.health_data_deletion_jobs where user_id = :'user_a'::uuid),
  'pending',
  'the elapsed job is re-opened for the worker'
);

select ok(
  kilo.health_deletion_backoff(0) < kilo.health_deletion_backoff(4)
    and kilo.health_deletion_backoff(99) <= interval '1 hour',
  'backoff grows with attempts and is capped, so infinite retry is not a hot loop'
);

-- ---------------------------------------------------------------------------
-- A dead worker's job is reclaimed
-- ---------------------------------------------------------------------------

update kilo.health_data_deletion_jobs set
  status = 'running', updated_at = now() - interval '45 minutes'
where user_id = :'user_a'::uuid;

select is(
  (kilo.drain_health_deletion_jobs() ->> 'reclaimed_stale')::int,
  1,
  'a job whose worker died mid-flight is reclaimed'
);

-- ---------------------------------------------------------------------------
-- One full cron cycle carries a queued job to verified completion
-- ---------------------------------------------------------------------------

-- Cycle 1: the drain re-opens and dispatches. The Edge Function then claims the
-- job — this is exactly what health-data-delete's worker mode does on receiving
-- the POST above.
select ok(
  (kilo.drain_health_deletion_jobs() ->> 'dispatched')::boolean,
  'the cron cycle dispatches the queued job'
);

select is(
  (select (kilo.claim_health_deletion_job()).status),
  'running',
  'the worker claims the dispatched job'
);

-- The worker deletes the gated set (legacy columns first — see the resurrection
-- trap in _shared/health-data-scope.ts), then asks the database to settle the job.
update kilo.user_profile set
  current_deload_note_raw_text = null, current_deload_note_saved_at = null,
  current_deload_note_updated_at = null, fatigue_multiplier = null,
  tracked_lifts = null, current_workout_note_id = null
where user_id = :'user_a'::uuid;
delete from kilo.weight_entries where user_id = :'user_a'::uuid;
delete from kilo.user_health_profile where user_id = :'user_a'::uuid;

select is(
  (kilo.complete_health_deletion_job(
    (select id from kilo.health_data_deletion_jobs where user_id = :'user_a'::uuid limit 1)
  ) ->> 'ok')::boolean,
  true,
  'the cycle completes once the gated set is verifiably empty'
);

select is(
  (select status from kilo.consent_state where user_id = :'user_a'::uuid),
  'withdrawn',
  'a full cron cycle advances the user from deletion_pending to withdrawn'
);

select is(
  (select count(*) from kilo.health_deletion_backlog(interval '0 seconds')),
  0::bigint,
  'the backlog is empty once the queue has drained'
);

-- ---------------------------------------------------------------------------
-- What the operator backlog monitor reads (issue #541)
-- ---------------------------------------------------------------------------
--
-- scripts/check-health-deletion-backlog.mjs alerts off exactly these columns.
-- The properties below are the ones it depends on, asserted here so a schema
-- change breaks the SQL suite rather than silently degrading the monitor into
-- a green light. The monitor's own redaction and exit-code contract is covered
-- offline by scripts/health-deletion-monitor.test.mjs.

-- Partial erasure: the worker believed it finished, but rows remain. The job
-- must NOT advance, and it must become visible to the monitor with a bounded
-- error and an incremented attempt count.
insert into kilo.weight_entries (user_id, id, weight_value)
  values (:'user_b'::uuid, 'w-partial', 90);

insert into kilo.consent_state (user_id, status, current_catalog_revision,
  current_material_version, granted_at)
values (:'user_b'::uuid, 'deletion_pending', 1, 1, now())
on conflict (user_id) do update set status = 'deletion_pending';

insert into kilo.health_data_deletion_jobs (user_id, reason, attempts)
values (:'user_b'::uuid, 'withdrawal', 2);

select is(
  (kilo.complete_health_deletion_job(
    (select id from kilo.health_data_deletion_jobs where user_id = :'user_b'::uuid limit 1)
  ) ->> 'ok')::boolean,
  false,
  'partial erasure does not complete the job'
);

select is(
  (select status from kilo.consent_state where user_id = :'user_b'::uuid),
  'deletion_pending',
  'partial erasure never advances the user to withdrawn'
);

select is(
  (select status from kilo.health_deletion_backlog(interval '0 seconds')
   where user_id = :'user_b'::uuid),
  'failed',
  'a partially erased job is visible to the operator monitor as failed'
);

select ok(
  (select attempts >= 2 and last_error is not null
   from kilo.health_deletion_backlog(interval '0 seconds')
   where user_id = :'user_b'::uuid),
  'the monitor can see attempts increasing without completion, with an error message'
);

-- last_error is bounded in the database. The monitor bounds and scrubs it again
-- before it reaches an alert, but the first bound belongs here: an unbounded
-- operational string is how a health value would escape into a log in the first
-- place.
select kilo.fail_health_deletion_job(
  (select id from kilo.health_data_deletion_jobs where user_id = :'user_b'::uuid limit 1),
  repeat('x', 4000)
);

select ok(
  (select length(last_error) <= 500
   from kilo.health_data_deletion_jobs where user_id = :'user_b'::uuid),
  'a worker error is bounded before it can reach an operational log'
);

-- A pg_net/HTTP failure reaches the database as a recorded job failure, not a
-- lost job: the row stays in the backlog for the monitor to alert on.
select is(
  (select count(*) from kilo.health_deletion_backlog(interval '0 seconds')),
  1::bigint,
  'a transport-level worker failure leaves the job visible in the backlog'
);

-- ---------------------------------------------------------------------------
-- kilo.health_deletion_monitor_snapshot() -- #541 review findings 1 and 2
-- ---------------------------------------------------------------------------
--
-- The monitor that consumes this accessor could not work before it existed.
-- `cron.job` enforces RLS as `username = CURRENT_USER`, so a least-privilege
-- monitor role saw zero cron rows and reported `drain-cron-inactive` on every
-- run; and kilo.health_data_deletion_jobs is RLS-deny-all, so `updated_at` --
-- the clock the drain's own stale reclaim uses -- was unreadable, leaving the
-- monitor comparing against `created_at` and false-paging on freshly claimed
-- old jobs.
--
-- These assertions pin the three properties that make it a usable monitor read
-- path: it sees the cron row, it exposes the claim clock separately from the
-- job clock, and it cannot leak identity.

-- The cron row is visible through the accessor. Read directly, this is false
-- for any role that did not schedule the job.
select ok(
  (kilo.health_deletion_monitor_snapshot() -> 'drain_cron_present')::boolean,
  'the accessor sees the health-deletion-drain cron row that cron.job RLS hides'
);

select ok(
  (kilo.health_deletion_monitor_snapshot() -> 'drain_cron_active')::boolean,
  'the accessor reports the drain cron as active'
);

-- REDACTION. The accessor is machine-read and its output reaches alert
-- surfaces, so user_id must be absent from every job object. This is the
-- assertion that fails loudly if someone "simplifies" the explicit column list
-- into to_jsonb(j).
select ok(
  not exists (
    select 1
    from jsonb_array_elements(kilo.health_deletion_monitor_snapshot() -> 'jobs') j
    where j ? 'user_id'
  ),
  'the accessor never returns user_id'
);

select ok(
  not (kilo.health_deletion_monitor_snapshot()::text ilike '%' || :'user_b' || '%'),
  'no user uuid appears anywhere in the accessor payload'
);

-- Secret NAMES only, never secret material.
select ok(
  (kilo.health_deletion_monitor_snapshot() -> 'required_secret_names')
    @> '["kilo_functions_base_url", "kilo_service_role_key"]'::jsonb,
  'the accessor reports the required Vault secret names'
);

-- The two clocks are genuinely distinct. Force the exact false-positive shape
-- the old monitor got wrong: a job created well past the 30-minute reclaim
-- ceiling but claimed just now. age_seconds must be large; running_seconds must
-- be near zero, because that is what the reclaimer actually compares.
update kilo.health_data_deletion_jobs
  set status = 'running', created_at = now() - interval '90 minutes', updated_at = now()
  where user_id = :'user_b'::uuid;

select ok(
  (select (j ->> 'age_seconds')::numeric > 3600
   from jsonb_array_elements(kilo.health_deletion_monitor_snapshot() -> 'jobs') j
   limit 1),
  'age_seconds still measures the wait since the user requested erasure'
);

select ok(
  (select (j ->> 'running_seconds')::numeric < 60
   from jsonb_array_elements(kilo.health_deletion_monitor_snapshot() -> 'jobs') j
   limit 1),
  'running_seconds measures the claim, so a freshly claimed old job is not stale'
);

-- And the genuinely wedged case still reads as stale.
update kilo.health_data_deletion_jobs
  set updated_at = now() - interval '45 minutes'
  where user_id = :'user_b'::uuid;

select ok(
  (select (j ->> 'running_seconds')::numeric > 1800
   from jsonb_array_elements(kilo.health_deletion_monitor_snapshot() -> 'jobs') j
   limit 1),
  'a claim held past the reclaim ceiling reads as stale through running_seconds'
);

-- running_seconds is meaningful only for a held claim.
update kilo.health_data_deletion_jobs
  set status = 'pending' where user_id = :'user_b'::uuid;

select ok(
  (select (j -> 'running_seconds') = 'null'::jsonb
   from jsonb_array_elements(kilo.health_deletion_monitor_snapshot() -> 'jobs') j
   limit 1),
  'running_seconds is null for a job that is not running'
);

-- Least privilege: the monitor role exists, can execute the accessor, and holds
-- nothing else. This is the check that caught the original RLS blockers.
select ok(
  exists (select 1 from pg_catalog.pg_roles where rolname = 'kilo_deletion_monitor'),
  'the least-privilege monitor role exists'
);

select ok(
  has_function_privilege('kilo_deletion_monitor', 'kilo.health_deletion_monitor_snapshot()', 'execute'),
  'the monitor role can execute the accessor'
);

-- It must NOT be able to read the jobs table directly, or the accessor's
-- redaction boundary would be bypassable.
select ok(
  not has_table_privilege('kilo_deletion_monitor', 'kilo.health_data_deletion_jobs', 'select'),
  'the monitor role has no direct read on the deletion jobs table'
);

-- And it must never reach the backlog function, which does return user_id.
select ok(
  not has_function_privilege('kilo_deletion_monitor', 'kilo.health_deletion_backlog(interval)', 'execute'),
  'the monitor role cannot call the backlog function that exposes user_id'
);

select * from finish();
rollback;
