import { parseWorkoutNote } from './workoutNote.js';

export function buildSessionsFromNote(noteText) {
  const { sections } = parseWorkoutNote(noteText || '');

  const allExercises = sections.flatMap(s => s.exercises);
  const withEntries = allExercises.filter(e => e.session_entries.length > 0);

  if (withEntries.length === 0) return { sessions: [], warnings: [] };

  const counts = withEntries.map(e => e.session_entries.length);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);

  const warnings = [];
  if (minCount !== maxCount) {
    const details = withEntries.map(e => `${e.name} (${e.session_entries.length})`).join(', ');
    warnings.push(
      `Uneven entry counts — ${details}. Check your note for missing or extra entries and correct before logging.`
    );
  }

  const sessions = Array.from({ length: maxCount }, (_, i) => ({
    session_index: i + 1,
    entries: withEntries.map(ex => ({
      exercise_name: ex.name,
      entry: i < ex.session_entries.length
        ? ex.session_entries[i]
        : { skipped: true, raw: null, sets: [] },
    })),
  }));

  return { sessions, warnings };
}

export function countWorkoutSessionsFromSections(sections) {
  const byDay = new Map();
  for (const section of sections) {
    const day = section.heading ?? '__no_day__';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(section);
  }
  let max = 0;
  for (const daySections of byDay.values()) {
    let dayMax = 0;
    for (const section of daySections) {
      for (const ex of section.exercises) {
        const nonSkipped = (ex.session_entries || []).filter(e => !e.skipped).length;
        const count = Math.max((ex.rows || []).length, nonSkipped);
        if (count > dayMax) dayMax = count;
      }
    }
    if (dayMax > max) max = dayMax;
  }
  return max;
}

export function countWorkoutSessions(noteText) {
  const { sections } = parseWorkoutNote(noteText || '');
  return countWorkoutSessionsFromSections(sections);
}
