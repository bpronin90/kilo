import { useState, useEffect } from 'react';
import { subscribeDirtyQueue, getDirtyRecords, SYNC_TABLES } from '../../storage/syncQueue';
import { subscribeSyncState, getSyncState, SYNC_PHASE, SYNC_STATUS } from '../../storage/syncRecovery';
import { getStorageMode, STORAGE_MODES } from '../../storage/entries';

// Shared pending-cloud-convergence, exact-snapshot matching, and save-status
// derivation for the two Log editor hooks (useLogCurrentRoutineEditor,
// useLogOtherRoutineEditor). Extracted (#1055) so both hooks read the same
// convergence rule from one place instead of a per-file copy. This module is a
// LEAF: it is imported only by the two editor hooks, never by
// workoutNoteHooks.js/recoveryBlockHooks.js, so it does not reintroduce the
// circular-import cycle the original per-file duplication was avoiding (see the
// comment on useNoteConvergencePending below). It holds no module-level mutable
// state — every hook instance keeps its own React state.

// Pending-cloud-convergence state (#880 revised body). Deliberately NOT a
// network check — there is no network-detection infrastructure in this app,
// and a network probe would not be evidence of convergence anyway (a device
// can be online with a failed/backed-up queue, or briefly offline with
// nothing pending). Derived from two existing, already-authoritative
// sources: the sync queue's own dirty record for THIS note
// (`getDirtyRecords`/`subscribeDirtyQueue`), and `syncRecovery`'s
// SYNC_STATUS for the SYNC phase (`FAILED` means the last pass could not
// push/pull, so anything queued is stuck until retry). A note with no dirty
// record and no sync failure has nothing left to converge — including every
// note on a local-only (never signed in) device, where nothing is ever
// enqueued in the first place.
//
// Kept out of the shared `workoutNoteHooks.js` module: that module is already
// imported by `recoveryBlockHooks.js`, which both editor hooks also import — a
// top-level import of syncQueue/syncRecovery added to workoutNoteHooks.js
// completed a circular-import cycle that left an unrelated hook
// (`useRecoveryBlockLifecycle`) partially initialized in some test orderings.
// This leaf module (imported only by the two editor hooks) avoids that cycle
// entirely.
export function useNoteConvergencePending(noteId) {
  const [pending, setPending] = useState(false);
  const storageMode = getStorageMode();

  useEffect(() => {
    if (!noteId) {
      setPending(false);
      return undefined;
    }
    let cancelled = false;
    let recomputeVersion = 0;
    const recompute = async () => {
      const version = ++recomputeVersion;
      if (getStorageMode() !== STORAGE_MODES.CLOUD) {
        if (!cancelled && version === recomputeVersion) setPending(false);
        return;
      }
      let dirty;
      let dirtyReadFailed = false;
      try {
        dirty = await getDirtyRecords(SYNC_TABLES.WORKOUT_NOTES);
      } catch {
        dirty = [];
        dirtyReadFailed = true;
      }
      const isDirty = dirty.some((r) => r?.id === noteId);
      const syncFailed = getSyncState()[SYNC_PHASE.SYNC]?.status === SYNC_STATUS.FAILED;
      if (!cancelled && version === recomputeVersion) {
        setPending(dirtyReadFailed || isDirty || syncFailed);
      }
    };
    recompute();
    // Subscribe in local mode too. A sign-in can switch storage mode while an
    // editor remains mounted; the ensuing sync-state/queue event must start
    // convergence tracking without requiring the editor to be reopened.
    const unsubDirty = subscribeDirtyQueue(recompute);
    const unsubSync = subscribeSyncState(recompute);
    return () => {
      cancelled = true;
      unsubDirty();
      unsubSync();
    };
  }, [noteId, storageMode]);

  return pending;
}

export function snapshotMatches(snapshot, title, rawText) {
  return !!snapshot && snapshot.title === title && snapshot.raw_text === rawText;
}

