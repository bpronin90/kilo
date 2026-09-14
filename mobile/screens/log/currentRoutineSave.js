import { useEffect } from 'react';
import { parseWorkoutNote } from '../../lib/parser';
import {
  normalizeLiftName,
  deriveWorkoutNoteAnalytics,
  listTrackedLifts,
  getDefaultTrackedNames,
  deriveSkipData,
  deriveSessionCheckIn,
} from '../../lib/data';
import { loadRecoveryExcludedNoteIds } from '../../hooks/entries/recoveryBlockHooks';
import { filterNotesForNormalAnalytics } from '../../lib/data/recoveryAnalyticsFilter';
import { deriveTrackedPROccurrences } from '../../lib/data/workoutAnalytics';
import { detectPRMoment } from '../../lib/prMoment';
import { loadDeloadHistory } from '../../storage/entries';
import { DELOAD_NOTE_PREFIX } from '../../lib/LogScreenHelpers';
import { Alert } from '../../lib/platformAlert';
import {
  clearWorkoutNoteDraft,
  markWorkoutNoteDraftSaveStart,
} from '../../storage/entries/workoutNoteDrafts';
import {
  ensureWorkoutNoteCreationAttempt,
  clearWorkoutNoteCreationAttempt,
} from '../../storage/entries/workoutNoteCreationAttempts';
import { isValidActiveWeek } from './editorWeekText';
import { reconcileDraftsAfterSave } from './useLogEditorSave';

function currentDraftKey(currentId) {
  return currentId ? `current:${currentId}` : 'current:new';
}

// Current-routine-editor save/Done-lifecycle bodies extracted from
// useLogCurrentRoutineEditor (#1055). Each function is pure/parameterized:
// identity, storage, live-value snapshots, and state setters arrive as explicit
// inputs, and no module-level editor state is held. The hook keeps the
// source-pinned call sites (handleSave shell, the skip-week save-gate) and
// delegates these bodies here.

export function isDeloadTitle(title) {
  return !!title?.startsWith(DELOAD_NOTE_PREFIX);
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
function checkInCooldownActive(checkins, sessionIndex) {
  if (!checkins || typeof checkins !== 'object') return false;
  let lastAsked = -1;
  for (const key of Object.keys(checkins)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > sessionIndex) continue;
    if (idx > lastAsked) lastAsked = idx;
  }
  return lastAsked >= 0 && sessionIndex - lastAsked < CHECKIN_COOLDOWN_SESSIONS;
}

// Ordinary-analytics save-time computation (#699/#893/#989). Exercise
// classifications are a cross-note aggregate cached onto the saved note, and
// Home reads the stored value back (computeWeeklySummary -> sessionStatusRows).
// They must therefore be derived from the SAME recovery-filtered population Home
// and Analytics derive at render time, or an excluded recovery week would leak
// back into Home through this cache.
//
// The recovery-exclusion boundary and deload history are read from storage here
// rather than from a render-time snapshot: autosave timers and async callbacks
// can fire long after the render that scheduled them, and a background sync can
// land new memberships in that window.
//
// A failed boundary read means the boundary is UNKNOWN. The note's text still
// saves — losing the user's writing over an analytics read would be far worse —
// but no classification value is written at all (an empty patch), leaving the
// previously stored one untouched rather than replacing it with an aggregate
// that might include excluded recovery work. The next successful save repairs it.
export async function computeSaveClassifications({
  textToSave,
  currentId,
  notes,
  trackedLifts,
  trackedLiftActivations,
  reconcileTrackedLiftActivations,
}) {
  const { sections: savedSections } = parseWorkoutNote(textToSave);
  const explicitTrackedNames = listTrackedLifts(trackedLifts);
  const defaultNames = getDefaultTrackedNames();
  const normalizedDefaults = new Set(defaultNames.map(n => normalizeLiftName(n)));
  const trackedNames = [
    ...defaultNames,
    ...explicitTrackedNames.filter(n => !normalizedDefaults.has(normalizeLiftName(n))),
  ];

  let excludedNoteIds = null;
  let recoveryBoundaryKnown = true;
  try {
    excludedNoteIds = await loadRecoveryExcludedNoteIds();
  } catch {
    recoveryBoundaryKnown = false;
  }

  // #989: feed the save-time analytics pass the same post-deload re-entry
  // inputs Analytics and Home use — the deload history and the stable
  // current-routine id. A failed read leaves it null: analytics still runs,
  // just without re-entry context, exactly as before this wiring existed.
  let deloadHistory = null;
  try {
    deloadHistory = await loadDeloadHistory();
  } catch {
    deloadHistory = null;
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
    const { classifications } = deriveWorkoutNoteAnalytics(allSections, trackedNames, undefined, trackedLiftActivations, { deloadHistory, sourceNoteId: currentId ?? null });
    classificationsPatch = { exercise_classifications: classifications };

    // Tracked-span retirement and stale-anchor repair (#893). This is the ONE
    // place either is written. The population here is deliberately NOT
    // `allSections` above: this list is unfiltered, so a movement that appears
    // only inside a recovery week whose block opts out of ordinary analytics is
    // present, not absent, and is never retired for sitting outside that
    // boundary. It still sits inside the `recoveryBoundaryKnown` guard: a failed
    // boundary read means the population is UNKNOWN, and "could not read" must
    // never be acted on as "the movement is gone". Awaited, but never allowed to
    // fail the save.
    const unfilteredSections = [
      ...notes.flatMap(n => {
        const text = n.id === currentId ? textToSave : n.raw_text;
        return text ? parseWorkoutNote(text).sections : [];
      }),
      ...(currentId ? [] : savedSections),
    ];
    if (reconcileTrackedLiftActivations) {
      await reconcileTrackedLiftActivations(unfilteredSections).catch(() => {});
    }
  }

  const { exercise_skips, day_skips, attendance_flags } = deriveSkipData(savedSections);
  return { classificationsPatch, exercise_skips, day_skips, attendance_flags };
}

