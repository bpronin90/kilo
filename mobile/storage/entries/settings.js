import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FATIGUE_MULTIPLIER_KEY,
  WEIGHT_DATE_EDIT_KEY,
  DELOAD_DATE_EDIT_KEY,
  FATIGUE_TRACKING_KEY,
  DELOAD_MODE_KEY,
  TRACKED_LIFTS_KEY,
  COLLAPSED_STATE_KEY,
} from './keys';

export async function loadTrackedLifts() {
  try {
    const raw = await AsyncStorage.getItem(TRACKED_LIFTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveTrackedLifts(map) {
  await AsyncStorage.setItem(TRACKED_LIFTS_KEY, JSON.stringify(map));
}

export async function loadWorkoutCollapsed() {
  try {
    const raw = await AsyncStorage.getItem(COLLAPSED_STATE_KEY);
    return raw ? JSON.parse(raw) : false;
  } catch {
    return false;
  }
}

export async function saveWorkoutCollapsed(isCollapsed) {
  await AsyncStorage.setItem(COLLAPSED_STATE_KEY, JSON.stringify(isCollapsed));
}

export async function loadFatigueMultiplier() {
  try {
    const raw = await AsyncStorage.getItem(FATIGUE_MULTIPLIER_KEY);
    return raw ? JSON.parse(raw) : 1.07;
  } catch {
    return 1.07;
  }
}

export async function saveFatigueMultiplier(multiplier) {
  await AsyncStorage.setItem(FATIGUE_MULTIPLIER_KEY, JSON.stringify(multiplier));
}

export async function loadWeightDateEditEnabled() {
  try {
    const raw = await AsyncStorage.getItem(WEIGHT_DATE_EDIT_KEY);
    return raw ? JSON.parse(raw) : false;
  } catch {
    return false;
  }
}

export async function saveWeightDateEditEnabled(enabled) {
  await AsyncStorage.setItem(WEIGHT_DATE_EDIT_KEY, JSON.stringify(enabled));
}

export async function loadDeloadDateEditEnabled() {
  try {
    const raw = await AsyncStorage.getItem(DELOAD_DATE_EDIT_KEY);
    return raw ? JSON.parse(raw) : false;
  } catch {
    return false;
  }
}

export async function saveDeloadDateEditEnabled(enabled) {
  await AsyncStorage.setItem(DELOAD_DATE_EDIT_KEY, JSON.stringify(enabled));
}

export async function loadFatigueTrackingEnabled() {
  try {
    const raw = await AsyncStorage.getItem(FATIGUE_TRACKING_KEY);
    return raw == null ? true : JSON.parse(raw);
  } catch {
    return true;
  }
}

export async function saveFatigueTrackingEnabled(enabled) {
  await AsyncStorage.setItem(FATIGUE_TRACKING_KEY, JSON.stringify(enabled));
}

export async function loadDeloadModeEnabled() {
  try {
    const raw = await AsyncStorage.getItem(DELOAD_MODE_KEY);
    return raw == null ? true : JSON.parse(raw);
  } catch {
    return true;
  }
}

export async function saveDeloadModeEnabled(enabled) {
  await AsyncStorage.setItem(DELOAD_MODE_KEY, JSON.stringify(enabled));
}
