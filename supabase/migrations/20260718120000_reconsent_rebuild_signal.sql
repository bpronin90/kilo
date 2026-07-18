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
-- `consent_state.cloud_rebuild_generation` is that signal, and it is a
-- MONOTONIC COUNTER rather than a single global boolean flag on purpose. Every
-- verified-zero purge (kilo.complete_health_deletion_job) bumps it by one. Each
-- device persists, locally, the generation it has itself rebuilt for (see
-- storage/entries/localDataOwner.js), and rebuilds whenever the server's
-- generation is ahead of its own. Completion is therefore PER DEVICE and never
-- a single server-side "done" flag that the first device to sync would clear
-- for every other device — so two of the account's devices, each holding their
-- own complete local copy, both rebuild and converge through the ordinary LWW
-- merge, instead of the first one that happens to sync silencing the rest.
-- A brand-new account sits at generation 0 forever until a purge, and a device
-- that has never seen a purge also sits at 0, so first-grant is never a rebuild.

-- The counter starts at 0 (never purged). cloud_rebuild_armed_at is a
-- diagnostics-only record of when the most recent purge bumped it; the client
-- never reads it (the counter is the authority), it exists so an operator can
-- see when an account was last armed.
alter table kilo.consent_state
  add column if not exists cloud_rebuild_generation integer not null default 0,
  add column if not exists cloud_rebuild_armed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. Bump the generation whenever a purge verifiably empties the gated set
-- ---------------------------------------------------------------------------
--
-- Every completed deletion job — withdrawal, quarantine expiry, or an operator
-- re-enqueue — empties the exact same gated set kilo.health_data_row_counts
-- checks, so all three can leave a device holding local history the cloud no
-- longer has. Bumping unconditionally on verified-zero completion, regardless
-- of reason or the account's prior status, is what makes the signal correct
-- for all of them: whichever grant comes next, on whichever device, must
-- rebuild until that device records it has caught up to this generation.
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
    -- empty cloud copy. The counter is monotonic, so a second purge later bumps
    -- it again and every device rebuilds again.
    cloud_rebuild_generation = cloud_rebuild_generation + 1,
    cloud_rebuild_armed_at = now(),
    updated_at = now()
  where user_id = v_job.user_id;

  return jsonb_build_object('ok', true, 'remaining', 0, 'table_counts', v_counts);
end;
$$;

revoke all on function kilo.complete_health_deletion_job(uuid) from public, anon, authenticated;
grant execute on function kilo.complete_health_deletion_job(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Surface the generation on grant and on preflight
-- ---------------------------------------------------------------------------
--
-- The client submits only the catalog revision; the server resolves and
-- returns whatever else it needs to know, including now the current rebuild
-- generation so the client can compare it against the generation this device
-- last rebuilt for. Identical body to the #487 migration except for
-- `v_rebuild_generation` and the extra return field. A grant NEVER resets the
-- counter: only a purge advances it, and only the client's own per-device
-- bookkeeping records that it has caught up.
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
  v_rebuild_generation integer;
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
    -- never cloud_rebuild_generation — a completed-purge rebuild is tracked
    -- per-device by the client, not cleared by re-granting.
    withdrawn_at = null,
    cloud_data_deleted_at = null,
    updated_at = now()
  returning cloud_rebuild_generation into v_rebuild_generation;

  return jsonb_build_object(
    'ok', true,
    'grant_event_id', v_event_id,
    'catalog_revision', v_rev.catalog_revision,
    'material_version', v_rev.material_version,
    'copy_sha256', v_rev.copy_sha256,
    'status', 'granted',
    'cloud_rebuild_generation', coalesce(v_rebuild_generation, 0)
  );
end;
$$;

revoke all on function kilo.consent_grant(integer, text, text, text) from public, anon;
grant execute on function kilo.consent_grant(integer, text, text, text) to authenticated;

-- Identical body to the #487 migration except for the `cloud_rebuild_generation`
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
      'cloud_rebuild_generation', coalesce(v_state.cloud_rebuild_generation, 0)
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
    'cloud_rebuild_generation', coalesce(v_state.cloud_rebuild_generation, 0)
  );
end;
$$;

grant execute on function kilo.health_sync_preflight() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. No server-side completion RPC
-- ---------------------------------------------------------------------------
--
-- There is deliberately no kilo.consent_rebuild_complete(): completion is a
-- PER-DEVICE fact, recorded in each device's own local storage once its own
-- rebuild AND reconciliation pass have succeeded. A single server-side "done"
-- flag cleared by the first device to finish would tell every other device —
-- each of which may hold its own, differently-complete local copy — that no
-- rebuild is needed, which is exactly the multi-device gap this counter design
-- avoids. Retryability across a crash mid-rebuild comes for free: the device's
-- persisted generation only advances after a fully successful rebuild, so a
-- crash before that leaves it behind the server's generation and it rebuilds
-- again on the next launch.
