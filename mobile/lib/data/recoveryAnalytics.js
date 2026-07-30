// Return-to-baseline analytics for recovery blocks (#697).
//
// Given a block's frozen baseline (#692) and the ordinary workout notes linked
// as its weeks, this module answers one question per exercise per week: how does
// the work actually completed this week compare to what the lifter was doing
// before the layoff?
//
// The module is pure and read-only. It never mutates a note or a snapshot, never
// writes, never completes a block, and never claims the lifter is medically
// recovered. It reports load, volume, reps, and duration as separate factual
// dimensions; it deliberately does not roll them into a single recovery score.
//
// Comparison is by exact normalized exercise identity only. A different lift is
// a different lift: no substitution mapping, no "close enough" equivalence.

import { parseWorkoutNote, deriveWorkoutAnalytics, normalizeExerciseKey } from '../parser.js';
import { _occurrenceEntries } from './workoutAnalytics.js';
import { RECOVERY_BASELINE_VERSION, orderedLiveWeeks } from './recoveryBlocks.js';

// Version stamped onto every comparison result. Bump when the row/metric shape
// below changes in a way a stored or cached consumer could misread.
export const RECOVERY_ANALYTICS_VERSION = 1;

// Whole-comparison status. Anything other than `ok`/`baseline_empty` means no
// week could be compared at all.
export const RECOVERY_COMPARISON_STATUS = Object.freeze({
  OK: 'ok',
  // The block exists and parsed, but its frozen snapshot recorded no comparable
  // exercise (e.g. it was created against an unreadable routine). Weeks are
  // still derived: recovery-only work is real even with nothing to compare to.
  BASELINE_EMPTY: 'baseline_empty',
  // No block, or no snapshot on it.
  BASELINE_UNAVAILABLE: 'baseline_unavailable',
  // Snapshot written by a newer/older baseline format than this module reads.
  BASELINE_UNSUPPORTED: 'baseline_unsupported',
});

// Per-week status.
export const RECOVERY_WEEK_STATUS = Object.freeze({
  OK: 'ok',
  // The membership points at a note that is not in the supplied set.
  NOTE_MISSING: 'note_missing',
  // The note failed the parser's size/structure contract.
  NOTE_UNREADABLE: 'note_unreadable',
});

// Per-exercise comparison state.
export const RECOVERY_COMPARISON_STATES = Object.freeze({
  // Every applicable dimension is at or above baseline. Weighted exercises need
  // BOTH top load and volume; one alone is not a return to baseline.
  BASELINE_MET: 'baseline_met',
  // Comparable work exists, at least one applicable dimension is still short.
  REBUILDING: 'rebuilding',
  // A baseline exercise with no comparable completed work this week.
  NOT_REINTRODUCED: 'not_reintroduced',
  // Work exists but cannot be compared to the baseline row (see
  // `unavailable_reason`). Never silently downgraded to `rebuilding`, which
  // would imply a measurement that was never taken.
  NOT_COMPARABLE: 'not_comparable',
  // Logged during recovery with no baseline counterpart. No ratio is invented.
  ADDED_DURING_RECOVERY: 'added_during_recovery',
});

export const RECOVERY_UNAVAILABLE_REASONS = Object.freeze({
  // The week logged the lift in a different comparable family than the baseline
  // (bodyweight chin-ups against a weighted baseline, say). Two different
  // measurements; reporting a ratio across them would be fiction.
  EXERCISE_CLASS_CHANGED: 'exercise_class_changed',
  // The week's completed work carries none of the numbers the baseline class
  // needs (e.g. an assisted-only session against a weighted baseline).
  NO_COMPARABLE_METRIC: 'no_comparable_metric',
  // The frozen row is missing or non-positive for a dimension, so a ratio would
  // divide by zero. Old snapshots are never rewritten, so this is reported, not
  // repaired.
  BASELINE_VALUE_UNUSABLE: 'baseline_value_unusable',
});

// The dimensions each exercise family is judged on, in display order.
const METRICS_BY_CLASS = Object.freeze({
  weighted: Object.freeze(['top_load', 'volume']),
  reps_only: Object.freeze(['total_reps']),
  time_based: Object.freeze(['total_seconds']),
});

// Where each dimension reads its frozen value from in a baseline row.
const BASELINE_FIELD_BY_METRIC = Object.freeze({
  top_load: 'top_weight',
  volume: 'volume',
  total_reps: 'total_reps',
  total_seconds: 'total_seconds',
});

// Volume and duration are float sums whose term order differs between the
// baseline session and the recovery week, so an exactly-equal comparison can
// land a few ULPs short of 1. Treat that as met: the alternative is telling a
// lifter who repeated their baseline session exactly that they are still short.
const MET_EPSILON = 1e-9;

