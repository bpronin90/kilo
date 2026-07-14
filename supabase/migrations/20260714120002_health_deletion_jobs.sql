-- Withdrawal purge, per-account quarantine, and evidence retention (issue #487).
--
-- Withdrawal is not a sync pause. Under Art. 7(3) + Art. 17, turning Cloud Sync
-- off ends the consent-based processing and the cloud copy must be erased without
-- undue delay. That erasure has to survive a crashed Edge Function, a partial
-- delete, and a wedged retry, so it is a durable job rather than a best-effort
-- call:
--
--   granted -> deletion_pending   access blocked IMMEDIATELY, job created
--            -> withdrawn         only after deletion is VERIFIED (zero rows)
--
-- A user cannot re-grant from deletion_pending: doing so would race the purge and
-- could leave them "granted" over a half-deleted dataset.
--
-- The existing-user cutover reuses the same idempotent job. Each account gets its
-- own 30-day window anchored ONCE at its first recorded actionable notice, so
-- purge eligibility is per-account and never a global date.

-- ---------------------------------------------------------------------------
-- 1. The gated table set, in the database
-- ---------------------------------------------------------------------------

-- The same seven tables the shared Edge Function scope module covers. Two copies
-- of this list exist because two runtimes need it; a contract test asserts they
-- are identical, so a table added to one and forgotten in the other fails CI
-- rather than silently under-deleting a user's health data.
create or replace function kilo.health_gated_tables()
  returns text[]
  language sql
  immutable
  set search_path = ''
as $$
  select array[
    'user_health_profile',
    'weight_entries',
    'weight_goal',
    'archived_weight_goals',
    'workout_notes',
    'deload_history',
    'fatigue_checkins'
  ]::text[];
$$;

grant execute on function kilo.health_gated_tables() to service_role;

-- Count the rows still present for a user across the gated set. This is the
-- verification that gates deletion_pending -> withdrawn: the transition is only
-- legal at zero.
create or replace function kilo.health_data_row_counts(p_user_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  t text;
  v_count bigint;
  v_result jsonb := '{}'::jsonb;
begin
  foreach t in array kilo.health_gated_tables() loop
    execute format('select count(*) from kilo.%I where user_id = $1', t)
      into v_count using p_user_id;
    v_result := v_result || jsonb_build_object(t, v_count);
  end loop;

  -- The six legacy columns are still health data until the contract step drops
  -- them, so a user with a non-null value in any of them is NOT yet purged.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'kilo'
      and table_name = 'user_profile'
      and column_name = 'fatigue_multiplier'
  ) then
    execute $q$
      select count(*) from kilo.user_profile
      where user_id = $1
        and (current_deload_note_raw_text is not null
          or current_deload_note_saved_at is not null
          or current_deload_note_updated_at is not null
          or fatigue_multiplier is not null
          or tracked_lifts is not null
          or current_workout_note_id is not null)
    $q$ into v_count using p_user_id;
    v_result := v_result || jsonb_build_object('user_profile_legacy_columns', v_count);
  end if;

  return v_result;
end;
$$;

revoke all on function kilo.health_data_row_counts(uuid) from public, anon, authenticated;
grant execute on function kilo.health_data_row_counts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Durable deletion jobs
-- ---------------------------------------------------------------------------

create table if not exists kilo.health_data_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  -- Per-table counts and completion status ONLY. No deleted values, ever.
  table_counts jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint health_deletion_jobs_reason
    check (reason in ('withdrawal', 'quarantine_expiry', 'operator_reenqueue')),
  constraint health_deletion_jobs_status
    check (status in ('pending', 'running', 'complete', 'failed'))
);

-- At most one open job per user. Re-enqueueing an in-flight purge must reuse the
-- same job rather than racing a second worker over the same rows.
create unique index if not exists health_deletion_jobs_one_open_per_user
  on kilo.health_data_deletion_jobs (user_id)
  where status in ('pending', 'running');

create index if not exists health_deletion_jobs_status_idx
  on kilo.health_data_deletion_jobs (status, updated_at);

alter table kilo.health_data_deletion_jobs enable row level security;
-- Service-role only. A user must not be able to see, create, or cancel the job
-- that erases their cloud data; they see "deletion pending" through preflight.
grant all on kilo.health_data_deletion_jobs to service_role;

-- ---------------------------------------------------------------------------
-- 3. Withdrawal
-- ---------------------------------------------------------------------------

