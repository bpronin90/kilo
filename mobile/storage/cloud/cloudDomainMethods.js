import * as Storage from '../entries';
import {
  SYNC_TABLES,
  stampWrite,
  stampTombstone,
  isTombstone,
  getClientId,
  enqueueDirty,
  getDirtyRecords,
} from '../syncQueue';

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

// Idempotent by construction (#696). The recovery operation journal replays
// this call until BOTH halves of the cloud deletion outcome are verified — the
// local tombstone and the durable pending-sync intent — which means a replay can
// arrive with the tombstone already written and only the enqueue missing (the
// queue-bookkeeping step failed, or a pass consumed it). Re-stamping an existing
// tombstone would slide its timestamp forward on every replay and make the row
// look newer than the one another device already accepted, so an existing
// tombstone is re-enqueued verbatim instead.
export async function deleteWorkoutNoteItem(id) {
  const list = await Storage.loadWorkoutNotesRaw();
  const note = list.find((n) => n.id === id);
  if (!note) return;
  if (isTombstone(note)) {
    await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, note);
    return;
  }
  const clientId = await getClientId();
  const tombstone = stampTombstone(note, clientId);
  const idx = list.findIndex((n) => n.id === id);
  list[idx] = tombstone;
  await Storage.replaceWorkoutNotesRaw(list);
  await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, tombstone);
}

// Cloud-mode deletion-outcome probe for the recovery operation journal (#696).
//
// Cloud mode never hard-removes: "deleted" means a local tombstone exists AND
// this device still holds durable intent to push it. Both are required, because
// a tombstone whose enqueue failed is a deletion that would silently never leave
// the device — exactly the half-committed outcome the journal exists to close.
//
// A note that is absent from the local cache entirely is reported as deleted
// with no queue requirement: there is no row left to push, and inventing one
// would resurrect a record the server already removed.
export async function loadWorkoutNoteDeletionState(id) {
  const list = await Storage.loadWorkoutNotesRaw();
  const note = list.find((n) => n?.id === id);
  if (!note) {
    return { exists: false, deleted: true, requiresQueue: false, queued: false };
  }
  const deleted = isTombstone(note);
  if (!deleted) {
    return { exists: true, deleted: false, requiresQueue: true, queued: false };
  }
  const dirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
  return {
    exists: true,
    deleted: true,
    requiresQueue: true,
    queued: dirty.some((record) => record?.id === id),
  };
}
