-- Fix profile<->health mirror updated_at watermark drift (issue #508).
--
-- kilo.health_parity_report() flagged 2 divergences, both 'timestamp_mismatch'
-- with kilo.health_values_differ(...) = false: the mirrored health content was
-- identical on both sides, only the updated_at watermark disagreed. This is a
-- hard blocker for #492 (Article 9 consent enforcement cannot flip on a red
-- parity gate).
--
-- Root cause
-- ----------
-- kilo.mirror_profile_to_health() and kilo.mirror_health_to_profile()
-- (20260714120000_health_data_expand.sql) skip their upsert on UPDATE when
-- kilo.health_values_differ(old, new) is false, to avoid a mirror write per
-- unrelated account edit. But kilo.set_updated_at_compat() stamps
-- <table>.updated_at = now() on EVERY top-level write, health-relevant or not.
-- So an account-only write (user_profile.display_name / unit_system / ui_state,
-- or a user_health_profile write that touches no compared value) advances one
-- table's updated_at while the mirror is skipped and the other table's
-- updated_at stays frozen at the last genuine health write -- exactly the
-- timestamp_mismatch / values_differ = false drift the parity gate flagged.
--
-- Fix (consent-safe watermark sync)
-- ---------------------------------
-- On an account-only write (health_values_differ = false on an UPDATE), advance
-- the counterpart row's updated_at to match -- but ONLY for a row that already
-- exists. Never INSERT on this path.
--
-- Why "never INSERT" is load-bearing (the consent/purge invariant)
-- ----------------------------------------------------------------
-- Both mirrors are SECURITY DEFINER and bypass the health_gate_ok() RLS layered
-- on kilo.user_health_profile. kilo.guard_legacy_health_columns() lets an
-- account-only user_profile write through WITHOUT a consent check (v_changed is
-- false, so it never calls health_gate_ok) -- correct, because display_name must
-- keep working for a user who refuses or has withdrawn health consent. If the
-- mirror upserted unconditionally on that write it would:
--   (a) CREATE a kilo.user_health_profile row for a user who never consented,
--       bypassing the gate that governs that table, and
--   (b) RESURRECT a row after a withdrawal purge deleted it -- and
--       kilo.health_gated_tables() lists user_health_profile, so
--       kilo.health_data_row_counts() would count the resurrected row and the
--       deletion_pending -> withdrawn verification would never reach zero.
-- Restricting the account-only path to updating an EXISTING row's watermark
-- (a plain UPDATE ... WHERE user_id = ... that matches zero rows when the row is
-- absent) maintains parity without ever creating or resurrecting a health row.
--
-- The genuine-health-write path (health_values_differ = true, and every INSERT)
-- is unchanged: it still upserts full content + watermark. On the user_profile
-- side that path is already consent-gated by guard_legacy_health_columns (it
-- raises unless health_gate_ok), so an INSERT there only happens for a write the
-- user was allowed to make. On the user_health_profile side the INSERT path is
-- reached only when a consent-capable client wrote that gated table directly.
--
-- Post-purge parity note: a purged user's health row is intentionally absent, so
-- the account-only path leaves it absent. Such a user surfaces in the parity
-- report as 'missing_health_row', NOT 'timestamp_mismatch'; that is the purge
-- domain (#492/#487), out of scope here, and this change never converts a purged
-- (missing) row back into a present one.
--
-- LWW is preserved: the canonical user_health_profile wins ties, so the legacy
-- side syncs on strictly-later (`>`) and the canonical side on `>=`, matching the
-- existing upsert predicates. Because set_updated_at_compat is server-generated
-- and monotonic, a genuine account-only write's now() is >= the counterpart's
-- last stamp, so the guarded UPDATE fires in normal operation and only declines
-- to move a watermark backward.
--
-- This changes only the mirror-write path. It does not touch health_sync_config,
-- any consent policy, or enforcement -- that stays with #492.

-- ---------------------------------------------------------------------------
-- 1. Mirror: user_profile -> user_health_profile
-- ---------------------------------------------------------------------------
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

  -- #508: account-only write (no compared health value changed). Advance the
  -- watermark of an EXISTING mirror row only -- never INSERT, or we would create
  -- a health row for an unconsented user or resurrect one after purge (see
  -- header). A missing row matches zero rows and is left absent. The nested
  -- UPDATE runs at depth 2, so set_updated_at_compat preserves this timestamp
  -- and mirror_health_to_profile's recursion guard fires -- no ping-pong.
  if tg_op = 'UPDATE' and not kilo.health_values_differ(
    old.current_deload_note_raw_text, old.current_deload_note_saved_at,
    old.current_deload_note_updated_at, old.fatigue_multiplier,
    old.tracked_lifts, old.current_workout_note_id,
    new.current_deload_note_raw_text, new.current_deload_note_saved_at,
    new.current_deload_note_updated_at, new.fatigue_multiplier,
    new.tracked_lifts, new.current_workout_note_id
  ) then
    update kilo.user_health_profile h
       set updated_at = new.updated_at
     -- Strictly later wins; canonical user_health_profile is authoritative on a tie.
     where h.user_id = new.user_id
       and new.updated_at > h.updated_at;
    return null;
  end if;

  -- Genuine health write (or INSERT): full content + watermark upsert, exactly
  -- as before. On user_profile this path is consent-gated by
  -- guard_legacy_health_columns, so an INSERT here reflects an allowed write.
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

-- ---------------------------------------------------------------------------
-- 2. Mirror: user_health_profile -> user_profile
-- ---------------------------------------------------------------------------
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

  -- #508: account-only write on the canonical table (no compared health value
  -- changed -- e.g. a deleted_at-only touch or a value re-set to itself). Advance
  -- the EXISTING legacy row's watermark only; never INSERT a phantom profile row
  -- just to carry a timestamp. The account row essentially always exists here;
  -- if it does not, leaving it absent surfaces as 'missing_profile_row', which is
  -- not this issue's domain.
  if tg_op = 'UPDATE' and not kilo.health_values_differ(
    old.current_deload_note_raw_text, old.current_deload_note_saved_at,
    old.current_deload_note_updated_at, old.fatigue_multiplier,
    old.tracked_lifts, old.current_workout_note_id,
    new.current_deload_note_raw_text, new.current_deload_note_saved_at,
    new.current_deload_note_updated_at, new.fatigue_multiplier,
    new.tracked_lifts, new.current_workout_note_id
  ) then
    update kilo.user_profile p
       set updated_at = new.updated_at
     -- Canonical table wins ties, so it syncs out on >= rather than >.
     where p.user_id = new.user_id
       and new.updated_at >= p.updated_at;
    return null;
  end if;

  -- Genuine health write (or INSERT): full content + watermark mirror, exactly
  -- as before.
  --
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

