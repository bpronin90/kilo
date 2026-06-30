import { deriveWorkoutAnalytics, epleyPR, normalizeExerciseKey } from '../parser.js';
import { _occurrenceEntries } from './workoutAnalytics.js';

// Default exercise selections for the 1k total slots.
// Mirrors the primary compounds in KILO_EXERCISES for this program.
export const DEFAULT_1K_EXERCISES = {
  bench: 'DB Bench Press',
  squat: 'Squat',
  deadlift: 'Deadlift',
};

// Most recent non-null entry in an ordinal-indexed per-session PR list.
function _latestNonNull(prs) {
  for (let i = prs.length - 1; i >= 0; i--) {
    if (prs[i] != null) return prs[i];
  }
  return null;
}

// derive1kTotal: the Big-3 1RM total for the most recent COMPLETE session cycle.
//
// SEMANTIC: current-performance tracker, not a sticky all-time milestone. This is
// exactly the last point of derive1kTotalSeries — the latest session ordinal at
// which all three lifts have a real (non-skipped) PR. So a lighter recent cycle
// lowers the 1K, a per-occurrence max can no longer pin an old higher value, and
// the total is never a sum of PRs from different cycles.
//
// IMPORTANT: sections must come from a single note (single routine cadence).
// Passing multi-note concatenations breaks ordinal alignment when per-lift session
// counts differ across notes — use derive1kTotalSeriesFromSectionsList for the
// cross-note historical series and read the headline from the current note only.
//
// Fallback: when no complete aligned Big-3 cycle exists (a selected lift never
// appears in the note), total is null but each present lift still reports its
// most recent logged session PR for context. _exercisePerSessionPRs walks
// _occurrenceEntries, so this stays robust to how sessions are separated (day
// headings, `- entry` lines, bare rows, blank lines).
//
// sections: output of parseWorkoutNote(noteText).sections — single note only
// selections: { bench: string, squat: string, deadlift: string } — exercise name for each slot
// Returns: { total: number|null, bench: number|null, squat: number|null, deadlift: number|null }
export function derive1kTotal(sections, { bench, squat, deadlift }) {
  const series = derive1kTotalSeries(sections, { bench, squat, deadlift });
  if (series.length > 0) {
    const last = series[series.length - 1];
    return { total: last.total, bench: last.bench, squat: last.squat, deadlift: last.deadlift };
  }
  // No complete Big-3 cycle: show each present lift's latest session, total null.
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(e => [normalizeExerciseKey(e.name), e]));
  const latestFor = (name) => {
    const ex = byKey.get(normalizeExerciseKey(name));
    return ex ? _latestNonNull(_exercisePerSessionPRs(ex)) : null;
  };
  return { total: null, bench: latestFor(bench), squat: latestFor(squat), deadlift: latestFor(deadlift) };
}

// Best Epley PR across one logged session's sets. Returns null when no valid set.
function _sessionEntryPR(entry) {
  let best = null;
  for (const s of entry.sets || []) {
    const e = epleyPR(s.weight_value, s.rep_count);
    if (e !== null && (best === null || e > best)) best = e;
  }
  return best;
}

// Ordered (oldest-first) per-session best-Epley PRs for one derived exercise,
// indexed by session ordinal. The ordinal position is preserved: skipped/unparsed
// sessions and sessions with no valid weighted set are kept as null placeholders
// so a given index refers to the same session-cycle slot across every lift. This
// is what lets the three lifts be aligned by ordinal without a skip in one lift
// silently shifting later sessions out of alignment.
function _exercisePerSessionPRs(ex) {
  const prs = [];
  for (const occ of ex.occurrences) {
    for (const entry of _occurrenceEntries(occ)) {
      prs.push(entry.skipped || entry.unparsed ? null : _sessionEntryPR(entry));
    }
  }
  return prs;
}

