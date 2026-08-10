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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../lib/platformAlert';
import { LogEmptyState } from '../components/LogEmptyState';
import { ScreenShell } from '../components/ScreenShell';
import { Button, Card, ErrorBanner } from '../components/UI';
import { GuidedRoutineSheet } from '../components/GuidedRoutineSheet';
import { countWorkoutSessionsFromSections } from '../lib/parser';
import {
  deriveFirstUseState,
  pickAdoptableRoutine,
  FIRST_USE_S1,
  FIRST_USE_S2,
} from '../lib/guidedEntry';
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
import { useRecoveryBlockLifecycle } from '../hooks/entries/recoveryBlockHooks';

import { LogDeloadSection } from '../components/LogDeloadSection';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { LogScreenEditorCard, RoutineAdoptionPrompt } from '../components/LogScreenEditorCard';
import { RecoveryBlockStartModal } from '../components/RecoveryBlockStartModal';
import { RecoveryBlockWeekModal } from '../components/RecoveryBlockWeekModal';
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

  const [tabView, setTabView] = useState('routine'); // 'routine' | 'deload'
  const [guidedSheetOpen, setGuidedSheetOpen] = useState(false);

  const editorScrollRef = useRef(null);
  const readScrollRef = useRef(null);

  // Modal ownership (D10 §3.4). There is no ownership manager: the check-in,
  // the recovery-block modal and the add-week modal are sibling <Modal>s each
  // driven by its own `visible` prop, so ownership is a derived predicate over
  // the state those two already keep, not a new mechanism.
  const otherModalOwnsScreen = !!recoveryModal || addWeekModalOpen;

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

  // The relocated `Start recovery block` entry point (#724) now lives inside
  // expanded routine management, not the Recovery section. The contract requires
  // it ABSENT — not merely disabled — whenever a block cannot be started right
  // now, so every gate folds into one visibility predicate: no active block, a
  // verified and non-stale read, at least one eligible baseline
  // (eligibleBaselineNotes is already empty until the read is verified), and no
  // pending/in-flight recovery action or mutation lock. startRecoveryBlock
  // rechecks the authoritative precondition at confirm regardless.
  const showRecoveryStartInManagement =
    !activeRecoveryBlock
    && recoveryReady
    && !recoveryStale
    && !recoveryActionBusy
    && (pendingRecovery?.length || 0) === 0
    && recoveryMutationsAllowed
    && eligibleBaselineNotes.length > 0;

  const handleConfirmRecoveryBlock = async ({ baselineNoteId, weekChoice, weekNoteId, newNoteTitle }) => {
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
      createWeekNote: weekChoice === 'new' ? () => add(newNoteTitle, '') : undefined,
      // New-note path only: if the note this call created is left orphaned by
      // a later block/week failure, `startRecoveryBlock` rolls it back
      // through this — "no partial changes" covers the note it created too.
      removeWeekNote: (noteId) => remove(noteId),
    });
    if (result?.ok) {
      refreshRecoveryState?.();
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

  // A Recovery week tap now reads its note INSIDE the Recovery card (#775), so
  // this only selects the note; it no longer reveals More Routines, and it no
  // longer refuses the current routine — a recovery week linked to the current
  // routine used to be an inert press, because the only surface that could show
  // it (the non-current routine list) never renders it. It stays set-only, not
  // the toggling handleViewOtherNote, so a repeat tap still shows the note.
  //
  // The absent-note guard is retained defensively: LogRecoverySection no longer
  // gives a week without a resolvable note a press target at all, so this is
  // unreachable from the UI, but the handler must not select a null note if a
  // future caller passes one.
  const handleViewRecoveryNote = (note) => {
    if (!note) return;
    otherEditor.setViewingNoteId(note.id);
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
  const isEditing = !!otherEditor.editingNoteId || currentEditor.mode === 'edit' || deloadEditor.deloadMode === 'edit';

  const effectiveTabView = deloadModeEnabled ? tabView : 'routine';

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

  // Guided entry is hidden while the read is unresolved or failed, and is
  // unavailable in deload mode; the plain-text editor stays the fallback so the
  // `New Routine` control is never inert.
  const guidedEntryAvailable = !notesLoading && !notesError && effectiveTabView === 'routine';
  const handleCreateRoutineEntry = () => {
    if (guidedEntryAvailable) {
      setGuidedSheetOpen(true);
      return;
    }
    otherEditor.handleCreateRoutine();
  };
  const handleGuidedWriteAsText = (seed) => {
    setGuidedSheetOpen(false);
    otherEditor.handleCreateRoutine(seed);
  };
  // Exactly one write, `add(title, composedText)`. No other storage key is
  // touched and the routine is NOT adopted — but the offer must still be made,
  // so a successful guided save raises the SAME post-save adoption prompt the
  // plain editor's `Save` raises (#745 Part 4 §A1, which is unconditioned on
  // `currentId`). The S1 card cannot stand in for it: S1 is gated on
  // `!currentId`, so a user who already has a current routine would otherwise
  // be offered adoption nowhere at all.
  const handleGuidedSave = async ({ title, text }) => {
    try {
      const note = await add(title, text);
      if (!note?.id) return { ok: false, error: 'Could not save this routine. Try again.' };
      setGuidedSheetOpen(false);
      otherEditor.showAdoptionPromptFor(note);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not save this routine. Nothing was written — try again.' };
    }
  };

  // The `Copy last session` control: current-routine editor only, S2/S3 only,
  // verified read only, never in deload mode. It reads no Recovery state.
  const showSessionAutofill =
    !otherEditor.editingNoteId
    && currentEditor.mode === 'edit'
    && deloadEditor.deloadMode !== 'edit'
    && !!currentId
    && !notesLoading
    && !notesError
    && activeSessionCount >= 1;

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
        {isNotesFirstLoad ? (
          <LogSkeleton />
        ) : notesError && notes.length === 0 ? null : isEmpty ? (
          <LogEmptyState onCreateRoutine={handleCreateRoutineEntry} />
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

            {/* S2 — exactly one logged session. Two facts, once, inline, and
                dismissed by progressing rather than by a stored flag: the rule
                the format depends on, and the name of the real control that
                turns a lift into an Analytics chart (§12: the copy uses the
                control's actual label, `Track`). */}
            {effectiveTabView === 'routine' && currentEditor.mode === 'read' && hasContent
              && firstUseState === FIRST_USE_S2 && (
              <Card style={styles.firstUseCard}>
                <Text style={styles.firstUseTitle}>One session logged</Text>
                <Text style={styles.firstUseBody}>
                  Each new line under an exercise is a new session — add today's sets on their own line, below the last one.
                </Text>
                <Text style={styles.firstUseBody}>
                  To chart a lift in Analytics, tap Track on that exercise above.
                </Text>
              </Card>
            )}

            {effectiveTabView === 'routine' && (
              <LogRecoverySection
                blocks={recoveryBlocks}
                weeks={recoveryWeeks}
                notes={notes}
                onViewNote={handleViewRecoveryNote}
                viewingNoteId={otherEditor.viewingNoteId}
                viewingNote={otherEditor.viewingNote}
                viewingNoteDayGroups={otherEditor.viewingNoteDayGroups}
                viewingHasABWeeks={otherEditor.viewingHasABWeeks}
                viewingEffectiveWeek={otherEditor.viewingEffectiveWeek}
                onToggleViewingWeek={otherEditor.handleToggleViewingWeek}
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
                handleCreateRoutine={handleCreateRoutineEntry}
                recoveryWeekNumberByNoteId={recoveryWeekNumberByNoteId}
                onStartRecoveryBlock={openStartRecoveryBlock}
                showRecoveryStart={showRecoveryStartInManagement}
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
          saveError={activeSaveError}
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
          showSessionAutofill={showSessionAutofill}
          // Writes into the editor DRAFT, never storage: handleCurrentTextChange
          // owns A/B splicing and the existing debounced autosave persists it.
          onApplySessionAutofill={currentEditor.handleCurrentTextChange}
        />
      </ScreenShell>
      <GuidedRoutineSheet
        visible={guidedSheetOpen && guidedEntryAvailable}
        onClose={() => setGuidedSheetOpen(false)}
        onWriteAsText={handleGuidedWriteAsText}
        onSave={handleGuidedSave}
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
