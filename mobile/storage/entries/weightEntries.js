import { WEIGHT_KEY } from './keys';
import { readList, writeList, localDateToday } from './jsonStorage';

export async function loadWeightEntries() {
  const list = await readList(WEIGHT_KEY);
  return list.sort((a, b) => b.logged_at.localeCompare(a.logged_at));
}

// Raw cache accessors for the cloud sync engine (Phase 4 / Task 11). Unlike
// loadWeightEntries(), these expose the unfiltered, unsorted backing list
// (including delete tombstones and sync metadata) so the sync loop can merge,
// push, and advance cursors over the full record set. Local mode never uses
// these; they exist only for the cloud adapter / sync engine.
export async function loadWeightEntriesRaw() {
  return readList(WEIGHT_KEY);
}

export async function replaceWeightEntriesRaw(list) {
  await writeList(WEIGHT_KEY, Array.isArray(list) ? list : []);
}

export async function saveWeightEntry(entry) {
  const list = await readList(WEIGHT_KEY);
  list.push(entry);
  await writeList(WEIGHT_KEY, list);
}

export async function deleteWeightEntry(id) {
  const list = await readList(WEIGHT_KEY);
  await writeList(WEIGHT_KEY, list.filter(e => e.id !== id));
}

export async function updateWeightEntry(id, weight_value, note, date) {
  const list = await readList(WEIGHT_KEY);
  const entry = list.find(e => e.id === id);
  if (!entry) return false;
  entry.weight_value = weight_value;
  entry.note = note;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    if (date <= localDateToday()) {
      entry.logged_at = date + entry.logged_at.slice(10);
      entry.date = date;
    }
  }
  await writeList(WEIGHT_KEY, list);
  return true;
}