// derive1kTotalSeries: Big-3 1RM total per historical workout session.
// Builds each lift's ordinal-indexed per-session PR list once (single
// deriveWorkoutAnalytics pass, then one linear pass per lift) and aligns them by
// session ordinal. A point is emitted only when all three lifts have a real PR at
// the SAME ordinal; ordinals where any lift was skipped/unlogged are dropped
// without shifting later ordinals, so a point never sums PRs from sessions that
// did not occur in the same cycle. `session` is the 1-based ordinal, so dropped
// cycles leave gaps in the numbering rather than collapsing the series.
//
// sections: output of parseWorkoutNote(noteText).sections
// selections: { bench: string, squat: string, deadlift: string } — exercise name per slot
// Returns: { session, total, bench, squat, deadlift }[]
//
// Note: alignment is by session ordinal within each lift's history (the routine's
// week cadence), since the parsed model carries no per-session date to key on.
//
// Complexity: O(total sessions across the three lifts); no per-session re-scan of notes.
export function derive1kTotalSeries(sections, { bench, squat, deadlift }) {
  const { exercises } = deriveWorkoutAnalytics(sections);
  const byKey = new Map(exercises.map(e => [normalizeExerciseKey(e.name), e]));
  const prsFor = (name) => {
    const ex = byKey.get(normalizeExerciseKey(name));
    return ex ? _exercisePerSessionPRs(ex) : [];
  };

  const benchPRs = prsFor(bench);
  const squatPRs = prsFor(squat);
  const deadliftPRs = prsFor(deadlift);

  const n = Math.min(benchPRs.length, squatPRs.length, deadliftPRs.length);
  const series = [];
  for (let i = 0; i < n; i++) {
    const b = benchPRs[i], s = squatPRs[i], d = deadliftPRs[i];
    // Only emit when all three lifts have a real PR at this same session ordinal.
    if (b == null || s == null || d == null) continue;
    series.push({
      session: i + 1,
      total: b + s + d,
      bench: b,
      squat: s,
      deadlift: d,
    });
  }
  return series;
}

// derive1kTotalSeriesFromSectionsList: cross-note Big-3 1RM series that never
// mixes ordinals across routine boundaries. Calls derive1kTotalSeries once per
// note's sections (so ordinals are relative within each note), then concatenates
// the per-note results with monotonically increasing global session numbers.
//
// sectionsList: Section[][] — one entry per note, in chronological order
// selections: { bench: string, squat: string, deadlift: string }
// Returns: { session, total, bench, squat, deadlift }[]
export function derive1kTotalSeriesFromSectionsList(sectionsList, selections) {
  const merged = [];
  let offset = 0;
  for (const sections of sectionsList || []) {
    const noteSeries = derive1kTotalSeries(sections, selections);
    for (const pt of noteSeries) {
      merged.push({ ...pt, session: offset + pt.session });
    }
    if (noteSeries.length > 0) {
      offset += noteSeries[noteSeries.length - 1].session;
    }
  }
  return merged;
}

// derive1kTotalFromSectionsList: headline 1K derived from the per-note series.
// Returns the last series point so the total always reflects the most recent
// complete Big-3 cycle within a routine cadence, never mixing sessions across
// note boundaries. Falls back to per-lift latest PRs when no complete cycle exists.
//
// sectionsList: Section[][] — one entry per note, in chronological order
// selections: { bench: string, squat: string, deadlift: string }
// Returns: { total: number|null, bench: number|null, squat: number|null, deadlift: number|null }
export function derive1kTotalFromSectionsList(sectionsList, selections) {
  const series = derive1kTotalSeriesFromSectionsList(sectionsList, selections);
  if (series.length > 0) {
    const last = series[series.length - 1];
    return { total: last.total, bench: last.bench, squat: last.squat, deadlift: last.deadlift };
  }
  // No complete Big-3 cycle across any note: show per-lift latest PRs, null total.
  const allSections = (sectionsList || []).flat();
  return derive1kTotal(allSections, selections);
}

// ── Routine switching: progress rollover ──────────────────────────────────────

// Returns display names of exercises that appear in both routines.
// Uses keyed Set lookups — O(n+m), no nested scans.
// Deduplicates by canonical key; returns display names from the new routine.
export function findMatchingExerciseNames(oldSections, newSections) {
  const oldKeys = new Set(
    (oldSections || []).flatMap(s => s.exercises.map(e => normalizeExerciseKey(e.name)))
  );
  const matched = [];
  const seenNew = new Set();
  for (const section of (newSections || [])) {
    for (const ex of section.exercises) {
      const key = normalizeExerciseKey(ex.name);
      if (oldKeys.has(key) && !seenNew.has(key)) {
        matched.push(ex.name);
        seenNew.add(key);
      }
    }
  }
  return matched;
}

// Returns a filtered one_k_exercises object retaining only slots whose exercise
// name exists in matchedNameKeys (a Set of canonical keys).
// Returns null when oldOneK is null or no slots survive.
export function rolloverOneKExercises(oldOneK, matchedNameKeys) {
  if (!oldOneK || !(matchedNameKeys instanceof Set) || matchedNameKeys.size === 0) return null;
  const result = {};
  for (const [slot, name] of Object.entries(oldOneK)) {
    if (name && matchedNameKeys.has(normalizeExerciseKey(name))) {
      result[slot] = name;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
