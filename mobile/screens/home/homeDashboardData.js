import { useMemo } from 'react';
import { getNoteSections } from '../../hooks/useEntries';
import {
  RECOVERY_LOADING_MESSAGE,
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
  useRecoveryAnalyticsFilter,
  useRecoveryBlockState,
} from '../../hooks/entries/recoveryBlockHooks';
import {
  deriveRecoveryComparison,
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
} from '../../lib/data/recoveryAnalytics';

// Re-exported so HomeScreen's active-branch copy can switch on the same
// enums this module derives from, without HomeScreen importing a second
// module directly (and shifting its own line numbers out from under
// unrelated line-anchored assertions, e.g. theme-rendering.test.js).
export { RECOVERY_COMPARISON_STATUS, RECOVERY_WEEK_STATUS };
import { normalizeExerciseKey, countWorkoutSessionsFromSections } from '../../lib/parser';
import {
  deriveWeightGoalAnalytics,
  derive1kTotal,
  derive1kTotalFromSectionsList,
  DEFAULT_1K_EXERCISES,
  deriveWorkoutNoteAnalytics,
  deriveOverloadCounts,
  deriveNonWeightedTrackedExerciseMetrics,
  computeWeeklySummary,
  getDefaultTrackedNames,
  normalizeLiftName,
} from '../../lib/data';

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

// Home's return-to-baseline content (#779/#782). Rather than inventing a
// second vocabulary, this folds the same `deriveRecoveryComparison` result
// Analytics already renders (`AnalyticsRecoverySection`) into the summary, for
// the latest live week only. Home is the entry point, not a second evidence
// surface — the per-exercise breakdown stays behind the `Recovery` handoff.
export function useHomeRecoverySummary(notes) {
  const { activeBlock, weeks, ready, loading, stale, retryRecovery } = useRecoveryBlockState() || {};
  return useMemo(() => {
    const status = ready
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
      weekNumber: null,
      weekNoteStatus: null,
      metCount: 0,
      totalBaselineExercises: 0,
      categoryCounts: { rebuilding: 0, not_reintroduced: 0, not_comparable: 0, added_during_recovery: 0 },
      includedInNormalAnalytics: false,
    };
    // An active block is only reported off a verified snapshot. While the read
    // is unresolved the arrays are placeholders, not evidence of either answer.
    if (!ready || !activeBlock) return base;

    const comparison = deriveRecoveryComparison({ block: activeBlock, weeks, notes });
    const comparisonWeeks = comparison.weeks || [];
    const current = comparisonWeeks.length > 0 ? comparisonWeeks[comparisonWeeks.length - 1] : null;
    return {
      ...base,
      active: true,
      comparisonStatus: comparison.status,
      weekNumber: current ? current.week_number : null,
      weekNoteStatus: current ? current.status : null,
      metCount: current?.summary?.baseline_met || 0,
      totalBaselineExercises: current ? (current.exercises || []).length : 0,
      categoryCounts: {
        rebuilding: current?.summary?.rebuilding || 0,
        not_reintroduced: current?.summary?.not_reintroduced || 0,
        not_comparable: current?.summary?.not_comparable || 0,
        added_during_recovery: current?.summary?.added_during_recovery || 0,
      },
      includedInNormalAnalytics: activeBlock.include_in_normal_analytics === true,
    };
  }, [activeBlock, weeks, notes, ready, loading, stale, retryRecovery]);
}

// #894: mirrors deriveOverloadCounts' own per-appearance iteration
// (lib/data/workoutAnalytics.js) but counts rows in a freshly opened tracked
// span — a `first_session` weighted trend, or a non-weighted 'dash' arrow
// with capability data present — rather than progressing/stalled/regressing.
//
// Review finding (#896): `first_session`/`dash` alone is not enough. An
// INHERITED exercise (no activation record — #893 legacy/catalog state) with
// exactly one comparable historical session reports the identical
// `first_session`/'dash' state, because there is nothing prior to compare
// against either. Only a row backed by a live activation record is an
// EXPLICIT fresh span; requiring `trackedLiftActivations` here is what keeps
// this bucket from double-claiming rows `hasInheritedTracking` already
// explains.
//
// Non-weighted exercises (Bike, Plank, ...) never get an `overload_trend` at
// all — `deriveWorkoutNoteAnalytics`'s signals cover strength movements only,
// and their fresh-span state lives in `nonWeightedMetrics`'s arrow instead
// (mirroring how AnalyticsScreen reads `nw` alongside `sig` per row). Without
// folding that in, an explicitly tracked non-weighted exercise in its first
// span had a live activation (so not "inherited") but no counted row either,
// leaving Home's summary silently blank for it.
function countNewlyTrackedRows(sections, signals, perDaySignals, nonWeightedMetrics, trackedLiftActivations) {
  const sigMap = new Map((signals || []).map(s => [normalizeExerciseKey(s.name), s]));
  let count = 0;
  (sections || []).forEach(sec => {
    sec.exercises.forEach(ex => {
      const key = normalizeExerciseKey(ex.name);
      const hasActivation = !!trackedLiftActivations?.[key];
      if (!hasActivation) return;

      // `nonWeightedMetrics` only ever gets an entry for an exercise its own
      // class detection resolved to reps-only/time-based (weighted and
      // unclassifiable exercises are skipped inside that derivation) — so its
      // presence is what actually tells the two kinds of row apart. `sigMap`
      // is NOT a reliable signal on its own: deriveProgressionSignals returns
      // an `absent` placeholder (overload_trend: null) for every tracked name
      // that isn't strength-eligible, so a non-weighted exercise always has a
      // (useless) sig entry too — checking sig first would shadow the real nw
      // state below with that placeholder's null trend.
      const nw = nonWeightedMetrics?.[normalizeLiftName(ex.name)];
      if (nw) {
        const arrow = nw.exercise_class === 'reps_only' ? nw.reps_arrow : nw.hold_arrow;
        const hasData = nw.exercise_class === 'reps_only' ? nw.avg_reps != null : nw.avg_hold != null;
        if (hasData && arrow === 'dash') count++;
        return;
      }

      const sig = sigMap.get(key);
      if (!sig) return;
      const dayRow = perDaySignals?.[key]?.[sec.heading];
      const rowTrend = dayRow?.overload_trend ?? sig.overload_trend;
      if (rowTrend === 'first_session') count++;
    });
  });
  return count;
}

