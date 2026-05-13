import AsyncStorage from '@react-native-async-storage/async-storage';

const WEIGHT_KEY = 'kilo_weight_entries';
const WORKOUT_KEY = 'kilo_workout_sessions';

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
