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
// An ABSENT note is the local→cloud transition case, and it is deliberately NOT
// treated as a finished cloud deletion. A journaled linked-note deletion can
// hard-delete the note while the device is in local mode, be interrupted before
// verification, and only then enter cloud mode. Local absence says nothing about
// the server: the row may still be live there and would return on the next pull.
// So absence still reports `requiresQueue: true`, which keeps the operation
// pending until `ensureWorkoutNoteDeleted` below has reconstructed the tombstone
// and enqueued it. Only durable pending-sync intent — never local absence — can
// verify a cloud-mode deletion.
export async function loadWorkoutNoteDeletionState(id) {
  const list = await Storage.loadWorkoutNotesRaw();
  const note = list.find((n) => n?.id === id);
  const dirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
  const queued = dirty.some((record) => record?.id === id && isTombstone(record));
  if (!note) {
    return { exists: false, deleted: true, requiresQueue: true, queued };
  }
  const deleted = isTombstone(note);
  if (!deleted) {
    return { exists: true, deleted: false, requiresQueue: true, queued: false };
  }
  return { exists: true, deleted: true, requiresQueue: true, queued };
}

// Idempotent cloud-mode deletion used by the recovery operation journal's replay
// (#696). Unlike deleteWorkoutNoteItem it can also act on a note that is already
// ABSENT locally, which is the state a local-mode hard-delete leaves behind when
// the device switches to cloud mode mid-operation.
//
// Three cases, all converging on "local tombstone present AND queued":
//
//   live row     — stamp a tombstone, persist it, enqueue it (the ordinary path);
//   tombstoned   — re-enqueue verbatim, never re-stamped, so replay cannot slide
//                  the timestamp forward past a copy another device accepted;
//   absent       — reconstruct a minimal tombstone from the journal's own
//                  recorded id and requested timestamp and persist + enqueue it,
//                  so the deletion the user asked for actually reaches the
//                  server instead of being silently dropped at the mode switch.
//
// The reconstructed row carries only the id and the tombstone timestamps. It
// needs no other field: a tombstone is a deletion marker, every reader filters
// it out, and the journal never stored the note's text to restore anyway.
export async function ensureWorkoutNoteDeleted(id, { deletedAt = null } = {}) {
  const list = await Storage.loadWorkoutNotesRaw();
  const note = list.find((n) => n?.id === id);
  const clientId = await getClientId();

  if (note && isTombstone(note)) {
    await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, note);
    return;
  }

  const base = note || { id, saved_at: deletedAt || undefined };
  const tombstone = deletedAt
    ? stampTombstone(base, clientId, deletedAt)
    : stampTombstone(base, clientId);
  const next = note
    ? list.map((n) => (n?.id === id ? tombstone : n))
    : [...list, tombstone];
  await Storage.replaceWorkoutNotesRaw(next);
  await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, tombstone);
}

// Cloud-mode presence probe for the recovery operation journal's new-note week
// operation (#696).
//
// `saveWorkoutNoteItem` persists the live row and only THEN enqueues it, so a
// failed enqueue leaves a note that exists locally with no durable intent to
// upload it. Recovery-week memberships reach the cloud through the baseline
// diff, so verifying on existence alone would publish a membership referencing a
// note that may never upload — the same committed-write/failed-bookkeeping gap
// the deletion protocol closes. A live note is therefore only "durably live" in
// cloud mode when a non-tombstone dirty record for it is still queued (or the
// row has already been acknowledged; see ensureWorkoutNoteLive).
export async function loadWorkoutNotePresenceState(id) {
  const list = await Storage.loadWorkoutNotesRaw();
  const note = list.find((n) => n?.id === id);
  if (!note) {
    return { exists: false, deleted: false, requiresQueue: true, queued: false };
  }
  if (isTombstone(note)) {
    return { exists: true, deleted: true, requiresQueue: true, queued: false };
  }
  const dirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
  return {
    exists: true,
    deleted: false,
    requiresQueue: true,
    queued: dirty.some((record) => record?.id === id && !isTombstone(record)),
  };
}

// Idempotent cloud-mode "make this note durably live" used by the journal's
// new-note week replay. Converges on "live local row AND queued upload intent"
// from every reachable state:
//
//   absent       — persist the recorded seed and enqueue it;
//   tombstoned   — persist the recorded seed over the tombstone and enqueue it,
//                  because the recorded outcome for this operation is a LIVE
//                  note and the id was minted by this operation alone;
//   live, queued — nothing to do;
//   live, not queued — re-enqueue the existing row verbatim, which is the
//                  enqueue-failed case: the write committed, the bookkeeping did
//                  not, and only the queue record is missing.
//
// The seed's own `updated_at` is reused as the stamp so a replay cannot slide the
// row's timestamp forward past a copy another device already accepted.
export async function ensureWorkoutNoteLive(seed) {
  const list = await Storage.loadWorkoutNotesRaw();
  const existing = list.find((n) => n?.id === seed.id);
  const clientId = await getClientId();

  if (existing && !isTombstone(existing)) {
    await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, existing);
    return;
  }

  const stamped = stampWrite({ ...seed, deleted_at: null }, clientId, seed.updated_at);
  const next = existing
    ? list.map((n) => (n?.id === seed.id ? stamped : n))
    : [...list, stamped];
  await Storage.replaceWorkoutNotesRaw(next);
  await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, stamped);
}