-- Atomic: block access, append the withdrawal event, and create the durable job
-- in one transaction. If any part fails, the user stays granted and nothing is
-- half-deleted.
create or replace function kilo.consent_withdraw()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid;
  v_state kilo.consent_state%rowtype;
  v_event_id uuid;
  v_job_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_state from kilo.consent_state where user_id = v_uid for update;

  if v_state.user_id is null then
    raise exception 'no consent state for user' using errcode = 'check_violation';
  end if;

  -- Idempotent: withdrawing twice is not an error, it just reports the purge
  -- already in flight.
  if v_state.status = 'deletion_pending' then
    return jsonb_build_object('ok', true, 'status', 'deletion_pending', 'already', true);
  end if;

  if v_state.status <> 'granted' then
    raise exception 'no active grant to withdraw' using errcode = 'check_violation';
  end if;

  insert into kilo.consent_events (
    user_id, event_type, catalog_revision, material_version, copy_sha256,
    grant_event_id, surface
  )
  select
    v_uid, 'withdrawn', v_state.current_catalog_revision, v_state.current_material_version,
    r.copy_sha256, v_state.current_grant_event_id, 'cloud_sync_enablement'
  from kilo.consent_revision r
  where r.catalog_revision = v_state.current_catalog_revision
  returning id into v_event_id;

  update kilo.consent_state set
    status = 'deletion_pending',
    withdrawn_at = now(),
    updated_at = now()
  where user_id = v_uid;

  insert into kilo.health_data_deletion_jobs (user_id, reason)
  values (v_uid, 'withdrawal')
  on conflict (user_id) where status in ('pending', 'running') do nothing
  returning id into v_job_id;

  -- ON CONFLICT DO NOTHING returns no row, so an already-open job leaves v_job_id
  -- null. Report the existing job rather than a null id: the caller uses this to
  -- show "deletion pending", and a null would read as "no purge scheduled".
  if v_job_id is null then
    select id into v_job_id
    from kilo.health_data_deletion_jobs
    where user_id = v_uid and status in ('pending', 'running')
    order by created_at
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'deletion_pending',
    'withdrawal_event_id', v_event_id,
    'job_id', v_job_id
  );
end;
$$;

revoke all on function kilo.consent_withdraw() from public, anon;
grant execute on function kilo.consent_withdraw() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Job worker protocol
-- ---------------------------------------------------------------------------

-- Claim the oldest open job. SKIP LOCKED so two concurrent workers never take the
-- same job; the partial unique index above already prevents two open jobs for one
-- user.
create or replace function kilo.claim_health_deletion_job()
  returns kilo.health_data_deletion_jobs
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_job kilo.health_data_deletion_jobs%rowtype;
begin
  select * into v_job
  from kilo.health_data_deletion_jobs
  where status in ('pending', 'failed')
  order by created_at
  for update skip locked
  limit 1;

  if v_job.id is null then
    return null;
  end if;

  update kilo.health_data_deletion_jobs set
    status = 'running',
    attempts = attempts + 1,
    updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function kilo.claim_health_deletion_job() from public, anon, authenticated;
grant execute on function kilo.claim_health_deletion_job() to service_role;