// #880 revised body, BLOCKER 1: `Saved on device` is a claim about the exact
// {title, raw_text} the most recent successful save persisted, and must stop
// showing the instant the LIVE editor no longer matches it — during the
// debounce window, while an older write is still in flight, or on overlapping
// writes. Both hooks compute the same three live-match booleans against their
// own refs/canonical note and feed them here; this derives the bound success
// string and the tri-state save status identically for both.
export function deriveSaveStatus({
  liveMatchesSavingSnapshot,
  liveIsLocallyDurable,
  pendingConvergence,
  saveSuccess,
}) {
  const boundSaveSuccess = saveSuccess && liveIsLocallyDurable ? saveSuccess : '';
  const saveStatus = liveMatchesSavingSnapshot
    ? 'saving'
    : liveIsLocallyDurable && pendingConvergence
      ? 'pending'
      : boundSaveSuccess
        ? 'saved'
        : null;
  return { boundSaveSuccess, saveStatus };
}

// The current-routine editor's live-match booleans and save status. The live
// editor id folds in a not-yet-persisted new note's minted id
// (draftNoteIdOverrideRef), and durability is "matches the last save or the
// canonical note"; the saving-snapshot match keeps the transient 'saving' state
// bound to the exact in-flight payload.
export function deriveCurrentSaveStatus({
  currentId,
  draftNoteIdOverrideRef,
  isSaving,
  savingSnapshotRef,
  workoutNoteTitle,
  workoutNoteText,
  lastSavedIdRef,
  lastSavedTitleRef,
  lastSavedTextRef,
  currentNote,
  pendingConvergence,
  saveSuccess,
}) {
  const liveEditorNoteId = currentId || draftNoteIdOverrideRef.current || 'new';
  const liveMatchesSavingSnapshot = isSaving
    && savingSnapshotRef.current?.noteId === liveEditorNoteId
    && snapshotMatches(savingSnapshotRef.current, workoutNoteTitle, workoutNoteText);
  const liveMatchesLastSave = lastSavedIdRef.current === liveEditorNoteId && snapshotMatches(
    { title: lastSavedTitleRef.current, raw_text: lastSavedTextRef.current },
    workoutNoteTitle,
    workoutNoteText,
  );
  const liveMatchesCanonical = currentNote?.id === liveEditorNoteId && snapshotMatches(
    { title: currentNote.title || '', raw_text: currentNote.raw_text || '' },
    workoutNoteTitle,
    workoutNoteText,
  );
  const liveIsLocallyDurable = liveMatchesLastSave || liveMatchesCanonical;
  return deriveSaveStatus({ liveMatchesSavingSnapshot, liveIsLocallyDurable, pendingConvergence, saveSuccess });
}

// The other-routine editor's live-match booleans and save status. Same #880
// BLOCKER-1 binding as the current editor, but keyed on (editingNoteId,
// editingSource) and comparing against the FULL underlying text
// (editingFullText/editingTitle), not just the projected A/B half.
export function deriveOtherSaveStatus({
  editingNoteId,
  editingSource,
  noteIsSaving,
  savingSnapshotRef,
  editingTitle,
  editingFullText,
  lastSavedNoteIdRef,
  lastSavedSourceRef,
  lastSavedTitleRef,
  lastSavedTextRef,
  editingNote,
  pendingConvergence,
  saveSuccess,
}) {
  const liveMatchesSavingSnapshot = noteIsSaving
    && savingSnapshotRef.current?.noteId === editingNoteId
    && savingSnapshotRef.current?.source === editingSource
    && snapshotMatches(savingSnapshotRef.current, editingTitle, editingFullText);
  const liveMatchesLastSave = lastSavedNoteIdRef.current === editingNoteId
    && lastSavedSourceRef.current === editingSource
    && snapshotMatches(
      { title: lastSavedTitleRef.current, raw_text: lastSavedTextRef.current },
      editingTitle,
      editingFullText,
    );
  const liveMatchesCanonical = !!editingNote && snapshotMatches(
    { title: editingNote.title || '', raw_text: editingNote.raw_text || '' },
    editingTitle,
    editingFullText,
  );
  const liveIsLocallyDurable = liveMatchesLastSave || liveMatchesCanonical;
  return deriveSaveStatus({ liveMatchesSavingSnapshot, liveIsLocallyDurable, pendingConvergence, saveSuccess });
}