// `allSections` / `noteSectionsList` are the AGGREGATED note populations and
// arrive already filtered by `useHomeNormalNotes` above. Nothing here re-derives
// that decision, so Home cannot disagree with the other surfaces.
//
// `workoutNote` is the routine the current-routine card is ABOUT, not an
// aggregate, and is passed through unfiltered — an excluded recovery week is
// still fully readable. Its `exercise_classifications` are the save-time cache
// written by useLogCurrentRoutineEditor, which derives them from the same
// filtered population.
export function deriveHomeDashboardData({ weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, trackedLifts, trackedLiftActivations }) {
  let oneK = null;
  let sections = null;

  if (workoutNote?.raw_text) {
    sections = getNoteSections(workoutNote);
  }

  const oneKSelections = {
    ...DEFAULT_1K_EXERCISES,
    ...(workoutNote?.one_k_exercises || {}),
  };
  oneK = noteSectionsList
    ? derive1kTotalFromSectionsList(noteSectionsList, oneKSelections)
    : derive1kTotal(allSections, oneKSelections);

  const { rollingSeries: weightSeries, trendSummary: weightTrends, goalInfo } = deriveWeightGoalAnalytics(weightEntries, weightGoal);
  const latestWeight = weightTrends.currentWeight;
  const { weeksIn } = deriveWorkoutNoteAnalytics(sections, []);

  const namesInCurrent = new Set(
    (sections || []).flatMap(s => s.exercises.map(e => normalizeExerciseKey(e.name)))
  );
  const globallyTracked = Object.keys(trackedLifts || {}).filter(k => trackedLifts[k]);
  const visibleTrackedNames = globallyTracked.filter(
    name => namesInCurrent.has(normalizeExerciseKey(name))
  );
  // #893: the activation records go to every progression derivation on this
  // screen, and Analytics passes the same records to its own — so the two
  // surfaces classify the same tracked population against the same boundary
  // rather than each inventing one.
  const { signals, perDaySignals } = deriveWorkoutNoteAnalytics(allSections, visibleTrackedNames, undefined, trackedLiftActivations);
  const counts = deriveOverloadCounts(sections, signals, perDaySignals);
  // #894: same visible tracked population, split by whether it has an
  // explicit activation record (#893) — presence means an explicit Track
  // tap opened this span; absence means inherited catalog/pre-#893 state
  // that is still running on legacy full-history progression. Non-weighted
  // exercises need their own metrics derivation (#896 review) — signals only
  // ever cover strength movements.
  const nonWeightedMetrics = deriveNonWeightedTrackedExerciseMetrics(allSections, visibleTrackedNames, trackedLiftActivations);
  const newlyTrackedCount = countNewlyTrackedRows(sections, signals, perDaySignals, nonWeightedMetrics, trackedLiftActivations);
  const hasInheritedTracking = visibleTrackedNames.some(
    name => !trackedLiftActivations?.[normalizeExerciseKey(name)]
  );

  // #854/R5: recompute exercise_classifications live from allSections instead
  // of trusting the note's save-time cache, so a note saved under an older
  // parser grammar never shows a stale status row — mirrors the exact
  // trackedNames construction the save path uses (defaults plus any explicit
  // tracked names not already a default) so the live value matches what a
  // fresh save would persist.
  const defaultNames = getDefaultTrackedNames();
  const normalizedDefaults = new Set(defaultNames.map(n => normalizeLiftName(n)));
  const allTrackedNames = [
    ...defaultNames,
    ...globallyTracked.filter(n => !normalizedDefaults.has(normalizeLiftName(n))),
  ];
  const { classifications: liveClassifications } = deriveWorkoutNoteAnalytics(allSections, allTrackedNames, undefined, trackedLiftActivations);

  const weeklySummary = computeWeeklySummary(sections, workoutNote, liveClassifications);
  weeklySummary.classifications = counts;
  weeklySummary.newlyTrackedCount = newlyTrackedCount;
  weeklySummary.hasInheritedTracking = hasInheritedTracking;

  const sessionCount = countWorkoutSessionsFromSections(sections || []);

  let sanitizedGoalInfo = null;
  if (goalInfo) {
    const rawWeeks = goalInfo.weeks_remaining;
    const weeks_remaining = (rawWeeks === null || rawWeeks === undefined || isNaN(rawWeeks)) ? 0 : Math.max(0, rawWeeks);
    const isOverdue = weeks_remaining <= 0;

    let required_weekly_pace = goalInfo.required_weekly_pace;
    if (isOverdue || required_weekly_pace === null || required_weekly_pace === undefined || isNaN(required_weekly_pace) || !isFinite(required_weekly_pace)) {
      required_weekly_pace = null;
    }

    sanitizedGoalInfo = {
      ...goalInfo,
      weeks_remaining,
      required_weekly_pace,
      isOverdue,
    };
  }

  return {
    weightSeries,
    oneK,
    latestWeight,
    weeksIn,
    weeklySummary,
    sessionCount,
    goalInfo: sanitizedGoalInfo,
  };
}
