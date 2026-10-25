-- MCP request gate tests (issue #1625; docs/architecture/mcp-mvp.md section 5/6.1).
--
-- GoTrue is not running here, so fake_sessions / fake_refresh are created
-- as minimal stand-ins inside this rolled-back transaction. The gate reads them
-- through dynamic SQL, so the same statements run against the real tables.
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/mcp-request-gate.test.sql
-- or:  supabase test db

begin;

select plan(29);

\set user_a '9a000000-0000-0000-0000-00000000000a'
\set user_b '9b000000-0000-0000-0000-00000000000b'
\set sess_a '9a111111-1111-1111-1111-111111111111'
\set sess_b '9b222222-2222-2222-2222-222222222222'

insert into auth.users (id) values (:'user_a'::uuid), (:'user_b'::uuid) on conflict do nothing;

-- GoTrue is not running here and the test role cannot create tables in the auth
-- schema, so the session lookup is replaced -- inside this rolled-back
-- transaction only -- by one that reads temp tables with the same semantics.
-- The real function is checked below for degrading to "inactive" when the auth
-- tables are absent; its SQL against real GoTrue tables is exercised by the
-- local-stack probes (docs/operations/mcp-mvp.md).
create temp table fake_sessions (
  id uuid primary key, user_id uuid not null,
  created_at timestamptz not null default now(), not_after timestamptz, oauth_client_id text);
create temp table fake_refresh (token text primary key, session_id uuid not null, revoked boolean not null);
grant all on fake_sessions, fake_refresh to public;

select is(kilo.mcp_session_created_at(gen_random_uuid(), gen_random_uuid(), 'c'), null,
  'real session lookup returns null (inactive) when GoTrue tables are absent');

create or replace function kilo.mcp_session_created_at(p_session_id uuid, p_user_id uuid, p_client_id text)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select s.created_at from pg_temp.fake_sessions s
   where s.id = p_session_id and s.user_id = p_user_id
     and (s.not_after is null or s.not_after > now())
     and (s.oauth_client_id is null or s.oauth_client_id = p_client_id)
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

create or replace function pg_temp.status() returns text language sql as $$
  select kilo.mcp_request_gate() ->> 'status'
$$;
grant execute on function pg_temp.status() to authenticated;

update kilo.health_sync_config set mode = 'consent_required', required_material_version = 1 where id = true;

insert into kilo.consent_state (user_id, status, current_catalog_revision, current_material_version, granted_at)
values (:'user_a'::uuid, 'granted', 1, 1, now() - interval '1 hour');

insert into fake_sessions (id, user_id, created_at) values (:'sess_a'::uuid, :'user_a'::uuid, now() - interval '30 minutes');
insert into fake_refresh (token, revoked, session_id)
values ('t-a1', true, :'sess_a'::uuid), ('t-a2', false, :'sess_a'::uuid);

-- Privileges --------------------------------------------------------------
select is(has_function_privilege('authenticated', 'kilo.mcp_gate_status()', 'EXECUTE'), false,
  'mcp_gate_status is not executable by authenticated');
select is(has_function_privilege('anon', 'kilo.mcp_request_gate()', 'EXECUTE'), false,
  'mcp_request_gate is not executable by anon');
select is(has_function_privilege('authenticated', 'kilo.mcp_request_gate()', 'EXECUTE'), true,
  'mcp_request_gate is executable by authenticated');

-- is_oauth_client_token ---------------------------------------------------
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(kilo.is_oauth_client_token(), true, 'a client_id claim marks an OAuth client token');
reset role;
select set_config('request.jwt.claims', '{"sub":"x","role":"authenticated"}', true);
select is(kilo.is_oauth_client_token(), false, 'a first-party token is not an OAuth client token');
select set_config('request.jwt.claims', '', true);
select is(kilo.is_oauth_client_token(), false, 'no claims is not an OAuth client token');

-- Statuses ----------------------------------------------------------------
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'ok', 'active session + current consent -> ok');
select is(kilo.mcp_request_gate() ->> 'consent_granted_at' is not null, true, 'ok carries consent_granted_at');
reset role;

-- first-party token (no client_id) is never ok
select set_config('request.jwt.claims',
  json_build_object('sub', :'user_a', 'role', 'authenticated', 'session_id', :'sess_a')::text, true);
set local role authenticated;
select is(pg_temp.status(), 'session_inactive', 'first-party token (no client_id) -> session_inactive');
reset role;

