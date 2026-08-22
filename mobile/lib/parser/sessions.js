import { parseWorkoutNote } from './workoutNote.js';

function _exercisesWithSessionEntries(sections) {
  return sections
    .flatMap(section => section.exercises)
    .filter(exercise => (exercise.session_entries || []).length > 0);
}

function _formatEntryCount(count) {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`;
}

// Positional history is only trustworthy when every participating exercise has
// an authored entry (a logged row or an explicit `-` skip) at every position.
// Keep this as structured evidence so the editor can name the affected
// exercises and positions instead of surfacing the old telemetry-only string.
export function deriveSessionAlignmentIssueFromSections(sections) {
  const exercises = _exercisesWithSessionEntries(sections || []);
  if (exercises.length < 2) return null;

  const counts = exercises.map(exercise => exercise.session_entries.length);
  const maxEntryCount = Math.max(...counts);
  const minEntryCount = Math.min(...counts);
  if (minEntryCount === maxEntryCount) return null;

  const affectedExercises = exercises.map(exercise => {
    const entryCount = exercise.session_entries.length;
    return {
      name: exercise.name,
      entryCount,
      missingSessionIndexes: Array.from(
        { length: maxEntryCount - entryCount },
        (_, index) => entryCount + index + 1
      ),
    };
  });
  const countSummary = affectedExercises
    .map(exercise => `${exercise.name} — ${_formatEntryCount(exercise.entryCount)}`)
    .join('; ');
  const missingSummary = affectedExercises
    .filter(exercise => exercise.missingSessionIndexes.length > 0)
    .map(exercise => (
      `${exercise.name} has no authored ${exercise.missingSessionIndexes.length === 1 ? 'entry' : 'entries'} `
      + `at ${exercise.missingSessionIndexes.length === 1 ? 'position' : 'positions'} `
      + exercise.missingSessionIndexes.join(', ')
    ))
    .join('; ');

  return {
    code: 'uneven_session_entries',
    minEntryCount,
    maxEntryCount,
    affectedExercises,
    message: `Uneven exercise histories do not line up: ${countSummary}. ${missingSummary}. `
      + 'Add a standalone "-" under an exercise for an intentional skip, or correct a missing or extra row.',
  };
}

export function deriveSessionAlignmentIssue(noteText) {
  const { sections } = parseWorkoutNote(noteText || '');
  return deriveSessionAlignmentIssueFromSections(sections);
}

export function buildSessionsFromNote(noteText) {
  const { sections } = parseWorkoutNote(noteText || '');

  const withEntries = _exercisesWithSessionEntries(sections);

  if (withEntries.length === 0) return { sessions: [], warnings: [] };

  const maxCount = Math.max(...withEntries.map(e => e.session_entries.length));
  const alignmentIssue = deriveSessionAlignmentIssueFromSections(sections);
  const warnings = alignmentIssue ? [alignmentIssue.message] : [];

  const sessions = Array.from({ length: maxCount }, (_, i) => ({
    session_index: i + 1,
    entries: withEntries.map(ex => ({
      exercise_name: ex.name,
      entry: i < ex.session_entries.length
        ? ex.session_entries[i]
        // An absent authored row is not an intentional skip. Mark it missing
        // so no consumer can silently turn uneven history into a synthetic
        // user action; an authored standalone `-` still arrives as skipped.
        : { missing: true, skipped: false, raw: null, sets: [] },
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
