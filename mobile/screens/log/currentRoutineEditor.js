import { useState, useEffect } from 'react';
import { Keyboard, Platform } from 'react-native';
import { parseWorkoutNote, resolveExerciseSourceAnchor } from '../../lib/parser';
import { removeWeekSkipFromText, applyProgressionSuggestionToNoteText } from '../../lib/parser/workoutNote.js';
import { computeWeeksIn } from '../../lib/data';
import { Alert } from '../../lib/platformAlert';
import { restoreWorkoutNoteDraft } from './editorDrafts';
import { spliceWeekText } from './editorWeekText';
import { runDoneConvergenceLoop } from './useLogEditorSave';

// Current-routine editor open/exit/restore and exercise source-jump lifecycle,
// extracted from useLogCurrentRoutineEditor (#1055). Provided as a factory hook
// so its own pendingSourceJump state lives with it; every other piece of editor
// state (refs, setters, live values) is supplied by the calling hook through
// `ctx`, so no module-level editor state is held. The hook keeps the
// source-pinned `enterCurrentEditor` wrapper and calls openCurrentEditor here.

function currentDraftKey(currentId) {
  return currentId ? `current:${currentId}` : 'current:new';
}

// #886: how far below the top of the editor viewport a source-jumped exercise
// header is parked — enough that it does not sit flush against the edge, and no
// more (#888 reduced this from 96, a whole exercise block, after device
// verification showed the jump landing about one exercise high: measurement
// error grows with source depth, so the correction had to be a constant).
const SOURCE_JUMP_TOP_GAP = 24;

export function useCurrentEditorLifecycle(ctx) {
  const {
    // live values (fresh each render)
    workoutNoteTitle,
    workoutNoteText,
    currentId,
    mode,
    hasABWeeks,
    effectiveActiveWeek,
    activeEditText,
    // refs
    readScrollRef,
    editorScrollRef,
    readScrollYRef,
    keyboardVisibleRef,
    keyboardExitTimeoutRef,
    autosaveTimerRef,
    modeRef,
    currentIdRef,
    currentNoteRef,
    workoutNoteTitleRef,
    workoutNoteTextRef,
    draftBaseUpdatedAtRef,
    preserveExistingDraftRef,
    draftRestorePendingRef,
    draftRestoreTokenRef,
    // setters
    setMode,
    setOriginalNoteState,
    setWorkoutNoteTitle,
    setWorkoutNoteText,
  } = ctx;

  const [pendingSourceJump, setPendingSourceJump] = useState(null);

  const handleReadScroll = (e) => {
    readScrollYRef.current = e.nativeEvent.contentOffset.y;
  };

  // Track keyboard visibility so exitCurrentEditor can wait out the dismissal,
  // and clear the autosave timer on unmount.
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
  }, [keyboardVisibleRef, keyboardExitTimeoutRef]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [autosaveTimerRef]);

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

  // Restores a cheap local draft into the live editor on opening the editor
  // (covers foreground/restart). #880 reversal: a mismatched-revision draft is
  // NEVER auto-applied over newer canonical text AND NEVER deleted here; it
  // stays recoverable until an explicit discard/revert or a later save.
  const restoreCurrentDraftIfSafe = ({
    expectedId,
    canonicalUpdatedAt,
    expectedTitle,
    expectedText,
    restoreToken,
  }) => restoreWorkoutNoteDraft({
    key: currentDraftKey(expectedId),
    canonicalUpdatedAt,
    restoreToken,
    tokenRef: draftRestoreTokenRef,
    pendingRef: draftRestorePendingRef,
    isStillCurrent: () => currentIdRef.current === expectedId
      && modeRef.current === 'edit'
      && (currentNoteRef.current?.updated_at ?? null) === canonicalUpdatedAt,
    expectedTitle,
    expectedText,
    readLiveTitle: () => workoutNoteTitleRef.current,
    readLiveText: () => workoutNoteTextRef.current,
    applyTitle: setWorkoutNoteTitle,
    applyText: setWorkoutNoteText,
  });

  // `restoreScroll` (#886): the ordinary Edit button carries the read view's
  // vertical offset into the editor (#150), preserving reading position. A
  // source jump must NOT — see handleExerciseSourceJump.
  const openCurrentEditor = ({ restoreDraft, restoreScroll = true }) => {
    const scrollY = readScrollYRef.current;
    const expectedId = currentIdRef.current;
    const canonicalUpdatedAt = currentNoteRef.current?.updated_at ?? null;
    const expectedTitle = workoutNoteTitleRef.current;
    const expectedText = workoutNoteTextRef.current;
    draftBaseUpdatedAtRef.current = canonicalUpdatedAt;
    preserveExistingDraftRef.current = !restoreDraft;
    draftRestorePendingRef.current = restoreDraft;
    const restoreToken = draftRestoreTokenRef.current + 1;
    draftRestoreTokenRef.current = restoreToken;
    setOriginalNoteState({
      title: workoutNoteTitle,
      text: workoutNoteText,
      activeWeek: effectiveActiveWeek,
    });
    modeRef.current = 'edit';
    setMode('edit');
    requestAnimationFrame(() => {
      // #886: a source jump parks the editor at the top instead of inheriting
      // the read view's offset. The editor scroll view is never unmounted (only
      // display:none), so without this a repeat jump would open on whatever
      // offset the previous editor session ended at.
      editorScrollRef.current?.scrollTo({ y: restoreScroll ? scrollY : 0, animated: false });
    });
    if (restoreDraft) {
      restoreCurrentDraftIfSafe({
        expectedId,
        canonicalUpdatedAt,
        expectedTitle,
        expectedText,
        restoreToken,
      });
    }
  };

  // #886: called by the editor surface once it has actually applied the jump.
  // placement.y is the target line's own offset inside the EDITOR's scroll
  // content. When the surface could not measure itself, keep the deterministic
  // top-of-note landing openCurrentEditor already applied.
  const clearPendingSourceJump = (placement) => {
    setPendingSourceJump(null);
    if (!placement || !Number.isFinite(placement.y)) return;
    editorScrollRef.current?.scrollTo({
      y: Math.max(0, placement.y - SOURCE_JUMP_TOP_GAP),
      animated: false,
    });
  };

  // #881 (F10a §2/§6): resolves a double-tapped exercise's source anchor against
  // the CURRENT live text for the week it was built against and — only on
  // success — opens the editor with a one-shot collapsed-caret request. A
  // discarded/stale anchor is a strict no-op.
  const handleExerciseSourceJump = (anchor) => {
    if (!anchor || anchor.noteId !== currentId) return;
    const weekIndex = hasABWeeks && effectiveActiveWeek === 'B' ? 1 : 0;
    // The renderer only ever builds an anchor against the week it is currently
    // rendering, so a mismatch means the anchor is from a week that is no longer
    // active — discard rather than guess.
    if (anchor.weekIndex !== weekIndex) return;
    const range = resolveExerciseSourceAnchor(anchor, { noteId: currentId, weekIndex, sliceText: activeEditText });
    if (!range) return;
    // #886: restoreScroll:false — a source jump is not a "resume reading" entry.
    // The real landing is applied by clearPendingSourceJump from the editor's
    // own measurement of the target line.
    if (mode !== 'edit') openCurrentEditor({ restoreDraft: false, restoreScroll: false });
    setPendingSourceJump({
      start: range.end,
      end: range.end,
      editingNoteId: null,
      currentMode: 'edit',
      expectedText: activeEditText,
      source: null,
      token: `${Date.now()}-${Math.random()}`,
    });
  };

  return {
    handleReadScroll,
    finishExitCurrentEditor,
    exitCurrentEditor,
    openCurrentEditor,
    restoreCurrentDraftIfSafe,
    pendingSourceJump,
    clearPendingSourceJump,
    handleExerciseSourceJump,
  };
}

