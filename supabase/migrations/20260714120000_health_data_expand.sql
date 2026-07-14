-- Expand half of the kilo.user_profile health-column split (issue #487).
--
-- kilo.user_profile is a mixed table: it carries account settings (display_name,
-- unit_system, ui_state) alongside six values that are data concerning health
-- under GDPR Art. 9. A table-level consent gate over the obvious health tables
-- would therefore leak health data through user_profile and under-delete on
-- withdrawal. This migration moves those six values into a dedicated,
-- consent-gatable canonical table.
--
-- This is the EXPAND half only. It is non-destructive and safe to deploy while
-- old clients are still in the field:
--
--   * kilo.user_health_profile is created and backfilled from user_profile.
--   * All six source columns stay readable and writable.
--   * Bidirectional compatibility triggers keep the two copies in agreement, so
--     an old client writing user_profile and a new client writing
--     user_health_profile both converge.
--
-- The CONTRACT half (dropping the six columns and every compatibility path) is
-- mandatory but must not run until the consent protocol gate is effective. It
-- lives in supabase/operations/health-data-contract.sql and is operator-run for
-- exactly that reason: a destructive contract must never ride along with an
-- ordinary `supabase db push`.
--
-- Timestamp semantics (the subtle part)
-- -------------------------------------
-- kilo.set_updated_at() stamps now() on every write so a client cannot drive
-- last-write-wins ordering (#349). A naive mirror breaks that invariant twice:
--
--   1. The mirror write is itself a write, so it would be stamped now() on the
--      other table. The two copies would then disagree on updated_at, and every
--      mirror would look like a fresh user edit (a phantom edit) that wins LWW
--      against genuine writes from other devices.
--   2. Reconciliation (a privileged repair) would restamp the row it is
--      repairing, destroying the very timestamp it is trying to preserve.
--
-- So this migration replaces the timestamp trigger on these two tables only with
-- a compatibility-aware wrapper:
--
--   depth 1 (a genuine client write) -> stamp now(), exactly as before
--   depth > 1 (a nested mirror write) -> preserve the incoming updated_at
--   privileged stamp suppression      -> preserve the incoming updated_at
--
-- The mirror carries the originating row's updated_at to the other table, so
-- both copies end up with one identical, server-generated timestamp per genuine
-- write. Clients cannot reach the nested path (they cannot call the mirror
-- function) and cannot signal suppression (the signal is ignored for the
-- authenticated/anon roles).
--
-- Conflict semantics: row-level last-write-wins on that preserved timestamp. A
-- strictly later timestamp wins. On an exact tie the canonical
-- user_health_profile wins. Both are expressed directly in the upsert predicates
-- below (`>` mirroring into the canonical table, `>=` mirroring out of it).

-- ---------------------------------------------------------------------------
-- 1. Canonical health table
-- ---------------------------------------------------------------------------

create table if not exists kilo.user_health_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_deload_note_raw_text text,
  current_deload_note_saved_at timestamptz,
  current_deload_note_updated_at timestamptz,
  fatigue_multiplier numeric,
  tracked_lifts jsonb,
  current_workout_note_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table kilo.user_health_profile enable row level security;

-- Owner-scoped policies. The consent gate is layered on top of these in
-- 20260714120001_consent_schema.sql; ownership alone is never sufficient once
-- enforcement is active.
create policy "user_health_profile_select_own" on kilo.user_health_profile
  for select to authenticated using (user_id = (select auth.uid()));
create policy "user_health_profile_insert_own" on kilo.user_health_profile
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "user_health_profile_update_own" on kilo.user_health_profile
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "user_health_profile_delete_own" on kilo.user_health_profile
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on kilo.user_health_profile to authenticated;
grant all on kilo.user_health_profile to service_role;

-- ---------------------------------------------------------------------------
-- 2. Compatibility-aware timestamp trigger
-- ---------------------------------------------------------------------------

-- A trigger function runs as the INVOKING role, not as its owner (it is not
-- SECURITY DEFINER — it must not be, or a client could not be told apart from the
-- server). So everything it calls must be executable by `authenticated`, and both
-- checks below are therefore inlined rather than factored into a helper that would
-- have to be granted to the very role it is defending against.
create or replace function kilo.set_updated_at_compat()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- A nested write is a mirror of a genuine write that was already stamped on
  -- the originating table. Preserving the incoming value is what makes the two
  -- copies share one timestamp and keeps mirrors from looking like user edits.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Privileged stamp suppression, for the reconciliation path only. It repairs a
  -- row without touching its ordering: a plain UPDATE would restamp the loser to
  -- now(), destroying the originating timestamp and manufacturing a phantom edit
  -- that then wins every future conflict.
  --
  -- The role check is what makes this safe. A client holds `authenticated` and can
  -- never reach set_config through PostgREST anyway, but relying on that would be
  -- incidental; refusing the signal for client roles outright makes it structural.
  -- Without this, a tampered client could suppress the stamp, supply
  -- updated_at = 2099, and win every last-write-wins conflict forever — the exact
  -- attack #349 closed.
  if current_user not in ('authenticated', 'anon')
     and coalesce(current_setting('kilo.suppress_updated_at_stamp', true), 'off') = 'on' then
    return new;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on kilo.user_profile;
create trigger set_updated_at
  before insert or update on kilo.user_profile
  for each row execute function kilo.set_updated_at_compat();

drop trigger if exists set_updated_at on kilo.user_health_profile;
create trigger set_updated_at
  before insert or update on kilo.user_health_profile
  for each row execute function kilo.set_updated_at_compat();

-- ---------------------------------------------------------------------------
-- 3. Backfill
-- ---------------------------------------------------------------------------

-- Carry each source row's existing updated_at across rather than stamping now().
-- The backfilled row must not look newer than the profile row it was copied
-- from, or the first mirror would resolve the wrong way.
do $$
begin
  perform set_config('kilo.suppress_updated_at_stamp', 'on', true);

  insert into kilo.user_health_profile (
    user_id,
    current_deload_note_raw_text,
    current_deload_note_saved_at,
    current_deload_note_updated_at,
    fatigue_multiplier,
    tracked_lifts,
    current_workout_note_id,
    created_at,
    updated_at,
    deleted_at
  )
  select
    p.user_id,
    p.current_deload_note_raw_text,
    p.current_deload_note_saved_at,
    p.current_deload_note_updated_at,
    p.fatigue_multiplier,
    p.tracked_lifts,
    p.current_workout_note_id,
    p.created_at,
    p.updated_at,
    p.deleted_at
  from kilo.user_profile p
  on conflict (user_id) do nothing;

  perform set_config('kilo.suppress_updated_at_stamp', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Bidirectional compatibility mirrors
-- ---------------------------------------------------------------------------

-- True when a write actually changed one of the six logical health values.
-- Mirroring on every write would create a mirror per unrelated display_name or
-- ui_state edit; the spec requires exactly one mirror per genuine health write.
create or replace function kilo.health_values_differ(
  a_raw_text text, a_saved_at timestamptz, a_note_updated_at timestamptz,
  a_multiplier numeric, a_tracked_lifts jsonb, a_note_id text,
  b_raw_text text, b_saved_at timestamptz, b_note_updated_at timestamptz,
  b_multiplier numeric, b_tracked_lifts jsonb, b_note_id text
)
  returns boolean
  language sql
  immutable
  set search_path = ''
as $$
  select a_raw_text         is distinct from b_raw_text
      or a_saved_at         is distinct from b_saved_at
      or a_note_updated_at  is distinct from b_note_updated_at
      or a_multiplier       is distinct from b_multiplier
      or a_tracked_lifts    is distinct from b_tracked_lifts
      or a_note_id          is distinct from b_note_id;
$$;

-- user_profile -> user_health_profile (the old-client write path).
--
-- SECURITY DEFINER so the mirror can write the canonical row regardless of the
-- consent policies layered on it later: the mirror is a server-owned integrity
-- operation, not a user-initiated health write. The gate still governs what the
-- user's own session may read or write directly.
create or replace function kilo.mirror_profile_to_health()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- Recursion guard. A mirror write into user_health_profile fires that table's
  -- AFTER trigger at depth 2; without this the two mirrors would ping-pong.
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'UPDATE' and not kilo.health_values_differ(
    old.current_deload_note_raw_text, old.current_deload_note_saved_at,
    old.current_deload_note_updated_at, old.fatigue_multiplier,
    old.tracked_lifts, old.current_workout_note_id,
    new.current_deload_note_raw_text, new.current_deload_note_saved_at,
    new.current_deload_note_updated_at, new.fatigue_multiplier,
    new.tracked_lifts, new.current_workout_note_id
  ) then
    return null;
  end if;

  insert into kilo.user_health_profile as h (
    user_id,
    current_deload_note_raw_text,
    current_deload_note_saved_at,
    current_deload_note_updated_at,
    fatigue_multiplier,
    tracked_lifts,
    current_workout_note_id,
    updated_at,
    deleted_at
  ) values (
    new.user_id,
    new.current_deload_note_raw_text,
    new.current_deload_note_saved_at,
    new.current_deload_note_updated_at,
    new.fatigue_multiplier,
    new.tracked_lifts,
    new.current_workout_note_id,
    new.updated_at,
    new.deleted_at
  )
  on conflict (user_id) do update set
    current_deload_note_raw_text   = excluded.current_deload_note_raw_text,
    current_deload_note_saved_at   = excluded.current_deload_note_saved_at,
    current_deload_note_updated_at = excluded.current_deload_note_updated_at,
    fatigue_multiplier             = excluded.fatigue_multiplier,
    tracked_lifts                  = excluded.tracked_lifts,
    current_workout_note_id        = excluded.current_workout_note_id,
    updated_at                     = excluded.updated_at,
    deleted_at                     = excluded.deleted_at
  -- Strictly later wins. On an exact tie the canonical table is authoritative,
  -- so an equal-timestamp legacy write does NOT overwrite it.
  where excluded.updated_at > h.updated_at;

  return null;
end;
$$;

-- user_health_profile -> user_profile (the new-client write path).
create or replace function kilo.mirror_health_to_profile()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'UPDATE' and not kilo.health_values_differ(
    old.current_deload_note_raw_text, old.current_deload_note_saved_at,
    old.current_deload_note_updated_at, old.fatigue_multiplier,
    old.tracked_lifts, old.current_workout_note_id,
    new.current_deload_note_raw_text, new.current_deload_note_saved_at,
    new.current_deload_note_updated_at, new.fatigue_multiplier,
    new.tracked_lifts, new.current_workout_note_id
  ) then
    return null;
  end if;

  -- The legacy row may not exist yet for a user who only ever ran a new client.
  -- Insert it so an old client on a second device still sees the health values.
  insert into kilo.user_profile as p (
    user_id,
    current_deload_note_raw_text,
    current_deload_note_saved_at,
    current_deload_note_updated_at,
    fatigue_multiplier,
    tracked_lifts,
    current_workout_note_id,
    updated_at
  ) values (
    new.user_id,
    new.current_deload_note_raw_text,
    new.current_deload_note_saved_at,
    new.current_deload_note_updated_at,
    new.fatigue_multiplier,
    new.tracked_lifts,
    new.current_workout_note_id,
    new.updated_at
  )
  on conflict (user_id) do update set
    current_deload_note_raw_text   = excluded.current_deload_note_raw_text,
    current_deload_note_saved_at   = excluded.current_deload_note_saved_at,
    current_deload_note_updated_at = excluded.current_deload_note_updated_at,
    fatigue_multiplier             = excluded.fatigue_multiplier,
    tracked_lifts                  = excluded.tracked_lifts,
    current_workout_note_id        = excluded.current_workout_note_id,
    updated_at                     = excluded.updated_at
  -- The canonical table wins ties, so it mirrors out on >= rather than >.
  -- deleted_at is deliberately not mirrored outward: user_profile.deleted_at is
  -- an account-level tombstone, not a health-row tombstone, and overwriting it
  -- from the health row would resurrect or bury the account row.
  where excluded.updated_at >= p.updated_at;

  return null;
end;
$$;

drop trigger if exists mirror_profile_to_health on kilo.user_profile;
create trigger mirror_profile_to_health
  after insert or update on kilo.user_profile
  for each row execute function kilo.mirror_profile_to_health();

drop trigger if exists mirror_health_to_profile on kilo.user_health_profile;
create trigger mirror_health_to_profile
  after insert or update on kilo.user_health_profile
  for each row execute function kilo.mirror_health_to_profile();

-- ---------------------------------------------------------------------------
-- 5. Parity reporting and privileged reconciliation
-- ---------------------------------------------------------------------------

-- Every user whose two copies disagree, with the timestamp on each side. An
-- empty result is the parity gate the rollout and the contract step both check.
create or replace function kilo.health_parity_report()
  returns table (
    user_id uuid,
    profile_updated_at timestamptz,
    health_updated_at timestamptz,
    divergence text
  )
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select
    coalesce(p.user_id, h.user_id) as user_id,
    p.updated_at as profile_updated_at,
    h.updated_at as health_updated_at,
    case
      when h.user_id is null then 'missing_health_row'
      when p.user_id is null then 'missing_profile_row'
      when p.updated_at is distinct from h.updated_at then 'timestamp_mismatch'
      else 'value_mismatch'
    end as divergence
  from kilo.user_profile p
  full outer join kilo.user_health_profile h on h.user_id = p.user_id
  where p.user_id is null
     or h.user_id is null
     or p.updated_at is distinct from h.updated_at
     or kilo.health_values_differ(
          p.current_deload_note_raw_text, p.current_deload_note_saved_at,
          p.current_deload_note_updated_at, p.fatigue_multiplier,
          p.tracked_lifts, p.current_workout_note_id,
          h.current_deload_note_raw_text, h.current_deload_note_saved_at,
          h.current_deload_note_updated_at, h.fatigue_multiplier,
          h.tracked_lifts, h.current_workout_note_id
        );
$$;

revoke all on function kilo.health_parity_report() from public, anon, authenticated;
grant execute on function kilo.health_parity_report() to service_role;

-- Repair one user's divergence by copying the LWW winner onto the loser WITHOUT
-- restamping it. Runs at trigger depth 0, so it must signal stamp suppression;
-- a plain UPDATE would set the loser's updated_at to now(), which both destroys
-- the originating timestamp and manufactures a phantom edit that then wins every
-- future conflict. Returns the side that won, or 'none' when already in parity.
create or replace function kilo.reconcile_user_health(p_user_id uuid)
  returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_profile kilo.user_profile%rowtype;
  v_health  kilo.user_health_profile%rowtype;
  v_winner  text;
begin
  select * into v_profile from kilo.user_profile where user_id = p_user_id;
  select * into v_health  from kilo.user_health_profile where user_id = p_user_id;

  if v_profile.user_id is null and v_health.user_id is null then
    return 'none';
  end if;

  perform set_config('kilo.suppress_updated_at_stamp', 'on', true);

  -- The canonical table wins ties, so the legacy side only wins on a strictly
  -- later timestamp.
  if v_health.user_id is null
     or (v_profile.user_id is not null and v_profile.updated_at > v_health.updated_at) then
    v_winner := 'user_profile';
    insert into kilo.user_health_profile (
      user_id, current_deload_note_raw_text, current_deload_note_saved_at,
      current_deload_note_updated_at, fatigue_multiplier, tracked_lifts,
      current_workout_note_id, updated_at, deleted_at
    ) values (
      v_profile.user_id, v_profile.current_deload_note_raw_text,
      v_profile.current_deload_note_saved_at, v_profile.current_deload_note_updated_at,
      v_profile.fatigue_multiplier, v_profile.tracked_lifts,
      v_profile.current_workout_note_id, v_profile.updated_at, v_profile.deleted_at
    )
    on conflict (user_id) do update set
      current_deload_note_raw_text   = excluded.current_deload_note_raw_text,
      current_deload_note_saved_at   = excluded.current_deload_note_saved_at,
      current_deload_note_updated_at = excluded.current_deload_note_updated_at,
      fatigue_multiplier             = excluded.fatigue_multiplier,
      tracked_lifts                  = excluded.tracked_lifts,
      current_workout_note_id        = excluded.current_workout_note_id,
      updated_at                     = excluded.updated_at,
      deleted_at                     = excluded.deleted_at;
  else
    v_winner := 'user_health_profile';
    insert into kilo.user_profile (
      user_id, current_deload_note_raw_text, current_deload_note_saved_at,
      current_deload_note_updated_at, fatigue_multiplier, tracked_lifts,
      current_workout_note_id, updated_at
    ) values (
      v_health.user_id, v_health.current_deload_note_raw_text,
      v_health.current_deload_note_saved_at, v_health.current_deload_note_updated_at,
      v_health.fatigue_multiplier, v_health.tracked_lifts,
      v_health.current_workout_note_id, v_health.updated_at
    )
    on conflict (user_id) do update set
      current_deload_note_raw_text   = excluded.current_deload_note_raw_text,
      current_deload_note_saved_at   = excluded.current_deload_note_saved_at,
      current_deload_note_updated_at = excluded.current_deload_note_updated_at,
      fatigue_multiplier             = excluded.fatigue_multiplier,
      tracked_lifts                  = excluded.tracked_lifts,
      current_workout_note_id        = excluded.current_workout_note_id,
      updated_at                     = excluded.updated_at;
  end if;

  perform set_config('kilo.suppress_updated_at_stamp', 'off', true);
  return v_winner;
end;
$$;

revoke all on function kilo.reconcile_user_health(uuid) from public, anon, authenticated;
grant execute on function kilo.reconcile_user_health(uuid) to service_role;

-- The mirrors are server-owned. A client that could invoke one directly could
-- carry an arbitrary updated_at into the other table and win every LWW conflict.
-- (They are trigger functions, so revoking EXECUTE does not affect the triggers
-- themselves — those run as the table owner's trigger machinery, not as a call.)
revoke all on function kilo.mirror_profile_to_health() from public, anon, authenticated;
revoke all on function kilo.mirror_health_to_profile() from public, anon, authenticated;
