import { deriveWorkoutAnalytics, normalizeExerciseKey } from '../parser.js';
import { _occurrenceEntries } from '../parser/analytics.js';
import { normalizeLiftName, isStrengthExerciseName } from './exerciseCatalog.js';
import { computeWeeksIn } from './routineStatus.js';
import { deriveSkipData } from './skipData.js';

// ── Rep drop-off flag ─────────────────────────────────────────────────────────

// Compute the intra-session rep drop-off flag for one session's sets.
// Uses working sets (weight_value > 0, rep_count > 0) only.
// Mixed-weight: uses the heaviest-weight sets to compute first/last reps.
// Returns 'hit_wall' | null.
export function computeRepDropOff(sets) {
  const working = (sets || []).filter(s => s.weight_value > 0 && s.rep_count > 0);
  if (working.length < 2) return null;
  const maxWeight = Math.max(...working.map(s => s.weight_value));
  const atMax = working.filter(s => s.weight_value === maxWeight);
  if (atMax.length < 2) return null; // only 1 set at heaviest weight → ambiguous
  const dropOff = atMax[0].rep_count - atMax[atMax.length - 1].rep_count;
  if (dropOff >= 2) return 'hit_wall';
  return null;
}

// Derive rep drop-off flags for all tracked exercises, per session.
// Returns { [normalizedName]: { [sessionIndex]: 'hit_wall' | null } }
// Only logged (non-skipped) sessions are included; skipped sessions are omitted.
// sessionIndex is the positional index in the exercise's full entry history (oldest = 0).
export function deriveRepDropOffFlags(sections, trackedNames) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const result = {};
  for (const name of trackedNames) {
    const normName = normalizeLiftName(name);
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) { result[normName] = {}; continue; }
    // #854/R3: allEntries stays the exercise's FULL entry history (positional
    // indices below are matched elsewhere by that same position) — only the
    // flag computation is gated, so a cardio-named exercise or a warmup-kind
    // entry contributes no drop-off flag without shifting any other index.
    const strengthEligible = isStrengthExerciseName(ex.name);
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    const sessionFlags = {};
    allEntries.forEach((entry, idx) => {
      if (strengthEligible && entry.kind !== 'warmup' && !entry.skipped && !entry.unparsed && entry.sets && entry.sets.length > 0) {
        sessionFlags[String(idx)] = computeRepDropOff(entry.sets);
      }
    });
    result[normName] = sessionFlags;
  }
  return result;
}

// ── Session check-in detection ────────────────────────────────────────────────
//
// Decides whether the latest logged session is worth *asking* the user about.
// Kilo asks about the shape of the work; it never infers a bodily state, and a
// silent outcome is always valid. Per the D10 trigger contract (#747) there are
// exactly TWO triggers and two signals that can never open a prompt:
//
//   - volume_drop [TRIGGER]  reps collapsed >REP_DROP_THRESHOLD on
//                  ≥MIN_COLLAPSED_SETS sets at the latest entry's OWN top
//                  weight, versus the most recent prior entry that used that
//                  same weight (a within-row skipped set, rep_count 0, counts
//                  as a full collapse). Requires ≥MIN_PRIOR_ENTRIES prior
//                  logged entries for that exercise — one observation is not a
//                  baseline. Sets below the top weight are never scored, so a
//                  deliberate back-off session does not read as a decline, and
//                  because the baseline is looked up at that same top weight,
//                  adding load can never fire it.
//   - skipped [TRIGGER, narrowed]  more exercises skipped at the latest column
//                  than the rounded per-column MEAN of the prior columns plus
//                  SKIP_MARGIN, with an absolute SKIP_FLOOR, at least two prior
//                  columns, and at least one non-skipped logged tracked entry
//                  at the latest column. That last requirement is what keeps
//                  this rule meaning "attended and cut it short" rather than
//                  "did not train".
//   - collapse [reason only]  reps fell apart within the latest session
//                  (computeRepDropOff). Corroborating evidence only: straight
//                  sets taken toward failure are numerically identical to a
//                  session that fell apart, so this never opens a prompt alone.
//   - day_skip [neither]  a whole skipped column is the user stating that
//                  nothing happened. Kilo takes that at its word: it is neither
//                  a trigger nor a reason and never appears in `detectors`.
//                  deriveSkipData still produces day_skips and the
//                  repeated_weekday_skip attendance flag for the non-modal
//                  Analytics surfaces.
//
// `isRough` is true only when a TRIGGER fired — not merely when a reason exists.
//
// The latest session is the deepest column, lastIdx = computeWeeksIn(sections) - 1,
// matching the suppression key used by the persistence layer. Multi-day routines
// share the existing positional-alignment limitation (see classifyExerciseSessions).
// Pure; operates on parsed sections. Returns:
//   { sessionIndex, isRough, detectors: string[],
//     flagged: [{ normName, name, reasons: ('skip'|'volume_drop'|'collapse')[] }],
//     metrics: { exercises_skipped: number, volume_decline_pct: number|null } }
export const SESSION_CHECKIN_REP_DROP_THRESHOLD = 2; // reps lost vs baseline to call a set "collapsed"
export const SESSION_CHECKIN_MIN_COLLAPSED_SETS = 2; // collapsed sets needed to flag a volume drop
export const SESSION_CHECKIN_MIN_PRIOR_ENTRIES = 2;  // prior logged entries needed before a volume drop can be judged
export const SESSION_CHECKIN_SKIP_FLOOR = 2;         // min skipped exercises before a skip trigger fires
export const SESSION_CHECKIN_SKIP_MARGIN = 1;        // skips above the historical average to count as "more than usual"
export const SESSION_CHECKIN_MIN_SKIP_COLUMNS = 2;   // prior columns needed before a mean skip baseline means anything

