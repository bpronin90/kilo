-- Admit the recovery collections to the gated health set (issue #694).
--
-- #693 created kilo.recovery_blocks and kilo.recovery_block_weeks with
-- consent-gated RLS, but deliberately left them OUT of
-- kilo.health_gated_tables(), because that list has to move together with the
-- Edge Function HEALTH_DATA_SCOPE and the export/deletion surfaces, and those
-- were out of scope for that issue. This is the follow-up that moves them.
--
-- The list is not decorative. kilo.health_data_row_counts() walks it, and
-- kilo.complete_health_deletion_job() refuses the
-- deletion_pending -> withdrawn transition until every table on it counts zero
-- for the user. So while recovery data was missing from the list, a withdrawal
-- could be certified complete with the account's baseline snapshots and week
-- memberships still sitting in the cloud — the exact silent under-deletion the
-- shared-scope contract test exists to prevent.
--
-- Order matches supabase/functions/_shared/health-data-scope.ts, whose
-- descriptors delete `recovery_block_weeks` before `recovery_blocks` (child
-- before parent, so the purge does not depend on the FK cascade to remove rows
-- it believes it deleted itself). The array order here is cosmetic — the
-- function is a set membership check, not an execution plan — but keeping the
-- two files in the same order is what makes a divergence visible on sight.
--
-- No consent material-version bump accompanies this. #692/#693 added no new
-- health CATEGORY: recovery blocks are workout notes and training performance,
-- already covered by the granted scope and already gated by the RLS policies
-- shipped with those tables. This change closes the erasure/export gap for data
-- the existing grant already covers; a new category would require new copy and a
-- re-consent, which is explicitly out of scope for #694.
create or replace function kilo.health_gated_tables()
  returns text[]
  language sql
  immutable
  set search_path = ''
as $$
  select array[
    'user_health_profile',
    'weight_entries',
    'weight_goal',
    'archived_weight_goals',
    'workout_notes',
    'deload_history',
    'fatigue_checkins',
    'recovery_block_weeks',
    'recovery_blocks'
  ]::text[];
$$;

grant execute on function kilo.health_gated_tables() to service_role;

comment on function kilo.health_gated_tables() is
  'The consent-gated health tables. Mirrors HEALTH_DATA_SCOPE in supabase/functions/_shared/health-data-scope.ts; the two are checked for agreement by that module''s contract test. Adding a table here without adding it there (or the reverse) means Kilo either under-deletes on withdrawal or exports an incomplete copy.';
