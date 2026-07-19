-- Exclude expected purged accounts from health parity reporting (issue #542).
--
-- kilo.health_parity_report() (20260714120000_health_data_expand.sql) flags
-- 'missing_health_row' whenever a user_profile row has no matching
-- user_health_profile row. That absence is EXPECTED, not a divergence, while
-- the account's kilo.consent_state.status is 'deletion_pending' or
-- 'withdrawn': the withdrawal purge intentionally deletes the gated health
-- row while preserving the account profile (20260714120001_consent_schema.sql,
-- 20260714120002_health_deletion_jobs.sql).
--
-- The report must keep flagging a missing health row for every other state --
-- 'granted', 'needs_reconsent', or no consent_state row at all (never
-- consented) -- because those are exactly the states where an absent health
-- row is a genuine, actionable divergence. #492's production qualification
-- currently has one such granted-account divergence, tracked by the
-- re-consent rebuild issue (#538); this change must not hide it.
--
-- Only the missing_health_row branch is touched. missing_profile_row,
-- timestamp_mismatch, and value_mismatch are unaffected: they only occur when
-- both rows exist (or, for missing_profile_row, when the health row exists
-- without an account), neither of which the purge lifecycle exempts.
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
  left join kilo.consent_state cs on cs.user_id = p.user_id
  where (
      p.user_id is null
      or h.user_id is null
      or p.updated_at is distinct from h.updated_at
      or kilo.health_values_differ(
           p.current_deload_note_raw_text, p.current_deload_note_saved_at,
           p.current_deload_note_updated_at, p.fatigue_multiplier,
           p.tracked_lifts, p.current_workout_note_id,
           h.current_deload_note_raw_text, h.current_deload_note_saved_at,
           h.current_deload_note_updated_at, h.fatigue_multiplier,
           h.tracked_lifts, h.current_workout_note_id
         )
    )
    -- Suppress ONLY the expected-purge absence: a health row missing for an
    -- account currently deletion_pending or withdrawn. Every other missing
    -- combination (granted, needs_reconsent, or no consent_state row) still
    -- surfaces, and missing_profile_row is never touched by this predicate.
    -- coalesce(..., false) is load-bearing: a user with no consent_state row
    -- has cs.status = null, and `null in (...)` is null, not false -- without
    -- the coalesce, `not (... and null)` is itself null and Postgres discards
    -- the row from a WHERE clause on null exactly as it would on false,
    -- silently hiding a never-consented account's genuine missing health row.
    and not (
      h.user_id is null
      and p.user_id is not null
      and coalesce(cs.status in ('deletion_pending', 'withdrawn'), false)
    );
$$;
