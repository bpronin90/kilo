import AsyncStorage from '@react-native-async-storage/async-storage';

export function localDateToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function readList(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function writeList(key, list) {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}
