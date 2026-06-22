import AsyncStorage from '@react-native-async-storage/async-storage';
import { USER_PROFILE_KEY } from './keys';

export async function loadUserProfile() {
  try {
    const raw = await AsyncStorage.getItem(USER_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveUserProfile(profile) {
  const record = { ...profile, saved_at: new Date().toISOString() };
  await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(record));
  return record;
}

export async function clearUserProfile() {
  await AsyncStorage.removeItem(USER_PROFILE_KEY);
}
