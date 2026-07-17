import { useState, useEffect, useRef, useMemo } from 'react';
import { Alert } from 'react-native';
import { parseWorkoutNote } from '../../lib/parser';
import {
  findMatchingExerciseNames,
  rolloverOneKExercises,
  normalizeExerciseKey,
  DEFAULT_1K_EXERCISES,
} from '../../lib/data';
import { DELOAD_NOTE_PREFIX, AUTOSAVE_DEBOUNCE_MS } from '../../lib/LogScreenHelpers';
import { buildDayGroups } from './logScreenHelpers';

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
  deloadDateEditEnabled,
  autosaveCurrentTimerRef,
  handleSave,
  currentEditorMode,
  hasUnsavedCurrent,
  editorScrollRef,
}) {
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingText, setEditingText] = useState('');
  const [noteIsSaving, setNoteIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [originalNoteState, setOriginalNoteState] = useState(null);
  const [viewingNoteId, setViewingNoteId] = useState(null);
  const [deloadEditDate, setDeloadEditDate] = useState('');
  const [showDeloadDatePicker, setShowDeloadDatePicker] = useState(false);
  const [deloadEditOrdinal, setDeloadEditOrdinal] = useState('');

  const autosaveOtherTimerRef = useRef(null);
  const saveOtherNoteInFlightRef = useRef(null);

  // The raw editor content most recently persisted by handleSaveOtherNote. Done
  // compares the live editor against this to detect trailing keystrokes that an
  // in-flight autosave for older content did not save.
  const lastSavedTextRef = useRef(null);
  const lastSavedTitleRef = useRef(null);

  // Live-value refs so async save callbacks read current state without stale closures.
  const editingTextRef = useRef(editingText);
  const editingTitleRef = useRef(editingTitle);
  const editingNoteIdRef = useRef(editingNoteId);
  editingTextRef.current = editingText;
  editingTitleRef.current = editingTitle;
  editingNoteIdRef.current = editingNoteId;

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  const editingNote = useMemo(() =>
    (editingNoteId && editingNoteId !== 'new') ? notes.find(n => n.id === editingNoteId) : null
  , [editingNoteId, notes]);

  const isEditingDeloadNote = !!editingNote?.title?.startsWith(DELOAD_NOTE_PREFIX);

  // True only when the deload note being edited has a linked history record.
  // Legacy deload notes without a note_id match are read-only for date edits.
  const editingDeloadHasLinkedRecord = useMemo(() =>
    isEditingDeloadNote ? deloadHistory.some(r => r.note_id === editingNoteId) : false,
  [isEditingDeloadNote, deloadHistory, editingNoteId]);

  const hasUnsavedOther = useMemo(() => {
    if (!editingNoteId) return false;
    if (editingNoteId === 'new') return editingTitle.trim() !== '' || editingText.trim() !== '';
    if (!editingNote) return false;
    const textChanged = editingTitle !== (editingNote.title || '') || editingText !== editingNote.raw_text;
    const dateChanged = isEditingDeloadNote && deloadDateEditEnabled && editingDeloadHasLinkedRecord
      ? deloadEditDate !== (editingNote.saved_at?.slice(0, 10) ?? '')
      : false;
    const ordinalChanged = isEditingDeloadNote && deloadDateEditEnabled && editingDeloadHasLinkedRecord
      ? (() => {
          const r = deloadHistory.find(h => h.note_id === editingNoteId);
          const orig = r?.deload_session_ordinal != null ? String(r.deload_session_ordinal) : '';
          return deloadEditOrdinal !== orig;
        })()
      : false;
    return textChanged || dateChanged || ordinalChanged;
  }, [editingNoteId, editingNote, editingTitle, editingText, isEditingDeloadNote, deloadDateEditEnabled, deloadEditDate, deloadEditOrdinal, editingDeloadHasLinkedRecord, deloadHistory]);

  const viewingNote = useMemo(() =>
    viewingNoteId ? notes.find(n => n.id === viewingNoteId) : null
  , [viewingNoteId, notes]);

  const viewingNoteParsed = useMemo(() =>
    viewingNote ? parseWorkoutNote(viewingNote.raw_text || '') : null
  , [viewingNote]);

  const viewingNoteDayGroups = useMemo(() => {
    if (!viewingNoteParsed) return [];
    return buildDayGroups(viewingNoteParsed.sections);
  }, [viewingNoteParsed]);

  // Debounced autosave for a non-current (existing) note while in edit mode.
  useEffect(() => {
    if (!editingNoteId || editingNoteId === 'new' || !hasUnsavedOther) return;
    if (autosaveOtherTimerRef.current) clearTimeout(autosaveOtherTimerRef.current);
    autosaveOtherTimerRef.current = setTimeout(async () => {
      autosaveOtherTimerRef.current = null;
      await handleSaveOtherNote({ autosave: true });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveOtherTimerRef.current) {
        clearTimeout(autosaveOtherTimerRef.current);
        autosaveOtherTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText, editingTitle, editingNoteId, deloadEditDate]);

  useEffect(() => {
    return () => {
      if (autosaveOtherTimerRef.current) clearTimeout(autosaveOtherTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (editingNoteId) {
      editorScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [editingNoteId]);

  const handleViewOtherNote = (note) => {
    setViewingNoteId(prev => (prev === note.id ? null : note.id));
  };

  const handleEditViewedNote = () => {
    if (!viewingNote) return;
    setEditingNoteId(viewingNote.id);
    setEditingTitle(viewingNote.title || '');
    setEditingText(viewingNote.raw_text);
    setDeloadEditDate(viewingNote.saved_at ? viewingNote.saved_at.slice(0, 10) : '');
    const _histRec = deloadHistory.find(r => r.note_id === viewingNote.id);
    const initialOrdinal = _histRec?.deload_session_ordinal != null ? String(_histRec.deload_session_ordinal) : '';
    setDeloadEditOrdinal(initialOrdinal);
    setOriginalNoteState({
      id: viewingNote.id,
      title: viewingNote.title || '',
      text: viewingNote.raw_text,
      date: viewingNote.saved_at ? viewingNote.saved_at.slice(0, 10) : '',
      ordinal: initialOrdinal,
    });
    setSaveError('');
    setSaveSuccess('');
  };

  const handleOpenOtherNote = (other) => {
    setEditingNoteId(other.id);
    setEditingTitle(other.title || '');
    setEditingText(other.raw_text);
    setDeloadEditDate(other.saved_at ? other.saved_at.slice(0, 10) : '');
    const _histRec = deloadHistory.find(r => r.note_id === other.id);
    const initialOrdinal = _histRec?.deload_session_ordinal != null ? String(_histRec.deload_session_ordinal) : '';
    setDeloadEditOrdinal(initialOrdinal);
    setOriginalNoteState({
      id: other.id,
      title: other.title || '',
      text: other.raw_text,
      date: other.saved_at ? other.saved_at.slice(0, 10) : '',
      ordinal: initialOrdinal,
    });
    setSaveError('');
    setSaveSuccess('');
  };

  const handleSaveOtherNote = ({ autosave = false } = {}) => {
    if (saveOtherNoteInFlightRef.current) return saveOtherNoteInFlightRef.current;

    const savedNoteId = editingNoteId;
    const snapshotText = editingText;
    const snapshotTitle = editingTitle;

    const run = async () => {
      setNoteIsSaving(true);
      setSaveError('');
      setSaveSuccess('');
      try {
        let result;
        let titleToSave = editingTitle || 'Untitled Routine';
        if (isEditingDeloadNote && !titleToSave.startsWith(DELOAD_NOTE_PREFIX)) {
          titleToSave = DELOAD_NOTE_PREFIX + (deloadEditDate || titleToSave);
        }
        if (editingNoteId === 'new') {
          result = await add(titleToSave, editingText);
          setEditingNoteId(result.id);
        } else {
          const patch = { title: titleToSave, raw_text: editingText };
          if (isEditingDeloadNote && deloadDateEditEnabled) {
            const histRecord = editingDeloadHasLinkedRecord
              ? deloadHistory.find(r => r.note_id === editingNoteId)
              : null;
            const deloadPatch = {};
            if (deloadEditDate) {
              const newDate = deloadEditDate;
              const savedDate = editingNote?.saved_at?.slice(0, 10) ?? '';
              if (newDate !== savedDate) {
                if (histRecord) {
                  deloadPatch.completed_at = `${newDate}T12:00:00.000Z`;
                  patch.saved_at = `${newDate}T12:00:00.000Z`;
                }
              } else {
                patch.saved_at = `${newDate}T12:00:00.000Z`;
              }
            }
            if (histRecord) {
              const newOrdinal = parseInt(deloadEditOrdinal, 10);
              if (!isNaN(newOrdinal) && newOrdinal !== histRecord.deload_session_ordinal) {
                deloadPatch.deload_session_ordinal = newOrdinal;
              }
              if (Object.keys(deloadPatch).length > 0) {
                await updateDeload(histRecord.id, deloadPatch);
              }
            }
          }
          result = await update(editingNoteId, patch);
        }
        if (!result) {
          setSaveError('Save failed');
          return false;
        } else {
          // Record what this save actually persisted so Done can tell whether the
          // live editor has since moved past it (the in-flight autosave race).
          lastSavedTextRef.current = snapshotText;
          lastSavedTitleRef.current = snapshotTitle;
          const contentUnchanged =
            editingTextRef.current === snapshotText &&
            editingTitleRef.current === snapshotTitle;
          const identityUnchanged =
            savedNoteId === 'new' || editingNoteIdRef.current === savedNoteId;
          if (contentUnchanged && identityUnchanged) {
            setEditingTitle(result.title || '');
            setEditingText(result.raw_text || '');
            if (!autosave) setSaveSuccess('Saved!');
          }
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
      setOriginalNoteState(null);
      return;
    }
    if (hasUnsavedOther) {
      // Save, then flush. handleSaveOtherNote coalesces onto an in-flight autosave
      // that may still be persisting older content, so once it settles we compare
      // the live editor against what was actually saved and save again if the user
      // typed past it. The loop only continues while newer content exists, and a
      // guard caps it so rapid edits can never spin unbounded — if it somehow does
      // not converge we keep the editor open rather than close on unsaved text.
      let ok = await handleSaveOtherNote();
      if (!ok) return;
      let guard = 0;
      while (
        editingTextRef.current !== lastSavedTextRef.current ||
        editingTitleRef.current !== lastSavedTitleRef.current
      ) {
        if (guard >= 5) return;
        guard += 1;
        ok = await handleSaveOtherNote();
        if (!ok) return;
      }
    }
    setEditingNoteId(null);
    setOriginalNoteState(null);
  };

  const handleUndoOther = async () => {
    if (editingNoteId === 'new') {
      setEditingTitle('');
      setEditingText('');
      return;
    }
    if (!originalNoteState) return;
    if (autosaveOtherTimerRef.current) {
      clearTimeout(autosaveOtherTimerRef.current);
      autosaveOtherTimerRef.current = null;
    }
    let rolledBackDeload = false;
    let deloadRevertPatch = null;
    try {
      const patch = {
        title: originalNoteState.title,
        raw_text: originalNoteState.text,
      };
      if (isEditingDeloadNote && deloadDateEditEnabled) {
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
      setEditingText(originalNoteState.text);
      if (isEditingDeloadNote && deloadDateEditEnabled) {
        setDeloadEditDate(originalNoteState.date);
        setDeloadEditOrdinal(originalNoteState.ordinal);
      }
    } catch (err) {
      console.warn('Undo revert failed:', err);
      Alert.alert('Error', 'Failed to revert changes. Please try again.');
    }
  };

  const handleDeleteRoutine = (id, title, isCurrent) => {
    Alert.alert(
      'Delete Routine',
      isCurrent
        ? `"${title}" is your current active routine. Deleting it will affect your analytics. Are you sure?`
        : `Are you sure you want to delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await remove(id);
            setEditingNoteId(null);
            setOriginalNoteState(null);
            setViewingNoteId(null);
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
            await deleteDeloadNote(editingNoteId);
            setEditingNoteId(null);
            setOriginalNoteState(null);
          },
        },
      ]
    );
  };

  const handleCreateRoutine = () => {
    setOriginalNoteState(null);
    setEditingNoteId('new');
    setEditingTitle('');
    setEditingText('');
    setSaveError('');
    setSaveSuccess('');
  };

  const handleSwitchCurrent = (id) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    const hasUnsaved = editingNoteId ? hasUnsavedOther : (currentEditorMode === 'edit' ? hasUnsavedCurrent : false);

    const doSwitch = async ({ rollover = false } = {}) => {
      if (autosaveCurrentTimerRef.current) {
        clearTimeout(autosaveCurrentTimerRef.current);
        autosaveCurrentTimerRef.current = null;
      }
      if (autosaveOtherTimerRef.current) {
        clearTimeout(autosaveOtherTimerRef.current);
        autosaveOtherTimerRef.current = null;
      }
      if (rollover && currentNote) {
        try {
          const oldSections = parseWorkoutNote(currentNote.raw_text || '').sections;
          const newSections = parseWorkoutNote(note.raw_text || '').sections;
          const matchedNames = findMatchingExerciseNames(oldSections, newSections);
          if (matchedNames.length > 0) {
            const matchedKeys = new Set(matchedNames.map(n => normalizeExerciseKey(n)));
            const oldOneK = { ...DEFAULT_1K_EXERCISES, ...(currentNote.one_k_exercises || {}) };
            const rolledOneK = rolloverOneKExercises(oldOneK, matchedKeys);
            if (rolledOneK) {
              await update(id, { one_k_exercises: rolledOneK });
            }
          }
        } catch (e) {
          console.warn('[doSwitch] rollover failed, continuing with switch', e);
        }
      }
      await selectCurrent(id);
      setEditingNoteId(null);
      setOriginalNoteState(null);
      setViewingNoteId(null);
    };

    const confirmSwitch = () => {
      const oldSections = parseWorkoutNote(currentNote?.raw_text || '').sections;
      const newSections = parseWorkoutNote(note.raw_text || '').sections;
      const matchedNames = findMatchingExerciseNames(oldSections, newSections);
      const hasMatches = matchedNames.length > 0;

      if (hasMatches) {
        Alert.alert(
          'Keep current progress?',
          'Some exercises match your current routine. Carry over your 1K exercise slot selections?',
          [
            { text: 'No', onPress: () => doSwitch({ rollover: false }) },
            { text: 'Yes', onPress: () => doSwitch({ rollover: true }) },
          ]
        );
      } else {
        doSwitch({ rollover: false });
      }
    };

    const alertTitle = 'Set as current routine';
    let alertMessage = `Switching to "${note.title || 'Untitled Routine'}" will affect your analytics. Are you sure?`;

    if (hasUnsaved) {
      alertMessage = `You have unsaved changes that will be lost if you switch. Continue?`;
      Alert.alert(
        alertTitle,
        alertMessage,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch Anyway', style: 'destructive', onPress: confirmSwitch },
          {
            text: 'Save & Switch',
            onPress: async () => {
              if (autosaveCurrentTimerRef.current) {
                clearTimeout(autosaveCurrentTimerRef.current);
                autosaveCurrentTimerRef.current = null;
              }
              if (autosaveOtherTimerRef.current) {
                clearTimeout(autosaveOtherTimerRef.current);
                autosaveOtherTimerRef.current = null;
              }
              let ok = false;
              if (editingNoteId) {
                ok = await handleSaveOtherNote();
              } else {
                ok = await handleSave();
              }
              if (ok) confirmSwitch();
            },
          },
        ]
      );
    } else {
      Alert.alert(
        alertTitle,
        alertMessage,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set as current routine', onPress: confirmSwitch },
        ]
      );
    }
  };

  return {
    editingNoteId,
    setEditingNoteId,
    editingTitle,
    setEditingTitle,
    editingText,
    setEditingText,
    noteIsSaving,
    saveError,
    setSaveError,
    saveSuccess,
    setSaveSuccess,
    originalNoteState,
    setOriginalNoteState,
    viewingNoteId,
    setViewingNoteId,
    deloadEditDate,
    setDeloadEditDate,
    showDeloadDatePicker,
    setShowDeloadDatePicker,
    deloadEditOrdinal,
    setDeloadEditOrdinal,
    autosaveOtherTimerRef,
    editingNote,
    isEditingDeloadNote,
    editingDeloadHasLinkedRecord,
    hasUnsavedOther,
    viewingNote,
    viewingNoteDayGroups,
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
  };
}
