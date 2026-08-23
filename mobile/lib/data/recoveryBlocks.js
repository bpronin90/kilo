// Recovery-block domain (#692).
//
// A recovery block groups an ordered run of weekly workout notes taken while
// returning from an injury or layoff, and freezes a snapshot of the lifter's
// pre-recovery performance so later analytics can measure return-to-baseline
// without re-deriving a moving target.
//
// This module is pure: it parses/derives and builds records. Persistence and
// the cross-record invariants that need to see the whole collection (one active
// block, one live membership per note, sequential week numbers) live in
// storage/entries/recoveryStorage.js.

import { parseWorkoutNote, deriveWorkoutAnalytics, normalizeExerciseKey } from '../parser.js';
import { _occurrenceEntries } from './workoutAnalytics.js';

// Version stamped onto every frozen baseline snapshot. Bump only when the
// per-exercise metric shape below changes in a way that makes an old snapshot
// non-comparable to a newly captured one; consumers branch on it rather than
// guessing from which fields happen to be present. Frozen snapshots are never
// rewritten in place, so old versions stay readable forever.
export const RECOVERY_BASELINE_VERSION = 1;

// Deterministic failure codes for the domain invariants. Callers (and the later
// sync layer) branch on `code`, never on message text.
export const RECOVERY_ERROR_CODES = Object.freeze({
  ACTIVE_BLOCK_EXISTS: 'ACTIVE_BLOCK_EXISTS',
  BLOCK_NOT_FOUND: 'BLOCK_NOT_FOUND',
  BLOCK_NOT_ACTIVE: 'BLOCK_NOT_ACTIVE',
  NOTE_ALREADY_IN_BLOCK: 'NOTE_ALREADY_IN_BLOCK',
  NOTE_IS_BASELINE: 'NOTE_IS_BASELINE',
  WEEK_NOT_FOUND: 'WEEK_NOT_FOUND',
  INVALID_BASELINE_NOTE: 'INVALID_BASELINE_NOTE',
  INVALID_NOTE_ID: 'INVALID_NOTE_ID',
});

// ── the optional "why this block started" reason (#872) ───────────────────────

// A reason is one concise line of context ("torn hamstring", "8 weeks off after
// surgery"), not a journal entry. The cap is deliberately short: the field is
// rendered as a caption beside a block on Log and Analytics, and every surface
// that shows it has room for a line, not a paragraph. The server bounds the
// same column far more loosely (see the payload-bounds trigger), because a
// server bound exists to stop abuse, not to enforce this product decision.
export const MAX_RECOVERY_REASON_LENGTH = 280;

// Normalize a caller-supplied reason to the ONE canonical stored form.
//
// The rules, applied in this order and nowhere else in the app, so a reason
// typed at creation, edited later, restored from a backup, or merged from
// another device all land on the same value:
//
//   - anything that is not a string (null, undefined, a number, an object) is
//     `null`. A reason is optional, and the domain never invents one;
//   - every whitespace run — including the newlines a multiline paste carries —
//     collapses to a single space, then the result is trimmed. So "  " and ""
//     both become `null` rather than a record that claims a blank reason;
//   - the result is capped at MAX_RECOVERY_REASON_LENGTH characters.
//
// `null` (not `''`) is the stored absence, matching every other optional column
// on the record and the nullable `reason` column in kilo.recovery_blocks: a
// legacy row that predates this field and a row whose reason was cleared are
// then indistinguishable, which is exactly right — neither has one.
export function normalizeRecoveryReason(value) {
  if (typeof value !== 'string') return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.slice(0, MAX_RECOVERY_REASON_LENGTH);
}

export class RecoveryBlockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RecoveryBlockError';
    this.code = code;
  }
}

export function isRecoveryBlockError(err) {
  return err instanceof RecoveryBlockError;
}

// ── baseline capture ──────────────────────────────────────────────────────────

// Classify a session's sets into the one comparable family the exercise belongs
// to. Mirrors the rules in data/nonWeightedMetrics.js (`_detectExerciseClass`),
// which is private to that module: any added or assisting load makes the
// exercise weighted, otherwise a held duration makes it time-based, otherwise
// counted reps make it reps-only. Kept in lockstep deliberately so a recovery
// baseline and a tracked-exercise card never disagree about what an exercise is.
function _detectExerciseClass(sets) {
  if (!sets || sets.length === 0) return null;
  if (sets.some(s => (s.weight_value != null && s.weight_value > 0) ||
                     (s.assistance_value != null && s.assistance_value !== 0))) return 'weighted';
  if (sets.some(s => s.duration_seconds != null && s.duration_seconds > 0)) return 'time_based';
  if (sets.some(s => s.rep_count != null && s.rep_count > 0)) return 'reps_only';
  return null;
}

