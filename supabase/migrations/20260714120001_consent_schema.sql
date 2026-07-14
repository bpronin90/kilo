-- GDPR Art. 9(2)(a) explicit-consent record and backend gate (issue #487).
--
-- Kilo stores data concerning health in the cloud and, until this migration, had
-- no demonstrable consent record at all: a client-side sync flag is not evidence
-- under Art. 7(1). This migration makes the backend the authorization boundary.
--
-- Four tables carry the record:
--
--   consent_revision  immutable catalog of exactly what was rendered to a user
--   consent_events    append-only grant/withdrawal ledger
--   consent_state     one keyed row per user, so authorization is an indexed
--                     lookup and never a scan of the event history
--   consent_evidence_* pseudonymized archive that survives account deletion
--
-- Two versions are tracked separately and must not be conflated:
--
--   catalog_revision   bumps on ANY rendered change, including editorial fixes
--   material_version   bumps only when the SCOPE of what the user agreed to
--                      changes (new category, new purpose, new processor, ...)
--
-- Enforcement compares material versions only. An editorial typo fix therefore
-- creates a new immutable revision (preserving proof of what each user actually
-- saw) without invalidating anyone's grant. A scope change sets requires_reconsent
-- and blocks sync until a fresh affirmative act.
--
-- The gate is fail-closed: an unknown mode, a missing config row, or a missing
-- state row all deny.

-- ---------------------------------------------------------------------------
-- 1. Server configuration (the kill switch)
-- ---------------------------------------------------------------------------

create table if not exists kilo.health_sync_config (
  id boolean primary key default true,
  -- legacy: gate off, pre-cutover. paused: fail closed, no health sync at all,
  -- no deletion. consent_required: the gate is live.
  mode text not null default 'legacy',
  required_material_version integer not null default 1,
  -- Clients below this consent protocol version cannot reach health sync. 0
  -- means "no protocol floor", which is the pre-cutover value.
  minimum_consent_protocol_version integer not null default 0,
  -- Purge arming is deliberately SEPARATE from the gate so a gate defect can be
  -- paused without risking mass deletion of users' cloud health data.
  purge_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint health_sync_config_singleton check (id),
  constraint health_sync_config_mode check (mode in ('legacy', 'paused', 'consent_required'))
);

insert into kilo.health_sync_config (id) values (true) on conflict (id) do nothing;

alter table kilo.health_sync_config enable row level security;
-- No policies: the config is service-role only. `authenticated` reaches the
-- values it legitimately needs through kilo.health_sync_preflight().
grant all on kilo.health_sync_config to service_role;

-- ---------------------------------------------------------------------------
-- 2. Immutable consent-revision catalog
-- ---------------------------------------------------------------------------

create table if not exists kilo.consent_revision (
  catalog_revision integer primary key,
  material_version integer not null,
  requires_reconsent boolean not null default false,
  status text not null default 'draft',
  controller_identity text not null,
  purpose text not null,
  health_data_categories jsonb not null,
  processor text not null,
  consent_title text not null,
  disclosure_copy text not null,
  affirmation_copy text not null,
  privacy_policy_revision text not null,
  privacy_policy_url text not null,
  -- sha256 of consent_title || E'\n\n' || disclosure_copy || E'\n\n' ||
  -- affirmation_copy, UTF-8, no trailing newline. The client renders the same
  -- three strings and a test asserts it hashes to this value, so a copy drift
  -- between app and catalog is a test failure rather than a silent evidence gap.
  copy_sha256 text not null,
  effective_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint consent_revision_status check (status in ('draft', 'active', 'retired')),
  constraint consent_revision_sha check (copy_sha256 ~ '^[0-9a-f]{64}$')
);

-- Immutability. An active or retired revision is evidence: it is the proof of
-- what a specific user was shown at a specific time. Corrections create a new
-- revision; they never edit history.
create or replace function kilo.consent_revision_immutable()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'consent_revision % is immutable (status %)', old.catalog_revision, old.status
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'draft' then
    return new;
  end if;

  -- The only legal transition on a published revision is active -> retired.
  if old.status = 'active' and new.status = 'retired'
     and new.catalog_revision   = old.catalog_revision
     and new.material_version   = old.material_version
     and new.controller_identity = old.controller_identity
     and new.purpose            = old.purpose
     and new.health_data_categories::text = old.health_data_categories::text
     and new.processor          = old.processor
     and new.consent_title      = old.consent_title
     and new.disclosure_copy    = old.disclosure_copy
     and new.affirmation_copy   = old.affirmation_copy
     and new.privacy_policy_revision = old.privacy_policy_revision
     and new.privacy_policy_url = old.privacy_policy_url
     and new.copy_sha256        = old.copy_sha256
     and new.effective_at       is not distinct from old.effective_at
  then
    return new;
  end if;

  raise exception 'consent_revision % is immutable once published', old.catalog_revision
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists consent_revision_immutable on kilo.consent_revision;
create trigger consent_revision_immutable
  before update or delete on kilo.consent_revision
  for each row execute function kilo.consent_revision_immutable();

alter table kilo.consent_revision enable row level security;

-- Users may read the active catalog so the app can render the surface and cite
-- the revision it is about to record. They can never write it: the wording,
-- purpose, categories, processor, and digest are all server-owned.
create policy "consent_revision_select_active" on kilo.consent_revision
  for select to authenticated using (status = 'active');

grant select on kilo.consent_revision to authenticated;
grant all on kilo.consent_revision to service_role;

-- Seed revision 1 / material version 1 with the exact approved copy from
-- docs/article-9-explicit-consent-spec.md. Nothing here may be reworded in
-- implementation.
insert into kilo.consent_revision (
  catalog_revision,
  material_version,
  requires_reconsent,
  status,
  controller_identity,
  purpose,
  health_data_categories,
  processor,
  consent_title,
  disclosure_copy,
  affirmation_copy,
  privacy_policy_revision,
  privacy_policy_url,
  copy_sha256,
  effective_at
) values (
  1,
  1,
  false,
  'active',
  'Ben Pronin (Kilo)',
  'Cross-device synchronization of Kilo health data',
  jsonb_build_array(
    'body-weight entries',
    'current and archived weight goals',
    'tracked lifts and workout notes',
    'deload notes and history, and fatigue-tracking data'
  ),
  'Supabase',
  'Store health data in the cloud?',
  E'Cloud Sync stores the following health and fitness data in Kilo''s Supabase-hosted cloud database in the United States so Kilo can sync it across your devices:\n\n- body-weight entries\n- current and archived weight goals\n- tracked lifts and workout notes\n- deload notes and history, and fatigue-tracking data\n\nYou can keep using Kilo locally if you do not consent. You can withdraw at any time by turning off Cloud Sync. Kilo will then stop cloud processing and delete the cloud copy while keeping your on-device data. Supabase processes the data for Kilo under EU Standard Contractual Clauses. Kilo keeps a minimal pseudonymized record of your consent choices for six years after account deletion to demonstrate compliance; that record contains no health entries, notes, or measurements.',
  'I explicitly consent to Kilo storing the health and fitness data listed above in its United States cloud database for cross-device sync.',
  '2026-07-13',
  'https://bpronin90.github.io/kilo/privacy.html',
  '4a4eb51eea8df80e1eec7355f3c44a1dd06705583a64841061aa24d5788396fa',
  now()
) on conflict (catalog_revision) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Append-only consent events
-- ---------------------------------------------------------------------------

create table if not exists kilo.consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  catalog_revision integer not null references kilo.consent_revision (catalog_revision),
  material_version integer not null,
  copy_sha256 text not null,
  grant_event_id uuid references kilo.consent_events (id),
  surface text not null,
  app_version text,
  platform text,
  -- Database-generated. The client never supplies a consent timestamp.
  occurred_at timestamptz not null default now(),
  constraint consent_events_type check (event_type in ('granted', 'withdrawn')),
  -- A withdrawal must name the grant it withdraws.
  constraint consent_events_withdrawal_links_grant
    check (event_type <> 'withdrawn' or grant_event_id is not null)
);

