import * as Storage from '../entries';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { BootstrapError } from './errors';
import { buildBootstrapPlan } from './bootstrapPlan';

const SCHEMA = 'kilo';

const UPSERT_ORDER = [
  'feature_toggles',
  'weight_entries',
  'weight_goal',
  'workout_notes',
  'deload_history',
  'user_profile',
];

const CONFLICT_TARGETS = {
  user_profile: 'user_id',
  feature_toggles: 'user_id',
  weight_entries: 'user_id,id',
  weight_goal: 'user_id',
  workout_notes: 'user_id,id',
  deload_history: 'user_id,id',
};

async function readLocalSnapshot() {
  const [
    weightEntries,
    weightGoal,
    workoutSessions,
    workoutNote,
    workoutNotes,
    currentWorkoutId,
    fatigueMultiplier,
    weightDateEditEnabled,
    deloadNote,
    deloadHistory,
    trackedLifts,
    logCurrentCollapsed,
    userProfile,
    deloadDateEditEnabled,
    fatigueTrackingEnabled,
    deloadModeEnabled,
  ] = await Promise.all([
    Storage.loadWeightEntries(),
    Storage.loadWeightGoal(),
    Storage.loadWorkoutSessions(),
    Storage.loadWorkoutNote(),
    Storage.loadWorkoutNotes(),
    Storage.loadCurrentWorkoutId(),
    Storage.loadFatigueMultiplier(),
    Storage.loadWeightDateEditEnabled(),
    Storage.loadDeloadNote(),
    Storage.loadDeloadHistory(),
    Storage.loadTrackedLifts(),
    Storage.loadWorkoutCollapsed(),
    Storage.loadUserProfile(),
    Storage.loadDeloadDateEditEnabled(),
    Storage.loadFatigueTrackingEnabled(),
    Storage.loadDeloadModeEnabled(),
  ]);

  return {
    weightEntries,
    weightGoal,
    workoutSessions,
    workoutNote,
    workoutNotes,
    currentWorkoutId,
    fatigueMultiplier,
    weightDateEditEnabled,
    deloadNote,
    deloadHistory,
    trackedLifts,
    logCurrentCollapsed,
    userProfile,
    deloadDateEditEnabled,
    fatigueTrackingEnabled,
    deloadModeEnabled,
  };
}

export async function bootstrapFromLocal(userId, client = getSupabaseClient()) {
  if (!userId) {
    throw new BootstrapError('bootstrapFromLocal requires a userId', {
      step: 'precheck',
    });
  }
  if (!client) {
    throw new BootstrapError(
      'Cloud is not configured; cannot bootstrap to Supabase.',
      { step: 'precheck' }
    );
  }

  const snapshot = await readLocalSnapshot();
  const plan = buildBootstrapPlan(snapshot, userId);
  const db = client.schema(SCHEMA);

  const summary = {};
  for (const table of UPSERT_ORDER) {
    const rows = plan[table] || [];
    summary[table] = rows.length;
    if (rows.length === 0) continue;

    const { error } = await db
      .from(table)
      .upsert(rows, { onConflict: CONFLICT_TARGETS[table] });
    if (error) {
      throw new BootstrapError(
        `Bootstrap failed writing ${table}: ${error.message || error}`,
        { step: table, cause: error }
      );
    }
  }

  return { ok: true, userId, summary };
}
