import { useMemo } from 'react';
import { getNoteSections } from '../../hooks/useEntries';
import {
  RECOVERY_LOADING_MESSAGE,
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
  useRecoveryAnalyticsFilter,
  useRecoveryBlockState,
} from '../../hooks/entries/recoveryBlockHooks';
import { orderedLiveWeeks } from '../../lib/data/recoveryBlocks';
import { normalizeExerciseKey, countWorkoutSessionsFromSections } from '../../lib/parser';
import {
  deriveWeightGoalAnalytics,
  derive1kTotal,
  derive1kTotalFromSectionsList,
  DEFAULT_1K_EXERCISES,
  deriveWorkoutNoteAnalytics,
  deriveOverloadCounts,
  computeWeeklySummary,
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

export function useHomeRecoverySummary() {
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
      title: null,
      weekNumber: null,
      weekComplete: false,
      weekCount: 0,
      includedInNormalAnalytics: false,
    };
    // An active block is only reported off a verified snapshot. While the read
    // is unresolved the arrays are placeholders, not evidence of either answer.
    if (!ready || !activeBlock) return base;

    const live = orderedLiveWeeks(weeks, activeBlock.id);
    const current = live.length > 0 ? live[live.length - 1] : null;
    return {
      ...base,
      active: true,
      title: activeBlock.baseline_note_title || 'Untitled Routine',
      weekNumber: current ? current.week_number : null,
      weekComplete: !!current?.completed_at,
      weekCount: live.length,
      includedInNormalAnalytics: activeBlock.include_in_normal_analytics === true,
    };
  }, [activeBlock, weeks, ready, loading, stale, retryRecovery]);
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
export function deriveHomeDashboardData({ weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, trackedLifts }) {
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
  const { signals, perDaySignals } = deriveWorkoutNoteAnalytics(allSections, visibleTrackedNames);
  const counts = deriveOverloadCounts(sections, signals, perDaySignals);

  const weeklySummary = computeWeeklySummary(sections, workoutNote);
  weeklySummary.classifications = counts;

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
