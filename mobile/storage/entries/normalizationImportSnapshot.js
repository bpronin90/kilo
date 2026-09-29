import { secureStorage as AsyncStorage } from '../secureStorage';
import { NORMALIZATION_IMPORT_SNAPSHOT_KEY } from './keys';

function validNote(note) {
  return note && typeof note.id === 'string' && typeof note.title === 'string' && typeof note.raw_text === 'string';
}

export function normalizeNormalizationImportSnapshot(value) {
  if (!value || !validNote(value.authority) || !Array.isArray(value.targets) || !value.targets.every(validNote)) return null;
  return { version: Number.isInteger(value.version) ? value.version : 1, authority: value.authority, targets: value.targets };
}

export async function saveNormalizationImportSnapshot(snapshot) {
  const normalized = normalizeNormalizationImportSnapshot(snapshot);
  if (!normalized) throw new Error('Invalid normalization import snapshot.');
  await AsyncStorage.setItem(NORMALIZATION_IMPORT_SNAPSHOT_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function loadNormalizationImportSnapshot() {
  const raw = await AsyncStorage.getItem(NORMALIZATION_IMPORT_SNAPSHOT_KEY);
  if (!raw) return null;
  try { return normalizeNormalizationImportSnapshot(JSON.parse(raw)); } catch { return null; }
}

export function clearNormalizationImportSnapshot() {
  return AsyncStorage.removeItem(NORMALIZATION_IMPORT_SNAPSHOT_KEY);
}
