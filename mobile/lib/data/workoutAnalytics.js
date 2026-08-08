import { deriveWorkoutAnalytics, normalizeExerciseKey, deriveProgressionSignals, derivePerDaySignals } from '../parser.js';
import { normalizeLiftName } from './exerciseCatalog.js';
import { computeWeeksIn } from './routineStatus.js';
import { deriveSkipData } from './skipData.js';
import { computeKiloMax, getKiloFatigueMultiplier } from './fatigue.js';

// ── Per-exercise session classification ───────────────────────────────────────

function _totalRepsAtWeight(sets, weight) {
  return sets.filter(s => s.weight_value === weight).reduce((sum, s) => sum + s.rep_count, 0);
}

// Extract all session entries for an occurrence.
// When session_entries are present, each plain row after the logged history
// is treated as its own session unit (not merged into one blob).
// When no session_entries exist, each row is one session unit; falls back
// to occ.sets as one unit only when rows is empty (test/legacy path).
export function _occurrenceEntries(occ) {
  const rows = occ.rows || [];
  if ((occ.session_entries || []).length > 0) {
    const loggedCount = occ.session_entries.filter(e => !e.skipped && !e.unparsed).length;
    const extra = rows
      .slice(loggedCount)
      .filter(r => r.sets && r.sets.length > 0)
      .map(r => ({ skipped: false, sets: r.sets }));
    return [...occ.session_entries, ...extra];
  }
  if (rows.length > 0) {
    return rows
      .filter(r => r.sets && r.sets.length > 0)
      .map(r => ({ skipped: false, sets: r.sets }));
  }
  return occ.sets.length > 0 ? [{ skipped: false, sets: occ.sets }] : [];
}

function _topWeight(sets) {
  const weighted = sets.filter(s => s.weight_value != null && s.weight_value > 0 && s.rep_count != null && s.rep_count > 0);
  if (weighted.length === 0) return null;
  return Math.max(...weighted.map(s => s.weight_value));
}

// Classify one exercise given its full session_entries list (newest last).
// Returns 'progressing' | 'stalled' | 'regressing' | 'inconsistent' | null
function _classifyEntries(allEntries) {
  const window = allEntries.slice(-3);
  const logged = window.filter(se => !se.skipped && !se.unparsed && se.sets && _topWeight(se.sets) !== null);
  if (logged.length === 0) return null;
  if (logged.length === 1) {
    return window.some(se => se.skipped) ? 'inconsistent' : 'initial';
  }

  const latest = logged[logged.length - 1];
  const prior = logged[logged.length - 2];
  const latestTop = _topWeight(latest.sets);
  const priorTop = _topWeight(prior.sets);

  if (latestTop < priorTop) return 'regressing';
  if (latestTop > priorTop) return 'progressing';

  // Same top weight: compare total reps at top weight
  const latestTotal = _totalRepsAtWeight(latest.sets, latestTop);
  const priorTotal = _totalRepsAtWeight(prior.sets, priorTop);
  if (latestTotal > priorTotal) return 'progressing';
  if (latestTotal < priorTotal) return 'regressing';

  // Same top weight and same total reps: check distribution
  const latestReps = latest.sets.filter(s => s.weight_value === latestTop).map(s => s.rep_count).sort((a, b) => a - b);
  const priorReps = prior.sets.filter(s => s.weight_value === priorTop).map(s => s.rep_count).sort((a, b) => a - b);
  if (JSON.stringify(latestReps) === JSON.stringify(priorReps)) return 'stalled';

  return null;
}

