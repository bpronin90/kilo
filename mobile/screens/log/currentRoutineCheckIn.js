import { useState, useEffect, useRef } from 'react';
import { isDeloadTitle, runCheckInDetection } from './currentRoutineSave';

// The current-routine editor's fatigue check-in state, effects, and detection
// trigger, extracted from useLogCurrentRoutineEditor (#1055). Provided as a
// factory hook so the check-in state lives with its effects; identity, gates,
// and live-value refs arrive through `ctx`, so no module-level state is held.
// The detection RULES themselves live in ./currentRoutineSave (runCheckInDetection).
export function useCurrentCheckIn(ctx) {
  const {
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
  } = ctx;

  const [roughFlaggedNames, setRoughFlaggedNames] = useState(new Set());
  const [roughSessionIndex, setRoughSessionIndex] = useState(null);
  const [roughNoteId, setRoughNoteId] = useState(null);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [roughCheckInData, setRoughCheckInData] = useState(null);

  // Check-in gates, held in a ref: detection runs after an awaited save, so it
  // must read the gates as they are at the moment of raise, not when the handler
  // was created.
  const checkInGatesRef = useRef(null);
  checkInGatesRef.current = { fatigueTrackingEnabled, notesLoading, notesError, otherModalOwnsScreen };

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

  // Whether the check-in is currently blocked from being on screen at all: the
  // feature is off, the read is not verified, another modal owns the screen, or
  // this is a deload note. Both the editor's own title and the stored note's are
  // consulted because they can disagree (the stored note lags a cloud
  // round-trip behind a just-saved title).
  const checkInBlocked =
    !fatigueTrackingEnabled
    || !!notesLoading
    || !!notesError
    || !!otherModalOwnsScreen
    || isDeloadTitle(workoutNoteTitle)
    || isDeloadTitle(currentNote?.title);

  // Withdrawal (D10 §3.3): one state transition, never a visibility change and
  // never a write. Clearing every field is what stops the sheet from
  // resurrecting itself when the toggle comes back on or the other modal closes
  // — the only way back to a prompt is fresh detection at a later Done.
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

  // Raises the fatigue check-in from the single trigger site (Done, after a
  // verified save). See runCheckInDetection in ./currentRoutineSave for the
  // precedence rules; state is applied through the setters passed here.
  const runDetection = () => runCheckInDetection({
    gates: checkInGatesRef.current,
    liveTitle: workoutNoteTitleRef.current,
    storedTitle: currentNoteRef.current?.title,
    trackedLifts,
    liveText: workoutNoteTextRef.current,
    liveId: currentIdRef.current,
    checkins: currentNoteRef.current?.session_checkins,
    onWithdraw: withdrawCheckIn,
    setRoughFlaggedNames,
    setRoughSessionIndex,
    setRoughNoteId,
    setRoughCheckInData,
    setShowCheckInModal,
    onCheckInPrompt,
  });

  return {
    roughFlaggedNames,
    roughSessionIndex,
    roughNoteId,
    showCheckInModal,
    setShowCheckInModal,
    roughCheckInData,
    withdrawCheckIn,
    runCheckInDetection: runDetection,
  };
}
