// Public compatibility barrel for workout-note parsing and text mutation.
//
// The implementation was split (#1057) into three domain sub-modules to keep
// each file well under the 600-line ceiling with byte-for-byte equivalent
// observable results:
//   - workoutNoteCore.js      parsing (parseWorkoutNote, MAX_RAW_TEXT_LENGTH)
//   - workoutNoteErrors.js    imported-record validation / error surface
//   - workoutNoteMutations.js week-skip + progression-insertion text transforms
//
// This module re-exports the identical public surface consumers depend on, so
// `lib/parser/workoutNote` remains the single stable entry point (and the
// `lib/parser` barrel keeps re-exporting from it unchanged).
export { parseWorkoutNote, MAX_RAW_TEXT_LENGTH } from './workoutNoteCore.js';
export {
  applyWeekSkipToText,
  removeWeekSkipFromText,
  applyProgressionSuggestionToNoteText,
} from './workoutNoteMutations.js';
