import AsyncStorage from '@react-native-async-storage/async-storage';

// Device preference only: deliberately outside the entries/settings backup,
// encryption and cloud-sync domains. Active step is never persisted.
export const WELCOME_WALKTHROUGH_KEY = 'kilo:welcome-walkthrough:v1';
const DISMISSED = '{"version":1,"dismissed":true}';

export async function readWelcomeWalkthrough() {
  try {
    const raw = await AsyncStorage.getItem(WELCOME_WALKTHROUGH_KEY);
    if (raw === null) return 'missing';
    const value = JSON.parse(raw);
    return value?.version === 1 && value?.dismissed === true ? 'dismissed' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function dismissWelcomeWalkthrough() {
  try {
    await AsyncStorage.setItem(WELCOME_WALKTHROUGH_KEY, DISMISSED);
    return true;
  } catch {
    return false;
  }
}
