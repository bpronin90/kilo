-- Per-exercise movement-group overrides on kilo.workout_notes (issues #1306, #1581).
--
-- Defends: one nullable authored-content column that is shape-bounded, owner
-- isolated, consent gated, server-clocked, and absent (not invented) on legacy
-- rows. Writes run as `authenticated` with a real JWT claim so isolation is an
-- RLS statement, not a client one.
--
-- Harness: pgTAP.
--   psql "$DATABASE_URL" -f supabase/tests/exercise-movement-groups.test.sql

begin;

select plan(53);

\set user_a '13060000-0000-0000-0000-000000000001'
\set user_b '13060000-0000-0000-0000-000000000002'

insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_b'::uuid) on conflict do nothing;

create or replace function pg_temp.as_user_1306(p_user uuid)
  returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Hold the consent gate open so failures here are about the new column.
update kilo.health_sync_config
   set mode = 'legacy', minimum_consent_protocol_version = 0
 where id = true;

-- ---------------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------------

select has_column('kilo', 'workout_notes', 'exercise_movement_groups', 'column exists');
select col_type_is('kilo', 'workout_notes', 'exercise_movement_groups', 'jsonb', 'column is jsonb');
select col_is_null('kilo', 'workout_notes', 'exercise_movement_groups', 'column is nullable');
select col_hasnt_default('kilo', 'workout_notes', 'exercise_movement_groups', 'no server-invented default');
select has_column('kilo', 'workout_notes', 'exercise_classifications',
  'the derived classifications column is untouched and still separate');

select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'kilo' and tablename = 'workout_notes'
      and coalesce(qual, '') || coalesce(with_check, '') like '%health_gate_ok%'),
  4,
  'all four workout_notes policies still require an active consent grant'
);
select ok(
  not has_table_privilege('anon', 'kilo.workout_notes', 'select')
  and not has_table_privilege('anon', 'kilo.workout_notes', 'insert')
  and not has_table_privilege('anon', 'kilo.workout_notes', 'update'),
  'anon has no access to workout notes'
);

-- ---------------------------------------------------------------------------
-- 2. Validator (pure)
-- ---------------------------------------------------------------------------

select ok(kilo.is_valid_exercise_movement_groups(null), 'null is valid (rules only)');
select ok(kilo.is_valid_exercise_movement_groups('{"version":1,"overrides":{}}'::jsonb), 'empty overrides is valid');
select ok(kilo.is_valid_exercise_movement_groups(
  '{"version":1,"overrides":{"deadlift":"hinge","bench press":"push"}}'::jsonb), 'valid single-group map');
select ok(not kilo.is_valid_exercise_movement_groups('[]'::jsonb), 'array top level is invalid');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":3,"overrides":{}}'::jsonb), 'unsupported version is invalid');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":"2","overrides":{}}'::jsonb), 'string version is invalid');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":0,"overrides":{}}'::jsonb), 'version 0 is invalid');
select ok(not kilo.is_valid_exercise_movement_groups('{"overrides":{}}'::jsonb), 'missing version is invalid');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":1,"overrides":{},"extra":true}'::jsonb), 'extra top-level field is invalid');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":1,"overrides":{"squat":["legs","hinge"]}}'::jsonb), 'multi-group array value is invalid');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":1,"overrides":{"squat":"quads"}}'::jsonb), 'unknown group id is invalid');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":1,"overrides":{"":"legs"}}'::jsonb), 'empty key is invalid');
select ok(not kilo.is_valid_exercise_movement_groups(
  jsonb_build_object('version', 1, 'overrides', jsonb_build_object(repeat('k', 201), 'legs'))), 'key over 200 characters is invalid');
select ok(kilo.is_valid_exercise_movement_groups(
  jsonb_build_object('version', 1, 'overrides', jsonb_build_object(repeat('k', 200), 'legs'))), 'key of exactly 200 characters is valid');
