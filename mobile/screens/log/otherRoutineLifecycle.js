import { useState } from 'react';
import { Alert } from '../../lib/platformAlert';
import { resolveExerciseSourceAnchor } from '../../lib/parser';
import { isValidActiveWeek } from './editorWeekText';
import { restoreWorkoutNoteDraft } from './editorDrafts';
import { runDoneConvergenceLoop } from './useLogEditorSave';
import {
  clearWorkoutNoteDraft,
  clearWorkoutNoteDraftsForNote,
} from '../../storage/entries/workoutNoteDrafts';
import { clearWorkoutNoteCreationAttempt } from '../../storage/entries/workoutNoteCreationAttempts';

// Other-routine editor open/edit/done/revert/create/delete/source-jump
// lifecycle, extracted from useLogOtherRoutineEditor (#1055). Provided as a
// factory hook so its own pendingSourceJump state lives with it; every other
// piece of editor state (refs, setters, live values, helpers) is supplied by the
// calling hook through `ctx`, so no module-level editor state is held.

function otherDraftKey(editingNoteId, editingSource = null) {
  if (!editingNoteId) return null;
  if (editingSource === 'recovery') return `recovery:${editingNoteId}`;
  return editingNoteId === 'new' ? 'other:new' : `other:${editingNoteId}`;
}

const OTHER_CREATE_ATTEMPT_KEY = 'other:new';

