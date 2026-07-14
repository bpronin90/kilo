-- CONTRACT half of the kilo.user_profile health-column split (issue #487).
--
-- This is the mandatory final state: it drops the six legacy health columns from
-- kilo.user_profile and removes every compatibility path, so "no compatibility
-- copies in user_profile" becomes true rather than aspirational.
--
-- WHY THIS IS NOT IN supabase/migrations/
-- ---------------------------------------
-- It is destructive and ORDER-DEPENDENT on a runtime condition, not on a file
-- name. The spec requires the protocol gate to be effective BEFORE contract, so
-- that no client still depending on the six columns can reach sync and lose data.
-- A file in supabase/migrations/ rides along with the very same `supabase db push`
-- that deploys the expand half, which would drop the columns out from under every
-- client in the field. Deployment sequencing is therefore enforced here, at run
-- time, instead of being trusted to whoever runs the push.
--
-- PRECONDITIONS (all verified below; the script raises rather than proceeding):
--   1. health_sync_mode = 'consent_required'
--   2. minimum_consent_protocol_version > 0  (stale clients are already denied)
--   3. kilo.health_parity_report() is empty  (both copies agree, for every user)
--
-- THIS FILE DELIBERATELY CONTAINS NO `begin;` / `commit;`.
--
-- It used to, and that was a trap that nearly destroyed production data during
-- verification. An in-file `commit;` fires BEFORE any outer `-c 'rollback'`, so the
-- obvious-looking dry run
--
--     psql -c 'begin' -f health-data-contract.sql -c 'rollback'
--
-- actually COMMITS the drop and then rolls back an empty transaction, while printing
-- exactly the same reassuring output as a real rehearsal. The operator believes they
-- performed a no-op; six columns of every user's health data are gone.
--
-- Transaction control therefore belongs to the CALLER, and the two commands below
-- are the only supported ways to run this.
--
-- REHEARSAL (required before running for real). Rolls back, guaranteed — the
-- rollback is inside the same session and there is no commit anywhere to beat it:
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
--     begin;
--     \i supabase/operations/health-data-contract.sql
--     rollback;
--     SQL
--
-- APPLY (requires separate, explicit user approval — see issue #487 non-goals).
-- --single-transaction makes the whole contract atomic, so a failed precondition or
-- a failed post-check leaves the schema untouched rather than half-contracted:
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--       -f supabase/operations/health-data-contract.sql
--
-- Both forms REQUIRE ON_ERROR_STOP=1. Without it psql plows past a failed
-- precondition and drops the columns anyway.
--
-- POST-CHECK: current clients must read and write kilo.user_health_profile only.
-- The final block below asserts the six columns are gone.

-- ---------------------------------------------------------------------------
-- Preconditions
-- ---------------------------------------------------------------------------

do $$
declare
  v_cfg kilo.health_sync_config%rowtype;
  v_divergent bigint;
begin
  select * into v_cfg from kilo.health_sync_config where id = true;

  if v_cfg.id is null then
    raise exception 'contract blocked: no kilo.health_sync_config row';
  end if;

  if v_cfg.mode <> 'consent_required' then
    raise exception
      'contract blocked: health_sync_mode is %, expected consent_required. The protocol gate must be effective before the legacy columns are dropped.',
      v_cfg.mode;
  end if;

  if coalesce(v_cfg.minimum_consent_protocol_version, 0) <= 0 then
    raise exception
      'contract blocked: minimum_consent_protocol_version is %, expected > 0. Clients that still depend on the legacy columns would silently lose data.',
      coalesce(v_cfg.minimum_consent_protocol_version, 0);
  end if;

  select count(*) into v_divergent from kilo.health_parity_report();
  if v_divergent > 0 then
    raise exception
      'contract blocked: % user(s) have divergent user_profile / user_health_profile copies. Run kilo.reconcile_user_health(user_id) for each and re-verify parity.',
      v_divergent;
  end if;

  raise notice 'contract preconditions verified: mode=%, min_protocol=%, parity clean',
    v_cfg.mode, v_cfg.minimum_consent_protocol_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Remove the compatibility paths
-- ---------------------------------------------------------------------------

drop trigger if exists mirror_profile_to_health on kilo.user_profile;
drop trigger if exists mirror_health_to_profile on kilo.user_health_profile;
drop trigger if exists guard_legacy_health_columns on kilo.user_profile;

drop function if exists kilo.mirror_profile_to_health();
drop function if exists kilo.mirror_health_to_profile();
drop function if exists kilo.guard_legacy_health_columns();
drop function if exists kilo.reconcile_user_health(uuid);
drop function if exists kilo.health_parity_report();

-- ---------------------------------------------------------------------------
-- Drop the six legacy health columns
-- ---------------------------------------------------------------------------

alter table kilo.user_profile
  drop column if exists current_deload_note_raw_text,
  drop column if exists current_deload_note_saved_at,
  drop column if exists current_deload_note_updated_at,
  drop column if exists fatigue_multiplier,
  drop column if exists tracked_lifts,
  drop column if exists current_workout_note_id;

-- ---------------------------------------------------------------------------
-- Restore the normal timestamp trigger
-- ---------------------------------------------------------------------------

-- With no mirrors left there is no nested write and no reconciliation to protect,
-- so the canonical table goes back to the plain server-authoritative stamp: every
-- write is now() and nothing may preserve a client-supplied timestamp (#349).
drop trigger if exists set_updated_at on kilo.user_health_profile;
create trigger set_updated_at
  before insert or update on kilo.user_health_profile
  for each row execute function kilo.set_updated_at();

drop trigger if exists set_updated_at on kilo.user_profile;
create trigger set_updated_at
  before insert or update on kilo.user_profile
  for each row execute function kilo.set_updated_at();

drop function if exists kilo.set_updated_at_compat();
drop function if exists kilo.health_values_differ(
  text, timestamptz, timestamptz, numeric, jsonb, text,
  text, timestamptz, timestamptz, numeric, jsonb, text
);

-- ---------------------------------------------------------------------------
-- Post-check
-- ---------------------------------------------------------------------------

do $$
declare
  v_left integer;
begin
  select count(*) into v_left
  from information_schema.columns
  where table_schema = 'kilo'
    and table_name = 'user_profile'
    and column_name in (
      'current_deload_note_raw_text',
      'current_deload_note_saved_at',
      'current_deload_note_updated_at',
      'fatigue_multiplier',
      'tracked_lifts',
      'current_workout_note_id'
    );

  if v_left > 0 then
    raise exception 'contract failed: % legacy health column(s) still present on kilo.user_profile', v_left;
  end if;

  if exists (
    select 1 from pg_trigger
    where tgname in ('mirror_profile_to_health', 'mirror_health_to_profile')
      and not tgisinternal
  ) then
    raise exception 'contract failed: a compatibility mirror trigger is still installed';
  end if;

  raise notice 'contract complete: legacy health columns and all compatibility paths removed';
end;
$$;

-- No `commit;` here. See the header: an in-file commit defeats the rehearsal's
-- rollback and silently applies a destructive migration the operator believed they
-- were only dry-running. The caller owns the transaction.