// #577 (Contract 3): recompute the pending (not-yet-released) PR-moment
// candidate against the SAME aggregate, recovery-filtered/deload-excluded
// population Analytics uses, and RETURN it (the hook stores it in a ref until
// handleDoneCurrent releases it). Reads the recovery-exclusion boundary FRESH
// from storage on every call so a Done release revalidates against current
// state. Any failure is swallowed (returns null): PR detection must never block
// or corrupt the actual save flow.
export async function computePendingPRCandidate({
  currentId,
  originalNoteState,
  effectiveActiveWeek,
  hasABWeeks,
  notes,
  trackedLifts,
  trackedLiftActivations,
  lastSavedTitle,
  liveTitle,
  lastSavedText,
  liveText,
  consumedPRKeys,
}) {
  if (!currentId || !originalNoteState) return null;
  // #577 review (Codex-and-user, post-freeze): a deload note's own edits never
  // produce a candidate — the current note's own content was previously always
  // included even when the note being edited IS itself a deload note.
  const currentTitle = lastSavedTitle ?? liveTitle;
  if (isDeloadTitle(currentTitle) || isDeloadTitle(originalNoteState.title)) return null;
  // #577 gap fix: an A/B active-week switch mid-session changes which half of
  // the note's raw text parseWorkoutNote reads, so baseline and "current" would
  // no longer describe the same week — any frontier comparison would be
  // meaningless. Treated exactly like a note switch.
  if (originalNoteState.activeWeek !== effectiveActiveWeek) return null;
  try {
    // #577 review (Codex, post-freeze): the eligible note list must preserve the
    // SAME order Analytics itself uses — the activation anchor is positional in
    // notebook order, so the current note's live (before/after) content replaces
    // its own entry IN PLACE, preserving every other note's position.
    const excludedNoteIds = await loadRecoveryExcludedNoteIds();
    const eligibleNotes = filterNotesForNormalAnalytics(notes || [], excludedNoteIds)
      .filter((n) => !n.title?.startsWith(DELOAD_NOTE_PREFIX));

    const buildFullSections = (ownRawText) => eligibleNotes.flatMap((n, noteOrdinal) => {
      const isCurrent = n.id === currentId;
      const { sections } = parseWorkoutNote((isCurrent ? ownRawText : n.raw_text) || '');
      return sections.map((s, sectionOrdinal) => ({
        ...s,
        __noteId: isCurrent ? currentId : n.id,
        __noteOrdinal: noteOrdinal,
        __sectionOrdinal: sectionOrdinal,
      }));
    });

    // #577 review (Codex, post-freeze): the activation anchor/watermark must be
    // RESOLVED AND CUT against the FULL, UNSLICED Analytics population — every
    // note's complete content, both A/B halves — never a week-restricted slice.
    // deriveTrackedPROccurrences over the full section list resolves then slices
    // from the anchor over the true, correctly-ordered full sequence.
    const afterText = lastSavedText ?? liveText;
    const fullAfterSections = buildFullSections(afterText);
    const fullBeforeSections = buildFullSections(originalNoteState.text);
    const trackedNames = listTrackedLifts(trackedLifts);
    const fullAfterEntries = deriveTrackedPROccurrences(fullAfterSections, trackedNames, trackedLiftActivations);
    const fullBeforeEntries = deriveTrackedPROccurrences(fullBeforeSections, trackedNames, trackedLiftActivations);

    // Frontier comparison itself still runs on the ACTIVE week's own
    // occurrences only. Restricting AFTER the anchor cut keeps each entry's
    // occurrenceOrdinal/setOrdinal exactly as the full-population pass assigned
    // them (sections are always emitted week-A-then-week-B, so this filter is a
    // stable, order-preserving subsequence), which lib/prMoment.js depends on.
    const restrictToActiveWeek = (entries, rawText) => {
      if (!hasABWeeks) return entries;
      const { weekBStartIndex } = parseWorkoutNote(rawText || '');
      if (weekBStartIndex == null) return entries;
      return entries.filter((e) => (
        e.noteId !== currentId
        || (effectiveActiveWeek === 'B' ? e.sectionOrdinal >= weekBStartIndex : e.sectionOrdinal < weekBStartIndex)
      ));
    };

    const afterEntries = restrictToActiveWeek(fullAfterEntries, afterText);
    const beforeEntries = restrictToActiveWeek(fullBeforeEntries, originalNoteState.text);
    return detectPRMoment(beforeEntries, afterEntries, currentId, consumedPRKeys);
  } catch {
    return null;
  }
}

