import * as Storage from '../entries';
import { SYNC_TABLES, stampWrite, stampTombstone, isTombstone, getClientId, enqueueDirty } from '../syncQueue';

function localDateToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── weight entries ──────────────────────────────────────────────────────────

export async function loadWeightEntries() {
  const list = await Storage.loadWeightEntriesRaw();
  return list
    .filter((e) => !isTombstone(e))
    .sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''));
}

export async function saveWeightEntry(entry) {
  const clientId = await getClientId();
  const stamped = stampWrite(entry, clientId);
  const list = await Storage.loadWeightEntriesRaw();
  const idx = list.findIndex((e) => e.id === stamped.id);
  if (idx >= 0) list[idx] = stamped;
  else list.push(stamped);
  await Storage.replaceWeightEntriesRaw(list);
  await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, stamped);
}

export async function updateWeightEntry(id, weight_value, note, date) {
  const list = await Storage.loadWeightEntriesRaw();
  const entry = list.find((e) => e.id === id);
  if (!entry || isTombstone(entry)) return false;
  entry.weight_value = weight_value;
  entry.note = note;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= localDateToday()) {
    entry.logged_at = date + (entry.logged_at || '').slice(10);
    entry.date = date;
  }
  const clientId = await getClientId();
  const stamped = stampWrite(entry, clientId);
  const idx = list.findIndex((e) => e.id === id);
  list[idx] = stamped;
  await Storage.replaceWeightEntriesRaw(list);
  await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, stamped);
  return true;
}

export async function deleteWeightEntry(id) {
  const list = await Storage.loadWeightEntriesRaw();
  const entry = list.find((e) => e.id === id);
  if (!entry) return;
  const clientId = await getClientId();
  const tombstone = stampTombstone(entry, clientId);
  const idx = list.findIndex((e) => e.id === id);
  list[idx] = tombstone;
  await Storage.replaceWeightEntriesRaw(list);
  await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, tombstone);
}

// ── workout notes ───────────────────────────────────────────────────────────

export async function loadWorkoutNotes() {
  const list = await Storage.loadWorkoutNotesRaw();
  return list.filter((n) => !isTombstone(n));
}

export async function saveWorkoutNoteItem(note) {
  const clientId = await getClientId();
  const stamped = stampWrite(note, clientId);
  const list = await Storage.loadWorkoutNotesRaw();
  const idx = list.findIndex((n) => n.id === stamped.id);
  if (idx >= 0) list[idx] = stamped;
  else list.push(stamped);
  await Storage.replaceWorkoutNotesRaw(list);
  await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, stamped);
}

export async function deleteWorkoutNoteItem(id) {
  const list = await Storage.loadWorkoutNotesRaw();
  const note = list.find((n) => n.id === id);
  if (!note) return;
  const clientId = await getClientId();
  const tombstone = stampTombstone(note, clientId);
  const idx = list.findIndex((n) => n.id === id);
  list[idx] = tombstone;
  await Storage.replaceWorkoutNotesRaw(list);
  await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, tombstone);
}
