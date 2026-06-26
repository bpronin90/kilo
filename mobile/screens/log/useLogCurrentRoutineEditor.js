import { useState, useEffect, useRef, useMemo } from 'react';
import { Alert, Keyboard, Platform } from 'react-native';
import { parseWorkoutNote, countWorkoutSessionsFromSections } from '../../lib/parser';
import {
  normalizeLiftName,
  deriveWorkoutNoteAnalytics,
  listTrackedLifts,
  getDefaultTrackedNames,
  deriveSkipData,
  deriveSessionCheckIn,
} from '../../lib/data';
import { AUTOSAVE_DEBOUNCE_MS } from '../../lib/LogScreenHelpers';
import { buildDayGroups } from './logScreenHelpers';

export function useLogCurrentRoutineEditor({
  workoutNoteText,
  setWorkoutNoteText,
  workoutNoteTitle,
  setWorkoutNoteTitle,
  currentId,
  currentNote,
  notes,
  trackedLifts,
  update,
  add,
  selectCurrent,
  fatigueTrackingEnabled,
  onCheckInPrompt,
  editorScrollRef,
  readScrollRef,
}) {
  const [mode, setMode] = useState('read');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [originalNoteState, setOriginalNoteState] = useState(null);
  const [roughFlaggedNames, setRoughFlaggedNames] = useState(new Set());
  const [roughSessionIndex, setRoughSessionIndex] = useState(null);
  const [roughNoteId, setRoughNoteId] = useState(null);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [roughCheckInData, setRoughCheckInData] = useState(null);

  const keyboardVisibleRef = useRef(false);
  const lastTapRef = useRef(0);
  const keyboardExitTimeoutRef = useRef(null);
  const readScrollYRef = useRef(0);
  const autosaveCurrentTimerRef = useRef(null);

  // Live-value refs so async save callbacks read current state without stale closures.
  const workoutNoteTextRef = useRef(workoutNoteText);
  const workoutNoteTitleRef = useRef(workoutNoteTitle);
  const currentIdRef = useRef(currentId);
  const currentNoteRef = useRef(currentNote);
  workoutNoteTextRef.current = workoutNoteText;
  workoutNoteTitleRef.current = workoutNoteTitle;
  currentIdRef.current = currentId;
  currentNoteRef.current = currentNote;

  const handleReadScroll = (e) => {
    readScrollYRef.current = e.nativeEvent.contentOffset.y;
  };

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  useEffect(() => {
    if (roughSessionIndex == null) return;
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

  const parsed = useMemo(() => parseWorkoutNote(workoutNoteText), [workoutNoteText]);

  const logSessionCount = useMemo(
    () => countWorkoutSessionsFromSections(parsed.sections),
    [parsed.sections]
  );

  const weekBStartIndex = parsed.weekBStartIndex ?? null;
  const hasABWeeks = weekBStartIndex !== null;
  const effectiveActiveWeek = hasABWeeks ? (currentNote?.activeWeek ?? 'A') : null;

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

  const dayGroups = useMemo(
    () => buildDayGroups(activeWeekParsed.sections),
    [activeWeekParsed]
  );

  const hasUnsavedCurrent = useMemo(() => {
    if (!currentNote) return workoutNoteTitle.trim() !== '' || workoutNoteText.trim() !== '';
    return workoutNoteTitle !== (currentNote.title || '') || workoutNoteText !== currentNote.raw_text;
  }, [currentNote, workoutNoteTitle, workoutNoteText]);

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

  useEffect(() => {
    return () => {
      if (autosaveCurrentTimerRef.current) clearTimeout(autosaveCurrentTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => { keyboardVisibleRef.current = true; });
    const hideSub = Keyboard.addListener(hideEvent, () => { keyboardVisibleRef.current = false; });
    return () => {
      showSub.remove();
      hideSub.remove();
      if (keyboardExitTimeoutRef.current) clearTimeout(keyboardExitTimeoutRef.current);
    };
  }, []);

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

  const handleToggleWeek = async () => {
    if (!currentId || !hasABWeeks) return;
    const next = effectiveActiveWeek === 'B' ? 'A' : 'B';
    await update(currentId, { activeWeek: next });
  };

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

  return {
    mode,
    isSaving,
    saveError,
    setSaveError,
    saveSuccess,
    setSaveSuccess,
    originalNoteState,
    setOriginalNoteState,
    roughFlaggedNames,
    roughSessionIndex,
    roughNoteId,
    showCheckInModal,
    setShowCheckInModal,
    roughCheckInData,
    hasUnsavedCurrent,
    autosaveCurrentTimerRef,
    handleReadScroll,
    handleNoteBodyPress,
    handleSave,
    enterCurrentEditor,
    handleDoneCurrent,
    handleUndoCurrent,
    handleCurrentTextChange,
    handleToggleWeek,
    hasABWeeks,
    effectiveActiveWeek,
    activeEditText,
    activeWeekParsed,
    dayGroups,
    parsed,
    logSessionCount,
  };
}
