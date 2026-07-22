import { useState, useEffect, useRef, useMemo } from 'react';
import { Alert, Keyboard, Platform } from 'react-native';
import { parseWorkoutNote, countWorkoutSessionsFromSections, applyWeekSkipToText } from '../../lib/parser';
import { removeWeekSkipFromText } from '../../lib/parser/workoutNote.js';
import {
  normalizeLiftName,
  deriveWorkoutNoteAnalytics,
  listTrackedLifts,
  getDefaultTrackedNames,
  deriveSkipData,
  deriveSessionCheckIn,
  computeWeeksIn,
} from '../../lib/data';
import { AUTOSAVE_DEBOUNCE_MS } from '../../lib/LogScreenHelpers';
import { buildDayGroups } from './logScreenHelpers';

function isValidActiveWeek(value) {
  return value === 'A' || value === 'B';
}

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
  isActive,
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
  const [skipWeekStatus, setSkipWeekStatus] = useState('');

  const keyboardVisibleRef = useRef(false);
  const lastTapRef = useRef(0);
  const keyboardExitTimeoutRef = useRef(null);
  const readScrollYRef = useRef(0);
  const autosaveCurrentTimerRef = useRef(null);
  const pendingActiveWeekRef = useRef(null);
  const activeWeekAuthorityRef = useRef(
    isValidActiveWeek(currentNote?.activeWeek) ? 'persisted' : 'fallback'
  );

  // Live-value refs so async save callbacks read current state without stale closures.
  const workoutNoteTextRef = useRef(workoutNoteText);
  const workoutNoteTitleRef = useRef(workoutNoteTitle);
  const currentIdRef = useRef(currentId);
  const currentNoteRef = useRef(currentNote);
  const modeRef = useRef(mode);
  workoutNoteTextRef.current = workoutNoteText;
  workoutNoteTitleRef.current = workoutNoteTitle;
  currentIdRef.current = currentId;
  currentNoteRef.current = currentNote;
  modeRef.current = mode;

  const noteIdentity = currentNote?.id ?? currentId ?? null;
  const [localActiveWeek, setLocalActiveWeek] = useState(
    () => (isValidActiveWeek(currentNote?.activeWeek) ? currentNote.activeWeek : null)
  );
  const previousNoteIdentityRef = useRef(noteIdentity);

  // Universal-skip counter: how many not-yet-removed 'Skip week' presses this
  // note has. Persisted inside skip_markers (same single update as raw_text,
  // see handleSave) so a partial write can never desync it from the text.
  // Advisory only — it decides whether 'Remove skip' needs a confirmation
  // dialog (manual skips) and never causes removal of anything the
  // text-driven rules wouldn't remove. Held in a ref (local authority after
  // any mutation in this session, like activeWeek) and re-seeded from the
  // persisted note whenever the note identity changes.
  const _persistedUniversalSkipCount = (note) => {
    const v = note?.skip_markers?.universal_skip_count;
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const universalSkipCountRef = useRef(_persistedUniversalSkipCount(currentNote));
  useEffect(() => {
    universalSkipCountRef.current = _persistedUniversalSkipCount(currentNoteRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIdentity]);

  const handleReadScroll = (e) => {
    readScrollYRef.current = e.nativeEvent.contentOffset.y;
  };

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  // 'Skip week' / 'Undo skip' are used from the read-mode card (not the
  // editor), so they can't rely on the editor's saveSuccess banner. This
  // message is the visible confirmation that a skip was applied or removed
  // (or that the press was a no-op), so presses are never silent.
  useEffect(() => {
    if (skipWeekStatus) {
      const timer = setTimeout(() => setSkipWeekStatus(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [skipWeekStatus]);

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

  // Fire check-in detection when the Log tab loses focus (user switches away while editing).
  useEffect(() => {
    if (isActive === false && modeRef.current === 'edit') {
      _runCheckInDetection();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  const parsed = useMemo(() => parseWorkoutNote(workoutNoteText), [workoutNoteText]);

  const logSessionCount = useMemo(
    () => countWorkoutSessionsFromSections(parsed.sections),
    [parsed.sections]
  );

  const weekBStartIndex = parsed.weekBStartIndex ?? null;
  const hasABWeeks = weekBStartIndex !== null;
  const effectiveActiveWeek = hasABWeeks ? (localActiveWeek ?? 'A') : null;
  const activeWeekPatch =
    hasABWeeks && isValidActiveWeek(effectiveActiveWeek)
      ? { activeWeek: effectiveActiveWeek }
      : {};

  useEffect(() => {
    const noteChanged = previousNoteIdentityRef.current !== noteIdentity;
    previousNoteIdentityRef.current = noteIdentity;

    const persistedActiveWeek = isValidActiveWeek(currentNote?.activeWeek)
      ? currentNote.activeWeek
      : null;

    if (!hasABWeeks) {
      pendingActiveWeekRef.current = null;
      activeWeekAuthorityRef.current = 'fallback';
      setLocalActiveWeek(null);
      return;
    }

    if (noteChanged) {
      pendingActiveWeekRef.current = null;
      activeWeekAuthorityRef.current = persistedActiveWeek ? 'persisted' : 'fallback';
      setLocalActiveWeek(persistedActiveWeek ?? 'A');
      return;
    }

    if (pendingActiveWeekRef.current && persistedActiveWeek === pendingActiveWeekRef.current) {
      pendingActiveWeekRef.current = null;
    }

    if (activeWeekAuthorityRef.current === 'fallback' && persistedActiveWeek) {
      activeWeekAuthorityRef.current = 'persisted';
      setLocalActiveWeek(prev => (prev === persistedActiveWeek ? prev : persistedActiveWeek));
      return;
    }

    setLocalActiveWeek(prev => (isValidActiveWeek(prev) ? prev : (persistedActiveWeek ?? 'A')));
  }, [currentNote?.activeWeek, hasABWeeks, noteIdentity]);

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

  // Whether there is a trailing skip marker on at least one exercise in the
  // active week, i.e. whether 'Undo skip' has anything to remove. Used to
  // disable/no-op the undo action instead of silently doing nothing.
  const canUnskipWeek = useMemo(() => {
    for (const section of activeWeekParsed.sections) {
      for (const ex of section.exercises) {
        const entries = ex.session_entries;
        const last = entries[entries.length - 1];
        if (last && last.skipped) return true;
      }
    }
    return false;
  }, [activeWeekParsed]);

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
    const previous = effectiveActiveWeek ?? 'A';
    const previousAuthority = activeWeekAuthorityRef.current;
    const next = previous === 'B' ? 'A' : 'B';
    activeWeekAuthorityRef.current = 'user';
    pendingActiveWeekRef.current = next;
    setLocalActiveWeek(next);
    try {
      const updated = await update(currentId, { activeWeek: next });
      if (!updated) {
        pendingActiveWeekRef.current = null;
        activeWeekAuthorityRef.current = previousAuthority;
        setLocalActiveWeek(previous);
      }
    } catch (err) {
      pendingActiveWeekRef.current = null;
      activeWeekAuthorityRef.current = previousAuthority;
      setLocalActiveWeek(previous);
      throw err;
    }
  };

  // universalSkipCount: explicit new value for the universal-skip counter
  // (skip/unskip paths); omitted = carry the current value forward unchanged.
  // sessionCheckins: full replacement session_checkins object to persist in
  // the SAME update as raw_text (unskip cleanup path); omitted = untouched.
  // Bundling both here keeps text, counter, and check-in cleanup atomic — a
  // failed save changes none of them.
  const handleSave = async ({ autosave = false, overrideText, universalSkipCount, sessionCheckins } = {}) => {
    if (isSaving) return;
    const textToSave = overrideText ?? workoutNoteText;
    if (!currentId && !textToSave.trim()) {
      setSaveError('Workout notes are required');
      return;
    }
    const savedForId = currentId;
    const snapshotText = textToSave;
    const snapshotTitle = workoutNoteTitle;
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      let result = null;
      const titleToSave = workoutNoteTitle || 'Untitled Routine';
      const { sections: savedSections } = parseWorkoutNote(textToSave);
      const explicitTrackedNames = listTrackedLifts(trackedLifts);
      const defaultNames = getDefaultTrackedNames();
      const normalizedDefaults = new Set(defaultNames.map(n => normalizeLiftName(n)));
      const trackedNames = [
        ...defaultNames,
        ...explicitTrackedNames.filter(n => !normalizedDefaults.has(normalizeLiftName(n))),
      ];
      const allSections = [
        ...notes.flatMap(n => {
          const text = n.id === currentId ? textToSave : n.raw_text;
          return text ? parseWorkoutNote(text).sections : [];
        }),
        ...(currentId ? [] : savedSections),
      ];
      const { classifications: exercise_classifications } =
        deriveWorkoutNoteAnalytics(allSections, trackedNames);
      const { exercise_skips, day_skips, attendance_flags } = deriveSkipData(savedSections);
      const resolvedUniversalSkipCount = Math.max(
        0,
        universalSkipCount ?? universalSkipCountRef.current
      );
      const skip_markers = { exercise_skips, day_skips, universal_skip_count: resolvedUniversalSkipCount };

      if (currentId) {
        result = await update(currentId, {
          title: titleToSave,
          raw_text: textToSave,
          exercise_classifications,
          skip_markers,
          attendance_flags,
          ...(sessionCheckins !== undefined ? { session_checkins: sessionCheckins } : {}),
          ...activeWeekPatch,
        });
      } else {
        result = await add(titleToSave, workoutNoteText);
        await selectCurrent(result.id);
        if (result) {
          await update(result.id, {
            exercise_classifications,
            skip_markers,
            attendance_flags,
            ...activeWeekPatch,
          });
        }
      }

      if (result) {
        // Commit the counter only after the write actually persisted, so a
        // failed save leaves the advisory flag in sync with the stored text.
        universalSkipCountRef.current = resolvedUniversalSkipCount;
        const contentUnchanged =
          (overrideText != null ? overrideText : workoutNoteTextRef.current) === snapshotText &&
          workoutNoteTitleRef.current === snapshotTitle;
        const identityUnchanged = !savedForId || currentIdRef.current === savedForId;
        if (contentUnchanged && identityUnchanged) {
          setWorkoutNoteTitle(result.title || '');
          setWorkoutNoteText(result.raw_text || '');
          if (!autosave) setSaveSuccess('Saved on device');
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
        ...activeWeekPatch,
      });
      setWorkoutNoteTitle(originalNoteState.title);
      setWorkoutNoteText(originalNoteState.text);
    } catch (err) {
      console.warn('Undo revert failed:', err);
      Alert.alert('Error', 'Failed to revert changes. Please try again.');
    }
  };

  // Splices a transformed active-week body back into the full note text,
  // preserving the other A/B week's body untouched. Shared by handleSkipWeek
  // and handleUnskipWeek so both stay consistent with the existing A/B
  // active-week slicing in activeEditText/handleCurrentTextChange.
  const _spliceActiveText = (newActiveText) => {
    if (!hasABWeeks) return newActiveText;
    const lines = workoutNoteText.split('\n');
    const sepIdx = lines.findIndex(l => l.trim() === '---');
    if (sepIdx === -1) return newActiveText;
    if (effectiveActiveWeek === 'A') {
      return newActiveText + '\n---\n' + lines.slice(sepIdx + 1).join('\n');
    }
    return lines.slice(0, sepIdx).join('\n') + '\n---\n' + newActiveText;
  };

  const handleSkipWeek = async () => {
    if (!currentId) return;
    const newActiveText = applyWeekSkipToText(activeEditText, activeWeekParsed.sections);
    if (newActiveText === activeEditText) {
      // No eligible logged exercise to skip: surface this so the press is
      // never silent.
      setSkipWeekStatus('No logged exercises to skip');
      return;
    }

    const prevFullText = workoutNoteText;
    const newFullText = _spliceActiveText(newActiveText);
    setWorkoutNoteText(newFullText);
    workoutNoteTextRef.current = newFullText;
    const saved = await handleSave({
      overrideText: newFullText,
      // One more outstanding universal skip; persisted atomically with the
      // text (inside skip_markers) and committed to the ref only on success.
      universalSkipCount: universalSkipCountRef.current + 1,
    });
    if (!saved) {
      // Revert the optimistic local text so it stays in sync with what was
      // actually persisted and 'try again' starts from the same state.
      setWorkoutNoteText(prevFullText);
      workoutNoteTextRef.current = prevFullText;
      setSkipWeekStatus('Could not save skip — try again');
      return;
    }
    setSkipWeekStatus('Skip applied');
    _runCheckInDetection();
  };

  // Performs the actual removal for handleUnskipWeek once any confirmation
  // has been resolved. nextUniversalSkipCount is the counter value to persist
  // alongside the removal (count-1 on a universal undo, 0 on a confirmed
  // manual removal). Text, counter, and check-in cleanup are persisted in one
  // update via handleSave so a partial write can never desync them.
  const _performUnskipRemoval = async (newActiveText, nextUniversalSkipCount) => {
    // The session being removed is the note's current deepest session column
    // (the one the just-removed trailing skip belonged to), computed from the
    // full note text before the removal — this matches the sessionIndex
    // _runCheckInDetection used when it recorded a fatigue-reason check-in
    // for that skip.
    const removedSessionIndex = computeWeeksIn(parseWorkoutNote(workoutNoteText).sections) - 1;

    // Drop the fatigue-reason check-in recorded for the removed session (if
    // any), and re-key any remaining check-ins whose session index shifted
    // down by one so they stay attached to the correct session. Sessions
    // before the removed one are untouched. Computed up front so it rides in
    // the same update as raw_text.
    let sessionCheckins; // undefined = leave persisted check-ins untouched
    const prevCheckins = currentNoteRef.current?.session_checkins;
    if (prevCheckins && typeof prevCheckins === 'object' && removedSessionIndex >= 0) {
      const nextCheckins = {};
      let changed = false;
      for (const [key, value] of Object.entries(prevCheckins)) {
        const idx = Number(key);
        if (idx === removedSessionIndex) { changed = true; continue; }
        const nextIdx = idx > removedSessionIndex ? idx - 1 : idx;
        if (nextIdx !== idx) changed = true;
        nextCheckins[String(nextIdx)] = value;
      }
      if (changed) sessionCheckins = nextCheckins;
    }

    const prevFullText = workoutNoteText;
    const newFullText = _spliceActiveText(newActiveText);
    setWorkoutNoteText(newFullText);
    workoutNoteTextRef.current = newFullText;
    const saved = await handleSave({
      overrideText: newFullText,
      universalSkipCount: nextUniversalSkipCount,
      sessionCheckins,
    });
    if (!saved) {
      // Revert the optimistic local text: nothing persisted (text, counter,
      // and check-in cleanup travel in one update), so the local state must
      // return to match — otherwise a retry would find no trailing skip and
      // the stale-clamp path would desync the counter from the stored text.
      setWorkoutNoteText(prevFullText);
      workoutNoteTextRef.current = prevFullText;
      setSkipWeekStatus('Could not remove skip — try again');
      return;
    }

    // Removing a skip is not new logged work, so it does not run fatigue
    // check-in detection — only a successful 'Skip week' save does.
    setSkipWeekStatus('Skip removed');
  };

  const handleUnskipWeek = async () => {
    if (!currentId) return;
    const newActiveText = removeWeekSkipFromText(activeEditText, activeWeekParsed.sections);
    const count = universalSkipCountRef.current;
    if (newActiveText === activeEditText) {
      // Nothing to undo: no exercise currently ends in a skip marker. The
      // text-driven no-op rule always wins; if the advisory counter says
      // otherwise it is stale (hand-edited text), so clamp it to reality.
      setSkipWeekStatus('No skip to remove');
      if (count > 0) {
        const prevMarkers = currentNoteRef.current?.skip_markers;
        try {
          const clamped = await update(currentId, {
            skip_markers: { ...(prevMarkers || {}), universal_skip_count: 0 },
          });
          // Commit the ref only after the clamp actually persisted (same
          // rule as every other counter write). On a falsy result or a
          // rejection the ref keeps the stale value, so the next press
          // retries the clamp instead of becoming a pure no-op while
          // persistence still holds the stale counter.
          if (clamped) universalSkipCountRef.current = 0;
        } catch {
          // Advisory-only flag: a failed clamp write just leaves it stale
          // (and retryable); the text-driven rules still decide what can
          // be removed.
        }
      }
      return;
    }

    if (count > 0) {
      // The trailing skips include at least one Skip-week press: undo one.
      await _performUnskipRemoval(newActiveText, count - 1);
      return;
    }

    // Counter says no outstanding Skip-week press, but trailing skips exist:
    // they were added manually (per-exercise dashes). Confirm before
    // deleting the user's hand-entered history.
    Alert.alert(
      'Remove skips?',
      "These skips weren't added by Skip week. Remove them anyway?",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => _performUnskipRemoval(newActiveText, 0),
        },
      ]
    );
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
    handleSkipWeek,
    handleUnskipWeek,
    canUnskipWeek,
    skipWeekStatus,
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
