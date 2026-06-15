-- Note-first Supabase schema and RLS (backend roadmap Phase 3 / Task 7, issue #316).
--
-- Creates the seven note-first app tables, owner/index fields, enables RLS on
-- every table, and adds owner-scoped select/insert/update/delete policies.
--
-- Contract notes:
--   * workout_notes.raw_text is canonical; derived JSON columns are snapshots.
--   * All app tables live in the dedicated `kilo` schema (this project is shared
--     with another app that owns the public/raw/canonical/serving schemas), have
--     RLS enabled, and are user-scoped.
--   * Singleton tables key on user_id; multi-row tables use (user_id, id).
--   * Policies restrict every operation to rows where user_id = auth.uid().
--
-- Schema/grants note:
--   * A custom schema does NOT inherit the default privilege grants Supabase
--     applies to `public`, so this migration explicitly grants schema USAGE and
--     table privileges to `authenticated` (and `service_role` for future
--     server-owned code). No grants are issued to `anon`: signed-out users stay
--     local-only and never reach these tables. RLS still scopes every row to its
--     owner on top of these grants.
--   * To reach these tables through the auto-generated API, `kilo` must also be
--     added to the project's exposed schemas (API settings / config.toml
--     [api] schemas). That is a project config step, not part of this migration.

create schema if not exists kilo;

-- ---------------------------------------------------------------------------
-- user_profile: account-owned singleton (primary key is the user id)
-- ---------------------------------------------------------------------------
create table if not exists kilo.user_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  unit_system text,
  current_workout_note_id text,
  fatigue_multiplier numeric,
  tracked_lifts jsonb,
  ui_state jsonb,
  current_deload_note_raw_text text,
  current_deload_note_saved_at timestamptz,
  current_deload_note_updated_at timestamptz,
  profile_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- feature_toggles: per-user feature gates (primary key is the user id)
-- ---------------------------------------------------------------------------
create table if not exists kilo.feature_toggles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  weight_date_edit_enabled boolean not null default false,
  deload_date_edit_enabled boolean not null default false,
  fatigue_tracking_enabled boolean not null default true,
  deload_mode_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- weight_entries: one row per weight entry, keyed on (user_id, id)
-- ---------------------------------------------------------------------------
create table if not exists kilo.weight_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  entry_type text not null default 'weight',
  date date,
  logged_at timestamptz,
  weight_value numeric not null,
  note text,
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists weight_entries_user_logged_at_idx
  on kilo.weight_entries (user_id, logged_at desc);

