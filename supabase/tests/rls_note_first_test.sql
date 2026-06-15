-- RLS policy tests for the note-first schema (issue #316).
--
-- Proves that an authenticated user (user A) cannot read or mutate another
-- user's (user B) rows across every app table, while still being able to
-- read and mutate their own rows.
--
-- Harness: pgTAP. Run inside a transaction against a database that has the
-- migration applied, e.g. via Supabase CLI `supabase test db` or:
--   psql "$DATABASE_URL" -f supabase/tests/rls_note_first_test.sql
--
-- The test impersonates Supabase roles by setting `role` to `authenticated`
-- and the JWT claims via `request.jwt.claims`, which is how Supabase's
-- `auth.uid()` resolves the current user.

begin;

select plan(42);

-- Two fixed test user ids.
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

-- Seed auth.users so the on-delete-cascade FKs are satisfied. Done as the
-- table owner (superuser/postgres running the test), bypassing RLS on app
-- tables for setup.
insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_b'::uuid) on conflict do nothing;

-- Helper: become an authenticated user by id.
-- Sets role to authenticated and the JWT sub claim that auth.uid() reads.
create or replace function pg_temp.login_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed one owned row per table for each user, as that user, proving inserts
-- with the owner's id succeed under RLS.
-- ---------------------------------------------------------------------------

select pg_temp.login_as(:'user_a'::uuid);

select lives_ok(
  $$insert into kilo.user_profile (user_id) values ('11111111-1111-1111-1111-111111111111')$$,
  'user A can insert own user_profile');
select lives_ok(
  $$insert into kilo.feature_toggles (user_id) values ('11111111-1111-1111-1111-111111111111')$$,
  'user A can insert own feature_toggles');
select lives_ok(
  $$insert into kilo.weight_entries (user_id, id, weight_value) values ('11111111-1111-1111-1111-111111111111', 'wa', 80)$$,
  'user A can insert own weight_entries');
select lives_ok(
  $$insert into kilo.weight_goal (user_id) values ('11111111-1111-1111-1111-111111111111')$$,
  'user A can insert own weight_goal');
select lives_ok(
  $$insert into kilo.workout_notes (user_id, id) values ('11111111-1111-1111-1111-111111111111', 'na')$$,
  'user A can insert own workout_notes');
select lives_ok(
  $$insert into kilo.deload_history (user_id, id) values ('11111111-1111-1111-1111-111111111111', 'da')$$,
  'user A can insert own deload_history');
select lives_ok(
  $$insert into kilo.fatigue_checkins (user_id, id) values ('11111111-1111-1111-1111-111111111111', 'fa')$$,
  'user A can insert own fatigue_checkins');

select pg_temp.login_as(:'user_b'::uuid);

select lives_ok(
  $$insert into kilo.user_profile (user_id) values ('22222222-2222-2222-2222-222222222222')$$,
  'user B can insert own user_profile');
select lives_ok(
  $$insert into kilo.feature_toggles (user_id) values ('22222222-2222-2222-2222-222222222222')$$,
  'user B can insert own feature_toggles');
select lives_ok(
  $$insert into kilo.weight_entries (user_id, id, weight_value) values ('22222222-2222-2222-2222-222222222222', 'wb', 90)$$,
  'user B can insert own weight_entries');
select lives_ok(
  $$insert into kilo.weight_goal (user_id) values ('22222222-2222-2222-2222-222222222222')$$,
  'user B can insert own weight_goal');
select lives_ok(
  $$insert into kilo.workout_notes (user_id, id) values ('22222222-2222-2222-2222-222222222222', 'nb')$$,
  'user B can insert own workout_notes');
select lives_ok(
  $$insert into kilo.deload_history (user_id, id) values ('22222222-2222-2222-2222-222222222222', 'db')$$,
  'user B can insert own deload_history');
select lives_ok(
  $$insert into kilo.fatigue_checkins (user_id, id) values ('22222222-2222-2222-2222-222222222222', 'fb')$$,
  'user B can insert own fatigue_checkins');

-- ---------------------------------------------------------------------------
-- As user A: SELECT must only see own rows, never user B's rows.
-- ---------------------------------------------------------------------------
select pg_temp.login_as(:'user_a'::uuid);

select is(
  (select count(*)::int from kilo.user_profile),
  1, 'user A sees only own user_profile row');
select is(
  (select count(*)::int from kilo.feature_toggles),
  1, 'user A sees only own feature_toggles row');
select is(
  (select count(*)::int from kilo.weight_entries),
  1, 'user A sees only own weight_entries row');
select is(
  (select count(*)::int from kilo.weight_goal),
  1, 'user A sees only own weight_goal row');
select is(
  (select count(*)::int from kilo.workout_notes),
  1, 'user A sees only own workout_notes row');
select is(
  (select count(*)::int from kilo.deload_history),
  1, 'user A sees only own deload_history row');
select is(
  (select count(*)::int from kilo.fatigue_checkins),
  1, 'user A sees only own fatigue_checkins row');

-- Direct attempts to read user B's specific rows return nothing.
select is(
  (select count(*)::int from kilo.weight_entries where id = 'wb'),
  0, 'user A cannot read user B weight_entries row');
select is(
  (select count(*)::int from kilo.workout_notes where id = 'nb'),
  0, 'user A cannot read user B workout_notes row');
select is(
  (select count(*)::int from kilo.user_profile where user_id = '22222222-2222-2222-2222-222222222222'),
  0, 'user A cannot read user B user_profile row');

-- ---------------------------------------------------------------------------
-- As user A: UPDATE of user B rows must affect zero rows (invisible to RLS).
-- ---------------------------------------------------------------------------
select is(
  (with u as (update kilo.weight_entries set note = 'hacked' where id = 'wb' returning 1) select count(*)::int from u),
  0, 'user A update of user B weight_entries affects no rows');
select is(
  (with u as (update kilo.workout_notes set raw_text = 'hacked' where id = 'nb' returning 1) select count(*)::int from u),
  0, 'user A update of user B workout_notes affects no rows');
select is(
  (with u as (update kilo.user_profile set display_name = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222' returning 1) select count(*)::int from u),
  0, 'user A update of user B user_profile affects no rows');
select is(
  (with u as (update kilo.feature_toggles set deload_mode_enabled = false where user_id = '22222222-2222-2222-2222-222222222222' returning 1) select count(*)::int from u),
  0, 'user A update of user B feature_toggles affects no rows');
select is(
  (with u as (update kilo.weight_goal set target_weight = 1 where user_id = '22222222-2222-2222-2222-222222222222' returning 1) select count(*)::int from u),
  0, 'user A update of user B weight_goal affects no rows');
select is(
  (with u as (update kilo.deload_history set raw_text = 'hacked' where id = 'db' returning 1) select count(*)::int from u),
  0, 'user A update of user B deload_history affects no rows');
select is(
  (with u as (update kilo.fatigue_checkins set status = 'hacked' where id = 'fb' returning 1) select count(*)::int from u),
  0, 'user A update of user B fatigue_checkins affects no rows');

-- ---------------------------------------------------------------------------
-- As user A: DELETE of user B rows must affect zero rows.
-- ---------------------------------------------------------------------------
select is(
  (with d as (delete from kilo.weight_entries where id = 'wb' returning 1) select count(*)::int from d),
  0, 'user A delete of user B weight_entries affects no rows');
select is(
  (with d as (delete from kilo.workout_notes where id = 'nb' returning 1) select count(*)::int from d),
  0, 'user A delete of user B workout_notes affects no rows');
select is(
  (with d as (delete from kilo.user_profile where user_id = '22222222-2222-2222-2222-222222222222' returning 1) select count(*)::int from d),
  0, 'user A delete of user B user_profile affects no rows');
select is(
  (with d as (delete from kilo.feature_toggles where user_id = '22222222-2222-2222-2222-222222222222' returning 1) select count(*)::int from d),
  0, 'user A delete of user B feature_toggles affects no rows');
select is(
  (with d as (delete from kilo.weight_goal where user_id = '22222222-2222-2222-2222-222222222222' returning 1) select count(*)::int from d),
  0, 'user A delete of user B weight_goal affects no rows');
select is(
  (with d as (delete from kilo.deload_history where id = 'db' returning 1) select count(*)::int from d),
  0, 'user A delete of user B deload_history affects no rows');
select is(
  (with d as (delete from kilo.fatigue_checkins where id = 'fb' returning 1) select count(*)::int from d),
  0, 'user A delete of user B fatigue_checkins affects no rows');

-- ---------------------------------------------------------------------------
-- An owner-spoofed insert (writing user B's id while authenticated as A)
-- must be rejected by the with-check policy.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into kilo.weight_entries (user_id, id, weight_value) values ('22222222-2222-2222-2222-222222222222', 'spoof', 1)$$,
  '42501',
  null,
  'user A cannot insert a row owned by user B');
select throws_ok(
  $$insert into kilo.workout_notes (user_id, id) values ('22222222-2222-2222-2222-222222222222', 'spoof')$$,
  '42501',
  null,
  'user A cannot insert a workout_notes row owned by user B');

-- ---------------------------------------------------------------------------
-- Confirm user B's rows still exist (untouched by user A) by reading as B.
-- ---------------------------------------------------------------------------
select pg_temp.login_as(:'user_b'::uuid);

select is(
  (select note from kilo.weight_entries where id = 'wb'),
  null, 'user B weight_entries row was not mutated by user A');
select is(
  (select count(*)::int from kilo.workout_notes where id = 'nb'),
  1, 'user B workout_notes row still exists after user A delete attempt');

select pg_temp.logout();

select * from finish();

rollback;
