import { useState, useEffect, useRef, useMemo } from 'react';
import { Keyboard, Platform } from 'react-native';
import { Alert } from '../../lib/platformAlert';
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
import { loadRecoveryExcludedNoteIds } from '../../hooks/entries/recoveryBlockHooks';
import { AUTOSAVE_DEBOUNCE_MS, DELOAD_NOTE_PREFIX } from '../../lib/LogScreenHelpers';
import { buildDayGroups } from './logScreenHelpers';

function isValidActiveWeek(value) {
  return value === 'A' || value === 'B';
}

// At most one check-in prompt per this many session indices (D10 §4.2). The
// window is measured from the last session actually ASKED about — every key in
// session_checkins was produced by a prompt — not from the last rough session,
// so a suppressed session never extends it. Sustained fatigue escalates through
// Deload/Recovery, not by re-asking a question whose answer changes nothing.
const CHECKIN_COOLDOWN_SESSIONS = 3;

// True when a prompt for `sessionIndex` falls inside the cooldown window of an
// existing check-in record. Only keys at or below the current session are
// consulted: records above it (text cut down or hand-edited) are orphans, and
// are ignored rather than deleted — deleting them would be a historical-record
// change.
function _checkInCooldownActive(checkins, sessionIndex) {
  if (!checkins || typeof checkins !== 'object') return false;
  let lastAsked = -1;
  for (const key of Object.keys(checkins)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > sessionIndex) continue;
    if (idx > lastAsked) lastAsked = idx;
  }
  return lastAsked >= 0 && sessionIndex - lastAsked < CHECKIN_COOLDOWN_SESSIONS;
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
  notesLoading,
  notesError,
  otherModalOwnsScreen,
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
  workoutNoteTextRef.current = workoutNoteText;
  workoutNoteTitleRef.current = workoutNoteTitle;
  currentIdRef.current = currentId;
  currentNoteRef.current = currentNote;

  // Check-in gates, held in a ref for the same reason as the values above:
  // detection runs after an awaited save, so it must read the gates as they are
  // at the moment of raise, not as they were when the handler was created.
  const checkInGatesRef = useRef(null);
  checkInGatesRef.current = { fatigueTrackingEnabled, notesLoading, notesError, otherModalOwnsScreen };

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

  // A check-in prompt is raised at exactly one moment — Done, after a verified
  // save — so leaving the Log tab no longer runs detection. Blur is an
  // interruption, not a completion, and it was the only path that could ask
  // about text the store had not accepted yet.

  // Whether the check-in is currently blocked from being on screen at all:
  // the feature is off, the read is not verified, another modal owns the
  // screen, or this is a deload note. Deload mode itself is a separate editor
  // this hook deliberately cannot see, so the note prefix is the only deload
  // fact available here — and the only one needed.
  const checkInBlocked =
    !fatigueTrackingEnabled
    || !!notesLoading
    || !!notesError
    || !!otherModalOwnsScreen
    || !!currentNote?.title?.startsWith(DELOAD_NOTE_PREFIX);

  // Withdrawal (D10 §3.3): one state transition, never a visibility change and
  // never a write. Clearing every field is what stops the sheet from
  // resurrecting itself when the toggle comes back on or the other modal
  // closes — the only way back to a prompt is fresh detection at a later Done.
  // Nothing is stored, so the session stays eligible.
  const withdrawCheckIn = () => {
    setShowCheckInModal(false);
    setRoughCheckInData(null);
    setRoughSessionIndex(null);
    setRoughNoteId(null);
    setRoughFlaggedNames(prev => (prev.size === 0 ? prev : new Set()));
  };

  useEffect(() => {
    if (!checkInBlocked) return;
    if (!showCheckInModal && roughCheckInData == null && roughSessionIndex == null
      && roughNoteId == null && roughFlaggedNames.size === 0) return;
    withdrawCheckIn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkInBlocked, showCheckInModal, roughCheckInData, roughSessionIndex, roughNoteId, roughFlaggedNames]);

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

  // Note-level parser rejection (e.g. an oversize note that `parseWorkoutNote`
  // refuses with `ok: false`). Surfaced as a sibling to `dayGroups` so the read
  // view can show a parse-failure affordance instead of a blank empty state; no
  // synthetic section is invented. Checks both the full-note parse and the
  // active-week slice so an A/B note that fails on either side is not silent.
  const noteError = useMemo(
    () => (!parsed.ok && parsed.error) || (!activeWeekParsed.ok && activeWeekParsed.error) || null,
    [parsed, activeWeekParsed]
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
      // Ordinary-analytics boundary (#699). Exercise classifications are a
      // cross-note aggregate cached onto the saved note, and Home reads the
      // stored value back (computeWeeklySummary -> sessionStatusRows). They must
      // therefore be derived from the SAME recovery-filtered population Home and
      // Analytics derive at render time, or an excluded recovery week would leak
      // back into Home through this cache.
      //
      // Read from storage here rather than from a render-time snapshot: autosave
      // timers and async callbacks can fire long after the render that scheduled
      // them, and a background sync can land new memberships in that window. The
      // Week 2+ lifecycle cores make the same choice for the same reason.
      //
      // A failed read means the boundary is UNKNOWN. The note's text still
      // saves — losing the user's writing over an analytics read would be far
      // worse — but no classification value is written at all, leaving the
      // previously stored one untouched rather than replacing it with an
      // aggregate that might include excluded recovery work. The next successful
      // save repairs it.
      let excludedNoteIds = null;
      let recoveryBoundaryKnown = true;
      try {
        excludedNoteIds = await loadRecoveryExcludedNoteIds();
      } catch {
        recoveryBoundaryKnown = false;
      }

      let classificationsPatch = {};
      if (recoveryBoundaryKnown) {
        // A brand-new note (no currentId) has no id yet, so it cannot hold a
        // recovery membership and its own sections are always in scope.
        const allSections = [
          ...notes.flatMap(n => {
            if (n.id && excludedNoteIds.has(n.id)) return [];
            const text = n.id === currentId ? textToSave : n.raw_text;
            return text ? parseWorkoutNote(text).sections : [];
          }),
          ...(currentId ? [] : savedSections),
        ];
        const { classifications } = deriveWorkoutNoteAnalytics(allSections, trackedNames);
        classificationsPatch = { exercise_classifications: classifications };
      }
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
          ...classificationsPatch,
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
            ...classificationsPatch,
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

  // Raises the fatigue check-in, from the single trigger site: Done, after
  // handleSave has returned true. Precedence is evaluated top-down and the
  // first matching rule decides.
  const _runCheckInDetection = () => {
    const gates = checkInGatesRef.current;
    // Rows 1, 2, 4 and 6 — feature off, unverified read, deload note, or
    // another modal owning the screen. Evaluated here, synchronously, at the
    // moment a prompt would be raised. Nothing is written and nothing is
    // stored, so the session stays eligible at a later Done.
    if (!gates.fatigueTrackingEnabled
      || gates.notesLoading
      || gates.notesError
      || gates.otherModalOwnsScreen
      || currentNoteRef.current?.title?.startsWith(DELOAD_NOTE_PREFIX)) {
      withdrawCheckIn();
      return;
    }
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
    // Row 9 — no trigger fired. Row 7 — this session already has a record
    // (answered or dismissed), which suppresses it permanently.
    if (!isRough || sessionIndex == null || checkins?.[sessionIndex]) {
      setRoughFlaggedNames(new Set());
      setRoughSessionIndex(null);
      setRoughNoteId(null);
      return;
    }
    // Row 8 — cooldown. Only the interruption is withheld: the exercises are
    // still marked inline and the session is still reachable from Analytics.
    if (_checkInCooldownActive(checkins, sessionIndex)) {
      setRoughFlaggedNames(new Set(flagged.map(f => f.normName)));
      setRoughSessionIndex(sessionIndex);
      setRoughNoteId(latestId);
      return;
    }
    // Row 10 — ask.
    setRoughFlaggedNames(new Set(flagged.map(f => f.normName)));
    setRoughSessionIndex(sessionIndex);
    setRoughNoteId(latestId);
    setRoughCheckInData({ sessionIndex, detectors, flagged, metrics });
    setShowCheckInModal(true);
    onCheckInPrompt?.();
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
    // 'Skip week' is the user declaring what happened. Explicit intent outranks
    // inference, so the press is a suppression event, not a detection event:
    // the only feedback is this status line. (Previously the skip it had just
    // written was read back as a whole-day absence and answered with a prompt.)
    setSkipWeekStatus('Skip applied');
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
    withdrawCheckIn,
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
    noteError,
    parsed,
    logSessionCount,
  };
}
