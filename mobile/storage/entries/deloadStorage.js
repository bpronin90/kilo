import { secureStorage as AsyncStorage } from '../secureStorage';
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

export async function saveDeloadNote(raw_text, working_context) {
  const now = new Date().toISOString();
  const existing = await loadDeloadNote();
  const note = {
    raw_text,
    saved_at: existing ? existing.saved_at : now,
    updated_at: now,
    // #989: the frozen generation-time working-weight snapshot lives beside the
    // active deload. It is passed only by the generate/regenerate path; a plain
    // save (a manual text edit) omits it and MUST keep the existing snapshot, so
    // editing the generated text never recomputes the baseline.
    working_context:
      working_context !== undefined
        ? working_context
        : (existing?.working_context ?? null),
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
  // #989: working_context is a DEVICE-LOCAL generation artifact, not part of the
  // deload-note cloud projection. This path only runs when a remote deload-note
  // write wins the merge (sync compares normalized timestamps, so a pure format
  // round-trip never gets here). The winning note is authoritatively not the one
  // this device generated — identical raw_text is not proof of identity — so the
  // local snapshot cannot be assumed to describe it and is dropped. The
  // generating device keeps its snapshot because its own row wins and this path
  // is not taken there.
  const note = {
    raw_text,
    saved_at: saved_at ?? null,
    updated_at: updated_at ?? null,
    working_context: null,
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
