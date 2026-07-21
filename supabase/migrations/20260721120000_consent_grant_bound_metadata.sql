-- Bound and throttle client metadata accepted by consent_grant (issue #597).
--
-- Follow-up to #572 claim 13. kilo.consent_grant accepts caller-supplied
-- p_app_version, p_platform, and p_surface and writes them verbatim into the
-- append-only kilo.consent_events ledger. Until this migration those three
-- fields had no size, character, or enum constraint, and a granted caller could
-- re-affirm the same active revision in a tight loop, so an authenticated client
-- could append unbounded, abusive text to an immutable evidence table at will.
--
-- This migration closes exactly that, and nothing wider:
--
--   1. Explicit length + character/enum CHECK constraints on the three
--      client-supplied ledger columns. The constraints live on the TABLE, so
--      they bound every write path (the RPC, and any service-role insert),
--      which keeps the server-derived evidence columns authoritative regardless
--      of how a row is authored.
--   2. A per-user throttle on REDUNDANT re-affirmations only. A grant that
--      genuinely transitions state -- a first grant, a re-grant after
--      withdrawal, or a re-consent to a different catalog revision or material
--      version -- is never throttled. Only a caller who is already granted at
--      the exact same catalog revision and material version, i.e. one appending
--      no-op duplicates, is rate limited. Legitimate re-consent transitions are
--      therefore never blocked.
--
-- The accepted client contract is unchanged: the shipping client sends
-- p_app_version like '0.98.3', p_platform in (ios, android, web), and defaults
-- p_surface to 'cloud_sync_enablement' -- all of which satisfy the constraints
-- below. Existing valid clients keep a compatible path.

-- ---------------------------------------------------------------------------
-- 1. Length + character/enum bounds on the client-supplied ledger columns
-- ---------------------------------------------------------------------------
--
-- app_version is an open-ended client build string, so it is bounded by length
-- and a conservative character class (digits, letters, and the punctuation that
-- appears in semver / build identifiers) rather than an enum. platform and
-- surface are closed vocabularies. platform enumerates the real React Native
-- Platform.OS values the client can send. surface is a lowercase slug: the only
-- value in use is the server default 'cloud_sync_enablement', and the slug form
-- both matches it and bounds any future surface without another unbounded text
-- field. NULLs remain allowed for the two optional columns exactly as before.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'consent_events_app_version_bounds'
      and conrelid = 'kilo.consent_events'::regclass
  ) then
    alter table kilo.consent_events
      add constraint consent_events_app_version_bounds
      check (
        app_version is null
        or (char_length(app_version) between 1 and 32
            and app_version ~ '^[0-9A-Za-z][0-9A-Za-z.+_-]*$')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'consent_events_platform_enum'
      and conrelid = 'kilo.consent_events'::regclass
  ) then
    alter table kilo.consent_events
      add constraint consent_events_platform_enum
      check (
        platform is null
        or platform in ('ios', 'android', 'web', 'macos', 'windows')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'consent_events_surface_bounds'
      and conrelid = 'kilo.consent_events'::regclass
  ) then
    alter table kilo.consent_events
      add constraint consent_events_surface_bounds
      check (
        char_length(surface) between 1 and 64
        and surface ~ '^[a-z][a-z0-9_]*$'
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Throttle redundant re-affirmations; genuine transitions bypass
-- ---------------------------------------------------------------------------
--
-- Body is identical to the #538 redefinition (20260718120000) -- same signature,
-- same server-authoritative resolution of wording/digest/material version, same
-- cloud_rebuild_generation surfacing -- with one addition: before appending a
-- ledger row, classify the grant as a genuine state transition or a redundant
-- re-affirmation of the identical granted state, and rate limit only the latter.
-- The throttle reuses kilo.rate_limit_check (the same atomic, cross-isolate
-- windowed limiter used by the export/delete Edge Functions); consent_grant is
-- SECURITY DEFINER and its owner owns that helper, so the internal call is
-- authorized without widening any end-user grant.
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
  v_is_transition boolean;
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

  -- A genuine transition is a first grant, a re-grant after a non-granted state
  -- (withdrawn / needs_reconsent), or a move to a different catalog revision or
  -- material version. Those are legitimate re-consent acts and are NEVER
  -- throttled. Only a re-affirmation of the identical already-granted state --
  -- which appends a no-op duplicate to the append-only ledger -- is bounded.
  v_is_transition :=
       v_state.user_id is null
    or v_state.status is distinct from 'granted'
    or v_state.current_catalog_revision is distinct from v_rev.catalog_revision
    or v_state.current_material_version is distinct from v_rev.material_version;

  if not v_is_transition then
    -- Up to 3 redundant re-affirmations per minute per user absorb a double-tap
    -- or a client retry burst; beyond that the caller is spamming the ledger and
    -- is refused. The window is short and per-user, so it can never affect
    -- another account or a real re-consent transition.
    if not kilo.rate_limit_check('consent_grant:' || v_uid::text, 3, 60000) then
      raise exception 'consent grant re-affirmation throttled'
        using errcode = 'check_violation', detail = 'CONSENT_GRANT_THROTTLED';
    end if;
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
    -- never cloud_rebuild_generation -- a completed-purge rebuild is tracked
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