// Sets that represent work the lifter actually completed. A within-row skip
// ("80 4,-") parses as `{ skipped: true, rep_count: null }` and must never
// contribute volume; neither may a zero/absent rep count on a weighted or
// reps-only set. Timed sets carry their work in duration_seconds instead.
function _completedSets(sets) {
  return (sets || []).filter(s => {
    if (!s || s.skipped) return false;
    const hasReps = s.rep_count != null && s.rep_count > 0;
    const hasDuration = s.duration_seconds != null && s.duration_seconds > 0;
    return hasReps || hasDuration;
  });
}

// Build the frozen metric row for one exercise from a single session's sets.
// Returns null when the session holds nothing comparable, so an exercise whose
// only data is warmup/skipped/unparsed produces no baseline row at all rather
// than a fabricated zero.
function _baselineMetrics(sets) {
  const completed = _completedSets(sets);
  if (completed.length === 0) return null;

  const exercise_class = _detectExerciseClass(completed);
  if (!exercise_class) return null;

  if (exercise_class === 'weighted') {
    // Working sets only: an unloaded or unrepped set inside an otherwise
    // weighted session carries no comparable top-weight/volume signal.
    const working = completed.filter(
      s => s.weight_value != null && s.weight_value > 0 && s.rep_count != null && s.rep_count > 0
    );
    if (working.length === 0) return null;
    return {
      exercise_class,
      top_weight: Math.max(...working.map(s => s.weight_value)),
      // Completed volume, the standard tonnage definition used elsewhere in the
      // app: sum(weight x reps) over completed working sets only.
      volume: working.reduce((sum, s) => sum + s.weight_value * s.rep_count, 0),
      sets_completed: working.length,
    };
  }

  if (exercise_class === 'reps_only') {
    const repped = completed.filter(s => s.rep_count != null && s.rep_count > 0);
    if (repped.length === 0) return null;
    return {
      exercise_class,
      best_set_reps: Math.max(...repped.map(s => s.rep_count)),
      total_reps: repped.reduce((sum, s) => sum + s.rep_count, 0),
      sets_completed: repped.length,
    };
  }

  const held = completed.filter(s => s.duration_seconds != null && s.duration_seconds > 0);
  if (held.length === 0) return null;
  return {
    exercise_class,
    best_hold_seconds: Math.max(...held.map(s => s.duration_seconds)),
    total_seconds: held.reduce((sum, s) => sum + s.duration_seconds, 0),
    sets_completed: held.length,
  };
}

// Freeze the pre-recovery baseline from a parsed routine.
//
// For each normalized exercise identity, the baseline is the LATEST session that
// actually recorded completed work. Walking backwards from the newest session is
// what makes trailing skips harmless: a lifter who tapped "skip week" twice
// before starting recovery still gets the last real session they logged, not an
// empty one (that is the whole point of freezing at block creation).
//
// Warmup sections are excluded entirely — warmup load is not a baseline the
// lifter is returning to. Exercise identity, and the merging of the same lift
// across an A/B routine or repeated occurrences within a note, comes from the
// existing parser rules (`deriveWorkoutAnalytics` groups by
// `normalizeExerciseKey`), so recovery never invents a second naming scheme.
//
// `sections` is `parseWorkoutNote(text).sections`. Returns a plain, structurally
// frozen snapshot; exercises are ordered by normalized key so two captures of
// the same routine are byte-identical.
export function captureRecoveryBaseline(sections) {
  const snapshot = {
    version: RECOVERY_BASELINE_VERSION,
    exercises: [],
  };
  if (!Array.isArray(sections) || sections.length === 0) return _deepFreeze(snapshot);

  const { exercises } = deriveWorkoutAnalytics(sections);

  const rows = [];
  for (const ex of exercises) {
    // Drop warmup occurrences before flattening so a warmup-only exercise
    // disappears rather than contributing a light "baseline".
    const occurrences = (ex.occurrences || []).filter(occ => occ.kind !== 'warmup');
    if (occurrences.length === 0) continue;

    const entries = occurrences.flatMap(occ => _occurrenceEntries(occ));

    // Newest-first walk: the first session that yields comparable completed work
    // wins. Skipped and unparsed entries are stepped over, not counted.
    let metrics = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry || entry.skipped || entry.unparsed) continue;
      metrics = _baselineMetrics(entry.sets);
      if (metrics) break;
    }
    if (!metrics) continue;

    rows.push({
      key: normalizeExerciseKey(ex.name),
      name: ex.name,
      ...metrics,
    });
  }

  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  snapshot.exercises = rows;
  return _deepFreeze(snapshot);
}

