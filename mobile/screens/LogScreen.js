// LOG TAB STYLE LOCK — DO NOT TOUCH.
// The fonts, font sizes, colors, spacing, and overall visual style of the Log
// tab are intentionally fixed. Do NOT change any styling here, in the `styles`
// block below, or in the Log-tab typography of `components/UI.js`
// (`WorkoutHeading` / `WorkoutSubheading`). No "creative" or opportunistic
// visual tweaks. Change Log-tab styling ONLY when the repo owner explicitly
// asks for that specific change.

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Alert, Keyboard, Platform, Pressable, BackHandler, StyleSheet, Text, View } from 'react-native';
import { LogEmptyState } from '../components/LogEmptyState';
import { ScreenShell } from '../components/ScreenShell';
import { Card, ErrorBanner } from '../components/UI';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { Colors } from '../theme/colors';
import { parseWorkoutNote, countWorkoutSessionsFromSections } from '../lib/parser';
import { normalizeLiftName, deriveWorkoutNoteAnalytics, listTrackedLifts, getDefaultTrackedNames, deriveSkipData, deriveSessionCheckIn, findMatchingExerciseNames, rolloverOneKExercises, normalizeExerciseKey, DEFAULT_1K_EXERCISES } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useDeloadNote, useDeloadHistory, useFeatureToggles } from '../hooks/useEntries';

import { DELOAD_NOTE_PREFIX, AUTOSAVE_DEBOUNCE_MS, localDate } from '../lib/LogScreenHelpers';
import { LogDeloadSection } from '../components/LogDeloadSection';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';