create index if not exists consent_events_user_occurred_idx
  on kilo.consent_events (user_id, occurred_at desc);

create or replace function kilo.consent_events_append_only()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'kilo.consent_events is append-only'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists consent_events_append_only on kilo.consent_events;
create trigger consent_events_append_only
  before update or delete on kilo.consent_events
  for each row execute function kilo.consent_events_append_only();

alter table kilo.consent_events enable row level security;

-- Read-own only. Writes go exclusively through the server-owned grant/withdraw
-- operations below, which resolve the canonical catalog row themselves. There is
-- deliberately no INSERT policy: a user cannot author their own evidence.
create policy "consent_events_select_own" on kilo.consent_events
  for select to authenticated using (user_id = (select auth.uid()));

grant select on kilo.consent_events to authenticated;
grant all on kilo.consent_events to service_role;

-- ---------------------------------------------------------------------------
-- 4. Keyed current state
-- ---------------------------------------------------------------------------

create table if not exists kilo.consent_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null,
  current_catalog_revision integer references kilo.consent_revision (catalog_revision),
  current_material_version integer,
  current_grant_event_id uuid references kilo.consent_events (id),
  granted_at timestamptz,
  withdrawn_at timestamptz,
  cloud_data_deleted_at timestamptz,
  -- Per-account remediation window for the existing-user cutover. Each window is
  -- anchored ONCE, at the first recorded actionable notice, and never reset;
  -- there is no global purge date.
  consent_notice_sent_at timestamptz,
  first_consent_denial_at timestamptz,
  quarantine_started_at timestamptz,
  quarantine_expires_at timestamptz,
  quarantine_trigger text,
  updated_at timestamptz not null default now(),
  constraint consent_state_status
    check (status in ('granted', 'withdrawn', 'needs_reconsent', 'deletion_pending')),
  constraint consent_state_quarantine_trigger
    check (quarantine_trigger is null or quarantine_trigger in ('notice_sent', 'consent_capable_denial')),
  -- The window is immutable in shape: a start implies an expiry and a trigger.
  constraint consent_state_quarantine_complete
    check ((quarantine_started_at is null and quarantine_expires_at is null and quarantine_trigger is null)
        or (quarantine_started_at is not null and quarantine_expires_at is not null and quarantine_trigger is not null))
);

