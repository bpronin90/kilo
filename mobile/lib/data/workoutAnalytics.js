// Compatibility barrel for the workout analytics derivation layer.
//
// The derivations were split into cohesive, pure modules (#1053) with NO change
// to any numeric result, ordering, threshold, activation, or the exported API.
// Every named export and constant the pre-split module exposed — public and the
// private `_`-prefixed test/consumer exports alike — is re-exported here, at the
// same identity where the value is a re-export, so every existing importer keeps
// working through this file unchanged:
//
//   - workoutAnalyticsActivations.js  tracked-span activation records (#893)
//   - workoutAnalyticsCheckIn.js      rep drop-off + session check-in detection
//   - workoutAnalyticsSummaries.js    signals / note analytics / weekly summary
//   - workoutAnalyticsOccurrences.js  PR-moment canonical occurrences (#577)
//
// `_occurrenceEntries` and `classifyExerciseSessions` are the parser's watermark
// primitives, re-exported straight from the parser analytics module (the same
// binding the pre-split file re-exported), NOT re-implemented here.
export { _occurrenceEntries, classifyExerciseSessions } from '../parser/analytics.js';

export {
  TRACKED_LIFT_WITNESS_SESSIONS,
  buildTrackedLiftActivation,
  resolveTrackedLiftAnchors,
  reconcileTrackedLiftActivations,
} from './workoutAnalyticsActivations.js';

export {
  computeRepDropOff,
  deriveRepDropOffFlags,
  SESSION_CHECKIN_REP_DROP_THRESHOLD,
  SESSION_CHECKIN_MIN_COLLAPSED_SETS,
  SESSION_CHECKIN_MIN_PRIOR_ENTRIES,
  SESSION_CHECKIN_SKIP_FLOOR,
  SESSION_CHECKIN_SKIP_MARGIN,
  SESSION_CHECKIN_MIN_SKIP_COLUMNS,
  deriveSessionCheckIn,
} from './workoutAnalyticsCheckIn.js';

export {
  deriveSignals,
  deriveWorkoutNoteAnalytics,
  deriveOverloadCounts,
  computeWeeklySummary,
  deriveCheckInHistory,
} from './workoutAnalyticsSummaries.js';

export { deriveTrackedPROccurrences } from './workoutAnalyticsOccurrences.js';
