// LOG TAB STYLE LOCK — DO NOT TOUCH.
// The fonts, font sizes, colors, spacing, and overall visual style of the Log
// tab are intentionally fixed. Do NOT change any styling here, in the `styles`
// block below, or in the Log-tab typography of `components/UI.js`
// (`WorkoutHeading` / `WorkoutSubheading`). No "creative" or opportunistic
// visual tweaks. Change Log-tab styling ONLY when the repo owner explicitly
// asks for that specific change.

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Alert, Keyboard, Modal, Platform, Pressable, BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LogEmptyState } from '../components/LogEmptyState';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, SectionTitle, ErrorBanner, SET_ROW_FONT_SIZE } from '../components/UI';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { Colors } from '../theme/colors';
import { parseWorkoutNote, generateDeloadNote, countWorkoutSessionsFromSections } from '../lib/parser';
import { normalizeLiftName, deriveWorkoutNoteAnalytics, listTrackedLifts, getDefaultTrackedNames, deriveSkipData, deriveSessionCheckIn, findMatchingExerciseNames, rolloverOneKExercises, normalizeExerciseKey, DEFAULT_1K_EXERCISES } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useDeloadNote, useDeloadHistory, useFeatureToggles } from '../hooks/useEntries';

const DELOAD_NOTE_PREFIX = 'Deload · ';
const AUTOSAVE_DEBOUNCE_MS = 800;

