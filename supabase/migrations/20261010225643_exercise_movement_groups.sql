-- Per-exercise movement-group overrides on workout notes (issue #1306).
--
-- One nullable jsonb column on kilo.workout_notes, beside
-- `exercise_classifications`, holding the USER'S explicit single-group choice
-- per normalized exercise key:
--
--   {"version": 1, "overrides": {"<normalized-exercise-key>": "<group-id>"}}
--
-- Unlike `exercise_classifications` (a recomputable cache of raw_text), this
-- column is authored content: nothing on the server or the client can
-- regenerate it, so it is never treated as derived.
--
-- WHAT STAYS UNCHANGED (deliberately):
--
--   * RLS, grants and the health-consent gate on kilo.workout_notes. The column
--     is covered by the existing table-level owner-AND-consent policies; no
--     policy, grant, or role is touched.
--   * The server-authoritative `updated_at` / `sync_xid` trigger and the
--     commit-safe change feed. kilo.pull_sync_changes serializes rows with
--     to_jsonb(t), so the column joins the feed with no function change.
--   * The payload-bound triggers: they measure the whole row with
--     to_jsonb(new), so the column counts toward the existing 8 MiB row bound
--     and the usage ledger with no change to those functions.
--   * Existing rows: the column is nullable with no default. NULL means
--     "keyword rules only" (no overrides), the same as every legacy row.
--     An older client that omits the column from its upsert leaves a server
--     value untouched.
--
-- The CHECK constraint is the bound: a client that bypasses the UI cannot
-- store an array of groups, an unknown group id, extra top-level fields, an
-- unsupported version, more than 1000 keys, or a key outside 1-200 characters.
-- It is IMMUTABLE and takes no table access.

create or replace function kilo.is_valid_exercise_movement_groups(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    case
      when p_value is null then true
      when jsonb_typeof(p_value) <> 'object' then false
      -- Exactly the two documented top-level fields; nothing else.
      when (select count(*) from jsonb_object_keys(p_value)) <> 2 then false
      when not (p_value ? 'version' and p_value ? 'overrides') then false
      when p_value -> 'version' <> '1'::jsonb then false
      when jsonb_typeof(p_value -> 'overrides') <> 'object' then false
      -- Count before iterating so an oversized map is rejected cheaply.
      when (select count(*) from jsonb_object_keys(p_value -> 'overrides')) > 1000 then false
      else not exists (
        select 1
          from jsonb_each(p_value -> 'overrides') as o(key, value)
         where char_length(o.key) not between 1 and 200
            or jsonb_typeof(o.value) <> 'string'
            or (o.value #>> '{}') <> all (array[
                 'push', 'pull', 'shoulders', 'arms',
                 'legs', 'hinge', 'core', 'other'
               ])
      )
    end
$$;

alter table kilo.workout_notes
  add column if not exists exercise_movement_groups jsonb;

alter table kilo.workout_notes
  add constraint workout_notes_exercise_movement_groups_shape
  check (kilo.is_valid_exercise_movement_groups(exercise_movement_groups));

comment on column kilo.workout_notes.exercise_movement_groups is
  'User-authored single movement-group overrides (issue #1306): {version: 1, overrides: {<normalized exercise key>: <one of push|pull|shoulders|arms|legs|hinge|core|other>}}. Authored content, NOT a derived cache of raw_text and never recomputed. NULL means keyword rules only, including every row that predates this column. Bounded by workout_notes_exercise_movement_groups_shape: at most 1000 keys, keys 1-200 characters, exactly one group id per key.';

-- The validator is only reachable through the CHECK; it needs no client grant.
revoke all on function kilo.is_valid_exercise_movement_groups(jsonb) from public, anon;
grant execute on function kilo.is_valid_exercise_movement_groups(jsonb) to authenticated, service_role;
