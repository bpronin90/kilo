import AsyncStorage from '@react-native-async-storage/async-storage';
import { WEIGHT_GOAL_KEY } from './keys';

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
