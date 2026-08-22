import { normalizeExerciseKey, _canonicalizeName } from './exerciseNames.js';
import { isStrengthExerciseName } from '../data/exerciseCatalog.js';

export function epleyPR(weight, reps) {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  return weight * (1 + reps / 30);
}

export function deriveWorkoutAnalytics(sections) {
  const byName = new Map();

  for (const section of sections) {
    const { heading, subheading, kind, exercises } = section;
    for (const ex of exercises) {
      const key = normalizeExerciseKey(ex.name);
      if (!byName.has(key)) {
        byName.set(key, { name: _canonicalizeName(ex.name), occurrences: [], sets: [], rows: [], unparsed_rows: [] });
      }
      const derived = byName.get(key);
      // #854/G5: cardio/non-weight exercises now parse as ordinary
      // structured rows (real weight_value/rep_count) — occurrences/sets/rows
      // stay intact here so consumers that need the real logged data for
      // tracked warmup, timed-hold, reps-only, and cardio exercises (e.g.
      // deriveNonWeightedTrackedExerciseMetrics) keep working. R3's
      // exclusion from strength aggregates (tonnage, PR/max, rep-drop-off) is
      // applied below, only to this function's own PR calculation, and at
      // the specific strength-aggregate call sites in workoutAnalytics.js —
      // never by blanking the shared occurrence data itself.
      derived.occurrences.push({ heading, subheading, kind, rows: ex.rows, sets: ex.sets, unparsed_rows: ex.unparsed_rows, session_entries: ex.session_entries });
      for (const s of ex.sets) derived.sets.push(s);
      for (const r of ex.rows) derived.rows.push(r);
      for (const u of ex.unparsed_rows) derived.unparsed_rows.push(u);
    }
  }

  const exercises = [];
  for (const derived of byName.values()) {
    // #854/R3: PR/max is a strength-specific metric — a warmup-kind
    // occurrence, or any occurrence under a non-strength (cardio) exercise
    // name, never contributes to it. This only filters the PR calculation
    // below; `occurrences`/`sets`/`rows` on the returned exercise stay the
    // real, unfiltered data.
    const strengthEligible = isStrengthExerciseName(derived.name);
    const set_prs = [];
    for (let oi = 0; oi < derived.occurrences.length; oi++) {
      const occ = derived.occurrences[oi];
      if (!strengthEligible || occ.kind === 'warmup') continue;
      for (const set of occ.sets) {
        set_prs.push({ set, epley_pr: epleyPR(set.weight_value, set.rep_count), occurrence_index: oi });
      }
    }
    let estimated_pr = null;
    let latest_pr = null;
    const last_oi = derived.occurrences.length - 1;
    for (const { epley_pr, occurrence_index } of set_prs) {
      if (epley_pr !== null && (estimated_pr === null || epley_pr > estimated_pr)) {
        estimated_pr = epley_pr;
      }
      if (occurrence_index === last_oi && epley_pr !== null && (latest_pr === null || epley_pr > latest_pr)) {
        latest_pr = epley_pr;
      }
    }
    exercises.push({ name: derived.name, occurrences: derived.occurrences, sets: derived.sets, rows: derived.rows, unparsed_rows: derived.unparsed_rows, set_prs, estimated_pr, latest_pr });
  }

  return { exercises };
}

function _findExercise(exercises, targetName) {
  const key = normalizeExerciseKey(targetName);
  return exercises.find(e => normalizeExerciseKey(e.name) === key) || null;
}

export function deriveTrackedPRs(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);
  return {
    exercises: uniqueNames.map(name => {
      const match = _findExercise(exercises, name);
      return {
        name,
        estimated_pr: match ? match.estimated_pr : null,
        latest_pr: match ? match.latest_pr : null
      };
    }),
  };
}

function _occurrencePR(occurrence) {
  let best = null;
  for (const s of occurrence.sets) {
    const pr = epleyPR(s.weight_value, s.rep_count);
    if (pr !== null && (best === null || pr > best)) best = pr;
  }
  return best;
}

function _occurrenceRepeatabilityScore(occurrence) {
  const weighted = occurrence.sets.filter(s => !s.skipped && s.weight_value !== null && s.weight_value > 0);
  if (weighted.length === 0) return null;
  const maxWeight = Math.max(...weighted.map(s => s.weight_value));
  return weighted.filter(s => s.weight_value === maxWeight).length;
}

function _occurrenceTopWeight(occurrence) {
  const weighted = occurrence.sets.filter(s => !s.skipped && s.weight_value !== null && s.weight_value > 0);
  if (weighted.length === 0) return null;
  return Math.max(...weighted.map(s => s.weight_value));
}

// #854/R3: a warmup-kind occurrence never contributes to a progression
// signal (strength or bodyweight/reps-only) — excluded unconditionally here,
// independent of the exercise-name strength gate its callers apply.
function _buildComparable(occs) {
  return occs.filter(occ => occ.kind !== 'warmup').flatMap(occ => {
    const valid = (occ.session_entries || []).filter(se => !se.skipped && !se.unparsed);
    if (valid.length > 0) return valid.map(se => ({ sets: se.sets }));
    const rows = (occ.rows || []).filter(r => r.sets && r.sets.length > 0);
    if (rows.length > 0) return rows.map(r => ({ sets: r.sets }));
    return occ.sets && occ.sets.length > 0 ? [occ] : [];
  });
}