select ok(kilo.is_valid_exercise_movement_groups(
  jsonb_build_object('version', 1, 'overrides',
    (select jsonb_object_agg('k' || g, 'other') from generate_series(1, 1000) g))), '1000 keys is valid');
select ok(not kilo.is_valid_exercise_movement_groups(
  jsonb_build_object('version', 1, 'overrides',
    (select jsonb_object_agg('k' || g, 'other') from generate_series(1, 1001) g))), '1001 keys is invalid');

-- Version 2 (#1581): detailed ids beside broad ids; version 1 stays broad-only.
select ok(kilo.is_valid_exercise_movement_groups('{"version":2,"overrides":{}}'::jsonb), 'empty version 2 map is valid');
select ok(kilo.is_valid_exercise_movement_groups(
  '{"version":2,"overrides":{"squat":"squat","deadlift":"hinge","row":"horizontal_pull","plank":"trunk_stability"}}'::jsonb),
  'version 2 holds detailed and legacy broad ids together');
select ok(kilo.is_valid_exercise_movement_groups(
  '{"version":2,"overrides":{"a":"stretching","b":"hip_abduction_adduction","c":"other"}}'::jsonb),
  'version 2 accepts the last detailed ids and other');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":1,"overrides":{"squat":"squat"}}'::jsonb),
  'version 1 still rejects a detailed id');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":2,"overrides":{"squat":"unclassified"}}'::jsonb),
  'version 2 rejects unclassified');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":2,"overrides":{"squat":"quads"}}'::jsonb),
  'version 2 rejects an unknown id');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":2,"overrides":{"squat":["squat"]}}'::jsonb),
  'version 2 rejects an array value');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":2,"overrides":{"squat":{"id":"squat"}}}'::jsonb),
  'version 2 rejects an object value');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":2,"overrides":{},"extra":1}'::jsonb),
  'version 2 rejects an extra top-level field');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":2,"overrides":[]}'::jsonb),
  'version 2 rejects array overrides');
select ok(not kilo.is_valid_exercise_movement_groups('{"version":2,"overrides":{"":"squat"}}'::jsonb),
  'version 2 rejects an empty key');
select ok(not kilo.is_valid_exercise_movement_groups(
  jsonb_build_object('version', 2, 'overrides', jsonb_build_object(repeat('k', 201), 'squat'))),
  'version 2 rejects a key over 200 characters');
select ok(kilo.is_valid_exercise_movement_groups(
  jsonb_build_object('version', 2, 'overrides',
    (select jsonb_object_agg('k' || g, 'squat') from generate_series(1, 1000) g))), 'version 2: 1000 keys is valid');
select ok(not kilo.is_valid_exercise_movement_groups(
  jsonb_build_object('version', 2, 'overrides',
    (select jsonb_object_agg('k' || g, 'squat') from generate_series(1, 1001) g))), 'version 2: 1001 keys is invalid');
