// Backup payload validation (issue #1060 split of backupImport.js).
//
// The validator library: format-version sets, field allowlists, size bounds, and
// every per-collection `validate*` primitive. Pure and side-effect free. The
// top-level `validateBackup` gate that composes these lives with the import
// pipeline in backupRestore.js; backupExport.js reuses BACKUP_VERSION and
// validateFatigueMultiplier. Strictness, error strings and allowlists preserved.
import {
  MAX_RECOVERY_REASON_LENGTH,
  RECOVERY_BASELINE_VERSION,
} from '../../lib/data/recoveryBlocks';

// v4 adds the two recovery collections (#694). Everything a v3 file carries is
// unchanged, so a v4 file is a strict superset and a v3 importer would simply
// ignore the two new keys.
export const BACKUP_VERSION = '4';

const CLOUD_FEATURE_TOGGLE_KEYS = [
  'weight_date_edit_enabled',
  'deload_date_edit_enabled',
  'fatigue_tracking_enabled',
  'deload_mode_enabled',
];

// The complete set of user_profile fields the app reads or writes. An imported
// profile is rebuilt from this list, so an unknown key in a backup file cannot
// reach local storage.
export const PROFILE_STRING_FIELDS = ['date_of_birth', 'sex', 'activity_level', 'display_name', 'unit_system'];

// Sanity bound for an imported height. Anything outside it is malformed input,
// not a real person, and would poison the BMR/TDEE calculation.
const MAX_IMPORT_HEIGHT_CM = 300;

export const SUPPORTED_VERSIONS = new Set(['1', '2', '3', BACKUP_VERSION]);

// Which versions carry which collections. Stated as sets rather than as
// `version === BACKUP_VERSION` comparisons because every one of those
// comparisons silently changes meaning the moment the format is bumped: before
// #694 the deload-history restore was written as `version === BACKUP_VERSION`,
// so bumping to '4' would have stopped restoring deload history from a v3 file
// without a single test failing.
//
// The rule these encode: a backup that PREDATES a collection says nothing about
// it, and silence is never an instruction to delete.
export const NOTEBOOK_VERSIONS = new Set(['2', '3', '4']);
export const DELOAD_HISTORY_VERSIONS = new Set(['3', '4']);
export const RECOVERY_VERSIONS = new Set(['4']);

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
export const MAX_IMPORT_ARRAY_LENGTH = 100000;

// Per-note raw_text cap, matching the workout-note parser's MAX_RAW_TEXT_LENGTH,
// so an imported note cannot smuggle in text the parser would later reject.
export const MAX_IMPORT_RAW_TEXT_LENGTH = 200000;

// Sane bounds for the fatigue multiplier (default 1.07; a realistic user-tunable
// value stays close to 1.0). Anything non-finite, non-positive, or absurdly large
// would otherwise flow into fatigue calc (kilo_max_adjusted = avg * multiplier)
// producing NaN or nonsense results.
const MIN_IMPORT_FATIGUE_MULTIPLIER = 0;
const MAX_IMPORT_FATIGUE_MULTIPLIER = 10;

