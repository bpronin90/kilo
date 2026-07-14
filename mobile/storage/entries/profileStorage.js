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

// Merge a partial patch into the stored profile, preserving every field the
// patch does not mention (issue #489).
//
// saveUserProfile REPLACES the whole record. The ongoing cloud sync only carries
// `display_name` and `unit_system`, while the SAME local record also holds the
// device-local demographics `date_of_birth`, `sex`, `height_cm`, and
// `activity_level` — which are deliberately NOT synced (that is issue #476, on
// hold pending a Play Data Safety / DPA / privacy-policy update). Applying a
// pulled cloud profile with saveUserProfile would therefore silently delete the
// user's demographics off the device. Sync must merge, never replace.
export async function mergeUserProfile(patch) {
  const existing = await loadUserProfile();
  const record = {
    ...(existing || {}),
    ...(patch || {}),
    saved_at: new Date().toISOString(),
  };
  await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(record));
  return record;
}

export async function clearUserProfile() {
  await AsyncStorage.removeItem(USER_PROFILE_KEY);
}