// Parse any ISO timestamp or YYYY-MM-DD string as local midnight so
// toLocaleDateString() never shifts the date back one day for UTC- timezones.
function localDate(str) {
  if (!str) return new Date();
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Reshape the compact deload generator output into routine-note style:
// blank line between day blocks, +Lifting subheading per day.
// The deload format line "Name: weight lbs SxR" still parses via _DELOAD_RE.
const _DELOAD_EXERCISE_LINE = /^[^:+\d-][^:]*?:\s+\d+(?:\.\d+)?\s+lbs?\s+\d+x\d+\s*$/i;
const _DELOAD_CORE_LINE = /^Core:/i;
function _shapeDeloadText(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const isExercise = _DELOAD_EXERCISE_LINE.test(line) || _DELOAD_CORE_LINE.test(line);
    if (!isExercise) {
      if (out.length > 0) out.push('');
      out.push(line);
      out.push('+Lifting');
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

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
  const [deloadCollapsed, setDeloadCollapsed] = useState(false);
  const [expandedDeloads, setExpandedDeloads] = useState(new Set());


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

  const [showDeloadOrdinalPrompt, setShowDeloadOrdinalPrompt] = useState(false);
  const [deloadOrdinalInput, setDeloadOrdinalInput] = useState('');

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

  const handleViewedNoteBodyPress = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - viewingNoteLastTapRef.current < DOUBLE_TAP_DELAY) {
      handleEditViewedNote();
      viewingNoteLastTapRef.current = 0;
    } else {
      viewingNoteLastTapRef.current = now;
    }
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

  // Latest back-press logic, reassigned every render so the registered listener
  // always runs against current state (fresh handleDone* closures, current text)
  // without re-subscribing as the user types.
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

    // Re-subscribe only when a sub-mode opens/closes. Two reasons:
    //   1. Text fields are intentionally NOT deps — re-subscribing on every
    //      keystroke churned the listener and intermittently dropped the back
    //      gesture mid-render.
    //   2. BackHandler is LIFO (last registered runs first). Re-registering when
    //      a sub-mode opens places this handler after the tab-level handler in
    //      App.js, so we get the press first and can consume it to exit the
    //      sub-screen instead of falling through to tab navigation.
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

  // A/B week support: detect '---' separator and derive active week.
  const weekBStartIndex = parsed.weekBStartIndex ?? null;
  const hasABWeeks = weekBStartIndex !== null;
  const effectiveActiveWeek = hasABWeeks ? (currentNote?.activeWeek ?? 'A') : null;

  const activeWeekSections = useMemo(() => {
    if (!hasABWeeks) return parsed.sections;
    if (effectiveActiveWeek === 'B') return parsed.sections.slice(weekBStartIndex);
    return parsed.sections.slice(0, weekBStartIndex);
  }, [parsed.sections, weekBStartIndex, hasABWeeks, effectiveActiveWeek]);

  const handleToggleWeek = async () => {
    if (!currentId || !hasABWeeks) return;
    const next = effectiveActiveWeek === 'B' ? 'A' : 'B';
    await update(currentId, { activeWeek: next });
  };

  // Group consecutive sections that share the same day heading so each day
  // renders exactly one heading, regardless of warmup/lifting splits.
  const dayGroups = useMemo(() => {
    const groups = [];
    for (const section of activeWeekSections) {
      const last = groups[groups.length - 1];
      if (last && last.heading === section.heading) {
        last.sections.push(section);
      } else {
        groups.push({ heading: section.heading, sections: [section] });
      }
    }
    return groups;
  }, [activeWeekSections]);

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
    // Snapshot identity + content before the async operation so we can detect
    // in-flight edit races (user kept typing) or routine switches that completed
    // before this promise resolved.
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
      // Aggregate across all notes (same as StatsScreen), substituting current note's
      // text with the unsaved edit so the latest changes are included.
      const allSections = [
        ...notes.flatMap(n => {
          const text = n.id === currentId ? workoutNoteText : n.raw_text;
          return text ? parseWorkoutNote(text).sections : [];
        }),
        ...(currentId ? [] : savedSections),
      ];
      // Cross-note analytics: classifications use full session history.
      const { classifications: exercise_classifications } =
        deriveWorkoutNoteAnalytics(allSections, trackedNames);
      // Skip tracking: scoped to the current note being saved.
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
          // Only sync UI state when note identity and content are unchanged since
          // save started — guards in-flight edit races, post-switch stale writes,
          // and first-save races on new notes alike.
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
    // Fatigue tracking off: never surface check-in prompts.
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
    // Cancel any pending debounced autosave before flushing manually.
    if (autosaveCurrentTimerRef.current) {
      clearTimeout(autosaveCurrentTimerRef.current);
      autosaveCurrentTimerRef.current = null;
    }

    if (!currentId) {
      // New note: prompt to discard; autosave doesn't apply until an ID exists.
      if (!hasUnsavedCurrent) {
        exitCurrentEditor();
        return;
      }
      Alert.alert(
        'Save new routine?',
        'Would you like to save this routine before leaving?',
        [
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              exitCurrentEditor();
              setWorkoutNoteText('');
              setWorkoutNoteTitle('');
            }
          },
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: async () => {
              const ok = await handleSave();
              if (ok) exitCurrentEditor();
            }
          },
        ]
      );
      return;
    }

    // Existing note: flush any unsaved changes, then exit.
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
    // Cancel any pending debounced autosave before flushing manually.
    if (autosaveOtherTimerRef.current) {
      clearTimeout(autosaveOtherTimerRef.current);
      autosaveOtherTimerRef.current = null;
    }

    if (editingNoteId === 'new') {
      // New note: prompt to discard; autosave doesn't apply until an ID exists.
      if (!hasUnsavedOther) {
        setEditingNoteId(null);
        setOriginalNoteState(null);
        return;
      }
      Alert.alert(
        'Discard changes?',
        'You have not saved this new routine. Are you sure you want to discard it?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              setEditingNoteId(null);
              setOriginalNoteState(null);
            }
          },
        ]
      );
      return;
    }

    // Existing note: flush any unsaved changes, then exit.
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
    // If a save is already in flight, chain on it rather than returning undefined.
    // This prevents handleDoneOther from treating the in-flight autosave as a
    // failure and keeping the editor open when the user presses Done.
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
        // Deload records must always carry the classification prefix.
        // Re-apply it if somehow lost (defence against future code paths).
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
                // No linked history record (legacy note): skip the date change entirely.
                // Applying saved_at without updating completed_at would desync the workout
                // note date from the analytics anchor — silently preserve the old date.
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
          // For new notes savedNoteId is 'new' and the ref already advanced to the
          // real ID, so skip the identity check and rely solely on content equality.
          const identityUnchanged =
            savedNoteId === 'new' || editingNoteIdRef.current === savedNoteId;
          if (contentUnchanged && identityUnchanged) {
            // Only sync UI state when note identity and content are unchanged since
            // save started — guards in-flight edit races on both new and existing notes.
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

    // Check if there are unsaved changes in the editor for ANY routine
    const hasUnsaved = editingNoteId ? hasUnsavedOther : (mode === 'edit' ? hasUnsavedCurrent : false);

    const doSwitch = async ({ rollover = false } = {}) => {
      // Cancel pending autosaves so they don't write to the wrong note after switch.
      if (autosaveCurrentTimerRef.current) {
        clearTimeout(autosaveCurrentTimerRef.current);
        autosaveCurrentTimerRef.current = null;
      }
      if (autosaveOtherTimerRef.current) {
        clearTimeout(autosaveOtherTimerRef.current);
        autosaveOtherTimerRef.current = null;
      }
      if (rollover && currentNote) {
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
      }
      await selectCurrent(id);
      setEditingNoteId(null);
      setOriginalNoteState(null);
      setViewingNoteId(null);
    };

    const confirmSwitch = () => {
      // Detect matching exercises to decide whether to offer rollover.
      const oldSections = parseWorkoutNote(currentNote?.raw_text || '').sections;
      const newSections = parseWorkoutNote(note.raw_text || '').sections;
      const matchedNames = findMatchingExerciseNames(oldSections, newSections);
      const hasMatches = matchedNames.length > 0;

      if (hasMatches) {
        Alert.alert(
          'Keep current progress?',
          'Some exercises match your current routine. Carry over 1K and progress tracking?',
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

  const handleCompleteDeload = () => {
    setDeloadOrdinalInput(String(logSessionCount + 1));
    setShowDeloadOrdinalPrompt(true);
  };

  const handleConfirmDeloadOrdinal = async () => {
    const ordinal = parseInt(deloadOrdinalInput, 10);
    if (!ordinal || ordinal < 1) return;
    setShowDeloadOrdinalPrompt(false);
    await completeDeload({ sessionCount: logSessionCount, deloadSessionOrdinal: ordinal });
  };

  const handleGenerateDeload = () => {
    const doGenerate = async () => {
      setIsGenerating(true);
      setSaveError('');
      try {
        const raw = generateDeloadNote(workoutNoteText);
        await saveDeloadNote(_shapeDeloadText(raw));
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

  const handleDeloadCollapsedToggle = () => {
    setDeloadCollapsed(c => !c);
  };

  const handleToggleLegacyDeload = (id) => {
    setExpandedDeloads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  // Deload mode off: collapse to the routine view and hide the deload entry point.
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

            {effectiveTabView === 'deload' && saveError ? (
              <Card style={styles.errorCard}>
                <Text style={styles.errorText}>{saveError}</Text>
              </Card>
            ) : null}
            {effectiveTabView === 'deload' && !deloadLoading && (
              !deloadNote?.raw_text ? (
                <View style={styles.deloadEmpty}>
                  <Text style={styles.deloadEmptyText}>No deload week generated yet.</Text>
                  <Button
                    onPress={handleGenerateDeload}
                    title="Generate deload"
                    disabled={isGenerating || !workoutNoteText.trim()}
                  />
                </View>
              ) : (
                <>
                  <View style={styles.mirrorContainer}>
                    <Card style={styles.currentRoutineCard}>
                      <Pressable onPress={handleDeloadCollapsedToggle} style={styles.otherNoteHeader}>
                        <View style={styles.otherNoteInfo}>
                          <Text style={styles.currentNoteTitle}>Deload Week</Text>
                          {deloadNote?.saved_at && (
                            <Text style={styles.otherNoteSub}>{localDate(deloadNote.saved_at).toLocaleDateString()}</Text>
                          )}
                        </View>
                        <Pressable
                          onPress={(e) => { e.stopPropagation(); enterDeloadEditor(); }}
                          style={styles.inlineSwitchButton}
                          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                        >
                          <Text style={styles.inlineSwitchButtonText}>Edit</Text>
                        </Pressable>
                      </Pressable>
                      <Pressable
                        onPress={handleDeloadBodyPress}
                        style={[styles.currentNoteContent, deloadCollapsed ? { display: 'none' } : null]}
                      >
                        <Text style={styles.editHint}>Double-tap to edit</Text>
                        {deloadDayGroups.map((group, gi) => (
                          <View key={`deload-day-${gi}`}>
                            {group.heading && (
                              <WorkoutHeading selectable={true} style={gi === 0 ? { marginTop: 0 } : null}>
                                {group.heading}
                              </WorkoutHeading>
                            )}
                            {group.sections.map((section, si) => (
                              <View key={`deload-section-${gi}-${si}`}>
                                {section.subheading && (
                                  <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
                                )}
                                {section.exercises.map((ex, ei) => (
                                  <ExerciseBlock
                                    key={`deload-ex-${gi}-${si}-${ei}`}
                                    name={ex.name}
                                    selectable={true}
                                  >
                                    {(() => {
                                      const items = [];
                                      const renderedUnparsed = new Set();
                                      const positions = ex.unparsed_positions || [];
                                      let posIdx = 0;
                                      let loggedIdx = 0;
                                      ex.session_entries.forEach((entry, eni) => {
                                        while (posIdx < positions.length && positions[posIdx].pos === eni) {
                                          items.push(<Text selectable={true} key={`deload-u-pos-${gi}-${si}-${ei}-${posIdx}`} style={styles.unparsedRowMuted}>{positions[posIdx].raw}</Text>);
                                          posIdx++;
                                        }
                                        if (entry.skipped) {
                                          items.push(<Text selectable={true} key={`deload-skip-${gi}-${si}-${ei}-${eni}`} style={styles.skipMarker}>—</Text>);
                                        } else if (entry.unparsed) {
                                          items.push(<Text selectable={true} key={`deload-u-inline-${gi}-${si}-${ei}-${eni}`} style={styles.unparsedRowMuted}>{entry.raw}</Text>);
                                          renderedUnparsed.add(entry.raw);
                                        } else {
                                          const row = ex.rows[loggedIdx++];
                                          if (row) items.push(<SetLine key={`deload-row-${gi}-${si}-${ei}-${eni}`} sets={row.sets} selectable={true} />);
                                        }
                                      });
                                      while (posIdx < positions.length) {
                                        items.push(<Text selectable={true} key={`deload-u-pos-${gi}-${si}-${ei}-${posIdx}`} style={styles.unparsedRowMuted}>{positions[posIdx].raw}</Text>);
                                        posIdx++;
                                      }
                                      const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
                                      ex.rows.slice(loggedCount).forEach((row, ri) => {
                                        items.push(<SetLine key={`deload-plain-${gi}-${si}-${ei}-${ri}`} sets={row.sets} selectable={true} />);
                                      });
                                      const positionalRaws = new Set(positions.map(p => p.raw));
                                      ex.unparsed_rows.forEach((u, ui) => {
                                        if (!positionalRaws.has(u) && !renderedUnparsed.has(u) && !renderedUnparsed.has(u.replace(/^-\s+/, ''))) {
                                          items.push(<Text selectable={true} key={`deload-u-${gi}-${si}-${ei}-${ui}`} style={styles.unparsedRowMuted}>{u}</Text>);
                                        }
                                      });
                                      return items;
                                    })()}
                                  </ExerciseBlock>
                                ))}
                              </View>
                            ))}
                          </View>
                        ))}
                        {!deloadDayGroups.length && (
                          <Text selectable={true} style={styles.emptyText}>Deload note is empty.</Text>
                        )}
                      </Pressable>
                    </Card>
                  </View>
                  <View style={styles.previousRoutines}>
                    {deloadMode === 'read' && (
                      <Button
                        onPress={handleCompleteDeload}
                        title="Deload complete"
                      />
                    )}
                    <Button
                      onPress={handleGenerateDeload}
                      title={isGenerating ? 'Generating…' : 'Regenerate deload'}
                      disabled={isGenerating || !workoutNoteText.trim()}
                      style={styles.generateButton}
                      textStyle={styles.generateButtonText}
                    />
                  </View>
                </>
              )
            )}
            {effectiveTabView === 'deload' && !deloadLoading && (deloadNotes.length > 0 || deloadHistory.some(r => !r.note_id)) && (
              <View style={styles.pastDeloads}>
                <SectionTitle>Past deloads</SectionTitle>
                {[
                  ...deloadNotes.map(n => ({ type: 'note', id: n.id, sortKey: n.saved_at, data: n })),
                  ...deloadHistory.filter(r => !r.note_id).map(r => ({ type: 'legacy', id: r.id, sortKey: r.completed_at, data: r })),
                ].sort((a, b) => b.sortKey.localeCompare(a.sortKey)).map(item => {
                  if (item.type === 'note') {
                    const note = item.data;
                    const rawDate = note.title.startsWith(DELOAD_NOTE_PREFIX)
                      ? note.title.slice(DELOAD_NOTE_PREFIX.length)
                      : note.saved_at.slice(0, 10);
                    const dateStr = rawDate ? localDate(rawDate).toLocaleDateString() : '';
                    return (
                      <Card key={note.id} style={styles.otherNoteCard}>
                        <Pressable onPress={() => handleViewOtherNote(note)} style={styles.otherNoteHeader}>
                          <View style={styles.otherNoteInfo}>
                            <Text style={styles.otherNoteTitle}>{note.title}</Text>
                            <Text style={styles.otherNoteSub}>Completed {dateStr}</Text>
                          </View>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              Alert.alert(
                                'Delete deload record?',
                                'This cannot be undone. The sessions-since-deload clock will reset based on your remaining history.',
                                [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Delete', style: 'destructive', onPress: () => deleteDeloadNote(note.id) },
                                ]
                              );
                            }}
                            style={styles.inlineSwitchButton}
                            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                          >
                            <Text style={styles.pastDeloadDeleteText}>Delete</Text>
                          </Pressable>
                        </Pressable>
                        {viewingNoteId === note.id && viewingNote && (
                          <>
                            <Pressable onPress={handleViewedNoteBodyPress} style={styles.currentNoteContent}>
                              <Text style={styles.editHint}>Double-tap to edit</Text>
                              {viewingNoteDayGroups.map((group, gi) => (
                                <View key={`deload-view-day-${gi}`}>
                                  {group.heading && (
                                    <WorkoutHeading selectable={true} style={gi === 0 ? { marginTop: 0 } : null}>
                                      {group.heading}
                                    </WorkoutHeading>
                                  )}
                                  {group.sections.map((section, si) => (
                                    <View key={`deload-view-section-${gi}-${si}`}>
                                      {section.subheading && (
                                        <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
                                      )}
                                      {section.exercises.map((ex, ei) => (
                                        <ExerciseBlock key={`deload-view-ex-${gi}-${si}-${ei}`} name={ex.name} selectable={true}>
                                          {(() => {
                                            const items = [];
                                            const renderedUnparsed = new Set();
                                            const positions = ex.unparsed_positions || [];
                                            let posIdx = 0;
                                            let loggedIdx = 0;
                                            ex.session_entries.forEach((entry, eni) => {
                                              while (posIdx < positions.length && positions[posIdx].pos === eni) {
                                                items.push(<Text selectable={true} key={`deload-view-u-pos-${gi}-${si}-${ei}-${posIdx}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{positions[posIdx].raw}</Text>);
                                                posIdx++;
                                              }
                                              if (entry.skipped) {
                                                items.push(<Text selectable={true} key={`deload-view-skip-${gi}-${si}-${ei}-${eni}`} style={styles.skipMarker}>—</Text>);
                                              } else if (entry.unparsed) {
                                                items.push(<Text selectable={true} key={`deload-view-u-inline-${gi}-${si}-${ei}-${eni}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{entry.raw}</Text>);
                                                renderedUnparsed.add(entry.raw);
                                              } else {
                                                const row = ex.rows[loggedIdx++];
                                                if (row) items.push(<SetLine key={`deload-view-row-${gi}-${si}-${ei}-${eni}`} sets={row.sets} selectable={true} />);
                                              }
                                            });
                                            while (posIdx < positions.length) {
                                              items.push(<Text selectable={true} key={`deload-view-u-pos-${gi}-${si}-${ei}-${posIdx}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{positions[posIdx].raw}</Text>);
                                              posIdx++;
                                            }
                                            const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
                                            ex.rows.slice(loggedCount).forEach((row, ri) => {
                                              items.push(<SetLine key={`deload-view-plain-${gi}-${si}-${ei}-${ri}`} sets={row.sets} selectable={true} />);
                                            });
                                            const positionalRaws = new Set(positions.map(p => p.raw));
                                            ex.unparsed_rows.forEach((u, ui) => {
                                              if (!positionalRaws.has(u) && !renderedUnparsed.has(u) && !renderedUnparsed.has(u.replace(/^-\s+/, ''))) {
                                                items.push(<Text selectable={true} key={`deload-view-u-${gi}-${si}-${ei}-${ui}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{u}</Text>);
                                              }
                                            });
                                            return items;
                                          })()}
                                        </ExerciseBlock>
                                      ))}
                                    </View>
                                  ))}
                                </View>
                              ))}
                              {!viewingNoteDayGroups.length && (
                                <Text selectable={true} style={styles.emptyText}>Deload note is empty.</Text>
                              )}
                            </Pressable>
                            <View style={styles.inlineActions}>
                              <Button
                                onPress={() => handleOpenOtherNote(note)}
                                title="Edit deload record"
                                style={styles.switchButton}
                                textStyle={styles.switchButtonText}
                              />
                            </View>
                          </>
                        )}
                      </Card>
                    );
                  }
                  // Legacy history record (no linked workout note) — read-only inline expand
                  const record = item.data;
                  const isExpanded = expandedDeloads.has(record.id);
                  const dateStr = localDate(record.completed_at).toLocaleDateString();
                  const generatedStr = record.generated_at ? localDate(record.generated_at).toLocaleDateString() : null;
                  const title = generatedStr && generatedStr !== dateStr
                    ? `Deload ${generatedStr}`
                    : `Deload ${dateStr}`;
                  return (
                    <Card key={record.id} style={styles.otherNoteCard}>
                      <Pressable
                        onPress={() => handleToggleLegacyDeload(record.id)}
                        style={styles.otherNoteHeader}
                      >
                        <View style={styles.otherNoteInfo}>
                          <Text style={styles.otherNoteTitle}>{title}</Text>
                          <Text style={styles.otherNoteSub}>Completed {dateStr}</Text>
                        </View>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            Alert.alert(
                              'Delete deload record?',
                              'This cannot be undone. The sessions-since-deload clock will reset based on your remaining history.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Delete', style: 'destructive', onPress: () => deleteDeload(record.id) },
                              ]
                            );
                          }}
                          style={styles.inlineSwitchButton}
                          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                        >
                          <Text style={styles.pastDeloadDeleteText}>Delete</Text>
                        </Pressable>
                      </Pressable>
                      {isExpanded && (
                        <Text selectable style={styles.pastDeloadContent}>{record.raw_text}</Text>
                      )}
                    </Card>
                  );
                })}
              </View>
            )}

            {effectiveTabView === 'routine' && mode === 'read' && hasContent && (
              <View style={styles.mirrorContainer}>
                <Card style={styles.currentRoutineCard}>
                  <Pressable
                    onPress={toggleCollapsed}
                    style={styles.otherNoteHeader}
                  >
                    <View style={styles.otherNoteInfo}>
                      <Text style={styles.currentNoteTitle}>{workoutNoteTitle || 'Untitled Routine'}</Text>
                      <Text style={styles.otherNoteSub}>
                        {hasABWeeks ? `Week ${effectiveActiveWeek} · Current routine` : 'Current routine'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {hasABWeeks && (
                        <Pressable
                          onPress={(e) => { e.stopPropagation(); handleToggleWeek(); }}
                          style={styles.inlineSwitchButton}
                          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                        >
                          <Text style={styles.inlineSwitchButtonText}>
                            Week {effectiveActiveWeek === 'B' ? 'A' : 'B'}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={(e) => { e.stopPropagation(); enterCurrentEditor(); }}
                        style={styles.inlineSwitchButton}
                        hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                      >
                        <Text style={styles.inlineSwitchButtonText}>Edit</Text>
                      </Pressable>
                    </View>
                  </Pressable>

                  <Pressable 
                    onPress={handleNoteBodyPress}
                    style={[styles.currentNoteContent, isCollapsed ? { display: 'none' } : null]}
                  >
                    <Text style={styles.editHint}>Double-tap to edit</Text>
                    {dayGroups.map((group, gi) => (
                      <View key={`day-${gi}`}>
                        {group.heading && (
                          <WorkoutHeading 
                            selectable={true}
                            style={gi === 0 ? { marginTop: 0 } : null}
                          >
                            {group.heading}
                          </WorkoutHeading>
                        )}
                        {group.sections.map((section, si) => (
                          <View key={`section-${gi}-${si}`}>
                            {section.subheading && (
                              <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
                            )}
                            {section.exercises.map((ex, ei) => {
                              const exNormName = normalizeLiftName(ex.name);
                              const isTracked = !!trackedLifts[exNormName];
                              const isFlagged = roughNoteId === currentId && roughFlaggedNames.has(exNormName);
                              return (
                              <View key={`ex-${gi}-${si}-${ei}`} style={isFlagged ? styles.flaggedExercise : null}>
                              <ExerciseBlock
                                name={ex.name}
                                isTracked={isTracked}
                                onToggleTrack={() => handleToggleTrack(ex.name)}
                                selectable={true}
                              >
                                {(() => {
                                  const items = [];
                                  const renderedUnparsed = new Set();
                                  const positions = ex.unparsed_positions || [];
                                  let posIdx = 0;
                                  let loggedIdx = 0;
                                  ex.session_entries.forEach((entry, eni) => {
                                    while (posIdx < positions.length && positions[posIdx].pos === eni) {
                                      items.push(<Text selectable={true} key={`u-pos-${gi}-${si}-${ei}-${posIdx}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{positions[posIdx].raw}</Text>);
                                      posIdx++;
                                    }
                                    if (entry.skipped) {
                                      items.push(<Text selectable={true} key={`skip-${gi}-${si}-${ei}-${eni}`} style={styles.skipMarker}>—</Text>);
                                    } else if (entry.unparsed) {
                                      items.push(<Text selectable={true} key={`u-inline-${gi}-${si}-${ei}-${eni}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{entry.raw}</Text>);
                                      renderedUnparsed.add(entry.raw);
                                    } else {
                                      const row = ex.rows[loggedIdx++];
                                      if (row) items.push(<SetLine key={`row-${gi}-${si}-${ei}-${eni}`} sets={row.sets} selectable={true} />);
                                    }
                                  });
                                  while (posIdx < positions.length) {
                                    items.push(<Text selectable={true} key={`u-pos-${gi}-${si}-${ei}-${posIdx}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{positions[posIdx].raw}</Text>);
                                    posIdx++;
                                  }
                                  const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
                                  ex.rows.slice(loggedCount).forEach((row, ri) => {
                                    items.push(<SetLine key={`plain-${gi}-${si}-${ei}-${ri}`} sets={row.sets} selectable={true} />);
                                  });
                                  const positionalRaws = new Set(positions.map(p => p.raw));
                                  ex.unparsed_rows.forEach((u, ui) => {
                                    if (!positionalRaws.has(u) && !renderedUnparsed.has(u) && !renderedUnparsed.has(u.replace(/^-\s+/, ''))) {
                                      items.push(<Text selectable={true} key={`u-${gi}-${si}-${ei}-${ui}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{u}</Text>);
                                    }
                                  });
                                  return items;
                                })()}
                              </ExerciseBlock>
                              </View>
                              );
                            })}
                          </View>
                        ))}
                      </View>
                    ))}
                    {!dayGroups.length && (
                      <Text selectable={true} style={styles.emptyText}>Add some exercises to see the formatted view.</Text>
                    )}
                  </Pressable>
                </Card>
              </View>
            )}


            {effectiveTabView === 'routine' && (
              <View style={styles.previousRoutines}>
                {otherNotes.length > 0 && (
                  <>
                    <SectionTitle>More Routines</SectionTitle>
                    {otherNotes.map(other => (
                      <Card
                        key={other.id}
                        style={styles.otherNoteCard}
                      >
                        <Pressable
                          onPress={() => handleViewOtherNote(other)}
                          style={styles.otherNoteHeader}
                        >
                          <View style={styles.otherNoteInfo}>
                            <Text style={styles.otherNoteTitle}>{other.title || 'Untitled Routine'}</Text>
                            {other.updated_at && (
                              <Text style={styles.otherNoteSub}>{localDate(other.updated_at).toLocaleDateString()}</Text>
                            )}
                          </View>
                          <Pressable
                            onPress={(e) => { e.stopPropagation(); handleSwitchCurrent(other.id); }}
                            style={styles.inlineSwitchButton}
                            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                          >
                            <Text style={styles.inlineSwitchButtonText}>Set as current routine</Text>
                          </Pressable>
                        </Pressable>
                        {viewingNoteId === other.id && viewingNote && (
                          <>
                            <Pressable onPress={handleViewedNoteBodyPress} style={styles.currentNoteContent}>
                              <Text style={styles.editHint}>Double-tap to edit</Text>
                              {viewingNoteDayGroups.map((group, gi) => (
                                <View key={`view-day-${gi}`}>
                                  {group.heading && (
                                    <WorkoutHeading selectable={true} style={gi === 0 ? { marginTop: 0 } : null}>
                                      {group.heading}
                                    </WorkoutHeading>
                                  )}
                                  {group.sections.map((section, si) => (
                                    <View key={`view-section-${gi}-${si}`}>
                                      {section.subheading && (
                                        <WorkoutSubheading selectable={true}>{section.subheading}</WorkoutSubheading>
                                      )}
                                      {section.exercises.map((ex, ei) => (
                                        <ExerciseBlock key={`view-ex-${gi}-${si}-${ei}`} name={ex.name} selectable={true}>
                                          {(() => {
                                            const items = [];
                                            const renderedUnparsed = new Set();
                                            const positions = ex.unparsed_positions || [];
                                            let posIdx = 0;
                                            let loggedIdx = 0;
                                            ex.session_entries.forEach((entry, eni) => {
                                              while (posIdx < positions.length && positions[posIdx].pos === eni) {
                                                items.push(<Text selectable={true} key={`view-u-pos-${gi}-${si}-${ei}-${posIdx}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{positions[posIdx].raw}</Text>);
                                                posIdx++;
                                              }
                                              if (entry.skipped) {
                                                items.push(<Text selectable={true} key={`view-skip-${gi}-${si}-${ei}-${eni}`} style={styles.skipMarker}>—</Text>);
                                              } else if (entry.unparsed) {
                                                items.push(<Text selectable={true} key={`view-u-inline-${gi}-${si}-${ei}-${eni}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{entry.raw}</Text>);
                                                renderedUnparsed.add(entry.raw);
                                              } else {
                                                const row = ex.rows[loggedIdx++];
                                                if (row) items.push(<SetLine key={`view-row-${gi}-${si}-${ei}-${eni}`} sets={row.sets} selectable={true} />);
                                              }
                                            });
                                            while (posIdx < positions.length) {
                                              items.push(<Text selectable={true} key={`view-u-pos-${gi}-${si}-${ei}-${posIdx}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{positions[posIdx].raw}</Text>);
                                              posIdx++;
                                            }
                                            const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
                                            ex.rows.slice(loggedCount).forEach((row, ri) => {
                                              items.push(<SetLine key={`view-plain-${gi}-${si}-${ei}-${ri}`} sets={row.sets} selectable={true} />);
                                            });
                                            const positionalRaws = new Set(positions.map(p => p.raw));
                                            ex.unparsed_rows.forEach((u, ui) => {
                                              if (!positionalRaws.has(u) && !renderedUnparsed.has(u) && !renderedUnparsed.has(u.replace(/^-\s+/, ''))) {
                                                items.push(<Text selectable={true} key={`view-u-${gi}-${si}-${ei}-${ui}`} style={section.kind === 'lifting' ? styles.unparsedRow : styles.unparsedRowMuted}>{u}</Text>);
                                              }
                                            });
                                            return items;
                                          })()}
                                        </ExerciseBlock>
                                      ))}
                                    </View>
                                  ))}
                                </View>
                              ))}
                              {!viewingNoteDayGroups.length && (
                                <Text selectable={true} style={styles.emptyText}>No exercises to display.</Text>
                              )}
                            </Pressable>
                            <View style={styles.inlineActions}>
                              <Button
                                onPress={handleEditViewedNote}
                                title="Edit routine"
                                style={styles.switchButton}
                                textStyle={styles.switchButtonText}
                              />
                              <Button
                                onPress={() => viewingNote && handleDeleteRoutine(viewingNoteId, viewingNote.title || 'Untitled Routine', false)}
                                title="Delete routine"
                                style={styles.deleteButton}
                                textStyle={styles.deleteButtonText}
                              />
                            </View>
                          </>
                        )}
                      </Card>
                    ))}
                  </>
                )}
                <Button
                  onPress={handleCreateRoutine}
                  title="+ New routine"
                  style={styles.createButton}
                  textStyle={styles.createButtonText}
                />
              </View>
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
        {saveError ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{saveError}</Text>
          </Card>
        ) : null}
        {deloadMode === 'edit' ? (
          <View style={styles.editContainer}>
            <Card>
              <TextInput
                value={deloadEditText}
                onChangeText={setDeloadEditText}
                placeholder="Deload note…"
                placeholderTextColor={Colors.textMuted}
                multiline
                style={[styles.input, styles.editorInput]}
              />
              <Button
                onPress={handleSaveDeload}
                title={saveSuccess ? 'Saved!' : 'Save changes'}
                disabled={isSaving}
                style={styles.saveButton}
              />
            </Card>
          </View>
        ) : (
          <View style={styles.editContainer}>
            <Card>
              {/* Title input is hidden for deload records: their title encodes the
                  classification prefix "Deload · " and must not be freely edited.
                  Date changes go through the DateTimePicker which keeps the prefix intact. */}
              {!isEditingDeloadNote && (
                <TextInput
                  value={editingNoteId ? editingTitle : workoutNoteTitle}
                  onChangeText={editingNoteId ? setEditingTitle : setWorkoutNoteTitle}
                  placeholder="Routine Name (e.g. Push Day)"
                  placeholderTextColor={Colors.textMuted}
                  style={[styles.input, styles.titleInput]}
                />
              )}
              {isEditingDeloadNote && deloadDateEditEnabled && (
                <>
                  <Text style={styles.inputLabel}>Date</Text>
                  <Pressable
                    style={[styles.input, styles.dateInput]}
                    onPress={editingDeloadHasLinkedRecord ? () => setShowDeloadDatePicker(true) : undefined}
                    accessibilityLabel="Deload date"
                    accessibilityRole={editingDeloadHasLinkedRecord ? 'button' : 'text'}
                  >
                    <Text style={styles.dateInputText}>{deloadEditDate || '—'}</Text>
                  </Pressable>
                  {editingDeloadHasLinkedRecord && (
                    <>
                      <Text style={styles.inputLabel}>Session #</Text>
                      <TextInput
                        style={styles.input}
                        value={deloadEditOrdinal}
                        onChangeText={v => setDeloadEditOrdinal(v.replace(/[^0-9]/g, ''))}
                        keyboardType="number-pad"
                        placeholder="Session number"
                        placeholderTextColor={Colors.textMuted}
                        accessibilityLabel="Deload session number"
                      />
                    </>
                  )}
                  {editingDeloadHasLinkedRecord && showDeloadDatePicker && (
                    <DateTimePicker
                      value={(() => {
                        if (deloadEditDate) {
                          const [y, m, d] = deloadEditDate.split('-').map(Number);
                          return new Date(y, m - 1, d);
                        }
                        return new Date();
                      })()}
                      mode="date"
                      display="default"
                      maximumDate={new Date()}
                      onChange={(event, selectedDate) => {
                        setShowDeloadDatePicker(false);
                        if (selectedDate) {
                          const y = selectedDate.getFullYear();
                          const mo = String(selectedDate.getMonth() + 1).padStart(2, '0');
                          const dy = String(selectedDate.getDate()).padStart(2, '0');
                          const newDateStr = `${y}-${mo}-${dy}`;
                          setDeloadEditDate(newDateStr);
                          setEditingTitle(DELOAD_NOTE_PREFIX + newDateStr);
                        }
                      }}
                      onDismiss={() => setShowDeloadDatePicker(false)}
                    />
                  )}
                </>
              )}
              <TextInput
                value={editingNoteId ? editingText : workoutNoteText}
                onChangeText={editingNoteId ? setEditingText : setWorkoutNoteText}
                placeholder="e.g.&#10;Monday&#10;+Lifting&#10;-Bench&#10;135 5,5,5"
                placeholderTextColor={Colors.textMuted}
                multiline
                style={[styles.input, styles.editorInput]}
              />
              {(editingNoteId === 'new' || (!editingNoteId && !currentId)) ? (
                <Button
                  onPress={editingNoteId ? handleSaveOtherNote : handleSave}
                  title="Save"
                  disabled={editingNoteId ? noteIsSaving : isSaving}
                  style={styles.saveButton}
                />
              ) : saveSuccess ? (
                <Text style={styles.autosaveIndicator}>{saveSuccess}</Text>
              ) : null}
            </Card>
            {editingNoteId && !isEditingDeloadNote && (
              <Button
                onPress={() => handleSwitchCurrent(editingNoteId)}
                title="Set as current routine"
                style={styles.switchButton}
                textStyle={styles.switchButtonText}
              />
            )}
            <Button
              onPress={() => {
                if (editingNoteId) {
                  if (isEditingDeloadNote) {
                    handleDeleteDeloadNoteFromEditor();
                  } else {
                    handleDeleteRoutine(editingNoteId, editingTitle || 'Untitled Routine', false);
                  }
                } else {
                  handleDeleteRoutine(currentId, workoutNoteTitle || 'Untitled Routine', true);
                }
              }}
              title={isEditingDeloadNote ? 'Delete deload record' : 'Delete routine'}
              style={styles.deleteButton}
              textStyle={styles.deleteButtonText}
            />
          </View>
        )}
      </ScreenShell>
      <Modal
        visible={showDeloadOrdinalPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeloadOrdinalPrompt(false)}
      >
        <View style={styles.ordinalOverlay}>
          <View style={styles.ordinalSheet}>
            <Text style={styles.ordinalTitle}>Which session number is this deload?</Text>
            <Text style={styles.ordinalSubtitle}>
              Prefilled from your current note. Edit if your real session count differs.
            </Text>
            <TextInput
              style={styles.ordinalInput}
              value={deloadOrdinalInput}
              onChangeText={setDeloadOrdinalInput}
              keyboardType="number-pad"
              selectTextOnFocus
              autoFocus
            />
            <View style={styles.ordinalButtons}>
              <Pressable
                style={styles.ordinalCancel}
                onPress={() => setShowDeloadOrdinalPrompt(false)}
              >
                <Text style={styles.ordinalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.ordinalConfirm}
                onPress={handleConfirmDeloadOrdinal}
              >
                <Text style={styles.ordinalConfirmText}>Deload complete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  errorText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    borderColor: Colors.error,
    backgroundColor: '#fff0f0', // Slight red tint
    padding: 12,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
  },
  titleInput: {
    marginBottom: 12,
    fontWeight: '700',
  },
  editorInput: {
    minHeight: 250,
    textAlignVertical: 'top',
  },
  saveButton: {
    marginTop: 12,
  },
  mirrorContainer: {
    paddingBottom: 2,
  },
  currentRoutineCard: {
    padding: 0,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: Colors.cardBorder,
  },
  unparsedRow: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.error,
    paddingLeft: 0,
  },
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.text,
    paddingLeft: 0,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 40,
  },
  editButton: {
    marginTop: 32,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  editButtonText: {
    color: Colors.accent,
  },
  skipMarker: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.textMuted,
  },
  flaggedExercise: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
    marginLeft: -3,
  },
  editContainer: {
    gap: 16,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  switchButtonText: {
    color: Colors.accent,
  },
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  deleteButtonText: {
    color: Colors.error,
  },
  previousRoutines: {
    marginTop: 4,
    gap: 12,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  inlineActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  autosaveIndicator: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'right',
    marginTop: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 6,
    marginTop: 4,
  },
  dateInput: {
    justifyContent: 'center',
    marginBottom: 12,
  },
  dateInputText: {
    fontSize: 16,
    color: Colors.text,
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    gap: 12,
  },
  otherNoteInfo: {
    flex: 1,
  },
  otherNoteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  currentNoteTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.accent,
  },
  otherNoteSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  editHint: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  currentNoteContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.chipBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  createButton: {
    marginTop: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.accent,
    borderStyle: 'dashed',
  },
  createButtonText: {
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
  deloadEmpty: {
    marginTop: 40,
    alignItems: 'center',
    gap: 16,
  },
  deloadEmptyText: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  generateButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  generateButtonText: {
    color: Colors.accent,
  },
  pastDeloads: {
    marginTop: 8,
    gap: 8,
  },
  pastDeloadDeleteText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  pastDeloadContent: {
    fontSize: 13,
    color: Colors.text,
    fontFamily: 'monospace',
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  ordinalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(31,26,23,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ordinalSheet: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 24,
    gap: 12,
  },
  ordinalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  ordinalSubtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  ordinalInput: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  ordinalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  ordinalCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.chipBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  ordinalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  ordinalConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.accent,
  },
  ordinalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },

});
