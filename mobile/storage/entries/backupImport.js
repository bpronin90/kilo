import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WEIGHT_KEY,
  WEIGHT_GOAL_KEY,
  WORKOUT_NOTES_KEY,
  WORKOUT_DELOAD_HISTORY_KEY,
  CURRENT_WORKOUT_ID_KEY,
} from './keys';
import { readList, writeList } from './jsonStorage';
import { loadCurrentWorkoutId } from './workoutNotes';
import { loadWeightGoal } from './weightGoal';
import { loadUserProfile } from './profileStorage';
import {
  loadFatigueMultiplier,
  loadWeightDateEditEnabled,
  loadDeloadDateEditEnabled,
  loadFatigueTrackingEnabled,
  loadDeloadModeEnabled,
  loadTrackedLifts,
  loadWorkoutCollapsed,
  saveFatigueMultiplier,
} from './settings';
import { loadDeloadNote } from './deloadStorage';

const BACKUP_VERSION = '3';
const CLOUD_EXPORT_FORMAT = 'cloud-1';
const SUPPORTED_VERSIONS = new Set(['1', '2', BACKUP_VERSION]);

// Untrusted-input bounds for imported backups. importBackup() receives arbitrary
// pasted/JSON-parsed text and validates arrays element-by-element, so without a
// length bound a pathologically large payload can freeze the device. These caps
// sit far above any realistic backup (a heavy user accumulates thousands of
// entries, not hundreds of thousands) but reject oversized payloads with a clear
// error before the per-element validation loops run.
const MAX_IMPORT_ARRAY_LENGTH = 100000;
// Per-note raw_text cap, matching the workout-note parser's MAX_RAW_TEXT_LENGTH,
// so an imported note cannot smuggle in text the parser would later reject.
const MAX_IMPORT_RAW_TEXT_LENGTH = 200000;

export async function exportBackup() {
  const weight_entries = await readList(WEIGHT_KEY);
  const workout_notes = await readList(WORKOUT_NOTES_KEY);
  const current_workout_id = await loadCurrentWorkoutId();
  const weight_goal = await loadWeightGoal();
  const fatigue_multiplier = await loadFatigueMultiplier();
  const deload_history = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  return {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    weight_entries,
    workout_notes,
    current_workout_id,
    weight_goal,
    fatigue_multiplier,
    deload_history,
  };
}

// Cloud export parity (Phase 4 / Task 12).
//
// Cloud users need an export that is a strict superset of the v3 backup shape so
// it stays importable via importBackup(), but also carries the account-scoped
// data the roadmap calls out for self-serve cloud users: profile, feature
// toggles, and the preferences/pointers that live on user_profile in the cloud
// model (roadmap "Self-Serve Product Obligations": "v3 backup shape plus
// account/profile/toggle additions needed for cloud users").
//
// The base payload is exactly exportBackup() (version "3"), so any v3 importer
// ignores the extra `cloud` block. The cloud-only additions are namespaced
// under `cloud` to keep the v3 top-level contract untouched.
export async function buildCloudExport({ account = null } = {}) {
  const base = await exportBackup();

  const [
    profile,
    weightDateEditEnabled,
    deloadDateEditEnabled,
    fatigueTrackingEnabled,
    deloadModeEnabled,
    trackedLifts,
    deloadNote,
    logCurrentCollapsed,
  ] = await Promise.all([
    loadUserProfile(),
    loadWeightDateEditEnabled(),
    loadDeloadDateEditEnabled(),
    loadFatigueTrackingEnabled(),
    loadDeloadModeEnabled(),
    loadTrackedLifts(),
    loadDeloadNote(),
    loadWorkoutCollapsed(),
  ]);

  return {
    ...base,
    cloud: {
      cloud_export_format: CLOUD_EXPORT_FORMAT,
      account: account
        ? { id: account.id ?? null, email: account.email ?? null }
        : null,
      user_profile: profile,
      current_workout_id: base.current_workout_id,
      current_deload_note: deloadNote,
      tracked_lifts: trackedLifts,
      ui_state: { log_current_collapsed: logCurrentCollapsed },
      feature_toggles: {
        weight_date_edit_enabled: weightDateEditEnabled,
        deload_date_edit_enabled: deloadDateEditEnabled,
        fatigue_tracking_enabled: fatigueTrackingEnabled,
        deload_mode_enabled: deloadModeEnabled,
      },
    },
  };
}

function validateWeightEntries(entries) {
  if (!Array.isArray(entries))
    return { ok: false, error: 'Invalid backup: weight_entries must be an array' };
  if (entries.length > MAX_IMPORT_ARRAY_LENGTH)
    return { ok: false, error: `Invalid backup: weight_entries too large (${entries.length}; limit ${MAX_IMPORT_ARRAY_LENGTH})` };
  for (const e of entries) {
    if (!e || typeof e !== 'object')
      return { ok: false, error: 'Invalid backup: weight entry is not an object' };
    if (typeof e.id !== 'string')
      return { ok: false, error: 'Invalid backup: weight entry missing id' };
    if (e.entry_type !== 'weight')
      return { ok: false, error: 'Invalid backup: weight entry has wrong entry_type' };
    if (typeof e.date !== 'string')
      return { ok: false, error: 'Invalid backup: weight entry missing date' };
    if (typeof e.weight_value !== 'number')
      return { ok: false, error: 'Invalid backup: weight entry missing weight_value' };
    if (typeof e.logged_at !== 'string')
      return { ok: false, error: 'Invalid backup: weight entry missing logged_at' };
  }
  return { ok: true };
}

