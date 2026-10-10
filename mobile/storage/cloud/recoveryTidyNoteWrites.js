// Cloud-mode note text writes for Tidy names (#1309).
//
// Same all-or-nothing contract as the local batch (workoutNoteRecoveryBatch.js):
// every target is validated before the first write and a missing/deleted/edited
// note rejects the batch with zero writes. Cloud mode then stamps each written
// note with the journal's immutable requested timestamp (a replay can never slide
// it forward past a copy another device accepted), commits the notebook once, and
// enqueues every row. A commit that lands but whose enqueue fails is NOT
// success: `loadTidyTextStates` reports `queued: false`, the journal stays
// pending, and the replay re-enqueues the existing row verbatim.
//
// Ordinary row-level LWW is unchanged: authored raw-text differences between
// devices stay ordinary conflicts, and this module never resolves them.

import * as Storage from '../entries';
import { SYNC_TABLES, stampWrite, isTombstone, getClientId, enqueueDirty, getDirtyRecords } from '../syncQueue';
import { withWorkoutNotebookLock } from '../entries/workoutNotes';
import { classifyTidyItems } from '../entries/workoutNoteRecoveryBatch';

const queuedIds = async () => new Set(
  (await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES)).filter(r => r && !isTombstone(r)).map(r => r.id)
);

export async function loadTidyTextStates(ids) {
  const list = await Storage.loadWorkoutNotesRaw();
  const queued = await queuedIds();
  const byId = new Map(list.map(n => [n && n.id, n]));
  return ids.map((id) => {
    const note = byId.get(id);
    return {
      id, exists: !!note, deleted: !note || isTombstone(note), raw_text: note ? note.raw_text : null,
      requiresQueue: true, queued: queued.has(id),
    };
  });
}

export function applyTidyNoteTexts({ items, requestedAt }) {
  return withWorkoutNotebookLock(async () => {
    const list = await Storage.loadWorkoutNotesRaw();
    const states = classifyTidyItems(list, items, n => !isTombstone(n));
    const conflicts = states.filter(s => s.state === 'conflict');
    if (conflicts.length) return { status: 'conflict', conflicts, written: [] };
    const targets = new Map(items.filter((_i, k) => states[k].state === 'todo').map(i => [i.id, i.target]));
    const clientId = await getClientId();
    const rows = new Map();
    const next = list.map((n) => {
      if (!n || !targets.has(n.id)) return n;
      const row = stampWrite({ ...n, raw_text: targets.get(n.id) }, clientId, requestedAt);
      rows.set(n.id, row);
      return row;
    });
    if (rows.size > 0) {
      try {
        await Storage.replaceWorkoutNotesRaw(next);
      } catch (error) {
        return { status: 'failed', error, written: [] };
      }
    }
    // Enqueue the rows just written, plus any target already at its destination
    // whose upload intent is missing (the enqueue-failed replay).
    const queued = await queuedIds();
    const byId = new Map(next.map(n => [n && n.id, n]));
    const failed = [];
    for (const item of items) {
      const row = rows.get(item.id) || (byId.get(item.id)?.raw_text === item.target && !queued.has(item.id) ? byId.get(item.id) : null);
      if (!row) continue;
      try {
        await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, row);
      } catch (error) {
        failed.push({ id: item.id, error });
      }
    }
    return failed.length ? { status: 'failed', error: failed[0].error, written: [...rows.keys()], failed } : { status: 'ok', written: [...rows.keys()] };
  });
}
