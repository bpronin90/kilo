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
import { loadUserProfile, saveUserProfile } from './profileStorage';
import {
  loadFatigueMultiplier,
  loadWeightDateEditEnabled,
  loadDeloadDateEditEnabled,
  loadFatigueTrackingEnabled,
  loadDeloadModeEnabled,
  loadTrackedLifts,
  loadWorkoutCollapsed,
  saveFatigueMultiplier,
  saveTrackedLifts,
  saveWorkoutCollapsed,
  saveWeightDateEditEnabled,
  saveDeloadDateEditEnabled,
  saveFatigueTrackingEnabled,
  saveDeloadModeEnabled,
} from './settings';
import { loadDeloadNote, saveDeloadNote } from './deloadStorage';

const BACKUP_VERSION = '3';
const CLOUD_EXPORT_FORMAT = 'cloud-1';
const CLOUD_FEATURE_TOGGLE_KEYS = [
  'weight_date_edit_enabled',
  'deload_date_edit_enabled',
  'fatigue_tracking_enabled',
  'deload_mode_enabled',
];
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
// Sane bounds for the fatigue multiplier (default 1.07; a realistic user-tunable
// value stays close to 1.0). Anything non-finite, non-positive, or absurdly large
// would otherwise flow into fatigue calc (kilo_max_adjusted = avg * multiplier)
// producing NaN or nonsense results.
const MIN_IMPORT_FATIGUE_MULTIPLIER = 0;
const MAX_IMPORT_FATIGUE_MULTIPLIER = 10;

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
// Security (#350): the cloud block can carry account identity. The account `id`
// is an opaque, non-PII identifier and is always safe to include. The account
// `email` is personal data, so it is excluded from the shareable artifact unless
// the caller explicitly opts in via `includeEmail: true`. This keeps email out
// of any incidentally-shared export by default while preserving the option for
// flows that genuinely need the signed-in identity in the payload.
export async function buildCloudExport({ account = null, includeEmail = false } = {}) {
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
        ? {
            id: account.id ?? null,
            // Email is personal data and is omitted unless explicitly opted in.
            ...(includeEmail ? { email: account.email ?? null } : {}),
          }
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

function validateDeloadHistory(entries) {
  if (!Array.isArray(entries))
    return { ok: false, error: 'Invalid backup: deload_history must be an array' };
  if (entries.length > MAX_IMPORT_ARRAY_LENGTH)
    return { ok: false, error: `Invalid backup: deload_history too large (${entries.length}; limit ${MAX_IMPORT_ARRAY_LENGTH})` };
  for (const d of entries) {
    if (!d || typeof d !== 'object' || Array.isArray(d))
      return { ok: false, error: 'Invalid backup: deload history entry is not an object' };
    if ('id' in d && typeof d.id !== 'string')
      return { ok: false, error: 'Invalid backup: deload history entry id must be a string' };
    if ('title' in d && typeof d.title !== 'string')
      return { ok: false, error: 'Invalid backup: deload history entry title must be a string' };
    if ('raw_text' in d) {
      if (typeof d.raw_text !== 'string')
        return { ok: false, error: 'Invalid backup: deload history entry raw_text must be a string' };
      if (d.raw_text.length > MAX_IMPORT_RAW_TEXT_LENGTH)
        return { ok: false, error: `Invalid backup: deload history raw_text too large (${d.raw_text.length}; limit ${MAX_IMPORT_RAW_TEXT_LENGTH})` };
    }
  }
  return { ok: true };
}

function validateFatigueMultiplier(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= MIN_IMPORT_FATIGUE_MULTIPLIER ||
    value > MAX_IMPORT_FATIGUE_MULTIPLIER
  ) {
    return { ok: false, error: 'Invalid backup: fatigue_multiplier must be a finite number in a sane range' };
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
      const deloadCheck = validateDeloadHistory(payload.deload_history);
      if (!deloadCheck.ok) return deloadCheck;
    }
    if ('fatigue_multiplier' in payload && payload.fatigue_multiplier != null) {
      const fatigueCheck = validateFatigueMultiplier(payload.fatigue_multiplier);
      if (!fatigueCheck.ok) return fatigueCheck;
    }
  }

  if ('cloud' in payload && payload.cloud != null) {
    const cloudCheck = validateCloudBlock(payload.cloud);
    if (!cloudCheck.ok) return cloudCheck;
  }

  return { ok: true };
}

