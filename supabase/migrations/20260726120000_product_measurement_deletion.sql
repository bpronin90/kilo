-- Product measurement: server-side deletion on opt-out (issue #671).
--
-- Why this exists:
--   Disabling product measurement (mobile/lib/productMeasurement.js) must not
--   just stop local collection — it must also make a best-effort attempt to
--   erase this installation's rows in kilo.product_measurement_events. The
--   only thing that may authorize that erasure is the independent deletion
--   token generated on the client (issue #669); install id must never be
--   deletion authority, since an install id is sent on every ingest call and
--   is not a secret.
--
-- Design:
--   * kilo.product_measurement_installs is a private, RLS-locked table that
--     binds each install id to a one-way SHA-256 digest of its deletion
--     token — never the raw token. The binding is established on first
--     accepted ingest and is one-to-one in both directions: an install id
--     cannot be rebound to a different token digest, and a token digest
--     cannot be bound to more than one install id (enforced by the primary
--     key on install_id plus a unique constraint on the digest).
--   * kilo.record_product_measurement_event gains a p_deletion_token
--     argument and now validates + establishes/checks that binding before
--     accepting an event. The prior tokenless 4-arg overload is dropped
--     outright so no caller can bypass binding.
--   * kilo.delete_product_measurement_install(p_deletion_token) is the only
--     deletion entry point. It is idempotent and non-enumerating: a
--     malformed token is rejected without touching any row, while a
--     well-formed but unknown/already-used token returns the same success
--     result as a completed deletion. A valid, bound token deletes exactly
--     that installation's events and its binding row, in one transaction.
--   * Rows in kilo.product_measurement_events predate any token binding and
--     cannot be securely claimed by inference from install id alone, so this
--     migration purges all of them before the new binding contract takes
--     effect. This is a one-time migration-time purge, not something a
--     pgTAP test run against the post-migration schema can re-observe.
--   * sha256() is a built-in PostgreSQL function (since PG 13) — no
--     extension is enabled or changed to compute the digest.

-- ---------------------------------------------------------------------------
-- 1. Purge pre-binding rows. None of them have a trustworthy deletion-token
--    binding, and none can be safely assigned one after the fact.
-- ---------------------------------------------------------------------------
delete from kilo.product_measurement_events;

-- ---------------------------------------------------------------------------
-- 2. The private install/token binding table.
-- ---------------------------------------------------------------------------
create table if not exists kilo.product_measurement_installs (
  install_id text primary key check (install_id ~ '^[0-9a-f]{32}$'),
  deletion_token_digest text not null unique check (deletion_token_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

-- Locked down exactly like kilo.product_measurement_events: RLS enabled with
-- no policies, so neither anon nor authenticated can read or write it
-- directly. Only service_role (BYPASSRLS) and the SECURITY DEFINER functions
-- below ever touch this table.
alter table kilo.product_measurement_installs enable row level security;

-- ---------------------------------------------------------------------------
-- 3. One-way digest helper. Never returns or logs the raw token; callers
--    only ever see the digest.
-- ---------------------------------------------------------------------------
create or replace function kilo.hash_product_measurement_deletion_token(p_deletion_token text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select encode(sha256(convert_to(p_deletion_token, 'UTF8')), 'hex');
$$;

revoke all on function kilo.hash_product_measurement_deletion_token(text) from public;

-- ---------------------------------------------------------------------------
-- 4. Drop the tokenless ingest overload so it can no longer be called, then
--    recreate the RPC with a token-aware signature.
-- ---------------------------------------------------------------------------
drop function if exists kilo.record_product_measurement_event(text, text, jsonb, bigint);

create or replace function kilo.record_product_measurement_event(
  p_install_id text,
  p_deletion_token text,
  p_event_name text,
  p_properties jsonb,
  p_client_recorded_at_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = kilo, pg_temp
as $$
declare
  v_token_digest text;
  v_bound_digest text;
  v_sanitized jsonb;
begin
  if p_install_id is null or p_install_id !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid install id';
  end if;

  if p_deletion_token is null or p_deletion_token !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid deletion token';
  end if;

  if p_event_name is null or p_event_name not in (
    'tab_viewed',
    'workout_save_attempted',
    'workout_save_completed',
    'weight_save_attempted',
    'weight_save_completed',
    'parse_warning_summary',
    'analytics_viewed'
  ) then
    raise exception 'unknown event name';
  end if;

  if p_client_recorded_at_ms is null or p_client_recorded_at_ms < 0 then
    raise exception 'invalid recorded_at';
  end if;

  v_token_digest := kilo.hash_product_measurement_deletion_token(p_deletion_token);

  -- Establish the binding on first accepted ingest for this install id.
  -- ON CONFLICT (install_id) DO NOTHING lets an already-bound install id
  -- fall through to the mismatch check below instead of erroring here; a
  -- concurrent attempt to bind the same token digest to a *different*
  -- install id instead trips the digest's unique constraint, caught below.
  begin
    insert into kilo.product_measurement_installs (install_id, deletion_token_digest)
    values (p_install_id, v_token_digest)
    on conflict (install_id) do nothing;
  exception when unique_violation then
    raise exception 'deletion token already bound to a different installation';
  end;

  select deletion_token_digest into v_bound_digest
  from kilo.product_measurement_installs
  where install_id = p_install_id;

  if v_bound_digest is distinct from v_token_digest then
    raise exception 'install is bound to a different deletion token';
  end if;

  -- Bound the ingest rate per install id so a single (or spoofed) install
  -- cannot flood the table; independent of the export/delete buckets.
  if not kilo.rate_limit_check(
    'product_measurement:install:' || p_install_id,
    120,
    60000
  ) then
    return false;
  end if;

  v_sanitized := kilo.sanitize_product_measurement_properties(p_event_name, p_properties);

  insert into kilo.product_measurement_events (
    install_id, event_name, properties, client_recorded_at_ms
  ) values (
    p_install_id, p_event_name, v_sanitized, p_client_recorded_at_ms
  );

  return true;
end;
$$;

-- Mobile installs may be signed out, so both anon and authenticated must be
-- able to call the RPC; neither can touch either table directly (see RLS
-- above and on kilo.product_measurement_events).
revoke all on function kilo.record_product_measurement_event(text, text, text, jsonb, bigint) from public;
grant execute on function kilo.record_product_measurement_event(text, text, text, jsonb, bigint) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The deletion RPC. Sole authority is the deletion token; install id,
--    account id, and device data are never accepted as deletion authority.
-- ---------------------------------------------------------------------------
create or replace function kilo.delete_product_measurement_install(p_deletion_token text)
returns boolean
language plpgsql
security definer
set search_path = kilo, pg_temp
as $$
declare
  v_token_digest text;
  v_install_id text;
begin
  if p_deletion_token is null or p_deletion_token !~ '^[0-9a-f]{32}$' then
    raise exception 'invalid deletion token';
  end if;

  v_token_digest := kilo.hash_product_measurement_deletion_token(p_deletion_token);

  select install_id into v_install_id
  from kilo.product_measurement_installs
  where deletion_token_digest = v_token_digest;

  -- A well-formed but unknown/already-used token falls through with no
  -- match: idempotent no-op, same successful result as a completed
  -- deletion, so the caller cannot learn whether a binding ever existed.
  if v_install_id is not null then
    delete from kilo.product_measurement_events where install_id = v_install_id;
    delete from kilo.product_measurement_installs where install_id = v_install_id;
  end if;

  return true;
end;
$$;

revoke all on function kilo.delete_product_measurement_install(text) from public;
grant execute on function kilo.delete_product_measurement_install(text) to anon, authenticated;
