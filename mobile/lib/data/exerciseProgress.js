import { normalizeExerciseKey } from '../parser.js';
// Through the lib/data barrel (not the leaf modules) so the existing screen
// tests' `jest.spyOn(data, ...)` seams still reach this pass.
import { normalizeLiftName, deriveWorkoutNoteAnalytics, deriveNonWeightedTrackedExerciseMetrics } from '../data.js';

// Canonical Exercise Progress / Progressive Overload derivation. Home's summary
// and Analytics' Overview row + Progressive Overload table all read this one
// result, so the same tracked exercise can never be counted differently on two
// screens.

// Same literal as hooks/entries/workoutNoteHooks DELOAD_NOTE_PREFIX; kept local
// so this pure module does not import from the hooks layer.
const DELOAD_NOTE_PREFIX = 'Deload · ';

export function isDeloadNote(note) {
  return typeof note?.title === 'string' && note.title.startsWith(DELOAD_NOTE_PREFIX);
}

// The canonical progression population. `notes` are the already
// recovery-filtered normal-analytics notes and `noteSectionsList[i]` is
// `notes[i]`'s parsed sections. Deload sessions are intentionally light and
// must not feed progression signals (they bias the fatigue-adjusted Kilo Max
// downward), so deload notes are dropped here. This composes with, and is
// independent of, the recovery filter: re-admitting recovery notes never
// re-admits a deload note. The 1K series keeps deload as its own point (#396)
// and is NOT derived from this population.
export function deriveProgressionSections(notes, noteSectionsList) {
  const out = [];
  (noteSectionsList || []).forEach((sections, i) => {
    if (isDeloadNote(notes?.[i])) return;
    out.push(...(sections || []));
  });
  return out;
}

// Tracked exercises that appear in the current routine — the only rows either
// surface reports progress for.
export function deriveVisibleTrackedNames(currentSections, trackedLifts) {
  const namesInCurrent = new Set(
    (currentSections || []).flatMap(s => s.exercises.map(e => normalizeExerciseKey(e.name)))
  );
  return Object.keys(trackedLifts || {})
    .filter(k => trackedLifts[k])
    .filter(name => namesInCurrent.has(normalizeExerciseKey(name)));
}

const TREND_BUCKET = Object.freeze({ up: 'progressing', flat: 'stalled', down: 'regressing' });

// The canonical Exercise Progress summary: one count per tracked exercise, from
// that exercise's own overall `overload_trend` — a multi-day exercise is one
// exercise, not one per day. `newlyTracked` counts exercises an explicit Track
// tap (#893 activation) opened that have only their first tracked session; a
// non-weighted exercise reads its own arrow (#896), since signals only cover
// strength movements. `hasInheritedTracking` flags visible tracked exercises
// with no activation record (legacy full-history progression, #894).
export function summarizeExerciseProgress({ signals = [], nonWeightedMetrics = {}, visibleTrackedNames = [], activations = null } = {}) {
  const counts = { progressing: 0, stalled: 0, regressing: 0 };
  const seen = new Set();
  const sigByKey = new Map();
  (signals || []).forEach((signal, i) => {
    const key = typeof signal?.name === 'string' ? normalizeExerciseKey(signal.name) : `#${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    sigByKey.set(key, signal);
    const bucket = TREND_BUCKET[signal?.overload_trend];
    if (bucket) counts[bucket] += 1;
  });

  let newlyTracked = 0;
  const visibleKeys = [...new Set((visibleTrackedNames || []).map(n => normalizeExerciseKey(n)))];
  for (const key of visibleKeys) {
    if (!activations?.[key]) continue;
    const name = (visibleTrackedNames || []).find(n => normalizeExerciseKey(n) === key);
    // `nonWeightedMetrics` only has entries for reps-only/time-based exercises;
    // a non-weighted exercise also carries a useless `absent` signal, so the
    // nw entry must win.
    const nw = nonWeightedMetrics?.[normalizeLiftName(name)];
    if (nw) {
      const repsOnly = nw.exercise_class === 'reps_only';
      const arrow = repsOnly ? nw.reps_arrow : nw.hold_arrow;
      const hasData = repsOnly ? nw.avg_reps != null : nw.avg_hold != null;
      if (hasData && arrow === 'dash') newlyTracked += 1;
      continue;
    }
    if (sigByKey.get(key)?.overload_trend === 'first_session') newlyTracked += 1;
  }

  return {
    ...counts,
    classified: counts.progressing + counts.stalled + counts.regressing,
    newlyTracked,
    hasInheritedTracking: visibleKeys.some(key => !activations?.[key]),
  };
}

// The one progression pass both surfaces consume. `progressionSections` must
// come from deriveProgressionSections. `deloadContext` carries the #989
// post-deload re-entry inputs.
export function deriveExerciseProgress({
  progressionSections,
  currentSections,
  trackedLifts,
  activations = null,
  multiplier,
  deloadContext = {},
}) {
  const visibleTrackedNames = deriveVisibleTrackedNames(currentSections, trackedLifts);
  const { signals, nameDisplayMap, perDaySignals, reentry, progressionSuggestions } = deriveWorkoutNoteAnalytics(
    progressionSections, visibleTrackedNames, multiplier, activations,
    {
      deloadHistory: deloadContext.deloadHistory,
      sourceNoteId: deloadContext.sourceNoteId ?? null,
      recoveryBlocks: deloadContext.recoveryBlocks,
    },
  );
  const nonWeightedMetrics = deriveNonWeightedTrackedExerciseMetrics(progressionSections, visibleTrackedNames, activations);
  const summary = summarizeExerciseProgress({ signals, nonWeightedMetrics, visibleTrackedNames, activations });
  return { visibleTrackedNames, signals, nameDisplayMap, perDaySignals, reentry, progressionSuggestions, nonWeightedMetrics, summary };
}