// Classify session trends for all tracked exercises.
// sections: output of parseWorkoutNote(noteText).sections
// trackedNames: string[] of exercise names to classify
// Returns { [normalizedName]: 'progressing'|'stalled'|'regressing'|'inconsistent'|null }
export function classifyExerciseSessions(sections, trackedNames) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(ex => [normalizeExerciseKey(ex.name), ex]));
  const result = {};
  for (const name of trackedNames) {
    const normName = normalizeLiftName(name);
    const key = normalizeExerciseKey(name);
    const ex = byKey.get(key);
    if (!ex) { result[normName] = null; continue; }
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    const classification = _classifyEntries(allEntries);
    result[normName] = classification;
  }
  return result;
}

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
    const allEntries = ex.occurrences.flatMap(occ => _occurrenceEntries(occ));
    const sessionFlags = {};
    allEntries.forEach((entry, idx) => {
      if (!entry.skipped && !entry.unparsed && entry.sets && entry.sets.length > 0) {
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
    const latestSets = latest.sets || [];
    // Two prior logged entries minimum: a single observation is not a baseline,
    // so a user's second-ever session at a lift is never judged against their
    // first.
    if (priorLogged.length >= SESSION_CHECKIN_MIN_PRIOR_ENTRIES) {
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
        for (let i = priorLogged.length - 1; i >= 0; i--) {
          const m = _maxRepsAtWeight(priorLogged[i].sets, topWeight);
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
            sumBaseTon += _checkinTonnage(priorLogged[priorLogged.length - 1].sets);
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

// Wrap deriveProgressionSignals and replace kilo_max with the Epley-average x
// fatigue formula (adjusted, rounded).
export function deriveSignals(sections, trackedNames, multiplier = getKiloFatigueMultiplier()) {
  const { exercises: signals } = deriveProgressionSignals(sections, trackedNames);
  const { exercises: analyticsExercises } = deriveWorkoutAnalytics(sections);

  const byName = new Map(analyticsExercises.map(ex => [normalizeExerciseKey(ex.name), ex]));

  return {
    exercises: signals.map(sig => {
      const ex = byName.get(normalizeExerciseKey(sig.name));
      if (!ex) return sig;
      const { kilo_max_adjusted } = computeKiloMax(ex.occurrences, multiplier);
      return { ...sig, kilo_max: kilo_max_adjusted };
    }),
  };
}

// ── Canonical workout analytics derivation layer ──────────────────────────────

// Derives the full set of shared workout analytics from parsed sections.
// This is the single canonical entry point for all workout analytics consumers.
//
// sections:      output of parseWorkoutNote(noteText).sections
// trackedNames:  string[] of exercise names to classify, track, and derive signals for
// multiplier:    optional fatigue multiplier for signal derivation (defaults to getKiloFatigueMultiplier())
//
// Returns:
//   weeksIn:         session depth (routine depth) — max session_entries.length
//   classifications: { [normalizedName]: 'progressing'|'stalled'|'regressing'|'inconsistent'|null }
//   skipData:        { exercise_skips, day_skips, attendance_flags }
//   signals:         exercise[] — progression signals for trackedNames
//   nameDisplayMap:  Map<normalizedName, displayName> — last-seen user-typed casing
export function deriveWorkoutNoteAnalytics(sections, trackedNames, multiplier) {
  const _multiplier = multiplier !== undefined ? multiplier : getKiloFatigueMultiplier();
  if (!sections) {
    const emptyClassif = Object.fromEntries((trackedNames || []).map(n => [normalizeLiftName(n), null]));
    return {
      weeksIn: null,
      classifications: emptyClassif,
      skipData: { exercise_skips: [], day_skips: [], attendance_flags: [] },
      signals: [],
      nameDisplayMap: new Map(),
      perDaySignals: {},
    };
  }
  const nameDisplayMap = new Map();
  sections.forEach(s => s.exercises.forEach(e => {
    nameDisplayMap.set(normalizeExerciseKey(e.name), e.name);
  }));
  return {
    weeksIn: computeWeeksIn(sections),
    classifications: classifyExerciseSessions(sections, trackedNames),
    skipData: deriveSkipData(sections),
    signals: deriveSignals(sections, trackedNames, _multiplier).exercises,
    nameDisplayMap,
    perDaySignals: derivePerDaySignals(sections, trackedNames),
  };
}

// Count progressing/stalled/regressing rows exactly as the analytics panel renders.
// Iterates each exercise-per-section appearance; multi-day exercises contribute once
// per day using the per-day trend (falling back to global signal trend).
export function deriveOverloadCounts(sections, signals, perDaySignals) {
  const sigMap = new Map(
    signals.map(s => [normalizeExerciseKey(s.name), s])
  );
  const counts = { progressing: 0, stalled: 0, regressing: 0 };
  (sections || []).forEach(sec => {
    sec.exercises.forEach(ex => {
      const key = normalizeExerciseKey(ex.name);
      const sig = sigMap.get(key);
      if (!sig) return;
      const dayRow = perDaySignals?.[key]?.[sec.heading];
      const rowTrend = dayRow?.overload_trend ?? sig.overload_trend;
      if (rowTrend === 'up')   counts.progressing++;
      if (rowTrend === 'flat') counts.stalled++;
      if (rowTrend === 'down') counts.regressing++;
    });
  });
  return counts;
}

// ── Weekly Assessment Summary ────────────────────────────────────────────────

export function computeWeeklySummary(sections, workoutNote) {
  // A session exists if there are any non-skipped entries or sets in the sections
  const hasActivity = (sections || []).some(section =>
    section.exercises.some(ex => {
      if ((ex.session_entries || []).length > 0) {
        return ex.session_entries.some(se => !se.skipped);
      }
      return (ex.sets || []).length > 0;
    })
  );

  // 1. Classification counts (tracked exercises only)
  let classifications = null;
  const sourceClassifs = workoutNote?.exercise_classifications;

  if (sourceClassifs) {
    classifications = { progressing: 0, stalled: 0, regressing: 0, inconsistent: 0, initial: 0 };
    Object.values(sourceClassifs).forEach(val => {
      if (classifications[val] !== undefined) {
        classifications[val]++;
      }
    });
  }

  const DISPLAYABLE = new Set(['progressing', 'stalled', 'regressing']);
  let sessionStatusRows = null;
  if (sourceClassifs) {
    const rows = Object.entries(sourceClassifs)
      .filter(([, cls]) => DISPLAYABLE.has(cls))
      .map(([name, classification]) => ({ name, classification }));
    sessionStatusRows = rows.length > 0 ? rows : null;
  }

  if (!hasActivity) {
    return {
      hasActivity: false,
      sessionStatusRows,
    };
  }

  return {
    hasActivity: true,
    classifications,
    sessionStatusRows,
  };
}

// ── Check-in history ──────────────────────────────────────────────────────────

export function deriveCheckInHistory(notes) {
  const empty = { list: [], rough: [], ok: [], pending: [], summary: { roughTotal: 0, okTotal: 0, pendingTotal: 0, top_reason: null } };
  if (!notes || notes.length === 0) return empty;

  const list = [];
  for (const note of notes) {
    const checkins = note?.session_checkins;
    if (!checkins) continue;
    for (const [key, checkin] of Object.entries(checkins)) {
      if (!checkin || !checkin.responded_at) continue;
      list.push({
        noteId: note.id,
        sessionIndex: Number(key),
        responded_at: checkin.responded_at,
        status: checkin.status ?? null,
        reasons: checkin.reasons ?? [],
        note: checkin.note ?? null,
        exercises_skipped: checkin.exercises_skipped ?? 0,
        volume_decline_pct: checkin.volume_decline_pct ?? null,
        flagged: checkin.flagged ?? [],
        detectors: checkin.detectors ?? [],
      });
    }
  }

  list.sort((a, b) => (a.responded_at < b.responded_at ? 1 : a.responded_at > b.responded_at ? -1 : 0));

  const rough = list.filter(c => c.status === 'rough');
  const ok = list.filter(c => c.status === 'ok');
  const pending = list.filter(c => c.status == null);

  let top_reason = null;
  if (rough.length > 0) {
    const counts = new Map();
    for (const c of rough) {
      for (const r of c.reasons) {
        counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    let max = 0;
    for (const [reason, count] of counts) {
      if (count > max) { max = count; top_reason = reason; }
    }
  }

  return { list, rough, ok, pending, summary: { roughTotal: rough.length, okTotal: ok.length, pendingTotal: pending.length, top_reason } };
}
