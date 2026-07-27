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

function isValidActiveWeek(value) {
  return value === 'A' || value === 'B';
}

// Splits raw note text on a standalone '---' line, returning the requested
// half (or the full text unchanged when there is no boundary). Mirrors the
// slicing used by the current-routine editor (useLogCurrentRoutineEditor's
// activeEditText/handleCurrentTextChange) so non-current A/B notes behave
// identically.
function sliceActiveWeekText(fullText, week) {
  const lines = (fullText || '').split('\n');
  const sepIdx = lines.findIndex(l => l.trim() === '---');
  if (sepIdx === -1) return fullText || '';
  if (week === 'B') return lines.slice(sepIdx + 1).join('\n');
  return lines.slice(0, sepIdx).join('\n');
}

function spliceActiveWeekText(fullText, week, newActiveText) {
  const lines = (fullText || '').split('\n');
  const sepIdx = lines.findIndex(l => l.trim() === '---');
  if (sepIdx === -1) return newActiveText;
  const weekAText = lines.slice(0, sepIdx).join('\n');
  const weekBText = lines.slice(sepIdx + 1).join('\n');
  if (week === 'A') return newActiveText + '\n---\n' + weekBText;
  return weekAText + '\n---\n' + newActiveText;
}

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
  // Full underlying raw_text being edited (both A/B halves + separator, when
  // present). The publicly exposed `editingText`/`setEditingText` below
  // project this down to the currently selected week, mirroring the
  // current-routine editor's workoutNoteText/activeEditText split.
  const [editingFullText, setEditingFullText] = useState('');
  const [editingActiveWeek, setEditingActiveWeek] = useState(null);
  const [noteIsSaving, setNoteIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [originalNoteState, setOriginalNoteState] = useState(null);
  const [viewingNoteId, setViewingNoteId] = useState(null);
  // Per-note selected week for the expanded (non-current) viewing card. Reset
  // whenever the viewed note changes to that note's own persisted `activeWeek`
  // (or 'A' when missing/invalid), so switching between routines never bleeds
  // one note's selection into another's.
  const [viewingActiveWeek, setViewingActiveWeek] = useState(null);
  const [deloadEditDate, setDeloadEditDate] = useState('');
  const [showDeloadDatePicker, setShowDeloadDatePicker] = useState(false);
  const [deloadEditOrdinal, setDeloadEditOrdinal] = useState('');

  const autosaveOtherTimerRef = useRef(null);
  const saveOtherNoteInFlightRef = useRef(null);

  // The editor fields most recently persisted by handleSaveOtherNote. Done
  // compares the live editor against these to detect any field an in-flight
  // autosave for older content did not save — every field hasUnsavedOther tracks
  // (text, title, and linked-deload date/ordinal) must be covered or a metadata
  // edit made during the race is lost.
  const lastSavedTextRef = useRef(null);
  const lastSavedTitleRef = useRef(null);
  const lastSavedDeloadDateRef = useRef(null);
  const lastSavedDeloadOrdinalRef = useRef(null);

  // Live-value refs so async save callbacks read current state without stale closures.
  const editingFullTextRef = useRef(editingFullText);
  const editingTitleRef = useRef(editingTitle);
  const editingNoteIdRef = useRef(editingNoteId);
  const deloadEditDateRef = useRef(deloadEditDate);
  const deloadEditOrdinalRef = useRef(deloadEditOrdinal);
  editingFullTextRef.current = editingFullText;
  editingTitleRef.current = editingTitle;
  editingNoteIdRef.current = editingNoteId;
  deloadEditDateRef.current = deloadEditDate;
  deloadEditOrdinalRef.current = deloadEditOrdinal;

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

  // hasABWeeks / effective selected week for the note currently open in the
  // editor, derived from the full underlying text (both halves), mirroring
  // useLogCurrentRoutineEditor's hasABWeeks/effectiveActiveWeek.
  const editingParsed = useMemo(() => parseWorkoutNote(editingFullText), [editingFullText]);
  const editingHasABWeeks = (editingParsed.weekBStartIndex ?? null) !== null;
  const editingEffectiveWeek = editingHasABWeeks ? (editingActiveWeek ?? 'A') : null;

  // The publicly exposed editor text: the selected week's body only, for A/B
  // notes, or the full text otherwise. This is what LogScreenEditorCard binds
  // its input to.
  const editingText = useMemo(
    () => (editingHasABWeeks ? sliceActiveWeekText(editingFullText, editingEffectiveWeek) : editingFullText),
    [editingFullText, editingHasABWeeks, editingEffectiveWeek]
  );

  // Setter bound to the editor input: splices the edited half back into the
  // full underlying text, preserving the other week and the separator.
  const setEditingText = (newActiveText) => {
    if (!editingHasABWeeks) {
      setEditingFullText(newActiveText);
      return;
    }
    setEditingFullText(spliceActiveWeekText(editingFullText, editingEffectiveWeek, newActiveText));
  };

  const handleToggleEditingWeek = () => {
    if (!editingHasABWeeks) return;
    setEditingActiveWeek(prev => ((prev ?? 'A') === 'B' ? 'A' : 'B'));
  };

  // Explicit boundary-removal action: merges Week A and Week B back into a
  // single-week note. Chosen semantics — Week A's authored body, then a
  // single blank-line join, then Week B's authored body, so no text from
  // either week is lost and nothing is reordered. The note becomes a plain
  // (non-A/B) note: editingHasABWeeks recomputes to false on the next
  // render (there is no longer a standalone '---' line), the Week toggle
  // disappears, and editingActiveWeek is cleared so a stale selection can't
  // leak into a future save. The persisted activeWeek field is reconciled
  // (cleared) by handleSaveOtherNote once this merge is saved.
  const handleMergeEditingWeeks = () => {
    if (!editingHasABWeeks) return;
    const weekAText = sliceActiveWeekText(editingFullText, 'A');
    const weekBText = sliceActiveWeekText(editingFullText, 'B');
    setEditingFullText(weekAText + '\n\n' + weekBText);
    setEditingActiveWeek(null);
  };

  const hasUnsavedOther = useMemo(() => {
    if (!editingNoteId) return false;
    if (editingNoteId === 'new') return editingTitle.trim() !== '' || editingFullText.trim() !== '';
    if (!editingNote) return false;
    const textChanged = editingTitle !== (editingNote.title || '') || editingFullText !== editingNote.raw_text;
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
  }, [editingNoteId, editingNote, editingTitle, editingFullText, isEditingDeloadNote, deloadDateEditEnabled, deloadEditDate, deloadEditOrdinal, editingDeloadHasLinkedRecord, deloadHistory]);

  const viewingNote = useMemo(() =>
    viewingNoteId ? notes.find(n => n.id === viewingNoteId) : null
  , [viewingNoteId, notes]);

  const viewingNoteParsed = useMemo(() =>
    viewingNote ? parseWorkoutNote(viewingNote.raw_text || '') : null
  , [viewingNote]);

  const viewingHasABWeeks = !!viewingNoteParsed && (viewingNoteParsed.weekBStartIndex ?? null) !== null;
  const viewingEffectiveWeek = viewingHasABWeeks ? (viewingActiveWeek ?? 'A') : null;

  // Reset the viewed note's selected week whenever the viewed note changes,
  // seeding from that note's own persisted activeWeek (defaulting to Week A
  // for a legacy note with no valid selection), so each routine remembers its
  // own selection independently.
  useEffect(() => {
    if (!viewingNoteId) {
      setViewingActiveWeek(null);
      return;
    }
    const note = notes.find(n => n.id === viewingNoteId);
    const persisted = isValidActiveWeek(note?.activeWeek) ? note.activeWeek : null;
    setViewingActiveWeek(persisted ?? 'A');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingNoteId]);

  const viewingActiveText = useMemo(() => {
    if (!viewingNote) return '';
    if (!viewingHasABWeeks) return viewingNote.raw_text || '';
    return sliceActiveWeekText(viewingNote.raw_text || '', viewingEffectiveWeek);
  }, [viewingNote, viewingHasABWeeks, viewingEffectiveWeek]);

  const viewingNoteProjectedParsed = useMemo(() => {
    if (!viewingNote) return null;
    return viewingHasABWeeks ? parseWorkoutNote(viewingActiveText) : viewingNoteParsed;
  }, [viewingNote, viewingHasABWeeks, viewingActiveText, viewingNoteParsed]);

  const viewingNoteDayGroups = useMemo(() => {
    if (!viewingNoteProjectedParsed) return [];
    return buildDayGroups(viewingNoteProjectedParsed.sections);
  }, [viewingNoteProjectedParsed]);

  // Toggles the expanded (non-current) card's selected week and persists it
  // through the note's existing activeWeek field — never touching currentId,
  // so this never affects which routine is current.
  const handleToggleViewingWeek = async () => {
    if (!viewingNoteId || !viewingHasABWeeks) return;
    const previous = viewingEffectiveWeek ?? 'A';
    const next = previous === 'B' ? 'A' : 'B';
    setViewingActiveWeek(next);
    try {
      const updated = await update(viewingNoteId, { activeWeek: next });
      if (!updated) setViewingActiveWeek(previous);
    } catch (err) {
      setViewingActiveWeek(previous);
      throw err;
    }
  };

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
  }, [editingFullText, editingTitle, editingNoteId, deloadEditDate]);

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
    setEditingFullText(viewingNote.raw_text);
    // Continue editing whichever week the expanded card was showing, so the
    // editor never silently switches weeks on entry.
    setEditingActiveWeek(viewingHasABWeeks ? viewingEffectiveWeek : null);
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
      activeWeek: viewingHasABWeeks ? viewingEffectiveWeek : null,
    });
    setSaveError('');
    setSaveSuccess('');
  };

  const handleOpenOtherNote = (other) => {
    setEditingNoteId(other.id);
    setEditingTitle(other.title || '');
    setEditingFullText(other.raw_text);
    const _persistedWeek = isValidActiveWeek(other.activeWeek) ? other.activeWeek : null;
    setEditingActiveWeek(_persistedWeek);
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
      activeWeek: _persistedWeek,
    });
    setSaveError('');
    setSaveSuccess('');
  };

  const handleSaveOtherNote = ({ autosave = false } = {}) => {
    if (saveOtherNoteInFlightRef.current) return saveOtherNoteInFlightRef.current;

    const savedNoteId = editingNoteId;
    const snapshotText = editingFullText;
    const snapshotTitle = editingTitle;
    const snapshotDeloadDate = deloadEditDate;
    const snapshotDeloadOrdinal = deloadEditOrdinal;

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
          result = await add(titleToSave, editingFullText);
          setEditingNoteId(result.id);
        } else {
          const patch = { title: titleToSave, raw_text: editingFullText };
          if (editingHasABWeeks && isValidActiveWeek(editingEffectiveWeek)) {
            patch.activeWeek = editingEffectiveWeek;
          } else if (!editingHasABWeeks && editingNote?.activeWeek != null) {
            // The note used to be A/B (had a persisted selection) but the
            // separator is gone now (e.g. handleMergeEditingWeeks): clear the
            // stale selection so it can never leak into a future A/B note.
            patch.activeWeek = null;
          }
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
          lastSavedDeloadDateRef.current = snapshotDeloadDate;
          lastSavedDeloadOrdinalRef.current = snapshotDeloadOrdinal;
          const contentUnchanged =
            editingFullTextRef.current === snapshotText &&
            editingTitleRef.current === snapshotTitle;
          const identityUnchanged =
            savedNoteId === 'new' || editingNoteIdRef.current === savedNoteId;
          if (contentUnchanged && identityUnchanged) {
            setEditingTitle(result.title || '');
            setEditingFullText(result.raw_text || '');
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
        editingFullTextRef.current !== lastSavedTextRef.current ||
        editingTitleRef.current !== lastSavedTitleRef.current ||
        deloadEditDateRef.current !== lastSavedDeloadDateRef.current ||
        deloadEditOrdinalRef.current !== lastSavedDeloadOrdinalRef.current
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
      setEditingFullText('');
      setEditingActiveWeek(null);
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
      if (isValidActiveWeek(originalNoteState.activeWeek)) {
        patch.activeWeek = originalNoteState.activeWeek;
      }
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
      setEditingFullText(originalNoteState.text);
      setEditingActiveWeek(originalNoteState.activeWeek ?? null);
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
    setEditingFullText('');
    setEditingActiveWeek(null);
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
    editingHasABWeeks,
    editingEffectiveWeek,
    handleToggleEditingWeek,
    handleMergeEditingWeeks,
    viewingNote,
    viewingNoteDayGroups,
    viewingHasABWeeks,
    viewingEffectiveWeek,
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
  };
}