create index if not exists consent_state_quarantine_expiry_idx
  on kilo.consent_state (quarantine_expires_at)
  where quarantine_expires_at is not null;

-- The quarantine anchor is write-once. Re-anchoring it would silently extend a
-- user's exposure window every time a notice was retried.
create or replace function kilo.consent_state_quarantine_immutable()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.quarantine_started_at is not null
     and new.quarantine_started_at is distinct from old.quarantine_started_at then
    raise exception 'quarantine_started_at is write-once for user %', old.user_id
      using errcode = 'check_violation';
  end if;
  if old.quarantine_expires_at is not null
     and new.quarantine_expires_at is distinct from old.quarantine_expires_at then
    raise exception 'quarantine_expires_at is write-once for user %', old.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists consent_state_quarantine_immutable on kilo.consent_state;
create trigger consent_state_quarantine_immutable
  before update on kilo.consent_state
  for each row execute function kilo.consent_state_quarantine_immutable();

alter table kilo.consent_state enable row level security;

-- Read-own only. No INSERT/UPDATE/DELETE policy exists, so a user cannot forge a
-- grant, a material version, a timestamp, or a quarantine expiry.
create policy "consent_state_select_own" on kilo.consent_state
  for select to authenticated using (user_id = (select auth.uid()));

grant select on kilo.consent_state to authenticated;
grant all on kilo.consent_state to service_role;

-- ---------------------------------------------------------------------------
-- 5. Pseudonymized evidence archive and versioned key lifecycle
-- ---------------------------------------------------------------------------