// ── work aggregation ──────────────────────────────────────────────────────────

// Classify a set list into the one comparable family it belongs to.
//
// Kept deliberately in lockstep with `_detectExerciseClass` in
// data/recoveryBlocks.js and data/nonWeightedMetrics.js, both of which are
// private to their modules: any added or assisting load makes the exercise
// weighted, otherwise a held duration makes it time-based, otherwise counted
// reps make it reps-only. A comparison must classify an exercise exactly the
// way its baseline was classified or the two sides stop describing the same
// thing.
function _detectExerciseClass(sets) {
  if (!sets || sets.length === 0) return null;
  if (sets.some(s => (s.weight_value != null && s.weight_value > 0) ||
                     (s.assistance_value != null && s.assistance_value !== 0))) return 'weighted';
  if (sets.some(s => s.duration_seconds != null && s.duration_seconds > 0)) return 'time_based';
  if (sets.some(s => s.rep_count != null && s.rep_count > 0)) return 'reps_only';
  return null;
}

// Sets representing work the lifter actually completed. A within-row skip
// ("80 4,-") parses as `{ skipped: true, rep_count: null }` and must never
// contribute; neither may a zero or absent rep count on a weighted or reps-only
// set. Timed sets carry their work in duration_seconds instead.
function _completedSets(sets) {
  return (sets || []).filter(s => {
    if (!s || s.skipped) return false;
    const hasReps = s.rep_count != null && s.rep_count > 0;
    const hasDuration = s.duration_seconds != null && s.duration_seconds > 0;
    return hasReps || hasDuration;
  });
}

// Aggregate one week's completed non-warmup work, keyed by normalized exercise
// identity.
//
// Unlike baseline capture — which freezes the LAST real session of a long
// routine — a recovery week is a single week's log, so every completed occurrence
// in the note counts: an exercise trained twice in one week did twice the work.
// Repeated occurrences and the same lift across an A/B routine merge because
// `deriveWorkoutAnalytics` already groups by `normalizeExerciseKey`, so recovery
// never invents a second naming scheme.
//
// Warmup sections are dropped outright, as are skipped exercises, skipped sets,
// unparsed rows, and zero/invalid work. Returns a Map so callers get keyed
// lookups instead of rescanning per baseline exercise.
export function aggregateRecoveryWeekWork(sections) {
  const work = new Map();
  if (!Array.isArray(sections) || sections.length === 0) return work;

  const { exercises } = deriveWorkoutAnalytics(sections);

  for (const ex of exercises) {
    const occurrences = (ex.occurrences || []).filter(occ => occ.kind !== 'warmup');
    if (occurrences.length === 0) continue;

    const completed = occurrences
      .flatMap(occ => _occurrenceEntries(occ))
      .filter(entry => entry && !entry.skipped && !entry.unparsed)
      .flatMap(entry => _completedSets(entry.sets));
    if (completed.length === 0) continue;

    const exercise_class = _detectExerciseClass(completed);
    if (!exercise_class) continue;

    work.set(normalizeExerciseKey(ex.name), {
      key: normalizeExerciseKey(ex.name),
      name: ex.name,
      exercise_class,
      ..._classMetrics(exercise_class, completed),
    });
  }

  return work;
}

// Reduce one exercise's completed sets to the values its family is judged on.
// `values` holds only the dimensions that apply; a family whose sets carry none
// of its own numbers (assisted-only work under a weighted baseline) yields an
// empty `values` and is reported as not comparable rather than as zero work.
function _classMetrics(exercise_class, completed) {
  if (exercise_class === 'weighted') {
    // Working sets only: an unloaded or unrepped set inside an otherwise
    // weighted session carries no comparable top-load or volume signal.
    const working = completed.filter(
      s => s.weight_value != null && s.weight_value > 0 && s.rep_count != null && s.rep_count > 0
    );
    if (working.length === 0) return { values: {}, sets_completed: 0 };
    return {
      values: {
        top_load: Math.max(...working.map(s => s.weight_value)),
        volume: working.reduce((sum, s) => sum + s.weight_value * s.rep_count, 0),
      },
      sets_completed: working.length,
    };
  }

  if (exercise_class === 'reps_only') {
    const repped = completed.filter(s => s.rep_count != null && s.rep_count > 0);
    if (repped.length === 0) return { values: {}, sets_completed: 0 };
    return {
      values: { total_reps: repped.reduce((sum, s) => sum + s.rep_count, 0) },
      sets_completed: repped.length,
    };
  }

  const held = completed.filter(s => s.duration_seconds != null && s.duration_seconds > 0);
  if (held.length === 0) return { values: {}, sets_completed: 0 };
  return {
    values: { total_seconds: held.reduce((sum, s) => sum + s.duration_seconds, 0) },
    sets_completed: held.length,
  };
}

