-- Supabase advisor cleanup for the kilo schema (issue #418).
--
-- 1) auth_rls_initplan: every owner-scoped RLS policy called auth.uid()
--    directly in USING / WITH CHECK, which Postgres re-evaluates per row.
--    Wrapping the call in a scalar subquery -- (select auth.uid()) -- lets the
--    planner evaluate it once as an initplan and reuse the result for every
--    row. Row visibility is unchanged; this is purely an evaluation-strategy
--    fix. See:
--    https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
--
-- 2) no_primary_key: kilo.rate_limit_hits was a heap of (bucket, occurred_at)
--    hit rows with no primary key. Duplicate (bucket, occurred_at) rows are
--    legitimate (two admitted requests can share a timestamp), so a natural
--    unique index is wrong; add a surrogate identity primary key instead.
--    The existing ctid-based prune in kilo.rate_limit_prune keeps working.

-- ---------------------------------------------------------------------------
-- kilo.user_profile
-- ---------------------------------------------------------------------------
alter policy "user_profile_select_own" on kilo.user_profile
  using (user_id = (select auth.uid()));
alter policy "user_profile_insert_own" on kilo.user_profile
  with check (user_id = (select auth.uid()));
alter policy "user_profile_update_own" on kilo.user_profile
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "user_profile_delete_own" on kilo.user_profile
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- kilo.feature_toggles
-- ---------------------------------------------------------------------------
alter policy "feature_toggles_select_own" on kilo.feature_toggles
  using (user_id = (select auth.uid()));
alter policy "feature_toggles_insert_own" on kilo.feature_toggles
  with check (user_id = (select auth.uid()));
alter policy "feature_toggles_update_own" on kilo.feature_toggles
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "feature_toggles_delete_own" on kilo.feature_toggles
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- kilo.weight_entries
-- ---------------------------------------------------------------------------
alter policy "weight_entries_select_own" on kilo.weight_entries
  using (user_id = (select auth.uid()));
alter policy "weight_entries_insert_own" on kilo.weight_entries
  with check (user_id = (select auth.uid()));
alter policy "weight_entries_update_own" on kilo.weight_entries
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "weight_entries_delete_own" on kilo.weight_entries
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- kilo.weight_goal
-- ---------------------------------------------------------------------------
alter policy "weight_goal_select_own" on kilo.weight_goal
  using (user_id = (select auth.uid()));
alter policy "weight_goal_insert_own" on kilo.weight_goal
  with check (user_id = (select auth.uid()));
alter policy "weight_goal_update_own" on kilo.weight_goal
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "weight_goal_delete_own" on kilo.weight_goal
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- kilo.workout_notes
-- ---------------------------------------------------------------------------
alter policy "workout_notes_select_own" on kilo.workout_notes
  using (user_id = (select auth.uid()));
alter policy "workout_notes_insert_own" on kilo.workout_notes
  with check (user_id = (select auth.uid()));
alter policy "workout_notes_update_own" on kilo.workout_notes
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "workout_notes_delete_own" on kilo.workout_notes
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- kilo.deload_history
-- ---------------------------------------------------------------------------
alter policy "deload_history_select_own" on kilo.deload_history
  using (user_id = (select auth.uid()));
alter policy "deload_history_insert_own" on kilo.deload_history
  with check (user_id = (select auth.uid()));
alter policy "deload_history_update_own" on kilo.deload_history
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "deload_history_delete_own" on kilo.deload_history
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- kilo.fatigue_checkins
-- ---------------------------------------------------------------------------
alter policy "fatigue_checkins_select_own" on kilo.fatigue_checkins
  using (user_id = (select auth.uid()));
alter policy "fatigue_checkins_insert_own" on kilo.fatigue_checkins
  with check (user_id = (select auth.uid()));
alter policy "fatigue_checkins_update_own" on kilo.fatigue_checkins
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "fatigue_checkins_delete_own" on kilo.fatigue_checkins
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- kilo.rate_limit_hits primary key
-- ---------------------------------------------------------------------------
alter table kilo.rate_limit_hits
  add column id bigint generated always as identity primary key;
