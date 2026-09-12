import { Alert } from '../../lib/platformAlert';
import { parseWorkoutNote } from '../../lib/parser';
import {
  findMatchingExerciseNames,
  rolloverOneKExercises,
  normalizeExerciseKey,
  DEFAULT_1K_EXERCISES,
} from '../../lib/data';

// Adoption / switch-current handlers for the other-routine editor, extracted
// from useLogOtherRoutineEditor (#748; #745). Adoption state (adoptionPrompt/
// Error/Busy) stays in the hook; these are pure ctx-parameterized closures
// rebuilt each render, so no module-level state is held. Exactly one adoption
// rule in the app: `Use as current`, the S1 card, and `Set as current routine`
// all route through the two branches of handleSwitchCurrent.
const ADOPT_FAILED_MESSAGE =
  'Could not make this your current routine. It is still saved — try again.';
const FLUSH_FAILED_MESSAGE =
  'Could not save your latest edits, so nothing was switched. Your text is still here — try again.';

export function createOtherAdoptionHandlers(ctx) {
  const {
    currentId,
    currentNote,
    notes,
    editingNoteId,
    hasUnsavedOther,
    currentEditorMode,
    hasUnsavedCurrent,
    handleSave,
    handleSaveOtherNote,
    selectCurrent,
    update,
    autosaveCurrentTimerRef,
    autosaveOtherTimerRef,
    setEditingNoteId,
    setEditingSource,
    setOriginalNoteState,
    adoptionPrompt,
    adoptionBusy,
    setAdoptionPrompt,
    setAdoptionError,
    setAdoptionBusy,
    routineViewer,
    recoveryViewer,
  } = ctx;

  // Adoption with no current routine: nothing to switch from, no analytics to
  // affect, no old routine to roll 1K selections over from — so no confirmation
  // and no rollover prompt (#745 Part 3 §2.2). Reached WITHOUT a confirmation
  // that offered Save & Switch / Switch Anyway, so it may not discard anything:
  // pending edits are flushed FIRST, and a failed flush aborts the adoption
  // rather than proceeding without them (which would destroy user text).
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
        // Same treatment as the P6 Save & Switch failure: the switch is not
        // attempted, the save error is surfaced, and the prompt stays retryable.
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
    setEditingSource(null);
    setOriginalNoteState(null);
    routineViewer.setViewingNoteId(null);
    recoveryViewer.setViewingNoteId(null);
    return { ok: true };
  };

  const handleSwitchCurrent = (id) => {
    const note = notes.find(n => n.id === id);
    if (!note) {
      // Never a silent no-op (#745 Part 3 §2.3). An Alert (not inline status)
      // because this handler is also invoked from LogPreviousRoutines, which has
      // no status surface of its own.
      Alert.alert(
        'Could not set current routine',
        'That routine is not saved yet. Save it first, then set it as your current routine.'
      );
      return;
    }

    // Adoption, not switching. currentId === null means there is nothing to
    // replace: no switch-warning copy, no unsaved-changes branch, no 1K rollover.
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
      // currentId changes only here, together with the 1K rollover write (#745
      // Part 6). An abandoned confirmation never adopts, rolls over, or dismisses
      // the prompt — this is the only place that clears it on a completed adoption.
      await selectCurrent(id);
      setEditingNoteId(null);
      setEditingSource(null);
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

  // `Use as current` on the post-save prompt, and the S1 card's `Use this
  // routine`. Both route through the SAME two branches as handleSwitchCurrent.
  const handleAdoptPromptedRoutine = async () => {
    if (!adoptionPrompt || adoptionBusy) return;
    setAdoptionError('');
    if (currentId) {
      // Replacing an existing current routine keeps the D7/#737 confirmation,
      // unsaved-changes branch, and 1K rollover prompt. An abandoned confirmation
      // leaves this prompt on screen and re-pressable (#745 Part 6 §A1.1).
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

  // Raises the SAME prompt state handleSaveOtherNote sets, so the guided
  // scaffold's save converges on one adoption rule with the plain editor's.
  const showAdoptionPromptFor = (note) => {
    if (!note?.id) return;
    setAdoptionError('');
    setAdoptionPrompt({ id: note.id, title: note.title || 'Untitled Routine' });
  };

  const handleDismissAdoptionPrompt = () => {
    // Writes nothing, including no dismissal flag. The choice is deferred, never
    // lost: the S1 card keeps offering adoption on every Log visit.
    setAdoptionPrompt(null);
    setAdoptionError('');
  };

  return {
    adoptDirectly,
    handleSwitchCurrent,
    handleAdoptPromptedRoutine,
    showAdoptionPromptFor,
    handleDismissAdoptionPrompt,
  };
}
