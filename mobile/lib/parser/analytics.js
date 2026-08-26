import { normalizeExerciseKey, _canonicalizeName } from './exerciseNames.js';
import { isStrengthExerciseName } from '../data/exerciseCatalog.js';

export function epleyPR(weight, reps) {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  return weight * (1 + reps / 30);
}

// ── Logged-session units and the tracked-span watermark (#893 / F12b) ─────────
//
// Extract all session entries for an occurrence.
// When session_entries are present, each plain row after the logged history
// is treated as its own session unit (not merged into one blob).
// When no session_entries exist, each row is one session unit; falls back
// to occ.sets as one unit only when rows is empty (test/legacy path).
// `kind` (the occurrence's section kind, e.g. 'warmup') is stamped onto every
// returned entry — additive, ignored by consumers that don't need it (e.g.
// deriveNonWeightedTrackedExerciseMetrics) — so strength-aggregate callers
// can exclude warmup-kind entries without losing entries other consumers need
// (#854/R3).
//
// #893: this lives here rather than in lib/data/workoutAnalytics.js (which
// re-exports it unchanged for its existing consumers) because the watermark
// below has to count the SAME units the signal builders consume, and
// workoutAnalytics.js sits above the parser. One definition, one ordinal.
export function _occurrenceEntries(occ) {
  const rows = occ.rows || [];
  if ((occ.session_entries || []).length > 0) {
    const loggedCount = occ.session_entries.filter(e => !e.skipped && !e.unparsed).length;
    const extra = rows
      .slice(loggedCount)
      .filter(r => r.sets && r.sets.length > 0)
      .map(r => ({ skipped: false, sets: r.sets, kind: occ.kind }));
    return [...occ.session_entries.map(e => ({ ...e, kind: occ.kind })), ...extra];
  }
  if (rows.length > 0) {
    return rows
      .filter(r => r.sets && r.sets.length > 0)
      .map(r => ({ skipped: false, sets: r.sets, kind: occ.kind }));
  }
  return occ.sets.length > 0 ? [{ skipped: false, sets: occ.sets, kind: occ.kind }] : [];
}

// A Track activation records an `anchor`: the exercise's logged-session count at
// the false->true toggle (#892 contract revision 3, sections 4 and 6).
// Progression — trend, overload direction, and the progressing/steady/
// regressing classification — reads only sessions at or after that ordinal.
// Capability (Est. Max, Kilo Max, Best Set) ignores it entirely and keeps using
// all eligible history.
//
// The anchor's unit is ONE normative list, defined here so the weighted,
// non-weighted, per-day, and classification paths cannot drift apart:
//
//   occurrences.flatMap(_occurrenceEntries)
//     .filter(se => !se.skipped && !se.unparsed && se.sets?.length > 0)
//
// Nothing consults wall-clock time: session entries carry no dates, so the
// boundary is positional, exactly as the trend comparison itself already is.
function isLoggedSessionUnit(entry) {
  return !!entry && !entry.skipped && !entry.unparsed && !!entry.sets && entry.sets.length > 0;
}

// The normative logged-session list for one exercise's occurrences, in note
// order. Its positional index IS the logged-session ordinal.
export function loggedSessionUnits(occurrences) {
  return (occurrences || [])
    .flatMap(occ => _occurrenceEntries(occ))
    .filter(isLoggedSessionUnit);
}