// #863: Done saves (converging on any content typed past an in-flight autosave),
// then — as the SOLE release gate (#577) — recomputes and releases the pending
// PR-moment candidate and runs fatigue check-in detection, and exits. Never
// fires from autosave, revert, a failed save, or exiting without Done.
export async function handleDoneCurrent(ctx) {
  const {
    currentId,
    hasUnsavedCurrent,
    handleSave,
    exitCurrentEditor,
    autosaveTimerRef,
    workoutNoteTextRef,
    workoutNoteTitleRef,
    lastSavedTextRef,
    lastSavedTitleRef,
    computePendingPRCandidate,
    pendingPRRef,
    setPrMoment,
    consumedPRKeysRef,
    runCheckInDetection,
  } = ctx;
  if (autosaveTimerRef.current) {
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
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
    const converged = await runDoneConvergenceLoop({
      save: () => handleSave(),
      hasConverged: () =>
        workoutNoteTextRef.current === lastSavedTextRef.current
        && workoutNoteTitleRef.current === lastSavedTitleRef.current,
    });
    if (!converged) return;
  }
  await computePendingPRCandidate();
  if (pendingPRRef.current) {
    setPrMoment(pendingPRRef.current);
    consumedPRKeysRef.current.add(pendingPRRef.current.exerciseKey);
    pendingPRRef.current = null;
  }
  runCheckInDetection();
  exitCurrentEditor();
}