// Raises the fatigue check-in, from the single trigger site: Done, after
// handleSave has returned true. Precedence is evaluated top-down and the first
// matching rule decides. State is applied through the passed setters; nothing is
// stored here, so a withheld prompt keeps the session eligible at a later Done.
export function runCheckInDetection({
  gates,
  liveTitle,
  storedTitle,
  trackedLifts,
  liveText,
  liveId,
  checkins,
  onWithdraw,
  setRoughFlaggedNames,
  setRoughSessionIndex,
  setRoughNoteId,
  setRoughCheckInData,
  setShowCheckInModal,
  onCheckInPrompt,
}) {
  // Rows 1, 2, 4 and 6 — feature off, unverified read, deload note, or another
  // modal owning the screen. The deload check reads the title that was just
  // SAVED (liveTitle), not only the stored note's, which cannot have caught up
  // yet after an awaited handleSave.
  if (!gates.fatigueTrackingEnabled
    || gates.notesLoading
    || gates.notesError
    || gates.otherModalOwnsScreen
    || isDeloadTitle(liveTitle)
    || isDeloadTitle(storedTitle)) {
    onWithdraw();
    return;
  }
  const explicitTrackedNames = listTrackedLifts(trackedLifts);
  const defaultNames = getDefaultTrackedNames();
  const normalizedDefaults = new Set(defaultNames.map(n => normalizeLiftName(n)));
  const resolvedTrackedNames = [
    ...defaultNames,
    ...explicitTrackedNames.filter(n => !normalizedDefaults.has(normalizeLiftName(n))),
  ];
  const { sections: currentSections } = parseWorkoutNote(liveText);
  const { isRough, sessionIndex, flagged, detectors, metrics } = deriveSessionCheckIn(currentSections, resolvedTrackedNames);
  // Row 9 — no trigger fired. Row 7 — this session already has a record.
  if (!isRough || sessionIndex == null || checkins?.[sessionIndex]) {
    setRoughFlaggedNames(new Set());
    setRoughSessionIndex(null);
    setRoughNoteId(null);
    return;
  }
  // Row 8 — cooldown. Only the interruption is withheld: the exercises are
  // still marked inline and the session is still reachable from Analytics.
  if (checkInCooldownActive(checkins, sessionIndex)) {
    setRoughFlaggedNames(new Set(flagged.map(f => f.normName)));
    setRoughSessionIndex(sessionIndex);
    setRoughNoteId(liveId);
    return;
  }
  // Row 10 — ask.
  setRoughFlaggedNames(new Set(flagged.map(f => f.normName)));
  setRoughSessionIndex(sessionIndex);
  setRoughNoteId(liveId);
  setRoughCheckInData({ sessionIndex, detectors, flagged, metrics });
  setShowCheckInModal(true);
  onCheckInPrompt?.();
}