select ok(
  not has_function_privilege('anon', 'kilo.is_valid_exercise_movement_groups(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'kilo.is_valid_exercise_movement_groups(jsonb)', 'execute'),
  'validator grants are unchanged: no anon execute'
);
select is(
  (select provolatile::text || prosecdef::text from pg_proc
    where oid = 'kilo.is_valid_exercise_movement_groups(jsonb)'::regprocedure),
  'ifalse',
  'validator stays immutable and security invoker'
);

-- ---------------------------------------------------------------------------
-- 3. Owner writes, legacy rows, server clock
-- ---------------------------------------------------------------------------

select pg_temp.as_user_1306(:'user_a'::uuid);

select lives_ok(
  $$ insert into kilo.workout_notes (user_id, id, title, raw_text)
     values ('13060000-0000-0000-0000-000000000001', 'wn-legacy', 'Legacy', 'Day 1') $$,
  'a note written without the column is still valid'
);
select is(
  (select exercise_movement_groups from kilo.workout_notes where id = 'wn-legacy'),
  null,
  'a legacy note reads back with no invented overrides'
);

select lives_ok(
  $$ update kilo.workout_notes
        set exercise_movement_groups = '{"version":1,"overrides":{"deadlift":"hinge"}}'::jsonb,
            updated_at = '2001-01-01T00:00:00Z'
      where id = 'wn-legacy' $$,
  'an override-only edit succeeds'
);
select is(
  (select exercise_movement_groups from kilo.workout_notes where id = 'wn-legacy'),
  '{"version":1,"overrides":{"deadlift":"hinge"}}'::jsonb,
  'the stored value reads back exactly'
);
select is(
  (select updated_at from kilo.workout_notes where id = 'wn-legacy'),
  now(),
  'an override-only edit gets the server-authoritative updated_at'
);
select throws_ok(
  $$ update kilo.workout_notes
        set exercise_movement_groups = '{"version":1,"overrides":{"squat":["legs"]}}'::jsonb
      where id = 'wn-legacy' $$,
  '23514', null,
  'an authenticated write of an invalid shape is rejected by the CHECK'
);

select lives_ok(
  $$ update kilo.workout_notes
        set exercise_movement_groups = '{"version":2,"overrides":{"deadlift":"hinge","squat":"squat"}}'::jsonb
      where id = 'wn-legacy' $$,
  'an owner can store a version 2 map'
);
select is(
  (select exercise_movement_groups from kilo.workout_notes where id = 'wn-legacy'),
  '{"version":2,"overrides":{"deadlift":"hinge","squat":"squat"}}'::jsonb,
  'the version 2 map reads back exactly'
);
select throws_ok(
  $$ update kilo.workout_notes
        set exercise_movement_groups = '{"version":1,"overrides":{"squat":"squat"}}'::jsonb
      where id = 'wn-legacy' $$,
  '23514', null,
  'a version 1 map holding a detailed id is rejected by the CHECK'
);
select lives_ok(
  $$ update kilo.workout_notes
        set exercise_movement_groups = '{"version":1,"overrides":{"deadlift":"hinge"}}'::jsonb
      where id = 'wn-legacy' $$,
  'restore the version 1 map for the isolation checks'
);

reset role;

-- ---------------------------------------------------------------------------
-- 4. Owner isolation
-- ---------------------------------------------------------------------------

create or replace function pg_temp.try_rewrite_1306()
  returns integer language plpgsql as $$
declare v_rows integer;
begin
  update kilo.workout_notes
     set exercise_movement_groups = '{"version":1,"overrides":{"deadlift":"other"}}'::jsonb
   where id = 'wn-legacy';
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

select pg_temp.as_user_1306(:'user_b'::uuid);
select is(
  (select count(*)::integer from kilo.workout_notes where exercise_movement_groups is not null),
  0,
  'another user cannot read the overrides'
);
select is(pg_temp.try_rewrite_1306(), 0, 'another user cannot rewrite the overrides');
reset role;
select is(
  (select exercise_movement_groups from kilo.workout_notes where id = 'wn-legacy'),
  '{"version":1,"overrides":{"deadlift":"hinge"}}'::jsonb,
  'the owner value survives the cross-user attempt unchanged'
);

-- ---------------------------------------------------------------------------
-- 5. Consent denied
-- ---------------------------------------------------------------------------

update kilo.health_sync_config
   set mode = 'consent_required', required_material_version = 1,
       minimum_consent_protocol_version = 0
 where id = true;

select pg_temp.as_user_1306(:'user_b'::uuid);
select throws_ok(
  $$ insert into kilo.workout_notes (user_id, id, title, raw_text, exercise_movement_groups)
     values ('13060000-0000-0000-0000-000000000002', 'wn-denied', 'x', 'y',
             '{"version":1,"overrides":{"squat":"legs"}}'::jsonb) $$,
  null, null,
  'without consent a user cannot write overrides'
);
reset role;

select * from finish();
rollback;
