import { useState, useEffect, useRef, useMemo } from 'react';
import { Alert } from '../../lib/platformAlert';
import { parseWorkoutNote, countWorkoutSessionsFromSections, applyWeekSkipToText } from '../../lib/parser';
import { AUTOSAVE_DEBOUNCE_MS } from '../../lib/LogScreenHelpers';
import { useNoteConvergencePending, deriveCurrentSaveStatus } from './editorConvergence';
import {
  isValidActiveWeek,
  spliceWeekText,
  useCurrentWeekProjection,
  useActiveWeekReconcile,
  toggleActiveWeek,
} from './editorWeekText';
import {
  writeWorkoutNoteDraftNow,
  cancelPendingDraftRestore as cancelDraftRestore,
  useRestoreCreationAttemptToken,
  useEditorDraftPersistence,
  useDraftNoteIdOverrideReset,
} from './editorDrafts';
import { useCurrentCheckIn } from './currentRoutineCheckIn';
import {
  useCurrentEditorLifecycle,
  handleDoneCurrent as doneCurrent,
  handleUnskipWeek as unskipWeek,
  applyProgressionSuggestion as applyProgression,
  makeHandleNoteBodyPress,
} from './currentRoutineEditor';
import { useSaveSuccessAutoClear } from './useLogEditorSave';
import {
  computePendingPRCandidate as computePRCandidate,
  performRevertCurrent as performRevert,
  performCurrentSave,
  persistedUniversalSkipCount,
  useUniversalSkipSeed,
} from './currentRoutineSave';

function currentDraftKey(currentId) {
  return currentId ? `current:${currentId}` : 'current:new';
}

// The one caller context this editor creates notes in (#997). A create here is
// always the current-routine editor's brand-new note — no currentId yet — so
// one durable slot covers it, and the attempt token in that slot outlives an
// app restart. Distinct from `currentDraftKey`'s 'current:new' draft key: this
// store holds create-attempt protocol state, not text.
const CURRENT_CREATE_ATTEMPT_KEY = 'current:new';

// useNoteConvergencePending/snapshotMatches/deriveSaveStatus live in
// ./editorConvergence; isValidActiveWeek and the A/B week text helpers in
// ./editorWeekText; isDeloadTitle, the save-time classification pass, the
// PR-moment candidate, check-in detection, and the revert body in
// ./currentRoutineSave (#1055).

