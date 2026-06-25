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