export function LogScreen({
  workoutNoteText,
  setWorkoutNoteText,
  workoutNoteTitle,
  setWorkoutNoteTitle,
  isCollapsed,
  toggleCollapsed,
  onSaveWorkout,
  deloadDateEditEnabled,
  onCheckInPrompt,
}) {
  const { notes, currentId, currentNote, deloadNotes, loading: notesLoading, error: notesError, refresh: refreshNotes, selectCurrent, update, add, remove } = useWorkoutNotes();
  const { trackedLifts, toggle: toggleTrackedLift } = useTrackedLifts();
  const { note: deloadNote, loading: deloadLoading, save: saveDeloadNote } = useDeloadNote();
  const { history: deloadHistory, completeDeload, deleteDeload, deleteDeloadNote, updateDeload } = useDeloadHistory();
  const { fatigueTrackingEnabled, deloadModeEnabled } = useFeatureToggles();

  const [mode, setMode] = useState('read');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [tabView, setTabView] = useState('routine'); // 'routine' | 'deload'
  const [deloadMode, setDeloadMode] = useState('read'); // 'read' | 'edit'
  const [deloadEditText, setDeloadEditText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingText, setEditingText] = useState('');
  const [noteIsSaving, setNoteIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [originalNoteState, setOriginalNoteState] = useState(null);

  const [viewingNoteId, setViewingNoteId] = useState(null);
  const [deloadEditDate, setDeloadEditDate] = useState('');
  const [showDeloadDatePicker, setShowDeloadDatePicker] = useState(false);
  const [deloadEditOrdinal, setDeloadEditOrdinal] = useState('');

  const [roughFlaggedNames, setRoughFlaggedNames] = useState(new Set());
  const [roughSessionIndex, setRoughSessionIndex] = useState(null);
  const [roughNoteId, setRoughNoteId] = useState(null);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [roughCheckInData, setRoughCheckInData] = useState(null);

  const editorScrollRef = useRef(null);
  const readScrollRef = useRef(null);
  const keyboardVisibleRef = useRef(false);
  const lastTapRef = useRef(0);
  const deloadLastTapRef = useRef(0);
  const viewingNoteLastTapRef = useRef(0);
  const readScrollYRef = useRef(0);
  const autosaveCurrentTimerRef = useRef(null);
  const autosaveOtherTimerRef = useRef(null);
  const saveOtherNoteInFlightRef = useRef(null);

  // Live-value refs — updated every render so async save callbacks can read the
  // current state after an await without relying on stale closure captures.
  const workoutNoteTextRef = useRef(workoutNoteText);
  const workoutNoteTitleRef = useRef(workoutNoteTitle);
  const currentIdRef = useRef(currentId);
  const editingTextRef = useRef(editingText);
  const editingTitleRef = useRef(editingTitle);
  const editingNoteIdRef = useRef(editingNoteId);
  const currentNoteRef = useRef(currentNote);
  workoutNoteTextRef.current = workoutNoteText;
  workoutNoteTitleRef.current = workoutNoteTitle;
  currentIdRef.current = currentId;
  editingTextRef.current = editingText;
  editingTitleRef.current = editingTitle;
  editingNoteIdRef.current = editingNoteId;
  currentNoteRef.current = currentNote;

  const handleReadScroll = (e) => {
    readScrollYRef.current = e.nativeEvent.contentOffset.y;
  };

  const handleNoteBodyPress = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      enterCurrentEditor();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

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

  const keyboardExitTimeoutRef = useRef(null);

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  useEffect(() => {
    if (roughSessionIndex == null || roughFlaggedNames.size === 0) return;
    if (roughNoteId !== currentId) {
      setRoughFlaggedNames(new Set());
      setRoughSessionIndex(null);
      setRoughNoteId(null);
      return;
    }
    const checkins = currentNote?.session_checkins;
    if (checkins?.[roughSessionIndex]) {
      setRoughFlaggedNames(new Set());
      setRoughSessionIndex(null);
      setRoughNoteId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNote?.session_checkins, roughSessionIndex, currentId]);

  // Debounced autosave for the current (existing) note while in edit mode.
  // New notes (no currentId) require an explicit first save to get an ID.
  useEffect(() => {
    if (mode !== 'edit' || !currentId || !hasUnsavedCurrent) return;
    if (autosaveCurrentTimerRef.current) clearTimeout(autosaveCurrentTimerRef.current);
    autosaveCurrentTimerRef.current = setTimeout(async () => {
      autosaveCurrentTimerRef.current = null;
      await handleSave({ autosave: true });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveCurrentTimerRef.current) {
        clearTimeout(autosaveCurrentTimerRef.current);
        autosaveCurrentTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutNoteText, workoutNoteTitle, mode, currentId]);

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

  // Cancel pending autosave timers on unmount.
  useEffect(() => {
    return () => {
      if (autosaveCurrentTimerRef.current) clearTimeout(autosaveCurrentTimerRef.current);
      if (autosaveOtherTimerRef.current) clearTimeout(autosaveOtherTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      keyboardVisibleRef.current = true;
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
      if (keyboardExitTimeoutRef.current) {
        clearTimeout(keyboardExitTimeoutRef.current);
      }
    };
  }, []);

  const hasUnsavedCurrent = useMemo(() => {
    if (!currentNote) return workoutNoteTitle.trim() !== '' || workoutNoteText.trim() !== '';
    return workoutNoteTitle !== (currentNote.title || '') || workoutNoteText !== currentNote.raw_text;
  }, [currentNote, workoutNoteTitle, workoutNoteText]);

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

  const handleAndroidBack = () => {
    if (deloadMode === 'edit') {
      handleDoneDeload();
      return true;
    }
    if (editingNoteId) {
      handleDoneOther();
      return true;
    }
    if (viewingNoteId) {
      setViewingNoteId(null);
      return true;
    }
    if (mode === 'edit') {
      handleDoneCurrent();
      return true;
    }
    return false;
  };
  const handleAndroidBackRef = useRef(handleAndroidBack);
  handleAndroidBackRef.current = handleAndroidBack;

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => handleAndroidBackRef.current(),
    );

    return () => backHandler.remove();
  }, [editingNoteId, viewingNoteId, mode, deloadMode]);

  const otherNotes = notes.filter(n => n.id !== currentId && !n.title?.startsWith(DELOAD_NOTE_PREFIX));

  const parsed = useMemo(() => parseWorkoutNote(workoutNoteText), [workoutNoteText]);

  const logSessionCount = useMemo(
    () => countWorkoutSessionsFromSections(parsed.sections),
    [parsed.sections]
  );

  const weekBStartIndex = parsed.weekBStartIndex ?? null;
  const hasABWeeks = weekBStartIndex !== null;
  const effectiveActiveWeek = hasABWeeks ? (currentNote?.activeWeek ?? 'A') : null;

  const handleToggleWeek = async () => {
    if (!currentId || !hasABWeeks) return;
    const next = effectiveActiveWeek === 'B' ? 'A' : 'B';
    await update(currentId, { activeWeek: next });
  };

  const activeEditText = useMemo(() => {
    if (!hasABWeeks || !currentId) return workoutNoteText;
    const lines = workoutNoteText.split('\n');
    const sepIdx = lines.findIndex(l => l.trim() === '---');
    if (sepIdx === -1) return workoutNoteText;
    if (effectiveActiveWeek === 'B') return lines.slice(sepIdx + 1).join('\n');
    return lines.slice(0, sepIdx).join('\n');
  }, [workoutNoteText, hasABWeeks, effectiveActiveWeek, currentId]);

  const activeWeekParsed = useMemo(
    () => (hasABWeeks ? parseWorkoutNote(activeEditText) : parsed),
    [hasABWeeks, activeEditText, parsed]
  );

  const handleCurrentTextChange = (newText) => {
    if (!hasABWeeks || !currentId) {
      setWorkoutNoteText(newText);
      return;
    }
    const lines = workoutNoteText.split('\n');
    const sepIdx = lines.findIndex(l => l.trim() === '---');
    if (sepIdx === -1) {
      setWorkoutNoteText(newText);
      return;
    }
    const weekAText = lines.slice(0, sepIdx).join('\n');
    const weekBText = lines.slice(sepIdx + 1).join('\n');
    if (effectiveActiveWeek === 'A') {
      setWorkoutNoteText(newText + '\n---\n' + weekBText);
    } else {
      setWorkoutNoteText(weekAText + '\n---\n' + newText);
    }
  };

  const dayGroups = useMemo(() => {
    const groups = [];
    for (const section of activeWeekParsed.sections) {
      const last = groups[groups.length - 1];
      if (last && last.heading === section.heading) {
        last.sections.push(section);
      } else {
        groups.push({ heading: section.heading, sections: [section] });
      }
    }
    return groups;
  }, [activeWeekParsed]);

  const deloadParsed = useMemo(() => parseWorkoutNote(deloadNote?.raw_text || ''), [deloadNote?.raw_text]);
  const deloadDayGroups = useMemo(() => {
    const groups = [];
    for (const section of deloadParsed.sections) {
      const last = groups[groups.length - 1];
      if (last && last.heading === section.heading) last.sections.push(section);
      else groups.push({ heading: section.heading, sections: [section] });
    }
    return groups;
  }, [deloadParsed.sections]);

  const hasUnsavedDeload = useMemo(() => {
    if (deloadMode !== 'edit') return false;
    return deloadEditText !== (deloadNote?.raw_text || '');
  }, [deloadMode, deloadEditText, deloadNote]);

  const viewingNote = useMemo(() =>
    viewingNoteId ? notes.find(n => n.id === viewingNoteId) : null
  , [viewingNoteId, notes]);

  const viewingNoteParsed = useMemo(() =>
    viewingNote ? parseWorkoutNote(viewingNote.raw_text || '') : null
  , [viewingNote]);

  const viewingNoteDayGroups = useMemo(() => {
    if (!viewingNoteParsed) return [];
    const groups = [];
    for (const section of viewingNoteParsed.sections) {
      const last = groups[groups.length - 1];
      if (last && last.heading === section.heading) {
        last.sections.push(section);
      } else {
        groups.push({ heading: section.heading, sections: [section] });
      }
    }
    return groups;
  }, [viewingNoteParsed]);

  const hasContent = workoutNoteText.trim().length > 0;

  const handleSave = async ({ autosave = false } = {}) => {
    if (isSaving) return;
    if (!currentId && !workoutNoteText.trim()) {
      setSaveError('Workout notes are required');
      return;
    }
    const savedForId = currentId;
    const snapshotText = workoutNoteText;
    const snapshotTitle = workoutNoteTitle;
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      let result = null;
      const titleToSave = workoutNoteTitle || 'Untitled Routine';
      const { sections: savedSections } = parseWorkoutNote(workoutNoteText);
      const explicitTrackedNames = listTrackedLifts(trackedLifts);
      const defaultNames = getDefaultTrackedNames();
      const normalizedDefaults = new Set(defaultNames.map(n => normalizeLiftName(n)));
      const trackedNames = [
        ...defaultNames,
        ...explicitTrackedNames.filter(n => !normalizedDefaults.has(normalizeLiftName(n))),
      ];
      const allSections = [
        ...notes.flatMap(n => {
          const text = n.id === currentId ? workoutNoteText : n.raw_text;
          return text ? parseWorkoutNote(text).sections : [];
        }),
        ...(currentId ? [] : savedSections),
      ];
      const { classifications: exercise_classifications } =
        deriveWorkoutNoteAnalytics(allSections, trackedNames);
      const { exercise_skips, day_skips, attendance_flags } = deriveSkipData(savedSections);
      const skip_markers = { exercise_skips, day_skips };

      if (currentId) {
        result = await update(currentId, {
          title: titleToSave,
          raw_text: workoutNoteText,
          exercise_classifications,
          skip_markers,
          attendance_flags,
        });
      } else {
        result = await add(titleToSave, workoutNoteText);
        await selectCurrent(result.id);
        if (result) {
          await update(result.id, { exercise_classifications, skip_markers, attendance_flags });
        }
      }

      if (result) {
        const contentUnchanged =
          workoutNoteTextRef.current === snapshotText &&
          workoutNoteTitleRef.current === snapshotTitle;
        const identityUnchanged = !savedForId || currentIdRef.current === savedForId;
        if (contentUnchanged && identityUnchanged) {
          setWorkoutNoteTitle(result.title || '');
          setWorkoutNoteText(result.raw_text || '');
          if (!autosave) setSaveSuccess('Saved!');
        }
        return true;
      } else {
        setSaveError('Save failed');
        return false;
      }
    } catch {
      setSaveError('Save failed');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const finishExitCurrentEditor = () => {
    readScrollRef.current?.scrollTo({ y: 0, animated: false });
    setMode('read');
    setOriginalNoteState(null);
  };

  const exitCurrentEditor = () => {
    if (!keyboardVisibleRef.current) {
      finishExitCurrentEditor();
      return;
    }

    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const hideSub = Keyboard.addListener(hideEvent, () => {
      hideSub.remove();
      if (keyboardExitTimeoutRef.current) {
        clearTimeout(keyboardExitTimeoutRef.current);
        keyboardExitTimeoutRef.current = null;
      }
      finishExitCurrentEditor();
    });

    Keyboard.dismiss();

    keyboardExitTimeoutRef.current = setTimeout(() => {
      hideSub.remove();
      keyboardExitTimeoutRef.current = null;
      finishExitCurrentEditor();
    }, Platform.OS === 'ios' ? 250 : 150);
  };

  const enterCurrentEditor = () => {
    const scrollY = readScrollYRef.current;
    setOriginalNoteState({
      title: workoutNoteTitle,
      text: workoutNoteText,
    });
    setMode('edit');
    requestAnimationFrame(() => {
      editorScrollRef.current?.scrollTo({ y: scrollY, animated: false });
    });
  };

  const _runCheckInDetection = () => {
    if (!fatigueTrackingEnabled) return;
    const explicitTrackedNames = listTrackedLifts(trackedLifts);
    const defaultNames = getDefaultTrackedNames();
    const normalizedDefaults = new Set(defaultNames.map(n => normalizeLiftName(n)));
    const resolvedTrackedNames = [
      ...defaultNames,
      ...explicitTrackedNames.filter(n => !normalizedDefaults.has(normalizeLiftName(n))),
    ];
    const latestText = workoutNoteTextRef.current;
    const latestId = currentIdRef.current;
    const { sections: currentSections } = parseWorkoutNote(latestText);
    const { isRough, sessionIndex, flagged, detectors, metrics } = deriveSessionCheckIn(currentSections, resolvedTrackedNames);
    const checkins = currentNoteRef.current?.session_checkins;
    if (isRough && sessionIndex != null && !(checkins?.[sessionIndex])) {
      setRoughFlaggedNames(new Set(flagged.map(f => f.normName)));
      setRoughSessionIndex(sessionIndex);
      setRoughNoteId(latestId);
      setRoughCheckInData({ sessionIndex, detectors, flagged, metrics });
      setShowCheckInModal(true);
      onCheckInPrompt?.();
    } else {
      setRoughFlaggedNames(new Set());
      setRoughSessionIndex(null);
      setRoughNoteId(null);
    }
  };

  const handleDoneCurrent = async () => {
    if (autosaveCurrentTimerRef.current) {
      clearTimeout(autosaveCurrentTimerRef.current);
      autosaveCurrentTimerRef.current = null;
    }

    if (!currentId) {
      if (hasUnsavedCurrent) {
        const ok = await handleSave();
        if (!ok) return;
      }
      exitCurrentEditor();
      return;
    }

    if (hasUnsavedCurrent) {
      const ok = await handleSave();
      if (!ok) return;
    }
    _runCheckInDetection();
    exitCurrentEditor();
  };

  const handleUndoCurrent = async () => {
    if (!currentId) {
      setWorkoutNoteTitle('');
      setWorkoutNoteText('');
      return;
    }
    if (!originalNoteState) return;
    if (autosaveCurrentTimerRef.current) {
      clearTimeout(autosaveCurrentTimerRef.current);
      autosaveCurrentTimerRef.current = null;
    }
    try {
      await update(currentId, {
        title: originalNoteState.title,
        raw_text: originalNoteState.text,
      });
      setWorkoutNoteTitle(originalNoteState.title);
      setWorkoutNoteText(originalNoteState.text);
    } catch (err) {
      console.warn('Undo revert failed:', err);
      Alert.alert('Error', 'Failed to revert changes. Please try again.');
    }
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
      const ok = await handleSaveOtherNote();
      if (!ok) return;
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
            if (isCurrent) {
              setMode('edit');
              setWorkoutNoteText('');
              setWorkoutNoteTitle('');
            }
          }
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

    const hasUnsaved = editingNoteId ? hasUnsavedOther : (mode === 'edit' ? hasUnsavedCurrent : false);

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
            }
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

  const handleToggleTrack = async (name) => {
    const key = normalizeLiftName(name);
    await toggleTrackedLift(key);
  };

  const enterDeloadEditor = () => {
    setOriginalNoteState({
      text: deloadNote?.raw_text || '',
    });
    setDeloadEditText(deloadNote?.raw_text || '');
    setDeloadMode('edit');
    requestAnimationFrame(() => {
      editorScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  };

  const exitDeloadEditor = () => {
    setDeloadMode('read');
    setDeloadEditText('');
    setSaveSuccess('');
    setSaveError('');
    setOriginalNoteState(null);
  };

  const handleSaveDeload = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      await saveDeloadNote(deloadEditText);
      setSaveSuccess('Saved!');
      return true;
    } catch {
      setSaveError('Save failed');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDoneDeload = () => {
    if (!hasUnsavedDeload) {
      exitDeloadEditor();
      return;
    }
    Alert.alert(
      'Unsaved Changes',
      'Do you want to save your changes before leaving?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: exitDeloadEditor },
        {
          text: 'Save',
          onPress: async () => {
            const ok = await handleSaveDeload();
            if (ok) exitDeloadEditor();
          },
        },
      ]
    );
  };

  const handleUndoDeload = () => {
    if (originalNoteState) {
      setDeloadEditText(originalNoteState.text);
    }
  };

  const handleGenerateDeload = () => {
    const doGenerate = async () => {
      setIsGenerating(true);
      setSaveError('');
      try {
        const raw = generateDeloadNote(workoutNoteText);
        // shape the deload text using the new local helper
        const formattedRaw = raw.split('\n')
          .filter(Boolean)
          .map((line, idx) => {
            const isExercise = line.includes(': ') && line.includes('lbs');
            if (!isExercise && idx > 0) return `\n${line}\n+Lifting`;
            return line;
          })
          .join('\n');
        await saveDeloadNote(formattedRaw);
      } catch {
        setSaveError('Generate failed');
      } finally {
        setIsGenerating(false);
      }
    };

    if (deloadNote?.raw_text) {
      Alert.alert(
        'Regenerate deload?',
        'This will overwrite your existing deload note. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Regenerate', style: 'destructive', onPress: doGenerate },
        ]
      );
    } else {
      doGenerate();
    }
  };

  const handleDeloadBodyPress = () => {
    const now = Date.now();
    if (now - deloadLastTapRef.current < 300) {
      enterDeloadEditor();
      deloadLastTapRef.current = 0;
    } else {
      deloadLastTapRef.current = now;
    }
  };

  const headerRight = !editingNoteId && hasContent && mode === 'edit' && (
    <Pressable
      onPress={handleDoneCurrent}
      style={styles.modeToggle}
    >
      <Text style={styles.modeToggleText}>
        Done
      </Text>
    </Pressable>
  );

  const isEmpty = !notesLoading && notes.length === 0;
  const isEditing = !!editingNoteId || mode === 'edit' || deloadMode === 'edit';

  const effectiveTabView = deloadModeEnabled ? tabView : 'routine';

  useEffect(() => {
    if (editingNoteId) {
      editorScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [editingNoteId]);

  return (
    <>
      <ScreenShell
        ref={readScrollRef}
        onScroll={handleReadScroll}
        style={isEditing ? { display: 'none' } : { flex: 1 }}
        title="Workout Notes"
        subtitle={isEmpty ? "Track your active training routine." : "Your active training routine. Update it as you go."}
        headerRight={headerRight}
        keyboardShouldPersistTaps="handled"
      >
        {notesError ? (
          <ErrorBanner message="Could not load workout notes." onRetry={refreshNotes} />
        ) : null}
        {isEmpty ? (
          <LogEmptyState onCreateRoutine={handleCreateRoutine} />
        ) : (
          <>
            {deloadModeEnabled && (
              <View style={styles.tabToggle}>
                <Pressable
                  onPress={() => setTabView('routine')}
                  style={[styles.tabToggleItem, effectiveTabView === 'routine' && styles.tabToggleItemActive]}
                >
                  <Text style={[styles.tabToggleText, effectiveTabView === 'routine' && styles.tabToggleTextActive]}>Routine</Text>
                </Pressable>
                <Pressable
                  onPress={() => setTabView('deload')}
                  style={[styles.tabToggleItem, effectiveTabView === 'deload' && styles.tabToggleItemActive]}
                >
                  <Text style={[styles.tabToggleText, effectiveTabView === 'deload' && styles.tabToggleTextActive]}>Deload</Text>
                </Pressable>
              </View>
            )}

            {effectiveTabView === 'deload' && (
              <LogDeloadSection
                deloadNote={deloadNote}
                deloadLoading={deloadLoading}
                deloadDayGroups={deloadDayGroups}
                enterDeloadEditor={enterDeloadEditor}
                handleDeloadBodyPress={handleDeloadBodyPress}
                deloadMode={deloadMode}
                completeDeload={completeDeload}
                handleGenerateDeload={handleGenerateDeload}
                isGenerating={isGenerating}
                workoutNoteText={workoutNoteText}
                saveError={saveError}
                deloadNotes={deloadNotes}
                deloadHistory={deloadHistory}
                deleteDeloadNote={deleteDeloadNote}
                deleteDeload={deleteDeload}
                viewingNoteId={viewingNoteId}
                handleViewOtherNote={handleViewOtherNote}
                viewingNote={viewingNote}
                viewingNoteDayGroups={viewingNoteDayGroups}
                handleOpenOtherNote={handleOpenOtherNote}
                logSessionCount={logSessionCount}
              />
            )}

            {effectiveTabView === 'routine' && mode === 'read' && hasContent && (
              <LogActiveRoutineCard
                workoutNoteTitle={workoutNoteTitle}
                hasABWeeks={hasABWeeks}
                effectiveActiveWeek={effectiveActiveWeek}
                handleToggleWeek={handleToggleWeek}
                enterCurrentEditor={enterCurrentEditor}
                handleNoteBodyPress={handleNoteBodyPress}
                toggleCollapsed={toggleCollapsed}
                isCollapsed={isCollapsed}
                dayGroups={dayGroups}
                trackedLifts={trackedLifts}
                handleToggleTrack={handleToggleTrack}
                roughNoteId={roughNoteId}
                currentId={currentId}
                roughFlaggedNames={roughFlaggedNames}
                activeEditText={activeEditText}
              />
            )}

            {effectiveTabView === 'routine' && (
              <LogPreviousRoutines
                otherNotes={otherNotes}
                handleViewOtherNote={handleViewOtherNote}
                viewingNoteId={viewingNoteId}
                viewingNote={viewingNote}
                viewingNoteDayGroups={viewingNoteDayGroups}
                handleSwitchCurrent={handleSwitchCurrent}
                handleEditViewedNote={handleEditViewedNote}
                handleDeleteRoutine={handleDeleteRoutine}
                handleCreateRoutine={handleCreateRoutine}
              />
            )}
          </>
        )}
      </ScreenShell>

      <ScreenShell
        ref={editorScrollRef}
        style={isEditing ? { flex: 1 } : { display: 'none' }}
        title={
          deloadMode === 'edit' ? 'Deload Week' :
          (editingNoteId && isEditingDeloadNote) ? 'Deload record' :
          editingNoteId ? (editingTitle || 'Untitled Routine') :
          (workoutNoteTitle || 'Untitled Routine')
        }
        subtitle={
          deloadMode === 'edit' ? 'Edit deload' :
          (editingNoteId && isEditingDeloadNote) ? 'Edit deload record' :
          'Edit routine'
        }
        headerRight={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable
              onPress={
                deloadMode === 'edit' ? handleUndoDeload :
                editingNoteId ? handleUndoOther :
                handleUndoCurrent
              }
              style={[styles.modeToggle, { backgroundColor: 'transparent', marginRight: 8 }]}
              accessibilityLabel="Undo"
              accessibilityRole="button"
            >
              <Text style={[styles.modeToggleText, { color: Colors.textMuted, fontWeight: '500' }]}>Undo</Text>
            </Pressable>
            <Pressable
              onPress={
                deloadMode === 'edit' ? handleDoneDeload :
                editingNoteId ? handleDoneOther :
                handleDoneCurrent
              }
              style={styles.modeToggle}
              accessibilityLabel="Done"
              accessibilityRole="button"
            >
              <Text style={styles.modeToggleText}>Done</Text>
            </Pressable>
          </View>
        }
        keyboardShouldPersistTaps="handled"
      >
        <LogScreenEditorCard
          deloadMode={deloadMode}
          deloadEditText={deloadEditText}
          setDeloadEditText={setDeloadEditText}
          handleSaveDeload={handleSaveDeload}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          editingNoteId={editingNoteId}
          isEditingDeloadNote={isEditingDeloadNote}
          editingTitle={editingTitle}
          setEditingTitle={setEditingTitle}
          workoutNoteTitle={workoutNoteTitle}
          setWorkoutNoteTitle={setWorkoutNoteTitle}
          deloadDateEditEnabled={deloadDateEditEnabled}
          editingDeloadHasLinkedRecord={editingDeloadHasLinkedRecord}
          setShowDeloadDatePicker={setShowDeloadDatePicker}
          deloadEditDate={deloadEditDate}
          deloadEditOrdinal={deloadEditOrdinal}
          setDeloadEditOrdinal={setDeloadEditOrdinal}
          showDeloadDatePicker={showDeloadDatePicker}
          editingNote={editingNote}
          setDeloadEditDate={setDeloadEditDate}
          editingText={editingText}
          setEditingText={setEditingText}
          activeEditText={activeEditText}
          handleCurrentTextChange={handleCurrentTextChange}
          handleSaveOtherNote={handleSaveOtherNote}
          handleSave={handleSave}
          noteIsSaving={noteIsSaving}
          handleSwitchCurrent={handleSwitchCurrent}
          handleDeleteDeloadNoteFromEditor={handleDeleteDeloadNoteFromEditor}
          handleDeleteRoutine={handleDeleteRoutine}
          currentId={currentId}
        />
      </ScreenShell>
      <SessionCheckInModal
        visible={showCheckInModal}
        checkInData={roughCheckInData}
        currentId={roughNoteId}
        currentNote={currentNote}
        update={update}
        onClose={() => setShowCheckInModal(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.chipBackground,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
  },
  tabToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: Colors.chipBackground,
    marginBottom: 12,
    padding: 2,
  },
  tabToggleItem: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabToggleItemActive: {
    backgroundColor: Colors.accent,
  },
  tabToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.chipText,
  },
  tabToggleTextActive: {
    color: '#fff',
  },
});
