import { useMemo } from 'react';
import { getNoteSections } from '../../hooks/useEntries';
import { useRecoveryAnalyticsFilter } from '../../hooks/entries/recoveryBlockHooks';
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
