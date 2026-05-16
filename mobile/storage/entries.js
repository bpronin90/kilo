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

export async function updateWeightEntry(id, weight_value) {
  const list = await readList(WEIGHT_KEY);
  const entry = list.find(e => e.id === id);
  if (!entry) return false;
  entry.weight_value = weight_value;
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
    raw_text,
    saved_at: existing ? existing.saved_at : now,
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
export async function migrateWorkoutNote() {
  const existing = await loadWorkoutNote();
  if (existing) return existing;
  const sessions = await readList(WORKOUT_KEY);
  if (!sessions.length) return null;
  const raw_text = sessions
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(session => {
      const lines = [`=== ${session.date} ===`];
      for (const item of (session.items || [])) {
        const setStr = (item.sets || [])
          .map(s => {
            if (s.weight_value != null && s.rep_count != null) return `${s.weight_value} ${s.rep_count}`;
            if (s.rep_count != null) return String(s.rep_count);
            if (s.duration_seconds != null) return `${s.duration_seconds}s`;
            return '';
          })
          .filter(Boolean)
          .join(', ');
        lines.push(setStr ? `${item.exercise_name} ${setStr}` : item.exercise_name);
        if (item.note_text) lines.push(`  ${item.note_text}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
  return saveWorkoutNote(raw_text);
}