function _deriveSignalForComparables(comparable) {
  if (comparable.length === 0) return null;

  let latestIdx = -1;
  let priorIdx = -1;
  for (let i = comparable.length - 1; i >= 0; i--) {
    if (_occurrencePR(comparable[i]) !== null) {
      if (latestIdx === -1) latestIdx = i;
      else { priorIdx = i; break; }
    }
  }

  if (latestIdx === -1) {
    const repTotals = comparable.map(unit =>
      unit.sets.reduce((sum, s) => sum + (s.rep_count || 0), 0)
    );
    const latestReps = repTotals[repTotals.length - 1];
    if (!latestReps) return null;
    const latestBestSet = Math.max(...comparable[comparable.length - 1].sets.map(s => s.rep_count || 0));
    const priorReps = repTotals.length > 1 ? repTotals[repTotals.length - 2] : null;
    const progression_status = priorReps === null ? 'first_session'
      : latestReps > priorReps ? 'improved' : latestReps < priorReps ? 'regressed' : 'held';
    const overload_trend = priorReps === null ? null
      : latestReps > priorReps ? 'up' : latestReps < priorReps ? 'down' : 'flat';
    return { latest_pr: null, prior_pr: null, latest_top_weight: latestBestSet || null, overload_trend, progression_status, is_bodyweight: true, repeatability_score: null };
  }

  const latestOcc = comparable[latestIdx];
  const latest_pr = _occurrencePR(latestOcc);
  const repeatability_score = _occurrenceRepeatabilityScore(latestOcc);
  const latest_top_weight = _occurrenceTopWeight(latestOcc);

  if (priorIdx === -1) {
    return { latest_pr, prior_pr: null, latest_top_weight, overload_trend: 'first_session', progression_status: 'first_session', is_bodyweight: false, repeatability_score };
  }

  const prior_pr = _occurrencePR(comparable[priorIdx]);
  const prior_top_weight = _occurrenceTopWeight(comparable[priorIdx]);
  const progression_status = latest_pr > prior_pr ? 'improved'
                            : latest_pr < prior_pr ? 'regressed'
                            : 'held';

  const latest_total_reps = latestOcc.sets.reduce((sum, s) => sum + (s.rep_count || 0), 0);
  const prior_total_reps = comparable[priorIdx].sets.reduce((sum, s) => sum + (s.rep_count || 0), 0);
  const weight_diff = latest_top_weight !== null && prior_top_weight !== null
    ? latest_top_weight - prior_top_weight : null;
  const overload_trend = weight_diff === null ? null
    : weight_diff > 0 ? 'up'
    : weight_diff < 0 ? 'down'
    : latest_total_reps > prior_total_reps ? 'up'
    : latest_total_reps < prior_total_reps ? 'down'
    : 'flat';

  return { latest_pr, prior_pr, latest_top_weight, overload_trend, progression_status, is_bodyweight: false, repeatability_score };
}

export function deriveProgressionSignals(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);

  return {
    exercises: uniqueNames.map(name => {
      const absent = { name, progression_status: null, latest_pr: null, prior_pr: null, kilo_max: null, repeatability_score: null, latest_top_weight: null, overload_trend: null };
      const ex = _findExercise(exercises, name);
      if (!ex) return absent;
      const occs = ex.occurrences;
      if (occs.length === 0) return absent;

      const kilo_max = ex.estimated_pr;
      // #854/R3: progression signal (weighted or bodyweight/reps-only) is a
      // strength-aggregate concept — a cardio-named tracked exercise gets no
      // signal here at all; its card metrics come from
      // deriveNonWeightedTrackedExerciseMetrics instead.
      const comparable = isStrengthExerciseName(ex.name) ? _buildComparable(occs) : [];
      const signal = _deriveSignalForComparables(comparable);
      if (!signal) return absent;

      const { latest_pr, prior_pr, latest_top_weight, overload_trend, progression_status, is_bodyweight, repeatability_score } = signal;
      if (is_bodyweight) {
        return { name, progression_status, latest_pr: null, prior_pr: null, kilo_max: null, repeatability_score: null, latest_top_weight, overload_trend, is_bodyweight: true };
      }
      return { name, progression_status, latest_pr, prior_pr, kilo_max, repeatability_score, latest_top_weight, overload_trend };
    }),
  };
}

export function derivePerDaySignals(sections, trackedNames) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);
  const result = {};

  for (const name of uniqueNames) {
    const ex = _findExercise(exercises, name);
    if (!ex) continue;

    const byHeading = new Map();
    for (const occ of ex.occurrences) {
      const heading = occ.heading;
      if (!byHeading.has(heading)) byHeading.set(heading, []);
      byHeading.get(heading).push(occ);
    }

    // #854/R3: see deriveProgressionSignals above — same strength-name gate.
    const strengthEligible = isStrengthExerciseName(ex.name);
    const dayMap = {};
    for (const [heading, occs] of byHeading) {
      const comparable = strengthEligible ? _buildComparable(occs) : [];
      const signal = _deriveSignalForComparables(comparable);
      if (!signal) {
        dayMap[heading] = { latest_pr: null, latest_top_weight: null, overload_trend: null, is_bodyweight: false };
        continue;
      }
      const { latest_pr, latest_top_weight, overload_trend, is_bodyweight } = signal;
      // derivePerDaySignals does not expose 'first_session' for overload_trend — callers use null there.
      dayMap[heading] = { latest_pr, latest_top_weight, overload_trend: overload_trend === 'first_session' ? null : overload_trend, is_bodyweight };
    }

    result[normalizeExerciseKey(name)] = dayMap;
  }

  return result;
}
