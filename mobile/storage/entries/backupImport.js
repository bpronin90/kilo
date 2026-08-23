import { secureStorage as AsyncStorage } from '../secureStorage';
import {
  WEIGHT_KEY,
  WEIGHT_GOAL_KEY,
  WORKOUT_NOTES_KEY,
  WORKOUT_DELOAD_HISTORY_KEY,
  CURRENT_WORKOUT_ID_KEY,
} from './keys';
import { readList, writeList } from './jsonStorage';
import { stripDerivedSectionsFromList } from './derivedCache';
import {
  loadCurrentWorkoutId,
  saveCurrentWorkoutId,
  loadWorkoutNotesRaw,
  replaceWorkoutNotesRaw,
} from './workoutNotes';
import { loadWeightEntriesRaw, replaceWeightEntriesRaw } from './weightEntries';
import {
  SYNC_TABLES,
  getClientId,
  stampWrite,
  stampTombstone,
  isTombstone,
  enqueueDirty,
} from '../syncQueue';
import { loadWeightGoal } from './weightGoal';
import { loadUserProfile, saveUserProfile } from './profileStorage';
import {
  loadFatigueMultiplier,
  saveFatigueMultiplier,
  loadWeightDateEditEnabled,
  saveWeightDateEditEnabled,
  loadDeloadDateEditEnabled,
  saveDeloadDateEditEnabled,
  loadFatigueTrackingEnabled,
  saveFatigueTrackingEnabled,
  loadDeloadModeEnabled,
  saveDeloadModeEnabled,
  loadTrackedLifts,
  saveTrackedLifts,
  loadWorkoutCollapsed,
  saveWorkoutCollapsed,
} from './settings';
import { loadDeloadNote, saveDeloadNote } from './deloadStorage';
import {
  loadRecoveryBlocksRaw,
  replaceRecoveryBlocksRaw,
  loadRecoveryBlockWeeksRaw,
  replaceRecoveryBlockWeeksRaw,
} from './recoveryStorage';
import {
  MAX_RECOVERY_REASON_LENGTH,
  RECOVERY_BASELINE_VERSION,
  normalizeRecoveryReason,
} from '../../lib/data/recoveryBlocks';

// v4 adds the two recovery collections (#694). Everything a v3 file carries is
// unchanged, so a v4 file is a strict superset and a v3 importer would simply
// ignore the two new keys.
const BACKUP_VERSION = '4';
const CLOUD_EXPORT_FORMAT = 'cloud-1';
const CLOUD_FEATURE_TOGGLE_KEYS = [
  'weight_date_edit_enabled',
  'deload_date_edit_enabled',
  'fatigue_tracking_enabled',
  'deload_mode_enabled',
];
// The complete set of user_profile fields the app reads or writes. An imported
// profile is rebuilt from this list, so an unknown key in a backup file cannot
// reach local storage.
const PROFILE_STRING_FIELDS = ['date_of_birth', 'sex', 'activity_level', 'display_name', 'unit_system'];
const PROFILE_ALLOWLIST = [...PROFILE_STRING_FIELDS, 'height_cm'];
// Sanity bound for an imported height. Anything outside it is malformed input,
// not a real person, and would poison the BMR/TDEE calculation.
const MAX_IMPORT_HEIGHT_CM = 300;
const SUPPORTED_VERSIONS = new Set(['1', '2', '3', BACKUP_VERSION]);

// Which versions carry which collections. Stated as sets rather than as
// `version === BACKUP_VERSION` comparisons because every one of those
// comparisons silently changes meaning the moment the format is bumped: before
// #694 the deload-history restore was written as `version === BACKUP_VERSION`,
// so bumping to '4' would have stopped restoring deload history from a v3 file
// without a single test failing.
//
// The rule these encode: a backup that PREDATES a collection says nothing about
// it, and silence is never an instruction to delete.
const NOTEBOOK_VERSIONS = new Set(['2', '3', '4']);
const DELOAD_HISTORY_VERSIONS = new Set(['3', '4']);
const RECOVERY_VERSIONS = new Set(['4']);

// Explicit field allowlists for the two recovery collections, in both
// directions. Export projects each record through them so a stray local field
// can never leak into a shareable artifact, and import rebuilds each record from
// them so a hand-edited file cannot write an unknown key into local storage —
// the same discipline #471/#475/#488 applied to the profile block.
//
// These are the exact columns kilo.recovery_blocks / kilo.recovery_block_weeks
// hold, minus the server-owned `sync_xid` and the device-owned `client_id`.
const RECOVERY_BLOCK_FIELDS = [
  'id',
  'baseline_note_id',
  'baseline_note_title',
  'baseline',
  'include_in_normal_analytics',
  // #872. Absent on every block written before that issue, and `projectFields`
  // keeps an absent field absent, so a backup taken from legacy records carries
  // no `reason` key at all rather than a fabricated null.
  'reason',
  'started_at',
  'completed_at',
  'saved_at',
  'updated_at',
  'deleted_at',
];
const RECOVERY_WEEK_FIELDS = [
  'id',
  'block_id',
  'note_id',
  'week_number',
  'completed_at',
  'saved_at',
  'updated_at',
  'deleted_at',
];
const RECOVERY_BLOCK_TIMESTAMP_FIELDS = [
  'started_at', 'completed_at', 'saved_at', 'updated_at', 'deleted_at',
];
const RECOVERY_WEEK_TIMESTAMP_FIELDS = [
  'completed_at', 'saved_at', 'updated_at', 'deleted_at',
];
// A baseline snapshot holds one row per distinct exercise in one routine. A
// realistic routine has tens; this cap rejects a payload built to make the
// per-row validation loop below expensive.
const MAX_IMPORT_BASELINE_EXERCISES = 1000;
// Everything a baseline exercise row carries beyond these three is a numeric
// metric (top_weight, volume, sets_completed, best_set_reps, total_reps,
// best_hold_seconds, total_seconds — see lib/data/recoveryBlocks).
const BASELINE_EXERCISE_STRING_FIELDS = ['key', 'name', 'exercise_class'];

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