// The only detectors that may open a prompt. `collapse` is corroboration and
// `day_skip` is not produced at all.
const SESSION_CHECKIN_TRIGGERS = ['volume_drop', 'skipped'];

function _checkinTonnage(sets) {
  return (sets || []).reduce(
    (sum, s) => (s.weight_value > 0 && s.rep_count > 0 ? sum + s.weight_value * s.rep_count : sum),
    0
  );
}

// Best (max) reps recorded at a given working weight within one entry's sets.
function _maxRepsAtWeight(sets, weight) {
  let max = 0;
  for (const s of sets || []) {
    if (s.weight_value === weight && s.rep_count > max) max = s.rep_count;
  }
  return max;
}

export function deriveSessionCheckIn(sections, trackedNames) {
  const empty = {
    sessionIndex: null,
    isRough: false,
    detectors: [],
    flagged: [],
    metrics: { exercises_skipped: 0, volume_decline_pct: null },
  };
  if (!sections || !trackedNames || trackedNames.length === 0) return empty;

  // Latest session index per the contract: the routine's deepest session column.
  const sessionIndex = computeWeeksIn(sections) - 1;
  if (sessionIndex < 0) return empty;

  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));

  // Build the positional entry history for each tracked exercise that exists.
  const assessments = [];
  for (const name of trackedNames) {
    const ex = byKey.get(normalizeExerciseKey(name));
    if (!ex) continue;
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    if (allEntries.length === 0) continue;
    assessments.push({ normName: normalizeLiftName(name), name: ex.name, allEntries });
  }
  if (assessments.length === 0) return empty;

  // ── Skip trigger, via deriveSkipData ──
  // Fires only for a PARTIAL skip inside an attended session: more exercises
  // skipped at the latest column than this user's own per-column mean, by a
  // margin, above a floor, with enough history for a mean to mean anything, and
  // with real logged work still present at that column. A whole-column absence
  // is a declaration, not evidence, and is never a trigger or a reason.
  const skipData = deriveSkipData(sections);
  const skipByIndex = {};
  for (const s of skipData.exercise_skips) {
    skipByIndex[s.session_index] = (skipByIndex[s.session_index] || 0) + 1;
  }
  const latestSkipCount = skipByIndex[sessionIndex] || 0;
  // Rounded arithmetic MEAN of prior columns, matching what this contract has
  // always claimed. A minimum would let one clean column pin the baseline at 0
  // forever, so a user whose honest normal is two skips would be asked every
  // single session and the rule could never learn their "usual".
  let baselineSkips = 0;
  if (sessionIndex > 0) {
    let total = 0;
    for (let i = 0; i < sessionIndex; i++) total += skipByIndex[i] || 0;
    baselineSkips = Math.round(total / sessionIndex);
  }
  // Attendance: at least one tracked exercise logged real, parseable work at the
  // latest column. Without this, "more skipped than usual" would fire on a day
  // the user simply did not train.
  const attendedLatest = assessments.some(a => {
    const e = a.allEntries[sessionIndex];
    return !!e && !e.skipped && !e.unparsed && !!e.sets && e.sets.length > 0;
  });
  const skipFired = sessionIndex >= SESSION_CHECKIN_MIN_SKIP_COLUMNS
    && attendedLatest
    && latestSkipCount >= SESSION_CHECKIN_SKIP_FLOOR
    && latestSkipCount > baselineSkips + SESSION_CHECKIN_SKIP_MARGIN;

  // ── Per-exercise volume_drop / collapse on the latest entry ──
  const detectorSet = new Set();
  const flaggedMap = new Map(); // normName -> { normName, name, reasons:Set }
  let sumBaseTon = 0;
  let sumLatestTon = 0;
  let anyVolumeDrop = false;

  const addReason = (a, reason) => {
    if (!flaggedMap.has(a.normName)) flaggedMap.set(a.normName, { normName: a.normName, name: a.name, reasons: new Set() });
    flaggedMap.get(a.normName).reasons.add(reason);
  };

  for (const a of assessments) {
    const latest = a.allEntries[sessionIndex];
    if (!latest) continue; // exercise shorter than the latest column — not part of this session
    const priorLogged = a.allEntries
      .slice(0, sessionIndex)
      .filter(e => !e.skipped && !e.unparsed && e.sets && e.sets.length > 0);
    // Need a baseline to judge "rough": skip brand-new exercises with no history.
    if (priorLogged.length === 0) continue;

    if (latest.skipped) {
      if (skipFired) addReason(a, 'skip');
      continue;
    }

    // #854/R3: volume_drop/collapse is a strength-specific signal — a
    // cardio-named exercise, or a warmup-kind latest entry, never
    // contributes it. The skip/attendance signals above, and the general
    // "has any history" gate, already used the exercise's full, unfiltered
    // entry history.
    if (!isStrengthExerciseName(a.name) || latest.kind === 'warmup') continue;
    // Re-derive the baseline excluding warmup-kind entries so a warm-up set
    // at this same exercise never seeds the comparison either.
    const strengthPriorLogged = priorLogged.filter(e => e.kind !== 'warmup');
    if (strengthPriorLogged.length === 0) continue;

    const latestSets = latest.sets || [];
    // Two prior logged entries minimum: a single observation is not a baseline,
    // so a user's second-ever session at a lift is never judged against their
    // first.
    if (strengthPriorLogged.length >= SESSION_CHECKIN_MIN_PRIOR_ENTRIES) {
      // Score ONLY the latest entry's own top weight — the thing the user was
      // actually testing. Back-off and accessory rows below it are ignored, so
      // changing the shape of a session (heavy top set, then lighter volume)
      // never reads as a decline. Only working sets define the top weight; a
      // within-row skipped set (rep_count 0) is scored against it below but
      // cannot set it.
      const working = latestSets.filter(s => s.weight_value > 0 && s.rep_count > 0);
      const topWeight = working.length > 0
        ? Math.max(...working.map(s => s.weight_value))
        : null;
      if (topWeight !== null) {
        // Baseline reps at that same weight: most recent prior logged entry that
        // used it. Looking the baseline up AT the top weight is also what makes
        // added load safe — a heavier top set has no baseline of its own, so
        // nothing is scored and progression is never called a decline.
        let baseReps = 0;
        for (let i = strengthPriorLogged.length - 1; i >= 0; i--) {
          const m = _maxRepsAtWeight(strengthPriorLogged[i].sets, topWeight);
          if (m > 0) { baseReps = m; break; }
        }
        if (baseReps > 0) { // otherwise: new weight, nothing to compare against
          let collapsedSets = 0;
          for (const s of latestSets) {
            if (s.weight_value !== topWeight) continue;
            if (baseReps - s.rep_count > SESSION_CHECKIN_REP_DROP_THRESHOLD) collapsedSets++;
          }
          if (collapsedSets >= SESSION_CHECKIN_MIN_COLLAPSED_SETS) {
            addReason(a, 'volume_drop');
            anyVolumeDrop = true;
            sumBaseTon += _checkinTonnage(strengthPriorLogged[strengthPriorLogged.length - 1].sets);
            sumLatestTon += _checkinTonnage(latestSets);
          }
        }
      }
    }
    if (computeRepDropOff(latestSets) === 'hit_wall') {
      addReason(a, 'collapse');
    }
  }

  // Roll up detectors from flagged reasons + the session-level skip trigger.
  for (const f of flaggedMap.values()) {
    for (const r of f.reasons) detectorSet.add(r === 'skip' ? 'skipped' : r);
  }
  if (skipFired) detectorSet.add('skipped');

  const flagged = [...flaggedMap.values()].map(f => ({ normName: f.normName, name: f.name, reasons: [...f.reasons] }));
  const detectorOrder = ['skipped', 'volume_drop', 'collapse'];
  const detectors = detectorOrder.filter(d => detectorSet.has(d));
  const volume_decline_pct = anyVolumeDrop && sumBaseTon > 0
    ? Math.round(((sumBaseTon - sumLatestTon) / sumBaseTon) * 100)
    : null;

  return {
    sessionIndex,
    // Only a trigger opens a prompt: a lone `collapse` is corroboration with
    // nothing to corroborate.
    isRough: detectors.some(d => SESSION_CHECKIN_TRIGGERS.includes(d)),
    detectors,
    flagged,
    metrics: { exercises_skipped: latestSkipCount, volume_decline_pct },
  };
}
