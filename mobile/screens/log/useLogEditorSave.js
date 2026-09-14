import { useEffect } from 'react';
import {
  saveWorkoutNoteDraft,
  clearWorkoutNoteDraftIfMatches,
  clearWorkoutNoteDraftsSupersededBySave,
} from '../../storage/entries/workoutNoteDrafts';
import { snapshotMatches } from './editorConvergence';

// Shared save-lifecycle machinery for the two Log editor hooks (#1055). Every
// export here is pure/parameterized: the mode-specific save mutation, identity,
// and storage behavior arrive as explicit inputs, and no module-level editor
// state is held. The two hooks keep their own in-flight refs, snapshots, and
// last-saved refs and pass them in, so a save in one editor never touches the
// other.

// The 2s "Saved on device" flash auto-clear, shared by both editors.
export function useSaveSuccessAutoClear(saveSuccess, setSaveSuccess) {
  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [saveSuccess, setSaveSuccess]);
}

// Done's save-then-flush convergence loop. `handleSaveOtherNote`/`handleSave`
// may coalesce onto an in-flight autosave still persisting older content, so
// once a save settles we compare the live editor against what was actually
// saved and save again if the user typed past it. The guard caps it so rapid
// edits can never spin unbounded — if it somehow does not converge the caller
// keeps the editor open rather than closing on unsaved text. Returns true only
// when the editor is safe to close; false means the caller must return early.
export async function runDoneConvergenceLoop({ save, hasConverged, guardMax = 5 }) {
  let ok = await save();
  if (!ok) return false;
  let guard = 0;
  while (!hasConverged()) {
    if (guard >= guardMax) return false;
    guard += 1;
    ok = await save();
    if (!ok) return false;
  }
  return true;
}

// Post-save draft cleanup, shared by both editors. Retires the saved snapshot
// and drafts that predate the save checkpoint; a different draft written after
// the checkpoint is the user's newer in-flight typing and is rebased onto the
// revision the write just created rather than lost. Null keys are tolerated so
// the other editor's nullable keys need no extra guarding at the call site.
export async function reconcileDraftsAfterSave({
  preKey,
  postKey,
  checkpoint,
  savedSnapshot,
  latestSnapshot,
  identityUnchanged,
  resultUpdatedAt,
}) {
  if (preKey) {
    await clearWorkoutNoteDraftsSupersededBySave(preKey, checkpoint, savedSnapshot).catch(() => {});
  }
  if (postKey && postKey !== preKey) {
    await clearWorkoutNoteDraftsSupersededBySave(postKey, checkpoint, savedSnapshot).catch(() => {});
  }
  if (
    identityUnchanged
    && postKey
    && !snapshotMatches(latestSnapshot, savedSnapshot.title, savedSnapshot.raw_text)
  ) {
    await saveWorkoutNoteDraft(postKey, {
      ...latestSnapshot,
      baseUpdatedAt: resultUpdatedAt ?? null,
    }).catch(() => {});
    if (preKey && postKey !== preKey) {
      await clearWorkoutNoteDraftIfMatches(preKey, latestSnapshot).catch(() => {});
    }
  }
}
