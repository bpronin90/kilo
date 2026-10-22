-- Detailed movement-group choices (issue #1581).
--
-- Widens kilo.is_valid_exercise_movement_groups (the body of the existing
-- workout_notes_exercise_movement_groups_shape CHECK) to accept a second,
-- explicitly versioned map shape beside version 1:
--
--   {"version": 1, "overrides": {"<key>": "<broad id>"}}            (unchanged)
--   {"version": 2, "overrides": {"<key>": "<broad id | detailed id>"}}
--
-- Broad ids: push, pull, shoulders, arms, legs, hinge, core, other.
-- Detailed ids: the primary library groups of the client exercise library
-- (mobile/lib/data/exerciseLibrary/primaryGroups.json), excluding
-- 'unclassified'. The two sets are disjoint. Version 1 still accepts ONLY the
-- broad ids, so no existing row changes meaning; version 2 exists so that an
-- older client (which validates version 1 only) reads a detailed map as
-- unsupported and refuses to edit it, rather than discarding or downgrading it.
--
-- WHAT STAYS UNCHANGED (deliberately):
--
--   * The column, the CHECK constraint and its name, RLS, grants and the
--     health-consent gate on kilo.workout_notes. Only the validator body is
--     replaced; CREATE OR REPLACE keeps the function's owner and ACL, and the
--     revoke/grant below restates the existing ones exactly.
--   * Every other bound: exact two top-level fields, object overrides, at most
--     1000 keys, keys 1-200 characters, one scalar string group per key, NULL
--     valid (keyword rules only). Any other version is rejected.
--   * Existing rows: all are NULL or version 1 with broad ids, which stay valid.
--     No row is read, rewritten or migrated.
--
-- Rollout: apply this migration before shipping a client that writes version 2
-- (server-before-client); until then such a write is rejected by the CHECK and
-- the client reports the save as failed. Rollback: re-creating the version 1
-- validator is only safe while no row holds a version 2 map; once one exists,
-- a narrower CHECK would make that row un-updatable, so roll back the client
-- only and keep this validator.

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
      when p_value -> 'version' not in ('1'::jsonb, '2'::jsonb) then false
      when jsonb_typeof(p_value -> 'overrides') <> 'object' then false
      -- Count before iterating so an oversized map is rejected cheaply.
      when (select count(*) from jsonb_object_keys(p_value -> 'overrides')) > 1000 then false
      else not exists (
        select 1
          from jsonb_each(p_value -> 'overrides') as o(key, value)
         where char_length(o.key) not between 1 and 200
            or jsonb_typeof(o.value) <> 'string'
            or not (
                 (o.value #>> '{}') = any (array[
                   'push', 'pull', 'shoulders', 'arms',
                   'legs', 'hinge', 'core', 'other'
                 ])
                 or (
                   p_value -> 'version' = '2'::jsonb
                   and (o.value #>> '{}') = any (array[
                     'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
                     'squat', 'lunge_step', 'hip_hinge', 'hip_extension', 'knee_flexion',
                     'knee_extension', 'calf_ankle', 'shoulder_isolation', 'elbow_flexion',
                     'elbow_extension', 'hip_abduction_adduction', 'forearm_grip',
                     'trunk_movement', 'trunk_stability', 'loaded_carry', 'olympic_lift',
                     'jump_throw', 'mixed_conditioning', 'cardio', 'mobility', 'stretching'
                   ])
                 )
               )
      )
    end
$$;

comment on column kilo.workout_notes.exercise_movement_groups is
  'User-authored single movement-group overrides (issues #1306, #1581): {version: 1, overrides: {<normalized exercise key>: <push|pull|shoulders|arms|legs|hinge|core|other>}} or {version: 2, overrides: {<key>: <a broad id or a detailed primary library group id>}}. Authored content, NOT a derived cache of raw_text and never recomputed. NULL means automatic classification only, including every row that predates this column. Bounded by workout_notes_exercise_movement_groups_shape: at most 1000 keys, keys 1-200 characters, exactly one group id per key.';

-- Unchanged: the validator is only reachable through the CHECK.
revoke all on function kilo.is_valid_exercise_movement_groups(jsonb) from public, anon;
grant execute on function kilo.is_valid_exercise_movement_groups(jsonb) to authenticated, service_role;