export function validateWeightEntries(entries) {
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

// #989: the frozen pre-deload working-weight context on a completed record.
// Additive — a record that predates the field simply omits it. When present it
// must match the shape the derivation layer writes (version 1); a malformed or
// unsupported context is rejected here, before any restore write.
function _isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// A persisted `pre_deload_context` is only ever written by buildDeloadReentryRecord
// (via captureDeloadWorkingContext): version 1, a non-empty string source_note_id
// (the builder omits the whole field when it has no source id), an `exercises`
// object (possibly empty), and every per-exercise entry carrying a positive
// working_weight_lb, an integer logged_session_count >= 1, and a string
// boundary_witness. Anything short of that shape is malformed and must be
// rejected before restore writes.
function _validateDeloadContextShape(ctx, label, { allowNullSourceId }) {
  if (!_isPlainObject(ctx))
    return { ok: false, error: `Invalid backup: ${label} must be an object` };
  if (ctx.version !== 1)
    return { ok: false, error: `Invalid backup: unsupported ${label} version (${ctx.version})` };
  const idOk = allowNullSourceId
    ? (ctx.source_note_id === null || (typeof ctx.source_note_id === 'string' && ctx.source_note_id.length > 0))
    : (typeof ctx.source_note_id === 'string' && ctx.source_note_id.length > 0);
  if (!idOk)
    return { ok: false, error: `Invalid backup: ${label}.source_note_id must be a non-empty string${allowNullSourceId ? ' or null' : ''}` };
  if (!_isPlainObject(ctx.exercises))
    return { ok: false, error: `Invalid backup: ${label}.exercises must be an object` };
  for (const ex of Object.values(ctx.exercises)) {
    if (!_isPlainObject(ex))
      return { ok: false, error: `Invalid backup: ${label} exercise is not an object` };
    if (!Number.isFinite(ex.working_weight_lb) || ex.working_weight_lb <= 0)
      return { ok: false, error: `Invalid backup: ${label} working_weight_lb must be a positive number` };
    if (!Number.isInteger(ex.logged_session_count) || ex.logged_session_count < 1)
      return { ok: false, error: `Invalid backup: ${label} logged_session_count must be a positive integer` };
    if (typeof ex.boundary_witness !== 'string')
      return { ok: false, error: `Invalid backup: ${label} boundary_witness must be a string` };
  }
  return { ok: true };
}

// A COMPLETED record's pre_deload_context always carries a real source id (the
// builder omits the whole field otherwise).
function validatePreDeloadContext(ctx) {
  return _validateDeloadContextShape(ctx, 'deload history pre_deload_context', { allowNullSourceId: false });
}

// An ACTIVE deload note's working_context is captured before completion and may
// predate the routine ever being saved, so its source id can legitimately be null.
function validateActiveDeloadWorkingContext(ctx) {
  return _validateDeloadContextShape(ctx, 'cloud.current_deload_note.working_context', { allowNullSourceId: true });
}

export function validateDeloadHistory(entries) {
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
    if ('pre_deload_context' in d) {
      const ctxCheck = validatePreDeloadContext(d.pre_deload_context);
      if (!ctxCheck.ok) return ctxCheck;
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
export function validateRecoveryBlocks(blocks) {
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
export function validateRecoveryWeeks(weeks, blockIds, liveNoteIds) {
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
export function validateRecoveryInvariants(blocks, weeks) {
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

export function validateFatigueMultiplier(value) {
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


// The `cloud` block is optional: a plain v3 file has none and must still import
// exactly as before. When present it is untrusted input like the rest of the
// payload, so it is validated before any write.
export function validateCloudBlock(cloud) {
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
  if (cloud.tracked_lift_activations != null) {
    const a = cloud.tracked_lift_activations;
    if (typeof a !== 'object' || Array.isArray(a))
      return { ok: false, error: 'Invalid backup: cloud.tracked_lift_activations must be an object or null' };
    for (const [lift, record] of Object.entries(a)) {
      if (record == null || typeof record !== 'object' || Array.isArray(record))
        return { ok: false, error: `Invalid backup: cloud.tracked_lift_activations.${lift} must be an object` };
      if (!Number.isInteger(record.anchor) || record.anchor < 0)
        return { ok: false, error: `Invalid backup: cloud.tracked_lift_activations.${lift}.anchor must be a non-negative integer` };
      if (record.at != null && typeof record.at !== 'string')
        return { ok: false, error: `Invalid backup: cloud.tracked_lift_activations.${lift}.at must be a string` };
      if (record.witness != null) {
        const w = record.witness;
        if (typeof w !== 'object' || Array.isArray(w))
          return { ok: false, error: `Invalid backup: cloud.tracked_lift_activations.${lift}.witness must be an object or null` };
        if (!Array.isArray(w.headings) || w.headings.some(h => h !== null && typeof h !== 'string'))
          return { ok: false, error: `Invalid backup: cloud.tracked_lift_activations.${lift}.witness.headings must be an array of strings` };
        if (typeof w.sessions !== 'string')
          return { ok: false, error: `Invalid backup: cloud.tracked_lift_activations.${lift}.witness.sessions must be a string` };
      }
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
    if (n.working_context != null) {
      const ctxCheck = validateActiveDeloadWorkingContext(n.working_context);
      if (!ctxCheck.ok) return ctxCheck;
    }
  }

  return { ok: true };
}
