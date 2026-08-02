// LOG TAB STYLE LOCK — DO NOT TOUCH.
// The fonts, font sizes, colors, spacing, and overall visual style of the Log
// tab are intentionally fixed. Do NOT change any styling here, in the `styles`
// block below, or in the Log-tab typography of `components/UI.js`
// (`WorkoutHeading` / `WorkoutSubheading`). No "creative" or opportunistic
// visual tweaks. Change Log-tab styling ONLY when the repo owner explicitly
// asks for that specific change.
//
// Authorized exceptions (#710), scoped to the routine-card headers in
// `components/LogActiveRoutineCard.js` and `components/LogPreviousRoutines.js`:
// `otherNoteHeader.alignItems` `'center'` -> `'flex-start'`; the action
// container's gap `8` -> `12`; layout-only containment props (`minWidth: 0`,
// `flexShrink: 1`, `flexWrap: 'wrap'`, `justifyContent: 'flex-end'`);
// `minHeight: 44` / `justifyContent: 'center'` on `inlineSwitchButton`; and
// `numberOfLines={2}` / `ellipsizeMode="tail"` on the title `Text`.
//
// Authorized exceptions (#711), which relocates controls without restyling
// them: the header action containers are deleted outright; the active card's
// former `editHintRow` becomes `actionStrip` and gains `flexWrap: 'wrap'` +
// `gap: 12`, with a `gap: 12` `actionStripPrimary` row inside it; the
// non-current card's expanded body gains a `gap: 12` `viewActions` row for the
// relocated Week A/B pill. Every relocated control keeps its existing style
// object. No other styling exception is authorized.

