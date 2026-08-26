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
// relocated Week A/B pill.
//
// Authorized exception (#843), the owner-authorized Recovery and More Routines
// redesign: `styles.tabToggle` and its item styles below are restyled to a
// neutral navigation strip; `LogRecoverySection.js`, `RecoveryBlockEndModal.js`
// (new), and `LogPreviousRoutines.js` carry their own approved redesign. The
// Current routine card remains locked. No other styling exception is authorized.

import React, { useState, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Alert } from '../lib/platformAlert';
import { LogEmptyState } from '../components/LogEmptyState';
import { ScreenShell } from '../components/ScreenShell';
import { Button, Card, ErrorBanner } from '../components/UI';
import { countWorkoutSessionsFromSections, parseWorkoutNote, normalizeExerciseKey } from '../lib/parser';
import {
  deriveFirstUseState,
  pickAdoptableRoutine,
  FIRST_USE_S1,
} from '../lib/guidedEntry';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { normalizeLiftName, listTrackedLifts } from '../lib/data';
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

import { LogDeloadSection } from '../components/LogDeloadSection';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { LogScreenEditorCard, RoutineAdoptionPrompt } from '../components/LogScreenEditorCard';
import { RecoveryBlockStartModal } from '../components/RecoveryBlockStartModal';
import { RecoveryBlockWeekModal } from '../components/RecoveryBlockWeekModal';
import { RecoveryBlockEndModal } from '../components/RecoveryBlockEndModal';
import { LogRecoverySection } from '../components/LogRecoverySection';

import { useLogCurrentRoutineEditor } from './log/useLogCurrentRoutineEditor';
import { useLogOtherRoutineEditor } from './log/useLogOtherRoutineEditor';
import { useLogDeloadEditor } from './log/useLogDeloadEditor';

