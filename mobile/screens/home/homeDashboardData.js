import { useMemo } from 'react';
import { getNoteSections } from '../../hooks/useEntries';
import {
  RECOVERY_LOADING_MESSAGE,
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
  useRecoveryAnalyticsFilter,
  useRecoveryBlockState,
} from '../../hooks/entries/recoveryBlockHooks';
import { getRecoverySnapshot } from '../../lib/data/recoverySnapshot';
import { selectProvisionalRecovery } from '../../lib/data/activeTrainingContext';
import {
  RECOVERY_COMPARISON_STATES,
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
} from '../../lib/data/recoveryAnalytics';
import { RECOVERY_BIG3_STATE, deriveRecoveryBig3 } from '../../lib/data/recoveryBig3';
import { formatDate } from '../../lib/format';

// Re-exported so HomeScreen's active-branch copy can switch on the same
// enums this module derives from, without HomeScreen importing a second
// module directly (and shifting its own line numbers out from under
// unrelated line-anchored assertions, e.g. theme-rendering.test.js).
export { RECOVERY_COMPARISON_STATES, RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS };
import {
  deriveWeightGoalAnalytics,
  derive1kTotal,
  derive1kTotalFromSectionsList,
  resolveOneKSelections,
  deriveWorkoutNoteAnalytics,
  deriveRoutineStatus,
  computeWeeklySummary,
  getDefaultTrackedNames,
  normalizeLiftName,
} from '../../lib/data';
import { deriveProgressionSections, deriveExerciseProgress } from '../../lib/data/exerciseProgress';

// Home's ordinary-analytics population (#699). This module owns the decision end
// to end — which notes count, and whether that is even knowable yet — so the
// screen consumes a population rather than reassembling one.
//
// `normalNotes` drops every note linked to a recovery block whose
// `include_in_normal_analytics` is off, using the same
// lib/data/recoveryAnalyticsFilter that Analytics and save-time classification
// use, so the surfaces cannot disagree.
//
// `recoveryBoundaryReady` is false until the recovery records have been read
// successfully at least once. Home folds it into its loading gate: an
// unverified boundary must not publish aggregates, because "no records read"
// and "nothing is excluded" are the same empty snapshot and only one of them is
// true.
// The rolling series only carries an MM/DD label; re-label it through the shared
// formatter (#1250). The series is built from the last 7 distinct weigh-in dates
// and may drop points, so match each point to its source date in order by its
// MM/DD label rather than by position. Unmatched points keep their label.
const ROLLING_SERIES_DATE_LIMIT = 7;
function relabelWeightSeriesDates(series, entries) {
  if (!Array.isArray(series) || series.length === 0) return series;
  const dates = [...new Set((entries || []).map(e => e.date))].sort().slice(-ROLLING_SERIES_DATE_LIMIT);
  let next = 0;
  return series.map((point) => {
    for (let i = next; i < dates.length; i++) {
      if (String(dates[i]).split('-').slice(1).join('/') === point.label) {
        next = i + 1;
        return { ...point, label: formatDate(dates[i]) || point.label };
      }
    }
    return point;
  });
}

export function useHomeNormalNotes(notes) {
  const filter = useRecoveryAnalyticsFilter();
  return useMemo(() => ({
    normalNotes: filter.filterNotes(notes || []),
    recoveryBoundaryReady: filter.ready,
  }), [notes, filter]);
}

// Home's recovery status (#757).
//
// Deliberately `useRecoveryBlockState`, not the read-only
// `useRecoveryAnalyticsFilter` above: the filter answers only "which notes are
// excluded", which cannot tell Home whether a block is ACTIVE, which week it is
// on, or whether that answer has been verified at all. This is the same
// authoritative store Log and Analytics already render from — all three are
// mounted together in the shell, and the store is refcounted and coalescing, so
// Home subscribing adds a subscriber, not a second read or a second
// reconciliation pass.
//
// The three statuses are kept apart on purpose, because rendering nothing means
// "no recovery block is active" and that claim is only true in one of them:
//
//   ready      — a verified snapshot answered the question. `stale` says the
//                latest refresh failed over it; last-known-good stays on screen.
//   loading    — the first authoritative read is still in flight.
//   unverified — the first read FAILED. Nothing is known, and an empty snapshot
//                here is "could not read", never "nothing is recovering".
//
// `message` is the state contract's own copy rather than Home's, so Home cannot
// describe a condition differently from Log or Analytics, and `retry` is the
// same call behind those screens' `Retry recovery`.
export const HOME_RECOVERY_STATUS = Object.freeze({
  READY: 'ready',
  LOADING: 'loading',
  UNVERIFIED: 'unverified',
});

