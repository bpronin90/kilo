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
--     result as a completed deletion. A valid, bound token deletes that
--     installation's events and marks its binding row revoked (rather than
--     deleting the binding) in one transaction — see the revoked_at note
--     below for why the binding row itself must survive deletion.
--   * Both RPCs take a FOR UPDATE lock on the same install's binding row
--     before acting on it, so they cannot interleave: a plain (non-locking)
--     read of revoked_at would let a concurrent deletion delete-then-
--     tombstone in between an ingest's read and its later insert, letting an
--     already-admitted event survive a deletion that had already run.
--     Whichever RPC acquires the lock first now runs to completion (commit)
--     before the other proceeds — see the comments at each FOR UPDATE. A row
--     lock cannot protect a row that does not exist yet, though: it cannot
--     serialize a deletion against a *first* ingest for a still-unbound
--     token. kilo.product_measurement_revocations (independent of any
--     install binding) plus a token-digest advisory lock taken by both RPCs
--     before they touch either table closes that gap — see the comments
--     there for the exact interleaving it prevents.
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
-- revoked_at: set by kilo.delete_product_measurement_install and never
-- cleared. A deletion request can race a flush that already read the same
-- install id/token before local opt-out cleared them: if that in-flight
-- ingest call reaches kilo.record_product_measurement_event AFTER the
-- deletion transaction commits, the binding row must still be there for the
-- ingest function to recognize the installation as revoked and reject the
-- event — otherwise it would see no binding, treat the call as a first
-- ingest, recreate it, and resurrect rows the user just had deleted, using a
-- token the client has already irreversibly discarded. Deleting the binding
-- row on revoke (instead of tombstoning it) would reopen exactly that race.
create table if not exists kilo.product_measurement_installs (
  install_id text primary key check (install_id ~ '^[0-9a-f]{32}$'),
  deletion_token_digest text not null unique check (deletion_token_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Locked down exactly like kilo.product_measurement_events: RLS enabled with
-- no policies, so neither anon nor authenticated can read or write it
-- directly. Only service_role (BYPASSRLS) and the SECURITY DEFINER functions
-- below ever touch this table.
alter table kilo.product_measurement_installs enable row level security;

-- ---------------------------------------------------------------------------
-- 2b. Independent digest revocation. A row lock on product_measurement_
--     installs cannot serialize a deletion against a *first* ingest for a
--     still-unbound token: there is no row to lock yet. A first flush can
--     already hold an install id/token locally when opt-out clears them and
--     calls delete_product_measurement_install; if that deletion runs (and
--     returns its non-revealing success result) before the first ingest's
--     transaction reaches the database, the ingest would otherwise see no
--     binding, insert a fresh one, and persist an event the client can never
--     delete again (its only token has already been discarded). Recording
--     the digest here — independent of whether any install binding exists —
--     lets ingest reject a revoked token outright before it ever tries to
--     establish a binding. Both RPCs additionally take the same
--     digest-derived advisory lock (pg_advisory_xact_lock) before touching
--     either table, so a first ingest and a deletion for the same token
--     cannot interleave even though there is no row for FOR UPDATE to lock
--     until a binding is established.
create table if not exists kilo.product_measurement_revocations (
  deletion_token_digest text primary key check (deletion_token_digest ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz not null default now()
);

-- Locked down exactly like the other two tables: RLS enabled with no
-- policies, no direct anon/authenticated access.
alter table kilo.product_measurement_revocations enable row level security;

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
  v_revoked_at timestamptz;
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

  -- Serializes against kilo.delete_product_measurement_install for this
  -- exact token (same key derivation there) before either RPC touches the
  -- binding or revocation tables — this is what protects a *first* ingest,
  -- for which no product_measurement_installs row exists yet to FOR UPDATE.
  -- Identical lock ordering (advisory lock first, binding row second) in
  -- both RPCs avoids deadlocks.
  perform pg_advisory_xact_lock(hashtext('product_measurement_deletion:' || v_token_digest));

  if exists (
    select 1 from kilo.product_measurement_revocations
    where deletion_token_digest = v_token_digest
  ) then
    raise exception 'installation has been revoked';
  end if;

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

  -- FOR UPDATE locks this install's binding row for the rest of the
  -- transaction, serializing against kilo.delete_product_measurement_install
  -- (which takes the same row lock on the same row before tombstoning/
  -- deleting). Without this, a plain SELECT here is not enough: under READ
  -- COMMITTED, this ingest could read revoked_at IS NULL, then a concurrent
  -- deletion could delete the current events, tombstone the row, and commit,
  -- and only then would this ingest insert its event — surviving a deletion
  -- that had already run. The lock guarantees one of two outcomes instead:
  -- either this ingest's insert commits before deletion starts (so deletion
  -- subsequently sees and removes it too), or deletion commits first and
  -- this ingest, unblocked, re-reads revoked_at as set and rejects.
  select deletion_token_digest, revoked_at into v_bound_digest, v_revoked_at
  from kilo.product_measurement_installs
  where install_id = p_install_id
  for update;

  if v_bound_digest is distinct from v_token_digest then
    raise exception 'install is bound to a different deletion token';
  end if;

  -- Closes the late-ingest-after-deletion race: the binding row survives
  -- deletion specifically so this check can reject an ingest that arrives
  -- after this installation was revoked, rather than treating it as fresh.
  if v_revoked_at is not null then
    raise exception 'installation has been revoked';
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

  -- Same digest-derived advisory lock kilo.record_product_measurement_event
  -- takes, acquired before either RPC touches the binding or revocation
  -- tables. This is what serializes deletion against a *first* ingest for a
  -- still-unbound token, where there is no binding row yet for FOR UPDATE to
  -- lock. Identical lock ordering in both RPCs avoids deadlocks.
  perform pg_advisory_xact_lock(hashtext('product_measurement_deletion:' || v_token_digest));

  -- Recorded unconditionally, even when no binding exists yet: this is what
  -- makes a concurrent first ingest for this exact token see itself as
  -- revoked once it acquires the advisory lock above, rather than
  -- establishing a fresh binding for a token the client has already
  -- discarded. Idempotent: on_conflict keeps the earliest revocation time.
  insert into kilo.product_measurement_revocations (deletion_token_digest)
  values (v_token_digest)
  on conflict (deletion_token_digest) do nothing;

  -- FOR UPDATE takes the same row lock the ingest RPC takes on this install's
  -- binding row (see the comment there), so the two RPCs cannot interleave:
  -- whichever acquires the lock first runs to completion (commit) before the
  -- other proceeds. This is what makes deletion actually final against a
  -- concurrent in-flight ingest for an ALREADY-bound install; the advisory
  -- lock above covers the still-unbound case this row lock cannot.
  select install_id into v_install_id
  from kilo.product_measurement_installs
  where deletion_token_digest = v_token_digest
  for update;

  -- A well-formed but unknown/already-used token falls through with no
  -- match: idempotent no-op, same successful result as a completed
  -- deletion, so the caller cannot learn whether a binding ever existed.
  --
  -- The binding row is marked revoked, not deleted: kilo.record_product_
  -- measurement_event checks revoked_at and rejects any ingest for this
  -- install id, including a call that started before opt-out and only
  -- reaches the server after this transaction commits. Deleting the row
  -- instead would let that late call see no binding, recreate it, and
  -- resurrect events using a token the client already discarded. coalesce
  -- keeps a repeat deletion idempotent without moving the original
  -- revocation timestamp.
  if v_install_id is not null then
    delete from kilo.product_measurement_events where install_id = v_install_id;
    update kilo.product_measurement_installs
    set revoked_at = coalesce(revoked_at, now())
    where install_id = v_install_id;
  end if;

  return true;
end;
$$;

revoke all on function kilo.delete_product_measurement_install(text) from public;
grant execute on function kilo.delete_product_measurement_install(text) to anon, authenticated;