-- Key METADATA only. The HMAC key material itself lives outside the database (an
-- Edge Function secret), so a database dump does not re-identify the archive.
-- The archive stays pseudonymized personal data for as long as a key version
-- exists; it is not anonymized, and this table is what lets the retention worker
-- prove when a key version may finally be destroyed.
create table if not exists kilo.consent_evidence_key (
  evidence_key_id text primary key,
  created_at timestamptz not null default now(),
  -- Rotated out of use for NEW archives, but still required to verify existing
  -- ones. Rotation must never invalidate evidence.
  retired_at timestamptz,
  -- Set only after the last referencing archive row and any retained backup have
  -- expired. Recording it here is what makes destruction auditable.
  destroyed_at timestamptz
);

create table if not exists kilo.consent_evidence_archive (
  id uuid primary key default gen_random_uuid(),
  -- HMAC-SHA-256(user_id) under the referenced key version. No user UUID, no
  -- email, no device id, no IP.
  subject_hmac text not null,
  evidence_key_id text not null references kilo.consent_evidence_key (evidence_key_id),
  catalog_revision integer not null,
  material_version integer not null,
  copy_sha256 text not null,
  -- [{ "event_type": "granted", "occurred_at": "..." }, ...] — types and server
  -- timestamps only. No health payload and no free text may ever be written here.
  consent_events jsonb not null,
  withdrawn_at timestamptz,
  cloud_data_deleted_at timestamptz,
  account_deleted_at timestamptz not null default now(),
  -- Six years after the final consent or account-deletion event (Art. 17(3)(e)).
  expires_at timestamptz not null,
  constraint consent_evidence_archive_hmac check (subject_hmac ~ '^[0-9a-f]{64}$')
);

create index if not exists consent_evidence_archive_expiry_idx
  on kilo.consent_evidence_archive (expires_at);
create index if not exists consent_evidence_archive_key_idx
  on kilo.consent_evidence_archive (evidence_key_id);

create or replace function kilo.consent_evidence_archive_immutable()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'kilo.consent_evidence_archive is immutable; rows leave only by retention expiry'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists consent_evidence_archive_immutable on kilo.consent_evidence_archive;
create trigger consent_evidence_archive_immutable
  before update on kilo.consent_evidence_archive
  for each row execute function kilo.consent_evidence_archive_immutable();

alter table kilo.consent_evidence_key enable row level security;
alter table kilo.consent_evidence_archive enable row level security;
-- No policies at all: compliance access is service-role only, and the archive is
-- excluded from analytics and logs by construction (nothing else can read it).
grant all on kilo.consent_evidence_key to service_role;
grant all on kilo.consent_evidence_archive to service_role;

-- ---------------------------------------------------------------------------
-- 6. The gate
-- ---------------------------------------------------------------------------

-- The consent protocol version claimed by the calling client, from the
-- X-Kilo-Consent-Protocol request header.
--
-- Scope note: this is a COMPATIBILITY gate, not a security boundary. A tampered
-- client can claim any protocol version it likes. That buys it nothing: the
-- security boundary is (a) the consent gate below, which no header can satisfy,
-- and (b) the column privileges revoked at cutover, which make the legacy health
-- columns unreachable no matter what a client claims about itself. The protocol
-- floor exists so clients that still DEPEND on those columns are told to update
-- instead of silently losing data.
create or replace function kilo.client_consent_protocol_version()
  returns integer
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  v_headers text;
  v_value text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null or v_headers = '' then
    return null;
  end if;
  v_value := (v_headers::jsonb) ->> 'x-kilo-consent-protocol';
  if v_value is null or v_value !~ '^[0-9]{1,9}$' then
    return null;
  end if;
  return v_value::integer;
exception
  when others then
    return null;
end;
$$;

-- The single authorization predicate. Fail-closed on every unknown state:
-- unknown mode, missing config, missing state row, stale material version, or a
-- client below the protocol floor all deny.
create or replace function kilo.health_gate_ok()
  returns boolean
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
begin
  select * into v_cfg from kilo.health_sync_config where id = true;
  if v_cfg.id is null then
    return false;  -- no config: fail closed
  end if;

  if v_cfg.mode = 'paused' then
    return false;
  end if;

  if v_cfg.mode = 'legacy' then
    return true;   -- pre-cutover: the gate is not yet armed
  end if;

  if v_cfg.mode <> 'consent_required' then
    return false;  -- unknown mode: fail closed
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    return false;
  end if;

  if v_cfg.minimum_consent_protocol_version > 0 then
    v_protocol := kilo.client_consent_protocol_version();
    if v_protocol is null or v_protocol < v_cfg.minimum_consent_protocol_version then
      return false;
    end if;
  end if;

  select * into v_state from kilo.consent_state where user_id = v_uid;
  if v_state.user_id is null then
    return false;
  end if;

  return v_state.status = 'granted'
     and v_state.current_material_version is not null
     and v_state.current_material_version >= v_cfg.required_material_version;