-- Complete a job. The deletion_pending -> withdrawn transition is allowed ONLY
-- when the gated set is verifiably empty for that user; a worker that thinks it
-- finished but left rows behind is recorded as failed and retried.
create or replace function kilo.complete_health_deletion_job(p_job_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_job kilo.health_data_deletion_jobs%rowtype;
  v_counts jsonb;
  v_remaining bigint := 0;
  v_key text;
begin
  select * into v_job from kilo.health_data_deletion_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'no such deletion job %', p_job_id using errcode = 'check_violation';
  end if;

  v_counts := kilo.health_data_row_counts(v_job.user_id);

  for v_key in select jsonb_object_keys(v_counts) loop
    v_remaining := v_remaining + (v_counts ->> v_key)::bigint;
  end loop;

  if v_remaining > 0 then
    update kilo.health_data_deletion_jobs set
      status = 'failed',
      last_error = format('%s scoped rows remain', v_remaining),
      table_counts = v_counts,
      updated_at = now()
    where id = p_job_id;

    return jsonb_build_object('ok', false, 'remaining', v_remaining, 'table_counts', v_counts);
  end if;

  update kilo.health_data_deletion_jobs set
    status = 'complete',
    table_counts = v_counts,
    completed_at = now(),
    updated_at = now()
  where id = p_job_id;

  -- Only a withdrawal reaches `withdrawn`. A quarantine purge is an operational
  -- remediation of Kilo's own lawful-basis defect, not a consent event, so it
  -- must not be recorded as if the user had withdrawn.
  update kilo.consent_state set
    status = case when status = 'deletion_pending' then 'withdrawn' else status end,
    cloud_data_deleted_at = now(),
    updated_at = now()
  where user_id = v_job.user_id;

  return jsonb_build_object('ok', true, 'remaining', 0, 'table_counts', v_counts);
end;
$$;

revoke all on function kilo.complete_health_deletion_job(uuid) from public, anon, authenticated;
grant execute on function kilo.complete_health_deletion_job(uuid) to service_role;

create or replace function kilo.fail_health_deletion_job(p_job_id uuid, p_error text)
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  update kilo.health_data_deletion_jobs set
    status = 'failed',
    -- Bounded and message-only: a purge error must never carry a health value
    -- into an operational log.
    last_error = left(coalesce(p_error, 'unknown'), 500),
    updated_at = now()
  where id = p_job_id;
$$;

revoke all on function kilo.fail_health_deletion_job(uuid, text) from public, anon, authenticated;
grant execute on function kilo.fail_health_deletion_job(uuid, text) to service_role;

-- Operator recovery for a wedged purge. This is deliberately the ONLY operator
-- path: it can re-enqueue the same idempotent job and verify the tables. It
-- cannot forge a grant, cannot move a user back to `granted`, and cannot bypass
-- the gate.
create or replace function kilo.reenqueue_health_deletion(p_user_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from kilo.health_data_deletion_jobs
  where user_id = p_user_id and status in ('pending', 'running', 'failed')
  order by created_at
  limit 1;

  if v_job_id is not null then
    update kilo.health_data_deletion_jobs set
      status = 'pending',
      last_error = null,
      updated_at = now()
    where id = v_job_id;
  else
    insert into kilo.health_data_deletion_jobs (user_id, reason)
    values (p_user_id, 'operator_reenqueue')
    returning id into v_job_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', v_job_id,
    'table_counts', kilo.health_data_row_counts(p_user_id)
  );
end;
$$;

revoke all on function kilo.reenqueue_health_deletion(uuid) from public, anon, authenticated;
grant execute on function kilo.reenqueue_health_deletion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Per-account quarantine
-- ---------------------------------------------------------------------------

-- Anchor a 30-day window at the FIRST recorded actionable notice, whichever comes
-- first: a successfully queued account notice, or the first denial seen by a
-- consent-capable client. The anchor is write-once (enforced by the trigger in
-- 20260714120001), so retrying a notice cannot extend the window and a user's
-- clock cannot silently restart.
create or replace function kilo.record_consent_notice(
  p_user_id uuid,
  p_trigger text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_state kilo.consent_state%rowtype;
  v_now timestamptz := now();
begin
  if p_trigger not in ('notice_sent', 'consent_capable_denial') then
    raise exception 'unsupported quarantine trigger %', p_trigger using errcode = 'check_violation';
  end if;

  select * into v_state from kilo.consent_state where user_id = p_user_id for update;
  if v_state.user_id is null then
    raise exception 'no consent state for user %', p_user_id using errcode = 'check_violation';
  end if;

  -- Record the notice fact regardless; it is evidence that Kilo reached out.
  update kilo.consent_state set
    consent_notice_sent_at = case
      when p_trigger = 'notice_sent' then coalesce(consent_notice_sent_at, v_now)
      else consent_notice_sent_at
    end,
    first_consent_denial_at = case
      when p_trigger = 'consent_capable_denial' then coalesce(first_consent_denial_at, v_now)
      else first_consent_denial_at
    end,
    -- Anchor the window only once.
    quarantine_started_at = coalesce(quarantine_started_at, v_now),
    quarantine_expires_at = coalesce(quarantine_expires_at, v_now + interval '30 days'),
    quarantine_trigger = coalesce(quarantine_trigger, p_trigger),
    updated_at = v_now
  where user_id = p_user_id
  returning * into v_state;

  return jsonb_build_object(
    'user_id', p_user_id,
    'quarantine_started_at', v_state.quarantine_started_at,
    'quarantine_expires_at', v_state.quarantine_expires_at,
    'quarantine_trigger', v_state.quarantine_trigger
  );
end;
$$;

revoke all on function kilo.record_consent_notice(uuid, text) from public, anon, authenticated;
grant execute on function kilo.record_consent_notice(uuid, text) to service_role;

-- Accounts that are quarantined but have NO recorded actionable notice. These
-- must be alerted on, never silently clock-started and never purged: purging a
-- user who was never actually told is the failure mode this whole window exists
-- to avoid.
create or replace function kilo.quarantine_accounts_without_notice()
  returns table (user_id uuid, status text, updated_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.user_id, s.status, s.updated_at
  from kilo.consent_state s
  where s.status in ('needs_reconsent', 'withdrawn')
    and s.quarantine_started_at is null;
$$;

revoke all on function kilo.quarantine_accounts_without_notice() from public, anon, authenticated;
grant execute on function kilo.quarantine_accounts_without_notice() to service_role;

-- Enqueue a purge for every account whose OWN window has expired and that still
-- lacks a current grant. Purge arming is a separate flag from the gate mode, so a
-- gate defect can be paused without risking mass deletion.
create or replace function kilo.enqueue_expired_quarantine_purges()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_cfg kilo.health_sync_config%rowtype;
  v_count integer := 0;
begin
  select * into v_cfg from kilo.health_sync_config where id = true;

  -- Fail closed: no purge unless the gate is live AND purge is separately armed.
  if v_cfg.id is null
     or v_cfg.mode <> 'consent_required'
     or not v_cfg.purge_enabled then
    return 0;
  end if;

  insert into kilo.health_data_deletion_jobs (user_id, reason)
  select s.user_id, 'quarantine_expiry'
  from kilo.consent_state s
  where s.quarantine_expires_at is not null
    and s.quarantine_expires_at <= now()
    and (
      s.status <> 'granted'
      or s.current_material_version is null
      or s.current_material_version < v_cfg.required_material_version
    )
  on conflict (user_id) where status in ('pending', 'running') do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function kilo.enqueue_expired_quarantine_purges() from public, anon, authenticated;
grant execute on function kilo.enqueue_expired_quarantine_purges() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Evidence retention
-- ---------------------------------------------------------------------------

-- Delete each archive row at its own six-year expiry, then mark any key version
-- that no unexpired archive still references as destroyable.
--
-- Marking is not destroying: the key material lives outside the database, so the
-- worker records WHEN a version became eligible and the operator destroys it. A
-- key lost before its archives expire is an integrity incident (the evidence
-- becomes unverifiable), which is why availability is monitored and destruction
-- is explicit rather than implicit.
create or replace function kilo.evidence_retention_sweep()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_expired integer;
  v_destroyable text[];
begin
  delete from kilo.consent_evidence_archive where expires_at <= now();
  get diagnostics v_expired = row_count;

  -- A retired key version stays recoverable for as long as ANY archive row still
  -- references it; rotation must never invalidate evidence. Only once the last
  -- referencing row has expired does the version become destroyable.
  with destroyed as (
    update kilo.consent_evidence_key k set
      destroyed_at = now()
    where k.destroyed_at is null
      and k.retired_at is not null
      and not exists (
        select 1 from kilo.consent_evidence_archive a
        where a.evidence_key_id = k.evidence_key_id
      )
    returning k.evidence_key_id
  )
  select coalesce(array_agg(evidence_key_id), '{}'::text[]) into v_destroyable from destroyed;

  return jsonb_build_object(
    'archives_expired', v_expired,
    'keys_marked_destroyable', coalesce(array_length(v_destroyable, 1), 0),
    -- Surfaced so the operator knows exactly which key material to destroy
    -- outside the database. Key ids are not secrets; the key material is.
    'destroyable_key_ids', to_jsonb(v_destroyable)
  );
end;
$$;

revoke all on function kilo.evidence_retention_sweep() from public, anon, authenticated;
grant execute on function kilo.evidence_retention_sweep() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Schedules
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;

-- Retry incomplete purges. The worker itself is the health-data-delete Edge
-- Function; this schedule re-opens failed jobs so a wedged or partially applied
-- delete is retried until the gated set is verifiably empty.
select cron.schedule(
  'health-deletion-retry',
  '*/10 * * * *',
  $cron$
    update kilo.health_data_deletion_jobs set status = 'pending', updated_at = now()
    where status = 'failed' and attempts < 50;
    -- A job stuck in `running` past a generous ceiling means the worker died
    -- mid-flight. The delete is idempotent, so retrying is always safe.
    update kilo.health_data_deletion_jobs set status = 'pending', updated_at = now()
    where status = 'running' and updated_at < now() - interval '30 minutes';
  $cron$
);

-- Per-account quarantine expiry. No-ops entirely until purge is separately armed.
select cron.schedule(
  'health-quarantine-purge-enqueue',
  '17 * * * *',
  'select kilo.enqueue_expired_quarantine_purges()'
);

-- Six-year evidence expiry.
select cron.schedule(
  'consent-evidence-retention',
  '23 3 * * *',
  'select kilo.evidence_retention_sweep()'
);
