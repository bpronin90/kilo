import AsyncStorage from '@react-native-async-storage/async-storage';

const WEIGHT_KEY = 'kilo_weight_entries';
const WORKOUT_KEY = 'kilo_workout_sessions';
const WORKOUT_NOTE_KEY = 'kilo_workout_note';

async function readList(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeList(key, list) {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}

// Weight entries

export async function loadWeightEntries() {
  const list = await readList(WEIGHT_KEY);
  return list.sort((a, b) => b.logged_at.localeCompare(a.logged_at));
}

export async function saveWeightEntry(entry) {
  const list = await readList(WEIGHT_KEY);
  list.push(entry);
  await writeList(WEIGHT_KEY, list);
}

export async function deleteWeightEntry(id) {
  const list = await readList(WEIGHT_KEY);
  await writeList(WEIGHT_KEY, list.filter(e => e.id !== id));
}

export async function updateWeightEntry(id, weight_value, note) {
  const list = await readList(WEIGHT_KEY);
  const entry = list.find(e => e.id === id);
  if (!entry) return false;
  entry.weight_value = weight_value;
  entry.note = note;
  await writeList(WEIGHT_KEY, list);
  return true;
}

// Workout sessions

export async function loadWorkoutSessions() {
  const list = await readList(WORKOUT_KEY);
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export async function saveWorkoutSession(session) {
  const list = await readList(WORKOUT_KEY);
  list.push(session);
  await writeList(WORKOUT_KEY, list);
}

export async function deleteWorkoutSession(id) {
  const list = await readList(WORKOUT_KEY);
  await writeList(WORKOUT_KEY, list.filter(e => e.id !== id));
}

// Workout routine note (single canonical document)

export async function loadWorkoutNote() {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_NOTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveWorkoutNote(raw_text) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    raw_text,
    saved_at: existing ? existing.saved_at : now,
    updated_at: now,
    tracked_exercises: existing?.tracked_exercises || [],
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function saveTrackedExercises(tracked_exercises) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    tracked_exercises,
    updated_at: now,
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function saveOneKExercises(one_k_exercises) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    one_k_exercises,
    updated_at: now,
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function clearWorkoutNote() {
  await AsyncStorage.removeItem(WORKOUT_NOTE_KEY);
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

  // Collect exercise names in first-appearance order across all sessions.
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

  // Build a keyed lookup: exerciseName → per-session entry descriptors.
  // Each descriptor is { skip: true, comments: [] } or { skip: false, row, comments }.
  const entriesByExercise = new Map();
  for (const name of exerciseOrder) {
    entriesByExercise.set(name, sorted.map(session => {
      const item = (session.items || []).find(i => i.exercise_name === name);
      if (!item) return { skip: true, comments: [] };

      const weightGroups = [];
      const comments = [];
      for (const s of (item.sets || [])) {
        if (s.weight_value != null && s.rep_count != null) {
          const prev = weightGroups[weightGroups.length - 1];
          if (prev && prev.weight === s.weight_value) {
            prev.reps.push(s.rep_count);
          } else {
            weightGroups.push({ weight: s.weight_value, reps: [s.rep_count] });
          }
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
          if (parts.length) comments.push(`-- ${parts.join(' ')}`);
        }
      }
      if (item.note_text) comments.push(`-- ${item.note_text}`);

      if (weightGroups.length === 0) return { skip: true, comments };
      const row = weightGroups
        .map(({ weight, reps }) => `${weight} ${reps.join(',')}`)
        .join(' ');
      return { skip: false, row, comments };
    }));
  }

  const lines = [`-- ${sorted.map(s => s.date).join(', ')}`];
  for (const name of exerciseOrder) {
    lines.push(`-${name}`);
    for (const entry of entriesByExercise.get(name)) {
      for (const c of entry.comments) lines.push(c);
      lines.push(entry.skip ? '-' : `- ${entry.row}`);
    }
  }

  return saveWorkoutNote(lines.join('\n'));
}