// #872. A backup file is NOT a trusted producer of canonical text. It can be
// hand-edited, and a value like "knee\n  surgery" clears validation — it is a
// non-blank string inside the length bound — while still violating the one-line
// form every in-app write path produces. Normalizing on the way in makes import
// a peer of creation, editing, and cross-device merge rather than the single
// door that admits a shape the domain never stores.
//
// Normalizing rather than rejecting is deliberate: a slightly-off reason in an
// otherwise valid file is a formatting difference, and failing a whole restore
// over one stray newline would cost the user their data to make a point about
// whitespace. That extends to a blank — an empty or whitespace-only value is
// "no reason", so it canonicalizes to `null` here rather than failing the
// import. Only what normalization CANNOT fix is rejected by
// `validateRecoveryBlocks`: a non-string, and a value past the domain cap.
//
// An absent `reason` stays absent: silence in a legacy file is not an
// instruction to write a null.
function normalizeImportedRecoveryBlock(block) {
  if (!Object.prototype.hasOwnProperty.call(block, 'reason')) return block;
  return { ...block, reason: normalizeRecoveryReason(block.reason) };
}

// Project one record through an explicit field allowlist. An absent field stays
// absent rather than becoming `undefined`, so the emitted JSON matches the
// stored record instead of gaining null-ish keys the source never had.
function projectFields(record, fields) {
  const out = {};
  for (const field of fields) {
    if (record && Object.prototype.hasOwnProperty.call(record, field)) {
      out[field] = record[field];
    }
  }
  return out;
}

export async function exportBackup() {
  const weight_entries = await readList(WEIGHT_KEY);
  // The RAW notebook (tombstones included), minus the device-local parser cache
  // an older build may still be carrying (issue #813): it is recomputable from
  // raw_text, never part of the backup contract, and ~100x the note text.
  const workout_notes = stripDerivedSectionsFromList(await readList(WORKOUT_NOTES_KEY));
  const current_workout_id = await loadCurrentWorkoutId();
  const weight_goal = await loadWeightGoal();
  const fatigue_multiplier = await loadFatigueMultiplier();
  const deload_history = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  // The RAW lists, tombstones included. A tombstone is the only record that a
  // block or membership was removed, so dropping them here would make a restore
  // resurrect every deleted recovery record — and in cloud mode would re-upload
  // them under a `deleted_at` the account has already accepted.
  const recovery_blocks = (await loadRecoveryBlocksRaw())
    .map((b) => projectFields(b, RECOVERY_BLOCK_FIELDS));
  const recovery_block_weeks = (await loadRecoveryBlockWeeksRaw())
    .map((w) => projectFields(w, RECOVERY_WEEK_FIELDS));
  return {
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    weight_entries,
    workout_notes,
    current_workout_id,
    weight_goal,
    fatigue_multiplier,
    deload_history,
    recovery_blocks,
    recovery_block_weeks,
  };
}

// Cloud export parity (Phase 4 / Task 12).
//
// Cloud users need an export that is a strict superset of the plain backup shape
// so it stays importable via importBackup(), but also carries the account-scoped
// data the roadmap calls out for self-serve cloud users: profile, feature
// toggles, and the preferences/pointers that live on user_profile in the cloud
// model (roadmap "Self-Serve Product Obligations": "v3 backup shape plus
// account/profile/toggle additions needed for cloud users").
//
// The base payload is exactly exportBackup() (currently version "4", which adds
// the two recovery collections to the v3 shape), so any importer of that version
// ignores the extra `cloud` block. The cloud-only additions are namespaced under
// `cloud` to keep the top-level contract untouched.
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

