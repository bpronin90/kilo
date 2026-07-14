import AsyncStorage from '@react-native-async-storage/async-storage';
import { WEIGHT_GOAL_KEY } from './keys';

const ARCHIVED_WEIGHT_GOALS_KEY = 'kilo_archived_weight_goals';

export async function loadWeightGoal() {
  try {
    const raw = await AsyncStorage.getItem(WEIGHT_GOAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveWeightGoal(goal) {
  const record = { ...goal, saved_at: new Date().toISOString() };
  await AsyncStorage.setItem(WEIGHT_GOAL_KEY, JSON.stringify(record));
  return record;
}

export async function clearWeightGoal() {
  await AsyncStorage.removeItem(WEIGHT_GOAL_KEY);
}

// Write the active weight goal verbatim, WITHOUT re-stamping `saved_at`
// (issue #489).
//
// saveWeightGoal always overwrites `saved_at` with `now`. The cloud sync path
// compares the local goal against the last-synced snapshot to detect local
// edits, so re-stamping `saved_at` every time a pulled cloud goal is applied
// would make the goal look permanently dirty and ping-pong between devices
// forever. The sync engine applies merged goals through this raw writer instead.
export async function replaceWeightGoalRaw(goal) {
  await AsyncStorage.setItem(WEIGHT_GOAL_KEY, JSON.stringify(goal));
}

export async function loadArchivedWeightGoals() {
  try {
    const raw = await AsyncStorage.getItem(ARCHIVED_WEIGHT_GOALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveArchivedWeightGoal(archivedGoal) {
  const list = await loadArchivedWeightGoals();
  list.push(archivedGoal);
  await AsyncStorage.setItem(ARCHIVED_WEIGHT_GOALS_KEY, JSON.stringify(list));
  return archivedGoal;
}

export async function clearArchivedWeightGoals() {
  await AsyncStorage.removeItem(ARCHIVED_WEIGHT_GOALS_KEY);
}

// Raw list access for the sync engine (mirrors weight-entries pattern).
// loadArchivedWeightGoalsRaw returns all records including sync-stamped fields.
// replaceArchivedWeightGoalsRaw overwrites the full list (used by syncTable
// writeLocal after a pull+merge).
export async function loadArchivedWeightGoalsRaw() {
  try {
    const raw = await AsyncStorage.getItem(ARCHIVED_WEIGHT_GOALS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function replaceArchivedWeightGoalsRaw(list) {
  await AsyncStorage.setItem(ARCHIVED_WEIGHT_GOALS_KEY, JSON.stringify(list));
}
