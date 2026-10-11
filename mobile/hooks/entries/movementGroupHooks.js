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

import { useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { updateWorkoutNoteItem } from '../../storage/entries/workoutNotes';
import { nextMovementGroupMap } from '../../lib/data/movementGroups';
import { notifyWorkoutNotes, reloadWorkoutNotes } from './workoutNoteHooks';
import { readVia, writeVia } from './storageMode';

const MissingNote = 'The baseline routine for this block is no longer available.';

let chain = Promise.resolve();

export function setMovementGroupCore(storage, { noteId, key, group = null } = {}) {
  const run = chain.then(async () => {
    try {
      const notes = await storage.loadNotes();
      const note = (notes || []).find(n => n && n.id === noteId && !n.deleted_at);
      if (!note) return { ok: false, error: MissingNote };
      const next = nextMovementGroupMap(note.exercise_movement_groups, key, group);
      if (!next.ok) return { ok: false, error: next.error };
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

const LiveStorage = {
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
