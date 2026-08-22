import { parseWorkoutRow } from './workoutRow.js';

// `unit` ('lb' | 'kg', default 'lb') is the entry unit bare weight tokens are
// typed in (#852). Defaults to 'lb' rather than the live selected preference
// to match parseWorkoutRow/parseWorkoutNote — see the module comment in
// workoutRow.js for why. A caller wiring this to interactive entry should
// pass getWeightUnit() explicitly.
export function parseWorkoutEntry(items, workout_date, unit = 'lb') {
  const date = workout_date || new Date().toISOString().slice(0, 10);
  const parsedItems = [];
  const rowErrors = [];

  for (const { exerciseName, raw } of items) {
    const row = parseWorkoutRow(raw, unit);
    if (row.blank || row.skipped) continue;
    if (!row.ok) {
      rowErrors.push({ exerciseName, error: row.error, category: row.category });
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
