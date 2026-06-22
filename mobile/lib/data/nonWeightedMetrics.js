import { deriveWorkoutAnalytics, normalizeExerciseKey } from '../parser.js';
import { normalizeLiftName } from './exerciseCatalog.js';
import { _occurrenceEntries } from './workoutAnalytics.js';

// ── Non-weighted tracked-exercise card metrics ────────────────────────────────

// Classify a set of sets as 'weighted' | 'time_based' | 'reps_only' | null.
// Loaded bodyweight (weight_value > 0 or non-zero assistance) → 'weighted'.
function _detectExerciseClass(sets) {
  if (!sets || sets.length === 0) return null;
  if (sets.some(s => (s.weight_value != null && s.weight_value > 0) ||
                     (s.assistance_value != null && s.assistance_value !== 0))) return 'weighted';
  if (sets.some(s => s.duration_seconds != null && s.duration_seconds > 0)) return 'time_based';
  if (sets.some(s => s.rep_count != null && s.rep_count > 0)) return 'reps_only';
  return null;
}

// Derive card metrics for non-weighted tracked exercises.
// sections: output of parseWorkoutNote(noteText).sections
// exerciseNames: string[] of exercise names
// Returns { [normalizedName]: one of two shapes keyed by exercise_class:
//
//   exercise_class === 'reps_only':
//     { exercise_class: 'reps_only',
//       avg_reps: number | null,
//       best_set_reps: number | null,
//       reps_arrow: 'up'|'down'|'flat'|'dash'|null }
//
//   exercise_class === 'time_based':
//     { exercise_class: 'time_based',
//       avg_hold: number | null,            // seconds
//       best_hold: number | null,           // seconds
//       hold_arrow: 'up'|'down'|'flat'|'dash'|null }
//
// Consumers must branch on exercise_class; only the fields for the detected
// class are present. Weighted exercises (any added/assisting load) are excluded.
// }
export function deriveNonWeightedTrackedExerciseMetrics(sections, exerciseNames) {
  if (!sections || !exerciseNames || exerciseNames.length === 0) return {};

  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const result = {};

  for (const name of exerciseNames) {
    const normName = normalizeLiftName(name);
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) continue;

    const loggedSessions = ex.occurrences
      .flatMap(occ => _occurrenceEntries(occ))
      .filter(se => !se.skipped && !se.unparsed && se.sets && se.sets.length > 0);

    if (loggedSessions.length === 0) continue;

    const latestSets = loggedSessions[loggedSessions.length - 1].sets;
    const exerciseClass = _detectExerciseClass(latestSets);
    if (!exerciseClass || exerciseClass === 'weighted') continue;

    if (exerciseClass === 'reps_only') {
      const sessionAvgs = loggedSessions.map(se => {
        const validSets = se.sets.filter(s => s.rep_count != null && s.rep_count > 0);
        return validSets.length > 0 ? (validSets.reduce((sum, s) => sum + s.rep_count, 0) / validSets.length) : 0;
      });
      const latestAvg = sessionAvgs[sessionAvgs.length - 1];
      const avg_reps = latestAvg > 0 ? Math.round(latestAvg) : null;
      const best_set_reps = Math.max(...latestSets.map(s => s.rep_count || 0)) || null;

      let priorAvg = null;
      for (let i = sessionAvgs.length - 2; i >= 0; i--) {
        if (sessionAvgs[i] > 0) { priorAvg = sessionAvgs[i]; break; }
      }

      const reps_arrow = avg_reps === null ? null
        : loggedSessions.length === 1 || priorAvg === null ? 'dash'
        : latestAvg > priorAvg ? 'up'
        : latestAvg < priorAvg ? 'down'
        : 'flat';

      result[normName] = { exercise_class: 'reps_only', avg_reps, best_set_reps, reps_arrow };
    } else {
      const sessionAvgs = loggedSessions.map(se => {
        const validSets = se.sets.filter(s => s.duration_seconds != null && s.duration_seconds > 0);
        return validSets.length > 0 ? (validSets.reduce((sum, s) => sum + s.duration_seconds, 0) / validSets.length) : 0;
      });
      const latestAvg = sessionAvgs[sessionAvgs.length - 1];
      const avg_hold = latestAvg > 0 ? latestAvg : null;
      const best_hold = Math.max(...latestSets.map(s => s.duration_seconds || 0)) || null;

      let priorAvg = null;
      for (let i = sessionAvgs.length - 2; i >= 0; i--) {
        if (sessionAvgs[i] > 0) { priorAvg = sessionAvgs[i]; break; }
      }

      const hold_arrow = avg_hold === null ? null
        : loggedSessions.length === 1 || priorAvg === null ? 'dash'
        : latestAvg > priorAvg ? 'up'
        : latestAvg < priorAvg ? 'down'
        : 'flat';

      result[normName] = { exercise_class: 'time_based', avg_hold, best_hold, hold_arrow };
    }
  }

  return result;
}
