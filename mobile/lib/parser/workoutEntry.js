import { parseWorkoutRow } from './workoutRow.js';

export function parseWorkoutEntry(items, workout_date) {
  const date = workout_date || new Date().toISOString().slice(0, 10);
  const parsedItems = [];
  const rowErrors = [];

  for (const { exerciseName, raw } of items) {
    const row = parseWorkoutRow(raw);
    if (row.blank || row.skipped) continue;
    // A bare integer with no note-level header declaration (#854/G1-p) is
    // never structured data; this structured-entry form has no header text
    // to declare against, so treat it the same as any other unrecognized row.
    if (!row.ok || row.preserved) {
      rowErrors.push({
        exerciseName,
        error: row.error || 'Enter reps as reps,reps or weight reps,reps',
        category: row.category || 'invalid_field_value',
      });
      continue;
    }
    parsedItems.push({
      exercise_name: exerciseName,
      result_kind: 'sets',
      note_text: null,
      position: parsedItems.length + 1,
      sets: row.sets,
    });
  }

  if (rowErrors.length > 0) {
    return { ok: false, error: rowErrors[0].error, category: rowErrors[0].category, rowErrors };
  }
  if (parsedItems.length === 0) {
    return { ok: false, error: 'Workout must include at least one completed exercise', category: 'structural_violation' };
  }
  return { ok: true, workout_date: date, items: parsedItems };
}