// Home's return-to-baseline content (#779/#782, #1171). Home is the entry
// point, not a second evidence surface: it folds the same
// `deriveRecoveryComparison` result Analytics renders into the user's Big 3
// (their 1K lifts) plus one count line for the rest of the roster. Every
// exercise's full breakdown stays behind the `Recovery` handoff.
export function useHomeRecoverySummary(notes, workoutNote = null) {
  const { activeBlock, weeks, ready, loading, stale, retryRecovery, provisional } = useRecoveryBlockState() || {};
  return useMemo(() => {
    // #1366: while the first authoritative read is pending, a consistent
    // persisted read answers for display (flagged `provisional`); an
    // inconsistent one stays LOADING until reconciliation settles it.
    const local = !ready && loading ? selectProvisionalRecovery(provisional) : null;
    const usable = !!local && local.consistent;
    const status = ready || usable
      ? HOME_RECOVERY_STATUS.READY
      : loading
        ? HOME_RECOVERY_STATUS.LOADING
        : HOME_RECOVERY_STATUS.UNVERIFIED;
    const isStale = !!ready && !!stale;
    const base = {
      status,
      stale: isStale,
      message: status === HOME_RECOVERY_STATUS.LOADING
        ? RECOVERY_LOADING_MESSAGE
        : status === HOME_RECOVERY_STATUS.UNVERIFIED
          ? RECOVERY_UNVERIFIED_MESSAGE
          : isStale
            ? RECOVERY_STALE_MESSAGE
            : null,
      retry: retryRecovery || null,
      active: false,
      comparisonStatus: null,
      headline: null,
      weekNumber: null,
      weekNoteStatus: null,
      weekNoteTitle: null,
      big3: [],
      counts: null,
      includedInNormalAnalytics: false,
      provisional: usable,
    };
    // An active block is only reported off a verified or consistent provisional
    // snapshot. Otherwise the arrays are placeholders, not evidence.
    const block = ready ? activeBlock : usable ? local.activeBlock : null;
    if (!block) return base;

    // #1315: the one shared Recovery snapshot (content-keyed), never a Home-local
    // derivation. Its comparison feeds the Big 3 / count lines unchanged; its
    // display is the same headline Analytics and the Overview row print.
    const snapshot = getRecoverySnapshot({ block, weeks: ready ? weeks : local.weeks, notes, stale: isStale });
    const comparison = snapshot.comparison;
    // The snapshot's selected week (the latest week by default) and its bands.
    const current = snapshot.selectedWeek;
    // #1192: the Big 3 use the same effective 1K selection as Home's normal
    // 1K total — the current routine's picks over the slot defaults — so the
    // card names the lifts the user already recognizes. The frozen baseline
    // still supplies the comparison values.
    const selections = resolveHomeOneKSelections(workoutNote);

    return {
      ...base,
      active: true,
      comparisonStatus: comparison.status,
      headline: snapshot.display,
      weekNumber: current ? current.week_number : null,
      weekNoteStatus: current ? current.status : null,
      weekNoteTitle: current && typeof current.note_title === 'string' && current.note_title.trim() ? current.note_title.trim() : null,
      ...deriveRecoveryBig3(snapshot, selections),
      includedInNormalAnalytics: block.include_in_normal_analytics === true,
    };
  }, [activeBlock, weeks, notes, workoutNote, ready, loading, stale, retryRecovery, provisional]);
}

// The canonical Big 3 selection (lib/data/oneK resolveOneKSelections), kept
// under its historical name for existing importers.
export const resolveHomeOneKSelections = resolveOneKSelections;

// #1353: the Recovery Big 3 mapping lives in lib/data/recoveryBig3; these are
// its historical names, kept as aliases for existing importers.
export const HOME_BIG3_NOT_IN_BASELINE = RECOVERY_BIG3_STATE.NOT_IN_BASELINE;
export const HOME_BIG3_SCORED = RECOVERY_BIG3_STATE.SCORED;
export const HOME_BIG3_NOT_RETESTED = RECOVERY_BIG3_STATE.NOT_RETESTED;
export const HOME_BIG3_NOT_SCORED = RECOVERY_BIG3_STATE.NOT_SCORED;
export const HOME_BIG3_UNKNOWN = RECOVERY_BIG3_STATE.UNKNOWN;
export const deriveHomeRecoveryBig3 = deriveRecoveryBig3;