// First-paint placeholder for the routine list (#737). Static bars, no motion,
// matching the routine-card rhythm this screen paints once notes resolve.
// Styling is layout-only placeholder chrome and introduces no new Log-tab
// typography or color decisions (see the style lock above).
function LogSkeleton() {
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
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { notes, currentId, currentNote, deloadNotes, loading: notesLoading, error: notesError, refresh: refreshNotes, selectCurrent, update, add, remove } = useWorkoutNotes();
  const { trackedLifts, activations: trackedLiftActivations, toggle: toggleTrackedLift, reconcileActivations: reconcileTrackedLiftActivations } = useTrackedLifts();
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

  // Both Log disclosures are owned here (#775), not by the sections that render
  // them. Routine and Deload are mutually exclusive branches, so
  // LogPreviousRoutines and LogDeloadSection unmount on every view switch; while
  // the state lived in those components a user's collapse choice was discarded
  // by the remount and the card came back in its default state.
  const [routineManagementExpanded, setRoutineManagementExpanded] = useState(false);
  const [deloadCardCollapsed, setDeloadCardCollapsed] = useState(false);

  // A monotonic nonce bumped on every EXTERNAL request to reveal a non-current
  // routine — now only a typed navigation intent (#718) resolved below, since a
  // Recovery tap reads its note in place (#775). Keying auto-expand on the
  // REQUEST rather than on `viewingNoteId` is what lets a fresh request expand
  // the disclosure even when it re-selects the already-selected note, while
  // ordinary re-renders under an unchanged key still respect a user's explicit
  // collapse (#724 review).
  const [routineRevealKey, setRoutineRevealKey] = useState(0);
  const revealRoutine = () => setRoutineRevealKey(k => k + 1);
  // The consumed-request marker lives HERE, alongside the state it opens
  // (#775). In LogPreviousRoutines it was reset by the very remount it had to
  // survive, so switching Routine→Deload→Routine replayed the last consumed
  // request and reopened a disclosure the user had closed. 0 is the "no request
  // issued" sentinel, so a request that arrives before this screen's first
  // render is still consumed exactly once.
  const consumedRevealKeyRef = useRef(0);
  useEffect(() => {
    if (routineRevealKey === consumedRevealKeyRef.current) return;
    consumedRevealKeyRef.current = routineRevealKey;
    setRoutineManagementExpanded(true);
  }, [routineRevealKey]);

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

  // This one-shot effect makes Recovery the DEFAULT landing tab the first
  // time verified Recovery state resolves with something to show — it was
  // effectively always "first" before this redesign too, since it rendered
  // unconditionally at the top of the Routine tab; now that it is a separate
  // tab, landing there by default is what keeps that behavior. It never
  // fires again after the first resolution, so a later manual switch to
  // Routine/Deload is never fought on a subsequent re-render or refresh.
  //
  // #870: it also focuses the exact open-week note, the same one Home's
  // `Log workout` handoff focuses (see HomeScreen's `handleLogWorkoutPress`
  // and this screen's `navRecoveryKey` effect below) — so a direct Log-tab
  // entry and a Home handoff land on the identical note instead of a bare
  // week list the user must tap into a second time. Only applied when
  // nothing else has already claimed the recovery-note focus (still 0 =
  // no handoff has run yet), and it is set-only — it never collapses a note
  // the user already opened.
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
    // A non-current ROUTINE lives inside the collapsed routine-management
    // disclosure (#724); bump the reveal nonce so it expands for this request
    // even if the note was already the selected one. A deload target renders in
    // LogDeloadSection instead, so revealing More Routines for it would open a
    // disclosure on the view the user is not even looking at (#775).
    if (!isDeloadTarget) revealRoutine();
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

  const handleAndroidBack = () => {
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
  }, [isActive, otherEditor.editingNoteId, otherEditor.viewingNoteId, otherEditor.recoveryViewingNoteId, tabView, currentEditor.mode, deloadEditor.deloadMode, registerBackConsumer]);

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

  // The relocated `Start recovery block` entry point (#724, then #823) now
  // renders as a persistent row directly under the current routine card,
  // never inside a menu or disclosure. The contract requires it ABSENT — not
  // merely disabled — whenever a block cannot be started right now, so every
  // gate folds into one visibility predicate: no active block, a verified and
  // non-stale read, at least one eligible baseline (eligibleBaselineNotes is
  // already empty until the read is verified), and no pending/in-flight
  // recovery action or mutation lock. startRecoveryBlock rechecks the
  // authoritative precondition at confirm regardless.
  const showRecoveryStartInManagement =
    !activeRecoveryBlock
    && recoveryReady
    && !recoveryStale
    && !recoveryActionBusy
    && (pendingRecovery?.length || 0) === 0
    && recoveryMutationsAllowed
    && eligibleBaselineNotes.length > 0;

  // The `Reopen recovery block: {baseline title}` secondary entry point
  // (#839). Uses the EXACT SAME comparator storage's own "newest completed"
  // resolution does — including its `id` tie-break for equal `completed_at`
  // values (#839 review) — so what this row NAMES is exactly what
  // `reopenBlock` will act on, and every device resolves the same winner
  // rather than each seeing a different "newest" depending on local array
  // order; `reopenRecoveryBlockCore` re-verifies this against persisted state
  // at confirm time regardless (#711-style gate). Independent of
  // `showRecoveryStartInManagement`: both compute their own visibility and
  // render together whenever both qualify, per #839's contract that neither
  // replaces or gates the other.
  const newestCompletedRecoveryBlock = recoveryBlocks
    .filter(b => !!b.completed_at)
    .sort(compareRecoveryBlocksNewestCompletedFirst)[0] || null;

  const showRecoveryReopenInManagement =
    !activeRecoveryBlock
    && recoveryReady
    && !recoveryStale
    && !recoveryActionBusy
    && (pendingRecovery?.length || 0) === 0
    && recoveryMutationsAllowed
    && !!newestCompletedRecoveryBlock;

  const handleConfirmRecoveryBlock = async ({ baselineNoteId, weekChoice, weekNoteId, newNoteTitle, reason }) => {
    if (!startRecoveryBlock) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    const baselineNote = notes.find(n => n.id === baselineNoteId);
    if (!baselineNote) {
      return { ok: false, error: 'Select a baseline routine first.' };
    }
    // The confirm-time authoritative precondition, the new-note creation (on
    // the "New note" Week 1 path), and the block/week write are now ALL
    // sequenced inside `startRecoveryBlock` itself, behind exactly one gate
    // check — this screen no longer creates the note or re-checks anything
    // on its own. That is what makes "no persisted write can precede the
    // authoritative decision" structural rather than merely ordered: there is
    // no code path here that reaches storage without going through the one
    // gated call below (#711 review finding 2).
    const result = await startRecoveryBlock({
      baselineNoteId: baselineNote.id,
      baselineNoteTitle: baselineNote.title || null,
      baselineNoteText: baselineNote.raw_text || '',
      weekNoteId: weekChoice === 'new' ? null : weekNoteId,
      // Optional free text (#872), passed straight through — this screen makes
      // no decision about it and never substitutes one of its own.
      reason,
      createWeekNote: weekChoice === 'new' ? () => add(newNoteTitle, '') : undefined,
      // New-note path only: if the note this call created is left orphaned by
      // a later block/week failure, `startRecoveryBlock` rolls it back
      // through this — "no partial changes" covers the note it created too.
      removeWeekNote: (noteId) => remove(noteId),
    });
    if (result?.ok) {
      refreshRecoveryState?.();
      // Land on the tab that now holds the block just created (#823) — Recovery
      // used to just appear inline in the Routine tab the user was already on,
      // but it is a separate tab now, so starting a block has to navigate there
      // for the new week to actually be visible.
      setTabView('recovery');
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

  // `RecoveryBlockEndModal`'s own inclusion write (#843): ordered strictly
  // before `handleCompleteRecoveryBlock` by the modal itself, but not
  // serialized behind the SAME `runRecoveryAction` key — the modal's own
  // `submitting` state is what keeps it from double-firing, and this write
  // changes no week/note/baseline, exactly like the per-block toggle
  // `LogRecoverySection` already owns.
  const handleSetRecoveryInclusionFromEndModal = async (params) => {
    if (!recoveryLifecycle.setIncludeInNormalAnalytics) {
      return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    }
    const result = await recoveryLifecycle.setIncludeInNormalAnalytics(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  };

  const openEndBlockModal = () => setEndBlockModalOpen(true);
  const closeEndBlockModal = () => setEndBlockModalOpen(false);

  // Reopen the newest completed recovery block (#839). Reactivates only the
  // block — every week's completion state is untouched — so on success the
  // ordinary active Recovery tab/card returns exactly as it would for any
  // other active block, including its existing Add week / Undo completion
  // affordances.
  const handleReopenRecoveryBlock = (block) => runRecoveryAction('reopen', async () => {
    if (!recoveryLifecycle.reopenBlock) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.reopenBlock({ blockId: block.id });
    if (result?.ok) {
      refreshRecoveryState?.();
      setTabView('recovery');
    }
    return result;
  });

  const openReopenRecoveryBlockConfirm = () => {
    if (!newestCompletedRecoveryBlock) return;
    const baselineTitle = newestCompletedRecoveryBlock.baseline_note_title || 'Untitled Routine';
    Alert.alert(
      'Reopen this recovery block?',
      `This reactivates ${baselineTitle} as your active recovery block. Every week's status stays exactly as it is — you can add a new week or undo the latest week's completion once it's reopened. You can only reopen your most recently completed block, and only while no other block is active.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reopen block',
          onPress: async () => {
            const result = await handleReopenRecoveryBlock(newestCompletedRecoveryBlock);
            if (!result.ok) {
              Alert.alert('Could not reopen this recovery block', result.error || 'Could not reopen this recovery block.');
            }
          },
        },
      ]
    );
  };

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

  const handleUndoCompleteWeek = (params) => runRecoveryAction('undo-week', async () => {
    if (!recoveryLifecycle.uncompleteCurrentWeek) return { ok: false, error: 'Recovery blocks are not available in this build yet.' };
    const result = await recoveryLifecycle.uncompleteCurrentWeek(params);
    if (result?.ok) refreshRecoveryState?.();
    return result;
  });

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
    const activationSections = notes.flatMap(n => {
      const text = n.id === currentId ? workoutNoteText : n.raw_text;
      return text ? parseWorkoutNote(text).sections : [];
    });
    await toggleTrackedLift(key, activationSections);
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
        {isNotesFirstLoad ? (
          <LogSkeleton />
        ) : notesError && notes.length === 0 ? null : isEmpty ? (
          <LogEmptyState onCreateRoutine={handleCreateRoutineEntry} />
        ) : (
          <>
            {(deloadTabEnabled || recoveryTabVisible) && (
              <View style={styles.tabToggle}>
                {/* Recovery is first when present (#823) — see
                    `recoveryTabVisible` above for exactly when that is, so it
                    is never a permanent, empty tab. */}
                {recoveryTabVisible && (
                  <Pressable
                    onPress={() => handleTabViewChange('recovery')}
                    style={[styles.tabToggleItem, effectiveTabView === 'recovery' && styles.tabToggleItemActive]}
                  >
                    <Text style={[styles.tabToggleText, effectiveTabView === 'recovery' && styles.tabToggleTextActive]}>Recovery</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => handleTabViewChange('routine')}
                  disabled={recoveryInlineEditActive}
                  accessibilityState={{ disabled: recoveryInlineEditActive }}
                  style={[styles.tabToggleItem, effectiveTabView === 'routine' && styles.tabToggleItemActive]}
                >
                  <Text style={[styles.tabToggleText, effectiveTabView === 'routine' && styles.tabToggleTextActive]}>Routine</Text>
                </Pressable>
                {deloadTabEnabled && (
                  <Pressable
                    onPress={() => handleTabViewChange('deload')}
                    disabled={recoveryInlineEditActive}
                    accessibilityState={{ disabled: recoveryInlineEditActive }}
                    style={[styles.tabToggleItem, effectiveTabView === 'deload' && styles.tabToggleItemActive]}
                  >
                    <Text style={[styles.tabToggleText, effectiveTabView === 'deload' && styles.tabToggleTextActive]}>Deload</Text>
                  </Pressable>
                )}
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
                deloadCollapsed={deloadCardCollapsed}
                onToggleDeloadCollapsed={() => setDeloadCardCollapsed(c => !c)}
              />
            )}

            {/* The post-save adoption prompt, when the routine was saved from
                the guided sheet and there is no open editor to host it. Same
                state and same handlers as the editor's copy. */}
            {effectiveTabView === 'routine' && !isEditing && otherEditor.adoptionPrompt && (
              <RoutineAdoptionPrompt
                prompt={otherEditor.adoptionPrompt}
                error={otherEditor.adoptionError}
                busy={otherEditor.adoptionBusy}
                hasCurrentRoutine={!!currentId}
                onAdopt={otherEditor.handleAdoptPromptedRoutine}
                onDismiss={otherEditor.handleDismissAdoptionPrompt}
              />
            )}

            {/* S1 — a routine exists but none is current. Without this card,
                `Not now` (and any save while `currentId` is null) recreates the
                F1 dead end: the routine is filed under a collapsed "More
                Routines" before the user has more than one, with no
                instruction anywhere. One instruction, one action. */}
            {effectiveTabView === 'routine' && adoptableRoutine && (
              <Card style={styles.firstUseCard}>
                <Text style={styles.firstUseTitle}>Start logging this routine</Text>
                <Text style={styles.firstUseBody}>
                  "{adoptableRoutine.title || 'Untitled Routine'}" is saved but is not your current routine yet, so nothing you log will land in it.
                </Text>
                {otherEditor.adoptionError ? (
                  <Text style={styles.firstUseError}>{otherEditor.adoptionError}</Text>
                ) : null}
                <Button
                  onPress={() => otherEditor.handleSwitchCurrent(adoptableRoutine.id)}
                  title="Use this routine"
                  style={styles.firstUseAction}
                  accessibilityLabel={`Use ${adoptableRoutine.title || 'Untitled Routine'} as your current routine`}
                />
              </Card>
            )}

            {effectiveTabView === 'routine' && currentEditor.mode === 'read' && hasContent && (
              <LogActiveRoutineCard
                workoutNoteTitle={workoutNoteTitle}
                hasABWeeks={currentEditor.hasABWeeks}
                effectiveActiveWeek={currentEditor.effectiveActiveWeek}
                handleToggleWeek={currentEditor.handleToggleWeek}
                enterCurrentEditor={currentEditor.enterCurrentEditor}
                handleNoteBodyPress={currentEditor.handleNoteBodyPress}
                handleSkipWeek={currentEditor.isSaving ? undefined : currentEditor.handleSkipWeek}
                handleUnskipWeek={currentEditor.isSaving ? undefined : currentEditor.handleUnskipWeek}
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
                onExerciseSourceJump={currentEditor.handleExerciseSourceJump}
                recoveryWeekNumber={currentRecoveryWeekNumber}
                baselinePaused={currentIsPausedBaseline}
              />
            )}

            {effectiveTabView === 'recovery' && (
              <LogRecoverySection
                blocks={recoveryBlocks}
                weeks={recoveryWeeks}
                notes={notes}
                onViewNote={otherEditor.handleViewRecoveryNote}
                viewingNoteId={otherEditor.recoveryViewingNoteId}
                viewingNote={otherEditor.recoveryViewingNote}
                viewingNoteDayGroups={otherEditor.recoveryViewingNoteDayGroups}
                viewingHasABWeeks={otherEditor.recoveryViewingHasABWeeks}
                viewingEffectiveWeek={otherEditor.recoveryViewingEffectiveWeek}
                viewingActiveText={otherEditor.recoveryViewingActiveText}
                onExerciseSourceJump={otherEditor.handleRecoveryExerciseSourceJump}
                onToggleViewingWeek={otherEditor.handleToggleRecoveryViewingWeek}
                onEditNote={otherEditor.handleEditRecoveryViewedNote}
                // Inline recovery-note editor wiring (#841): a note is being
                // edited inline in THIS block only when editingNoteId names it
                // AND that session was opened from the recovery surface —
                // otherwise editingNoteId belongs to the shared full-screen
                // editor (or to nothing) and this block stays in read mode.
                editingNoteId={otherEditor.editingSource === 'recovery' ? otherEditor.editingNoteId : null}
                editingTitle={otherEditor.editingTitle}
                onChangeEditingTitle={otherEditor.setEditingTitle}
                editingText={otherEditor.editingText}
                onChangeEditingText={otherEditor.setEditingText}
                editingHasABWeeks={otherEditor.editingHasABWeeks}
                editingEffectiveWeek={otherEditor.editingEffectiveWeek}
                onToggleEditingWeek={otherEditor.handleToggleEditingWeek}
                editingIsSaving={otherEditor.noteIsSaving}
                editingSaveError={otherEditor.saveError}
                editingSaveSuccess={otherEditor.saveSuccess}
                editingSaveStatus={otherEditor.saveStatus}
                onEditorInteraction={otherEditor.cancelPendingDraftRestore}
                onSaveEdit={otherEditor.handleDoneOther}
                onCancelEdit={otherEditor.handleCancelRecoveryEdit}
                pendingSourceJump={otherEditor.pendingSourceJump}
                onSourceJumpApplied={otherEditor.clearPendingSourceJump}
                onCompleteWeek={handleCompleteCurrentWeek}
                onUndoCompleteWeek={handleUndoCompleteWeek}
                onOpenAddWeek={openAddWeekModal}
                onOpenEndBlockModal={openEndBlockModal}
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
              />
            )}

            {/* Persistent, low-emphasis entry point (#823): previously
                `Start recovery block` only existed inside the collapsed
                "More Routines" disclosure below, so seeing it at all required
                opening the exact panel that disclosure has since lost its
                bordered chrome to. It is never nested in a menu now — always
                visible under the current routine card, subordinate to Edit,
                and gone the instant a block becomes active (folded into
                `showRecoveryStartInManagement` unchanged). */}
            {effectiveTabView === 'routine' && showRecoveryStartInManagement && (
              <Pressable
                onPress={openStartRecoveryBlock}
                style={styles.recoveryStartRow}
                accessibilityRole="button"
                accessibilityLabel="Start recovery block"
              >
                <Text style={styles.recoveryStartRowText}>Start recovery block</Text>
                <MaterialIcons name="chevron-right" size={18} color={colors.accent} accessible={false} />
              </Pressable>
            )}

            {/* Secondary, lower-emphasis entry point immediately below Start
                (#839): computes its own visibility independently of Start's
                and renders alongside it whenever both qualify — neither
                replaces or gates the other. Non-destructive styling
                (`textMuted`, not `accent`) keeps Start visually primary. */}
            {effectiveTabView === 'routine' && showRecoveryReopenInManagement && (
              <Pressable
                onPress={openReopenRecoveryBlockConfirm}
                style={styles.recoveryReopenRow}
                accessibilityRole="button"
                accessibilityLabel={`Reopen recovery block: ${newestCompletedRecoveryBlock.baseline_note_title || 'Untitled Routine'}`}
              >
                <Text style={styles.recoveryReopenRowText} numberOfLines={1}>
                  {`Reopen recovery block: ${newestCompletedRecoveryBlock.baseline_note_title || 'Untitled Routine'}`}
                </Text>
                <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} accessible={false} />
              </Pressable>
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
                viewingActiveText={otherEditor.viewingActiveText}
                onExerciseSourceJump={otherEditor.handleRoutineExerciseSourceJump}
                handleToggleViewingWeek={otherEditor.handleToggleViewingWeek}
                handleSwitchCurrent={otherEditor.handleSwitchCurrent}
                handleEditViewedNote={otherEditor.handleEditViewedNote}
                handleDeleteRoutine={guardedHandleDeleteRoutine}
                handleCreateRoutine={handleCreateRoutineEntry}
                recoveryWeekNumberByNoteId={recoveryWeekNumberByNoteId}
                expanded={routineManagementExpanded}
                onToggleExpanded={() => setRoutineManagementExpanded(e => !e)}
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
          saveError={activeSaveError}
          saveStatus={activeSaveStatus}
          onEditorInteraction={activeEditorInteraction}
          editingNoteId={otherEditor.editingNoteId}
          isEditingDeloadNote={otherEditor.isEditingDeloadNote}
          editingTitle={otherEditor.editingTitle}
          setEditingTitle={otherEditor.setEditingTitle}
          workoutNoteTitle={workoutNoteTitle}
          setWorkoutNoteTitle={setWorkoutNoteTitle}
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
          sessionAlignmentIssue={
            deloadEditor.deloadMode === 'edit'
              ? null
              : otherEditor.editingNoteId
                ? otherEditor.sessionAlignmentIssue
                : currentEditor.sessionAlignmentIssue
          }
          handleCurrentTextChange={currentEditor.handleCurrentTextChange}
          handleSaveOtherNote={otherEditor.handleSaveOtherNote}
          handleSave={currentEditor.handleSave}
          noteIsSaving={otherEditor.noteIsSaving}
          handleSwitchCurrent={otherEditor.handleSwitchCurrent}
          handleDeleteDeloadNoteFromEditor={otherEditor.handleDeleteDeloadNoteFromEditor}
          handleDeleteRoutine={guardedHandleDeleteRoutine}
          currentId={currentId}
          adoptionPrompt={otherEditor.adoptionPrompt}
          adoptionError={otherEditor.adoptionError}
          adoptionBusy={otherEditor.adoptionBusy}
          onAdoptPromptedRoutine={otherEditor.handleAdoptPromptedRoutine}
          onDismissAdoptionPrompt={otherEditor.handleDismissAdoptionPrompt}
          handleRevertEdit={
            otherEditor.editingNoteId ? otherEditor.handleUndoOther :
            currentEditor.handleUndoCurrent
          }
          currentMode={currentEditor.mode}
          editingEffectiveWeek={otherEditor.editingEffectiveWeek}
          // #881: whichever pending source jump targets THIS shared card —
          // the current-editor session (`editingNoteId` null) or a
          // non-Recovery other note. A Recovery-sourced jump is filtered out
          // here; LogRecoverySection applies that one itself, on its own
          // inline TextInput.
          pendingSourceJump={
            otherEditor.editingNoteId
              ? (otherEditor.pendingSourceJump?.source === 'recovery' ? null : otherEditor.pendingSourceJump)
              : currentEditor.pendingSourceJump
          }
          onSourceJumpApplied={otherEditor.editingNoteId ? otherEditor.clearPendingSourceJump : currentEditor.clearPendingSourceJump}
        />
      </ScreenShell>
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
      <RecoveryBlockEndModal
        visible={endBlockModalOpen}
        block={activeRecoveryBlock}
        weeks={activeRecoveryBlock ? orderedLiveWeeks(recoveryWeeks, activeRecoveryBlock.id) : []}
        blockingMessage={
          !activeRecoveryBlock
            ? 'No active recovery block to end.'
            : (recoveryActionBusy ? 'Another recovery action is already in progress.' : null)
        }
        onSetInclusion={handleSetRecoveryInclusionFromEndModal}
        onConfirmComplete={handleCompleteRecoveryBlock}
        onClose={closeEndBlockModal}
      />
    </>
  );
}

const createStyles = (colors) => StyleSheet.create({
  skeletonCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    marginBottom: 12,
    gap: 12,
  },
  skeletonBar: {
    backgroundColor: colors.cardBorder,
    borderRadius: 6,
    opacity: 0.6,
    height: 12,
  },
  skeletonBarShort: {
    width: '35%',
  },
  skeletonBarFull: {
    width: '100%',
  },
  skeletonBarWide: {
    width: '75%',
  },
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
  // Neutral navigation strip (#843), restyled from the former accent-filled
  // toggle: a subtle background and card border rather than a chip surface,
  // with the active item picked out by the card color and a small shadow —
  // the same emphasis language ordinary cards already use, not a second
  // accent fill competing with Recovery's own primary action. The former
  // 12px bottom margin is dropped; spacing to the content below now comes
  // from the surrounding sections' own gaps.
  tabToggle: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: colors.subtleBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 3,
  },
  tabToggleItem: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabToggleItemActive: {
    backgroundColor: colors.card,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  tabToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabToggleTextActive: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  // Persistent `Start recovery block` entry point (#823): a low-emphasis
  // outline row, subordinate to Edit on the current routine card above it,
  // and never nested in a menu — see the render site for why it moved here.
  recoveryStartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
  },
  recoveryStartRowText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  // Secondary `Reopen recovery block: {baseline title}` entry point (#839):
  // same outline-row shape as Start, but `textMuted` ink keeps it visibly
  // lower-emphasis and non-destructive next to Start's `accent` primary.
  recoveryReopenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    marginTop: 8,
  },
  recoveryReopenRowText: {
    flex: 1,
    marginRight: 8,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // First-use guidance cards (S1/S2). Ordinary `Card` chrome and ordinary
  // text/textMuted ink — no new filled surface + label pairing, so no new
  // contrast entry is required (#ui-design-rules §13). No fixed heights, so
  // every line wraps rather than truncating at large text.
  firstUseCard: {
    gap: 8,
  },
  firstUseTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  firstUseBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  firstUseError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.error,
  },
  firstUseAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
});
