import { useState, useEffect, useRef, useMemo } from 'react';
import { Alert } from '../../lib/platformAlert';
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

// One independent "which note is expanded, and which A/B half" slot (#836).
// Instantiated once for the Routine tab (LogPreviousRoutines) and once for the
// Recovery tab (LogRecoverySection) so the two tabs never share a viewed note:
// switching tabs must not leak Recovery's expansion into Routine or vice versa.
function useNoteViewer(notes) {
  const [viewingNoteId, setViewingNoteId] = useState(null);
  // Per-note selected week for the expanded card. Reset whenever the viewed
  // note changes to that note's own persisted `activeWeek` (or 'A' when
  // missing/invalid), so switching between routines never bleeds one note's
  // selection into another's.
  const [viewingActiveWeek, setViewingActiveWeek] = useState(null);

  const viewingNote = useMemo(() =>
    viewingNoteId ? notes.find(n => n.id === viewingNoteId) : null
  , [viewingNoteId, notes]);

  const viewingNoteParsed = useMemo(() =>
    viewingNote ? parseWorkoutNote(viewingNote.raw_text || '') : null
  , [viewingNote]);

  const viewingHasABWeeks = !!viewingNoteParsed && (viewingNoteParsed.weekBStartIndex ?? null) !== null;
  const viewingEffectiveWeek = viewingHasABWeeks ? (viewingActiveWeek ?? 'A') : null;

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

  return {
    viewingNoteId,
    setViewingNoteId,
    viewingNote,
    viewingNoteDayGroups,
    viewingHasABWeeks,
    viewingEffectiveWeek,
    viewingActiveWeek,
    setViewingActiveWeek,
  };
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
  // Two independent viewer slots (#836): `routineViewer` backs the Routine
  // tab (LogPreviousRoutines and the deload viewer), `recoveryViewer` backs
  // the Recovery tab (LogRecoverySection). Keeping them as separate
  // `useNoteViewer` instances — not one shared `viewingNoteId` — is what makes
  // an expanded note on one tab invisible on the other: switching tabs can
  // never leak or inherit the other tab's expansion.
  const routineViewer = useNoteViewer(notes);
  const recoveryViewer = useNoteViewer(notes);
  const [deloadEditDate, setDeloadEditDate] = useState('');
  // Tracks whether the user actually interacted with the compact "Date ·
  // <value>" disclosure (#764 feedback). deloadEditDate is seeded from the
  // note's existing saved_at on open, so a title- or text-only edit must not
  // fall into the date-handling branch below and stamp saved_at to noon —
  // only an explicit user change should touch it.
  const [deloadEditDateTouched, setDeloadEditDateTouched] = useState(false);
  const [showDeloadDatePicker, setShowDeloadDatePicker] = useState(false);
  const [deloadEditOrdinal, setDeloadEditOrdinal] = useState('');

  // Post-save adoption prompt (#748; #745 Part 4 §A1). Saving a routine NEVER
  // adopts it — `Save` performs exactly one write, `add(title, text)`. This
  // lightweight, non-modal, dismissible prompt then offers the choice. It is
  // deliberately not an `Alert`: a user who saved a backlog routine and intends
  // to walk away must be able to ignore it. It persists until acted on or the
  // editor is left, and no dismissal flag is ever written (Part 3 rule 0.3).
  const [adoptionPrompt, setAdoptionPrompt] = useState(null); // { id, title } | null
  const [adoptionError, setAdoptionError] = useState('');
  const [adoptionBusy, setAdoptionBusy] = useState(false);

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
    const dateChanged = isEditingDeloadNote && editingDeloadHasLinkedRecord
      ? deloadEditDate !== (editingNote.saved_at?.slice(0, 10) ?? '')
      : false;
    const ordinalChanged = isEditingDeloadNote && editingDeloadHasLinkedRecord
      ? (() => {
          const r = deloadHistory.find(h => h.note_id === editingNoteId);
          const orig = r?.deload_session_ordinal != null ? String(r.deload_session_ordinal) : '';
          return deloadEditOrdinal !== orig;
        })()
      : false;
    return textChanged || dateChanged || ordinalChanged;
  }, [editingNoteId, editingNote, editingTitle, editingFullText, isEditingDeloadNote, deloadEditDate, deloadEditOrdinal, editingDeloadHasLinkedRecord, deloadHistory]);

  // Toggles an expanded card's selected week and persists it through the
  // note's existing activeWeek field — never touching currentId, so this
  // never affects which routine is current. One implementation shared by
  // both viewer slots (#836), parameterized on which one is toggling.
  const makeToggleViewingWeek = (viewer) => async () => {
    if (!viewer.viewingNoteId || !viewer.viewingHasABWeeks) return;
    const previous = viewer.viewingEffectiveWeek ?? 'A';
    const next = previous === 'B' ? 'A' : 'B';
    viewer.setViewingActiveWeek(next);
    try {
      const updated = await update(viewer.viewingNoteId, { activeWeek: next });
      if (!updated) viewer.setViewingActiveWeek(previous);
    } catch (err) {
      viewer.setViewingActiveWeek(previous);
      throw err;
    }
  };
  const handleToggleViewingWeek = makeToggleViewingWeek(routineViewer);
  const handleToggleRecoveryViewingWeek = makeToggleViewingWeek(recoveryViewer);

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

  // Toggle-to-collapse (#836): tapping the same note again closes it, both on
  // the Routine tab and — via `handleViewRecoveryNote` below — the Recovery
  // tab, which used to be set-only there and never collapsed on a repeat tap.
  const handleViewOtherNote = (note) => {
    routineViewer.setViewingNoteId(prev => (prev === note.id ? null : note.id));
  };

  const handleViewRecoveryNote = (note) => {
    if (!note) return;
    recoveryViewer.setViewingNoteId(prev => (prev === note.id ? null : note.id));
  };

  // Opens the editor on whichever note/A-B-half a viewer slot is currently
  // showing. One implementation shared by both viewer slots (#836): the
  // Recovery card's Edit control reads off `recoveryViewer` through
  // `handleEditRecoveryViewedNote` below, exactly as the Routine tab's Edit
  // control already read off `routineViewer` here.
  const makeHandleEditViewedNote = (viewer) => () => {
    const note = viewer.viewingNote;
    if (!note) return;
    setEditingNoteId(note.id);
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
  };
  const handleEditViewedNote = makeHandleEditViewedNote(routineViewer);
  const handleEditRecoveryViewedNote = makeHandleEditViewedNote(recoveryViewer);

  const handleOpenOtherNote = (other) => {
    setEditingNoteId(other.id);
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
          // The one write this action performs is the `add` above. Adoption is
          // offered, never performed here (#748) — see `adoptionPrompt`.
          if (!isEditingDeloadNote) {
            setAdoptionError('');
            setAdoptionPrompt({ id: result.id, title: titleToSave });
          }
          // add() (useWorkoutNotes) always creates the note with activeWeek:
          // null, so a new note authored with a standalone --- must persist
          // its selected week in a follow-up update — otherwise it silently
          // reopens on Week A regardless of which week was selected when
          // first saved. A plain new note (no boundary) correctly keeps the
          // null activeWeek add() already wrote; currentId is never touched.
          if (editingHasABWeeks && isValidActiveWeek(editingEffectiveWeek)) {
            const withWeek = await update(result.id, { activeWeek: editingEffectiveWeek });
            if (withWeek) result = withWeek;
          }
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
          if (isEditingDeloadNote) {
            const histRecord = editingDeloadHasLinkedRecord
              ? deloadHistory.find(r => r.note_id === editingNoteId)
              : null;
            const deloadPatch = {};
            if (deloadEditDateTouched && deloadEditDate) {
              const newDate = deloadEditDate;
              const savedDate = editingNote?.saved_at?.slice(0, 10) ?? '';
              // The correctness property is a VALUE change, not mere
              // interaction: `deloadEditDateTouched` only gates entry to this
              // block, so opening the picker and restoring the original date
              // before saving must still leave saved_at untouched (#764
              // feedback, finding 2 follow-up) — there is deliberately no
              // `else` branch here anymore.
              if (newDate !== savedDate && histRecord) {
                deloadPatch.completed_at = `${newDate}T12:00:00.000Z`;
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

  // Leaving the editor is one of exactly three things that removes the adoption
  // prompt (the others are `Not now` and a completed adoption). It writes
  // nothing — not even a "already asked" flag — and the offer stays reachable
  // from the S1 card or `More Routines` afterwards (#745 Part 5 §A1.3).
  const clearAdoptionPrompt = () => {
    setAdoptionPrompt(null);
    setAdoptionError('');
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
      clearAdoptionPrompt();
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
    clearAdoptionPrompt();
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
    } catch (err) {
      console.warn('Undo revert failed:', err);
      Alert.alert('Error', 'Failed to revert changes. Please try again.');
    }
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
            await deleteDeloadNote(editingNoteId);
            setEditingNoteId(null);
            setOriginalNoteState(null);
          },
        },
      ]
    );
  };

  // Opens the plain-text editor on a draft. `seed` carries the guided sheet's
  // `Write it as text instead` escape (#745 Part 3 §3.1): the composed text and
  // title arrive pre-filled and UNSAVED, i.e. the ordinary `editingNoteId ===
  // 'new'` path, and follow the normal `Save` flow from there. Manual
  // note-first entry is never removed or demoted.
  const handleCreateRoutine = (seed) => {
    setOriginalNoteState(null);
    setEditingNoteId('new');
    setEditingTitle(seed?.title ?? '');
    setEditingFullText(seed?.text ?? '');
    setEditingActiveWeek(null);
    setSaveError('');
    setSaveSuccess('');
    clearAdoptionPrompt();
  };

  const ADOPT_FAILED_MESSAGE =
    'Could not make this your current routine. It is still saved — try again.';
  const FLUSH_FAILED_MESSAGE =
    'Could not save your latest edits, so nothing was switched. Your text is still here — try again.';

  // Adoption with no current routine: there is nothing to switch from, no
  // analytics to affect, and no old routine to roll 1K selections over from, so
  // no confirmation and no rollover prompt (#745 Part 3 §2.2).
  //
  // Unlike `doSwitch`, this path is reached WITHOUT a confirmation that offered
  // `Save & Switch` / `Switch Anyway`, so it may not discard anything. Closing
  // the editor after cancelling the debounce would silently drop text the user
  // typed while the prompt was on screen, and `selectCurrent` would then reload
  // the previously saved version — destroying user text to tidy state, which
  // Part 3 forbids. So pending edits are flushed FIRST, and a failed flush
  // aborts the adoption entirely rather than proceeding without them.
  const adoptDirectly = async (id) => {
    if (autosaveCurrentTimerRef.current) {
      clearTimeout(autosaveCurrentTimerRef.current);
      autosaveCurrentTimerRef.current = null;
    }
    if (autosaveOtherTimerRef.current) {
      clearTimeout(autosaveOtherTimerRef.current);
      autosaveOtherTimerRef.current = null;
    }
    if (editingNoteId && hasUnsavedOther) {
      const saved = await handleSaveOtherNote();
      if (!saved) {
        // Same treatment as the P6 `Save & Switch` failure: the switch is not
        // attempted, the save error is surfaced, and the prompt stays
        // retryable. This is the app failing, not the user cancelling.
        return { ok: false, reason: FLUSH_FAILED_MESSAGE };
      }
    }
    try {
      await selectCurrent(id);
    } catch (err) {
      console.warn('[adoptDirectly] selectCurrent failed', err);
      return { ok: false, reason: ADOPT_FAILED_MESSAGE };
    }
    setAdoptionPrompt(null);
    setAdoptionError('');
    setEditingNoteId(null);
    setOriginalNoteState(null);
    routineViewer.setViewingNoteId(null);
    recoveryViewer.setViewingNoteId(null);
    return { ok: true };
  };

  // `Use as current` on the post-save prompt, and the S1 card's `Use this
  // routine`. Both route through the SAME two branches as `handleSwitchCurrent`
  // so there is exactly one adoption rule in the app.
  const handleAdoptPromptedRoutine = async () => {
    if (!adoptionPrompt || adoptionBusy) return;
    setAdoptionError('');
    if (currentId) {
      // Replacing an existing current routine keeps the D7/#737 confirmation,
      // unsaved-changes branch, and 1K rollover prompt entirely unchanged. An
      // abandoned confirmation leaves this prompt on screen and re-pressable
      // (#745 Part 6 §A1.1) because only `doSwitch` clears it.
      handleSwitchCurrent(adoptionPrompt.id);
      return;
    }
    setAdoptionBusy(true);
    const result = await adoptDirectly(adoptionPrompt.id);
    setAdoptionBusy(false);
    if (!result.ok) {
      // The saved note is never deleted to tidy state; only the switch half
      // failed, and the retry re-attempts just that.
      setAdoptionError(result.reason);
    }
  };

  // Raises the SAME prompt state `handleSaveOtherNote` sets, so the guided
  // scaffold's save converges on one adoption rule with the plain editor's
  // instead of leaving a user who already has a current routine with no offer
  // at all (the S1 card is gated on `!currentId` and cannot cover them).
  const showAdoptionPromptFor = (note) => {
    if (!note?.id) return;
    setAdoptionError('');
    setAdoptionPrompt({ id: note.id, title: note.title || 'Untitled Routine' });
  };

  const handleDismissAdoptionPrompt = () => {
    // Writes nothing, including no dismissal flag. The choice is deferred,
    // never lost: the S1 card keeps offering adoption on every Log visit.
    clearAdoptionPrompt();
  };

  const handleSwitchCurrent = (id) => {
    const note = notes.find(n => n.id === id);
    if (!note) {
      // Never a silent no-op (#745 Part 3 §2.3). An `Alert` rather than the
      // `setSkipWeekStatus` inline-status precedent because this handler is
      // also invoked from `LogPreviousRoutines`, which has no status surface of
      // its own — the requirement is that no press is ever inert, and an alert
      // satisfies it from every call site.
      Alert.alert(
        'Could not set current routine',
        'That routine is not saved yet. Save it first, then set it as your current routine.'
      );
      return;
    }

    // Adoption, not switching. `currentId === null` means there is nothing to
    // replace: no switch-warning copy (every clause of which would be false),
    // no unsaved-changes branch against a routine that does not exist, and no
    // 1K rollover.
    if (!currentId) {
      (async () => {
        const result = await adoptDirectly(id);
        if (!result.ok) setAdoptionError(result.reason);
      })();
      return;
    }

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
      // `currentId` changes only here, together with the 1K rollover write
      // (#745 Part 6). An abandoned confirmation therefore never adopts, never
      // rolls over, and never dismisses the adoption prompt — this is the only
      // place that clears it on a completed adoption.
      await selectCurrent(id);
      setEditingNoteId(null);
      setOriginalNoteState(null);
      routineViewer.setViewingNoteId(null);
      recoveryViewer.setViewingNoteId(null);
      setAdoptionPrompt(null);
      setAdoptionError('');
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
    // Routine-tab viewer (unchanged external names): LogPreviousRoutines and
    // LogDeloadSection keep consuming `viewingNoteId`/`viewingNote`/etc.
    viewingNoteId: routineViewer.viewingNoteId,
    setViewingNoteId: routineViewer.setViewingNoteId,
    // Recovery-tab viewer (#836): a fully separate slot so an expanded
    // Recovery note never appears on the Routine tab and vice versa.
    recoveryViewingNoteId: recoveryViewer.viewingNoteId,
    setRecoveryViewingNoteId: recoveryViewer.setViewingNoteId,
    recoveryViewingNote: recoveryViewer.viewingNote,
    recoveryViewingNoteDayGroups: recoveryViewer.viewingNoteDayGroups,
    recoveryViewingHasABWeeks: recoveryViewer.viewingHasABWeeks,
    recoveryViewingEffectiveWeek: recoveryViewer.viewingEffectiveWeek,
    handleToggleRecoveryViewingWeek,
    handleViewRecoveryNote,
    handleEditRecoveryViewedNote,
    deloadEditDate,
    // Wrapped so any UI-driven change marks the date as explicitly touched
    // (#764 feedback fix 2) — a title-/text-only edit must never fall into
    // the date-handling save branch just because deloadEditDate is seeded
    // from the note's existing saved_at.
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
