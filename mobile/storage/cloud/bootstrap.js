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

// True only for a device that holds no local profile/routine/tracked-lift
// state at all — a genuinely fresh install, or an account's first-ever
// sign-in on this device. Gates the download-and-hydrate restore below so it
// can only ever fill in empty local state, never overwrite a device's real
// existing data (issues #481/#482/#483 root cause: bootstrap only ever pushed
// local state to the cloud, so a clean second device had nothing to restore
// from). Deliberately narrow: presence of any of these fields means this
// device already has something to protect, so no download is attempted and
// bootstrapFromLocal behaves exactly as it did before.
function isCleanLocalState(snapshot) {
  const hasWorkoutContent =
    (Array.isArray(snapshot.workoutNotes) && snapshot.workoutNotes.length > 0) ||
    Boolean(snapshot.workoutNote && snapshot.workoutNote.raw_text) ||
    (Array.isArray(snapshot.workoutSessions) && snapshot.workoutSessions.length > 0);
  const hasCurrentWorkout = snapshot.currentWorkoutId != null;
  const hasTrackedLifts =
    snapshot.trackedLifts && Object.keys(snapshot.trackedLifts).length > 0;
  const hasProfile = snapshot.userProfile != null;
  return !hasWorkoutContent && !hasCurrentWorkout && !hasTrackedLifts && !hasProfile;
}

// Download the account's existing user_profile and feature_toggles rows (the
// two singleton tables bootstrapFromLocal writes but never reads back). Both
// are optional — a brand-new account with nothing bootstrapped yet from any
// device simply has neither row, and that is not an error.
async function downloadProfileAndToggles(db, userId) {
  const [profileRes, togglesRes] = await Promise.all([
    db.from('user_profile').select('*').eq('user_id', userId).maybeSingle(),
    db.from('feature_toggles').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  if (profileRes.error) {
    throw new BootstrapError(
      `Bootstrap restore failed reading user_profile: ${profileRes.error.message || profileRes.error}`,
      { step: 'restore:user_profile', cause: profileRes.error }
    );
  }
  if (togglesRes.error) {
    throw new BootstrapError(
      `Bootstrap restore failed reading feature_toggles: ${togglesRes.error.message || togglesRes.error}`,
      { step: 'restore:feature_toggles', cause: togglesRes.error }
    );
  }
  return { profile: profileRes.data || null, toggles: togglesRes.data || null };
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
  const db = client.schema(SCHEMA);

  // Clean-install restore (#481/#482/#483 shared root cause): when this device
  // has no local profile/routine/tracked-lift state, pull down the account's
  // cloud profile and feature-toggle rows and hydrate them into local storage
  // before building the push plan below. This is a one-directional download —
  // no merge/conflict semantics — so it only ever applies to empty local
  // state (see isCleanLocalState) and is safe to re-run: idempotent by
  // construction, since re-hydrating the same cloud values and re-uploading
  // them changes nothing.
  let snapshotForPlan = snapshot;
  if (isCleanLocalState(snapshot)) {
    const { profile, toggles } = await downloadProfileAndToggles(db, userId);
    if (profile || toggles) {
      await Storage.hydrateProfileFromCloud(profile, toggles);
      snapshotForPlan = await readLocalSnapshot();
    }
  }

  const plan = buildBootstrapPlan(snapshotForPlan, userId);

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
