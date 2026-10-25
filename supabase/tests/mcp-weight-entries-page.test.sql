-- mcp_weight_entries_page tests (issue #1628; docs/architecture/mcp-mvp.md 6.3).
-- Session lookup is replaced by temp tables exactly as in mcp-request-gate.test.sql.

begin;

select plan(29);

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

-- Seed (as table owner): ties on logged_at, a tombstone, another user's rows,
-- an unsupported entry type, null logged_at / date, and a range boundary.
insert into kilo.weight_entries (user_id, id, entry_type, date, logged_at, weight_value, note, deleted_at) values
  (:'user_a'::uuid, 'w1', 'weight', '2026-10-01', '2026-10-01 08:00:00+00', 180.5, 'private note', null),
  (:'user_a'::uuid, 'w2', 'weight', '2026-10-02', '2026-10-02 08:00:00+00', 181, null, null),
  (:'user_a'::uuid, 'w3', 'weight', '2026-10-02', '2026-10-02 08:00:00+00', 182, null, null),
  (:'user_a'::uuid, 'w4', 'weight', '2026-10-03', '2026-10-03 08:00:00+00', 190, null, now()),
  (:'user_a'::uuid, 'g1', 'goal',   '2026-10-04', '2026-10-04 08:00:00+00', 150, null, null),
  (:'user_a'::uuid, 'u1', 'weight', '2026-09-30', null, 179, null, null),
  (:'user_a'::uuid, 'u2', 'weight', null, null, 178, null, null),
  (:'user_b'::uuid, 'b1', 'weight', '2026-10-02', '2026-10-02 09:00:00+00', 99, null, null);

-- Privileges / contract ---------------------------------------------------
select is(has_function_privilege('anon', 'kilo.mcp_weight_entries_page(int,text,timestamptz,text,timestamptz,timestamptz)', 'EXECUTE'),
  false, 'not executable by anon');
select is(has_function_privilege('authenticated', 'kilo.mcp_weight_entries_page(int,text,timestamptz,text,timestamptz,timestamptz)', 'EXECUTE'),
  true, 'executable by authenticated');

-- First-party token is refused -------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', :'user_a', 'role', 'authenticated', 'session_id', :'sess_a')::text, true);
select set_config('request.jwt.claim.sub', :'user_a', true);
set local role authenticated;
select throws_ok($$select kilo.mcp_weight_entries_page(10)$$, '42501', null, 'first-party token refused');
reset role;

-- Owner filter, entry type, tombstones, order, columns ----------------------
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is((select jsonb_agg(i ->> 'id') from jsonb_array_elements(kilo.mcp_weight_entries_page(10) -> 'items') i),
  '["w3", "w2", "w1", "u2", "u1"]'::jsonb,
  'own live weight rows: dated first (tie on logged_at by id desc), undated last; no goal/tombstone/other user');
select is((select array_agg(k order by k) from jsonb_object_keys(kilo.mcp_weight_entries_page(10) -> 'items' -> 0) k),
  array['date','id','logged_at','value'], 'minimal columns only (no note)');
select is((kilo.mcp_weight_entries_page(10) -> 'items' -> 2 -> 'value'), '180.5'::jsonb, 'value is the stored number');
select is((kilo.mcp_weight_entries_page(10) -> 'items' -> 2 ->> 'date'), '2026-10-01', 'date-only returned verbatim');
select is((kilo.mcp_weight_entries_page(10) -> 'items' -> 3 -> 'date'), 'null'::jsonb, 'null date stays null');
select is((kilo.mcp_weight_entries_page(10) -> 'items' -> 4 -> 'logged_at'), 'null'::jsonb, 'null logged_at stays null');
select is((kilo.mcp_weight_entries_page(10) -> 'has_more'), 'false'::jsonb, 'has_more false at the end');

-- Keyset pagination across the dated/undated boundary -----------------------
select is((kilo.mcp_weight_entries_page(1) -> 'has_more'), 'true'::jsonb, 'has_more true when more rows exist');
select is(
  (select jsonb_agg(i ->> 'id') from jsonb_array_elements(
     kilo.mcp_weight_entries_page(2, 'dated', '2026-10-02 08:00:00+00', 'w2') -> 'items') i),
  '["w1", "u2"]'::jsonb, 'dated cursor resumes strictly after the tie-break row and continues into undated');
select is(
  (select jsonb_agg(i ->> 'id') from jsonb_array_elements(
     kilo.mcp_weight_entries_page(5, 'undated', null, 'u2') -> 'items') i),
  '["u1"]'::jsonb, 'undated cursor resumes by id desc');

-- Ranges ([from, to) on logged_at; undated rows excluded) ---------------------
select is(
  (select jsonb_agg(i ->> 'id') from jsonb_array_elements(
     kilo.mcp_weight_entries_page(10, null, null, null, '2026-10-01 08:00:00+00', '2026-10-02 08:00:00+00') -> 'items') i),
  '["w1"]'::jsonb, 'range is inclusive of from, exclusive of to, and drops null logged_at');
select is(
  (select jsonb_agg(i ->> 'id') from jsonb_array_elements(
     kilo.mcp_weight_entries_page(10, null, null, null, '2026-10-02 08:00:00+00', '2026-10-02 08:00:01+00') -> 'items') i),
  '["w3", "w2"]'::jsonb, 'equal timestamps inside a range keep id order');

-- Argument validation -----------------------------------------------------
select throws_ok($$select kilo.mcp_weight_entries_page(0)$$, 'MC003', null, 'limit 0 rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(101)$$, 'MC003', null, 'limit 101 rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(10, 'sideways', now(), 'w1')$$, 'MC003', null, 'unknown phase rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(10, 'dated', null, 'w1')$$, 'MC003', null, 'dated cursor without a position rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(10, null, now(), null)$$, 'MC003', null, 'position without a phase rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(10, null, null, null, now(), null)$$, 'MC003', null, 'one-sided range rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(10, null, null, null, now(), now())$$, 'MC003', null, 'empty range rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(10, null, null, null, now(), now() - interval '1 day')$$, 'MC003', null, 'reversed range rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(10, null, null, null, now() - interval '367 days', now())$$, 'MC003', null, 'range over 366 days rejected');
select throws_ok($$select kilo.mcp_weight_entries_page(10, 'undated', null, 'u2', now() - interval '1 day', now())$$, 'MC003', null, 'undated cursor with a range rejected');

-- Byte budget: 100 rows with 512 x U+0001 ids are 6 bytes per character encoded
reset role;
insert into kilo.weight_entries (user_id, id, logged_at, weight_value)
select :'user_a'::uuid, repeat(chr(1), 500) || lpad(g::text, 3, '0'), '2026-08-01 00:00:00+00'::timestamptz - g * interval '1 second', 170
  from generate_series(1, 100) g;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select ok(jsonb_array_length(kilo.mcp_weight_entries_page(100) -> 'items') between 5 and 99
  and (kilo.mcp_weight_entries_page(100) -> 'has_more') = 'true'::jsonb
  and octet_length((kilo.mcp_weight_entries_page(100) -> 'items')::text) < 262144,
  'encoded byte budget trims heavy rows and reports has_more');

-- Gate inside the RPC: revoke the session, then withdraw consent ----------
reset role;
update fake_refresh set revoked = true;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select throws_ok($$select kilo.mcp_weight_entries_page(10)$$, 'MC001', null, 'revoked session rejected inside the RPC');
reset role;
update fake_refresh set revoked = false;
update kilo.consent_state set status = 'withdrawn' where user_id = :'user_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select throws_ok($$select kilo.mcp_weight_entries_page(10)$$, 'MC002', null, 'withdrawn consent rejected inside the RPC');
reset role;
update kilo.consent_state set status = 'granted' where user_id = :'user_a'::uuid;

-- Quota ---------------------------------------------------------------------
insert into kilo.rate_limit_hits (bucket) select 'mcp:data:' || :'user_a' || ':m' from generate_series(1, 30);
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select throws_ok($$select kilo.mcp_weight_entries_page(10)$$, 'MC004', null, 'exhausted data quota rejected');
reset role;

select * from finish();
rollback;