// Reverts the current editor to its editor-entry snapshot (or clears a stranded
// new-note draft), returning true on success. For a stranded create (#997
// review) retirement of the durable attempt is AWAITED and comes FIRST, and the
// draft is cleared only once it succeeds — otherwise the next routine authored
// here could complete the abandoned attempt and overwrite the stranded routine.
// An in-flight create is awaited first because it may be the very attempt being
// retired.
export async function performRevertCurrent({
  currentId,
  originalNoteState,
  update,
  autosaveTimerRef,
  saveInFlightRef,
  createAttemptTokenRef,
  createAttemptKey,
  pendingActiveWeekRef,
  activeWeekAuthorityRef,
  setWorkoutNoteTitle,
  setWorkoutNoteText,
  setLocalActiveWeek,
  setSaveError,
}) {
  if (!currentId) {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (saveInFlightRef.current) {
      await saveInFlightRef.current;
    }
    const abandoned = createAttemptTokenRef.current;
    if (abandoned) {
      try {
        await clearWorkoutNoteCreationAttempt(createAttemptKey, abandoned);
      } catch {
        setSaveError('Could not clear this draft');
        return false;
      }
      createAttemptTokenRef.current = null;
    }
    setWorkoutNoteTitle('');
    setWorkoutNoteText('');
    clearWorkoutNoteDraft('current:new').catch(() => {});
    return true;
  }
  if (!originalNoteState) return true;
  if (autosaveTimerRef.current) {
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }
  if (saveInFlightRef.current) {
    await saveInFlightRef.current;
  }
  try {
    await update(currentId, {
      title: originalNoteState.title,
      raw_text: originalNoteState.text,
      activeWeek: isValidActiveWeek(originalNoteState.activeWeek)
        ? originalNoteState.activeWeek
        : null,
    });
    setWorkoutNoteTitle(originalNoteState.title);
    setWorkoutNoteText(originalNoteState.text);
    if (isValidActiveWeek(originalNoteState.activeWeek)) {
      pendingActiveWeekRef.current = originalNoteState.activeWeek;
      activeWeekAuthorityRef.current = 'user';
      setLocalActiveWeek(originalNoteState.activeWeek);
    } else {
      pendingActiveWeekRef.current = null;
      activeWeekAuthorityRef.current = 'fallback';
      setLocalActiveWeek(null);
    }
    clearWorkoutNoteDraft(`current:${currentId}`).catch(() => {});
    return true;
  } catch (err) {
    console.warn('Revert failed:', err);
    Alert.alert('Error', 'Failed to revert changes. Please try again.');
    return false;
  }
}