-- ---------------------------------------------------------------------------
-- 3. Reconcile existing timestamp-only divergences, then assert full parity.
-- ---------------------------------------------------------------------------
--
-- Do NOT hard-code the flagged user ids (#508 sampled 841fa8e5... and
-- dee2d064...). Iterate the LIVE report and reconcile every timestamp-only
-- mismatch present AT APPLY TIME, so a row that drifts in or out between
-- authoring and apply is handled rather than rolling the whole migration
-- (including the trigger fix above) back over a stale hard-coded list.
--
-- Only 'timestamp_mismatch' rows are reconciled. kilo.reconcile_user_health()
-- copies the LWW winner onto the loser WITHOUT restamping (it suppresses
-- set_updated_at_compat via kilo.suppress_updated_at_stamp), so a
-- timestamp-only mismatch -- content already identical -- is repaired to the
-- winner's genuine originating watermark with zero content change. We
-- deliberately do NOT auto-reconcile 'missing_health_row' /
-- 'missing_profile_row' / 'value_mismatch': reconcile would resurrect a purged
-- health row for the missing case, and content divergences are not this issue's
-- domain. Any such row makes the final assertion fail and rolls the migration
-- back rather than silently mutating production into an unexpected state.
do $$
declare
  r record;
  v_remaining int;
begin
  for r in
    select user_id
    from kilo.health_parity_report()
    where divergence = 'timestamp_mismatch'
  loop
    perform kilo.reconcile_user_health(r.user_id);
  end loop;

  select count(*) into v_remaining from kilo.health_parity_report();
  if v_remaining <> 0 then
    raise exception
      '#508: kilo.health_parity_report() still reports % divergent row(s) after reconciliation; rolling back',
      v_remaining;
  end if;
end;
$$;
