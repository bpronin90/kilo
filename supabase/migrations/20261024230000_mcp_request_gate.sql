-- MCP MVP request gate and OAuth-token isolation (issue #1625; contract
-- docs/architecture/mcp-mvp.md sections 5, 6.1 and 6.2).
--
-- WHY
--
-- Supabase OAuth access tokens are ordinary `authenticated` JWTs plus a
-- `client_id` claim, and scopes do not restrict database access. Two things
-- follow and are settled here:
--
--   1. A disconnected client's unexpired token still verifies against JWKS, so
--      revocation must be a server-side lookup (kilo.mcp_gate_status), not
--      token expiry.
--   2. An OAuth token must not be able to use Kilo's tables, RPCs or Edge
--      Functions directly. Its only data path is the MCP page RPCs.
--
-- Nothing here writes to, alters, or adds a trigger to the auth schema, and no
-- grant table is added: grant evidence stays in Supabase Auth plus
-- kilo.consent_state. auth.sessions / auth.refresh_tokens are created by GoTrue,
-- so they are read through dynamic SQL guarded by to_regclass and a column
-- check; anything missing means "inactive", never an exception.

-- ---------------------------------------------------------------------------
-- 1. Is the caller an OAuth-client token?
-- ---------------------------------------------------------------------------

-- Reads request.jwt.claims directly (PostgREST sets it) rather than auth.jwt(),
-- which GoTrue creates and a GoTrue-less test database lacks.
-- Presence of the claim, not its value: a first-party session never carries
-- `client_id`, so any occurrence classifies the token as an OAuth client token.
create or replace function kilo.is_oauth_client_token()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (case when coalesce(current_setting('request.jwt.claims', true), '') = ''
          then '{}'::jsonb
          else current_setting('request.jwt.claims', true)::jsonb end) ? 'client_id',
    false)
$$;

revoke all on function kilo.is_oauth_client_token() from public, anon;
grant execute on function kilo.is_oauth_client_token() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2a. Session lookup (internal; granted to no role)
-- ---------------------------------------------------------------------------