// The current-routine editor's save. Ordinary Done/autosave callers coalesce
// onto an in-flight write of the same live editor state; specialized skip/
// remove-skip calls carry their own atomic text/counter/check-in payload and
// must never inherit success from an older request. A fulfilled mutation is
// treated as durable (its submitted payload, not the adapter's possibly-partial
// return, is bound to status/Done convergence). A new note performs the
// id-stable create (#997): the attempt token is durable before the create and
// retired only after full success, so a retried create completes the same note
// instead of adding a second.
export function performCurrentSave(ctx, { autosave = false, overrideText, universalSkipCount, sessionCheckins } = {}) {
  const {
    workoutNoteText,
    workoutNoteTitle,
    currentId,
    notes,
    trackedLifts,
    trackedLiftActivations,
    reconcileTrackedLiftActivations,
    activeWeekPatch,
    update,
    add,
    selectCurrent,
    createAttemptKey,
    saveInFlightRef,
    savingSnapshotRef,
    universalSkipCountRef,
    currentIdRef,
    workoutNoteTextRef,
    workoutNoteTitleRef,
    lastSavedIdRef,
    lastSavedTextRef,
    lastSavedTitleRef,
    draftBaseUpdatedAtRef,
    draftNoteIdOverrideRef,
    createAttemptTokenRef,
    setIsSaving,
    setSaveError,
    setSaveSuccess,
    setWorkoutNoteTitle,
    setWorkoutNoteText,
  } = ctx;

  const isSpecializedSave = overrideText !== undefined
    || universalSkipCount !== undefined
    || sessionCheckins !== undefined;
  if (saveInFlightRef.current) {
    return isSpecializedSave
      ? Promise.resolve(false)
      : saveInFlightRef.current;
  }
  const textToSave = overrideText ?? workoutNoteText;
  if (!currentId && !textToSave.trim()) {
    setSaveError('Workout notes are required');
    return Promise.resolve(false);
  }
  const savedForId = currentId;
  const snapshotText = textToSave;
  const snapshotTitle = workoutNoteTitle;
  const run = async () => {
    savingSnapshotRef.current = {
      noteId: savedForId || 'new',
      title: snapshotTitle,
      raw_text: snapshotText,
    };
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    // Start the draft ordering boundary before canonical persistence, but do
    // not put the cheap local bookkeeping on the user's save critical path.
    const draftCheckpointPromise = markWorkoutNoteDraftSaveStart().catch(() => null);
    try {
      let result = null;
      const titleToSave = snapshotTitle || 'Untitled Routine';
      const { classificationsPatch, exercise_skips, day_skips, attendance_flags } =
        await computeSaveClassifications({
          textToSave,
          currentId,
          notes,
          trackedLifts,
          trackedLiftActivations,
          reconcileTrackedLiftActivations,
        });
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
        // Neither attempt-store write is swallowed; both sit inside this
        // try/catch so a rejection surfaces as a failed save. Minting must not
        // be skipped (an uncorrelated create is the duplicate #997 prevents),
        // and a completed attempt left in the store would hand this note's id to
        // the next new routine and overwrite it.
        const attemptToken = createAttemptTokenRef.current
          || await ensureWorkoutNoteCreationAttempt(createAttemptKey);
        createAttemptTokenRef.current = attemptToken;
        result = await add(titleToSave, snapshotText, { attemptToken });
        await clearWorkoutNoteCreationAttempt(createAttemptKey, attemptToken);
        createAttemptTokenRef.current = null;
        savingSnapshotRef.current.noteId = result.id;
        draftNoteIdOverrideRef.current = result.id;
        await selectCurrent(result.id);
        if (result) {
          result = await update(result.id, {
            ...classificationsPatch,
            skip_markers,
            attendance_flags,
            ...activeWeekPatch,
          }) || result;
        }
      }

      if (result) {
        const identityUnchanged = savedForId
          ? currentIdRef.current === savedForId
          : currentIdRef.current == null || currentIdRef.current === result.id;
        // Commit the counter only after the write actually persisted, so a
        // failed save leaves the advisory flag in sync with the stored text.
        if (identityUnchanged) {
          savingSnapshotRef.current.noteId = result.id || savedForId;
          universalSkipCountRef.current = resolvedUniversalSkipCount;
          lastSavedIdRef.current = result.id || savedForId;
          lastSavedTextRef.current = snapshotText;
          lastSavedTitleRef.current = titleToSave;
          draftBaseUpdatedAtRef.current = result.updated_at ?? draftBaseUpdatedAtRef.current;
          if (!savedForId && result.id) draftNoteIdOverrideRef.current = result.id;
        }
        const contentUnchanged =
          workoutNoteTextRef.current === snapshotText &&
          workoutNoteTitleRef.current === snapshotTitle;
        if (contentUnchanged && identityUnchanged) {
          setWorkoutNoteTitle(result.title || '');
          setWorkoutNoteText(result.raw_text || '');
          if (!autosave) setSaveSuccess('Saved on device');
        }
        await reconcileDraftsAfterSave({
          preKey: currentDraftKey(savedForId),
          postKey: currentDraftKey(result.id || savedForId),
          checkpoint: await draftCheckpointPromise,
          savedSnapshot: { title: snapshotTitle, raw_text: snapshotText },
          latestSnapshot: {
            title: workoutNoteTitleRef.current,
            raw_text: workoutNoteTextRef.current,
          },
          identityUnchanged,
          resultUpdatedAt: result.updated_at,
        });
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
      saveInFlightRef.current = null;
    }
  };

  const promise = run();
  saveInFlightRef.current = promise;
  return promise;
}

// Advisory universal-skip counter (persisted in skip_markers): read the
// persisted value, and re-seed the caller's live ref whenever the note identity
// changes so the ref stays local authority within a session.
export function persistedUniversalSkipCount(note) {
  const v = note?.skip_markers?.universal_skip_count;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function useUniversalSkipSeed({ universalSkipCountRef, currentNoteRef, noteIdentity }) {
  useEffect(() => {
    universalSkipCountRef.current = persistedUniversalSkipCount(currentNoteRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteIdentity]);
}