export function useOtherEditorLifecycle(ctx) {
  const {
    // deps / helpers
    update,
    updateDeload,
    remove,
    deleteDeloadNote,
    deloadHistory,
    handleSaveOtherNote,
    clearAdoptionPrompt,
    routineViewer,
    recoveryViewer,
    // live values
    editingNoteId,
    editingSource,
    originalNoteState,
    hasUnsavedOther,
    isEditingDeloadNote,
    editingDeloadHasLinkedRecord,
    deloadEditDate,
    deloadEditOrdinal,
    // refs
    draftRestoreTokenRef,
    draftBaseUpdatedAtRef,
    preserveExistingDraftRef,
    draftRestorePendingRef,
    editingNoteIdRef,
    editingSourceRef,
    editingTitleRef,
    editingFullTextRef,
    notesRef,
    autosaveOtherTimerRef,
    saveOtherNoteInFlightRef,
    createAttemptTokenRef,
    deloadEditDateRef,
    deloadEditOrdinalRef,
    lastSavedTextRef,
    lastSavedTitleRef,
    lastSavedDeloadDateRef,
    lastSavedDeloadOrdinalRef,
    // setters
    setEditingNoteId,
    setEditingSource,
    setEditingTitle,
    setEditingFullText,
    setEditingActiveWeek,
    setDeloadEditDate,
    setDeloadEditDateTouched,
    setDeloadEditOrdinal,
    setOriginalNoteState,
    setSaveError,
    setSaveSuccess,
  } = ctx;

  const [pendingSourceJump, setPendingSourceJump] = useState(null);

  // Restores a cheap local draft into the live editor, but only when it is still
  // safe to trust: the draft must have been captured against the SAME canonical
  // updated_at this editor just opened on, and the context must still be the one
  // the caller opened. #880 reversal: a draft whose base predates the canonical
  // note is NEVER auto-applied over newer canonical text AND NEVER deleted here.
  const restoreOtherDraftIfCurrent = ({
    expectedId,
    expectedSource,
    canonicalUpdatedAt,
    expectedTitle,
    expectedText,
    restoreToken,
  }) => restoreWorkoutNoteDraft({
    key: otherDraftKey(expectedId, expectedSource),
    canonicalUpdatedAt,
    restoreToken,
    tokenRef: draftRestoreTokenRef,
    pendingRef: draftRestorePendingRef,
    isStillCurrent: () => editingNoteIdRef.current === expectedId
      && editingSourceRef.current === expectedSource
      && (notesRef.current.find((note) => note.id === expectedId)?.updated_at ?? null) === canonicalUpdatedAt,
    expectedTitle,
    expectedText,
    readLiveTitle: () => editingTitleRef.current,
    readLiveText: () => editingFullTextRef.current,
    applyTitle: setEditingTitle,
    applyText: setEditingFullText,
  });

  // Opens the editor on whichever note/A-B-half a viewer slot is showing. One
  // implementation shared by both viewer slots (#836): the Recovery card's Edit
  // control reads off recoveryViewer, exactly as the Routine tab's reads off
  // routineViewer.
  const makeHandleEditViewedNote = (viewer, source = null, { restoreDraft = true } = {}) => () => {
    const note = viewer.viewingNote;
    if (!note) return;
    const canonicalUpdatedAt = note.updated_at ?? null;
    const restoreToken = draftRestoreTokenRef.current + 1;
    draftRestoreTokenRef.current = restoreToken;
    draftBaseUpdatedAtRef.current = canonicalUpdatedAt;
    preserveExistingDraftRef.current = !restoreDraft;
    draftRestorePendingRef.current = restoreDraft;
    editingNoteIdRef.current = note.id;
    editingSourceRef.current = source;
    editingTitleRef.current = note.title || '';
    editingFullTextRef.current = note.raw_text;
    setEditingNoteId(note.id);
    setEditingSource(source);
    setEditingTitle(note.title || '');
    setEditingFullText(note.raw_text);
    // Continue editing whichever week the expanded card was showing, so the
    // editor never silently switches weeks on entry.
    setEditingActiveWeek(viewer.viewingHasABWeeks ? viewer.viewingEffectiveWeek : null);
    setDeloadEditDate(note.saved_at ? note.saved_at.slice(0, 10) : '');
    setDeloadEditDateTouched(false);
    const _histRec = deloadHistory.find(r => r.note_id === note.id);
    const initialOrdinal = _histRec?.deload_session_ordinal != null ? String(_histRec.deload_session_ordinal) : '';
    setDeloadEditOrdinal(initialOrdinal);
    setOriginalNoteState({
      id: note.id,
      title: note.title || '',
      text: note.raw_text,
      date: note.saved_at ? note.saved_at.slice(0, 10) : '',
      ordinal: initialOrdinal,
      activeWeek: viewer.viewingHasABWeeks ? viewer.viewingEffectiveWeek : null,
    });
    setSaveError('');
    setSaveSuccess('');
    clearAdoptionPrompt();
    // #880 review: existing-note entry point exactly like handleOpenOtherNote —
    // restore any stranded draft rather than silently showing canonical content.
    if (restoreDraft) {
      restoreOtherDraftIfCurrent({
        expectedId: note.id,
        expectedSource: source,
        canonicalUpdatedAt,
        expectedTitle: note.title || '',
        expectedText: note.raw_text,
        restoreToken,
      });
    }
  };

  // #881 (F10a §2/§6): resolves a double-tapped exercise's source anchor against
  // the viewer's CURRENT live slice and — only on success — opens the editor,
  // then leaves a one-shot collapsed-caret request. A discarded/stale anchor
  // never opens anything and never touches pendingSourceJump.
  const clearPendingSourceJump = () => setPendingSourceJump(null);
  const resolveAndOpenSourceJump = (viewer, source) => (anchor) => {
    const note = viewer.viewingNote;
    if (!note || !anchor || anchor.noteId !== note.id) return;
    const weekIndex = viewer.viewingHasABWeeks && viewer.viewingEffectiveWeek === 'B' ? 1 : 0;
    if (anchor.weekIndex !== weekIndex) return;
    const range = resolveExerciseSourceAnchor(anchor, { noteId: note.id, weekIndex, sliceText: viewer.viewingActiveText });
    if (!range) return;
    makeHandleEditViewedNote(viewer, source, { restoreDraft: false })();
    setPendingSourceJump({
      start: range.end,
      end: range.end,
      editingNoteId: note.id,
      currentMode: null,
      expectedText: viewer.viewingActiveText,
      source,
      token: `${Date.now()}-${Math.random()}`,
    });
  };

  const handleOpenOtherNote = (other) => {
    const canonicalUpdatedAt = other.updated_at ?? null;
    const restoreToken = draftRestoreTokenRef.current + 1;
    draftRestoreTokenRef.current = restoreToken;
    draftBaseUpdatedAtRef.current = canonicalUpdatedAt;
    preserveExistingDraftRef.current = false;
    draftRestorePendingRef.current = true;
    editingNoteIdRef.current = other.id;
    editingSourceRef.current = null;
    editingTitleRef.current = other.title || '';
    editingFullTextRef.current = other.raw_text;
    setEditingNoteId(other.id);
    setEditingSource(null);
    setEditingTitle(other.title || '');
    setEditingFullText(other.raw_text);
    const _persistedWeek = isValidActiveWeek(other.activeWeek) ? other.activeWeek : null;
    setEditingActiveWeek(_persistedWeek);
    setDeloadEditDate(other.saved_at ? other.saved_at.slice(0, 10) : '');
    setDeloadEditDateTouched(false);
    const _histRec = deloadHistory.find(r => r.note_id === other.id);
    const initialOrdinal = _histRec?.deload_session_ordinal != null ? String(_histRec.deload_session_ordinal) : '';
    setDeloadEditOrdinal(initialOrdinal);
    setOriginalNoteState({
      id: other.id,
      title: other.title || '',
      text: other.raw_text,
      date: other.saved_at ? other.saved_at.slice(0, 10) : '',
      ordinal: initialOrdinal,
      activeWeek: _persistedWeek,
    });
    setSaveError('');
    setSaveSuccess('');
    clearAdoptionPrompt();
    restoreOtherDraftIfCurrent({
      expectedId: other.id,
      expectedSource: null,
      canonicalUpdatedAt,
      expectedTitle: other.title || '',
      expectedText: other.raw_text,
      restoreToken,
    });
  };

  // #863: session alignment is a purely inline, ignorable signal now, so Done
  // just saves (converging on any content typed past the in-flight save; Done
  // compares text, title, and linked-deload date/ordinal so a metadata edit
  // made during the race is not lost) and closes.
  const handleDoneOther = async () => {
    if (autosaveOtherTimerRef.current) {
      clearTimeout(autosaveOtherTimerRef.current);
      autosaveOtherTimerRef.current = null;
    }
    if (editingNoteId === 'new') {
      if (hasUnsavedOther) {
        const ok = await handleSaveOtherNote();
        if (!ok) return;
      }
      setEditingNoteId(null);
      setEditingSource(null);
      setOriginalNoteState(null);
      clearAdoptionPrompt();
      return;
    }
    if (hasUnsavedOther) {
      const converged = await runDoneConvergenceLoop({
        save: () => handleSaveOtherNote(),
        hasConverged: () =>
          editingFullTextRef.current === lastSavedTextRef.current
          && editingTitleRef.current === lastSavedTitleRef.current
          && deloadEditDateRef.current === lastSavedDeloadDateRef.current
          && deloadEditOrdinalRef.current === lastSavedDeloadOrdinalRef.current,
      });
      if (!converged) return;
    }
    setEditingNoteId(null);
    setEditingSource(null);
    setOriginalNoteState(null);
    clearAdoptionPrompt();
  };

  // Reverts to the editor-entry snapshot, or explicitly abandons a stranded
  // create (#997 review): retirement of the durable attempt is AWAITED, comes
  // FIRST, and its failure aborts the discard — otherwise the next routine
  // authored here would overwrite the stranded one.
  const performRevertOther = async () => {
    if (editingNoteId === 'new') {
      if (autosaveOtherTimerRef.current) {
        clearTimeout(autosaveOtherTimerRef.current);
        autosaveOtherTimerRef.current = null;
      }
      if (saveOtherNoteInFlightRef.current) {
        await saveOtherNoteInFlightRef.current;
      }
      const abandoned = createAttemptTokenRef.current;
      if (abandoned) {
        try {
          await clearWorkoutNoteCreationAttempt(OTHER_CREATE_ATTEMPT_KEY, abandoned);
        } catch {
          setSaveError('Could not clear this draft');
          return false;
        }
        createAttemptTokenRef.current = null;
      }
      setEditingTitle('');
      setEditingFullText('');
      setEditingActiveWeek(null);
      clearWorkoutNoteDraft('other:new').catch(() => {});
      return true;
    }
    if (!originalNoteState) return true;
    if (autosaveOtherTimerRef.current) {
      clearTimeout(autosaveOtherTimerRef.current);
      autosaveOtherTimerRef.current = null;
    }
    if (saveOtherNoteInFlightRef.current) {
      await saveOtherNoteInFlightRef.current;
    }
    let rolledBackDeload = false;
    let deloadRevertPatch = null;
    try {
      const patch = {
        title: originalNoteState.title,
        raw_text: originalNoteState.text,
        activeWeek: isValidActiveWeek(originalNoteState.activeWeek)
          ? originalNoteState.activeWeek
          : null,
      };
      if (isEditingDeloadNote) {
        const histRecord = editingDeloadHasLinkedRecord
          ? deloadHistory.find(r => r.note_id === editingNoteId)
          : null;
        if (histRecord) {
          const deloadPatch = {};
          deloadRevertPatch = {};
          if (originalNoteState.date) {
            const originalDate = originalNoteState.date;
            deloadPatch.completed_at = `${originalDate}T12:00:00.000Z`;
            patch.saved_at = `${originalDate}T12:00:00.000Z`;
            if (deloadEditDate) {
              deloadRevertPatch.completed_at = `${deloadEditDate}T12:00:00.000Z`;
            }
          }
          if (originalNoteState.ordinal !== undefined) {
            const originalOrdinal = parseInt(originalNoteState.ordinal, 10);
            if (!isNaN(originalOrdinal)) {
              deloadPatch.deload_session_ordinal = originalOrdinal;
            } else if (originalNoteState.ordinal === '') {
              deloadPatch.deload_session_ordinal = null;
            }
            const editedOrdinal = parseInt(deloadEditOrdinal, 10);
            if (!isNaN(editedOrdinal)) {
              deloadRevertPatch.deload_session_ordinal = editedOrdinal;
            } else if (deloadEditOrdinal === '') {
              deloadRevertPatch.deload_session_ordinal = null;
            }
          }
          if (Object.keys(deloadPatch).length > 0) {
            await updateDeload(histRecord.id, deloadPatch);
            rolledBackDeload = true;
          }
        }
      }
      try {
        await update(editingNoteId, patch);
      } catch (updateErr) {
        if (rolledBackDeload && deloadRevertPatch && Object.keys(deloadRevertPatch).length > 0) {
          const histRecord = deloadHistory.find(r => r.note_id === editingNoteId);
          if (histRecord) {
            try {
              await updateDeload(histRecord.id, deloadRevertPatch);
            } catch (compensatingErr) {
              console.warn('Compensating rollback for deload history failed:', compensatingErr);
            }
          }
        }
        throw updateErr;
      }
      setEditingTitle(originalNoteState.title);
      setEditingFullText(originalNoteState.text);
      setEditingActiveWeek(originalNoteState.activeWeek ?? null);
      if (isEditingDeloadNote) {
        setDeloadEditDate(originalNoteState.date);
        setDeloadEditOrdinal(originalNoteState.ordinal);
      }
      clearWorkoutNoteDraft(otherDraftKey(editingNoteId, editingSource)).catch(() => {});
      return true;
    } catch (err) {
      console.warn('Revert failed:', err);
      Alert.alert('Error', 'Failed to revert changes. Please try again.');
      return false;
    }
  };

  // Recovery's inline control is labelled Cancel by the scoped shared component,
  // so it opens an explicit choice rather than attaching destructive meaning to
  // Cancel: Done persists the latest edit and closes; Revert restores the
  // editor-entry snapshot only after a second, destructive-labelled press.
  const handleCancelRecoveryEdit = () => {
    Alert.alert(
      'Close recovery note editor?',
      'Done keeps your latest changes. Revert this edit restores the note to how it was when you opened the editor, including changes already autosaved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Done', onPress: handleDoneOther },
        {
          text: 'Revert this edit',
          style: 'destructive',
          onPress: async () => {
            const reverted = await performRevertOther();
            if (!reverted) return;
            setEditingNoteId(null);
            setEditingSource(null);
            setOriginalNoteState(null);
          },
        },
      ]
    );
  };

  const handleDeleteRoutine = (id, title, isCurrent) => {
    Alert.alert(
      'Delete Routine',
      isCurrent
        ? `"${title}" is your current active routine. Deleting it permanently erases the workout history logged in this note and will affect your analytics. This cannot be undone.`
        : `Deleting "${title}" permanently erases the workout history logged in this note. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await remove(id);
            setEditingNoteId(null);
            setEditingSource(null);
            setOriginalNoteState(null);
            routineViewer.setViewingNoteId(null);
            recoveryViewer.setViewingNoteId(null);
          },
        },
      ]
    );
  };

  const handleDeleteDeloadNoteFromEditor = () => {
    Alert.alert(
      'Delete deload record?',
      'This cannot be undone. The sessions-since-deload clock will reset based on your remaining history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const deletedId = editingNoteId;
            await deleteDeloadNote(deletedId);
            setEditingNoteId(null);
            setEditingSource(null);
            setOriginalNoteState(null);
            clearWorkoutNoteDraftsForNote(deletedId).catch(() => {});
          },
        },
      ]
    );
  };

  // Opens the plain-text editor on a draft. `seed` carries the guided sheet's
  // "Write it as text instead" escape (#745 Part 3 §3.1): composed text/title
  // arrive pre-filled and UNSAVED (the ordinary editingNoteId === 'new' path).
  const handleCreateRoutine = (seed) => {
    const initialTitle = seed?.title ?? '';
    const initialText = seed?.text ?? '';
    const restoreToken = draftRestoreTokenRef.current + 1;
    draftRestoreTokenRef.current = restoreToken;
    draftBaseUpdatedAtRef.current = null;
    preserveExistingDraftRef.current = !!seed;
    draftRestorePendingRef.current = !seed;
    editingNoteIdRef.current = 'new';
    editingSourceRef.current = null;
    editingTitleRef.current = initialTitle;
    editingFullTextRef.current = initialText;
    setOriginalNoteState(null);
    setEditingNoteId('new');
    setEditingSource(null);
    setEditingTitle(initialTitle);
    setEditingFullText(initialText);
    setEditingActiveWeek(null);
    setSaveError('');
    setSaveSuccess('');
    clearAdoptionPrompt();
    // Only restore over a BLANK manual-entry draft. A seed is deliberate content
    // the user just composed; a leftover local draft must never clobber it.
    if (!seed) {
      restoreOtherDraftIfCurrent({
        expectedId: 'new',
        expectedSource: null,
        canonicalUpdatedAt: null,
        expectedTitle: '',
        expectedText: '',
        restoreToken,
      });
    }
  };

  const handleEditViewedNote = makeHandleEditViewedNote(routineViewer, null);
  const handleEditRecoveryViewedNote = makeHandleEditViewedNote(recoveryViewer, 'recovery');
  const handleRoutineExerciseSourceJump = resolveAndOpenSourceJump(routineViewer, null);
  const handleRecoveryExerciseSourceJump = resolveAndOpenSourceJump(recoveryViewer, 'recovery');

  return {
    restoreOtherDraftIfCurrent,
    handleEditViewedNote,
    handleEditRecoveryViewedNote,
    handleOpenOtherNote,
    pendingSourceJump,
    clearPendingSourceJump,
    handleRoutineExerciseSourceJump,
    handleRecoveryExerciseSourceJump,
    handleDoneOther,
    performRevertOther,
    handleCancelRecoveryEdit,
    handleDeleteRoutine,
    handleDeleteDeloadNoteFromEditor,
    handleCreateRoutine,
  };
}
