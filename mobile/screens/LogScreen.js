// LOG TAB STYLE LOCK — the Log-tab visual style is intentionally fixed.
// The full style-lock notice, its authorized exceptions, and the `styles`
// block itself now live in `./log/logScreenStyles.js`; change Log-tab styling
// only as that file documents.

import React, { useContext, useState, useEffect, useRef, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Alert } from '../lib/platformAlert';
import { ScreenShell } from '../components/ScreenShell';
import { countWorkoutSessionsFromSections, parseWorkoutNote, normalizeExerciseKey } from '../lib/parser';
import {
  deriveFirstUseState,
  pickAdoptableRoutine,
  FIRST_USE_S1,
} from '../lib/guidedEntry';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { normalizeLiftName, listTrackedLifts, deriveWorkoutNoteAnalytics } from '../lib/data';
import {
  hydrateProgressionSuggestionSettings,
  subscribeProgressionSuggestionSettings,
  getProgressionSuggestionSettings,
  setProgressionSuggestionMuted,
} from '../storage/entries/settings';
import {
  ProgressionSuggestionCard,
  MutedProgressionRow,
  isRenderableProgressionSuggestion,
  progressionSuggestionInstanceId,
} from '../components/ProgressionSuggestionCard';
import { DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import { findLiveMembershipForNote, nextWeekNumber, orderedLiveWeeks } from '../lib/data/recoveryBlocks';
import { compareRecoveryBlocksNewestCompletedFirst } from '../storage/entries/recoveryStorage';
import {
  useTrackedLifts,
  useWorkoutNotes,
  useDeloadNote,
  useDeloadHistory,
  useFeatureToggles,
  useRecoveryBlockState,
  useStartRecoveryBlock,
  useActiveTrainingContext,
  isEligibleBaselineNote,
  isEligibleRecoveryWeekNote,
} from '../hooks/useEntries';
import { useRecoveryBlockLifecycle } from '../hooks/entries/recoveryBlockHooks';
import { buildRecoveryAnalyticsFilter } from '../lib/data/recoveryAnalyticsFilter';

// #1021: the New Routine editor's secondary Import routine action opens this
// same preview MoreScreen already uses — reused in place, not duplicated.
import { RoutineImportScreen } from '../components/RoutineImportScreen';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { LogScreenEditorCard } from '../components/LogScreenEditorCard';
import { RecoveryBlockStartModal } from '../components/RecoveryBlockStartModal';
import { RecoveryBlockWeekModal } from '../components/RecoveryBlockWeekModal';
import { RecoveryBlockEndModal } from '../components/RecoveryBlockEndModal';
import { RestTimerBanner } from '../components/RestTimerBanner';
import { PRMomentBanner } from '../components/PRMomentBanner';
import { TabBarLayoutContext, TAB_BAR_VISUAL_GAP } from '../components/TabBarLayout';

import { useLogCurrentRoutineEditor } from './log/useLogCurrentRoutineEditor';
import { useLogOtherRoutineEditor } from './log/useLogOtherRoutineEditor';
import { useLogDeloadEditor } from './log/useLogDeloadEditor';
import { createStyles } from './log/logScreenStyles';
import { LogScreenContent, buildLogRecovery, EditorHeaderActions } from './log/LogScreenContent';
import { useLogScreenController } from './log/LogScreenStates';

export function LogScreen({
  workoutNoteText,
  setWorkoutNoteText,
  workoutNoteTitle,
  setWorkoutNoteTitle,
  isCollapsed,
  toggleCollapsed,
  onSaveWorkout,
  onCheckInPrompt,
  isActive,
  registerBackConsumer,
  navNoteId = null,
  navNoteKey = 0,
  navRecoveryNoteId = null,
  navRecoveryKey = 0,
  restTimerIsRunning = false,
  restTimerRemainingMs = 0,
  restTimerJustElapsed = false,
  restTimerBackgroundAlertAvailable = true,
  onStartRestTimer,
  onCancelRestTimer,
  onDismissRestTimerDone,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { bottom: bottomInset = 0 } = useContext(SafeAreaInsetsContext) || {};
  const { tabBarHeight } = useContext(TabBarLayoutContext);
  const bottomBannerClearance = tabBarHeight + TAB_BAR_VISUAL_GAP + bottomInset;
  const { notes, currentId, currentNote, deloadNotes, loading: notesLoading, error: notesError, refresh: refreshNotes, selectCurrent, update, add, remove } = useWorkoutNotes();
  const { trackedLifts, activations: trackedLiftActivations, toggle: toggleTrackedLift, reconcileActivations: reconcileTrackedLiftActivations } = useTrackedLifts();
  const { note: deloadNote, loading: deloadLoading, save: saveDeloadNote, clear: clearDeloadNote } = useDeloadNote();
  const { history: deloadHistory, completeDeload, deleteDeload, deleteDeloadNote, updateDeload } = useDeloadHistory();
  const { fatigueTrackingEnabled, deloadModeEnabled } = useFeatureToggles();

  // Progression-suggestion UI state (#960). The global flag and the per-exercise
  // mute set are read from the settings store's synchronous cache and kept live
  // through its subscription, so a toggle or mute made on another mounted tab
  // takes effect here without a remount. Dismissal is transient and
  // surface-local: it lives only in this component's state, is keyed on the
  // suggestion instance id, and is never written to storage.
  const [progressionSettings, setProgressionSettings] = useState(getProgressionSuggestionSettings);
  const [dismissedProgressionIds, setDismissedProgressionIds] = useState(() => new Set());
  useEffect(() => {
    let active = true;
    hydrateProgressionSuggestionSettings().catch(() => {});
    const unsubscribe = subscribeProgressionSuggestionSettings((next) => {
      if (active) setProgressionSettings(next);
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  // A fresh read whenever the Log tab becomes active, in case a write happened
  // while this tab was backgrounded and the notification was missed.
  useEffect(() => {
    if (isActive) hydrateProgressionSuggestionSettings({ force: true }).catch(() => {});
  }, [isActive]);

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

  // #960: the same authoritative Recovery/normal-analytics boundary Analytics
  // derives from, built from the snapshot this screen already subscribes to (no
  // extra hook / storage read). A completed Recovery block that opted out of
  // ordinary analytics keeps its linked week notes out of Log's suggestion
  // history, and an unverified boundary (`recoveryReady` still false) holds the
  // suggestions back rather than deriving from a provisional population.
  const progressionRecoveryFilter = useMemo(
    () => buildRecoveryAnalyticsFilter(recoveryBlocks, recoveryWeeks, { ready: recoveryReady }),
    [recoveryBlocks, recoveryWeeks, recoveryReady],
  );
  // Product-wide "what am I training now?" context (#868), shared verbatim
  // with Home and Analytics — same authoritative Recovery snapshot as above,
  // resolved at this screen's existing Recovery-state boundary.
  // `|| {}` for the same reason every other Recovery-adjacent hook on this
  // screen guards its return value: most Log-tab tests mock the whole
  // `useEntries` module and never configure this hook's return, so an
  // automocked `jest.fn()` resolving to `undefined` must not crash the
  // screen — it simply means no derived training-context fields are used.
  const activeTrainingContext = useActiveTrainingContext({ currentId, notes }) || {};
  // #870: while an active Recovery block has paused the stored baseline
  // routine, Deload is no longer offered as a peer live-training mode next
  // to it — Deload targets the SAME baseline note the block is standing in
  // for, and presenting it as an equal third tab would let a user land on a
  // second, competing "current training" surface while Recovery already owns
  // that role. `activeTrainingContext.baselinePaused` is the exact same
  // predicate Home already gates its own baseline-paused hierarchy on.
  const baselinePaused = !!activeTrainingContext.baselinePaused;
  // #870 review fix: `baselinePaused` describes the Recovery block globally —
  // it stays true even when Recovery was started from (or the user has since
  // switched to) a saved routine other than the one this block paused. The
  // Routine-tab card, however, always renders `currentId`'s note, so it must
  // only wear the "paused" label when `currentId` IS the exact routine the
  // active block is standing in for. Anything else is an unrelated current
  // routine and must keep its ordinary "Current routine" identity.
  const currentIsPausedBaseline = baselinePaused && currentId != null && currentId === activeTrainingContext.baselineNoteId;
  const { startBlock: startRecoveryBlock } = useStartRecoveryBlock() || {};
  const recoveryLifecycle = useRecoveryBlockLifecycle() || {};
  const [recoveryModal, setRecoveryModal] = useState(null); // { mode: 'routine'|'note', note } | null
  const [addWeekModalOpen, setAddWeekModalOpen] = useState(false);
  // The only new persisted-in-render state this redesign adds (#843): whether
  // `RecoveryBlockEndModal` is open. Everything else the modal needs
  // (`pendingInclusion`, `submitting`, `submitError`) is local to the modal
  // itself.
  const [endBlockModalOpen, setEndBlockModalOpen] = useState(false);
  // #1021: the New Routine editor's secondary Import routine action. Opens
  // the existing `RoutineImportScreen` in place of the read/editor pair
  // below; closing it (its own Back) returns here without touching any
  // editor state.
  const [importRoutineOpen, setImportRoutineOpen] = useState(false);

  // Deload's own disclosure is owned here (#775), not by the section that
  // renders it: LogDeloadSection unmounts on every view switch, and while the
  // state lived in that component a user's collapse choice was discarded by
  // the remount and the card came back in its default state.
  const [deloadCardCollapsed, setDeloadCardCollapsed] = useState(false);

  // #1021: a navigation intent that targets a non-current routine no longer
  // needs a "reveal the disclosure" step — LogPreviousRoutines has none left
  // to open. `otherEditor.setViewingNoteId` below is sufficient on its own.

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

  const [tabView, setTabView] = useState('routine'); // 'routine' | 'deload' | 'recovery'

  // Recovery becomes its own tab (#823). Present whenever `LogRecoverySection`
  // itself has anything to show — not just an active block, but also a
  // pending/in-flight recovery operation, a stale snapshot with NO active
  // block, or a terminal INITIAL-load failure (`!recoveryReady` with a real
  // error, as opposed to still-loading), all of which the component already
  // renders a banner/retry for (see its own early-return contract). Mirroring
  // that condition here, rather than narrowing to `activeRecoveryBlock`
  // alone, is what keeps those banners from becoming unreachable once
  // Recovery is a separate tab instead of an always-mounted section of the
  // Routine tab.
  const recoveryTabVisible = !!activeRecoveryBlock
    || (pendingRecovery?.length || 0) > 0
    || !!recoveryPendingError
    || recoveryStale
    || (!recoveryReady && !!recoveryStateError);

  const editorScrollRef = useRef(null);
  const readScrollRef = useRef(null);

  // Modal ownership (D10 §3.4). There is no ownership manager: the check-in,
  // the recovery-block modal and the add-week modal are sibling <Modal>s each
  // driven by its own `visible` prop, so ownership is a derived predicate over
  // the state those two already keep, not a new mechanism.
  const otherModalOwnsScreen = !!recoveryModal || addWeekModalOpen || endBlockModalOpen;

  const currentEditor = useLogCurrentRoutineEditor({
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
  });

  const deloadEditor = useLogDeloadEditor({
    deloadNote,
    saveDeloadNote,
    workoutNoteText,
    editorScrollRef,
    // #989: the stable current-routine id, so a generated deload freezes its
    // working-weight snapshot keyed to the routine it was built from.
    currentId,
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
    autosaveCurrentTimerRef: currentEditor.autosaveCurrentTimerRef,
    handleSave: currentEditor.handleSave,
    currentEditorMode: currentEditor.mode,
    hasUnsavedCurrent: currentEditor.hasUnsavedCurrent,
    editorScrollRef,
  });

  const handleAndroidBack = () => {
    // #1021 feedback: the import preview (opened from the New Routine editor's
    // Import routine action) must dismiss on Back before any draft-save/close
    // logic runs, otherwise Back would save/close the underlying draft note
    // while the preview stays on screen and the draft's unsaved state is lost.
    if (importRoutineOpen) {
      setImportRoutineOpen(false);
      return true;
    }
    if (deloadEditor.deloadMode === 'edit') {
      deloadEditor.handleDoneDeload();
      return true;
    }
    if (otherEditor.editingNoteId) {
      otherEditor.handleDoneOther();
      return true;
    }
    // Recovery's expanded note collapses on Back too (#836), same as the
    // Routine-tab viewer below — but each only while ITS OWN tab is actually
    // on screen. The two viewers are independent, so a note left expanded on
    // one tab must not make Back silently consume the event (and stay put)
    // while the other tab is showing (review finding): Routine and Deload
    // both read off `otherEditor.viewingNoteId`, so that check is gated on
    // every tab except Recovery, symmetric to the Recovery gate above it.
    if (tabView === 'recovery' && otherEditor.recoveryViewingNoteId) {
      otherEditor.setRecoveryViewingNoteId(null);
      return true;
    }
    if (tabView !== 'recovery' && otherEditor.viewingNoteId) {
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
  }, [isActive, importRoutineOpen, otherEditor.editingNoteId, otherEditor.viewingNoteId, otherEditor.recoveryViewingNoteId, tabView, currentEditor.mode, deloadEditor.deloadMode, registerBackConsumer]);

  // #1054 split: the Log tab's post-editor orchestration moves into a same-fiber
  // controller hook (screen state, navigation intents, progression) and a pure
  // recovery-action builder, both driven off the state owned here. Nothing about
  // what mounts or resets changes — the hooks still run in this component's fiber.
  const screen = {
    navNoteKey, navNoteId, navRecoveryKey, navRecoveryNoteId, notesLoading, notesError,
    notes, currentId, currentNote, isActive, registerBackConsumer, workoutNoteText,
    workoutNoteTitle, setWorkoutNoteTitle,
    recoveryWeekNumberByNoteId, recoveryBlocks, recoveryWeeks, recoveryReady, recoveryTabVisible, activeTrainingContext,
    deloadModeEnabled, baselinePaused, trackedLifts, trackedLiftActivations, toggleTrackedLift, deloadHistory,
    progressionRecoveryFilter, progressionSettings, dismissedProgressionIds, setDismissedProgressionIds, importRoutineOpen, setImportRoutineOpen,
    tabView, setTabView, currentEditor, otherEditor, deloadEditor, activeRecoveryBlock,
    recoveryStale, recoveryActionBusy, pendingRecovery, recoveryMutationsAllowed, startRecoveryBlock, recoveryLifecycle,
    refreshRecoveryState, refreshNotes, runRecoveryAction, add, remove, setRecoveryModal,
    setAddWeekModalOpen, setEndBlockModalOpen,
  };
  const {
    otherNotes, hasContent, eligibleBaselineNotes, eligibleWeekNotes, currentRecoveryWeekNumber, visibleProgressionSuggestions,
    mutedProgressionRows, handleMuteProgression, handleUnmuteProgression, handleDismissProgression, handleToggleTrack, isNotesFirstLoad,
    isEmpty, isEditing, recoveryInlineEditActive, handleTabViewChange, deloadTabEnabled, effectiveTabView,
    adoptableRoutine, handleCreateRoutineEntry, activeSaveError, activeSaveSuccess, activeIsSaving, activeSaveStatus,
    activeEditorInteraction, editorCardProps, guardedHandleDeleteRoutine,
  } = useLogScreenController(screen);
  const {
    recoveryBlockingMessage, openStartRecoveryBlock, closeRecoveryModal, showRecoveryStartInManagement, newestCompletedRecoveryBlock, showRecoveryReopenInManagement,
    handleConfirmRecoveryBlock, openAddWeekModal, closeAddWeekModal, handleConfirmAddWeek, handleCompleteCurrentWeek, handleCompleteRecoveryBlock,
    handleSetRecoveryInclusionFromEndModal, openEndBlockModal, closeEndBlockModal, handleReopenRecoveryBlock, openReopenRecoveryBlockConfirm, handleUnlinkRecoveryWeek,
    handleRetryRecovery, handleUndoCompleteWeek,
  } = buildLogRecovery({ ...screen, eligibleBaselineNotes, eligibleWeekNotes });

  // #1021: the New Routine editor's secondary Import routine action opens
  // this in place of the ordinary read/editor pair below. `add` is the same
  // note-store write the import preview is wired to everywhere else
  // (App.js's `handleCreateRoutineFromImport`) — it creates a note and never
  // touches the current-routine pointer, so importing here can neither
  // replace what is being trained on nor edit an existing routine.
  if (importRoutineOpen) {
    return (
      <RoutineImportScreen
        onBack={() => setImportRoutineOpen(false)}
        onCreateRoutine={(title, rawText, options) => add(title, rawText, options)}
      />
    );
  }

  const activeRoutineCard = (
    <LogActiveRoutineCard
      workoutNoteTitle={workoutNoteTitle} hasABWeeks={currentEditor.hasABWeeks} effectiveActiveWeek={currentEditor.effectiveActiveWeek}
      handleToggleWeek={currentEditor.handleToggleWeek} enterCurrentEditor={currentEditor.enterCurrentEditor} handleNoteBodyPress={currentEditor.handleNoteBodyPress}
      handleSkipWeek={currentEditor.isSaving ? undefined : currentEditor.handleSkipWeek} handleUnskipWeek={currentEditor.isSaving ? undefined : currentEditor.handleUnskipWeek} canUnskipWeek={currentEditor.canUnskipWeek}
      skipWeekStatus={currentEditor.skipWeekStatus} toggleCollapsed={toggleCollapsed} isCollapsed={isCollapsed}
      dayGroups={currentEditor.dayGroups} noteError={currentEditor.noteError} trackedLifts={trackedLifts}
      handleToggleTrack={handleToggleTrack} roughNoteId={currentEditor.roughNoteId} currentId={currentId}
      roughFlaggedNames={currentEditor.roughFlaggedNames} activeEditText={currentEditor.activeEditText}
      // #954: the full stored body, not the active-week slice, so a
      // shared A/B routine carries both halves byte-for-byte.
      routineRawText={workoutNoteText} onExerciseSourceJump={currentEditor.handleExerciseSourceJump} recoveryWeekNumber={currentRecoveryWeekNumber}
      baselinePaused={currentIsPausedBaseline} progressionSuggestions={visibleProgressionSuggestions} mutedProgressionRows={mutedProgressionRows}
      onMuteProgression={handleMuteProgression} onUnmuteProgression={handleUnmuteProgression} onDismissProgression={handleDismissProgression}
      // #1010: the production Apply-to-note path — the card forwards
      // the exact rendered record and surfaces the persisted result.
      onApplyProgression={currentEditor.handleApplyProgressionSuggestion}
    />
  );

  return (
    <>
      <LogScreenContent
        readScrollRef={readScrollRef} currentEditor={currentEditor} otherEditor={otherEditor}
        deloadEditor={deloadEditor} isEditing={isEditing} isEmpty={isEmpty}
        notesError={notesError} refreshNotes={refreshNotes} isNotesFirstLoad={isNotesFirstLoad}
        notes={notes} handleCreateRoutineEntry={handleCreateRoutineEntry} deloadTabEnabled={deloadTabEnabled}
        recoveryTabVisible={recoveryTabVisible} handleTabViewChange={handleTabViewChange} effectiveTabView={effectiveTabView}
        recoveryInlineEditActive={recoveryInlineEditActive} deloadNote={deloadNote} deloadLoading={deloadLoading}
        completeDeload={completeDeload} clearDeloadNote={clearDeloadNote} workoutNoteText={workoutNoteText}
        activeSaveError={activeSaveError} deloadNotes={deloadNotes} deloadHistory={deloadHistory}
        deleteDeloadNote={deleteDeloadNote} deleteDeload={deleteDeload} currentId={currentId}
        deloadCardCollapsed={deloadCardCollapsed} setDeloadCardCollapsed={setDeloadCardCollapsed} adoptableRoutine={adoptableRoutine}
        hasContent={hasContent} recoveryBlocks={recoveryBlocks} recoveryWeeks={recoveryWeeks}
        handleCompleteCurrentWeek={handleCompleteCurrentWeek} handleUndoCompleteWeek={handleUndoCompleteWeek} openAddWeekModal={openAddWeekModal}
        openEndBlockModal={openEndBlockModal} handleUnlinkRecoveryWeek={handleUnlinkRecoveryWeek} recoveryActionBusy={recoveryActionBusy}
        pendingRecovery={pendingRecovery} recoveryPendingError={recoveryPendingError} handleRetryRecovery={handleRetryRecovery}
        recoveryReady={recoveryReady} recoveryLoading={recoveryLoading} recoveryRefreshing={recoveryRefreshing}
        recoveryStale={recoveryStale} recoveryStateError={recoveryStateError} recoveryMutationsAllowed={recoveryMutationsAllowed}
        showRecoveryStartInManagement={showRecoveryStartInManagement} openStartRecoveryBlock={openStartRecoveryBlock} showRecoveryReopenInManagement={showRecoveryReopenInManagement}
        openReopenRecoveryBlockConfirm={openReopenRecoveryBlockConfirm} newestCompletedRecoveryBlock={newestCompletedRecoveryBlock} otherNotes={otherNotes}
        guardedHandleDeleteRoutine={guardedHandleDeleteRoutine} recoveryWeekNumberByNoteId={recoveryWeekNumberByNoteId} activeRoutineCard={activeRoutineCard}
      />

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
          <View style={styles.editorHeaderActions}>
            {/* #1006: the idle rest-timer affordance is a compact stopwatch
                in the editor's header corner, not a full-width row below the
                editor. It renders nothing outside current-routine edit mode
                or while a timer is running/just completed, so it adds no
                header width and reserves no editor or bottom-navigation
                space; its chooser opens as an out-of-flow dropdown. The
                running countdown / completion banner stays the single
                app-shell instance (App.js). */}
            <RestTimerBanner
              isRunning={restTimerIsRunning}
              remainingMs={restTimerRemainingMs}
              justElapsed={restTimerJustElapsed}
              backgroundAlertAvailable={restTimerBackgroundAlertAvailable}
              onCancel={onCancelRestTimer}
              onDismissDone={onDismissRestTimerDone}
              onStart={onStartRestTimer}
              showStart={!otherEditor.editingNoteId && currentEditor.mode === 'edit'}
              compact
            />
            <EditorHeaderActions otherEditor={otherEditor} deloadEditor={deloadEditor} currentEditor={currentEditor} />
          </View>
        }
        keyboardShouldPersistTaps="handled"
      >
        <LogScreenEditorCard
          {...editorCardProps}
          handleRevertEdit={
            otherEditor.editingNoteId ? otherEditor.handleUndoOther :
            currentEditor.handleUndoCurrent
          }
        />
      </ScreenShell>
      {/* #577 (Contract 3): top-level, beside SessionCheckInModal, outside
          the editor card branch — Done switching read/edit mode cannot
          unmount it. #1006: it is now the only bottom banner in this flow,
          so it always carries the tab-bar/safe-area clearance exactly once
          (the compact rest-timer control above reserves none). */}
      <PRMomentBanner
        moment={currentEditor.prMoment} onDismiss={currentEditor.clearPRMoment} style={{ marginBottom: bottomBannerClearance }}
      />
      <SessionCheckInModal
        // Gated on the toggle exactly as the Analytics one is. The hook's
        // withdrawal transition already clears the prompt when the toggle goes
        // off, so this is the render-side half of a state change, never a
        // substitute for one.
        visible={fatigueTrackingEnabled && currentEditor.showCheckInModal}
        checkInData={currentEditor.roughCheckInData}
        currentId={currentEditor.roughNoteId}
        currentNote={currentNote}
        update={update}
        onClose={() => currentEditor.setShowCheckInModal(false)}
      />
      <RecoveryBlockStartModal
        visible={!!recoveryModal} mode={recoveryModal?.mode} presetNote={recoveryModal?.note}
        eligibleBaselineNotes={eligibleBaselineNotes} eligibleWeekNotes={eligibleWeekNotes} blockingMessage={recoveryBlockingMessage}
        onConfirm={handleConfirmRecoveryBlock} onClose={closeRecoveryModal}
      />
      <RecoveryBlockWeekModal
        visible={addWeekModalOpen} weekNumber={activeRecoveryBlock ? nextWeekNumber(recoveryWeeks, activeRecoveryBlock.id) : null} eligibleWeekNotes={eligibleWeekNotes}
        blockingMessage={
          !activeRecoveryBlock
            ? 'No active recovery block to add a week to.'
            : (recoveryActionBusy ? 'Another recovery action is already in progress.' : null)
        }
        onConfirm={handleConfirmAddWeek} onClose={closeAddWeekModal}
      />
      <RecoveryBlockEndModal
        visible={endBlockModalOpen} block={activeRecoveryBlock} weeks={activeRecoveryBlock ? orderedLiveWeeks(recoveryWeeks, activeRecoveryBlock.id) : []}
        blockingMessage={
          !activeRecoveryBlock
            ? 'No active recovery block to end.'
            : (recoveryActionBusy ? 'Another recovery action is already in progress.' : null)
        }
        onSetInclusion={handleSetRecoveryInclusionFromEndModal} onConfirmComplete={handleCompleteRecoveryBlock} onClose={closeEndBlockModal}
      />
    </>
  );
}