// Drop everything before the anchor-th logged session from a list built as
// `occurrences.flatMap(_occurrenceEntries)` — the unfiltered form, so a skipped
// or unparsed entry that sits inside the untracked span is dropped with it
// rather than surviving as a phantom leading unit. Returns [] when the anchor is
// at or past the end: the span has opened but holds no session yet.
export function sliceEntriesFromAnchor(entries, anchor) {
  if (!anchor || anchor <= 0) return entries;
  let seen = 0;
  for (let i = 0; i < entries.length; i++) {
    if (!isLoggedSessionUnit(entries[i])) continue;
    if (seen === anchor) return entries.slice(i);
    seen++;
  }
  return [];
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
//
// #893: every unit also carries `heading` (so per-day grouping can happen after
// the build rather than by rebuilding per day) and `ordinal` — its index in the
// normative logged-session list defined at the top of this file. The ordinal is
// what makes the watermark land on the same boundary here as it does in the
// classification and non-weighted paths, which walk a differently-filtered list
// over the same occurrences. A warmup occurrence contributes no comparable unit
// but still advances the ordinal, because it still contributes logged sessions
// to that normative list.
function _buildComparable(occs) {
  const units = [];
  let base = 0;
  for (const occ of occs || []) {
    const logged = _occurrenceEntries(occ).filter(isLoggedSessionUnit);
    if (occ.kind !== 'warmup') {
      // The ordinal of a unit is looked up by its `sets` array identity: every
      // builder below hands through the SAME array reference the normative list
      // holds, so this is an exact alignment rather than a positional guess
      // that a zero-set entry could shift.
      const ordinalBySets = new Map();
      logged.forEach((u, i) => {
        if (!ordinalBySets.has(u.sets)) ordinalBySets.set(u.sets, base + i);
      });

      const valid = (occ.session_entries || []).filter(se => !se.skipped && !se.unparsed);
      let picked;
      if (valid.length > 0) picked = valid.map(se => ({ sets: se.sets }));
      else {
        const rows = (occ.rows || []).filter(r => r.sets && r.sets.length > 0);
        if (rows.length > 0) picked = rows.map(r => ({ sets: r.sets }));
        else picked = occ.sets && occ.sets.length > 0 ? [{ sets: occ.sets }] : [];
      }

      picked.forEach((unit, i) => {
        const ordinal = ordinalBySets.has(unit.sets) ? ordinalBySets.get(unit.sets) : base + i;
        units.push({ sets: unit.sets, heading: occ.heading, ordinal });
      });
    }
    base += logged.length;
  }
  return units;
}

// The watermark cut. `comparable` is already in ordinal order, so this is a
// prefix drop — which is why capability metrics derived from the uncut list and
// a trend derived from the cut one always agree about which session is latest.
function _cutAtAnchor(comparable, anchor) {
  if (!anchor || anchor <= 0) return comparable;
  return comparable.filter(u => u.ordinal >= anchor);
}

// Resolve one exercise's anchor from the caller's map. Absent (legacy
// boolean-only tracked state, a catalog default, or a retired record) means no
// watermark: full history, exactly as shipped.
function _anchorFor(anchors, name) {
  if (!anchors) return 0;
  const value = anchors[normalizeExerciseKey(name)];
  return Number.isInteger(value) && value > 0 ? value : 0;
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

// `anchors` (#893) maps a canonical exercise key to its tracked-span anchor.
// Capability fields (latest_pr / kilo_max / latest_top_weight /
// repeatability_score) are derived from the FULL comparable list and never move
// with the watermark; progression_status and overload_trend are derived from the
// cut list. A cut that is empty is a span that has opened but holds no session
// yet — reported as `first_session`, not as absent, so the card keeps its
// historical capability numbers while the trend restarts.
export function deriveProgressionSignals(sections, trackedNames, anchors = null) {
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

      const anchor = _anchorFor(anchors, ex.name);
      const tracked = anchor > 0
        ? _deriveSignalForComparables(_cutAtAnchor(comparable, anchor))
        : signal;
      const progression_status = tracked ? tracked.progression_status : 'first_session';
      const overload_trend = tracked ? tracked.overload_trend : 'first_session';

      const { latest_pr, prior_pr, latest_top_weight, is_bodyweight, repeatability_score } = signal;
      if (is_bodyweight) {
        return { name, progression_status, latest_pr: null, prior_pr: null, kilo_max: null, repeatability_score: null, latest_top_weight, overload_trend, is_bodyweight: true };
      }
      // `prior_pr` describes the comparison the trend actually made, so it
      // follows the watermark: inside a fresh span there is no prior session.
      return { name, progression_status, latest_pr, prior_pr: tracked ? tracked.prior_pr : null, kilo_max, repeatability_score, latest_top_weight, overload_trend };
    }),
  };
}

export function derivePerDaySignals(sections, trackedNames, anchors = null) {
  const uniqueNames = [...new Set(trackedNames)];
  const { exercises } = deriveWorkoutAnalytics(sections);
  const result = {};

  for (const name of uniqueNames) {
    const ex = _findExercise(exercises, name);
    if (!ex) continue;

    // #854/R3: see deriveProgressionSignals above — same strength-name gate.
    // #893: built ONCE across every occurrence and grouped afterwards, so each
    // unit keeps its ordinal in the exercise's whole logged history. Grouping
    // first and rebuilding per heading would restart the count on every day and
    // put the same anchor at a different session on each one.
    const strengthEligible = isStrengthExerciseName(ex.name);
    const anchor = _anchorFor(anchors, ex.name);
    const comparable = strengthEligible ? _buildComparable(ex.occurrences) : [];

    const byHeading = new Map();
    for (const occ of ex.occurrences) {
      if (!byHeading.has(occ.heading)) byHeading.set(occ.heading, []);
    }
    for (const unit of comparable) {
      if (!byHeading.has(unit.heading)) byHeading.set(unit.heading, []);
      byHeading.get(unit.heading).push(unit);
    }

    const dayMap = {};
    for (const [heading, units] of byHeading) {
      const signal = _deriveSignalForComparables(units);
      if (!signal) {
        dayMap[heading] = { latest_pr: null, latest_top_weight: null, overload_trend: null, is_bodyweight: false };
        continue;
      }
      const tracked = anchor > 0
        ? _deriveSignalForComparables(_cutAtAnchor(units, anchor))
        : signal;
      const { latest_pr, latest_top_weight, is_bodyweight } = signal;
      // derivePerDaySignals does not expose 'first_session' for overload_trend — callers use null there.
      const overload_trend = tracked ? tracked.overload_trend : 'first_session';
      dayMap[heading] = { latest_pr, latest_top_weight, overload_trend: overload_trend === 'first_session' ? null : overload_trend, is_bodyweight };
    }

    result[normalizeExerciseKey(name)] = dayMap;
  }

  return result;
}
