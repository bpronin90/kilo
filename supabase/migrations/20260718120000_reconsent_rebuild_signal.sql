-- Rebuild the cloud copy after a completed withdrawal purge and re-consent (#538).
--
-- #492 qualified this production lifecycle: a granted account withdraws, the
-- deletion worker verifiably empties the gated set and reaches `withdrawn`,
-- the SAME device keeps its complete local copy and later grants again — and
-- ordinary sync has nothing to push. The device's dirty queue is already empty
-- (everything it holds was already acknowledged by the server before
-- withdrawal) and the diff-tracked tables' last-synced snapshots already agree
-- with what is now an intentionally empty cloud copy, so the diff engine sees
-- no local change. Production therefore ends up with a granted account whose
-- local copy is complete and whose cloud copy is not.
--
-- The fix cannot be "the client notices the cloud is empty and re-uploads
-- everything": a brand-new account also has an empty cloud copy on its first
-- ever grant, and must not be told to rebuild data it never had. The signal
-- has to come from the server, which is the only party that knows whether the
-- account's gated set was ever verifiably purged.
--
-- `consent_state.cloud_rebuild_required` is that signal. It is armed the
-- moment a deletion job verifies zero rows (kilo.complete_health_deletion_job)
-- and cleared only when the client explicitly confirms its own rebuild and
-- reconciliation pass succeeded (kilo.consent_rebuild_complete). Between those
-- two events, every preflight and every grant tells the client the truth: the
-- next sync must be a full, local-authoritative rebuild, not an ordinary pass.

alter table kilo.consent_state
  add column if not exists cloud_rebuild_required boolean not null default false,
  add column if not exists cloud_rebuild_armed_at timestamptz,
  add column if not exists cloud_rebuild_completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. Arm the signal whenever a purge verifiably empties the gated set
-- ---------------------------------------------------------------------------
--
-- Every completed deletion job — withdrawal, quarantine expiry, or an operator
-- re-enqueue — empties the exact same gated set kilo.health_data_row_counts
-- checks, so all three can leave a device holding local history the cloud no
-- longer has. Arming unconditionally on verified-zero completion, regardless
-- of reason or the account's prior status, is what makes the signal correct
-- for all of them: whichever grant comes next must rebuild.
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
      next_attempt_at = now() + kilo.health_deletion_backoff(v_job.attempts),
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
    -- Any later grant on any device that still holds this account's local
    -- history must rebuild the cloud copy from local state rather than trust
    -- dirty-queue/diff-snapshot bookkeeping against what is now a verified-
    -- empty cloud copy.
    cloud_rebuild_required = true,
    cloud_rebuild_armed_at = now(),
    updated_at = now()
  where user_id = v_job.user_id;

  return jsonb_build_object('ok', true, 'remaining', 0, 'table_counts', v_counts);
end;
$$;

revoke all on function kilo.complete_health_deletion_job(uuid) from public, anon, authenticated;
grant execute on function kilo.complete_health_deletion_job(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Surface the signal on grant and on preflight
-- ---------------------------------------------------------------------------
--
-- The client submits only the catalog revision; the server resolves and
-- returns whatever else it needs to know, including now whether this grant
-- must be followed by a full rebuild. Identical body to the #487 migration
-- except for `v_rebuild_required` and the extra return field.
create or replace function kilo.consent_grant(
  p_catalog_revision integer,
  p_app_version text default null,
  p_platform text default null,
  p_surface text default 'cloud_sync_enablement'
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid;
  v_rev kilo.consent_revision%rowtype;
  v_state kilo.consent_state%rowtype;
  v_event_id uuid;
  v_rebuild_required boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_rev
  from kilo.consent_revision
  where catalog_revision = p_catalog_revision and status = 'active';

  if v_rev.catalog_revision is null then
    raise exception 'consent revision % is not an active catalog revision', p_catalog_revision
      using errcode = 'check_violation';
  end if;

  -- Lock the state row so two concurrent grants cannot interleave and leave the
  -- ledger and the keyed state disagreeing.
  select * into v_state from kilo.consent_state where user_id = v_uid for update;

  -- A purge is in flight. Re-granting now would race the deletion worker and
  -- could leave the user "granted" over a half-deleted dataset.
  if v_state.user_id is not null and v_state.status = 'deletion_pending' then
    raise exception 'health data deletion is pending'
      using errcode = 'check_violation', detail = 'HEALTH_DATA_DELETION_PENDING';
  end if;

  insert into kilo.consent_events (
    user_id, event_type, catalog_revision, material_version, copy_sha256,
    surface, app_version, platform
  ) values (
    v_uid, 'granted', v_rev.catalog_revision, v_rev.material_version, v_rev.copy_sha256,
    p_surface, p_app_version, p_platform
  )
  returning id into v_event_id;

  insert into kilo.consent_state as s (
    user_id, status, current_catalog_revision, current_material_version,
    current_grant_event_id, granted_at, updated_at
  ) values (
    v_uid, 'granted', v_rev.catalog_revision, v_rev.material_version,
    v_event_id, now(), now()
  )
  on conflict (user_id) do update set
    status = 'granted',
    current_catalog_revision = excluded.current_catalog_revision,
    current_material_version = excluded.current_material_version,
    current_grant_event_id = excluded.current_grant_event_id,
    granted_at = excluded.granted_at,
    -- A fresh grant clears the prior withdrawal, but never the quarantine anchor
    -- (that anchor is the record of when this account was actually notified) and
    -- never cloud_rebuild_required — a completed-purge rebuild is only cleared by
    -- kilo.consent_rebuild_complete(), once the client's own upload has run.
    withdrawn_at = null,
    cloud_data_deleted_at = null,
    updated_at = now()
  returning cloud_rebuild_required into v_rebuild_required;

  return jsonb_build_object(
    'ok', true,
    'grant_event_id', v_event_id,
    'catalog_revision', v_rev.catalog_revision,
    'material_version', v_rev.material_version,
    'copy_sha256', v_rev.copy_sha256,
    'status', 'granted',
    'cloud_rebuild_required', coalesce(v_rebuild_required, false)
  );
end;
$$;

revoke all on function kilo.consent_grant(integer, text, text, text) from public, anon;
grant execute on function kilo.consent_grant(integer, text, text, text) to authenticated;

-- Identical body to the #487 migration except for the `cloud_rebuild_required`
-- field folded into both `allowed: true` payloads, so the client learns it on
-- every preflight — not only the exact one immediately after granting — which
-- is what keeps the signal reliable across an app restart mid-rebuild.
create or replace function kilo.health_sync_preflight()
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_cfg kilo.health_sync_config%rowtype;
  v_state kilo.consent_state%rowtype;
  v_uid uuid;
  v_protocol integer;
  v_revision integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'code', 'UNAUTHORIZED');
  end if;

  select * into v_cfg from kilo.health_sync_config where id = true;
  if v_cfg.id is null or v_cfg.mode = 'paused' then
    return jsonb_build_object('allowed', false, 'code', 'HEALTH_SYNC_PAUSED');
  end if;

  select catalog_revision into v_revision
  from kilo.consent_revision
  where status = 'active' and material_version = v_cfg.required_material_version
  order by catalog_revision desc
  limit 1;

  select * into v_state from kilo.consent_state where user_id = v_uid;

  -- A pending purge outranks every other code: the user cannot re-grant, and the
  -- client must not offer them a sync toggle that would silently do nothing.
  if v_state.user_id is not null and v_state.status = 'deletion_pending' then
    return jsonb_build_object('allowed', false, 'code', 'HEALTH_DATA_DELETION_PENDING');
  end if;

  if v_cfg.mode = 'legacy' then
    return jsonb_build_object(
      'allowed', true,
      'code', 'OK',
      'mode', v_cfg.mode,
      'required_material_version', v_cfg.required_material_version,
      'active_catalog_revision', v_revision,
      'cloud_rebuild_required', coalesce(v_state.cloud_rebuild_required, false)
    );
  end if;

  if v_cfg.minimum_consent_protocol_version > 0 then
    v_protocol := kilo.client_consent_protocol_version();
    if v_protocol is null or v_protocol < v_cfg.minimum_consent_protocol_version then
      return jsonb_build_object(
        'allowed', false,
        'code', 'CLIENT_UPDATE_REQUIRED',
        'minimum_consent_protocol_version', v_cfg.minimum_consent_protocol_version
      );
    end if;
  end if;

  if v_state.user_id is null
     or v_state.status in ('withdrawn', 'needs_reconsent')
     or v_state.current_material_version is null then
    return jsonb_build_object(
      'allowed', false,
      -- A user who never granted, and one whose grant predates a scope change,
      -- are told apart so the app can explain WHY it is asking again.
      'code', case
        when v_state.user_id is not null and v_state.status = 'needs_reconsent'
          then 'CONSENT_VERSION_STALE'
        else 'CONSENT_REQUIRED'
      end,
      'required_material_version', v_cfg.required_material_version,
      'active_catalog_revision', v_revision,
      'quarantine_expires_at', v_state.quarantine_expires_at
    );
  end if;

  if v_state.status = 'granted'
     and v_state.current_material_version < v_cfg.required_material_version then
    return jsonb_build_object(
      'allowed', false,
      'code', 'CONSENT_VERSION_STALE',
      'required_material_version', v_cfg.required_material_version,
      'granted_material_version', v_state.current_material_version,
      'active_catalog_revision', v_revision
    );
  end if;

  if v_state.status <> 'granted' then
    return jsonb_build_object('allowed', false, 'code', 'CONSENT_REQUIRED');
  end if;

  return jsonb_build_object(
    'allowed', true,
    'code', 'OK',
    'mode', v_cfg.mode,
    'required_material_version', v_cfg.required_material_version,
    'active_catalog_revision', v_revision,
    'cloud_rebuild_required', coalesce(v_state.cloud_rebuild_required, false)
  );
end;
$$;

grant execute on function kilo.health_sync_preflight() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Client acknowledgement that the rebuild (and its reconciliation pass)
--    succeeded
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT folded into consent_grant: the grant records only the
-- affirmative act, before any upload has run. Clearing the signal here, only
-- once the client's own rebuild has actually completed, is what keeps a crash
-- between grant and rebuild retryable — the flag (and therefore the "this
-- account needs a full rebuild" fact) stays armed across restart until a
-- client explicitly confirms it finished. Idempotent: a second call after the
-- flag is already clear is not an error, it just reports `already: true`, so a
-- retried confirmation (e.g. a duplicated request after a flaky response)
-- cannot fail the phase it just succeeded at.
create or replace function kilo.consent_rebuild_complete()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid uuid;
  v_state kilo.consent_state%rowtype;
  v_already boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_state from kilo.consent_state where user_id = v_uid for update;
  if v_state.user_id is null or v_state.status <> 'granted' then
    raise exception 'no active grant to complete a cloud rebuild for'
      using errcode = 'check_violation', detail = 'NOT_GRANTED';
  end if;

  v_already := not v_state.cloud_rebuild_required;

  update kilo.consent_state set
    cloud_rebuild_required = false,
    cloud_rebuild_completed_at = now(),
    updated_at = now()
  where user_id = v_uid;

  return jsonb_build_object('ok', true, 'cloud_rebuild_required', false, 'already', v_already);
end;
$$;

revoke all on function kilo.consent_rebuild_complete() from public, anon;
grant execute on function kilo.consent_rebuild_complete() to authenticated;