// ── clean-bootstrap cloud restore (issues #481/#482/#483) ──────────────────
//
// The cloud `user_profile` and `feature_toggles` rows are singletons that only
// ever got pushed via bootstrapFromLocal (see mobile/storage/cloud/bootstrap.js);
// nothing ever read them back. This is the write side of that missing
// direction: given the two rows downloaded from Supabase for the signed-in
// account, write each known field into the same local storage keys that
// buildBootstrapPlan's buildUserProfileRow/buildFeatureTogglesRow originally
// read from. Deliberately not a wildcard copy: only the named fields below
// cross the boundary, mirroring the #471/#475 allowlist discipline already
// applied to the upload/export direction. The fatigue-multiplier sanity check
// reuses validateFatigueMultiplier so a corrupted or tampered cloud row can't
// push a NaN/absurd value into local fatigue calculations.
//
// Caller contract: mobile/storage/cloud/bootstrap.js only invokes this when
// the local device's snapshot is already clean/empty (a fresh install or a
// device that has never held any profile/routine/tracked-lift state), so this
// function's writes can never clobber a device's real existing local data.
export async function hydrateProfileFromCloud(profileRow, featureTogglesRow) {
  if (profileRow && typeof profileRow === 'object') {
    if (profileRow.current_workout_note_id != null) {
      await saveCurrentWorkoutId(profileRow.current_workout_note_id);
    }
    if (profileRow.fatigue_multiplier != null) {
      const check = validateFatigueMultiplier(profileRow.fatigue_multiplier);
      if (check.ok) {
        await saveFatigueMultiplier(profileRow.fatigue_multiplier);
      }
    }
    if (
      profileRow.tracked_lifts &&
      typeof profileRow.tracked_lifts === 'object' &&
      !Array.isArray(profileRow.tracked_lifts)
    ) {
      await saveTrackedLifts(profileRow.tracked_lifts);
    }
    if (profileRow.ui_state && typeof profileRow.ui_state === 'object') {
      await saveWorkoutCollapsed(!!profileRow.ui_state.log_current_collapsed);
    }
    if (profileRow.display_name != null || profileRow.unit_system != null) {
      await saveUserProfile({
        display_name: profileRow.display_name ?? null,
        unit_system: profileRow.unit_system ?? null,
      });
    }
  }

  if (featureTogglesRow && typeof featureTogglesRow === 'object') {
    if (typeof featureTogglesRow.weight_date_edit_enabled === 'boolean') {
      await saveWeightDateEditEnabled(featureTogglesRow.weight_date_edit_enabled);
    }
    if (typeof featureTogglesRow.deload_date_edit_enabled === 'boolean') {
      await saveDeloadDateEditEnabled(featureTogglesRow.deload_date_edit_enabled);
    }
    if (typeof featureTogglesRow.fatigue_tracking_enabled === 'boolean') {
      await saveFatigueTrackingEnabled(featureTogglesRow.fatigue_tracking_enabled);
    }
    if (typeof featureTogglesRow.deload_mode_enabled === 'boolean') {
      await saveDeloadModeEnabled(featureTogglesRow.deload_mode_enabled);
    }
  }

  return { ok: true };
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

// ── recovery collections (issue #694) ────────────────────────────────────────
//
// Recovery records are health data (see the RLS note in migration
// 20260728215114), and a restore writes them to local storage and, in cloud
// mode, straight back to the account. So they get the same treatment as every
// other imported collection: bounded size, per-record shape checks, and NOTHING
// written until the whole payload has passed.

// Strict ISO 8601 instant. Deliberately NOT `Date.parse` alone.
//
// `Date.parse` is permissive by specification and by browser convention: it
// accepts `"1"`, `"2026"`, `"01/02/03"`, and `"March 5, 2026"`, and — worse — it
// NORMALIZES an impossible calendar date rather than rejecting it, so
// `"2026-02-30T00:00:00Z"` returns a finite value pointing at March 2. The
// importer persists the ORIGINAL string, so a permissive check leaves local
// storage holding a timestamp that is not the instant it appears to be. Two
// concrete consequences: local ordering compares these fields lexicographically,
// which only works while every value is the same canonical shape; and a cloud
// push of an impossible calendar date is rejected outright by PostgreSQL, which
// wedges the restore after it has already written.
//
// The accepted shape is exactly what the two producers of these values emit:
// `new Date().toISOString()` on the device (always `Z`, always milliseconds),
// and PostgREST for a server-stamped `updated_at` (a `+00:00` offset, up to
// microsecond precision). Both always carry an explicit offset, so one is
// required — a local-time string names no instant at all and cannot be ordered
// against the others.
const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Computed from the Gregorian rule rather than via `Date`, whose two-digit-year
// remapping (`Date.UTC(50, ...)` is 1950) would give the wrong leap-year answer
// for a four-digit year below 100.
function daysInMonth(year, month) {
  if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

function isIsoInstant(value) {
  if (typeof value !== 'string') return false;
  const match = ISO_INSTANT_RE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return false;
  // Calendar-aware, so February 30 and a non-leap February 29 are rejected
  // instead of rolling silently into the following month.
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
  // Offset components, absent for a `Z` value.
  if (match[7] !== undefined && (Number(match[7]) > 23 || Number(match[8]) > 59)) return false;

  // Final gate, so nothing that satisfies the shape checks can still reach
  // storage as a value the engine reads as NaN.
  return Number.isFinite(Date.parse(value));
}

function validateTimestamps(record, fields, label) {
  for (const field of fields) {
    const value = record[field];
    if (value == null) continue;
    if (!isIsoInstant(value)) {
      return {
        ok: false,
        error: `Invalid backup: ${label} ${field} must be an ISO instant with an explicit offset (got ${JSON.stringify(value)})`,
      };
    }
  }
  return { ok: true };
}

// The frozen pre-recovery snapshot. Its whole contract is that it is captured
// once and never recomputed, so the importer cannot repair a malformed one by
// re-deriving it — an unreadable snapshot can only be rejected.
function validateRecoveryBaseline(baseline) {
  if (baseline == null) return { ok: true };
  if (typeof baseline !== 'object' || Array.isArray(baseline))
    return { ok: false, error: 'Invalid backup: recovery block baseline must be an object' };
  if (!Number.isInteger(baseline.version) || baseline.version < 1)
    return { ok: false, error: 'Invalid backup: recovery block baseline version must be a positive integer' };
  // A snapshot from a FUTURE capture format is not readable by this app's
  // comparison code, and storing it would hand later analytics a shape they
  // would have to guess at. Rejecting is the honest outcome.
  if (baseline.version > RECOVERY_BASELINE_VERSION)
    return {
      ok: false,
      error: `Invalid backup: recovery block baseline version ${baseline.version} is newer than this app supports (${RECOVERY_BASELINE_VERSION})`,
    };
  if (!Array.isArray(baseline.exercises))
    return { ok: false, error: 'Invalid backup: recovery block baseline exercises must be an array' };
  if (baseline.exercises.length > MAX_IMPORT_BASELINE_EXERCISES)
    return {
      ok: false,
      error: `Invalid backup: recovery block baseline too large (${baseline.exercises.length}; limit ${MAX_IMPORT_BASELINE_EXERCISES})`,
    };
  for (const exercise of baseline.exercises) {
    if (!exercise || typeof exercise !== 'object' || Array.isArray(exercise))
      return { ok: false, error: 'Invalid backup: recovery baseline exercise is not an object' };
    for (const field of BASELINE_EXERCISE_STRING_FIELDS) {
      if (typeof exercise[field] !== 'string')
        return { ok: false, error: `Invalid backup: recovery baseline exercise missing ${field}` };
    }
    for (const [field, value] of Object.entries(exercise)) {
      if (BASELINE_EXERCISE_STRING_FIELDS.includes(field)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value))
        return { ok: false, error: `Invalid backup: recovery baseline metric ${field} must be a finite number` };
    }
  }
  return { ok: true };
}

// Returns the validated block ids so the membership pass can check its
// references against them without a second scan.
function validateRecoveryBlocks(blocks) {
  if (!Array.isArray(blocks))
    return { ok: false, error: 'Invalid backup: recovery_blocks must be an array' };
  if (blocks.length > MAX_IMPORT_ARRAY_LENGTH)
    return { ok: false, error: `Invalid backup: recovery_blocks too large (${blocks.length}; limit ${MAX_IMPORT_ARRAY_LENGTH})` };

  const ids = new Set();
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block))
      return { ok: false, error: 'Invalid backup: recovery block is not an object' };
    if (typeof block.id !== 'string' || block.id.length === 0)
      return { ok: false, error: 'Invalid backup: recovery block missing id' };
    // Duplicate ids would collapse to one record on write while the payload
    // claims two, so the restore would silently lose a block.
    if (ids.has(block.id))
      return { ok: false, error: `Invalid backup: duplicate recovery block id ${block.id}` };
    ids.add(block.id);
    if (typeof block.baseline_note_id !== 'string' || block.baseline_note_id.length === 0)
      return { ok: false, error: `Invalid backup: recovery block ${block.id} missing baseline_note_id` };
    if (block.baseline_note_title != null && typeof block.baseline_note_title !== 'string')
      return { ok: false, error: `Invalid backup: recovery block ${block.id} baseline_note_title must be a string` };
    if (block.include_in_normal_analytics != null && typeof block.include_in_normal_analytics !== 'boolean')
      return { ok: false, error: `Invalid backup: recovery block ${block.id} include_in_normal_analytics must be a boolean` };
    // The optional reason (#872). Absent, null, empty, and whitespace-only are
    // ALL "no reason" — a backup written before the field existed says nothing
    // about it, and silence is never an instruction.
    //
    // An empty or whitespace-only value is ACCEPTED, not rejected: #872 requires
    // an empty reason to be accepted and normalized consistently, and
    // `normalizeImportedRecoveryBlock` canonicalizes it to `null` on the way in
    // — the same value clearing the field in the app produces. Rejecting it here
    // would have made import the one path that treats "no reason" as an error,
    // and would have run before normalization could fix it (review of 33fe98b).
    //
    // Validation therefore bounds only what normalization CANNOT fix: a value
    // that is not a string at all, and one past the domain cap.
    if (block.reason != null) {
      if (typeof block.reason !== 'string')
        return { ok: false, error: `Invalid backup: recovery block ${block.id} reason must be a string` };
      if (block.reason.length > MAX_RECOVERY_REASON_LENGTH)
        return {
          ok: false,
          error: `Invalid backup: recovery block ${block.id} reason too long (${block.reason.length}; limit ${MAX_RECOVERY_REASON_LENGTH})`,
        };
    }

    const baselineCheck = validateRecoveryBaseline(block.baseline);
    if (!baselineCheck.ok) return baselineCheck;

    const timeCheck = validateTimestamps(block, RECOVERY_BLOCK_TIMESTAMP_FIELDS, `recovery block ${block.id}`);
    if (!timeCheck.ok) return timeCheck;
  }
  return { ok: true, blockIds: ids };
}