// Convenience wrapper for callers holding raw note text. A note that fails to
// parse (oversized, or a Tier-A parser error) yields an empty snapshot rather
// than throwing: a block created against an unreadable routine simply has no
// baseline to compare against.
export function captureRecoveryBaselineFromText(rawText) {
  const parsed = parseWorkoutNote(rawText || '');
  return captureRecoveryBaseline(parsed.sections || []);
}

// Recursively freeze the snapshot. The frozen baseline is authoritative after
// creation, so handing callers a mutable object would make "frozen" a promise
// the domain cannot keep — a UI or analytics consumer could silently rewrite
// history in memory before it was ever persisted.
function _deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) _deepFreeze(value[key]);
  return Object.freeze(value);
}

// ── record builders ───────────────────────────────────────────────────────────

function _id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Build a recovery-block record. `baseline` must already be captured by the
// caller so the freeze happens exactly once, at creation.
export function buildRecoveryBlock({
  baselineNoteId,
  baselineNoteTitle = null,
  baseline,
  includeInNormalAnalytics = false,
  reason = null,
  now = new Date().toISOString(),
}) {
  if (!baselineNoteId || typeof baselineNoteId !== 'string') {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.INVALID_BASELINE_NOTE,
      'A recovery block requires the id of the routine it is baselined from.'
    );
  }
  return {
    id: _id('rb'),
    baseline_note_id: baselineNoteId,
    baseline_note_title: baselineNoteTitle ?? null,
    baseline: baseline ?? { version: RECOVERY_BASELINE_VERSION, exercises: [] },
    // Recovery weeks are deliberately excluded from normal analytics by
    // default: mixing rehab loads into ordinary progression would read as a
    // months-long regression. Opting in is an explicit user choice.
    include_in_normal_analytics: includeInNormalAnalytics === true,
    // Optional free text (#872). Always present as a key so the record shape is
    // uniform, always `null` when the user gave nothing: the field records why
    // a recovery started, and a block started without an explanation genuinely
    // has none. Nothing else in the domain reads it — it changes no baseline,
    // membership, fatigue, comparison, or analytics result.
    reason: normalizeRecoveryReason(reason),
    started_at: now,
    completed_at: null,
    saved_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

// Build one ordered week membership linking an ordinary workout note to a block.
export function buildRecoveryWeek({
  blockId,
  noteId,
  weekNumber,
  now = new Date().toISOString(),
}) {
  if (!noteId || typeof noteId !== 'string') {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.INVALID_NOTE_ID,
      'A recovery week requires the id of the workout note it links.'
    );
  }
  return {
    id: _id('rw'),
    block_id: blockId,
    note_id: noteId,
    week_number: weekNumber,
    completed_at: null,
    saved_at: now,
    updated_at: now,
    deleted_at: null,
  };
}

// ── predicates and ordering ───────────────────────────────────────────────────

// Live means "not tombstoned". Tombstones are retained for sync convergence and
// are never user-visible, matching the workout-note contract.
export function isLiveRecord(record) {
  return !!record && !record.deleted_at;
}

// Active means live and not yet explicitly completed. Completion is always an
// explicit user action — no metric, week count, or elapsed time completes a
// block on its own.
export function isBlockActive(block) {
  return isLiveRecord(block) && !block.completed_at;
}

export function findActiveBlock(blocks) {
  return (blocks || []).find(isBlockActive) || null;
}

// Live weeks of one block, ordered by week number (stable on ties by id so the
// ordering is total and reproducible across devices).
export function orderedLiveWeeks(weeks, blockId) {
  return (weeks || [])
    .filter(w => isLiveRecord(w) && w.block_id === blockId)
    .sort((a, b) =>
      a.week_number - b.week_number ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}

// Next week number for a block: one past the highest LIVE week number, so
// deleting the last week frees its ordinal for reuse while tombstones (which
// keep their historical ordinal) never collide with it.
export function nextWeekNumber(weeks, blockId) {
  const live = orderedLiveWeeks(weeks, blockId);
  if (live.length === 0) return 1;
  return live[live.length - 1].week_number + 1;
}

// The live membership binding a note, if any. One note may belong to at most one
// block at a time; a tombstoned membership does not count, so a note removed
// from a block can be added to another.
export function findLiveMembershipForNote(weeks, noteId) {
  return (weeks || []).find(w => isLiveRecord(w) && w.note_id === noteId) || null;
}