function validateBackup(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return { ok: false, error: 'Invalid backup: not an object' };
  if (!SUPPORTED_VERSIONS.has(payload.version))
    return { ok: false, error: `Unsupported backup version: ${payload.version}` };

  const weightCheck = validateWeightEntries(payload.weight_entries);
  if (!weightCheck.ok) return weightCheck;

  if (payload.version === '2' || payload.version === BACKUP_VERSION) {
    if (!Array.isArray(payload.workout_notes))
      return { ok: false, error: 'Invalid backup: workout_notes must be an array' };
    if (payload.workout_notes.length > MAX_IMPORT_ARRAY_LENGTH)
      return { ok: false, error: `Invalid backup: workout_notes too large (${payload.workout_notes.length}; limit ${MAX_IMPORT_ARRAY_LENGTH})` };
    for (const n of payload.workout_notes) {
      if (!n || typeof n !== 'object' || Array.isArray(n))
        return { ok: false, error: 'Invalid backup: workout note is not an object' };
      if (typeof n.id !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing id' };
      if (typeof n.title !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing title' };
      if (typeof n.raw_text !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing raw_text' };
      if (n.raw_text.length > MAX_IMPORT_RAW_TEXT_LENGTH)
        return { ok: false, error: `Invalid backup: workout note raw_text too large (${n.raw_text.length}; limit ${MAX_IMPORT_RAW_TEXT_LENGTH})` };
    }
    if (payload.current_workout_id !== null && typeof payload.current_workout_id !== 'string')
      return { ok: false, error: 'Invalid backup: current_workout_id must be a string or null' };
    if ('weight_goal' in payload && payload.weight_goal !== null) {
      const g = payload.weight_goal;
      if (!g || typeof g !== 'object' || Array.isArray(g))
        return { ok: false, error: 'Invalid backup: weight_goal must be an object or null' };
      if (typeof g.target_weight !== 'number')
        return { ok: false, error: 'Invalid backup: weight_goal missing target_weight' };
      if (typeof g.target_date !== 'string')
        return { ok: false, error: 'Invalid backup: weight_goal missing target_date' };
    }
    if (payload.version === BACKUP_VERSION && 'deload_history' in payload) {
      if (!Array.isArray(payload.deload_history))
        return { ok: false, error: 'Invalid backup: deload_history must be an array' };
      if (payload.deload_history.length > MAX_IMPORT_ARRAY_LENGTH)
        return { ok: false, error: `Invalid backup: deload_history too large (${payload.deload_history.length}; limit ${MAX_IMPORT_ARRAY_LENGTH})` };
    }
  }

  return { ok: true };
}

// Restores a backup. strategy 'replace' overwrites all local data atomically.
// Returns { ok: true } or { ok: false, error: string }.
// Validation runs before any write; storage is not mutated on failure.
// v1 backups restore weight entries only; workout notes state is left untouched.
export async function importBackup(payload, strategy = 'replace') {
  const check = validateBackup(payload);
  if (!check.ok) return check;

  if (strategy === 'replace') {
    // WORKOUT_KEY (legacy sessions) is not part of the backup scope and is not touched.
    const pairs = [[WEIGHT_KEY, JSON.stringify(payload.weight_entries)]];

    if (payload.version === '2' || payload.version === BACKUP_VERSION) {
      pairs.push([WORKOUT_NOTES_KEY, JSON.stringify(payload.workout_notes)]);
      await AsyncStorage.multiSet(pairs);
      if (payload.current_workout_id != null) {
        await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(payload.current_workout_id));
      } else {
        await AsyncStorage.removeItem(CURRENT_WORKOUT_ID_KEY);
      }
      if ('weight_goal' in payload) {
        if (payload.weight_goal != null) {
          await AsyncStorage.setItem(WEIGHT_GOAL_KEY, JSON.stringify(payload.weight_goal));
        } else {
          await AsyncStorage.removeItem(WEIGHT_GOAL_KEY);
        }
      }
      if ('fatigue_multiplier' in payload && payload.fatigue_multiplier != null) {
        await saveFatigueMultiplier(payload.fatigue_multiplier);
      }
      if (payload.version === BACKUP_VERSION && 'deload_history' in payload) {
        await writeList(WORKOUT_DELOAD_HISTORY_KEY, payload.deload_history);
      }
    } else {
      // v1: restore weight entries only; workout notes model was not part of the v1 contract
      await AsyncStorage.multiSet(pairs);
    }
  }

  return { ok: true };
}
