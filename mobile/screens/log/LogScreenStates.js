import React, { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Alert } from '../../lib/platformAlert';
import { findLiveMembershipForNote } from '../../lib/data/recoveryBlocks';
import { useThemedStyles } from '../../theme/ThemeContext';
import { createStyles } from './logScreenStyles';
import { countWorkoutSessionsFromSections, parseWorkoutNote, normalizeExerciseKey } from '../../lib/parser';
import { deriveFirstUseState, pickAdoptableRoutine, FIRST_USE_S1 } from '../../lib/guidedEntry';
import { normalizeLiftName, listTrackedLifts, deriveWorkoutNoteAnalytics } from '../../lib/data';
import { setProgressionSuggestionMuted } from '../../storage/entries/settings';
import { isRenderableProgressionSuggestion, progressionSuggestionInstanceId } from '../../components/ProgressionSuggestionCard';
import { DELOAD_NOTE_PREFIX } from '../../lib/LogScreenHelpers';
import { isEligibleBaselineNote, isEligibleRecoveryWeekNote } from '../../hooks/useEntries';

export function LogSkeleton() {
  const styles = useThemedStyles(createStyles);
  return (
    <View
      testID="log-skeleton"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your workout notes"
    >
      <View style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarFull]} />
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
      </View>
      <View style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
      </View>
    </View>
  );
}