// ── per-exercise comparison ───────────────────────────────────────────────────

function _isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// One dimension of one exercise. `ratio` keeps the exact factual value and may
// exceed 1 — a lifter who came back stronger did come back stronger, and a
// consumer capping a meter at 100% must still be able to read the real number.
//
// `percent` is the ratio floored to a whole percent, provided so every surface
// renders the same number. Flooring (not rounding) is what keeps the label
// honest next to `met`: 99.6% of baseline reads as 99%, never as a "100%" beside
// a Rebuilding chip. The epsilon case is clamped up for the same reason.
function _metricRow(metric, current, baseline) {
  if (!_isPositiveNumber(baseline)) {
    return { metric, current: current ?? null, baseline: baseline ?? null, ratio: null, percent: null, met: false };
  }
  const ratio = current / baseline;
  const met = ratio >= 1 - MET_EPSILON;
  let percent = Math.floor(ratio * 100);
  if (met && percent < 100) percent = 100;
  return { metric, current, baseline, ratio, percent, met };
}

// Compare one frozen baseline row against this week's aggregated work.
function _compareExercise(baselineRow, weekWork) {
  const exercise_class = baselineRow.exercise_class;
  const metricNames = METRICS_BY_CLASS[exercise_class] || [];
  const baselineValues = {};
  for (const metric of metricNames) {
    baselineValues[metric] = baselineRow[BASELINE_FIELD_BY_METRIC[metric]] ?? null;
  }

  const base = {
    key: baselineRow.key,
    name: baselineRow.name,
    // How the lift was written and classified in the recovery note, when it was
    // logged at all. Kept alongside the baseline identity so a UI can show both
    // sides of a class change without re-deriving it.
    week_name: weekWork ? weekWork.name : null,
    week_exercise_class: weekWork ? weekWork.exercise_class : null,
    exercise_class,
    baseline_sets_completed: baselineRow.sets_completed ?? null,
  };

  // Nothing comparable logged: the baseline row still reports its dimensions so
  // the UI can say what has not come back yet.
  if (!weekWork) {
    return {
      ...base,
      state: RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED,
      metrics: metricNames.map(metric => _metricRow(metric, 0, baselineValues[metric])),
      unmet: [...metricNames],
      sets_completed: 0,
      unavailable_reason: null,
    };
  }

  const unavailable = (reason) => ({
    ...base,
    state: RECOVERY_COMPARISON_STATES.NOT_COMPARABLE,
    metrics: metricNames.map(metric => ({
      metric,
      current: null,
      baseline: baselineValues[metric],
      ratio: null,
      percent: null,
      met: false,
    })),
    unmet: [],
    sets_completed: weekWork.sets_completed,
    unavailable_reason: reason,
  });

  if (weekWork.exercise_class !== exercise_class) {
    return unavailable(RECOVERY_UNAVAILABLE_REASONS.EXERCISE_CLASS_CHANGED);
  }
  if (metricNames.length === 0 || metricNames.some(m => weekWork.values[m] == null)) {
    return unavailable(RECOVERY_UNAVAILABLE_REASONS.NO_COMPARABLE_METRIC);
  }
  if (metricNames.some(m => !_isPositiveNumber(baselineValues[m]))) {
    return unavailable(RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE);
  }

  const metrics = metricNames.map(metric =>
    _metricRow(metric, weekWork.values[metric], baselineValues[metric])
  );
  const unmet = metrics.filter(m => !m.met).map(m => m.metric);

  return {
    ...base,
    state: unmet.length === 0
      ? RECOVERY_COMPARISON_STATES.BASELINE_MET
      : RECOVERY_COMPARISON_STATES.REBUILDING,
    metrics,
    unmet,
    sets_completed: weekWork.sets_completed,
    unavailable_reason: null,
  };
}

// A lift that only exists in the recovery log — mobility work, a rehab
// accessory, a substitute the lifter chose. It is reported with its real numbers
// and no baseline: inventing a denominator here is exactly the fabrication the
// contract forbids.
function _addedExercise(weekWork) {
  const metricNames = METRICS_BY_CLASS[weekWork.exercise_class] || [];
  return {
    key: weekWork.key,
    name: weekWork.name,
    week_name: weekWork.name,
    week_exercise_class: weekWork.exercise_class,
    exercise_class: weekWork.exercise_class,
    state: RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY,
    metrics: metricNames.map(metric => ({
      metric,
      current: weekWork.values[metric] ?? null,
      baseline: null,
      ratio: null,
      percent: null,
      met: null,
    })),
    unmet: [],
    sets_completed: weekWork.sets_completed,
    baseline_sets_completed: null,
    unavailable_reason: null,
  };
}

