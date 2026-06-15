-- Harness-free RLS isolation check for the note-first schema (issue #316).
--
-- This is the manual verification path for environments without pgTAP or the
-- Supabase test runner. It asserts cross-user isolation using plain SQL plus
-- RAISE EXCEPTION, so it runs on any Supabase Postgres that has the
-- note-first migration applied:
--
--   psql "$DATABASE_URL" -f supabase/tests/rls_note_first_manual_check.sql
--
-- It runs entirely inside a transaction and rolls back, leaving no rows.
-- The script impersonates Supabase auth by setting role `authenticated` and
-- the JWT `sub` claim that `auth.uid()` reads. It is owner-run for setup
-- (auth.users seeding) and switches identities to exercise RLS.

begin;

\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

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

-- Seed one owned row per table as each user (also proves owner inserts pass).
select pg_temp.login_as(:'user_a'::uuid);
insert into kilo.user_profile (user_id) values (:'user_a'::uuid);
insert into kilo.feature_toggles (user_id) values (:'user_a'::uuid);
insert into kilo.weight_entries (user_id, id, weight_value) values (:'user_a'::uuid, 'wa', 80);
insert into kilo.weight_goal (user_id) values (:'user_a'::uuid);
insert into kilo.workout_notes (user_id, id) values (:'user_a'::uuid, 'na');
insert into kilo.deload_history (user_id, id) values (:'user_a'::uuid, 'da');
insert into kilo.fatigue_checkins (user_id, id) values (:'user_a'::uuid, 'fa');

select pg_temp.login_as(:'user_b'::uuid);
insert into kilo.user_profile (user_id) values (:'user_b'::uuid);
insert into kilo.feature_toggles (user_id) values (:'user_b'::uuid);
insert into kilo.weight_entries (user_id, id, weight_value) values (:'user_b'::uuid, 'wb', 90);
insert into kilo.weight_goal (user_id) values (:'user_b'::uuid);
insert into kilo.workout_notes (user_id, id) values (:'user_b'::uuid, 'nb');
insert into kilo.deload_history (user_id, id) values (:'user_b'::uuid, 'db');
insert into kilo.fatigue_checkins (user_id, id) values (:'user_b'::uuid, 'fb');

-- As user A, assert isolation across read/update/delete and spoofed insert.
select pg_temp.login_as(:'user_a'::uuid);

do $$
declare
  v int;
begin
  -- SELECT isolation: A sees exactly its own rows.
  select count(*) into v from kilo.weight_entries;
  if v <> 1 then raise exception 'weight_entries select leak: % visible', v; end if;
  select count(*) into v from kilo.workout_notes;
  if v <> 1 then raise exception 'workout_notes select leak: % visible', v; end if;
  select count(*) into v from kilo.user_profile where user_id = '22222222-2222-2222-2222-222222222222';
  if v <> 0 then raise exception 'user_profile cross-read leak'; end if;

  -- UPDATE isolation: zero rows of B affected.
  update kilo.weight_entries set note = 'hacked' where id = 'wb';
  get diagnostics v = row_count;
  if v <> 0 then raise exception 'weight_entries cross-update leak'; end if;
  update kilo.workout_notes set raw_text = 'hacked' where id = 'nb';
  get diagnostics v = row_count;
  if v <> 0 then raise exception 'workout_notes cross-update leak'; end if;

  -- DELETE isolation: zero rows of B affected.
  delete from kilo.deload_history where id = 'db';
  get diagnostics v = row_count;
  if v <> 0 then raise exception 'deload_history cross-delete leak'; end if;
  delete from kilo.fatigue_checkins where id = 'fb';
  get diagnostics v = row_count;
  if v <> 0 then raise exception 'fatigue_checkins cross-delete leak'; end if;

  -- WITH CHECK: spoofed owner insert must fail.
  begin
    insert into kilo.weight_entries (user_id, id, weight_value)
      values ('22222222-2222-2222-2222-222222222222', 'spoof', 1);
    raise exception 'spoofed insert was allowed';
  exception when insufficient_privilege then
    null; -- expected
  end;

  raise notice 'RLS isolation check passed: user A cannot read or mutate user B rows';
end;
$$;

rollback;
