// Movement-group override writes (#1306).
//
// The override map lives on the Recovery block's baseline NOTE
// (`exercise_movement_groups`, beside the derived `exercise_classifications`),
// so a choice travels through the ordinary note mutation + notify + sync path
// and is shared by every block that references that note. Each write:
//   1. reads the note fresh (never a copy captured when the screen rendered),
//   2. derives the next map from that fresh value,
//   3. merges ONLY that field under the notebook lock (`updateWorkoutNoteItem`),
//      so a concurrent ordinary editor save, which patches other fields, cannot
//      lose it and cannot be lost by it,
//   4. checks the value read back from the write, so a "saved" result always
//      means the persisted field holds the chosen map.
// Writes are serialized, and a failure is reported, never claimed as saved.
// A detailed choice (#1581) writes a version 2 map carrying every other stored
// value unchanged. In cloud mode a version 2 map is first checked against the
// account's own server validator (the CHECK's function): until the server accepts
// version 2, nothing is written and the save is reported as failed, so a choice
// the server would reject later is never shown as saved or left queued.

import { useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { updateWorkoutNoteItem } from '../../storage/entries/workoutNotes';
import { DETAILED_MOVEMENT_GROUPS_VERSION, nextMovementGroupMap } from '../../lib/data/movementGroups';
import { notifyWorkoutNotes, reloadWorkoutNotes } from './workoutNoteHooks';
import { readVia, writeVia } from './storageMode';

const MissingNote = 'The baseline routine for this block is no longer available.';
export const DetailedUnsupported = 'Your account can’t store detailed groups yet, so this choice wasn’t saved. Try again later.';

let chain = Promise.resolve();

export function setMovementGroupCore(storage, { noteId, key, group = null } = {}) {
  const run = chain.then(async () => {
    try {
      const notes = await storage.loadNotes();
      const note = (notes || []).find(n => n && n.id === noteId && !n.deleted_at);
      if (!note) return { ok: false, error: MissingNote };
      const next = nextMovementGroupMap(note.exercise_movement_groups, key, group);
      if (!next.ok) return { ok: false, error: next.error };
      if (next.map.version === DETAILED_MOVEMENT_GROUPS_VERSION && typeof storage.serverAccepts === 'function'
        && (await storage.serverAccepts(next.map)) !== true) {
        return { ok: false, error: DetailedUnsupported };
      }
      // No equality short-circuit: in cloud mode the local write lands before the
      // upload is enqueued, so a failed first attempt can leave the map already
      // stored with no upload intent. Re-running the same write re-stamps and
      // re-enqueues the note (idempotent by id), repairing that before success.
      const updated = await storage.updateNote(noteId, { exercise_movement_groups: next.map });
      if (!updated) return { ok: false, error: MissingNote };
      if (JSON.stringify(updated.exercise_movement_groups ?? null) !== JSON.stringify(next.map)) {
        return { ok: false, error: 'The group choice did not save. Try again.' };
      }
      return { ok: true, map: next.map };
    } catch (e) {
      return { ok: false, error: `${e?.message || 'The group choice did not save.'} Try again.` };
    }
  });
  chain = run.catch(() => {});
  return run;
}

// Cloud mode only: ask the server's validator whether it accepts this exact map.
// Any error, a missing client, or a false answer counts as "not accepted".
export async function serverAccepts(map) {
  if (Storage.getStorageMode() !== Storage.STORAGE_MODES.CLOUD) return true;
  try {
    // eslint-disable-next-line global-require
    const client = require('../../lib/supabaseClient').getSupabaseClient();
    if (!client) return false;
    const { data, error } = await client.schema('kilo').rpc('is_valid_exercise_movement_groups', { p_value: map });
    return !error && data === true;
  } catch {
    return false;
  }
}

const LiveStorage = {
  serverAccepts,
  loadNotes: () => readVia('loadWorkoutNotes', Storage.loadWorkoutNotes),
  updateNote: (id, patch) => writeVia('updateWorkoutNoteItem', updateWorkoutNoteItem, id, patch),
};

export function useMovementGroupEditor() {
  const setMovementGroup = useCallback(async (params) => {
    const result = await setMovementGroupCore(LiveStorage, params);
    if (result.ok) {
      notifyWorkoutNotes();
      // A plain storage read for every mounted notes instance, so the groups
      // reflect the persisted write immediately rather than after a sync pass.
      reloadWorkoutNotes();
    }
    return result;
  }, []);
  return { setMovementGroup };
}