end;
$$;

grant execute on function kilo.health_gate_ok() to authenticated, service_role;

-- Denial codes for the client. This is UX, not enforcement: the same denial is
-- applied by RLS whether or not the client ever calls this.
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
      'active_catalog_revision', v_revision
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
    'active_catalog_revision', v_revision
  );
end;
$$;

grant execute on function kilo.health_sync_preflight() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Gated RLS over the complete health-data set
-- ---------------------------------------------------------------------------

-- The seven final gated tables. Ownership alone is no longer sufficient: every
-- health read and write also requires an active grant for the required material
-- version. The gate predicate takes no arguments and is wrapped in a scalar
-- subquery so the planner evaluates it once per statement (InitPlan), not once
-- per row — same technique as the auth.uid() initplan fix in 20260702120000.
do $$
declare
  t text;
  tables text[] := array[
    'user_health_profile',
    'weight_entries',
    'weight_goal',
    'archived_weight_goals',
    'workout_notes',
    'deload_history',
    'fatigue_checkins'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on kilo.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on kilo.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on kilo.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on kilo.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on kilo.%I for select to authenticated
         using (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on kilo.%I for insert to authenticated
         with check (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on kilo.%I for update to authenticated
         using (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))
         with check (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on kilo.%I for delete to authenticated
         using (user_id = (select auth.uid()) and (select kilo.health_gate_ok()))',
      t || '_delete_own', t);
  end loop;
end;
$$;

-- kilo.user_profile is NOT gated as a table: it also holds display_name,
-- unit_system, and ui_state, which are ordinary account settings and must keep
-- working for a user who refuses health consent. Only its six legacy health
-- columns are health data, and only until the contract step drops them.
--
-- Writes to those six columns are guarded here. Reads are closed at cutover, by
-- revoking column-level SELECT from `authenticated` (see
-- kilo.activate_consent_enforcement below) — a per-row read mask is not
-- expressible in RLS, and by cutover no consent-capable client reads them anyway.
create or replace function kilo.guard_legacy_health_columns()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_changed boolean;
begin
  -- Mirrors and server-owned writes run nested or as a privileged role. Only a
  -- direct client write is subject to the gate.
  if pg_trigger_depth() > 1 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_changed := kilo.health_values_differ(
      null, null, null, null, null, null,
      new.current_deload_note_raw_text, new.current_deload_note_saved_at,
      new.current_deload_note_updated_at, new.fatigue_multiplier,
      new.tracked_lifts, new.current_workout_note_id
    );
  else
    v_changed := kilo.health_values_differ(
      old.current_deload_note_raw_text, old.current_deload_note_saved_at,
      old.current_deload_note_updated_at, old.fatigue_multiplier,
      old.tracked_lifts, old.current_workout_note_id,
      new.current_deload_note_raw_text, new.current_deload_note_saved_at,
      new.current_deload_note_updated_at, new.fatigue_multiplier,
      new.tracked_lifts, new.current_workout_note_id
    );
  end if;

  if not v_changed then
    return new;
  end if;

  if not kilo.health_gate_ok() then
    raise exception 'health-data consent required'
      using errcode = 'insufficient_privilege',
            detail = 'CONSENT_REQUIRED';
  end if;

  return new;
end;
$$;

-- BEFORE the timestamp trigger would be arbitrary; ordering is alphabetical by
-- trigger name within the same event, and this guard only raises or passes.
drop trigger if exists guard_legacy_health_columns on kilo.user_profile;
create trigger guard_legacy_health_columns
  before insert or update on kilo.user_profile
  for each row execute function kilo.guard_legacy_health_columns();

-- ---------------------------------------------------------------------------
-- 8. Server-owned grant operation
-- ---------------------------------------------------------------------------

-- The client submits ONLY the catalog revision it rendered. Everything that
-- constitutes evidence — wording, digest, purpose, categories, controller,
-- processor, material version, timestamp — is resolved server-side from the
-- immutable catalog. A tampered client cannot author a grant that says something
-- different from what it actually displayed.
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
    -- A fresh grant clears the prior withdrawal, but never the quarantine anchor:
    -- that anchor is the record of when this account was actually notified.
    withdrawn_at = null,
    cloud_data_deleted_at = null,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'grant_event_id', v_event_id,
    'catalog_revision', v_rev.catalog_revision,
    'material_version', v_rev.material_version,
    'copy_sha256', v_rev.copy_sha256,
    'status', 'granted'
  );
end;
$$;

revoke all on function kilo.consent_grant(integer, text, text, text) from public, anon;
grant execute on function kilo.consent_grant(integer, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Cutover / rollback (operator, service-role only)
-- ---------------------------------------------------------------------------

-- Create needs_reconsent rows for every existing account WITHOUT writing any
-- synthetic consent event. There is no grandfathering here: a user who never
-- affirmed anything ends up in needs_reconsent, which the gate denies.
create or replace function kilo.seed_existing_user_consent_state()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into kilo.consent_state (user_id, status, updated_at)
  select u.id, 'needs_reconsent', now()
  from auth.users u
  on conflict (user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function kilo.seed_existing_user_consent_state() from public, anon, authenticated;
grant execute on function kilo.seed_existing_user_consent_state() to service_role;

-- Arm the gate. Legal transitions:
--   legacy           -> paused | consent_required
--   paused           -> legacy | consent_required
--   consent_required -> paused                      (the ONLY rollback)
--
-- consent_required -> legacy is refused here on purpose. Reopening ungated health
-- sync after enforcement is a controller decision about lawful basis, not an
-- operational rollback, and it must not be reachable from an on-call keyboard.
-- `paused` is the rollback: it fails closed and deletes nothing.
create or replace function kilo.set_health_sync_mode(
  p_mode text,
  p_minimum_consent_protocol_version integer default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_cfg kilo.health_sync_config%rowtype;
begin
  select * into v_cfg from kilo.health_sync_config where id = true for update;

  if p_mode not in ('legacy', 'paused', 'consent_required') then
    raise exception 'unsupported health_sync_mode %', p_mode using errcode = 'check_violation';
  end if;

  if v_cfg.mode = 'consent_required' and p_mode = 'legacy' then
    raise exception 'consent_required -> legacy is not an operational rollback; use paused'
      using errcode = 'check_violation';
  end if;

  update kilo.health_sync_config set
    mode = p_mode,
    minimum_consent_protocol_version =
      coalesce(p_minimum_consent_protocol_version, minimum_consent_protocol_version),
    updated_at = now()
  where id = true;

  -- Close the legacy health columns to clients at cutover. By this point the
  -- protocol floor already denies clients that still depend on them, so the only
  -- readers left are consent-capable clients that read user_health_profile.
  -- Without this, a consent-capable client could still pull the six health values
  -- out of an ungated user_profile SELECT and bypass the gate entirely.
  if p_mode = 'consent_required' then
    revoke select (
      current_deload_note_raw_text,
      current_deload_note_saved_at,
      current_deload_note_updated_at,
      fatigue_multiplier,
      tracked_lifts,
      current_workout_note_id
    ) on kilo.user_profile from authenticated;
  end if;

  select * into v_cfg from kilo.health_sync_config where id = true;
  return jsonb_build_object(
    'mode', v_cfg.mode,
    'required_material_version', v_cfg.required_material_version,
    'minimum_consent_protocol_version', v_cfg.minimum_consent_protocol_version,
    'purge_enabled', v_cfg.purge_enabled
  );
end;
$$;

revoke all on function kilo.set_health_sync_mode(text, integer) from public, anon, authenticated;
grant execute on function kilo.set_health_sync_mode(text, integer) to service_role;