-- Returns the session's created_at while it is active, else null. Active means a
-- live auth.sessions row for this user AND at least one non-revoked refresh token
-- for it; requiring both denies whether revokeGrant deletes sessions, deletes
-- refresh tokens, or only marks them revoked. If the session row records the
-- OAuth client, it must equal the client_id claim. Dynamic SQL because GoTrue,
-- not this database image, owns the tables: a missing table or column means
-- "inactive", never an exception.
create or replace function kilo.mcp_session_created_at(p_session_id uuid, p_user_id uuid, p_client_id text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_created timestamptz;
  v_has_oauth_col boolean;
  v_has_rt_session boolean;
begin
  if p_session_id is null or p_user_id is null
     or pg_catalog.to_regclass('auth.sessions') is null
     or pg_catalog.to_regclass('auth.refresh_tokens') is null then
    return null;
  end if;

  select exists (
           select 1 from pg_catalog.pg_attribute a
           where a.attrelid = 'auth.refresh_tokens'::pg_catalog.regclass
             and a.attname = 'session_id' and not a.attisdropped)
    into v_has_rt_session;
  if not v_has_rt_session then
    return null;
  end if;

  select exists (
           select 1 from pg_catalog.pg_attribute a
           where a.attrelid = 'auth.sessions'::pg_catalog.regclass
             and a.attname = 'oauth_client_id' and not a.attisdropped)
    into v_has_oauth_col;

  execute 'select s.created_at
             from auth.sessions s
            where s.id = $1
              and s.user_id = $2
              and (s.not_after is null or s.not_after > now())
              and ($3 is false or s.oauth_client_id::text = $4)
              and exists (
                select 1 from auth.refresh_tokens r
                 where r.session_id = s.id and r.revoked = false)'
    into v_created
    using p_session_id, p_user_id, v_has_oauth_col, p_client_id;

  return v_created;
end;
$$;

revoke all on function kilo.mcp_session_created_at(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Internal gate status (executable by no API role)
-- ---------------------------------------------------------------------------

create or replace function kilo.mcp_gate_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := case when coalesce(current_setting('request.jwt.claims', true), '') = ''
                         then '{}'::jsonb
                         else current_setting('request.jwt.claims', true)::jsonb end;
  v_sub uuid;
  v_session uuid;
  v_client text;
  v_session_created timestamptz;
  v_cfg kilo.health_sync_config%rowtype;
  v_state kilo.consent_state%rowtype;
  v_consent_ok boolean;
begin
  begin
    v_sub := (v_claims ->> 'sub')::uuid;
    v_session := (v_claims ->> 'session_id')::uuid;
  exception when others then
    return jsonb_build_object('status', 'session_inactive', 'consent_granted_at', null);
  end;
  v_client := nullif(v_claims ->> 'client_id', '');

  if v_sub is null or v_session is null or v_client is null then
    return jsonb_build_object('status', 'session_inactive', 'consent_granted_at', null);
  end if;

  if not exists (select 1 from auth.users u where u.id = v_sub) then
    return jsonb_build_object('status', 'account_missing', 'consent_granted_at', null);
  end if;

  -- Session active = a live session row AND a non-revoked refresh token for it
  -- (kilo.mcp_session_created_at). Null means inactive.
  v_session_created := kilo.mcp_session_created_at(v_session, v_sub, v_client);

  if v_session_created is null then
    return jsonb_build_object('status', 'session_inactive', 'consent_granted_at', null);
  end if;

  -- Consent. Unlike kilo.health_gate_ok(), `legacy` mode is NOT permissive:
  -- MCP always requires an explicit, current grant.
  select * into v_cfg from kilo.health_sync_config where id = true;
  select * into v_state from kilo.consent_state where user_id = v_sub;

  v_consent_ok := v_cfg.id is not null
    and v_cfg.mode in ('legacy', 'consent_required')
    and v_state.user_id is not null
    and v_state.status = 'granted'
    and v_state.current_material_version is not null
    and v_state.current_material_version >= v_cfg.required_material_version
    and v_state.granted_at is not null;

  if not v_consent_ok then
    return jsonb_build_object('status', 'consent_required', 'consent_granted_at', null);
  end if;

  -- A regrant never silently revives a connection made under an earlier grant.
  if v_session_created < v_state.granted_at then
    return jsonb_build_object('status', 'consent_stale', 'consent_granted_at', v_state.granted_at);
  end if;

  return jsonb_build_object('status', 'ok', 'consent_granted_at', v_state.granted_at);
end;
$$;

revoke all on function kilo.mcp_gate_status() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. HTTP-layer gate (early, cheap rejection; page RPCs re-run the status)
-- ---------------------------------------------------------------------------

create or replace function kilo.mcp_request_gate()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select kilo.mcp_gate_status()
$$;

revoke all on function kilo.mcp_request_gate() from public, anon, authenticated, service_role;
grant execute on function kilo.mcp_request_gate() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Table isolation: every kilo table reachable by `authenticated` denies
--    OAuth-client tokens
-- ---------------------------------------------------------------------------
-- Tables `authenticated` holds no privilege on (service-role-only: rate limits,
-- security events, restore credentials, product measurement, ...) are already
-- unreachable and carry no policy by design (their own tests assert exactly
-- that), so a restrictive policy there would be dead weight. The catalog test in
-- mcp-oauth-token-isolation.test.sql fails if a table gains an authenticated
-- grant without the policy.

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kilo'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  loop
    execute format('drop policy if exists mcp_oauth_token_denied on kilo.%I', r.relname);
    execute format(
      'create policy mcp_oauth_token_denied on kilo.%I as restrictive for all to authenticated '
      'using (not (select kilo.is_oauth_client_token())) '
      'with check (not (select kilo.is_oauth_client_token()))',
      r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Writer RPCs refuse OAuth-client tokens
-- ---------------------------------------------------------------------------
-- The guard is injected into each function's current definition rather than
-- copying bodies here, so this migration cannot drift from the latest version
-- of any writer. Each injection is asserted; a function whose shape is not
-- recognised aborts the migration instead of silently staying unguarded.

do $$
declare
  fn regprocedure;
  def text;
  patched text;
  guard constant text :=
    E'begin\n  if kilo.is_oauth_client_token() then\n'
    '    raise exception ''not permitted for connected clients'' using errcode = ''insufficient_privilege'';\n'
    '  end if;\n';
begin
  for fn in
    select p.oid::pg_catalog.regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kilo'
      and p.proname in ('consent_grant', 'consent_withdraw', 'health_sync_preflight',
                        'record_product_measurement_event', 'delete_product_measurement_install')
  loop
    def := pg_catalog.pg_get_functiondef(fn);
    patched := regexp_replace(def, '\mbegin\M\s*\n', guard, 'i');
    -- regexp_replace without the 'g' flag replaces only the first match.
    if patched = def or position('is_oauth_client_token' in patched) = 0 then
      raise exception 'could not inject OAuth guard into %', fn;
    end if;
    execute patched;
  end loop;
end $$;
