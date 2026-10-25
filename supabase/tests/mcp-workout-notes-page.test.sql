-- mcp_workout_notes_page tests (issue #1627; docs/architecture/mcp-mvp.md 6.3).
-- Session lookup is replaced by temp tables exactly as in mcp-request-gate.test.sql.

begin;

select plan(24);

\set user_a '9a000000-0000-0000-0000-00000000000a'
\set user_b '9b000000-0000-0000-0000-00000000000b'
\set sess_a '9a111111-1111-1111-1111-111111111111'

insert into auth.users (id) values (:'user_a'::uuid), (:'user_b'::uuid) on conflict do nothing;

create temp table fake_sessions (
  id uuid primary key, user_id uuid not null,
  created_at timestamptz not null default now(), not_after timestamptz, oauth_client_id text);
create temp table fake_refresh (token text primary key, session_id uuid not null, revoked boolean not null);
grant all on fake_sessions, fake_refresh to public;

create or replace function kilo.mcp_session_created_at(p_session_id uuid, p_user_id uuid, p_client_id text)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select s.created_at from pg_temp.fake_sessions s
   where s.id = p_session_id and s.user_id = p_user_id
     and (s.not_after is null or s.not_after > now())
     and exists (select 1 from pg_temp.fake_refresh r where r.session_id = s.id and not r.revoked)
$$;

create or replace function pg_temp.as_client(p_user uuid, p_session uuid, p_client text default 'client-1')
  returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_user::text, 'role', 'authenticated',
      'session_id', p_session::text, 'client_id', p_client))::text, true);
  execute 'set local role authenticated';
end $$;

update kilo.health_sync_config set mode = 'consent_required', required_material_version = 1 where id = true;
insert into kilo.consent_state (user_id, status, current_catalog_revision, current_material_version, granted_at)
values (:'user_a'::uuid, 'granted', 1, 1, now() - interval '1 hour');
insert into fake_sessions (id, user_id, created_at) values (:'sess_a'::uuid, :'user_a'::uuid, now() - interval '30 minutes');
insert into fake_refresh values ('t1', :'sess_a'::uuid, false);

-- Seed (as table owner): ties on updated_at, a tombstone, another user's row,
-- a null title/saved_at, an oversized raw text and control-character titles.
insert into kilo.workout_notes (user_id, id, title, raw_text, saved_at, updated_at, is_current, deleted_at) values
  (:'user_a'::uuid, 'n1', 'One', 'raw one', now() - interval '5 days', now() - interval '4 days', false, null),
  (:'user_a'::uuid, 'n2', 'Two', 'raw two', null, now() - interval '3 days', true, null),
  (:'user_a'::uuid, 'n3', null, repeat('x', 5000), null, now() - interval '3 days', false, null),
  (:'user_a'::uuid, 'n4', 'Gone', 'gone', null, now() - interval '2 days', false, now()),
  (:'user_b'::uuid, 'b1', 'Other', 'other raw', null, now() - interval '1 day', false, null);

select set_config('t.n3_updated', (select updated_at::text from kilo.workout_notes where id = 'n3' and user_id = :'user_a'::uuid), false);

-- Privileges / contract ---------------------------------------------------
select is(has_function_privilege('anon', 'kilo.mcp_workout_notes_page(int,timestamptz,timestamptz,text,boolean)', 'EXECUTE'),
  false, 'not executable by anon');
select is(has_function_privilege('authenticated', 'kilo.mcp_workout_notes_page(int,timestamptz,timestamptz,text,boolean)', 'EXECUTE'),
  true, 'executable by authenticated');

-- First-party token is refused -------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', :'user_a', 'role', 'authenticated', 'session_id', :'sess_a')::text, true);
select set_config('request.jwt.claim.sub', :'user_a', true);
set local role authenticated;
select throws_ok($$select kilo.mcp_workout_notes_page(10)$$, '42501', null, 'first-party token refused');
reset role;

-- Owner filter, tombstones, order, columns --------------------------------
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is((select jsonb_array_length(kilo.mcp_workout_notes_page(10) -> 'items')), 3, 'own live rows only');
select is((select jsonb_agg(i ->> 'id') from jsonb_array_elements(kilo.mcp_workout_notes_page(10) -> 'items') i),
  '["n3", "n2", "n1"]'::jsonb, 'ordered by updated_at desc, id desc (tie broken by id)');
