import { useState, useEffect, useRef, useMemo } from 'react';
import { Alert } from '../../lib/platformAlert';
import { DELOAD_NOTE_PREFIX, AUTOSAVE_DEBOUNCE_MS } from '../../lib/LogScreenHelpers';
import { useNoteConvergencePending, deriveOtherSaveStatus, metadataMatches } from './editorConvergence';
import { isValidActiveWeek } from './editorWeekText';
import {
  markWorkoutNoteDraftSaveStart,
} from '../../storage/entries/workoutNoteDrafts';
import {
  ensureWorkoutNoteCreationAttempt,
  clearWorkoutNoteCreationAttempt,
} from '../../storage/entries/workoutNoteCreationAttempts';
import {
  writeWorkoutNoteDraftNow,
  cancelPendingDraftRestore as cancelDraftRestore,
  useRestoreCreationAttemptToken,
  useEditorDraftPersistence,
} from './editorDrafts';
import {
  useSaveSuccessAutoClear,
  reconcileDraftsAfterSave,
} from './useLogEditorSave';
import { useNoteViewer, toggleViewingWeek } from './otherRoutineViewers';
import {
  useOtherEditingProjection, otherMetadata, canonicalOtherMetadata,
  hasPersistableMetadataChange, persistedOtherMetadata, runOtherAutosave, otherDoneConverged,
} from './otherRoutineEditing';
import { useOtherEditorLifecycle } from './otherRoutineLifecycle';
import { createOtherAdoptionHandlers } from './otherRoutineAdoption';

function otherDraftKey(editingNoteId, editingSource = null) {
  if (!editingNoteId) return null;
  if (editingSource === 'recovery') return `recovery:${editingNoteId}`;
  return editingNoteId === 'new' ? 'other:new' : `other:${editingNoteId}`;
}

// The one caller context this editor creates notes in (#997): every create is
// the `editingNoteId === 'new'` path (opened with a null editingSource), so one
// durable slot covers it.
const OTHER_CREATE_ATTEMPT_KEY = 'other:new';

