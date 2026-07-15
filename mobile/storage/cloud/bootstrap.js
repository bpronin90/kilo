import * as Storage from '../entries';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { BootstrapError } from './errors';
import { buildBootstrapPlan } from './bootstrapPlan';
import { loadArchivedWeightGoalsRaw } from '../entries/weightGoal';
import { SYNC_TABLES, getDirtyRecords } from '../syncQueue';

const SCHEMA = 'kilo';

// The fatigue multiplier a device reports when the user has never touched it.
// Mirrors syncAdapter's DEFAULT_FATIGUE_MULTIPLIER; a value equal to it is not
// user content.
const DEFAULT_FATIGUE_MULTIPLIER = 1.07;

// user_health_profile carries the six health values that used to sit on the mixed
// user_profile row (#487). It is gated: the upsert below only succeeds for a user
// with an active grant.
const UPSERT_ORDER = [
  'feature_toggles',
  'weight_entries',
  'weight_goal',
  'workout_notes',
  'deload_history',
  'user_profile',
  'user_health_profile',
];

const CONFLICT_TARGETS = {
  user_profile: 'user_id',
  user_health_profile: 'user_id',
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

// True only when this device holds NOTHING that a sync could push to the cloud
// and nothing the "This device is empty" restore prompt would misrepresent: no
// local domain records (weight entries, workout content, current routine,
// tracked lifts, profile, active goal, ARCHIVED goals, deload history, a current
// deload note), every setting/singleton at its shipped default (toggles, fatigue
// multiplier, and the collapsed-panel ui_state), and no records queued dirty.
//
// This is the precondition for the pull-only restore path (issue #499). The
// ongoing sync is genuinely download-only exactly when there is nothing to push
// — a truly empty device pulls the account down and pushes nothing — so
// "Download my account's data" may only be offered/run on a device that
// satisfies this. A device with any real local state must instead use "Upload My
// History" (a merge), so Download never silently uploads or overwrites the
// account with unrelated local data.
//
// The check spans EVERY field bootstrap or ongoing sync touches, not just the
// synced push tables, because:
//   - archived_weight_goals is a collection contract carried by ongoing sync;
//   - the current deload note is projected into user_profile by bootstrap;
//   - a non-default collapsed panel is projected into user_profile.ui_state and,
//     on a seeded first pass with an absent remote profile row, is stamped dirty
//     and pushed by the normal bidirectional sync (isEmptyUserProfile ignores
//     ui_state, so it does NOT protect this path).
// The dirty-queue check alone does not close these gaps: local records/settings
// can exist without a pending dirty entry — the guard's job is to decide whether
// the DEVICE is empty before switching it to the merge engine.
//
// Deliberately STRICTER than isCleanLocalState above, which only gates the
// bootstrap-time profile hydrate and inspects profile/routine/tracked lifts.
export async function isLocalDataEmpty() {
  const [snapshot, archivedGoals] = await Promise.all([
    readLocalSnapshot(),
    loadArchivedWeightGoalsRaw(),
  ]);

  const hasWeightEntries =
    Array.isArray(snapshot.weightEntries) && snapshot.weightEntries.length > 0;
  const hasWorkoutContent =
    (Array.isArray(snapshot.workoutNotes) && snapshot.workoutNotes.length > 0) ||
    Boolean(snapshot.workoutNote && snapshot.workoutNote.raw_text) ||
    (Array.isArray(snapshot.workoutSessions) && snapshot.workoutSessions.length > 0);
  const hasCurrentWorkout = snapshot.currentWorkoutId != null;
  const hasTrackedLifts =
    snapshot.trackedLifts && Object.keys(snapshot.trackedLifts).length > 0;
  const hasProfile = snapshot.userProfile != null;
  const hasGoal = snapshot.weightGoal != null;
  const hasArchivedGoals = Array.isArray(archivedGoals) && archivedGoals.length > 0;
  const hasDeloadHistory =
    Array.isArray(snapshot.deloadHistory) && snapshot.deloadHistory.length > 0;
  const hasDeloadNote = Boolean(snapshot.deloadNote && snapshot.deloadNote.raw_text);
  const hasCollapsedState = snapshot.logCurrentCollapsed === true;
  const hasNonDefaultToggles =
    snapshot.weightDateEditEnabled === true ||
    snapshot.deloadDateEditEnabled === true ||
    snapshot.fatigueTrackingEnabled === false ||
    snapshot.deloadModeEnabled === false;
  const hasNonDefaultMultiplier =
    snapshot.fatigueMultiplier != null &&
    Number(snapshot.fatigueMultiplier) !== DEFAULT_FATIGUE_MULTIPLIER;

  if (
    hasWeightEntries ||
    hasWorkoutContent ||
    hasCurrentWorkout ||
    hasTrackedLifts ||
    hasProfile ||
    hasGoal ||
    hasArchivedGoals ||
    hasDeloadHistory ||
    hasDeloadNote ||
    hasCollapsedState ||
    hasNonDefaultToggles ||
    hasNonDefaultMultiplier
  ) {
    return false;
  }

  // Even with empty domain state, a leftover dirty record (e.g. a tombstone from
  // a prior cloud session) would push on the next pass. Fetch all tables in
  // parallel — keyed reads, no nested scan.
  const dirtyByTable = await Promise.all(
    Object.values(SYNC_TABLES).map((table) => getDirtyRecords(table))
  );
  return dirtyByTable.every((records) => records.length === 0);
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

  // Consent (#487) is enforced by the caller (hooks/entries/syncRecoveryHooks.js)
  // and, authoritatively, by the server's RLS gate: the user_health_profile upsert
  // below simply fails for a user without an active grant. This function stays a
  // pure upload plan so it remains drivable with an injected client.
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
