import AsyncStorage from '@react-native-async-storage/async-storage';
import { WORKOUT_DELOAD_NOTE_KEY, WORKOUT_DELOAD_HISTORY_KEY } from './keys';
import { readList, writeList } from './jsonStorage';

// ── deload note (independent of routine note) ─────────────────────────────────

export async function loadDeloadNote() {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_DELOAD_NOTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveDeloadNote(raw_text) {
  const now = new Date().toISOString();
  const existing = await loadDeloadNote();
  const note = {
    raw_text,
    saved_at: existing ? existing.saved_at : now,
    updated_at: now,
  };
  await AsyncStorage.setItem(WORKOUT_DELOAD_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function clearDeloadNote() {
  await AsyncStorage.removeItem(WORKOUT_DELOAD_NOTE_KEY);
}

// Apply an active-deload note pulled from cloud sync (issue #498).
//
// Unlike saveDeloadNote, this does NOT re-stamp saved_at/updated_at with `now()`:
// it writes the winning row's own timestamps verbatim. That is what keeps
// cross-device sync from ping-ponging — if applying a pulled winner minted a fresh
// updated_at, the next diff would see a "change", push it back, and the two devices
// would rewrite the row forever. The health-value timestamps here are content, not
// sync metadata; the sync engine stamps its own updated_at separately.
export async function applyDeloadNoteFromSync({ raw_text, saved_at, updated_at }) {
  const note = {
    raw_text,
    saved_at: saved_at ?? null,
    updated_at: updated_at ?? null,
  };
  await AsyncStorage.setItem(WORKOUT_DELOAD_NOTE_KEY, JSON.stringify(note));
  return note;
}

// ── deload history ─────────────────────────────────────────────────────────────

export async function loadDeloadHistory() {
  return readList(WORKOUT_DELOAD_HISTORY_KEY);
}

export async function appendDeloadHistory(record) {
  const list = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  list.push(record);
  await writeList(WORKOUT_DELOAD_HISTORY_KEY, list);
}

export async function deleteDeloadHistory(id) {
  const list = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  const filtered = list.filter(r => r.id !== id);
  await writeList(WORKOUT_DELOAD_HISTORY_KEY, filtered);
  return filtered;
}

export async function updateDeloadHistory(id, patch) {
  const list = await readList(WORKOUT_DELOAD_HISTORY_KEY);
  const idx = list.findIndex(r => r.id === id);
  if (idx < 0) return false;
  list[idx] = { ...list[idx], ...patch };
  await writeList(WORKOUT_DELOAD_HISTORY_KEY, list);
  return list[idx];
}