// `liveNoteIds` is the set of workout-note ids the SAME payload carries as live
// (non-tombstoned) notes — see the note-reference check below.
function validateRecoveryWeeks(weeks, blockIds, liveNoteIds) {
  if (!Array.isArray(weeks))
    return { ok: false, error: 'Invalid backup: recovery_block_weeks must be an array' };
  if (weeks.length > MAX_IMPORT_ARRAY_LENGTH)
    return { ok: false, error: `Invalid backup: recovery_block_weeks too large (${weeks.length}; limit ${MAX_IMPORT_ARRAY_LENGTH})` };

  const ids = new Set();
  for (const week of weeks) {
    if (!week || typeof week !== 'object' || Array.isArray(week))
      return { ok: false, error: 'Invalid backup: recovery week is not an object' };
    if (typeof week.id !== 'string' || week.id.length === 0)
      return { ok: false, error: 'Invalid backup: recovery week missing id' };
    if (ids.has(week.id))
      return { ok: false, error: `Invalid backup: duplicate recovery week id ${week.id}` };
    ids.add(week.id);
    if (typeof week.block_id !== 'string' || week.block_id.length === 0)
      return { ok: false, error: `Invalid backup: recovery week ${week.id} missing block_id` };
    // Referential integrity, checked against the payload rather than against
    // local state. kilo.recovery_block_weeks has a real FK to the block, so an
    // orphaned membership is not merely untidy — in cloud mode its upload is
    // rejected by the database and the restore wedges.
    if (!blockIds.has(week.block_id))
      return { ok: false, error: `Invalid backup: recovery week ${week.id} references unknown recovery block ${week.block_id}` };
    // The note reference, checked against the payload for the same reason
    // `block_id` is (issue #776). A live membership IS the link between a
    // recovery block and a workout note: `loadRecoveryBlockWeeks` joins on
    // `note_id`, the Recovery read and the return-to-baseline comparison have
    // nothing to show without the note, and kilo.recovery_block_weeks holds a
    // real FK to kilo.workout_notes — so in cloud mode a dangling reference is
    // rejected by the database and wedges the restore after it has written.
    //
    // A TOMBSTONED membership keeps the older, looser shape. Its note reference
    // is history, not a link: readers filter it out before ever resolving
    // `note_id`, replace-by-omission mints tombstones from prior local rows that
    // may name notes this backup no longer carries, and demanding a live target
    // for a deleted membership would reject the honest backup of anyone who has
    // ever removed a week and then deleted its note.
    if (week.deleted_at == null) {
      if (typeof week.note_id !== 'string' || week.note_id.length === 0)
        return { ok: false, error: `Invalid backup: recovery week ${week.id} missing note_id` };
      if (!liveNoteIds.has(week.note_id))
        return {
          ok: false,
          error: `Invalid backup: recovery week ${week.id} references workout note ${week.note_id}, which this backup does not carry as a live note`,
        };
    } else if (week.note_id != null && typeof week.note_id !== 'string') {
      return { ok: false, error: `Invalid backup: recovery week ${week.id} note_id must be a string` };
    }
    // Every membership must HAVE an ordinal, not merely have a valid one if it
    // happens to carry it. The cloud column is nullable and its check constraint
    // is written `week_number is null or week_number > 0`, but the local domain
    // has no such tolerance: `buildRecoveryWeek` always assigns an ordinal,
    // `orderedLiveWeeks` subtracts them numerically (a null yields NaN, so the
    // comparator stops being a total order), and `nextWeekNumber` derives the
    // next ordinal from the highest existing one. A null therefore does not
    // survive as a harmless gap — it corrupts week ordering for every later
    // comparison, and in local mode it stays that way permanently.
    if (!Number.isInteger(week.week_number) || week.week_number < 1)
      return { ok: false, error: `Invalid backup: recovery week ${week.id} week_number must be a positive integer` };

    const timeCheck = validateTimestamps(week, RECOVERY_WEEK_TIMESTAMP_FIELDS, `recovery week ${week.id}`);
    if (!timeCheck.ok) return timeCheck;
  }
  return { ok: true };
}