// ── week comparison ───────────────────────────────────────────────────────────

function _summarize(exercises, added) {
  const summary = {
    baseline_met: 0,
    rebuilding: 0,
    not_reintroduced: 0,
    not_comparable: 0,
    added_during_recovery: added.length,
  };
  for (const row of exercises) {
    if (summary[row.state] !== undefined) summary[row.state]++;
  }
  return summary;
}

// Compare one week's parsed sections against a frozen baseline snapshot.
//
// Baseline rows come back in snapshot order (normalized key), which is stable
// across devices and independent of how the note happens to be written. Added
// exercises are sorted by normalized key for the same reason.
export function compareWeekWorkToBaseline(baseline, work) {
  const baselineRows = (baseline && Array.isArray(baseline.exercises)) ? baseline.exercises : [];
  const exercises = baselineRows.map(row => _compareExercise(row, work.get(row.key) || null));

  const baselineKeys = new Set(baselineRows.map(row => row.key));
  const added = [...work.values()]
    .filter(w => !baselineKeys.has(w.key))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(_addedExercise);

  return { exercises, added, summary: _summarize(exercises, added) };
}

// Convenience path for a caller holding one note's raw text. Returns the same
// week shape used inside a full comparison, including the explicit
// `note_unreadable` state when the note fails the parser's size/structure
// contract — an unparsable note yields no comparison rather than a comparison
// against zero work.
export function deriveRecoveryWeekComparison({ baseline, rawText }) {
  const parsed = parseWorkoutNote(rawText || '');
  if (parsed.ok === false) {
    return {
      status: RECOVERY_WEEK_STATUS.NOTE_UNREADABLE,
      note_error: parsed.error ?? null,
      exercises: [],
      added: [],
      summary: _summarize([], []),
    };
  }
  const work = aggregateRecoveryWeekWork(parsed.sections || []);
  return {
    status: RECOVERY_WEEK_STATUS.OK,
    note_error: null,
    ...compareWeekWorkToBaseline(baseline, work),
  };
}

// ── block comparison ──────────────────────────────────────────────────────────

// Accept notes as a Map, an array, or an id-keyed object; build one keyed index
// so week lookup never rescans the collection.
function _notesById(notes) {
  if (notes instanceof Map) return notes;
  const map = new Map();
  if (Array.isArray(notes)) {
    for (const note of notes) {
      if (note && note.id) map.set(note.id, note);
    }
    return map;
  }
  if (notes && typeof notes === 'object') {
    for (const [id, note] of Object.entries(notes)) map.set(id, note);
  }
  return map;
}

// Derive per-week, per-exercise return-to-baseline comparisons for one block.
//
// `weeks` are the block's memberships (live ones are selected and ordered by
// week number here, so results follow membership order — never note dates or
// titles). `notes` supplies the linked ordinary notes.
//
// Read-only: neither the notes nor the frozen snapshot are mutated, and no
// result here completes a week or a block. Completion stays an explicit user
// action, and nothing in this output means the lifter is medically recovered.
export function deriveRecoveryComparison({ block, weeks = [], notes = [] } = {}) {
  const baseline = block && block.baseline ? block.baseline : null;

  const empty = (status) => ({
    version: RECOVERY_ANALYTICS_VERSION,
    status,
    baseline_version: baseline ? (baseline.version ?? null) : null,
    block_id: block ? block.id ?? null : null,
    weeks: [],
  });

  if (!block || !baseline || !Array.isArray(baseline.exercises)) {
    return empty(RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE);
  }
  if (baseline.version !== RECOVERY_BASELINE_VERSION) {
    return empty(RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED);
  }

  const notesById = _notesById(notes);
  const ordered = orderedLiveWeeks(weeks, block.id);

  const weekResults = ordered.map(week => {
    const note = notesById.get(week.note_id) || null;
    const head = {
      week_id: week.id,
      week_number: week.week_number,
      note_id: week.note_id,
      note_title: note ? (note.title ?? null) : null,
      completed_at: week.completed_at ?? null,
    };
    if (!note) {
      return {
        ...head,
        status: RECOVERY_WEEK_STATUS.NOTE_MISSING,
        note_error: null,
        exercises: [],
        added: [],
        summary: _summarize([], []),
      };
    }
    return { ...head, ...deriveRecoveryWeekComparison({ baseline, rawText: note.raw_text }) };
  });

  return {
    version: RECOVERY_ANALYTICS_VERSION,
    status: baseline.exercises.length === 0
      ? RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY
      : RECOVERY_COMPARISON_STATUS.OK,
    baseline_version: baseline.version,
    block_id: block.id ?? null,
    weeks: weekResults,
  };
}
