import AsyncStorage from '@react-native-async-storage/async-storage';
import { WORKOUT_KEY, WORKOUT_NOTES_KEY, CURRENT_WORKOUT_ID_KEY } from './keys';
import { readList, writeList } from './jsonStorage';
import {
  loadCurrentWorkoutId,
  loadWorkoutNote,
  saveWorkoutNote,
} from './workoutNotes';

// One-time migration: convert the legacy single workout note (kilo_workout_note) into
// the first entry in the multi-note notebook (kilo_workout_notes), marked as current.
// No-op if the notebook already contains entries.
// Returns the notebook list after migration (empty array if nothing to migrate).
export async function migrateToNotebook() {
  const existing = await readList(WORKOUT_NOTES_KEY);

  if (existing.length > 0) {
    const needsNormalization = existing.some(n => !('isCurrent' in n));
    if (!needsNormalization) return existing;

    const currentId = await loadCurrentWorkoutId();
    const normalized = existing.map(n => {
      const base = { isCurrent: false, ...n };
      if (!('isCurrent' in n) && currentId != null && n.id === currentId) {
        base.isCurrent = true;
      }
      return base;
    });
    await writeList(WORKOUT_NOTES_KEY, normalized);
    return normalized;
  }

  const legacyNote = await loadWorkoutNote();
  if (!legacyNote) return [];

  const now = new Date().toISOString();
  const item = {
    id: `wn_${now.slice(0, 10)}_${Date.now()}`,
    title: 'Routine 1',
    raw_text: legacyNote.raw_text || '',
    saved_at: legacyNote.saved_at || now,
    updated_at: legacyNote.updated_at || now,
    tracked_exercises: legacyNote.tracked_exercises || [],
    one_k_exercises: legacyNote.one_k_exercises || null,
    isCurrent: true,
  };

  await writeList(WORKOUT_NOTES_KEY, [item]);
  await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(item.id));

  return [item];
}

// One-time migration: synthesize a raw note from legacy structured sessions.
// No-op if the note already exists or there are no sessions to migrate.
//
// Output format uses cross-session "- entry" alignment so buildSessionsFromNote
// correctly counts sessions and HomeScreen/StatsScreen volume is accurate:
//
//   -- date1, date2      (date comment — preserved in raw_text, dropped by parser)
//   -ExerciseName
//   - 225 5,5,5          (parseable session entry for session 1)
//   - 230 5,5,5          (parseable session entry for session 2)
//   -OtherExercise
//   -                    (skip slot: exercise absent from session 1)
//   - 135 8,8,8
//
// Non-weight set fields (assistance, duration, notes) are emitted as -- comment
// lines inside the exercise block so raw_text retains the original data.
export async function migrateWorkoutNote() {
  const existing = await loadWorkoutNote();
  if (existing) return existing;

  const sessions = await readList(WORKOUT_KEY);
  if (!sessions.length) return null;

  const sorted = sessions.slice().sort((a, b) => a.date.localeCompare(b.date));

  const exerciseOrder = [];
  const seen = new Set();
  for (const session of sorted) {
    for (const item of (session.items || [])) {
      if (!seen.has(item.exercise_name)) {
        seen.add(item.exercise_name);
        exerciseOrder.push(item.exercise_name);
      }
    }
  }

  const entriesByExercise = new Map();
  for (const name of exerciseOrder) {
    entriesByExercise.set(name, sorted.map(session => {
      const item = (session.items || []).find(i => i.exercise_name === name);
      if (!item) return { kind: 'skip' };

      const weightGroups = [];
      const extraParts = [];

      for (const s of (item.sets || [])) {
        if (s.weight_value != null && s.rep_count != null) {
          const prev = weightGroups[weightGroups.length - 1];
          if (prev && prev.weight === s.weight_value) {
            prev.reps.push(s.rep_count);
          } else {
            weightGroups.push({ weight: s.weight_value, reps: [s.rep_count] });
          }
          if (s.note_text) extraParts.push(`[${s.note_text}]`);
        } else {
          const parts = [];
          if (s.assistance_value != null) {
            parts.push(s.assistance_unit
              ? `assist:${s.assistance_value} ${s.assistance_unit}`
              : `assist:${s.assistance_value}`);
          }
          if (s.rep_count != null) parts.push(`×${s.rep_count}`);
          if (s.duration_seconds != null) parts.push(`${s.duration_seconds}s`);
          if (s.note_text) parts.push(`[${s.note_text}]`);
          if (parts.length) extraParts.push(parts.join(' '));
        }
      }
      if (item.note_text) extraParts.push(item.note_text);

      if (weightGroups.length > 0) {
        const row = weightGroups
          .map(({ weight, reps }) => `${weight} ${reps.join(',')}`)
          .join(' ');
        const comments = extraParts.length > 0 ? [`-- ${extraParts.join(', ')}`] : [];
        return { kind: 'weight', row, comments };
      }
      if (extraParts.length > 0) {
        return { kind: 'nonweight', text: extraParts.join(', ') };
      }
      return { kind: 'skip' };
    }));
  }

  const lines = [`-- ${sorted.map(s => s.date).join(', ')}`];
  for (const name of exerciseOrder) {
    lines.push(`-${name}`);
    for (const entry of entriesByExercise.get(name)) {
      if (entry.kind === 'weight') {
        lines.push(`- ${entry.row}`);
        for (const c of entry.comments) lines.push(c);
      } else if (entry.kind === 'nonweight') {
        lines.push(`- ${entry.text}`);
      } else {
        lines.push('-');
      }
    }
  }

  return saveWorkoutNote(lines.join('\n'));
}
