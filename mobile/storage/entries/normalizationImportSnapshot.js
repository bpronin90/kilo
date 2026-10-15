import { secureStorage as AsyncStorage } from '../secureStorage';
import { NORMALIZATION_IMPORT_SNAPSHOT_KEY } from './keys';
import { NORMALIZATION_PROTOCOL } from '../../lib/interoperability/normalizationHeaderCatalog';

function validNote(note) {
  return note && typeof note.id === 'string' && typeof note.title === 'string' && typeof note.raw_text === 'string';
}

// Rebuilds the compact catalog (#1386) with a fixed key order, or null when
// its shape isn't exactly what a capture writes.
function normalizeCatalog(value, targetIds) {
  if (!value || !Array.isArray(value.names) || !value.names.every(name => typeof name === 'string') || !Array.isArray(value.headers)) return null;
  const refs = new Set();
  const headers = [];
  for (const header of value.headers) {
    if (!header || typeof header.raw !== 'string' || !/^H[1-9][0-9]*$/.test(header.ref) || refs.has(header.ref) || !Array.isArray(header.occurrences) || !header.occurrences.length) return null;
    const occurrences = header.occurrences.map(at => (at && targetIds.has(at.noteId) && Number.isInteger(at.line) && at.line >= 0 ? { noteId: at.noteId, line: at.line } : null));
    if (occurrences.includes(null)) return null;
    refs.add(header.ref);
    headers.push({ ref: header.ref, raw: header.raw, occurrences });
  }
  return { names: [...value.names], headers };
}

// A snapshot without the compact-protocol discriminator is a saved full-note
// prompt from before #1386. It is kept readable (flagged `legacy`) so the user
// can discard it explicitly, but it is never routed through the compact reply
// parser. `version` stays the capture-identity counter, not a protocol marker.
export function normalizeNormalizationImportSnapshot(value) {
  if (!value || !validNote(value.authority) || !Array.isArray(value.targets) || !value.targets.every(validNote)) return null;
  const version = Number.isInteger(value.version) ? value.version : 1;
  if (value.protocol !== NORMALIZATION_PROTOCOL) return { version, legacy: true, authority: value.authority, targets: value.targets };
  const catalog = normalizeCatalog(value.catalog, new Set(value.targets.map(target => target.id)));
  if (!catalog) return null;
  return { version, protocol: NORMALIZATION_PROTOCOL, authority: value.authority, targets: value.targets, catalog };
}

export async function saveNormalizationImportSnapshot(snapshot) {
  const normalized = normalizeNormalizationImportSnapshot(snapshot);
  // New captures are always compact; a legacy shape is never written back.
  if (!normalized || normalized.legacy) throw new Error('Invalid normalization import snapshot.');
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