// #1055: convergence/week-text/drafts/save helpers are shared modules; the note
// viewers, editing projection, open/done/revert/create/delete/source-jump
// lifecycle, and adoption/switching each live in an other-routine module.
// handleSaveOtherNote, its autosave effect, and handleUndoOther stay here.
export function useLogOtherRoutineEditor({
  notes,
  currentId,
  currentNote,
  deloadHistory,
  update,
  add,
  remove,
  selectCurrent,
  updateDeload,
  deleteDeloadNote,
  autosaveCurrentTimerRef,
  handleSave,
  currentEditorMode,
  hasUnsavedCurrent,
  editorScrollRef,
}) {
  const [editingNoteId, setEditingNoteId] = useState(null);
  // #880 revised body: pending-cloud-convergence for the note currently open
  // in this editor (never a network check). `null` for 'new' — nothing could
  // be enqueued for a note with no id yet.
  const pendingConvergence = useNoteConvergencePending(
    editingNoteId && editingNoteId !== 'new' ? editingNoteId : null
  );
  // Surface that opened this editingNoteId session (#841): 'recovery' for the
  // Recovery block's inline editor, null otherwise (LogScreen reads it).
  const [editingSource, setEditingSource] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  // Full underlying raw_text being edited (both A/B halves + separator, when
  // present). The exposed editingText/setEditingText project this down to the
  // selected week, mirroring the current-routine editor.
  const [editingFullText, setEditingFullText] = useState('');
  const [editingActiveWeek, setEditingActiveWeek] = useState(null);
  const [noteIsSaving, setNoteIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [originalNoteState, setOriginalNoteState] = useState(null);
  // Two independent viewer slots (#836): Routine tab and Recovery tab, so an
  // expanded note on one tab stays invisible on the other.
  const routineViewer = useNoteViewer(notes);
  const recoveryViewer = useNoteViewer(notes);
  const [deloadEditDate, setDeloadEditDate] = useState('');
  // Tracks whether the user actually interacted with the compact date
  // disclosure (#764): deloadEditDate is seeded from saved_at on open, so a
  // title-/text-only edit must not fall into the date-handling save branch —
  // only an explicit user change should touch saved_at.
  const [deloadEditDateTouched, setDeloadEditDateTouched] = useState(false);
  const [showDeloadDatePicker, setShowDeloadDatePicker] = useState(false);
  const [deloadEditOrdinal, setDeloadEditOrdinal] = useState('');

  // Post-save adoption prompt (#748; #745 Part 4 §A1): Save never adopts; this
  // dismissible prompt offers it until acted on or the editor is left.
  const [adoptionPrompt, setAdoptionPrompt] = useState(null); // { id, title } | null
  const [adoptionError, setAdoptionError] = useState('');
  const [adoptionBusy, setAdoptionBusy] = useState(false);

  const autosaveOtherTimerRef = useRef(null);
  const saveOtherNoteInFlightRef = useRef(null);
  const savingOtherSnapshotRef = useRef(null);
  const lastSavedNoteIdRef = useRef(null);
  const lastSavedSourceRef = useRef(null);
  // Last save's text/title, its submitted metadata (Done convergence) and its
  // durable metadata (status), #1500.
  const lastSavedTextRef = useRef(null);
  const lastSavedTitleRef = useRef(null);
  const lastSubmittedMetadataRef = useRef(null);
  const lastSavedMetadataRef = useRef(null);

  // Live-value refs so async save callbacks read current state without stale closures.
  const editingFullTextRef = useRef(editingFullText);
  const editingTitleRef = useRef(editingTitle);
  const editingNoteIdRef = useRef(editingNoteId);
  const editingSourceRef = useRef(editingSource);
  const deloadEditDateRef = useRef(deloadEditDate);
  const deloadEditOrdinalRef = useRef(deloadEditOrdinal);
  editingFullTextRef.current = editingFullText;
  editingTitleRef.current = editingTitle;
  editingNoteIdRef.current = editingNoteId;
  editingSourceRef.current = editingSource;
  deloadEditDateRef.current = deloadEditDate;
  deloadEditOrdinalRef.current = deloadEditOrdinal;

  const draftOtherTimerRef = useRef(null);
  const draftBaseUpdatedAtRef = useRef(null);
  const preserveExistingDraftRef = useRef(false);
  const lastDraftWriteSignatureRef = useRef(null);
  const draftRestoreTokenRef = useRef(0);
  const draftRestorePendingRef = useRef(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Durable creation-attempt token for the new-note create (#997): minted before
  // it, restored on mount, cleared only on full success (see editorDrafts).
  const createAttemptTokenRef = useRef(null);
  useRestoreCreationAttemptToken(OTHER_CREATE_ATTEMPT_KEY, createAttemptTokenRef);

  const writeOtherDraftNow = () => writeWorkoutNoteDraftNow({
    key: otherDraftKey(editingNoteIdRef.current, editingSourceRef.current),
    title: editingTitleRef.current,
    raw_text: editingFullTextRef.current,
    baseUpdatedAt: draftBaseUpdatedAtRef.current,
    preserveExisting: preserveExistingDraftRef.current,
    signatureRef: lastDraftWriteSignatureRef,
    onPreserveConsumed: () => { preserveExistingDraftRef.current = false; },
  });

  const cancelPendingDraftRestore = () => cancelDraftRestore({
    pendingRef: draftRestorePendingRef,
    tokenRef: draftRestoreTokenRef,
    preserveExistingRef: preserveExistingDraftRef,
  });

  useSaveSuccessAutoClear(saveSuccess, setSaveSuccess);

  const editingNote = useMemo(() =>
    (editingNoteId && editingNoteId !== 'new') ? notes.find(n => n.id === editingNoteId) : null
  , [editingNoteId, notes]);

  const isEditingDeloadNote = !!editingNote?.title?.startsWith(DELOAD_NOTE_PREFIX);

  // The linked history record of the deload note being edited, if any. Legacy
  // deload notes without a note_id match are read-only for date edits.
  const editingDeloadRecord = useMemo(() =>
    (isEditingDeloadNote ? deloadHistory.find(r => r.note_id === editingNoteId) ?? null : null),
  [isEditingDeloadNote, deloadHistory, editingNoteId]);
  const editingDeloadHasLinkedRecord = !!editingDeloadRecord;

  // A/B projection for the note open in the editor (see ./otherRoutineEditing).
  const {
    editingHasABWeeks,
    editingEffectiveWeek,
    editingText,
    sessionAlignmentIssue,
    setEditingText,
    handleToggleEditingWeek,
    handleMergeEditingWeeks,
  } = useOtherEditingProjection({
    editingFullText,
    editingActiveWeek,
    setEditingFullText,
    setEditingActiveWeek,
    cancelPendingDraftRestore,
  });

  // #1500: every field the save persists, live vs canonical (see otherMetadata).
  const editingLiveMetadata = useMemo(() => otherMetadata({
    hasABWeeks: editingHasABWeeks, week: editingEffectiveWeek, linked: editingDeloadHasLinkedRecord,
    date: deloadEditDate, ordinal: deloadEditOrdinal,
  }), [editingHasABWeeks, editingEffectiveWeek, editingDeloadHasLinkedRecord, deloadEditDate, deloadEditOrdinal]);
  const editingCanonicalMetadata = useMemo(() => canonicalOtherMetadata({
    note: editingNote, hasABWeeks: editingHasABWeeks, record: editingDeloadRecord,
  }), [editingNote, editingHasABWeeks, editingDeloadRecord]);
  const otherTextChanged = !!editingNote
    && (editingTitle !== (editingNote.title || '') || editingFullText !== editingNote.raw_text);
  const hasUnsavedOther = !editingNoteId ? false
    : editingNoteId === 'new' ? editingTitle.trim() !== '' || editingFullText.trim() !== ''
      : !!editingNote && (otherTextChanged || !metadataMatches(editingLiveMetadata, editingCanonicalMetadata));
  // Gates the autosave: an unsavable partial value alone must not write.
  const hasPersistableOther = otherTextChanged
    || hasPersistableMetadataChange(editingLiveMetadata, editingCanonicalMetadata);
  // Live save inputs (#1500): Done's retries call a save closure from an older render.
  const liveSaveInputsRef = useRef(null);
  liveSaveInputsRef.current = {
    isDeload: isEditingDeloadNote, note: editingNote, record: editingDeloadRecord,
    dateTouched: deloadEditDateTouched, hasABWeeks: editingHasABWeeks, week: editingEffectiveWeek,
    canonical: editingCanonicalMetadata, persistable: hasPersistableOther, live: editingLiveMetadata,
  };
  const hasOtherConverged = (isNew) => otherDoneConverged({
    isNew, liveText: editingFullTextRef.current, liveTitle: editingTitleRef.current,
    liveMetadata: liveSaveInputsRef.current.live, savedText: lastSavedTextRef.current,
    savedTitle: lastSavedTitleRef.current, savedMetadata: lastSubmittedMetadataRef.current,
  });
  const hasUnsavedOtherRef = useRef(hasUnsavedOther);
  hasUnsavedOtherRef.current = hasUnsavedOther;

  const handleToggleViewingWeek = toggleViewingWeek(routineViewer, update);
  const handleToggleRecoveryViewingWeek = toggleViewingWeek(recoveryViewer, update);

  // Toggle-to-collapse (#836): tapping the same note again closes it, on both
  // the Routine tab and the Recovery tab.
  const handleViewOtherNote = (note) => {
    routineViewer.setViewingNoteId(prev => (prev === note.id ? null : note.id));
  };
  const handleViewRecoveryNote = (note) => {
    if (!note) return;
    recoveryViewer.setViewingNoteId(prev => (prev === note.id ? null : note.id));
  };

  // Leaving the editor removes the adoption prompt without writing anything
  // (#745 Part 5 §A1.3); `Not now` and a completed adoption are the others.
  const clearAdoptionPrompt = () => {
    setAdoptionPrompt(null);
    setAdoptionError('');
  };

  const handleSaveOtherNote = ({ autosave = false } = {}) => {
    if (saveOtherNoteInFlightRef.current) return saveOtherNoteInFlightRef.current;

    // Live refs, not closure state (#1474, #1500): Done's retries must see the
    // created id, newer edits, and newer metadata.
    const { isDeload, note, record, dateTouched, hasABWeeks, week, canonical } = liveSaveInputsRef.current;
    const savedNoteId = editingNoteIdRef.current;
    const savedSource = editingSourceRef.current;
    const snapshotText = editingFullTextRef.current;
    const snapshotTitle = editingTitleRef.current;
    const snapshotDeloadDate = deloadEditDateRef.current;
    const snapshotDeloadOrdinal = deloadEditOrdinalRef.current;
    const snapshotMetadata = otherMetadata({
      hasABWeeks, week, linked: !!record, date: snapshotDeloadDate, ordinal: snapshotDeloadOrdinal,
    });

    const run = async () => {
      savingOtherSnapshotRef.current = {
        noteId: savedNoteId,
        source: savedSource,
        title: snapshotTitle,
        raw_text: snapshotText,
        metadata: snapshotMetadata,
      };
      setNoteIsSaving(true);
      setSaveError('');
      setSaveSuccess('');
      // Establish the draft ordering boundary immediately without delaying the
      // canonical write on local draft bookkeeping.
      const draftCheckpointPromise = markWorkoutNoteDraftSaveStart().catch(() => null);
      try {
        let result;
        let titleToSave = snapshotTitle || 'Untitled Routine';
        if (isDeload && !titleToSave.startsWith(DELOAD_NOTE_PREFIX)) {
          titleToSave = DELOAD_NOTE_PREFIX + (snapshotDeloadDate || titleToSave);
        }
        if (savedNoteId === 'new') {
          // Id-stable create (#997): the durable attempt token is retired only
          // after full success, so a retry (even after restart) completes the
          // same note. Neither attempt-store write is swallowed — a rejection is
          // a failed save, never an uncorrelated create or a reusable stale id.
          const attemptToken = createAttemptTokenRef.current
            || await ensureWorkoutNoteCreationAttempt(OTHER_CREATE_ATTEMPT_KEY);
          createAttemptTokenRef.current = attemptToken;
          result = await add(titleToSave, snapshotText, { attemptToken });
          await clearWorkoutNoteCreationAttempt(OTHER_CREATE_ATTEMPT_KEY, attemptToken);
          createAttemptTokenRef.current = null;
          savingOtherSnapshotRef.current.noteId = result.id;
          editingNoteIdRef.current = result.id;
          setEditingNoteId(result.id);
          // The one write this action performs is the `add` above. Adoption is
          // offered, never performed here (#748) — see `adoptionPrompt`.
          if (!isDeload) {
            setAdoptionError('');
            setAdoptionPrompt({ id: result.id, title: titleToSave });
          }
          // add() creates with activeWeek: null, so a new A/B note persists its
          // selected week in a follow-up update; currentId is never touched.
          if (hasABWeeks && isValidActiveWeek(week)) {
            const withWeek = await update(result.id, { activeWeek: week });
            if (withWeek) result = withWeek;
          }
        } else {
          const patch = { title: titleToSave, raw_text: snapshotText };
          if (hasABWeeks && isValidActiveWeek(week)) {
            patch.activeWeek = week;
          } else if (!hasABWeeks && note?.activeWeek != null) {
            // The note used to be A/B but the separator is gone now (e.g.
            // handleMergeEditingWeeks): clear the stale selection so it can never
            // leak into a future A/B note.
            patch.activeWeek = null;
          }
          if (isDeload) {
            const histRecord = record;
            const deloadPatch = {};
            if (dateTouched && snapshotDeloadDate) {
              const newDate = snapshotDeloadDate;
              const savedDate = note?.saved_at?.slice(0, 10) ?? '';
              // The correctness property is a VALUE change, not mere interaction:
              // deloadEditDateTouched only gates entry, so opening the picker and
              // restoring the original date before saving must still leave
              // saved_at untouched (#764) — deliberately no `else` branch.
              if (newDate !== savedDate && histRecord) {
                deloadPatch.completed_at = `${newDate}T12:00:00.000Z`;
                patch.saved_at = `${newDate}T12:00:00.000Z`;
              }
            }
            if (histRecord) {
              const newOrdinal = parseInt(snapshotDeloadOrdinal, 10);
              if (!isNaN(newOrdinal) && newOrdinal !== histRecord.deload_session_ordinal) {
                deloadPatch.deload_session_ordinal = newOrdinal;
              }
              if (Object.keys(deloadPatch).length > 0) {
                await updateDeload(histRecord.id, deloadPatch);
              }
            }
          }
          result = await update(savedNoteId, patch);
        }
        if (!result) {
          setSaveError('Save failed');
          return false;
        } else {
          const identityUnchanged = savedNoteId === 'new'
            ? editingNoteIdRef.current === result.id
            : editingNoteIdRef.current === savedNoteId
              && editingSourceRef.current === savedSource;
          // Record what this save actually persisted so Done can tell whether the
          // live editor has since moved past it (the in-flight autosave race).
          if (identityUnchanged) {
            savingOtherSnapshotRef.current.noteId = result.id || savedNoteId;
            lastSavedNoteIdRef.current = result.id || savedNoteId;
            lastSavedSourceRef.current = savedSource;
            // A fulfilled mutation proves the submitted payload durable. The
            // adapter's return value may be partial, so exact-snapshot status
            // and Done convergence must use the payload itself.
            lastSavedTextRef.current = snapshotText;
            lastSavedTitleRef.current = titleToSave;
            lastSubmittedMetadataRef.current = snapshotMetadata;
            lastSavedMetadataRef.current = persistedOtherMetadata(snapshotMetadata, canonical, dateTouched);
            draftBaseUpdatedAtRef.current = result.updated_at ?? draftBaseUpdatedAtRef.current;
          }
          const contentUnchanged =
            editingFullTextRef.current === snapshotText &&
            editingTitleRef.current === snapshotTitle;
          if (contentUnchanged && identityUnchanged) {
            setEditingTitle(result.title || '');
            setEditingFullText(result.raw_text || '');
            if (!autosave) setSaveSuccess('Saved on device');
          }
          // Retire the saved snapshot and pre-save conflicts; preserve/rebase
          // any different draft written after the save checkpoint (see
          // reconcileDraftsAfterSave in ./useLogEditorSave).
          await reconcileDraftsAfterSave({
            preKey: otherDraftKey(savedNoteId, savedSource),
            postKey: otherDraftKey(result.id || savedNoteId, savedSource),
            checkpoint: await draftCheckpointPromise,
            savedSnapshot: { title: snapshotTitle, raw_text: snapshotText },
            latestSnapshot: {
              title: editingTitleRef.current,
              raw_text: editingFullTextRef.current,
            },
            identityUnchanged,
            resultUpdatedAt: result.updated_at,
          });
          return true;
        }
      } catch {
        setSaveError('Save failed');
        return false;
      } finally {
        setNoteIsSaving(false);
        saveOtherNoteInFlightRef.current = null;
      }
    };

    const promise = run();
    saveOtherNoteInFlightRef.current = promise;
    return promise;
  };

  const {
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
  } = useOtherEditorLifecycle({
    update, updateDeload, remove, deleteDeloadNote, deloadHistory,
    handleSaveOtherNote, clearAdoptionPrompt, routineViewer, recoveryViewer,
    editingNoteId, editingSource, originalNoteState, hasUnsavedOther,
    isEditingDeloadNote, editingDeloadHasLinkedRecord, deloadEditDate, deloadEditOrdinal,
    draftRestoreTokenRef, draftBaseUpdatedAtRef, preserveExistingDraftRef, draftRestorePendingRef,
    editingNoteIdRef, editingSourceRef, editingTitleRef, editingFullTextRef, notesRef,
    autosaveOtherTimerRef, saveOtherNoteInFlightRef, createAttemptTokenRef,
    hasOtherConverged,
    setEditingNoteId, setEditingSource, setEditingTitle, setEditingFullText, setEditingActiveWeek,
    setDeloadEditDate, setDeloadEditDateTouched, setDeloadEditOrdinal,
    setOriginalNoteState, setSaveError, setSaveSuccess,
  });

  const {
    handleSwitchCurrent,
    handleAdoptPromptedRoutine,
    showAdoptionPromptFor,
    handleDismissAdoptionPrompt,
  } = createOtherAdoptionHandlers({
    currentId, currentNote, notes, editingNoteId, hasUnsavedOther,
    currentEditorMode, hasUnsavedCurrent, handleSave, handleSaveOtherNote,
    selectCurrent, update, autosaveCurrentTimerRef, autosaveOtherTimerRef,
    setEditingNoteId, setEditingSource, setOriginalNoteState,
    adoptionPrompt, adoptionBusy, setAdoptionPrompt, setAdoptionError, setAdoptionBusy,
    routineViewer, recoveryViewer,
  });

  // Debounced autosave for a non-current (existing) note while in edit mode.
  useEffect(() => {
    if (!editingNoteId || editingNoteId === 'new' || !hasPersistableOther) return;
    if (autosaveOtherTimerRef.current) clearTimeout(autosaveOtherTimerRef.current);
    autosaveOtherTimerRef.current = setTimeout(async () => {
      autosaveOtherTimerRef.current = null;
      await runOtherAutosave({
        save: () => handleSaveOtherNote({ autosave: true }), inFlightRef: saveOtherNoteInFlightRef,
        identity: () => `${editingNoteIdRef.current}|${editingSourceRef.current}`,
        isStillPersistable: () => liveSaveInputsRef.current.persistable,
      });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveOtherTimerRef.current) {
        clearTimeout(autosaveOtherTimerRef.current);
        autosaveOtherTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingFullText, editingTitle, editingNoteId, deloadEditDate, deloadEditOrdinal, editingEffectiveWeek]);

  // Cheap draft persistence (#880): debounced write whenever the editor is open
  // (including editingNoteId === 'new', the gap the real autosave cannot cover)
  // plus an immediate flush on backgrounding. See ./editorDrafts.
  useEditorDraftPersistence({
    enabled: !!editingNoteId && hasUnsavedOther,
    debounceDeps: [editingFullText, editingTitle, editingNoteId, editingSource, hasUnsavedOther],
    timerRef: draftOtherTimerRef,
    writeDraftNow: writeOtherDraftNow,
    isFlushEligible: () => !!editingNoteIdRef.current && hasUnsavedOtherRef.current,
  });

  useEffect(() => {
    return () => {
      if (autosaveOtherTimerRef.current) clearTimeout(autosaveOtherTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (editingNoteId) {
      editorScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [editingNoteId, editorScrollRef]);

  const handleUndoOther = () => {
    const isDraft = editingNoteId === 'new';
    Alert.alert(
      isDraft ? 'Clear this draft?' : 'Revert this edit?',
      isDraft
        ? 'This clears everything entered in this unsaved routine.'
        : 'This restores the note to how it was when you opened the editor, including changes already autosaved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: isDraft ? 'Clear draft' : 'Revert this edit',
          style: 'destructive',
          onPress: performRevertOther,
        },
      ]
    );
  };

  // #880 BLOCKER 1: `Saved on device` binds to the exact persisted snapshot; see
  // deriveOtherSaveStatus in ./editorConvergence.
  const { boundSaveSuccess: boundOtherSaveSuccess, saveStatus } = deriveOtherSaveStatus({
    editingNoteId, editingSource, noteIsSaving, savingSnapshotRef: savingOtherSnapshotRef,
    editingTitle, editingFullText,
    lastSavedNoteIdRef, lastSavedSourceRef, lastSavedTitleRef, lastSavedTextRef, lastSavedMetadataRef,
    liveMetadata: editingLiveMetadata, canonicalMetadata: editingCanonicalMetadata,
    editingNote, pendingConvergence, saveSuccess,
  });

  return {
    editingNoteId,
    setEditingNoteId,
    pendingConvergence,
    saveStatus,
    cancelPendingDraftRestore,
    editingSource,
    editingTitle,
    setEditingTitle,
    editingText,
    setEditingText,
    noteIsSaving,
    saveError,
    setSaveError,
    saveSuccess: boundOtherSaveSuccess,
    setSaveSuccess,
    originalNoteState,
    setOriginalNoteState,
    // Routine-tab viewer (unchanged external names): LogPreviousRoutines and
    // LogDeloadSection keep consuming viewingNoteId/viewingNote/etc.
    viewingNoteId: routineViewer.viewingNoteId,
    setViewingNoteId: routineViewer.setViewingNoteId,
    // Recovery-tab viewer (#836): a fully separate slot.
    recoveryViewingNoteId: recoveryViewer.viewingNoteId,
    setRecoveryViewingNoteId: recoveryViewer.setViewingNoteId,
    recoveryViewingNote: recoveryViewer.viewingNote,
    recoveryViewingNoteDayGroups: recoveryViewer.viewingNoteDayGroups,
    recoveryViewingHasABWeeks: recoveryViewer.viewingHasABWeeks,
    recoveryViewingEffectiveWeek: recoveryViewer.viewingEffectiveWeek,
    handleToggleRecoveryViewingWeek,
    handleViewRecoveryNote,
    handleEditRecoveryViewedNote,
    handleCancelRecoveryEdit,
    // #881 exercise source-jump wiring
    pendingSourceJump,
    clearPendingSourceJump,
    handleRoutineExerciseSourceJump,
    handleRecoveryExerciseSourceJump,
    viewingActiveText: routineViewer.viewingActiveText,
    recoveryViewingActiveText: recoveryViewer.viewingActiveText,
    deloadEditDate,
    // Wrapped so any UI-driven change marks the date as explicitly touched
    // (#764) — a title-/text-only edit must never fall into the date-handling
    // save branch just because deloadEditDate is seeded from saved_at.
    setDeloadEditDate: (d) => {
      setDeloadEditDate(d);
      setDeloadEditDateTouched(true);
    },
    showDeloadDatePicker,
    setShowDeloadDatePicker,
    deloadEditOrdinal,
    setDeloadEditOrdinal,
    autosaveOtherTimerRef,
    editingNote,
    isEditingDeloadNote,
    editingDeloadHasLinkedRecord,
    hasUnsavedOther,
    editingHasABWeeks,
    editingEffectiveWeek,
    sessionAlignmentIssue,
    handleToggleEditingWeek,
    handleMergeEditingWeeks,
    viewingNote: routineViewer.viewingNote,
    viewingNoteDayGroups: routineViewer.viewingNoteDayGroups,
    viewingHasABWeeks: routineViewer.viewingHasABWeeks,
    viewingEffectiveWeek: routineViewer.viewingEffectiveWeek,
    handleToggleViewingWeek,
    handleViewOtherNote,
    handleEditViewedNote,
    handleOpenOtherNote,
    handleSaveOtherNote,
    handleDoneOther,
    handleUndoOther,
    handleDeleteRoutine,
    handleDeleteDeloadNoteFromEditor,
    handleCreateRoutine,
    handleSwitchCurrent,
    adoptionPrompt,
    adoptionError,
    adoptionBusy,
    handleAdoptPromptedRoutine,
    handleDismissAdoptionPrompt,
    showAdoptionPromptFor,
  };
}