-- ---------------------------------------------------------------------------
-- weight_goal: per-user goal singleton (primary key is the user id)
-- ---------------------------------------------------------------------------
create table if not exists kilo.weight_goal (
  user_id uuid primary key references auth.users (id) on delete cascade,
  target_weight numeric,
  target_date date,
  start_weight numeric,
  start_date date,
  goal_json jsonb,
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- workout_notes: one row per notebook routine, keyed on (user_id, id).
-- raw_text is canonical; derived JSON columns are snapshots only.
-- ---------------------------------------------------------------------------
create table if not exists kilo.workout_notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  title text,
  raw_text text,
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  tracked_exercises jsonb,
  one_k_exercises jsonb,
  skip_markers jsonb,
  attendance_flags jsonb,
  exercise_classifications jsonb,
  session_checkins jsonb,
  is_current boolean not null default false,
  source_snapshot jsonb,
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists workout_notes_user_updated_at_idx
  on kilo.workout_notes (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- deload_history: one row per completed deload record, keyed on (user_id, id)
-- ---------------------------------------------------------------------------
create table if not exists kilo.deload_history (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  date date,
  raw_text text,
  record_json jsonb,
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists deload_history_user_updated_at_idx
  on kilo.deload_history (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- fatigue_checkins: derived rows for queryable fatigue history,
-- keyed on (user_id, id). The source note remains canonical.
-- ---------------------------------------------------------------------------
create table if not exists kilo.fatigue_checkins (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  workout_note_id text,
  session_date date,
  status text,
  reasons jsonb,
  source_json jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists fatigue_checkins_user_session_date_idx
  on kilo.fatigue_checkins (user_id, session_date desc);

create index if not exists fatigue_checkins_user_workout_note_idx
  on kilo.fatigue_checkins (user_id, workout_note_id);

-- ---------------------------------------------------------------------------
-- Enable RLS on every app table before any client is exposed.
-- ---------------------------------------------------------------------------
alter table kilo.user_profile     enable row level security;
alter table kilo.feature_toggles  enable row level security;
alter table kilo.weight_entries   enable row level security;
alter table kilo.weight_goal      enable row level security;
alter table kilo.workout_notes    enable row level security;
alter table kilo.deload_history   enable row level security;
alter table kilo.fatigue_checkins enable row level security;

-- ---------------------------------------------------------------------------
-- Owner-scoped policies. Every operation is restricted to rows where
-- user_id = auth.uid(). Update policies pair using + with check so update
-- visibility (which depends on row selection) is owner-only, and the new row
-- cannot be reassigned to another owner.
-- ---------------------------------------------------------------------------

-- user_profile
create policy "user_profile_select_own" on kilo.user_profile
  for select to authenticated using (user_id = auth.uid());
create policy "user_profile_insert_own" on kilo.user_profile
  for insert to authenticated with check (user_id = auth.uid());
create policy "user_profile_update_own" on kilo.user_profile
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "user_profile_delete_own" on kilo.user_profile
  for delete to authenticated using (user_id = auth.uid());

-- feature_toggles
create policy "feature_toggles_select_own" on kilo.feature_toggles
  for select to authenticated using (user_id = auth.uid());
create policy "feature_toggles_insert_own" on kilo.feature_toggles
  for insert to authenticated with check (user_id = auth.uid());
create policy "feature_toggles_update_own" on kilo.feature_toggles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "feature_toggles_delete_own" on kilo.feature_toggles
  for delete to authenticated using (user_id = auth.uid());

-- weight_entries
create policy "weight_entries_select_own" on kilo.weight_entries
  for select to authenticated using (user_id = auth.uid());
create policy "weight_entries_insert_own" on kilo.weight_entries
  for insert to authenticated with check (user_id = auth.uid());
create policy "weight_entries_update_own" on kilo.weight_entries
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "weight_entries_delete_own" on kilo.weight_entries
  for delete to authenticated using (user_id = auth.uid());

-- weight_goal
create policy "weight_goal_select_own" on kilo.weight_goal
  for select to authenticated using (user_id = auth.uid());
create policy "weight_goal_insert_own" on kilo.weight_goal
  for insert to authenticated with check (user_id = auth.uid());
create policy "weight_goal_update_own" on kilo.weight_goal
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "weight_goal_delete_own" on kilo.weight_goal
  for delete to authenticated using (user_id = auth.uid());

-- workout_notes
create policy "workout_notes_select_own" on kilo.workout_notes
  for select to authenticated using (user_id = auth.uid());
create policy "workout_notes_insert_own" on kilo.workout_notes
  for insert to authenticated with check (user_id = auth.uid());
create policy "workout_notes_update_own" on kilo.workout_notes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "workout_notes_delete_own" on kilo.workout_notes
  for delete to authenticated using (user_id = auth.uid());

-- deload_history
create policy "deload_history_select_own" on kilo.deload_history
  for select to authenticated using (user_id = auth.uid());
create policy "deload_history_insert_own" on kilo.deload_history
  for insert to authenticated with check (user_id = auth.uid());
create policy "deload_history_update_own" on kilo.deload_history
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "deload_history_delete_own" on kilo.deload_history
  for delete to authenticated using (user_id = auth.uid());

-- fatigue_checkins
create policy "fatigue_checkins_select_own" on kilo.fatigue_checkins
  for select to authenticated using (user_id = auth.uid());
create policy "fatigue_checkins_insert_own" on kilo.fatigue_checkins
  for insert to authenticated with check (user_id = auth.uid());
create policy "fatigue_checkins_update_own" on kilo.fatigue_checkins
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "fatigue_checkins_delete_own" on kilo.fatigue_checkins
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants. A custom schema has no default Supabase grants, so privileges are
-- issued explicitly. `authenticated` gets row-level DML (RLS scopes it to the
-- owner); `service_role` gets full access for future server-owned code paths
-- (account export/deletion). `anon` is intentionally omitted.
-- ---------------------------------------------------------------------------
grant usage on schema kilo to authenticated, service_role;

grant select, insert, update, delete on kilo.user_profile     to authenticated;
grant select, insert, update, delete on kilo.feature_toggles  to authenticated;
grant select, insert, update, delete on kilo.weight_entries   to authenticated;
grant select, insert, update, delete on kilo.weight_goal      to authenticated;
grant select, insert, update, delete on kilo.workout_notes    to authenticated;
grant select, insert, update, delete on kilo.deload_history   to authenticated;
grant select, insert, update, delete on kilo.fatigue_checkins to authenticated;

grant all on kilo.user_profile     to service_role;
grant all on kilo.feature_toggles  to service_role;
grant all on kilo.weight_entries   to service_role;
grant all on kilo.weight_goal      to service_role;
grant all on kilo.workout_notes    to service_role;
grant all on kilo.deload_history   to service_role;
grant all on kilo.fatigue_checkins to service_role;