// The `cloud` block is optional: a plain v3 file has none and must still import
// exactly as before. When present it is untrusted input like the rest of the
// payload, so it is validated before any write.
function validateCloudBlock(cloud) {
  if (typeof cloud !== 'object' || Array.isArray(cloud))
    return { ok: false, error: 'Invalid backup: cloud must be an object' };

  if (cloud.user_profile != null) {
    if (typeof cloud.user_profile !== 'object' || Array.isArray(cloud.user_profile))
      return { ok: false, error: 'Invalid backup: cloud.user_profile must be an object or null' };
  }
  if (cloud.tracked_lifts != null) {
    if (typeof cloud.tracked_lifts !== 'object' || Array.isArray(cloud.tracked_lifts))
      return { ok: false, error: 'Invalid backup: cloud.tracked_lifts must be an object or null' };
  }
  if (cloud.ui_state != null) {
    if (typeof cloud.ui_state !== 'object' || Array.isArray(cloud.ui_state))
      return { ok: false, error: 'Invalid backup: cloud.ui_state must be an object or null' };
  }
  if (cloud.feature_toggles != null) {
    const t = cloud.feature_toggles;
    if (typeof t !== 'object' || Array.isArray(t))
      return { ok: false, error: 'Invalid backup: cloud.feature_toggles must be an object or null' };
    for (const key of CLOUD_FEATURE_TOGGLE_KEYS) {
      if (key in t && typeof t[key] !== 'boolean')
        return { ok: false, error: `Invalid backup: cloud.feature_toggles.${key} must be a boolean` };
    }
  }
  if (cloud.current_deload_note != null) {
    const n = cloud.current_deload_note;
    if (typeof n !== 'object' || Array.isArray(n))
      return { ok: false, error: 'Invalid backup: cloud.current_deload_note must be an object or null' };
    if (n.raw_text != null && typeof n.raw_text !== 'string')
      return { ok: false, error: 'Invalid backup: cloud.current_deload_note.raw_text must be a string' };
    if (typeof n.raw_text === 'string' && n.raw_text.length > MAX_IMPORT_RAW_TEXT_LENGTH)
      return { ok: false, error: `Invalid backup: cloud.current_deload_note.raw_text too large (${n.raw_text.length}; limit ${MAX_IMPORT_RAW_TEXT_LENGTH})` };
  }

  return { ok: true };
}

// Restores the account/profile state that lives only in the cloud block.
//
// buildCloudExport is the only export shape carrying user_profile (which holds
// the device-local date_of_birth, sex, height_cm, activity_level — no cloud
// table has these), tracked_lifts, and feature_toggles. Before #488 the importer
// dropped all of it on the floor, so a reinstall lost them permanently.
//
// Fields are restored explicitly, never by wildcard copy (#471/#475).
async function restoreCloudBlock(cloud) {
  if (cloud.user_profile != null) await saveUserProfile(cloud.user_profile);
  if (cloud.tracked_lifts != null) await saveTrackedLifts(cloud.tracked_lifts);

  if (cloud.ui_state != null && typeof cloud.ui_state.log_current_collapsed === 'boolean') {
    await saveWorkoutCollapsed(cloud.ui_state.log_current_collapsed);
  }

  const toggles = cloud.feature_toggles;
  if (toggles != null) {
    if (typeof toggles.weight_date_edit_enabled === 'boolean')
      await saveWeightDateEditEnabled(toggles.weight_date_edit_enabled);
    if (typeof toggles.deload_date_edit_enabled === 'boolean')
      await saveDeloadDateEditEnabled(toggles.deload_date_edit_enabled);
    if (typeof toggles.fatigue_tracking_enabled === 'boolean')
      await saveFatigueTrackingEnabled(toggles.fatigue_tracking_enabled);
    if (typeof toggles.deload_mode_enabled === 'boolean')
      await saveDeloadModeEnabled(toggles.deload_mode_enabled);
  }

  if (cloud.current_deload_note != null && typeof cloud.current_deload_note.raw_text === 'string') {
    await saveDeloadNote(cloud.current_deload_note.raw_text);
  }
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

    if ('cloud' in payload && payload.cloud != null) {
      await restoreCloudBlock(payload.cloud);
    }
  }

  return { ok: true };
}