select is((kilo.mcp_workout_notes_page(10) -> 'items' -> 0) ? 'raw_text', false, 'raw text omitted by default');
select is((select array_agg(k order by k) from jsonb_object_keys(kilo.mcp_workout_notes_page(10) -> 'items' -> 0) k),
  array['id','is_current','saved_at','title','updated_at'], 'minimal columns only');
select is((kilo.mcp_workout_notes_page(10) -> 'items' -> 0 -> 'title'), 'null'::jsonb, 'null title preserved');
select is((kilo.mcp_workout_notes_page(10) -> 'has_more'), 'false'::jsonb, 'has_more false at the end');

-- Raw text opt-in ---------------------------------------------------------
select is((kilo.mcp_workout_notes_page(10, null, null, null, true) -> 'items' -> 0 ->> 'raw_text_chars')::int, 5000, 'reports full char count');
select is(char_length(kilo.mcp_workout_notes_page(10, null, null, null, true) -> 'items' -> 0 ->> 'raw_text'), 4000, 'raw text bounded to 4000 in SQL');
select is((kilo.mcp_workout_notes_page(10, null, null, null, true) -> 'items' -> 0 -> 'raw_text_truncated'), 'true'::jsonb, 'truncation flagged');
select is((kilo.mcp_workout_notes_page(10, null, null, null, true) -> 'items' -> 1 -> 'raw_text_truncated'), 'false'::jsonb, 'short note not truncated');

-- Keyset pagination -------------------------------------------------------
select is((kilo.mcp_workout_notes_page(1) -> 'has_more'), 'true'::jsonb, 'has_more true when more rows exist');
select is(
  (select jsonb_agg(i ->> 'id') from jsonb_array_elements(
     kilo.mcp_workout_notes_page(2, now(), current_setting('t.n3_updated')::timestamptz, 'n3') -> 'items') i),
  '["n2", "n1"]'::jsonb, 'cursor resumes strictly after the tie-break row');

-- Argument validation -----------------------------------------------------
select throws_ok($$select kilo.mcp_workout_notes_page(0)$$, 'MC003', null, 'limit 0 rejected');
select throws_ok($$select kilo.mcp_workout_notes_page(101)$$, 'MC003', null, 'limit 101 rejected');
select throws_ok($$select kilo.mcp_workout_notes_page(26, null, null, null, true)$$, 'MC003', null, 'limit 26 rejected with raw text');
select throws_ok($$select kilo.mcp_workout_notes_page(10, now(), now(), null)$$, 'MC003', null, 'half a cursor rejected');

-- Byte budget: 25 rows of 4096 x U+0001 titles are 6 bytes each when encoded
reset role;
insert into kilo.workout_notes (user_id, id, title, updated_at)
select :'user_a'::uuid, 'big' || g, repeat(chr(1), 4096), now() - interval '10 days' - g * interval '1 second'
  from generate_series(1, 25) g;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(jsonb_array_length(kilo.mcp_workout_notes_page(25) -> 'items'), 11,
  'encoded budget (6 bytes per U+0001) keeps 3 small + 8 of 25 heavy rows');
select is((kilo.mcp_workout_notes_page(25) -> 'has_more'), 'true'::jsonb, 'budget trim reports has_more');

-- Gate inside the RPC: revoke the session, then withdraw consent ----------
reset role;
update fake_refresh set revoked = true;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select throws_ok($$select kilo.mcp_workout_notes_page(10)$$, 'MC001', null, 'revoked session rejected inside the RPC');
reset role;
update fake_refresh set revoked = false;
update kilo.consent_state set status = 'withdrawn' where user_id = :'user_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select throws_ok($$select kilo.mcp_workout_notes_page(10)$$, 'MC002', null, 'withdrawn consent rejected inside the RPC');
reset role;
update kilo.consent_state set status = 'granted' where user_id = :'user_a'::uuid;

-- Quota ---------------------------------------------------------------------
insert into kilo.rate_limit_hits (bucket) select 'mcp:data:' || :'user_a' || ':m' from generate_series(1, 30);
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select throws_ok($$select kilo.mcp_workout_notes_page(10)$$, 'MC004', null, 'exhausted data quota rejected');
reset role;

select * from finish();
rollback;