// Performs the actual removal for handleUnskipWeek once any confirmation has
// resolved. nextUniversalSkipCount is the counter value to persist alongside the
// removal (count-1 on a universal undo, 0 on a confirmed manual removal). Text,
// counter, and check-in cleanup are persisted in one update via handleSave so a
// partial write can never desync them.
export async function performUnskipRemoval(ctx, newActiveText, nextUniversalSkipCount) {
  const {
    workoutNoteText,
    effectiveActiveWeek,
    handleSave,
    setWorkoutNoteText,
    workoutNoteTextRef,
    setSkipWeekStatus,
    saveInFlightRef,
    currentNoteRef,
  } = ctx;
  if (saveInFlightRef.current) {
    setSkipWeekStatus('Finishing the previous save — try again');
    return;
  }
  // The session being removed is the note's current deepest session column (the
  // one the just-removed trailing skip belonged to), computed from the full note
  // text before the removal — this matches the sessionIndex _runCheckInDetection
  // used when it recorded a fatigue-reason check-in for that skip.
  const removedSessionIndex = computeWeeksIn(parseWorkoutNote(workoutNoteText).sections) - 1;

  // Drop the fatigue-reason check-in recorded for the removed session (if any),
  // and re-key any remaining check-ins whose session index shifted down by one.
  // Computed up front so it rides in the same update as raw_text.
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
  const newFullText = spliceWeekText(workoutNoteText, effectiveActiveWeek, newActiveText);
  setWorkoutNoteText(newFullText);
  workoutNoteTextRef.current = newFullText;
  const saved = await handleSave({
    overrideText: newFullText,
    universalSkipCount: nextUniversalSkipCount,
    sessionCheckins,
  });
  if (!saved) {
    // Revert the optimistic local text: nothing persisted (text, counter, and
    // check-in cleanup travel in one update), so local state must return to
    // match — otherwise a retry would find no trailing skip and the stale-clamp
    // path would desync the counter from the stored text.
    setWorkoutNoteText(prevFullText);
    workoutNoteTextRef.current = prevFullText;
    setSkipWeekStatus('Could not remove skip — try again');
    return;
  }
  // Removing a skip is not new logged work, so it does not run fatigue check-in
  // detection — only a successful 'Skip week' save does.
  setSkipWeekStatus('Skip removed');
}

export async function handleUnskipWeek(ctx) {
  const {
    currentId,
    activeEditText,
    activeWeekParsed,
    saveInFlightRef,
    setSkipWeekStatus,
    universalSkipCountRef,
    currentNoteRef,
    update,
  } = ctx;
  if (!currentId) return;
  if (saveInFlightRef.current) {
    setSkipWeekStatus('Finishing the previous save — try again');
    return;
  }
  const newActiveText = removeWeekSkipFromText(activeEditText, activeWeekParsed.sections);
  const count = universalSkipCountRef.current;
  if (newActiveText === activeEditText) {
    // Nothing to undo: no exercise currently ends in a skip marker. The
    // text-driven no-op rule always wins; if the advisory counter says otherwise
    // it is stale (hand-edited text), so clamp it to reality.
    setSkipWeekStatus('No skip to remove');
    if (count > 0) {
      const prevMarkers = currentNoteRef.current?.skip_markers;
      try {
        const clamped = await update(currentId, {
          skip_markers: { ...(prevMarkers || {}), universal_skip_count: 0 },
        });
        // Commit the ref only after the clamp actually persisted. On a falsy
        // result or a rejection the ref keeps the stale value, so the next press
        // retries the clamp instead of becoming a pure no-op.
        if (clamped) universalSkipCountRef.current = 0;
      } catch {
        // Advisory-only flag: a failed clamp write just leaves it stale (and
        // retryable); the text-driven rules still decide what can be removed.
      }
    }
    return;
  }

  if (count > 0) {
    // The trailing skips include at least one Skip-week press: undo one.
    await performUnskipRemoval(ctx, newActiveText, count - 1);
    return;
  }

  // Counter says no outstanding Skip-week press, but trailing skips exist: they
  // were added manually (per-exercise dashes). Confirm before deleting the
  // user's hand-entered history.
  Alert.alert(
    'Remove skips?',
    "These skips weren't added by Skip week. Remove them anyway?",
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => performUnskipRemoval(ctx, newActiveText, 0),
      },
    ]
  );
}

// #961: the explicit "Apply to note" action from a progression-suggestion card.
// applyProgressionSuggestionToNoteText only ever inserts new lines and never
// rewrites or deletes one; a non-applicable/stale/duplicate suggestion returns
// the text byte-identical and this persists nothing. Mirrors handleSkipWeek:
// operates on the active A/B half, splices it back, and commits via handleSave.
export async function applyProgressionSuggestion(ctx, suggestion) {
  const {
    currentId,
    activeEditText,
    workoutNoteText,
    effectiveActiveWeek,
    handleSave,
    setWorkoutNoteText,
    workoutNoteTextRef,
    saveInFlightRef,
  } = ctx;
  if (!currentId) return { applied: false, reason: 'no-current-note' };
  if (saveInFlightRef.current) {
    return { applied: false, reason: 'save-in-flight' };
  }

  const result = applyProgressionSuggestionToNoteText(activeEditText, suggestion);
  if (!result.applied || result.text === activeEditText) {
    return { applied: false, reason: result.reason || 'no-change' };
  }

  const prevFullText = workoutNoteText;
  const newFullText = spliceWeekText(workoutNoteText, effectiveActiveWeek, result.text);
  setWorkoutNoteText(newFullText);
  workoutNoteTextRef.current = newFullText;
  const saved = await handleSave({ overrideText: newFullText });
  if (!saved) {
    setWorkoutNoteText(prevFullText);
    workoutNoteTextRef.current = prevFullText;
    return { applied: false, reason: 'save-failed' };
  }
  return { applied: true, reason: result.reason };
}

// Double-tap on the read-mode note body opens the editor.
export function makeHandleNoteBodyPress({ lastTapRef, enterCurrentEditor }) {
  return () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      enterCurrentEditor();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };
}