-- malformed claims
select set_config('request.jwt.claims',
  json_build_object('sub', 'not-a-uuid', 'role', 'authenticated', 'session_id', :'sess_a', 'client_id', 'c')::text, true);
set local role authenticated;
select is(pg_temp.status(), 'session_inactive', 'malformed sub -> session_inactive');
reset role;

-- another user's session id
select pg_temp.as_client(:'user_b'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'session_inactive', 'session belonging to another user -> session_inactive');
reset role;

-- session missing
select pg_temp.as_client(:'user_a'::uuid, '9a999999-9999-9999-9999-999999999999'::uuid);
select is(pg_temp.status(), 'session_inactive', 'unknown session -> session_inactive');
reset role;

-- all refresh tokens revoked (revokeGrant marking tokens only)
update fake_refresh set revoked = true where session_id = :'sess_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'session_inactive', 'every refresh token revoked -> session_inactive');
reset role;
update fake_refresh set revoked = false where token = 't-a2';

-- refresh tokens deleted
delete from fake_refresh where session_id = :'sess_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'session_inactive', 'refresh tokens deleted -> session_inactive');
reset role;
insert into fake_refresh (token, revoked, session_id) values ('t-a3', false, :'sess_a'::uuid);

-- expired session
update fake_sessions set not_after = now() - interval '1 minute' where id = :'sess_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'session_inactive', 'expired session -> session_inactive');
reset role;
update fake_sessions set not_after = now() + interval '1 hour' where id = :'sess_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'ok', 'future not_after still ok');
reset role;

-- session deleted (disconnect / sign-out)
delete from fake_sessions where id = :'sess_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'session_inactive', 'session row deleted -> session_inactive');
reset role;
insert into fake_sessions (id, user_id, created_at) values (:'sess_a'::uuid, :'user_a'::uuid, now() - interval '30 minutes');

-- OAuth client column (when GoTrue exposes it) must equal the client_id claim
update fake_sessions set oauth_client_id = '00000000-0000-0000-0000-0000000000c1' where id = :'sess_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid, '00000000-0000-0000-0000-0000000000c1');
select is(pg_temp.status(), 'ok', 'matching oauth_client_id -> ok');
reset role;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid, '00000000-0000-0000-0000-0000000000c2');
select is(pg_temp.status(), 'session_inactive', 'client_id claim differing from the session client -> session_inactive');
reset role;
update fake_sessions set oauth_client_id = null where id = :'sess_a'::uuid;

-- consent states
update kilo.consent_state set status = 'withdrawn' where user_id = :'user_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'consent_required', 'withdrawn consent -> consent_required');
reset role;
update kilo.consent_state set status = 'needs_reconsent' where user_id = :'user_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'consent_required', 'needs_reconsent -> consent_required');
reset role;
update kilo.consent_state set status = 'deletion_pending' where user_id = :'user_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'consent_required', 'deletion_pending -> consent_required');
reset role;
update kilo.consent_state set status = 'granted', current_material_version = 1 where user_id = :'user_a'::uuid;

update kilo.health_sync_config set required_material_version = 2 where id = true;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'consent_required', 'stale material version -> consent_required');
reset role;
update kilo.health_sync_config set required_material_version = 1 where id = true;

update kilo.health_sync_config set mode = 'paused' where id = true;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'consent_required', 'paused mode -> consent_required');
reset role;

-- legacy mode is NOT permissive: no consent record -> consent_required
update kilo.health_sync_config set mode = 'legacy' where id = true;
insert into fake_sessions (id, user_id) values (:'sess_b'::uuid, :'user_b'::uuid) on conflict do nothing;
insert into fake_refresh (token, revoked, session_id) values ('t-b1', false, :'sess_b'::uuid);
select pg_temp.as_client(:'user_b'::uuid, :'sess_b'::uuid);
select is(pg_temp.status(), 'consent_required', 'legacy mode without a consent record -> consent_required');
reset role;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'ok', 'legacy mode with a current grant -> ok');
reset role;
update kilo.health_sync_config set mode = 'consent_required' where id = true;

-- regrant after session creation -> stale
update kilo.consent_state set granted_at = now() where user_id = :'user_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'consent_stale', 'session older than the current grant -> consent_stale');
reset role;
update kilo.consent_state set granted_at = now() - interval '1 hour' where user_id = :'user_a'::uuid;

-- account deleted
delete from auth.users where id = :'user_a'::uuid;
select pg_temp.as_client(:'user_a'::uuid, :'sess_a'::uuid);
select is(pg_temp.status(), 'account_missing', 'deleted account -> account_missing');
reset role;


select * from finish();
rollback;