// `allSections` / `noteSectionsList` are the AGGREGATED note populations and
// arrive already filtered by `useHomeNormalNotes` above. Nothing here re-derives
// that decision, so Home cannot disagree with the other surfaces.
//
// `workoutNote` is the routine the current-routine card is ABOUT, not an
// aggregate, and is passed through unfiltered — an excluded recovery week is
// still fully readable. Its `exercise_classifications` are the save-time cache
// written by useLogCurrentRoutineEditor, which derives them from the same
// filtered population.
// `normalNotes` (aligned with `noteSectionsList`) lets the canonical
// progression population drop deload notes exactly as Analytics does; legacy
// callers that omit it get every supplied section.
export function deriveHomeDashboardData({ weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, normalNotes = null, trackedLifts, trackedLiftActivations, deloadHistory, sourceNoteId = null, recoveryBlocks }) {
  let oneK = null;
  let sections = null;

  if (workoutNote?.raw_text) {
    sections = getNoteSections(workoutNote);
  }

  const oneKSelections = resolveOneKSelections(workoutNote);
  oneK = noteSectionsList
    ? derive1kTotalFromSectionsList(noteSectionsList, oneKSelections)
    : derive1kTotal(allSections, oneKSelections);

  // Canonical goal state: deriveWeightGoalAnalytics already normalizes overdue,
  // weeks remaining, and pace, so Home and Weight read the same values.
  const { rollingSeries: rawWeightSeries, trendSummary: weightTrends, goalInfo } = deriveWeightGoalAnalytics(weightEntries, weightGoal);
  const weightSeries = relabelWeightSeriesDates(rawWeightSeries, weightEntries);
  const latestWeight = weightTrends.currentWeight;

  // Canonical routine health (deriveRoutineStatus) — the same object Analytics'
  // routine gauge reads; `weeksIn` is its routine depth.
  const routineStatus = deriveRoutineStatus(sections, workoutNote, deloadHistory);

  // #893/#989/#699: the one canonical progression pass Analytics also reads —
  // same deload-excluded population, activation records, and re-entry inputs —
  // so Exercise Progress cannot mean different things on the two screens.
  const progressionSections = normalNotes && noteSectionsList
    ? deriveProgressionSections(normalNotes, noteSectionsList)
    : (allSections || []);
  const deloadContext = { deloadHistory, sourceNoteId: sourceNoteId ?? null, recoveryBlocks };
  const progress = deriveExerciseProgress({
    progressionSections,
    currentSections: sections,
    trackedLifts,
    activations: trackedLiftActivations,
    deloadContext,
  });
  const { reentry, summary: exerciseProgress } = progress;

  // #854/R5: recompute exercise_classifications live from allSections instead
  // of trusting the note's save-time cache, so a note saved under an older
  // parser grammar never shows a stale status row — mirrors the exact
  // trackedNames construction the save path uses (defaults plus any explicit
  // tracked names not already a default) so the live value matches what a
  // fresh save would persist.
  const globallyTracked = Object.keys(trackedLifts || {}).filter(k => trackedLifts[k]);
  const defaultNames = getDefaultTrackedNames();
  const normalizedDefaults = new Set(defaultNames.map(n => normalizeLiftName(n)));
  const allTrackedNames = [
    ...defaultNames,
    ...globallyTracked.filter(n => !normalizedDefaults.has(normalizeLiftName(n))),
  ];
  const { classifications: liveClassifications } = deriveWorkoutNoteAnalytics(allSections, allTrackedNames, undefined, trackedLiftActivations, deloadContext);

  const weeklySummary = computeWeeklySummary(sections, workoutNote, liveClassifications);
  // Home's progress counts are the canonical Exercise Progress summary.
  weeklySummary.classifications = {
    progressing: exerciseProgress.progressing,
    stalled: exerciseProgress.stalled,
    regressing: exerciseProgress.regressing,
  };
  weeklySummary.newlyTrackedCount = exerciseProgress.newlyTracked;
  weeklySummary.hasInheritedTracking = exerciseProgress.hasInheritedTracking;

  return {
    weightSeries,
    oneK,
    oneKSelections,
    latestWeight,
    weeksIn: routineStatus.weeksIn,
    routineStatus,
    exerciseProgress,
    weeklySummary,
    goalInfo,
    reentry,
  };
}
