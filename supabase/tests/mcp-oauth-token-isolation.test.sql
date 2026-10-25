-- MCP OAuth-token isolation tests (issue #1625; docs/architecture/mcp-mvp.md 6.2).
--
-- An OAuth access token (a JWT carrying `client_id`) has the same PostgREST
-- reach as a first-party session unless Kilo denies it. These tests run as the
-- `authenticated` role with such a claim and prove the denial, then assert the
-- catalog so a table or function added later cannot silently reopen the path.
--
-- Run: psql "$DATABASE_URL" -f supabase/tests/mcp-oauth-token-isolation.test.sql
-- or:  supabase test db

begin;

select plan(22);

\set user_a '9c000000-0000-0000-0000-00000000000c'

insert into auth.users (id) values (:'user_a'::uuid) on conflict do nothing;

create or replace function pg_temp.as_user(p_user uuid, p_client text default null)
  returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_user::text, 'role', 'authenticated',
      'session_id', '9c111111-1111-1111-1111-111111111111', 'client_id', p_client))::text, true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role authenticated';
end $$;

update kilo.health_sync_config set mode = 'legacy' where id = true;

insert into kilo.weight_entries (user_id, id, weight_value) values (:'user_a'::uuid, 'w-iso', 80);
insert into kilo.workout_notes (user_id, id, raw_text) values (:'user_a'::uuid, 'n-iso', 'squat 5x5');
insert into kilo.user_profile (user_id) values (:'user_a'::uuid) on conflict do nothing;

-- First-party control: the same user reads the rows ------------------------
select pg_temp.as_user(:'user_a'::uuid);
select is((select count(*)::int from kilo.weight_entries), 1, 'first-party token reads its weight rows');
select is((select count(*)::int from kilo.workout_notes), 1, 'first-party token reads its workout notes');
reset role;

-- OAuth token: nothing readable, nothing writable -------------------------
select pg_temp.as_user(:'user_a'::uuid, 'client-1');
select is((select count(*)::int from kilo.weight_entries), 0, 'OAuth token reads 0 weight rows');
select is((select count(*)::int from kilo.workout_notes), 0, 'OAuth token reads 0 workout notes');
select is((select count(*)::int from kilo.user_profile), 0, 'OAuth token reads 0 profile rows');
select is((select count(*)::int from kilo.consent_state), 0, 'OAuth token reads 0 consent_state rows');

select throws_ok(
  $$insert into kilo.weight_entries (user_id, id, weight_value) values ('9c000000-0000-0000-0000-00000000000c', 'w-bad', 1)$$,
  '42501', null, 'OAuth token cannot insert weight rows');
select is_empty($$update kilo.workout_notes set raw_text = 'x' returning 1$$,
  'OAuth token cannot update workout notes');
select is_empty($$delete from kilo.weight_entries returning 1$$,
  'OAuth token cannot delete weight rows');

-- Writer and gated RPCs refuse an OAuth token ------------------------------
select throws_ok($$select kilo.consent_withdraw()$$, '42501', null, 'consent_withdraw refuses an OAuth token');
select throws_ok($$select kilo.consent_grant(1)$$, '42501', null, 'consent_grant refuses an OAuth token');
select throws_ok($$select kilo.health_sync_preflight()$$, '42501', null, 'health_sync_preflight refuses an OAuth token');
select throws_ok(
  $$select kilo.record_product_measurement_event('00000000000000000000000000000000', '00000000000000000000000000000000', 'x', '{}'::jsonb, 0)$$,
  '42501', null, 'record_product_measurement_event refuses an OAuth token');
select throws_ok(
  $$select kilo.delete_product_measurement_install('00000000000000000000000000000000')$$,
  '42501', null, 'delete_product_measurement_install refuses an OAuth token');
reset role;

-- First-party tokens still use the guarded RPCs ----------------------------
select pg_temp.as_user(:'user_a'::uuid);
select lives_ok($$select kilo.health_sync_preflight()$$, 'first-party token still calls health_sync_preflight');
select lives_ok($$select kilo.is_oauth_client_token()$$, 'is_oauth_client_token is callable by authenticated');
reset role;

-- Catalog completeness -----------------------------------------------------
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kilo' and c.relkind in ('r', 'p') and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      and not exists (
        select 1 from pg_policies p
         where p.schemaname = 'kilo' and p.tablename = c.relname
           and p.policyname = 'mcp_oauth_token_denied'
           and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL'
           and p.roles = '{authenticated}')),
  0, 'every RLS-enabled kilo table reachable by authenticated carries the restrictive OAuth-denial policy');

select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kilo' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      and not c.relrowsecurity),
  0, 'no kilo relation reachable by authenticated lacks RLS');

select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kilo' and c.relkind in ('v', 'm', 'f')
      and has_table_privilege('authenticated', c.oid, 'SELECT')),
  0, 'no kilo view is readable by authenticated (a view would bypass the table policies)');

-- Every non-trigger function authenticated can execute is guarded or allowlisted.
-- Writers: the OAuth guard is part of the stored definition. Allowlisted: pure
-- helpers, SECURITY INVOKER readers governed by the table policies above, and the
-- MCP functions. A new function must be added here deliberately.
select is(
  (with f as materialized (
     select p.oid, p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kilo' and p.prokind = 'f'
        and p.prorettype <> 'pg_catalog.trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and p.proname not in (
          'health_values_differ', 'client_consent_protocol_version', 'health_gate_ok',
          'health_gated_tables', 'health_deletion_backoff', 'worker_secret_names',
          'is_valid_exercise_movement_groups', 'is_oauth_client_token',
          'mcp_request_gate', 'pull_sync_changes'))
   select coalesce(string_agg(f.oid::regprocedure::text, ', ' order by f.proname), '')
     from f
    where position('is_oauth_client_token' in pg_get_functiondef(f.oid)) = 0),
  '', 'every authenticated-executable kilo function is guarded or allowlisted');

select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kilo' and p.proname = 'pull_sync_changes' and p.prosecdef),
  0, 'allowlisted pull_sync_changes is SECURITY INVOKER, so table policies govern it');

select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kilo' and p.proname in ('health_values_differ', 'health_gated_tables',
          'health_deletion_backoff', 'worker_secret_names', 'is_valid_exercise_movement_groups',
          'client_consent_protocol_version')
      and p.prosecdef),
  0, 'allowlisted pure helpers are SECURITY INVOKER');

select * from finish();
rollback;
