// Pure workout-parsing barrel (#1494). Re-exports only the workout parser
// modules, which have no React, unit-preference, or profile-storage
// dependency. Workout-only consumers import from here so loading the parser
// does not evaluate the preference/profile chain that parseWeightEntry's
// default-unit lookup (parser/weightEntry.js) pulls in.
export { parseWorkoutRow, parseHeaderDeclaration } from './workoutRow.js';
export { parseWorkoutNote, applyWeekSkipToText, MAX_RAW_TEXT_LENGTH } from './workoutNote.js';
export { buildSessionsFromNote, countWorkoutSessionsFromSections, countWorkoutSessions } from './sessions.js';
export { epleyPR, deriveWorkoutAnalytics, deriveTrackedPRs, deriveProgressionSignals, derivePerDaySignals } from './analytics.js';
export { normalizeExerciseKey } from './exerciseNames.js';
export { parseExerciseHeader, generateDeloadNote } from './deloadGenerator.js';
export { sessionDateMapFromNote, sessionsSinceLastDeload, weeksSinceLastDeload } from './deloadHistory.js';
export { parseWorkoutEntry } from './workoutEntry.js';
