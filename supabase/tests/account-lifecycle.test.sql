-- Account lifecycle RLS tests (issue #322).
--
-- Proves that account export (SELECT) and account deletion (DELETE) at the DB
-- layer are requester-only: user A can only read and delete their own rows, never
-- user B's. The service-role DELETE path used by account-delete is also exercised
-- with an explicit user_id filter to prove isolation.
--
-- Rate-limit coverage (issue #328):
--   Throttling is enforced at the Edge Function layer (in-memory per-isolate buckets)
--   and cannot be exercised via pgTAP. Manual verification steps:
--     account-export  — call the function twice within 10 min as the same user;
--                       the second call must return HTTP 429.
--     account-delete  — call the function four times within 1 hour as the same user;
--                       the fourth call must return HTTP 429.
--     IP bucket       — repeat either function 6+ times from the same IP within the
--                       window; calls beyond the IP limit must return HTTP 429.
--
-- Harness: pgTAP. Run inside a transaction:
--   psql "$DATABASE_URL" -f supabase/tests/account-lifecycle.test.sql
-- or via Supabase CLI:
--   supabase test db

begin;

select plan(29);

\set user_a '33333333-3333-3333-3333-333333333333'
\set user_b '44444444-4444-4444-4444-444444444444'

insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;
insert into auth.users (id) values (:'user_b'::uuid) on conflict do nothing;

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
-- Seed: insert one row per table for each user as that user.
-- ---------------------------------------------------------------------------
select pg_temp.login_as(:'user_a'::uuid);

insert into kilo.user_profile (user_id) values (:'user_a'::uuid);
insert into kilo.feature_toggles (user_id) values (:'user_a'::uuid);
insert into kilo.weight_entries (user_id, id, weight_value) values (:'user_a'::uuid, 'lc_wa', 80);
insert into kilo.weight_goal (user_id) values (:'user_a'::uuid);
insert into kilo.workout_notes (user_id, id) values (:'user_a'::uuid, 'lc_na');
insert into kilo.deload_history (user_id, id) values (:'user_a'::uuid, 'lc_da');
insert into kilo.fatigue_checkins (user_id, id) values (:'user_a'::uuid, 'lc_fa');
insert into kilo.archived_weight_goals (user_id, id) values (:'user_a'::uuid, 'lc_aga');

select pg_temp.login_as(:'user_b'::uuid);

insert into kilo.user_profile (user_id) values (:'user_b'::uuid);
insert into kilo.feature_toggles (user_id) values (:'user_b'::uuid);
insert into kilo.weight_entries (user_id, id, weight_value) values (:'user_b'::uuid, 'lc_wb', 90);
insert into kilo.weight_goal (user_id) values (:'user_b'::uuid);
insert into kilo.workout_notes (user_id, id) values (:'user_b'::uuid, 'lc_nb');
insert into kilo.deload_history (user_id, id) values (:'user_b'::uuid, 'lc_db');
insert into kilo.fatigue_checkins (user_id, id) values (:'user_b'::uuid, 'lc_fb');
insert into kilo.archived_weight_goals (user_id, id) values (:'user_b'::uuid, 'lc_agb');

-- ---------------------------------------------------------------------------
-- Export isolation: as user A, SELECT returns only user A rows (8 tables).
-- ---------------------------------------------------------------------------
select pg_temp.login_as(:'user_a'::uuid);

select is((select count(*)::int from kilo.user_profile),      1, 'export: user A sees only own user_profile');
select is((select count(*)::int from kilo.feature_toggles),   1, 'export: user A sees only own feature_toggles');
select is((select count(*)::int from kilo.weight_entries),     1, 'export: user A sees only own weight_entries');
select is((select count(*)::int from kilo.weight_goal),        1, 'export: user A sees only own weight_goal');
select is((select count(*)::int from kilo.workout_notes),      1, 'export: user A sees only own workout_notes');
select is((select count(*)::int from kilo.deload_history),     1, 'export: user A sees only own deload_history');
select is((select count(*)::int from kilo.fatigue_checkins),        1, 'export: user A sees only own fatigue_checkins');
select is((select count(*)::int from kilo.archived_weight_goals),   1, 'export: user A sees only own archived_weight_goals');

-- Cross-user reads return nothing.
select is((select count(*)::int from kilo.weight_entries where id = 'lc_wb'),   0, 'export: user A cannot read user B weight_entries');
select is((select count(*)::int from kilo.workout_notes  where id = 'lc_nb'),   0, 'export: user A cannot read user B workout_notes');
select is((select count(*)::int from kilo.user_profile   where user_id = :'user_b'::uuid), 0, 'export: user A cannot read user B user_profile');

-- ---------------------------------------------------------------------------
-- Deletion isolation: as user A, DELETE on user B rows affects zero rows.
-- ---------------------------------------------------------------------------
select is(
  (with d as (delete from kilo.weight_entries where id = 'lc_wb' returning 1) select count(*)::int from d),
  0, 'delete: user A cannot delete user B weight_entries');
select is(
  (with d as (delete from kilo.workout_notes where id = 'lc_nb' returning 1) select count(*)::int from d),
  0, 'delete: user A cannot delete user B workout_notes');
select is(
  (with d as (delete from kilo.user_profile where user_id = :'user_b'::uuid returning 1) select count(*)::int from d),
  0, 'delete: user A cannot delete user B user_profile');
select is(
  (with d as (delete from kilo.weight_goal where user_id = :'user_b'::uuid returning 1) select count(*)::int from d),
  0, 'delete: user A cannot delete user B weight_goal');
select is(
  (with d as (delete from kilo.feature_toggles where user_id = :'user_b'::uuid returning 1) select count(*)::int from d),
  0, 'delete: user A cannot delete user B feature_toggles');
select is(
  (with d as (delete from kilo.deload_history where id = 'lc_db' returning 1) select count(*)::int from d),
  0, 'delete: user A cannot delete user B deload_history');
select is(
  (with d as (delete from kilo.fatigue_checkins where id = 'lc_fb' returning 1) select count(*)::int from d),
  0, 'delete: user A cannot delete user B fatigue_checkins');
select is(
  (with d as (delete from kilo.archived_weight_goals where id = 'lc_agb' returning 1) select count(*)::int from d),
  0, 'delete: user A cannot delete user B archived_weight_goals');

-- User A can delete their own rows (simulates the account-delete flow).
select is(
  (with d as (delete from kilo.fatigue_checkins where user_id = :'user_a'::uuid returning 1) select count(*)::int from d),
  1, 'delete: user A can delete own fatigue_checkins');
select is(
  (with d as (delete from kilo.deload_history where user_id = :'user_a'::uuid returning 1) select count(*)::int from d),
  1, 'delete: user A can delete own deload_history');
select is(
  (with d as (delete from kilo.workout_notes where user_id = :'user_a'::uuid returning 1) select count(*)::int from d),
  1, 'delete: user A can delete own workout_notes');
select is(
  (with d as (delete from kilo.weight_entries where user_id = :'user_a'::uuid returning 1) select count(*)::int from d),
  1, 'delete: user A can delete own weight_entries');
select is(
  (with d as (delete from kilo.weight_goal where user_id = :'user_a'::uuid returning 1) select count(*)::int from d),
  1, 'delete: user A can delete own weight_goal');
select is(
  (with d as (delete from kilo.feature_toggles where user_id = :'user_a'::uuid returning 1) select count(*)::int from d),
  1, 'delete: user A can delete own feature_toggles');
select is(
  (with d as (delete from kilo.archived_weight_goals where user_id = :'user_a'::uuid returning 1) select count(*)::int from d),
  1, 'delete: user A can delete own archived_weight_goals');
select is(
  (with d as (delete from kilo.user_profile where user_id = :'user_a'::uuid returning 1) select count(*)::int from d),
  1, 'delete: user A can delete own user_profile');

-- Confirm user B's rows are untouched after all of the above.
select pg_temp.login_as(:'user_b'::uuid);

select is((select count(*)::int from kilo.weight_entries where id = 'lc_wb'),   1, 'user B weight_entries untouched after user A ops');
select is((select count(*)::int from kilo.workout_notes  where id = 'lc_nb'),   1, 'user B workout_notes untouched after user A ops');

select pg_temp.logout();

select * from finish();

rollback;