import React, { useState, useEffect, useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { LogEmptyState } from '../components/LogEmptyState';
import { ScreenShell } from '../components/ScreenShell';
import { ErrorBanner } from '../components/UI';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { normalizeLiftName, listTrackedLifts } from '../lib/data';
import { DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import { findLiveMembershipForNote, nextWeekNumber } from '../lib/data/recoveryBlocks';
import {
  useTrackedLifts,
  useWorkoutNotes,
  useDeloadNote,
  useDeloadHistory,
  useFeatureToggles,
  useRecoveryBlockState,
  useStartRecoveryBlock,
  isEligibleBaselineNote,
  isEligibleRecoveryWeekNote,
} from '../hooks/useEntries';
import { useRecoveryBlockLifecycle, ensureVerifiedRecoveryState } from '../hooks/entries/recoveryBlockHooks';

import { LogDeloadSection } from '../components/LogDeloadSection';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';
import { RecoveryBlockStartModal } from '../components/RecoveryBlockStartModal';
import { RecoveryBlockWeekModal } from '../components/RecoveryBlockWeekModal';
import { LogRecoverySection } from '../components/LogRecoverySection';

import { useLogCurrentRoutineEditor } from './log/useLogCurrentRoutineEditor';
import { useLogOtherRoutineEditor } from './log/useLogOtherRoutineEditor';
import { useLogDeloadEditor } from './log/useLogDeloadEditor';

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
  isActive,
  registerBackConsumer,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { notes, currentId, currentNote, deloadNotes, loading: notesLoading, error: notesError, refresh: refreshNotes, selectCurrent, update, add, remove } = useWorkoutNotes();
  const { trackedLifts, toggle: toggleTrackedLift } = useTrackedLifts();
  const { note: deloadNote, loading: deloadLoading, save: saveDeloadNote, clear: clearDeloadNote } = useDeloadNote();
  const { history: deloadHistory, completeDeload, deleteDeload, deleteDeloadNote, updateDeload } = useDeloadHistory();
  const { fatigueTrackingEnabled, deloadModeEnabled } = useFeatureToggles();

  // Recovery Block start flow (#695). Guarded with `|| {}`/`|| {}` because
  // every other screen test mocks the whole `useEntries` module and most of
  // them never set a return value for these two hooks; an automocked jest.fn()
  // resolves to undefined, which must not crash the screen — it simply means
  // no active block and no eligible actions render.
  const {
    activeBlock: activeRecoveryBlock = null,
    blocks: recoveryBlocks = [],
    weeks: recoveryWeeks = [],
    recoveryWeekNumberByNoteId = {},
    refresh: refreshRecoveryState,
    // Journaled lifecycle operations that are not yet verified (#696), plus the
    // single shared reconciler behind the `Retry recovery` affordance.
    pendingRecovery = [],
    recoveryPendingError = null,
    retryRecovery,
    // Explicit authoritative-state contract (#716). `recoveryReady` is the only
    // thing that makes an empty `recoveryBlocks` mean "no recovery blocks":
    // until it is true the arrays are placeholders, not a verified result.
    ready: recoveryReady = true,
    loading: recoveryLoading = false,
    refreshing: recoveryRefreshing = false,
    stale: recoveryStale = false,
    error: recoveryStateError = null,
    mutationsAllowed: recoveryMutationsAllowed = true,
  } = useRecoveryBlockState() || {};
  const { startBlock: startRecoveryBlock } = useStartRecoveryBlock() || {};
  const recoveryLifecycle = useRecoveryBlockLifecycle() || {};
  const [recoveryModal, setRecoveryModal] = useState(null); // { mode: 'routine'|'note', note } | null
  const [addWeekModalOpen, setAddWeekModalOpen] = useState(false);

  // Single lifecycle mutex (#696 review): null | 'week' | 'block' | 'add' |
  // 'delete-unlink' | a week id being unlinked. Every recovery-block write —
  // including the Add Week modal's own confirm, which lives in a sibling
  // component with no visibility into LogRecoverySection's own state — is
  // serialized behind this one flag. A second attempt while one is in flight
  // (double tap, or one action racing another) is rejected outright with a
  // clear error rather than reading stale state and writing under a block or
  // week that changed underneath it.
  const [recoveryActionBusy, setRecoveryActionBusy] = useState(null);
  // The ref — not the state — IS the mutex. React state is not a same-tick lock:
  // two confirms dispatched before the next render both read the captured
  // `recoveryActionBusy === null` and both proceed. The ref is written and read
  // synchronously, so the second attempt is rejected in the same tick. The state
  // exists only to drive the disabled/busy rendering, and the journal's own
  // single-flight queue remains the durable backstop underneath both.
  const recoveryActionLockRef = useRef(null);
  const runRecoveryAction = async (key, action) => {
    if (recoveryActionLockRef.current) {
      return { ok: false, error: 'Another recovery action is already in progress.' };
    }
    recoveryActionLockRef.current = key;
    setRecoveryActionBusy(key);
    try {
      return await action();
    } finally {
      recoveryActionLockRef.current = null;
      setRecoveryActionBusy(null);
    }
  };

  // Bound to useLogOtherRoutineEditor's `remove` param below (not the raw
  // hook value): the only call site for note removal is inside the standard
  // "Delete Routine" alert's own "Delete" onPress (see guardedHandleDeleteRoutine
  // further down), so unlinking a recovery-week note happens exactly once,
  // together with the removal it guards, never before that final confirm.
  //
  // The note delete is NOT injected as a callback any more (#696). A callback
  // that persists the removal and then throws is indistinguishable from one
  // that never committed, so the journaled operation owns the deletion end to
  // end and decides the outcome from persisted state. It still runs the same
  // local/cloud-sync-aware storage path this screen's `remove` uses — the
  // registration in hooks/entries/storageMode.js — so nothing is bypassed; the
  // notebook is simply reloaded afterwards instead of being notified by the
  // callback.
  const removeNoteWithRecoveryUnlink = async (id) => {
    const result = await runRecoveryAction('delete-unlink', async () => {
      if (!recoveryLifecycle.unlinkNoteForDelete) {
        await remove(id);
        return { ok: true, week: null };
      }
      return recoveryLifecycle.unlinkNoteForDelete({ noteId: id });
    });
    if (!result.ok) {
      Alert.alert('Could not delete this note', result.error || 'Could not delete this note.');
      throw new Error(result.error || 'Could not delete this note.');
    }
    refreshNotes?.();
    if (result.week) refreshRecoveryState?.();
  };

  const [tabView, setTabView] = useState('routine'); // 'routine' | 'deload'

  const editorScrollRef = useRef(null);
  const readScrollRef = useRef(null);

  const currentEditor = useLogCurrentRoutineEditor({
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
  });

  const deloadEditor = useLogDeloadEditor({
    deloadNote,
    saveDeloadNote,
    workoutNoteText,
    editorScrollRef,
  });

  const otherEditor = useLogOtherRoutineEditor({
    notes,
    currentId,
    currentNote,
    deloadHistory,
    update,
    add,
    remove: removeNoteWithRecoveryUnlink,
    selectCurrent,
    updateDeload,
    deleteDeloadNote,
    deloadDateEditEnabled,
    autosaveCurrentTimerRef: currentEditor.autosaveCurrentTimerRef,
    handleSave: currentEditor.handleSave,
    currentEditorMode: currentEditor.mode,
    hasUnsavedCurrent: currentEditor.hasUnsavedCurrent,
    editorScrollRef,
  });

  const handleAndroidBack = () => {
    if (deloadEditor.deloadMode === 'edit') {
      deloadEditor.handleDoneDeload();
      return true;
    }
    if (otherEditor.editingNoteId) {
      otherEditor.handleDoneOther();
      return true;
    }
    if (otherEditor.viewingNoteId) {
      otherEditor.setViewingNoteId(null);
      return true;
    }
    if (currentEditor.mode === 'edit') {
      currentEditor.handleDoneCurrent();
      return true;
    }
    return false;
  };
  const handleAndroidBackRef = useRef(handleAndroidBack);
  handleAndroidBackRef.current = handleAndroidBack;

  // Register with the app shell instead of BackHandler directly (#527): all tab
  // screens stay mounted under display:none, so a direct BackHandler listener here
  // would keep consuming Back even while another tab is active. Gating on isActive
  // ensures only the visible tab's editor/viewer state can intercept Back, and the
  // shell falls back to Home when handleAndroidBack finds nothing to consume.
  useEffect(() => {
    if (!isActive) return undefined;
    return registerBackConsumer?.(() => handleAndroidBackRef.current());
  }, [isActive, otherEditor.editingNoteId, otherEditor.viewingNoteId, currentEditor.mode, deloadEditor.deloadMode, registerBackConsumer]);

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

  const recoveryBlockingMessage = activeRecoveryBlock
    ? `A recovery block baselined from "${activeRecoveryBlock.baseline_note_title || 'Untitled Routine'}" is already active. Complete or delete it before starting another.`
    : null;

  // The one recovery entry point (#711), opened from LogRecoverySection with no
  // subject: `presetNote: null` makes RecoveryBlockStartModal render its own
  // baseline and Week 1 pickers over the same eligible collections it already
  // receives, and both paths reach the unchanged handleConfirmRecoveryBlock.
  // Deliberately NOT the old per-card opener, which returns early without a
  // note — the preset-note modal contract itself is untouched and still
  // supported, it simply has no per-card caller left on this screen.
  const openStartRecoveryBlock = () => setRecoveryModal({ mode: 'routine', note: null });
  const closeRecoveryModal = () => setRecoveryModal(null);

  const handleConfirmRecoveryBlock = async ({ baselineNoteId, weekChoice, weekNoteId, newNoteTitle }) => {
    if (!startRecoveryBlock) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    const baselineNote = notes.find(n => n.id === baselineNoteId);
    if (!baselineNote) {
      return { ok: false, error: 'Select a baseline routine first.' };
    }
    // Recheck the authoritative mutation precondition BEFORE any write —
    // including the new-note creation below. The confirm modal can sit open
    // long enough for the verified snapshot to go stale or the journal to turn
    // corrupt, and rejection must happen before a note is persisted, not after
    // (best-effort rollback is not equivalent to never having written it)
    // (#711 review finding 3).
    const precondition = await ensureVerifiedRecoveryState();
    if (!precondition.ok) return precondition;
    let finalWeekNoteId = weekNoteId;
    let createdNoteId = null;
    if (weekChoice === 'new') {
      const created = await add(newNoteTitle, '');
      finalWeekNoteId = created?.id;
      createdNoteId = created?.id || null;
    }
    if (!finalWeekNoteId) {
      return { ok: false, error: 'Select or create a note for Recovery Week 1.' };
    }
    const result = await startRecoveryBlock({
      baselineNoteId: baselineNote.id,
      baselineNoteTitle: baselineNote.title || null,
      baselineNoteText: baselineNote.raw_text || '',
      weekNoteId: finalWeekNoteId,
    });
    if (result?.ok) {
      refreshRecoveryState?.();
      return result;
    }
    // New-note path: the note itself was persisted before the block/week
    // writes were attempted. A failure here (active block appeared mid-flow,
    // Week-1 storage error) must not leave that note behind as an orphan
    // routine — "no partial changes" covers the note it created, too.
    if (createdNoteId) {
      try {
        await remove(createdNoteId);
      } catch (_rollbackError) {
        // Best-effort: the original failure is what the caller needs to see.
      }
    }
    return result;
  };

  // Week 2+ lifecycle (#696). Each wrapper delegates the actual mutation to
  // hooks/entries/recoveryBlockHooks.js (which already enforces sequential
  // completion and the latest-week-only unlink restriction) and only adds the
  // Log-screen-local refresh/rollback glue.
  const openAddWeekModal = () => setAddWeekModalOpen(true);
  const closeAddWeekModal = () => setAddWeekModalOpen(false);

  // Two distinct operations, deliberately.
  //
  // Attaching an EXISTING note touches one collection, so it stays a plain
  // single-domain action. Creating a new note AND attaching it touches two, so it
  // is a durable journaled operation (addRecoveryWeekWithNewNoteCore): the note id
  // and the week ordinal are minted once inside the journal lock and recorded on
  // the intent before anything is written. This screen no longer creates the note
  // itself, and there is no best-effort rollback delete left to fail — a failed
  // attempt leaves a journaled intent that replay finishes instead of an untracked
  // orphan note.
  const handleConfirmAddWeek = ({ weekChoice, weekNoteId, newNoteTitle }) => runRecoveryAction('add', async () => {
    if (!activeRecoveryBlock) {
      return { ok: false, error: 'No active recovery block to add a week to.' };
    }
    if (weekChoice === 'new') {
      if (!recoveryLifecycle.addWeekWithNewNote) {
        return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
      }
      const result = await recoveryLifecycle.addWeekWithNewNote({
        blockId: activeRecoveryBlock.id,
        title: newNoteTitle,
      });
      if (result?.ok) {
        refreshRecoveryState?.();
        refreshNotes?.();
      }
      return result;
    }
    if (!recoveryLifecycle.addWeek) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    if (!weekNoteId) {
      return { ok: false, error: 'Select or create a note for this recovery week.' };
    }
    const result = await recoveryLifecycle.addWeek({
      blockId: activeRecoveryBlock.id,
      noteId: weekNoteId,
    });
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

  const handleCompleteCurrentWeek = (params) => runRecoveryAction('week', async () => {
    if (!recoveryLifecycle.completeCurrentWeek) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.completeCurrentWeek(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

  const handleCompleteRecoveryBlock = (params) => runRecoveryAction('block', async () => {
    if (!recoveryLifecycle.completeBlock) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.completeBlock(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

  const handleUnlinkRecoveryWeek = (params) => runRecoveryAction(params.weekId, async () => {
    if (!recoveryLifecycle.unlinkWeek) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.unlinkWeek(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

  // The `Retry recovery` affordance. It runs the same idempotent reconciler as
  // app start, remount, and the cloud sync boundary — never a separate repair
  // path — and then refreshes both the workout-note and recovery views so a
  // successful reconciliation clears the warning.
  const handleRetryRecovery = () => runRecoveryAction('retry-recovery', async () => {
    if (!recoveryLifecycle.retryRecovery) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    const result = await recoveryLifecycle.retryRecovery();
    await Promise.resolve(refreshRecoveryState?.());
    refreshNotes?.();
    return result;
  });

  const handleViewRecoveryNote = (note) => {
    if (!note || note.id === currentId) return;
    otherEditor.handleViewOtherNote(note);
  };

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

  const handleToggleTrack = async (name) => {
    const key = normalizeLiftName(name);
    await toggleTrackedLift(key);
  };

  const headerRight = !otherEditor.editingNoteId && hasContent && currentEditor.mode === 'edit' && (
    <Pressable
      onPress={currentEditor.handleDoneCurrent}
      style={styles.modeToggle}
    >
      <Text style={styles.modeToggleText}>
        Done
      </Text>
    </Pressable>
  );

  const isEmpty = !notesLoading && notes.length === 0;
  const isEditing = !!otherEditor.editingNoteId || currentEditor.mode === 'edit' || deloadEditor.deloadMode === 'edit';

  const effectiveTabView = deloadModeEnabled ? tabView : 'routine';

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

  return (
    <>
      <ScreenShell
        ref={readScrollRef}
        onScroll={currentEditor.handleReadScroll}
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
          <LogEmptyState onCreateRoutine={otherEditor.handleCreateRoutine} />
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

            {effectiveTabView === 'deload' && (
              <LogDeloadSection
                deloadNote={deloadNote}
                deloadLoading={deloadLoading}
                deloadDayGroups={deloadEditor.deloadDayGroups}
                enterDeloadEditor={deloadEditor.enterDeloadEditor}
                handleDeloadBodyPress={deloadEditor.handleDeloadBodyPress}
                deloadMode={deloadEditor.deloadMode}
                completeDeload={completeDeload}
                clearDeloadNote={clearDeloadNote}
                handleGenerateDeload={deloadEditor.handleGenerateDeload}
                isGenerating={deloadEditor.isGenerating}
                workoutNoteText={workoutNoteText}
                saveError={activeSaveError}
                deloadNotes={deloadNotes}
                deloadHistory={deloadHistory}
                deleteDeloadNote={deleteDeloadNote}
                deleteDeload={deleteDeload}
                viewingNoteId={otherEditor.viewingNoteId}
                handleViewOtherNote={otherEditor.handleViewOtherNote}
                viewingNote={otherEditor.viewingNote}
                viewingNoteDayGroups={otherEditor.viewingNoteDayGroups}
                handleOpenOtherNote={otherEditor.handleOpenOtherNote}
                logSessionCount={currentEditor.logSessionCount}
              />
            )}

            {effectiveTabView === 'routine' && currentEditor.mode === 'read' && hasContent && (
              <LogActiveRoutineCard
                workoutNoteTitle={workoutNoteTitle}
                hasABWeeks={currentEditor.hasABWeeks}
                effectiveActiveWeek={currentEditor.effectiveActiveWeek}
                handleToggleWeek={currentEditor.handleToggleWeek}
                enterCurrentEditor={currentEditor.enterCurrentEditor}
                handleNoteBodyPress={currentEditor.handleNoteBodyPress}
                handleSkipWeek={currentEditor.handleSkipWeek}
                handleUnskipWeek={currentEditor.handleUnskipWeek}
                canUnskipWeek={currentEditor.canUnskipWeek}
                skipWeekStatus={currentEditor.skipWeekStatus}
                toggleCollapsed={toggleCollapsed}
                isCollapsed={isCollapsed}
                dayGroups={currentEditor.dayGroups}
                noteError={currentEditor.noteError}
                trackedLifts={trackedLifts}
                handleToggleTrack={handleToggleTrack}
                roughNoteId={currentEditor.roughNoteId}
                currentId={currentId}
                roughFlaggedNames={currentEditor.roughFlaggedNames}
                activeEditText={currentEditor.activeEditText}
                recoveryWeekNumber={currentRecoveryWeekNumber}
              />
            )}

            {effectiveTabView === 'routine' && (
              <LogRecoverySection
                blocks={recoveryBlocks}
                weeks={recoveryWeeks}
                notes={notes}
                onViewNote={handleViewRecoveryNote}
                onCompleteWeek={handleCompleteCurrentWeek}
                onOpenAddWeek={openAddWeekModal}
                onCompleteBlock={handleCompleteRecoveryBlock}
                onUnlinkWeek={handleUnlinkRecoveryWeek}
                busy={recoveryActionBusy}
                pendingRecovery={pendingRecovery}
                pendingRecoveryError={recoveryPendingError}
                onRetryRecovery={handleRetryRecovery}
                stateReady={recoveryReady}
                stateLoading={recoveryLoading}
                stateRefreshing={recoveryRefreshing}
                stateStale={recoveryStale}
                stateError={recoveryStateError}
                mutationsAllowed={recoveryMutationsAllowed}
                // Empty while a block is active, so the entry point is never
                // offered for a start that recoveryBlockingMessage would refuse.
                eligibleBaselineNotes={activeRecoveryBlock ? [] : eligibleBaselineNotes}
                onStartRecoveryBlock={openStartRecoveryBlock}
              />
            )}

            {effectiveTabView === 'routine' && (
              <LogPreviousRoutines
                otherNotes={otherNotes}
                handleViewOtherNote={otherEditor.handleViewOtherNote}
                viewingNoteId={otherEditor.viewingNoteId}
                viewingNote={otherEditor.viewingNote}
                viewingNoteDayGroups={otherEditor.viewingNoteDayGroups}
                viewingHasABWeeks={otherEditor.viewingHasABWeeks}
                viewingEffectiveWeek={otherEditor.viewingEffectiveWeek}
                handleToggleViewingWeek={otherEditor.handleToggleViewingWeek}
                handleSwitchCurrent={otherEditor.handleSwitchCurrent}
                handleEditViewedNote={otherEditor.handleEditViewedNote}
                handleDeleteRoutine={guardedHandleDeleteRoutine}
                handleCreateRoutine={otherEditor.handleCreateRoutine}
                recoveryWeekNumberByNoteId={recoveryWeekNumberByNoteId}
              />
            )}
          </>
        )}
      </ScreenShell>

      <ScreenShell
        ref={editorScrollRef}
        style={isEditing ? { flex: 1 } : { display: 'none' }}
        title={
          deloadEditor.deloadMode === 'edit' ? 'Deload Week' :
          (otherEditor.editingNoteId && otherEditor.isEditingDeloadNote) ? 'Deload record' :
          otherEditor.editingNoteId ? (otherEditor.editingTitle || 'Untitled Routine') :
          (workoutNoteTitle || 'Untitled Routine')
        }
        subtitle={
          deloadEditor.deloadMode === 'edit' ? 'Edit deload' :
          (otherEditor.editingNoteId && otherEditor.isEditingDeloadNote) ? 'Edit deload record' :
          'Edit routine'
        }
        headerRight={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {otherEditor.editingNoteId && otherEditor.editingHasABWeeks && (
              <Pressable
                onPress={otherEditor.handleToggleEditingWeek}
                style={[styles.modeToggle, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.cardBorder, marginRight: 8 }]}
                accessibilityRole="button"
                accessibilityLabel={`Switch to Week ${otherEditor.editingEffectiveWeek === 'B' ? 'A' : 'B'}`}
                accessibilityState={{ selected: otherEditor.editingEffectiveWeek === 'B' }}
              >
                <Text style={[styles.modeToggleText, { color: colors.accent }]}>
                  Week {otherEditor.editingEffectiveWeek === 'B' ? 'A' : 'B'}
                </Text>
              </Pressable>
            )}
            {otherEditor.editingNoteId && otherEditor.editingHasABWeeks && (
              <Pressable
                onPress={otherEditor.handleMergeEditingWeeks}
                style={[styles.modeToggle, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.cardBorder, marginRight: 8 }]}
                accessibilityRole="button"
                accessibilityLabel="Merge Week A and Week B into one routine"
              >
                <Text style={[styles.modeToggleText, { color: colors.textMuted, fontWeight: '500' }]}>Merge weeks</Text>
              </Pressable>
            )}
            <Pressable
              onPress={
                deloadEditor.deloadMode === 'edit' ? deloadEditor.handleUndoDeload :
                otherEditor.editingNoteId ? otherEditor.handleUndoOther :
                currentEditor.handleUndoCurrent
              }
              style={[styles.modeToggle, { backgroundColor: 'transparent', marginRight: 8 }]}
              accessibilityLabel="Undo"
              accessibilityRole="button"
            >
              <Text style={[styles.modeToggleText, { color: colors.textMuted, fontWeight: '500' }]}>Undo</Text>
            </Pressable>
            <Pressable
              onPress={
                deloadEditor.deloadMode === 'edit' ? deloadEditor.handleDoneDeload :
                otherEditor.editingNoteId ? otherEditor.handleDoneOther :
                currentEditor.handleDoneCurrent
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
        <LogScreenEditorCard
          deloadMode={deloadEditor.deloadMode}
          deloadEditText={deloadEditor.deloadEditText}
          setDeloadEditText={deloadEditor.setDeloadEditText}
          handleSaveDeload={deloadEditor.handleSaveDeload}
          isSaving={activeIsSaving}
          saveSuccess={activeSaveSuccess}
          editingNoteId={otherEditor.editingNoteId}
          isEditingDeloadNote={otherEditor.isEditingDeloadNote}
          editingTitle={otherEditor.editingTitle}
          setEditingTitle={otherEditor.setEditingTitle}
          workoutNoteTitle={workoutNoteTitle}
          setWorkoutNoteTitle={setWorkoutNoteTitle}
          deloadDateEditEnabled={deloadDateEditEnabled}
          editingDeloadHasLinkedRecord={otherEditor.editingDeloadHasLinkedRecord}
          setShowDeloadDatePicker={otherEditor.setShowDeloadDatePicker}
          deloadEditDate={otherEditor.deloadEditDate}
          deloadEditOrdinal={otherEditor.deloadEditOrdinal}
          setDeloadEditOrdinal={otherEditor.setDeloadEditOrdinal}
          showDeloadDatePicker={otherEditor.showDeloadDatePicker}
          editingNote={otherEditor.editingNote}
          setDeloadEditDate={otherEditor.setDeloadEditDate}
          editingText={otherEditor.editingText}
          setEditingText={otherEditor.setEditingText}
          activeEditText={currentEditor.activeEditText}
          handleCurrentTextChange={currentEditor.handleCurrentTextChange}
          handleSaveOtherNote={otherEditor.handleSaveOtherNote}
          handleSave={currentEditor.handleSave}
          noteIsSaving={otherEditor.noteIsSaving}
          handleSwitchCurrent={otherEditor.handleSwitchCurrent}
          handleDeleteDeloadNoteFromEditor={otherEditor.handleDeleteDeloadNoteFromEditor}
          handleDeleteRoutine={guardedHandleDeleteRoutine}
          currentId={currentId}
        />
      </ScreenShell>
      <SessionCheckInModal
        visible={currentEditor.showCheckInModal}
        checkInData={currentEditor.roughCheckInData}
        currentId={currentEditor.roughNoteId}
        currentNote={currentNote}
        update={update}
        onClose={() => currentEditor.setShowCheckInModal(false)}
      />
      <RecoveryBlockStartModal
        visible={!!recoveryModal}
        mode={recoveryModal?.mode}
        presetNote={recoveryModal?.note}
        eligibleBaselineNotes={eligibleBaselineNotes}
        eligibleWeekNotes={eligibleWeekNotes}
        blockingMessage={recoveryBlockingMessage}
        onConfirm={handleConfirmRecoveryBlock}
        onClose={closeRecoveryModal}
      />
      <RecoveryBlockWeekModal
        visible={addWeekModalOpen}
        weekNumber={activeRecoveryBlock ? nextWeekNumber(recoveryWeeks, activeRecoveryBlock.id) : null}
        eligibleWeekNotes={eligibleWeekNotes}
        blockingMessage={
          !activeRecoveryBlock
            ? 'No active recovery block to add a week to.'
            : (recoveryActionBusy ? 'Another recovery action is already in progress.' : null)
        }
        onConfirm={handleConfirmAddWeek}
        onClose={closeAddWeekModal}
      />
    </>
  );
}

const createStyles = (colors) => StyleSheet.create({
  modeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.chipBackground,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  tabToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: colors.chipBackground,
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
    backgroundColor: colors.accent,
  },
  tabToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.chipText,
  },
  tabToggleTextActive: {
    color: colors.onAccent,
  },
});
