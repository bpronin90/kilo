import { getNoteSections } from '../../hooks/useEntries';
import { normalizeExerciseKey, countWorkoutSessionsFromSections } from '../../lib/parser';
import {
  deriveWeightGoalAnalytics,
  derive1kTotal,
  DEFAULT_1K_EXERCISES,
  deriveWorkoutNoteAnalytics,
  deriveOverloadCounts,
  computeWeeklySummary,
} from '../../lib/data';

export function deriveHomeDashboardData({ weightEntries, workoutNote, weightGoal, allSections, trackedLifts }) {
  let oneK = null;
  let sections = null;

  if (workoutNote?.raw_text) {
    sections = getNoteSections(workoutNote);

    const oneKSelections = {
      ...DEFAULT_1K_EXERCISES,
      ...(workoutNote?.one_k_exercises || {}),
    };
    oneK = derive1kTotal(sections, oneKSelections);
  }

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