export function useLogCurrentRoutineEditor({
  workoutNoteText,
  setWorkoutNoteText,
  workoutNoteTitle,
  setWorkoutNoteTitle,
  currentId,
  currentNote,
  notes,
  trackedLifts,
  trackedLiftActivations,
  reconcileTrackedLiftActivations,
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
  // #880 revised body: pending-cloud-convergence, derived from the sync
  // queue/recovery state — never a network check. `null` while the note is
  // brand-new (no id, nothing could be enqueued for it yet).
  const pendingConvergence = useNoteConvergencePending(currentId || null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [originalNoteState, setOriginalNoteState] = useState(null);
  // #577 (Contract 3): the RELEASED PR-moment banner state — set only from
  // handleDoneCurrent's successful exit, never from autosave. pendingPRRef
  // holds the latest COMPUTED-but-not-yet-released candidate (refreshed on
  // every successful save, autosave included); consumedPRKeysRef tracks
  // exercise keys already celebrated for the CURRENT editor baseline so a
  // repeated Done cannot re-celebrate the same candidate. Both reset
  // whenever a new editor baseline begins (originalNoteState changes) —
  // see the effect below.
  const [prMoment, setPrMoment] = useState(null);
  const pendingPRRef = useRef(null);
  const consumedPRKeysRef = useRef(new Set());
  useEffect(() => {
    pendingPRRef.current = null;
    consumedPRKeysRef.current = new Set();
  }, [originalNoteState]);
  const [skipWeekStatus, setSkipWeekStatus] = useState('');

  const keyboardVisibleRef = useRef(false);
  const lastTapRef = useRef(0);
  const keyboardExitTimeoutRef = useRef(null);
  const readScrollYRef = useRef(0);
  const autosaveCurrentTimerRef = useRef(null);
  const saveCurrentInFlightRef = useRef(null);
  const savingCurrentSnapshotRef = useRef(null);
  const lastSavedCurrentIdRef = useRef(null);
  const lastSavedCurrentTextRef = useRef(null);
  const lastSavedCurrentTitleRef = useRef(null);
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

  // Cheap local draft (#880), independent of the expensive autosave timer
  // above.
  const draftCurrentTimerRef = useRef(null);
  const draftBaseUpdatedAtRef = useRef(currentNote?.updated_at ?? null);
  const draftNoteIdOverrideRef = useRef(null);
  const preserveExistingDraftRef = useRef(false);
  const lastDraftWriteSignatureRef = useRef(null);
  const draftRestoreTokenRef = useRef(0);
  const draftRestorePendingRef = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Durable creation-attempt token for this editor's new-note create (#997).
  // Minted before the create, RETAINED when the create fails, restored on mount
  // so a retry after an app restart still completes the original note, and
  // cleared only once the create has fully succeeded. See editorDrafts for the
  // shared restore-on-mount effect.
  const createAttemptTokenRef = useRef(null);
  useRestoreCreationAttemptToken(CURRENT_CREATE_ATTEMPT_KEY, createAttemptTokenRef);

  const writeCurrentDraftNow = () => writeWorkoutNoteDraftNow({
    key: currentDraftKey(draftNoteIdOverrideRef.current ?? currentIdRef.current),
    title: workoutNoteTitleRef.current,
    raw_text: workoutNoteTextRef.current,
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

  // Fatigue check-in state, effects, and detection trigger (see
  // ./currentRoutineCheckIn). A check-in prompt is raised at exactly one moment:
  // Done, after a verified save — leaving the Log tab no longer runs detection.
  const {
    roughFlaggedNames,
    roughSessionIndex,
    roughNoteId,
    showCheckInModal,
    setShowCheckInModal,
    roughCheckInData,
    withdrawCheckIn,
    runCheckInDetection: _runCheckInDetection,
  } = useCurrentCheckIn({
    currentId,
    currentNote,
    fatigueTrackingEnabled,
    notesLoading,
    notesError,
    otherModalOwnsScreen,
    workoutNoteTitle,
    trackedLifts,
    onCheckInPrompt,
    workoutNoteTitleRef,
    workoutNoteTextRef,
    currentIdRef,
    currentNoteRef,
  });

  const noteIdentity = currentNote?.id ?? currentId ?? null;
  const [localActiveWeek, setLocalActiveWeek] = useState(
    () => (isValidActiveWeek(currentNote?.activeWeek) ? currentNote.activeWeek : null)
  );
  const previousNoteIdentityRef = useRef(noteIdentity);

  useDraftNoteIdOverrideReset(draftNoteIdOverrideRef, currentId);

  // Universal-skip counter (advisory; persisted in skip_markers): local
  // authority after any in-session mutation, re-seeded from the persisted note
  // on identity change. See ./currentRoutineSave.
  const universalSkipCountRef = useRef(persistedUniversalSkipCount(currentNote));
  useUniversalSkipSeed({ universalSkipCountRef, currentNoteRef, noteIdentity });

  useSaveSuccessAutoClear(saveSuccess, setSaveSuccess);

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

  useActiveWeekReconcile({
    hasABWeeks,
    noteIdentity,
    persistedActiveWeekValue: currentNote?.activeWeek,
    previousNoteIdentityRef,
    pendingActiveWeekRef,
    activeWeekAuthorityRef,
    setLocalActiveWeek,
  });

  const {
    activeEditText,
    activeWeekParsed,
    sessionAlignmentIssue,
    dayGroups,
    noteError,
    canUnskipWeek,
  } = useCurrentWeekProjection({
    fullText: workoutNoteText,
    parsed,
    hasABWeeks,
    effectiveWeek: effectiveActiveWeek,
    currentId,
  });

  const hasUnsavedCurrent = useMemo(() => {
    if (!currentNote) return workoutNoteTitle.trim() !== '' || workoutNoteText.trim() !== '';
    return workoutNoteTitle !== (currentNote.title || '') || workoutNoteText !== currentNote.raw_text;
  }, [currentNote, workoutNoteTitle, workoutNoteText]);
  const hasUnsavedCurrentRef = useRef(hasUnsavedCurrent);
  hasUnsavedCurrentRef.current = hasUnsavedCurrent;

  // Debounced autosave for the current (existing) note while in edit mode.
  // New notes (no currentId) require an explicit first save to get an ID.
  useEffect(() => {
    if (mode !== 'edit' || !currentId || !hasUnsavedCurrent) return;
    if (autosaveCurrentTimerRef.current) clearTimeout(autosaveCurrentTimerRef.current);
    autosaveCurrentTimerRef.current = setTimeout(async () => {
      autosaveCurrentTimerRef.current = null;
      await handleSave({ autosave: true });
      // #577: autosave COMPUTES the pending PR candidate but never displays
      // it — only handleDoneCurrent releases it to the UI.
      await computePendingPRCandidate();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveCurrentTimerRef.current) {
        clearTimeout(autosaveCurrentTimerRef.current);
        autosaveCurrentTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workoutNoteText, workoutNoteTitle, mode, currentId]);

  // Cheap draft persistence (#880): a debounced write whenever the editor is
  // open (including a brand-new note, the gap the debounced autosave above
  // deliberately does not cover) plus an immediate flush on backgrounding. See
  // useEditorDraftPersistence in ./editorDrafts.
  useEditorDraftPersistence({
    enabled: mode === 'edit' && hasUnsavedCurrent,
    debounceDeps: [workoutNoteText, workoutNoteTitle, mode, currentId, hasUnsavedCurrent],
    timerRef: draftCurrentTimerRef,
    writeDraftNow: writeCurrentDraftNow,
    isFlushEligible: () => modeRef.current === 'edit' && hasUnsavedCurrentRef.current,
  });

  const handleCurrentTextChange = (newText) => {
    cancelPendingDraftRestore();
    if (!hasABWeeks || !currentId) {
      setWorkoutNoteText(newText);
      return;
    }
    setWorkoutNoteText(spliceWeekText(workoutNoteText, effectiveActiveWeek, newText));
  };

  const handleToggleWeek = () => toggleActiveWeek({
    currentId,
    hasABWeeks,
    effectiveWeek: effectiveActiveWeek,
    update,
    pendingActiveWeekRef,
    activeWeekAuthorityRef,
    setLocalActiveWeek,
  });

  // #577 (Contract 3): recompute the pending (not-yet-released) PR-moment
  // candidate against the SAME aggregate, recovery-filtered/deload-excluded
  // population Analytics uses. Called after every successful save (autosave
  // included) so the candidate always reflects the exact snapshot that was
  // actually persisted — never a later render value — but it is stored in a
  // ref, not surfaced as UI, until handleDoneCurrent explicitly releases it.
  //
  // Reads the recovery-exclusion boundary FRESH from storage on every call
  // (loadRecoveryExcludedNoteIds, not a possibly-stale hook snapshot) so a
  // Done release always revalidates against current state rather than
  // trusting a computation from minutes earlier. Any failure here (a
  // storage read, a malformed note elsewhere) is swallowed — PR-moment
  // detection must never block or corrupt the actual save flow.
  const computePendingPRCandidate = async () => {
    pendingPRRef.current = await computePRCandidate({
      currentId, originalNoteState, effectiveActiveWeek, hasABWeeks, notes,
      trackedLifts, trackedLiftActivations,
      lastSavedTitle: lastSavedCurrentTitleRef.current, liveTitle: workoutNoteTitleRef.current,
      lastSavedText: lastSavedCurrentTextRef.current, liveText: workoutNoteTextRef.current,
      consumedPRKeys: consumedPRKeysRef.current,
    });
  };

  // opts.universalSkipCount / opts.sessionCheckins (skip/unskip paths) ride in
  // the SAME update as raw_text so text, counter, and check-in cleanup stay
  // atomic. See performCurrentSave in ./currentRoutineSave.
  const handleSave = (opts = {}) => performCurrentSave({
    workoutNoteText, workoutNoteTitle, currentId, notes, trackedLifts,
    trackedLiftActivations, reconcileTrackedLiftActivations, activeWeekPatch,
    update, add, selectCurrent, createAttemptKey: CURRENT_CREATE_ATTEMPT_KEY,
    saveInFlightRef: saveCurrentInFlightRef, savingSnapshotRef: savingCurrentSnapshotRef,
    universalSkipCountRef, currentIdRef, workoutNoteTextRef, workoutNoteTitleRef,
    lastSavedIdRef: lastSavedCurrentIdRef, lastSavedTextRef: lastSavedCurrentTextRef,
    lastSavedTitleRef: lastSavedCurrentTitleRef, draftBaseUpdatedAtRef,
    draftNoteIdOverrideRef, createAttemptTokenRef,
    setIsSaving, setSaveError, setSaveSuccess, setWorkoutNoteTitle, setWorkoutNoteText,
  }, opts);

  const {
    handleReadScroll,
    exitCurrentEditor,
    openCurrentEditor,
    restoreCurrentDraftIfSafe,
    pendingSourceJump,
    clearPendingSourceJump,
    handleExerciseSourceJump,
  } = useCurrentEditorLifecycle({
    workoutNoteTitle, workoutNoteText, currentId, mode, hasABWeeks,
    effectiveActiveWeek, activeEditText,
    readScrollRef, editorScrollRef, readScrollYRef, keyboardVisibleRef,
    keyboardExitTimeoutRef, autosaveTimerRef: autosaveCurrentTimerRef, modeRef,
    currentIdRef, currentNoteRef, workoutNoteTitleRef, workoutNoteTextRef,
    draftBaseUpdatedAtRef, preserveExistingDraftRef, draftRestorePendingRef,
    draftRestoreTokenRef,
    setMode, setOriginalNoteState, setWorkoutNoteTitle, setWorkoutNoteText,
  });

  const enterCurrentEditor = () => openCurrentEditor({ restoreDraft: true });

  // #863: session alignment is a purely inline, ignorable signal now — the
  // note is already autosaved by the time Done is pressed, so "Keep
  // editing" and "Save uneven" ended with identical bytes on disk anyway.
  // No dialog on this path any more; alignment problems are surfaced by
  // LogScreenEditorCard's on-demand problem list instead.
  const handleDoneCurrent = () => doneCurrent({
    currentId,
    hasUnsavedCurrent,
    handleSave,
    exitCurrentEditor,
    autosaveTimerRef: autosaveCurrentTimerRef,
    workoutNoteTextRef,
    workoutNoteTitleRef,
    lastSavedTextRef: lastSavedCurrentTextRef,
    lastSavedTitleRef: lastSavedCurrentTitleRef,
    computePendingPRCandidate,
    pendingPRRef,
    setPrMoment,
    consumedPRKeysRef,
    runCheckInDetection: _runCheckInDetection,
  });

  const clearPRMoment = () => setPrMoment(null);

  const performRevertCurrent = () => performRevert({
    currentId,
    originalNoteState,
    update,
    autosaveTimerRef: autosaveCurrentTimerRef,
    saveInFlightRef: saveCurrentInFlightRef,
    createAttemptTokenRef,
    createAttemptKey: CURRENT_CREATE_ATTEMPT_KEY,
    pendingActiveWeekRef,
    activeWeekAuthorityRef,
    setWorkoutNoteTitle,
    setWorkoutNoteText,
    setLocalActiveWeek,
    setSaveError,
  });

  const handleUndoCurrent = () => {
    const isDraft = !currentId;
    Alert.alert(
      isDraft ? 'Clear this draft?' : 'Revert this edit?',
      isDraft
        ? 'This clears everything entered in this unsaved routine.'
        : 'This restores the routine to how it was when you opened the editor, including changes already autosaved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: isDraft ? 'Clear draft' : 'Revert this edit',
          style: 'destructive',
          onPress: performRevertCurrent,
        },
      ]
    );
  };

  // Splices a transformed active-week body back into the full note text,
  // preserving the other A/B week's body untouched. Shared by handleSkipWeek
  // and handleUnskipWeek so both stay consistent with the existing A/B
  // active-week slicing in activeEditText/handleCurrentTextChange.
  const _spliceActiveText = (newActiveText) =>
    spliceWeekText(workoutNoteText, effectiveActiveWeek, newActiveText);

  const handleSkipWeek = async () => {
    if (!currentId) return;
    if (saveCurrentInFlightRef.current) {
      setSkipWeekStatus('Finishing the previous save — try again');
      return;
    }
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

  const handleUnskipWeek = () => unskipWeek({
    currentId,
    activeEditText,
    activeWeekParsed,
    workoutNoteText,
    effectiveActiveWeek,
    handleSave,
    update,
    setWorkoutNoteText,
    workoutNoteTextRef,
    setSkipWeekStatus,
    saveInFlightRef: saveCurrentInFlightRef,
    universalSkipCountRef,
    currentNoteRef,
  });

  const handleApplyProgressionSuggestion = (suggestion) => applyProgression({
    currentId,
    activeEditText,
    workoutNoteText,
    effectiveActiveWeek,
    handleSave,
    setWorkoutNoteText,
    workoutNoteTextRef,
    saveInFlightRef: saveCurrentInFlightRef,
  }, suggestion);

  const handleNoteBodyPress = makeHandleNoteBodyPress({ lastTapRef, enterCurrentEditor });

  // #880 revised body, BLOCKER 1: `Saved` is a claim about one specific
  // {title, raw_text} snapshot and must stop being displayed the instant the
  // live editor no longer shows that exact snapshot — during the debounce
  // window, while an older write is still in flight, or on overlapping
  // writes. `lastSavedCurrentTextRef`/`TitleRef` already record exactly the
  // {title, raw_text} the most recent successful save actually persisted
  // (set only when that save resolves); comparing them against the LIVE
  // values on every render — not just at the moment the save resolved — is
  // what closes the gap where a completed save's "Saved on device" flash
  // would otherwise keep showing for up to its 2s timeout even after the
  // user typed something new.
  const { boundSaveSuccess, saveStatus } = deriveCurrentSaveStatus({
    currentId,
    draftNoteIdOverrideRef,
    isSaving,
    savingSnapshotRef: savingCurrentSnapshotRef,
    workoutNoteTitle,
    workoutNoteText,
    lastSavedIdRef: lastSavedCurrentIdRef,
    lastSavedTitleRef: lastSavedCurrentTitleRef,
    lastSavedTextRef: lastSavedCurrentTextRef,
    currentNote,
    pendingConvergence,
    saveSuccess,
  });

  return {
    mode,
    isSaving,
    saveError,
    setSaveError,
    saveSuccess: boundSaveSuccess,
    setSaveSuccess,
    pendingConvergence,
    saveStatus,
    cancelPendingDraftRestore,
    originalNoteState,
    prMoment,
    clearPRMoment,
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
    handleApplyProgressionSuggestion,
    canUnskipWeek,
    skipWeekStatus,
    handleNoteBodyPress,
    handleSave,
    enterCurrentEditor,
    pendingSourceJump,
    clearPendingSourceJump,
    handleExerciseSourceJump,
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
    sessionAlignmentIssue,
    parsed,
    logSessionCount,
  };
}