// The three CROSS-RECORD invariants, which no per-row check can see.
//
// These are not stylistic: kilo.recovery_blocks and kilo.recovery_block_weeks
// enforce all three as partial unique indexes over live rows
// (recovery_blocks_one_active_idx, recovery_block_weeks_one_live_note_idx,
// recovery_block_weeks_live_ordinal_idx), and recoveryStorage.js enforces the
// same three on every ordinary in-app write. A payload that breaks one is
// therefore rejected by the database on push — but only AFTER a replace has
// already overwritten local recovery storage and enqueued the dirty rows, which
// is exactly the "no writes before validation" contract this importer exists to
// keep. In local mode nothing pushes at all, so the invalid domain state simply
// persists: two blocks both reporting as active, or a workout note bound to two
// recovery blocks at once.
//
// Replace semantics are what make checking the PAYLOAD sufficient. Every live
// record the backup omits becomes a tombstone, so the live set after the restore
// is exactly the live set in the payload — there is no surviving local live row
// for an imported one to collide with.
//
// Each predicate mirrors its index, minus the null handling those indexes allow
// for: a unique index treats NULLs as distinct, but validateRecoveryWeeks has
// already rejected a LIVE membership missing either its note reference or its
// ordinal — stricter than the nullable cloud columns, because neither the
// Recovery read nor the local ordering logic can tolerate a null.
//
// O(blocks + weeks) via two keyed indexes; no nested scan.
function validateRecoveryInvariants(blocks, weeks) {
  const isLive = (record) => record.deleted_at == null;

  // recovery_blocks_one_active_idx: at most one live, not-yet-completed block.
  // Without this "the active block" is ambiguous on every device at once.
  const active = blocks.filter((b) => isLive(b) && b.completed_at == null);
  if (active.length > 1) {
    return {
      ok: false,
      error: `Invalid backup: ${active.length} active recovery blocks (${active.map((b) => b.id).join(', ')}); at most one may be active`,
    };
  }

  const noteOwner = new Map();
  const claimedOrdinals = new Map();

  for (const week of weeks) {
    if (!isLive(week)) continue;

    // recovery_block_weeks_one_live_note_idx: one live membership per workout
    // note, across ALL blocks. A note in two blocks makes every later
    // return-to-baseline comparison ambiguous about which recovery it belongs to.
    const prior = noteOwner.get(week.note_id);
    if (prior !== undefined) {
      return {
        ok: false,
        error: `Invalid backup: workout note ${week.note_id} has two live recovery memberships (${prior}, ${week.id})`,
      };
    }
    noteOwner.set(week.note_id, week.id);

    // recovery_block_weeks_live_ordinal_idx: week ordinals are unique within a
    // block among live memberships, which is what makes week order total.
    // The separator is an escaped NUL, which no record id can contain, so two
    // different (block, ordinal) pairs cannot collide into one key.
    const ordinalKey = `${week.block_id}\u0000${week.week_number}`;
    const priorAtOrdinal = claimedOrdinals.get(ordinalKey);
    if (priorAtOrdinal !== undefined) {
      return {
        ok: false,
        error: `Invalid backup: recovery block ${week.block_id} has two live memberships for week ${week.week_number} (${priorAtOrdinal}, ${week.id})`,
      };
    }
    claimedOrdinals.set(ordinalKey, week.id);
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

  // Collected while the notes are validated, so the recovery pass below can
  // resolve every live membership's `note_id` without a second scan. Stays empty
  // for a version that carries no notes — which is also a version that carries
  // no recovery data, so nothing ever resolves against an empty set.
  const liveWorkoutNoteIds = new Set();

  if (NOTEBOOK_VERSIONS.has(payload.version)) {
    if (!Array.isArray(payload.workout_notes))
      return { ok: false, error: 'Invalid backup: workout_notes must be an array' };
    if (payload.workout_notes.length > MAX_IMPORT_ARRAY_LENGTH)
      return { ok: false, error: `Invalid backup: workout_notes too large (${payload.workout_notes.length}; limit ${MAX_IMPORT_ARRAY_LENGTH})` };
    const workoutNoteIds = new Set();
    for (const n of payload.workout_notes) {
      if (!n || typeof n !== 'object' || Array.isArray(n))
        return { ok: false, error: 'Invalid backup: workout note is not an object' };
      if (typeof n.id !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing id' };
      // Same rule the two recovery collections already enforce, and needed here
      // for the same reason plus one more. Two rows claiming one id collapse to
      // a single record on write while the payload claims two, so the restore
      // silently loses one — and WHICH one it loses differs by mode: the local
      // path writes the array verbatim and readers keep the live row, while the
      // cloud path's dirty queue is keyed by id and keeps the LAST row. A live
      // note followed by a tombstone therefore resolves both ways at once, which
      // would let a membership pass the live-note check below and still reach an
      // account whose note is deleted — the dangling link this validation exists
      // to prevent, reintroduced through the back door.
      if (workoutNoteIds.has(n.id))
        return { ok: false, error: `Invalid backup: duplicate workout note id ${n.id}` };
      workoutNoteIds.add(n.id);
      if (typeof n.title !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing title' };
      if (typeof n.raw_text !== 'string')
        return { ok: false, error: 'Invalid backup: workout note missing raw_text' };
      if (n.raw_text.length > MAX_IMPORT_RAW_TEXT_LENGTH)
        return { ok: false, error: `Invalid backup: workout note raw_text too large (${n.raw_text.length}; limit ${MAX_IMPORT_RAW_TEXT_LENGTH})` };
      // A tombstoned note is not a link target: readers filter it out, so a
      // membership pointing at one is dangling the moment it is restored.
      if (n.deleted_at == null && n.id.length > 0) liveWorkoutNoteIds.add(n.id);
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
    if (DELOAD_HISTORY_VERSIONS.has(payload.version) && 'deload_history' in payload) {
      const deloadCheck = validateDeloadHistory(payload.deload_history);
      if (!deloadCheck.ok) return deloadCheck;
    }
    if ('fatigue_multiplier' in payload && payload.fatigue_multiplier != null) {
      const fatigueCheck = validateFatigueMultiplier(payload.fatigue_multiplier);
      if (!fatigueCheck.ok) return fatigueCheck;
    }
  }

  // Blocks are validated first so the membership pass can resolve every
  // `block_id` against them — the same dependency order the restore itself uses.
  // The notes were validated further up for the same reason, which is why a
  // membership's `note_id` can be resolved here too.
  //
  // The two keys stand or fall TOGETHER. Either the payload carries both — an
  // exporting device always emits both, as empty lists when the feature was
  // never used — or it carries neither and says nothing about recovery data at
  // all, which a legacy backup does and which never deletes anything.
  //
  // Half a payload is rejected because either half alone is unrestorable.
  // Memberships without blocks have `block_id` references that cannot be checked
  // against a collection the payload never supplied. Blocks without memberships
  // is the subtler one: replace would tombstone a block by omission while the
  // device's live memberships still point at it, leaving each of their workout
  // notes bound to a block that no longer exists and unable to join another. The
  // client's cascade covers a local delete and a PULLED tombstone, not a
  // tombstone a half-payload restore minted locally.
  if (RECOVERY_VERSIONS.has(payload.version)) {
    const hasBlocks = 'recovery_blocks' in payload;
    const hasWeeks = 'recovery_block_weeks' in payload;

    if (hasBlocks !== hasWeeks) {
      return {
        ok: false,
        error: `Invalid backup: ${hasBlocks ? 'recovery_blocks' : 'recovery_block_weeks'} present without ${hasBlocks ? 'recovery_block_weeks' : 'recovery_blocks'}; a recovery backup carries both collections or neither`,
      };
    }

    if (hasBlocks) {
      const blockCheck = validateRecoveryBlocks(payload.recovery_blocks);
      if (!blockCheck.ok) return blockCheck;
      const weekCheck = validateRecoveryWeeks(
        payload.recovery_block_weeks,
        blockCheck.blockIds,
        liveWorkoutNoteIds,
      );
      if (!weekCheck.ok) return weekCheck;
      // Last, because it is the only check that needs both collections whole.
      const invariantCheck = validateRecoveryInvariants(
        payload.recovery_blocks,
        payload.recovery_block_weeks,
      );
      if (!invariantCheck.ok) return invariantCheck;
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
    const p = cloud.user_profile;
    if (typeof p !== 'object' || Array.isArray(p))
      return { ok: false, error: 'Invalid backup: cloud.user_profile must be an object or null' };
    // Field-level validation, not just "is an object". saveUserProfile persists
    // whatever object it is handed, so an unvalidated profile writes arbitrary
    // keys and types straight into local storage.
    for (const key of PROFILE_STRING_FIELDS) {
      if (p[key] != null && typeof p[key] !== 'string')
        return { ok: false, error: `Invalid backup: cloud.user_profile.${key} must be a string` };
    }
    if (p.height_cm != null) {
      if (typeof p.height_cm !== 'number' || !Number.isFinite(p.height_cm))
        return { ok: false, error: 'Invalid backup: cloud.user_profile.height_cm must be a finite number' };
      if (p.height_cm <= 0 || p.height_cm > MAX_IMPORT_HEIGHT_CM)
        return { ok: false, error: `Invalid backup: cloud.user_profile.height_cm out of range (limit ${MAX_IMPORT_HEIGHT_CM})` };
    }
  }
  if (cloud.tracked_lifts != null) {
    const t = cloud.tracked_lifts;
    if (typeof t !== 'object' || Array.isArray(t))
      return { ok: false, error: 'Invalid backup: cloud.tracked_lifts must be an object or null' };
    for (const [lift, value] of Object.entries(t)) {
      if (typeof value !== 'boolean')
        return { ok: false, error: `Invalid backup: cloud.tracked_lifts.${lift} must be a boolean` };
    }
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
  if (cloud.user_profile != null) {
    // Build the row explicitly rather than forwarding the imported object.
    // saveUserProfile spreads what it is given, so passing the payload through
    // would persist any key an attacker put in the file — the same wildcard
    // failure that put date_of_birth and sex into profile_json (#471/#474/#475),
    // inverted: uncontrolled ingress instead of uncontrolled egress.
    const p = cloud.user_profile;
    const profile = {};
    for (const key of PROFILE_ALLOWLIST) {
      if (p[key] != null) profile[key] = p[key];
    }
    if (Object.keys(profile).length > 0) await saveUserProfile(profile);
  }

  if (cloud.tracked_lifts != null) {
    const tracked = {};
    for (const [lift, value] of Object.entries(cloud.tracked_lifts)) {
      if (typeof value === 'boolean') tracked[lift] = value;
    }
    await saveTrackedLifts(tracked);
  }

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

// ── import modes (issue #526) ────────────────────────────────────────────────
//
// Import has TWO contracts, and the caller states which one it wants. Before
// #526 there was only the local one, and it ran in cloud mode too: the importer
// wrote domain keys straight into AsyncStorage, queued nothing, tombstoned
// nothing, and returned `{ ok: true }`. A cloud user's "replace" therefore left
// the device holding the imported data while the account still held the old
// data, with the UI reporting a successful restore (confirmed as #522 claim 5).
//
//   LOCAL — the device is the only copy. Replace overwrites the domain keys and
//     that is the whole story. Byte-for-byte the pre-#526 behavior.
//
//   CLOUD — the account is the shared copy and the device is one replica. A
//     replace is a batch of ordinary cloud writes: every imported row is stamped
//     and enqueued, and every collection row the backup OMITS becomes a
//     tombstone, because "replace" means those records are gone and a plain
//     local deletion would simply be re-pulled from the server.
//
// The values are deliberately the STORAGE_MODES values, so the app seam can pass
// `getStorageMode()` straight through instead of restating the mapping.
export const IMPORT_MODES = Object.freeze({ LOCAL: 'local', CLOUD: 'cloud' });

// Replace one dirty-queue-tracked collection table under the CLOUD contract.
//
// Deliberately mirrors cloudDomainMethods' write/delete pair rather than
// inventing a second mechanism: the same stamping primitives, the same
// retained-tombstone convention (readers filter `deleted_at`, so the row stays
// in the list until a synced cleanup removes it), and the same dirty queue. By
// the time sync() sees these rows they are indistinguishable from rows written
// by ordinary in-app edits and deletes, so last-write-wins, tombstone ordering,
// and cursor advancement stay on one code path.
//
// Ordering is durability-critical: local storage is written BEFORE the queue.
// A crash in between leaves the imported state on disk with no queue entries,
// which is exactly the shape #525's reconcileLocalWrites recovers — it diffs
// local state against the last-synced baseline on the next pass and re-derives
// both the writes and the omission tombstones. The reverse order would leave the
// queue promising rows the device does not have.
//
// Incoming `updated_at`/`client_id` are dropped rather than trusted: they
// describe the EXPORTING device's history (possibly another device, another
// account, or a hand-edited file) and would otherwise compete in LWW as if this
// device had made the write then. `deleted_at` is not dropped — a backup taken
// from raw storage legitimately carries tombstones, and resurrecting deleted
// records on import would be its own data bug.
//
// O(prior + imported) via a single keyed index; no nested scan.
async function replaceCollectionForCloud({ table, readRaw, writeRaw, imported, clientId }) {
  const prior = (await readRaw()) || [];
  const priorById = new Map();
  for (const rec of prior) {
    if (rec && rec.id != null) priorById.set(rec.id, rec);
  }

  const nextList = [];
  const dirty = [];
  const importedIds = new Set();

  for (const row of imported || []) {
    if (!row || row.id == null) continue;
    importedIds.add(row.id);
    // eslint-disable-next-line no-unused-vars
    const { updated_at: _updatedAt, client_id: _clientId, ...content } = row;
    // Build the restored record from the validated backup row ALONE — no merge
    // with the prior local row. "Replace" means the backup is authoritative, so a
    // field the backup omits must be CLEARED, not carried over and re-uploaded:
    // the earlier `{ ...base, ...content }` merge let a dropped weight-entry
    // `note` or an omitted workout-note derived field survive from the device's
    // current row and get stamped into the restore (issue #526 review, P2).
    //
    // The allowlist of prior-row fields to preserve is deliberately EMPTY. It
    // could only hold a column the cloud row legitimately has AND the backup
    // format structurally never carries — and no such column exists for these two
    // tables. The backup reads WEIGHT_KEY / WORKOUT_NOTES_KEY (see exportBackup),
    // the exact raw collection storage the uploader reads from, so every cloud
    // column a row can hold is already in the payload when the exporting device
    // held it; an absent field is genuinely absent, and replace clears it. This
    // also matches the LOCAL contract, which writes `payload.weight_entries`
    // verbatim with no prior-row merge, and cannot widen `record_json`/`goal_json`
    // (#475): those columns live only on deload_history/weight_goal, and the push
    // whitelist for weight_entries/workout_notes never serializes them regardless.
    const next = { ...content };
    const stamped = isTombstone(row)
      ? stampTombstone(next, clientId)
      : stampWrite(next, clientId);
    nextList.push(stamped);
    dirty.push(stamped);
  }

  for (const [id, base] of priorById) {
    if (importedIds.has(id)) continue;
    if (isTombstone(base)) {
      // Already a tombstone. The delete has been recorded once; restating it
      // would only move `updated_at` forward for no reason.
      nextList.push(base);
      continue;
    }
    // Present locally, absent from the backup. Under replace semantics the
    // record is gone — but the account still has it, so only a tombstone can
    // express that. Dropping the row instead would let the next pull resurrect
    // it, which is the silent divergence #526 exists to fix.
    const tombstone = stampTombstone({ ...base }, clientId);
    nextList.push(tombstone);
    dirty.push(tombstone);
  }

  await writeRaw(nextList);
  for (const record of dirty) {
    // eslint-disable-next-line no-await-in-loop
    await enqueueDirty(table, record);
  }
  return dirty.length;
}

// Restores a backup. strategy 'replace' overwrites all local data atomically.
// Returns { ok: true, mode, queued } or { ok: false, error: string }.
// Validation runs before any write; storage is not mutated on failure.
// v1 backups restore weight entries only; workout notes state is left untouched.
//
// `mode` selects the contract described at IMPORT_MODES. It defaults to LOCAL,
// which is the historical behavior and the correct one for a device with no
// account; the cloud contract is opted into explicitly by the app seam, which is
// the layer that knows the active storage mode.
//
// Everything outside the two collection tables is left to the DIFF-TRACKED sync
// path and needs no import-time queueing: the weight goal, deload history,
// profile, health profile, and feature toggles all detect local change by
// diffing live local state against a persisted snapshot, and that diff does not
// care which writer produced the change. Their `allowDelete` configs already
// turn a cleared local value into a cloud tombstone. This is the "explicitly
// confirmed alternative" the contract allows, not an omission.
//
// `archived_weight_goals` is a collection table that the backup FORMAT does not
// carry at all. A replace therefore leaves it untouched: the payload contains no
// evidence that those records were dropped, and tombstoning them on that
// non-evidence would destroy data the user never asked to remove.
//
// The two recovery collections (#694) follow the same evidence rule, one version
// later: v4 carries them, so a v4 restore replaces them under the full cloud
// contract including omission tombstones — but a v1/v2/v3 file predates the
// format and says nothing about recovery data, so it leaves every block and
// membership exactly where it is.
export async function importBackup(payload, strategy = 'replace', { mode = IMPORT_MODES.LOCAL } = {}) {
  const check = validateBackup(payload);
  if (!check.ok) return check;

  const cloudMode = mode === IMPORT_MODES.CLOUD;
  const resolvedMode = cloudMode ? IMPORT_MODES.CLOUD : IMPORT_MODES.LOCAL;
  let queued = 0;

  if (strategy === 'replace') {
    const isNotebookVersion = NOTEBOOK_VERSIONS.has(payload.version);
    // Recovery data is restored only from a recovery-aware backup that carries
    // it. Validation has already rejected a payload holding one collection
    // without the other, so this single flag governs both.
    const hasRecovery = RECOVERY_VERSIONS.has(payload.version) && 'recovery_blocks' in payload;

    if (cloudMode) {
      const clientId = await getClientId();
      queued += await replaceCollectionForCloud({
        table: SYNC_TABLES.WEIGHT_ENTRIES,
        readRaw: loadWeightEntriesRaw,
        writeRaw: replaceWeightEntriesRaw,
        imported: payload.weight_entries,
        clientId,
      });
      // v1 predates the notebook model, so it says nothing about workout notes.
      // Silence is not an instruction to delete them.
      if (isNotebookVersion) {
        queued += await replaceCollectionForCloud({
          table: SYNC_TABLES.WORKOUT_NOTES,
          readRaw: loadWorkoutNotesRaw,
          writeRaw: replaceWorkoutNotesRaw,
          imported: payload.workout_notes,
          clientId,
        });
      }
      // Blocks BEFORE memberships, always. kilo.recovery_block_weeks carries a
      // real foreign key to kilo.recovery_blocks, and the push walks the dirty
      // queue in enqueue order, so a membership queued ahead of its block is
      // rejected by the database. The same order also means a crash between the
      // two leaves blocks-without-memberships (recoverable, and what #525's
      // reconcileLocalWrites re-derives) rather than memberships pointing at
      // blocks that are not there.
      if (hasRecovery) {
        queued += await replaceCollectionForCloud({
          table: SYNC_TABLES.RECOVERY_BLOCKS,
          readRaw: loadRecoveryBlocksRaw,
          writeRaw: replaceRecoveryBlocksRaw,
          imported: payload.recovery_blocks.map((b) => normalizeImportedRecoveryBlock(projectFields(b, RECOVERY_BLOCK_FIELDS))),
          clientId,
        });
      }
      if (hasRecovery) {
        queued += await replaceCollectionForCloud({
          table: SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
          readRaw: loadRecoveryBlockWeeksRaw,
          writeRaw: replaceRecoveryBlockWeeksRaw,
          imported: payload.recovery_block_weeks.map((w) => projectFields(w, RECOVERY_WEEK_FIELDS)),
          clientId,
        });
      }
    } else {
      // WORKOUT_KEY (legacy sessions) is not part of the backup scope and is not touched.
      const pairs = [[WEIGHT_KEY, JSON.stringify(payload.weight_entries)]];
      if (isNotebookVersion) {
        // A backup taken by an older build can carry the parser cache; it never
        // re-enters storage (issue #813).
        pairs.push([WORKOUT_NOTES_KEY, JSON.stringify(stripDerivedSectionsFromList(payload.workout_notes))]);
      }
      await AsyncStorage.multiSet(pairs);
      // Same dependency order on the local side, for the same reason a reader
      // would hit: a membership is only interpretable once its block exists.
      if (hasRecovery) {
        await replaceRecoveryBlocksRaw(
          payload.recovery_blocks.map((b) => normalizeImportedRecoveryBlock(projectFields(b, RECOVERY_BLOCK_FIELDS))),
        );
      }
      if (hasRecovery) {
        await replaceRecoveryBlockWeeksRaw(
          payload.recovery_block_weeks.map((w) => projectFields(w, RECOVERY_WEEK_FIELDS)),
        );
      }
    }

    if (isNotebookVersion) {
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
      if (DELOAD_HISTORY_VERSIONS.has(payload.version) && 'deload_history' in payload) {
        await writeList(WORKOUT_DELOAD_HISTORY_KEY, payload.deload_history);
      }
    }

    if ('cloud' in payload && payload.cloud != null) {
      await restoreCloudBlock(payload.cloud);
    }
  }

  return { ok: true, mode: resolvedMode, queued };
}