// Screen-level orchestration for the Log tab (#1054 split): the cross-screen
// navigation intents, first-use/empty/editing derivations, progression
// suggestions, and the current-routine save/track wiring. Called once from
// LogScreen, so every hook here lives in LogScreen's own fiber and mounts,
// resets, and re-runs exactly as it did inline — the recovery-block mutation
// flow lives beside it in `buildLogRecovery`.
export function useLogScreenController(params) {
  const {
    navNoteKey, navNoteId, navRecoveryKey, navRecoveryNoteId, notesLoading,
    notesError, notes, currentId, currentNote, isActive, registerBackConsumer,
    workoutNoteText, workoutNoteTitle, setWorkoutNoteTitle, recoveryWeekNumberByNoteId, recoveryBlocks, recoveryWeeks, recoveryReady, recoveryTabVisible,
    activeTrainingContext, deloadModeEnabled, baselinePaused, trackedLifts, trackedLiftActivations, toggleTrackedLift,
    deloadHistory, progressionRecoveryFilter, progressionSettings, dismissedProgressionIds, setDismissedProgressionIds, importRoutineOpen,
    setImportRoutineOpen, tabView, setTabView, currentEditor, otherEditor, deloadEditor,
  } = params;

  const recoveryDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (recoveryDefaultAppliedRef.current || !recoveryReady) return;
    recoveryDefaultAppliedRef.current = true;
    if (!recoveryTabVisible) return;
    setTabView('recovery');
    if (navRecoveryKey === 0 && activeTrainingContext.status === 'recovery_open_week' && activeTrainingContext.activeNoteId) {
      otherEditor.setRecoveryViewingNoteId(activeTrainingContext.activeNoteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryReady, recoveryTabVisible]);

  // Typed note navigation intent (#718). The shell says WHICH note a cross-screen
  // handoff wants shown and nothing more: it never reads or owns this screen's
  // editor state, so the decision about whether opening that note is safe right
  // now has to live here, where the three editors are already owned.
  //
  // The applied key is a ref, not an effect dependency alone. The effect also
  // depends on `notes`/`notesLoading`/`notesError`/editor state so a request
  // that arrives while the note list is still loading — or while a failed read
  // is waiting on Retry — can be re-attempted once it resolves, and that re-run
  // must not also replay an already-consumed key off some unrelated state
  // change. Stamping the ref at each terminal outcome makes every keyed intent
  // apply exactly once per key, while a later key for the same note re-applies
  // by design.
  // 0 is the shell's initial key, i.e. "no intent has ever been issued", so a
  // key that is already non-zero at mount is a real pending intent to consume.
  const appliedNoteKeyRef = useRef(0);
  useEffect(() => {
    if (navNoteKey === appliedNoteKeyRef.current) return; // already consumed
    if (!navNoteId) {
      // Absent target: preserve whatever this screen is currently showing.
      appliedNoteKeyRef.current = navNoteKey;
      return;
    }
    // Resolvability gates come first, before any user-state refusal: never
    // announce an outcome that cannot actually be determined yet.
    if (notesLoading) return; // stay pending; notesLoading is a dependency below
    // A failed notes read is NOT evidence that the note is gone (#718 review
    // finding 2). useWorkoutNotes clears `loading` after a failed read while
    // surfacing `error` and leaving `notes` empty or stale, so treating absence
    // as a deletion here would both lie to the user and stamp the key —
    // permanently defeating the ErrorBanner's own Retry, which has no way to
    // reissue the intent. Absence is authoritative only after a successful read.
    if (notesError) return; // stay pending until a Retry lands a clean read

    // Refusals are terminal for this key rather than queued: silently opening
    // the note later, after the user finished an unrelated edit, would be a
    // surprise navigation. A caller that still wants it issues a new key.
    if (currentEditor.mode === 'edit' || otherEditor.editingNoteId || deloadEditor.deloadMode === 'edit') {
      appliedNoteKeyRef.current = navNoteKey;
      // Copy names the real control (#ui-design-rules §12): the editor's own
      // header action is labelled "Done" on all three editor paths.
      Alert.alert(
        'Finish your edit first',
        'Tap Done to close the note you are editing, then try opening that note again.'
      );
      return;
    }

    const note = notes.find(n => n.id === navNoteId);
    appliedNoteKeyRef.current = navNoteKey;
    if (!note) {
      // Missing target (e.g. the note was deleted since the link was rendered):
      // say so instead of opening unrelated content.
      Alert.alert('Note not found', 'This routine note may have been deleted.');
      return;
    }
    // Select the view that OWNS this note before consuming the intent (#718
    // review finding 1). Routine and Deload are mutually exclusive — only the
    // effectiveTabView branch is mounted — and they render disjoint sets of
    // notes off the SAME viewingNoteId: LogPreviousRoutines filters deload
    // notes out of otherNotes, and LogDeloadSection is the only place they
    // render. Setting viewingNoteId alone would therefore leave a correctly
    // resolved note invisible whenever the screen happens to be on the other
    // view. Unconditional because effectiveTabView ignores tabView entirely
    // while deload mode is off, so this is inert in that configuration.
    const isDeloadTarget = !!note.title?.startsWith(DELOAD_NOTE_PREFIX);
    setTabView(isDeloadTarget ? 'deload' : 'routine');

    // Current destination: the active routine is already the card at the top of
    // this screen's read view, and the previous-routines viewer only ever shows
    // NON-current notes, so opening it there would be wrong. The view switch
    // above still applies — that is the whole point of doing it before this
    // early return, since the current card is itself hidden while Deload is up.
    if (note.id === currentId) return;
    // Set-only, and deliberately NOT handleViewOtherNote, which toggles the
    // viewer closed when the same note is already open. A navigation intent is
    // "ensure this note is shown", so it must be idempotent, and it touches only
    // the viewer — never editingNoteId/editingText or any other editor state.
    otherEditor.setViewingNoteId(note.id);
    // #1021: no disclosure left to reveal — LogPreviousRoutines always lists
    // its non-current cards, so setting the viewing note id is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navNoteKey, navNoteId, notesLoading, notesError, notes, currentId, currentEditor.mode, otherEditor.editingNoteId, deloadEditor.deloadMode]);

  // Recovery-view navigation intent (#869 review, #874): the plain `note`
  // target above always forces Routine/Deload and opens the ordinary
  // previous-routines viewer, which is wrong for a recovery-linked note —
  // and a plain tab press leaves whatever `tabView` the user last picked in
  // place, so a between-weeks handoff could land on Routine/Deload instead
  // of the Recovery decision it promised. This intent lands on the Recovery
  // view outright and, when a specific note is named and resolves, focuses
  // it there — through `recoveryViewer`, never the routine/deload viewer.
  const appliedRecoveryKeyRef = useRef(0);
  useEffect(() => {
    if (navRecoveryKey === appliedRecoveryKeyRef.current) return; // already consumed
    // Resolvability gate, same reasoning as the note-target effect above:
    // never act on Recovery visibility before the authoritative read settles.
    if (!recoveryReady) return;

    if (currentEditor.mode === 'edit' || otherEditor.editingNoteId || deloadEditor.deloadMode === 'edit') {
      appliedRecoveryKeyRef.current = navRecoveryKey;
      Alert.alert(
        'Finish your edit first',
        'Tap Done to close the note you are editing, then try again.'
      );
      return;
    }

    appliedRecoveryKeyRef.current = navRecoveryKey;
    if (!recoveryTabVisible) return; // nothing to land on

    setTabView('recovery');
    if (navRecoveryNoteId) {
      const note = notes.find(n => n.id === navRecoveryNoteId);
      // Missing target is silent here, unlike the note-target effect's alert:
      // LogRecoverySection itself already reports a missing/unreadable
      // current-week note truthfully once the Recovery view is showing, so
      // landing there without a focused note is still the correct, honest
      // outcome rather than a second competing error surface.
      if (note) otherEditor.setRecoveryViewingNoteId(note.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRecoveryKey, navRecoveryNoteId, recoveryReady, recoveryTabVisible, notes, currentEditor.mode, otherEditor.editingNoteId, deloadEditor.deloadMode]);

  const otherNotes = notes.filter(n => n.id !== currentId && !n.title?.startsWith('Deload · '));

  const hasContent = workoutNoteText.trim().length > 0;

  // Recovery-block eligibility (#695). Purely structural — never inferred from
  // title/date/content, except the pre-existing deload-note title convention,
  // which is reused as-is.
  //
  // Eligibility stays UNKNOWN until the authoritative read is verified (#716).
  // Both predicates are "no live membership blocks this note", so an unverified
  // empty `recoveryBlocks`/`recoveryWeeks` would declare every note eligible —
  // the exact failure mode where a note already linked on disk could be frozen
  // as a second block's baseline. Unknown is expressed as no eligible notes,
  // which withdraws the affordance rather than offering an unsafe one.
  const recoveryEligibilityCtx = { blocks: recoveryBlocks, weeks: recoveryWeeks, deloadNotePrefix: DELOAD_NOTE_PREFIX };
  const eligibleBaselineNotes = recoveryReady
    ? notes.filter(n => isEligibleBaselineNote(n, recoveryEligibilityCtx))
    : [];
  const eligibleWeekNotes = recoveryReady
    ? notes.filter(n => isEligibleRecoveryWeekNote(n, recoveryEligibilityCtx))
    : [];

  const currentRecoveryWeekNumber = currentNote ? (recoveryWeekNumberByNoteId[currentNote.id] ?? null) : null;

  // Progression suggestions for the current-routine surface (#960). Consumes
  // the existing `deriveWorkoutNoteAnalytics` output — the same pass Analytics
  // and Home run — over the user's tracked lifts that appear in the current
  // routine. It recomputes nothing: thresholds, evidence, and the explanation
  // sentence all come from the derivation. Off, no current routine, or no
  // history all collapse to an empty list and no card.
  const progressionSuggestionRecords = useMemo(() => {
    if (!progressionSettings.enabled || !currentId || !hasContent || !progressionRecoveryFilter.ready) return [];
    let currentSections;
    try {
      currentSections = parseWorkoutNote(workoutNoteText).sections;
    } catch {
      return [];
    }
    const namesInCurrent = new Set(
      currentSections.flatMap(s => (s.exercises || []).map(e => normalizeExerciseKey(e.name)))
    );
    const visibleTrackedNames = listTrackedLifts(trackedLifts).filter(
      name => namesInCurrent.has(normalizeExerciseKey(name))
    );
    if (visibleTrackedNames.length === 0) return [];
    const allSections = notes.flatMap(n => {
      if (n.title?.startsWith(DELOAD_NOTE_PREFIX)) return [];
      // A completed Recovery block that opted out of ordinary analytics takes
      // its linked week notes out of the suggestion history, exactly as
      // Analytics' `deriveParsedSections` does. Membership is exact and
      // independent of which routine is current, so an excluded note is dropped
      // even when it is the current one (then there is simply no history to
      // suggest from — the same outcome Analytics reaches).
      if (progressionRecoveryFilter.isNoteExcluded?.(n.id)) return [];
      const text = n.id === currentId ? workoutNoteText : n.raw_text;
      if (!text) return [];
      try {
        return parseWorkoutNote(text).sections;
      } catch {
        return [];
      }
    });
    try {
      const { progressionSuggestions, nameDisplayMap } = deriveWorkoutNoteAnalytics(
        allSections,
        visibleTrackedNames,
        undefined,
        trackedLiftActivations,
        { deloadHistory, sourceNoteId: currentId, recoveryBlocks },
      );
      const records = Array.isArray(progressionSuggestions) ? progressionSuggestions : [];
      // The tracked-name list is normalized, so a record's `name` can be
      // lower-cased; show the user's own last-seen casing.
      return records.map(record => {
        const key = normalizeExerciseKey(record.name);
        const displayName = (nameDisplayMap && nameDisplayMap.get(key)) || record.name;
        return displayName === record.name ? record : { ...record, name: displayName };
      });
    } catch {
      return [];
    }
  }, [
    progressionSettings.enabled,
    currentId,
    hasContent,
    workoutNoteText,
    notes,
    trackedLifts,
    trackedLiftActivations,
    deloadHistory,
    recoveryBlocks,
    progressionRecoveryFilter,
  ]);

  const mutedProgressionKeys = new Set(progressionSettings.mutedKeys || []);
  const visibleProgressionSuggestions = progressionSuggestionRecords
    .map(record => ({
      record,
      key: normalizeExerciseKey(record.name),
      instanceId: progressionSuggestionInstanceId(record, normalizeExerciseKey(record.name)),
    }))
    .filter(({ record, key, instanceId }) =>
      isRenderableProgressionSuggestion(record)
      && !mutedProgressionKeys.has(key)
      && !dismissedProgressionIds.has(instanceId)
    );

  // A muted exercise still owns an unmute affordance on this surface, but only
  // when it has a suggestion the mute is actively hiding — an unmute row for an
  // exercise with nothing to show would be noise.
  const mutedProgressionRows = progressionSuggestionRecords
    .filter(record => isRenderableProgressionSuggestion(record)
      && mutedProgressionKeys.has(normalizeExerciseKey(record.name)))
    .map(record => ({ name: record.name, key: normalizeExerciseKey(record.name) }));

  const handleMuteProgression = (key) => {
    setProgressionSuggestionMuted(key, true).catch(() => {});
  };
  const handleUnmuteProgression = (key) => {
    setProgressionSuggestionMuted(key, false).catch(() => {});
  };
  const handleDismissProgression = (instanceId) => {
    setDismissedProgressionIds(prev => {
      const next = new Set(prev);
      next.add(instanceId);
      return next;
    });
  };


  const handleToggleTrack = async (name) => {
    // #893/#892: the storage key is the CANONICAL exercise key, not the plain
    // normalized name. `iso row` and `Hammer Strength Iso Row` are one movement,
    // and the analytics population has always resolved them that way — writing
    // the raw normalized name left the flag under a key half the app could not
    // find, and would leave an activation record stranded beside it.
    const key = normalizeExerciseKey(name) || normalizeLiftName(name);
    // The population the activation anchor is counted in: the WHOLE notebook,
    // unfiltered, with the live editor text standing in for the current note so
    // a session typed seconds ago is not missed. It is deliberately the same
    // population the save-boundary reconcile uses, and a superset of every
    // ordinary-analytics population — so the anchor can never come out too
    // small and admit an entry from the untracked gap. Where a render surface
    // sees fewer sessions than that (Analytics excludes deloads; both surfaces
    // exclude opted-out recovery weeks) it clamps in memory and reads
    // `First session` until its own count catches up.
    //
    // A brand-new routine has no `currentId` and no item in `notes`, yet the
    // active-routine card still offers Track. Its live text is appended
    // explicitly for that case — the same thing the save path does — because
    // without it the population comes out empty, the anchor is 0, and every
    // session already typed into that routine stays inside the new trend.
    const activationSections = [
      ...notes.flatMap(n => {
        const text = n.id === currentId ? workoutNoteText : n.raw_text;
        return text ? parseWorkoutNote(text).sections : [];
      }),
      ...(currentId || !workoutNoteText ? [] : parseWorkoutNote(workoutNoteText).sections),
    ];
    await toggleTrackedLift(key, activationSections);
  };


  // First-paint gate (#737). Before this, a Log tab whose notes had not resolved
  // rendered neither the empty state nor any routine — a blank body under a
  // populated header. `notes.length === 0` keeps a refresh over already-loaded
  // notes from throwing the whole screen back to a skeleton.
  const isNotesFirstLoad = notesLoading && notes.length === 0;
  // A failed read is NOT an empty notebook (#737, same reasoning as the
  // navigation-intent gate above): useWorkoutNotes clears `loading` on failure
  // and leaves `notes` empty, so without the `!notesError` term the ErrorBanner
  // would sit directly on top of "create your first routine" — telling a user
  // with a full notebook that they have none.
  const isEmpty = !isNotesFirstLoad && !notesError && notes.length === 0;
  // A recovery-sourced editingNoteId session (#841) edits inline inside
  // LogRecoverySection's own expanded week, not the shared full-screen
  // editor — so it must not flip isEditing/hide the tab content the way
  // every other editingNoteId source does.
  const isEditing = (!!otherEditor.editingNoteId && otherEditor.editingSource !== 'recovery')
    || currentEditor.mode === 'edit' || deloadEditor.deloadMode === 'edit';

  // A recovery-sourced editingNoteId session stays out of `isEditing` above
  // (its Save/Cancel live inline in LogRecoverySection, not the shared
  // full-screen editor), which means the tab toggle stays mounted AND
  // visible while it is open — unlike every other edit surface, which hides
  // the toggle by making `isEditing` true. Left unguarded, switching to
  // Routine or Deload would hide the only Save/Cancel controls for the
  // in-progress edit and, worse, would let the user open the CURRENT
  // routine's full-screen editor while `otherEditor.editingNoteId` still
  // names the recovery note — every ternary in that editor keys off
  // `editingNoteId` truthiness, not tab or mode, so it would render and Done
  // the wrong note entirely (automated review finding). Leaving Recovery is
  // therefore refused outright while a recovery inline edit is open; the
  // user finishes it (Save or Cancel) first, exactly as every other editor
  // already requires via `isEditing` hiding the toggle.
  const recoveryInlineEditActive = otherEditor.editingSource === 'recovery' && !!otherEditor.editingNoteId;
  const handleTabViewChange = (next) => {
    if (recoveryInlineEditActive && next !== 'recovery') return;
    setTabView(next);
  };

  // Recovery is selectable only while `recoveryTabVisible`, and Deload only
  // while deload mode is enabled AND the baseline is not paused (#870) —
  // either falls back to Routine the instant its own condition stops holding
  // (e.g. the active block completes while its tab is open, or Recovery
  // starts while Deload is open), exactly as Deload already fell back before
  // Recovery existed (#823).
  const deloadTabEnabled = deloadModeEnabled && !baselinePaused;
  const effectiveTabView = tabView === 'recovery' && recoveryTabVisible
    ? 'recovery'
    : tabView === 'deload' && deloadTabEnabled
      ? 'deload'
      : 'routine';

  // First-use state machine (#748; #745 Part 3 §1). Derived from verified data
  // on every render — there is no persisted onboarding flag anywhere, so a user
  // who deletes everything correctly sees the guidance again, and a returning
  // user stops seeing it because their data says so. Every predicate is gated
  // on a resolved, non-error read (#737), so the state is UNKNOWN — and nothing
  // guided renders — while the notebook is still loading or failed.
  const activeSessionCount = countWorkoutSessionsFromSections(currentEditor.activeWeekParsed.sections);
  const firstUseState = deriveFirstUseState({
    notes,
    currentId,
    notesLoading,
    notesError,
    activeSessionCount,
  });
  // S1 is the state finding F7 showed had no call to action anywhere, and the
  // state `Not now` deliberately produces. It is the sole surface that makes
  // declining adoption a safe choice rather than a trapdoor (#745 Part 4 §C1),
  // so it ships with the prompt, not later.
  // Suppressed while an adoption prompt is on screen: the prompt is the more
  // immediate and more specific form of the same offer, and a state never
  // presents two calls to action of equal weight. `Not now` restores this card.
  const adoptableRoutine = firstUseState === FIRST_USE_S1 && !currentId && !otherEditor.adoptionPrompt
    ? pickAdoptableRoutine(notes, currentId)
    : null;

  // `New Routine` always opens the ordinary editor on an empty note, which
  // shows R6b-1's tappable seed example. No guided composer to route into.
  const handleCreateRoutineEntry = () => otherEditor.handleCreateRoutine();

  const activeSaveError = deloadEditor.deloadMode === 'edit'
    ? deloadEditor.saveError
    : otherEditor.editingNoteId
      ? otherEditor.saveError
      : currentEditor.saveError;

  const activeSaveSuccess = deloadEditor.deloadMode === 'edit'
    ? deloadEditor.saveSuccess
    : otherEditor.editingNoteId
      ? otherEditor.saveSuccess
      : currentEditor.saveSuccess;

  const activeIsSaving = deloadEditor.deloadMode === 'edit'
    ? deloadEditor.isSaving
    : currentEditor.isSaving;

  const activeSaveStatus = deloadEditor.deloadMode === 'edit'
    ? deloadEditor.isSaving
      ? 'saving'
      : deloadEditor.saveSuccess
        ? 'saved'
        : null
    : otherEditor.editingNoteId
      ? otherEditor.saveStatus
      : currentEditor.saveStatus;

  const activeEditorInteraction = otherEditor.editingNoteId
    ? otherEditor.cancelPendingDraftRestore
    : currentEditor.cancelPendingDraftRestore;


  // Deleting a linked recovery-week note (any week, active or completed
  // -history — this is deliberately not restricted to the latest week the way
  // the explicit Unlink action is) must never leave a live dangling membership
  // (#696), but cancelling either confirmation (ours, or the pre-existing
  // "Delete Routine" one below) must leave the note exactly as it was — still
  // linked, still present. So the unlink never runs eagerly on our own
  // confirm; instead it is fused into the actual note removal itself
  // (removeNoteWithRecoveryUnlink, passed to useLogOtherRoutineEditor as its
  // `remove`), which only ever executes from the standard delete flow's own
  // "Delete" button. A cancel at either step calls no storage function at all.
  const guardedHandleDeleteRoutine = (id, title, isCurrent) => {
    const membership = findLiveMembershipForNote(recoveryWeeks, id);
    if (!membership) {
      otherEditor.handleDeleteRoutine(id, title, isCurrent);
      return;
    }
    Alert.alert(
      'Delete this recovery week note?',
      `"${title}" is Recovery Week ${membership.week_number}. Deleting it will unlink it from the recovery block; the block record itself is unaffected. You will be asked to confirm the deletion itself next.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => otherEditor.handleDeleteRoutine(id, title, isCurrent),
        },
      ]
    );
  };

  const editorCardProps = {
    deloadMode: deloadEditor.deloadMode,
    deloadEditText: deloadEditor.deloadEditText,
    setDeloadEditText: deloadEditor.setDeloadEditText,
    handleSaveDeload: deloadEditor.handleSaveDeload,
    isSaving: activeIsSaving,
    saveSuccess: activeSaveSuccess,
    saveError: activeSaveError,
    saveStatus: activeSaveStatus,
    onEditorInteraction: activeEditorInteraction,
    editingNoteId: otherEditor.editingNoteId,
    isEditingDeloadNote: otherEditor.isEditingDeloadNote,
    editingTitle: otherEditor.editingTitle,
    setEditingTitle: otherEditor.setEditingTitle,
    workoutNoteTitle,
    setWorkoutNoteTitle,
    editingDeloadHasLinkedRecord: otherEditor.editingDeloadHasLinkedRecord,
    setShowDeloadDatePicker: otherEditor.setShowDeloadDatePicker,
    deloadEditDate: otherEditor.deloadEditDate,
    deloadEditOrdinal: otherEditor.deloadEditOrdinal,
    setDeloadEditOrdinal: otherEditor.setDeloadEditOrdinal,
    showDeloadDatePicker: otherEditor.showDeloadDatePicker,
    editingNote: otherEditor.editingNote,
    setDeloadEditDate: otherEditor.setDeloadEditDate,
    editingText: otherEditor.editingText,
    setEditingText: otherEditor.setEditingText,
    activeEditText: currentEditor.activeEditText,
    sessionAlignmentIssue:
      deloadEditor.deloadMode === 'edit'
        ? null
        : otherEditor.editingNoteId
          ? otherEditor.sessionAlignmentIssue
          : currentEditor.sessionAlignmentIssue,
    handleCurrentTextChange: currentEditor.handleCurrentTextChange,
    handleSaveOtherNote: otherEditor.handleSaveOtherNote,
    handleSave: currentEditor.handleSave,
    onImportRoutine: () => setImportRoutineOpen(true),
    noteIsSaving: otherEditor.noteIsSaving,
    handleSwitchCurrent: otherEditor.handleSwitchCurrent,
    handleDeleteDeloadNoteFromEditor: otherEditor.handleDeleteDeloadNoteFromEditor,
    handleDeleteRoutine: guardedHandleDeleteRoutine,
    currentId,
    adoptionPrompt: otherEditor.adoptionPrompt,
    adoptionError: otherEditor.adoptionError,
    adoptionBusy: otherEditor.adoptionBusy,
    onAdoptPromptedRoutine: otherEditor.handleAdoptPromptedRoutine,
    onDismissAdoptionPrompt: otherEditor.handleDismissAdoptionPrompt,
    currentMode: currentEditor.mode,
    editingEffectiveWeek: otherEditor.editingEffectiveWeek,
    // #881: whichever pending source jump targets THIS shared card — the
    // current-editor session (editingNoteId null) or a non-Recovery other note.
    // A Recovery-sourced jump is filtered out; LogRecoverySection applies it.
    pendingSourceJump:
      otherEditor.editingNoteId
        ? (otherEditor.pendingSourceJump?.source === 'recovery' ? null : otherEditor.pendingSourceJump)
        : currentEditor.pendingSourceJump,
    onSourceJumpApplied: otherEditor.editingNoteId ? otherEditor.clearPendingSourceJump : currentEditor.clearPendingSourceJump,
  };

  return {
    otherNotes, hasContent, eligibleBaselineNotes, eligibleWeekNotes, currentRecoveryWeekNumber, visibleProgressionSuggestions,
    mutedProgressionRows, handleMuteProgression, handleUnmuteProgression, handleDismissProgression, handleToggleTrack, isNotesFirstLoad,
    isEmpty, isEditing, recoveryInlineEditActive, handleTabViewChange, deloadTabEnabled, effectiveTabView,
    adoptableRoutine, handleCreateRoutineEntry, activeSaveError, activeSaveSuccess, activeIsSaving, activeSaveStatus,
    activeEditorInteraction, guardedHandleDeleteRoutine, editorCardProps,
  };
}
