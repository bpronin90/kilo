// Recovery-block Log-screen hooks (#695).
//
// Wraps storage/entries/recoveryStorage.js for the smallest usable flow: select
// a baseline routine, then create-or-attach one ordinary note as Recovery Week
// 1. Week 2+, completion, browsing, and analytics are explicitly out of scope
// (later issues) — this file only ever creates a block and adds exactly one
// week.
//
// Eligibility is purely structural (findLiveMembershipForNote / the block's
// baseline_note_id), never inferred from note titles, dates, or content — with
// one exception: the pre-existing deload-note convention (title prefix) is
// reused as-is rather than re-derived, since it is not a recovery inference.

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as Storage from '../../storage/entries';
import {
  RECOVERY_OPERATION_CODES,
  RECOVERY_OPERATION_TYPES,
  deleteWorkoutNoteViaRecoveryOperations as deleteNoteViaJournalOperations,
  reconcileRecoveryOperations,
  runGuardedRecoveryAction,
  startRecoveryOperation,
} from '../../storage/entries/recoveryOperationJournal';
import {
  buildRecoveryWeek,
  findActiveBlock,
  findLiveMembershipForNote,
  isBlockActive,
  isLiveRecord,
  nextWeekNumber,
  orderedLiveWeeks,
} from '../../lib/data/recoveryBlocks';
import {
  buildRecoveryAnalyticsFilter,
  deriveRecoveryExcludedNoteIds,
} from '../../lib/data/recoveryAnalyticsFilter';
import { makeWorkoutNoteItem } from '../../lib/data';
import { safeNotify } from './shared';
import { SYNC_PHASE, SYNC_STATUS, subscribeSyncState } from '../../storage/syncRecovery';
// Imported for its module-load side effect as well as nothing else: it
// registers the mode-aware note-deletion operations into the recovery journal
// (see hooks/entries/storageMode.js). Without it the journal would fall back to
// its local-only default even in cloud mode.
import './storageMode';
import { reloadWorkoutNotes } from './workoutNoteHooks';

const RecoveryStorage = Storage;

let recoveryListeners = [];
const notifyRecoveryBlocks = () => safeNotify(recoveryListeners);

// ── one authoritative Recovery read-and-reconcile contract (#716) ─────────────
//
// Log and Analytics used to run `useRecoveryBlockState` independently: each
// mount held its own `blocks`/`weeks`/`loading`/`error` state and its own
// reconcile-then-read pass. Two consequences made the boundary unsafe.
//
// 1. A FAILED read was indistinguishable from a VERIFIED EMPTY one. `blocks`
//    stayed `[]` and `loading` flipped to false, so a corrupt or temporarily
//    unreadable recovery key rendered exactly like "this user has no recovery
//    blocks" — and every eligibility and mutation gate derived from that empty
//    array said yes.
// 2. Two mounted consumers could reconcile the same journal concurrently and
//    then disagree, because nothing tied their reads together.
//
// The store below fixes both. It is the single owner of the verified snapshot
// and of the lifecycle status around it, and every read goes through one
// coalescing entry point, so simultaneously mounted consumers observe the same
// snapshot and can never run two concurrent reconciliations.
export const RECOVERY_STATUS = Object.freeze({
  // No authoritative read has been attempted yet in this process.
  IDLE: 'idle',
  // First authoritative read in flight; nothing is verified yet.
  LOADING: 'loading',
  // A verified snapshot is published and current.
  READY: 'ready',
  // A verified snapshot is published and a newer read is in flight.
  REFRESHING: 'refreshing',
  // A verified snapshot is published but the latest read FAILED. Last-known-good
  // data stays visible and a retry path is offered.
  STALE: 'stale',
  // The first read failed and nothing was ever verified. This is NOT an empty
  // result: consumers must render an error/retry state, never an empty one.
  ERROR: 'error',
});

// User-facing copy for the three non-ready conditions, owned by the state
// contract rather than by either screen so Log and Analytics cannot describe the
// same condition differently. Each states what is actually true right now and,
// where one exists, names the control that resolves it — `Retry recovery` is the
// exact accessible name of the button rendered beside them (ui-design-rules §12).
export const RECOVERY_LOADING_MESSAGE = 'Loading recovery data…';
export const RECOVERY_UNVERIFIED_MESSAGE =
  'Recovery data could not be read, so recovery status is unknown. Tap Retry recovery.';
export const RECOVERY_STALE_MESSAGE =
  'Showing the last recovery data that loaded successfully. The latest refresh failed. Tap Retry recovery.';

let recoveryLifecycle = {
  status: RECOVERY_STATUS.IDLE,
  // Terminal first-load failure. Only ever set while nothing is verified.
  error: null,
  // Latest refresh failure over an already-verified snapshot.
  refreshError: null,
  // True only while the most recent reconciliation pass found the operation
  // journal itself unreadable/corrupt (#711 review finding 2). This is
  // orthogonal to `status`: a previously-verified snapshot goes STALE rather
  // than ERROR on any failed refresh, but a corrupt journal must block
  // mutations even in that STALE state, because the journal contract itself
  // says recovery actions are paused until it can be read again.
  journalCorrupt: false,
  // Journaled operations that are not yet verified (#696). Recovery lifecycle
  // state is not considered ready until reconciliation has run, so a resumed
  // operation converges before the user can act on the records it touches.
  pendingRecovery: [],
  recoveryPendingError: null,
};

let recoveryStateListeners = [];

function setRecoveryLifecycle(patch) {
  recoveryLifecycle = { ...recoveryLifecycle, ...patch };
  safeNotify(recoveryStateListeners);
}

// The single in-flight authoritative read, plus at most one coalesced
// follow-up. A request that arrives while a read is running does NOT reuse that
// read's result — it may have started before the mutation the caller is
// refreshing for — but it also never starts a second concurrent reconciliation.
// Every such caller shares one queued follow-up instead.
let recoveryReadInFlight = null;
let recoveryReadQueued = null;

function runAuthoritativeRecoveryRead() {
  setRecoveryLifecycle({
    status: recoverySnapshotVerified ? RECOVERY_STATUS.REFRESHING : RECOVERY_STATUS.LOADING,
  });
  let pending = [];
  let pendingError = null;
  // Reconciliation first, reads second: replaying a pending operation can
  // change what these two reads return, and publishing the pre-replay values
  // would show the user a transition that is about to be completed anyway.
  return reconcileRecoveryOperations()
    .then((reconciliation) => {
      // A corrupt journal is NOT a normal reconciliation result: `ok`/`pending`
      // describe conflicting-action locks over a journal that was actually
      // readable. When the journal itself could not be read, the contract is
      // "recovery actions are paused" — this must resolve as a failed read
      // (never a READY snapshot with `mutationsAllowed` true), so it is routed
      // into the same catch path as a storage read failure below (#711 review
      // finding 2).
      if (reconciliation.corrupt) {
        const corruptError = new Error(
          reconciliation.error || 'Recovery operations could not be read from this device.'
        );
        corruptError.code = reconciliation.code;
        corruptError.corrupt = true;
        throw corruptError;
      }
      // `pending` locks conflicting actions; `cancelled` does not. A terminal
      // cancellation has already retired its record, so it must unlock
      // everything while still explaining itself once.
      pending = reconciliation.pending || [];
      pendingError = reconciliation.error || null;
      return Promise.all([Storage.loadRecoveryBlocks(), Storage.loadRecoveryBlockWeeks()]);
    })
    .then(([blocks, weeks]) => {
      publishRecoverySnapshot(blocks, weeks);
      setRecoveryLifecycle({
        status: RECOVERY_STATUS.READY,
        error: null,
        refreshError: null,
        journalCorrupt: false,
        pendingRecovery: pending,
        recoveryPendingError: pendingError,
      });
    })
    .catch((e) => {
      // A failed read never publishes "nothing is recovering". A previously
      // verified snapshot stays authoritative and is marked stale; an
      // unverified one becomes a terminal error with a retry path. In neither
      // case is the empty placeholder promoted to a result. A corrupt journal
      // additionally blocks mutations regardless of which of those two states
      // applies (see `journalCorrupt` above).
      if (recoverySnapshotVerified) {
        setRecoveryLifecycle({ status: RECOVERY_STATUS.STALE, refreshError: e, journalCorrupt: !!e?.corrupt });
      } else {
        setRecoveryLifecycle({ status: RECOVERY_STATUS.ERROR, error: e, journalCorrupt: !!e?.corrupt });
      }
    });
}

export function refreshRecoveryState() {
  if (!recoveryReadInFlight) {
    recoveryReadInFlight = runAuthoritativeRecoveryRead().finally(() => {
      recoveryReadInFlight = null;
    });
    return recoveryReadInFlight;
  }
  if (!recoveryReadQueued) {
    recoveryReadQueued = recoveryReadInFlight.then(() => {
      recoveryReadQueued = null;
      return refreshRecoveryState();
    });
  }
  return recoveryReadQueued;
}

// Confirm-time authoritative precondition recheck.
//
// The render-time `mutationsAllowed` gate is necessary but not sufficient: a
// native confirmation dialog can sit open indefinitely, and the verified
// snapshot behind the button can go stale or fail in that window. Every
// lifecycle mutation therefore re-establishes a verified state at the moment it
// is confirmed, and refuses rather than writing against unverified state.
export async function ensureVerifiedRecoveryState() {
  // Always perform a fresh authoritative read here — including when a snapshot
  // is already verified. REFRESHING and STALE are both "verified" in the
  // render-time sense, but neither has necessarily reconciled since the
  // confirmation dialog opened, which is exactly the window this recheck
  // exists to close (#711 review finding 3). `refreshRecoveryState` coalesces
  // with any read already in flight, so this never starts a second concurrent
  // reconciliation.
  await refreshRecoveryState();
  if (
    recoverySnapshotVerified
    && recoveryLifecycle.status !== RECOVERY_STATUS.ERROR
    && !recoveryLifecycle.journalCorrupt
  ) {
    return { ok: true };
  }
  if (recoveryLifecycle.journalCorrupt) {
    return {
      ok: false,
      code: 'RECOVERY_JOURNAL_CORRUPT',
      error: 'Recovery actions are paused until recovery data can be read again. Try again.',
    };
  }
  return {
    ok: false,
    code: 'RECOVERY_STATE_UNVERIFIED',
    error: 'Recovery data could not be read, so this change was not made. Try again.',
  };
}

// Read-model for the Log screen and Analytics: the active block (if any), every
// live week membership, a note-id -> week-number lookup for the active block's
// own weeks (badge display never reaches into a completed/other block), and the
// explicit lifecycle status around all of it.
export function useRecoveryBlockState() {
  const [view, setView] = useState(() => ({
    snapshot: lastRecoverySnapshot,
    verified: recoverySnapshotVerified,
    lifecycle: recoveryLifecycle,
  }));

  const sync = useCallback(() => {
    setView(prev => (
      prev.snapshot === lastRecoverySnapshot
        && prev.verified === recoverySnapshotVerified
        && prev.lifecycle === recoveryLifecycle
        ? prev
        : {
          snapshot: lastRecoverySnapshot,
          verified: recoverySnapshotVerified,
          lifecycle: recoveryLifecycle,
        }
    ));
  }, []);

  const refresh = useCallback(() => refreshRecoveryState(), []);

  useEffect(() => {
    sync();
    refreshRecoveryState();
    recoveryListeners.push(refresh);
    // Subscribing to the shared snapshot as well as the lifecycle status is what
    // makes Log and Analytics agree while mounted together: a publish from
    // either one's read (or from `useRecoveryAnalyticsFilter`) re-renders both
    // against the SAME object.
    recoverySnapshotSubscribers.push(sync);
    recoveryStateListeners.push(sync);

    // A completed cloud sync (bootstrap or ongoing) can bring in another
    // device's active block/week records without any local
    // startRecoveryBlockCore call to fire the private `recoveryListeners`
    // notification above. mobile/App.js only reloads workout notes/weight on
    // its automatic-sync callback and tabs stay mounted, so without this the
    // badge/eligibility state here would go stale until an unrelated remount.
    // Subscribing directly to the sync-state broadcast (rather than requiring
    // App.js to know about recovery state) keeps the fix inside this hook.
    let lastSyncStatus = null;
    const handleSyncState = (syncState) => {
      const s = syncState?.[SYNC_PHASE.SYNC];
      if (s && s.status === SYNC_STATUS.COMPLETE && lastSyncStatus !== SYNC_STATUS.COMPLETE) {
        refreshRecoveryState();
      }
      lastSyncStatus = s ? s.status : null;
    };
    const unsubscribeSync = subscribeSyncState(handleSyncState);

    return () => {
      recoveryListeners = recoveryListeners.filter(l => l !== refresh);
      recoverySnapshotSubscribers = recoverySnapshotSubscribers.filter(l => l !== sync);
      recoveryStateListeners = recoveryStateListeners.filter(l => l !== sync);
      unsubscribeSync();
    };
  }, [refresh, sync]);

  return useMemo(() => {
    const { blocks, weeks } = view.snapshot;
    const { status, error, refreshError, journalCorrupt, pendingRecovery, recoveryPendingError } = view.lifecycle;
    const activeBlock = findActiveBlock(blocks);
    const recoveryWeekNumberByNoteId = {};
    if (activeBlock) {
      for (const w of weeks) {
        if (w.block_id === activeBlock.id) recoveryWeekNumberByNoteId[w.note_id] = w.week_number;
      }
    }
    return {
      blocks,
      weeks,
      activeBlock,
      recoveryWeekNumberByNoteId,
      status,
      // `ready` is the only safe basis for treating an empty `blocks` array as
      // "no recovery blocks exist". Until it is true the arrays are placeholders.
      ready: view.verified,
      // Initial load only. A terminal first-load failure is NOT loading — it has
      // its own error/retry state — and a refresh over verified data is
      // `refreshing`, so the two progress kinds stay distinguishable.
      loading: !view.verified && status !== RECOVERY_STATUS.ERROR,
      refreshing: status === RECOVERY_STATUS.REFRESHING,
      stale: status === RECOVERY_STATUS.STALE,
      staleError: refreshError,
      error,
      // Recovery eligibility and every mutation stay closed until persisted
      // state is verified — and stay closed while the journal itself is
      // corrupt even over an otherwise-verified (STALE) snapshot, since the
      // journal contract says recovery actions are paused in that case
      // (#711 review finding 2).
      mutationsAllowed: view.verified && status !== RECOVERY_STATUS.ERROR && !journalCorrupt,
      refresh,
      pendingRecovery,
      recoveryPendingError,
      // The `Retry recovery` affordance is deliberately the SAME call the initial
      // mount, the sync boundary, and every pre-action gate make. There is no
      // separate repair algorithm to keep in step.
      retryRecovery: refresh,
    };
  }, [view, refresh]);
}

// ── normal-analytics membership filter (#699) ─────────────────────────────────

// Last successfully loaded recovery records, shared by every mounted
// `useRecoveryAnalyticsFilter`. Recovery notes are excluded from ordinary
// analytics by default, so a hook that started from an empty snapshot would
// briefly ADMIT them on every remount (tab switch, screen push) until its own
// read resolved. Seeding from the last known-good snapshot removes that window
// for every mount after the first.
let lastRecoverySnapshot = { blocks: [], weeks: [] };
let lastRecoverySignature = '';
// False until the recovery records have been read successfully at least once in
// this process. Until then the empty snapshot above is a PLACEHOLDER, not
// evidence that nothing is excluded — publishing ordinary analytics from it
// would admit every recovery note in exactly the case the off-by-default
// boundary exists for (a corrupt or temporarily unreadable recovery key on cold
// start, while workout notes load fine). Consumers read `filter.ready` and keep
// their loading state instead.
//
// This gates `useRecoveryBlockState`'s `ready`/`mutationsAllowed` ONLY, and is
// set ONLY by the authoritative reconcile-then-read pass
// (`runAuthoritativeRecoveryRead`). A plain filter read (below) is never
// reconciled against the operation journal, so it must never be able to
// establish the mutation-authorizing verified state — doing so would let Log
// become mutation-capable, or stay mutation-capable past a failed
// reconciliation, off the back of an ordinary Analytics filter read (#711
// review finding 1).
let recoverySnapshotVerified = false;
// Gates `useRecoveryAnalyticsFilter`'s own `ready` only. Set by either the
// authoritative pass OR a plain filter read — both are equally valid evidence
// that the exclusion boundary itself (not the mutation precondition) is known.
let recoveryFilterVerified = false;

// Everyone who renders from the shared snapshot: every mounted
// `useRecoveryAnalyticsFilter` AND every mounted `useRecoveryBlockState`. One
// publish re-renders all of them against the same object, which is what makes
// "Log and Analytics see the same authoritative snapshot" structural rather
// than coincidental.
let recoverySnapshotSubscribers = [];

// The write path for the shared snapshot DATA, shared by both publish
// functions below so neither can hold snapshot records the other has not
// seen. Which verified flag(s) get set is the caller's decision — that is what
// keeps the mutation-authorizing bit reconcile-only (finding 1 above).
function _writeRecoverySnapshot(blocks, weeks) {
  const signature = _recoverySignature(blocks, weeks);
  if (signature !== lastRecoverySignature || !(recoverySnapshotVerified || recoveryFilterVerified)) {
    lastRecoverySignature = signature;
    lastRecoverySnapshot = { blocks, weeks };
  }
  safeNotify(recoverySnapshotSubscribers);
  return lastRecoverySnapshot;
}

// Authoritative publish: called ONLY by the reconcile-then-read pass. Sets
// BOTH verified flags — reconciled data is strictly better evidence than a
// plain filter read, so it satisfies the filter boundary too.
function publishRecoverySnapshot(blocks, weeks) {
  const result = _writeRecoverySnapshot(blocks, weeks);
  recoverySnapshotVerified = true;
  recoveryFilterVerified = true;
  return result;
}

// Filter-only publish: called by the read-only `useRecoveryAnalyticsFilter`
// refresh. Deliberately does NOT set `recoverySnapshotVerified` — an ordinary
// filter read must never make Log's mutations mutation-capable.
function publishRecoveryFilterSnapshot(blocks, weeks) {
  const result = _writeRecoverySnapshot(blocks, weeks);
  recoveryFilterVerified = true;
  return result;
}

// The single in-flight filter read, plus reuse of any authoritative
// reconcile-then-read pass that is already running. Two things this fixes
// together (#711 review finding 4):
//
// 1. Multiple mounted `useRecoveryAnalyticsFilter` instances (e.g. more than
//    one Analytics surface) share ONE storage read instead of each issuing
//    its own.
// 2. When Log and Analytics are mounted together, `useRecoveryBlockState`'s
//    authoritative pass loads the exact same `recovery_blocks`/
//    `recovery_block_weeks` records this filter needs. Piggybacking on that
//    in-flight pass instead of starting a second concurrent read means only
//    ONE read reaches storage, not two.
let recoveryFilterReadInFlight = null;

function runRecoveryFilterRead() {
  if (!recoveryFilterReadInFlight) {
    recoveryFilterReadInFlight = (
      recoveryReadInFlight
        // The authoritative pass already publishes (and reconciles) the
        // shared snapshot; just wait for it rather than re-reading.
        ? recoveryReadInFlight
        : Promise.all([Storage.loadRecoveryBlocks(), Storage.loadRecoveryBlockWeeks()])
          .then(([blocks, weeks]) => publishRecoveryFilterSnapshot(blocks, weeks))
    ).finally(() => {
      recoveryFilterReadInFlight = null;
    });
  }
  return recoveryFilterReadInFlight;
}

// Retry cadence for a failed read, capped. A cold-start failure would otherwise
// wait for an unrelated recovery mutation or a cloud sync to clear, which a
// local-only user may never produce, leaving the screens loading forever.
const RECOVERY_READ_RETRY_MS = [500, 1500, 4000, 10000];

// Everything the boundary decision depends on, and nothing else. A reload that
// produces the same signature republishes the SAME snapshot object, so the
// functional `setSnapshot` below bails out instead of re-rendering Home,
// Analytics, and the Log editor. That matters beyond performance: the common
// case (no recovery records at all) would otherwise force one extra render of
// three screens on every mount, sync completion, and recovery notification.
function _recoverySignature(blocks, weeks) {
  const blockPart = (blocks || []).map(
    b => `${b.id}|${b.updated_at}|${b.include_in_normal_analytics === true ? 1 : 0}|${b.deleted_at ? 1 : 0}`
  );
  const weekPart = (weeks || []).map(
    w => `${w.id}|${w.block_id}|${w.note_id}|${w.updated_at}|${w.deleted_at ? 1 : 0}`
  );
  return `${blockPart.join(',')}~${weekPart.join(',')}`;
}

// Read-only subscriber for the ordinary-analytics boundary.
//
// Deliberately NOT `useRecoveryBlockState`: that hook reconciles the recovery
// operation journal before every read, which is correct for a surface that is
// about to mutate recovery records, and wrong for Home/Analytics/save-time
// classification, which only ever ask "which notes are excluded right now".
// Mounting the reconciling hook on those surfaces would replay journaled
// operations from screens that never asked to.
//
// Refreshes on the signals that can change the boundary out from under a
// mounted screen: the private `recoveryListeners` notification (any local
// recovery mutation, including the inclusion toggle and a restored local
// backup), a completed cloud sync (another device's records), mount, and — only
// while the boundary is still unverified — a bounded retry.
export function useRecoveryAnalyticsFilter() {
  const [state, setState] = useState(
    () => ({ snapshot: lastRecoverySnapshot, verified: recoveryFilterVerified })
  );
  const retryTimerRef = useRef(null);
  const retryAttemptRef = useRef(0);
  const unmountedRef = useRef(false);

  const syncFromShared = useCallback(() => {
    setState(prev => (
      prev.snapshot === lastRecoverySnapshot && prev.verified === recoveryFilterVerified
        ? prev
        : { snapshot: lastRecoverySnapshot, verified: recoveryFilterVerified }
    ));
  }, []);

  const refresh = useCallback(() => {
    return runRecoveryFilterRead()
      .then(() => {
        retryAttemptRef.current = 0;
        syncFromShared();
      })
      .catch(() => {
        // A failed read never publishes "nothing is excluded". If a good
        // snapshot was already read in this process it stays authoritative; if
        // none ever was, the boundary stays unverified and every consumer holds
        // its loading state rather than admitting recovery work.
        syncFromShared();
        if (recoveryFilterVerified || unmountedRef.current) return;
        const attempt = retryAttemptRef.current;
        if (attempt >= RECOVERY_READ_RETRY_MS.length) return;
        retryAttemptRef.current = attempt + 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (!unmountedRef.current) refresh();
        }, RECOVERY_READ_RETRY_MS[attempt]);
      });
  }, [syncFromShared]);

  useEffect(() => {
    unmountedRef.current = false;
    refresh();
    recoveryListeners.push(refresh);
    // A publish from the authoritative `useRecoveryBlockState` read must move
    // this hook too, or Log and Analytics could render two different snapshots
    // while mounted together.
    recoverySnapshotSubscribers.push(syncFromShared);

    let lastSyncStatus = null;
    const handleSyncState = (syncState) => {
      const sync = syncState?.[SYNC_PHASE.SYNC];
      if (sync && sync.status === SYNC_STATUS.COMPLETE && lastSyncStatus !== SYNC_STATUS.COMPLETE) {
        refresh();
      }
      lastSyncStatus = sync ? sync.status : null;
    };
    const unsubscribeSync = subscribeSyncState(handleSyncState);

    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      recoveryListeners = recoveryListeners.filter(l => l !== refresh);
      recoverySnapshotSubscribers = recoverySnapshotSubscribers.filter(l => l !== syncFromShared);
      unsubscribeSync();
    };
  }, [refresh, syncFromShared]);

  return useMemo(
    () => buildRecoveryAnalyticsFilter(state.snapshot.blocks, state.snapshot.weeks, { ready: state.verified }),
    [state]
  );
}

// Module-level broadcast for recovery records that changed outside the hook
// mutations above — today, a restored local backup, which replaces both
// collections wholesale without going through any lifecycle action. Mirrors
// `reloadWorkoutNotes` in workoutNoteHooks.js: every mounted subscriber re-reads
// so a mounted Home/Analytics cannot keep serving the pre-import memberships and
// preferences.
export function reloadRecoveryBlocks() {
  notifyRecoveryBlocks();
}

// Test seam: drop the shared snapshot AND the lifecycle state built on it, so
// one test's recovery records or failed read cannot seed the next test's first
// render.
export function _resetRecoveryAnalyticsFilterCache() {
  lastRecoverySnapshot = { blocks: [], weeks: [] };
  lastRecoverySignature = '';
  recoverySnapshotVerified = false;
  recoveryFilterVerified = false;
  recoveryLifecycle = {
    status: RECOVERY_STATUS.IDLE,
    error: null,
    refreshError: null,
    journalCorrupt: false,
    pendingRecovery: [],
    recoveryPendingError: null,
  };
  recoveryReadInFlight = null;
  recoveryReadQueued = null;
  recoveryFilterReadInFlight = null;
}

// One-shot read of the ordinary-analytics exclusion set, straight from storage.
//
// For callers that act asynchronously rather than render — save-time exercise
// classification is the one today. They must decide against what is actually
// persisted at the moment they write, not against a snapshot captured by the
// render that scheduled them, so they deliberately do NOT subscribe. Rejects on
// a storage failure; the caller decides what an unknown boundary means for its
// own write.
export async function loadRecoveryExcludedNoteIds(storage = Storage) {
  const [blocks, weeks] = await Promise.all([
    storage.loadRecoveryBlocks(),
    storage.loadRecoveryBlockWeeks(),
  ]);
  return deriveRecoveryExcludedNoteIds(blocks, weeks);
}

// True when `note` may serve as a NEW block's frozen baseline: not a deload
// note, and not already a live member (baseline or week) of any block. A note
// may still be reused as a baseline after its old block was deleted — deletion
// tombstones every membership it owned.
export function isEligibleBaselineNote(note, { blocks = [], weeks = [], deloadNotePrefix = null } = {}) {
  if (!note || !note.id) return false;
  if (deloadNotePrefix && note.title?.startsWith(deloadNotePrefix)) return false;
  if (blocks.some(b => b.baseline_note_id === note.id)) return false;
  if (findLiveMembershipForNote(weeks, note.id)) return false;
  return true;
}

// True when `note` may serve as a Recovery Week 1 candidate: not a deload
// note, not any block's frozen baseline, and not already linked to any block.
export function isEligibleRecoveryWeekNote(note, { blocks = [], weeks = [], deloadNotePrefix = null } = {}) {
  return isEligibleBaselineNote(note, { blocks, weeks, deloadNotePrefix });
}

// Create the block, then attach exactly one week. On a Week-1 failure the
// just-created block is rolled back (deleted) so no orphan active block is
// left behind — the two writes must land as one unit from the caller's
// perspective, even though the storage layer does them as two calls.
//
// Extracted from the hook as a plain async function (taking the storage API
// as a parameter) so the rollback path is directly unit-testable with a fake
// storage object, with no React rendering involved.
export async function startRecoveryBlockCore(storage, { baselineNoteId, baselineNoteTitle = null, baselineNoteText = '', weekNoteId }) {
  let block = null;
  try {
    block = await storage.createRecoveryBlock({
      baselineNoteId,
      baselineNoteTitle,
      baselineNoteText,
    });
  } catch (e) {
    return { ok: false, code: e?.code || null, error: e?.message || 'Could not start the recovery block.' };
  }

  try {
    const week = await storage.addRecoveryWeek({ blockId: block.id, noteId: weekNoteId });
    notifyRecoveryBlocks();
    return { ok: true, block, week };
  } catch (e) {
    try {
      await storage.deleteRecoveryBlock(block.id);
    } catch (_rollbackError) {
      // Best-effort rollback; the original failure is what the caller needs
      // to see either way.
    }
    notifyRecoveryBlocks();
    return { ok: false, code: e?.code || null, error: e?.message || 'Could not add Recovery Week 1.' };
  }
}

export function useStartRecoveryBlock() {
  // Same confirm-time recheck as every other recovery mutation: the start modal
  // can sit open while the authoritative read goes stale, and freezing a
  // baseline against unverified state is exactly the write this boundary exists
  // to prevent.
  const startBlock = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    return startRecoveryBlockCore(Storage, params);
  }, []);
  return { startBlock };
}

// ── Week 2+ lifecycle (#696) ──────────────────────────────────────────────────
//
// Every function below is a plain async core (storage passed in, directly unit
// -testable) plus a thin hook wrapper that binds it to the real storage module
// and fires the same module-scope `recoveryListeners` notification the Week-1
// flow uses, so every Log-screen instance stays in sync after a lifecycle
// action lands.
//
// None of these accept a caller-supplied `weeks`/`blocks` snapshot. A native
// confirmation (or the Add Week modal) can sit open for as long as the user
// takes, and a background cloud sync can land new records during that whole
// window — trusting a render-time array captured before the dialog opened
// would let a stale read decide what "the current week" is. Every mutation
// therefore re-reads the relevant records from storage immediately before it
// acts, so it always decides against what is actually persisted right now.

// Complete the block's current week (its single latest live week, if any — the
// same definition `nextWeekNumber` builds off of). A no-op (still ok:true)
// when there is no current week or it is already complete — completion is
// idempotent, matching the storage layer's own re-completion contract.
export function completeCurrentWeekCore(storage, { blockId }) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    const ordered = await storage.loadRecoveryWeeksForBlock(blockId);
    const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
    if (!current) {
      return { ok: false, code: 'NO_CURRENT_WEEK', error: 'This block has no current week to complete.' };
    }
    if (current.completed_at) return { ok: true, week: current };
    try {
      const week = await storage.completeRecoveryWeek(current.id);
      return { ok: true, week };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not complete the current week.' };
    }
  });
}

// Attach the next sequential week. Rejects (without calling storage) when the
// current week has not been explicitly completed yet — Week 2+ can never be
// added early, no matter what the caller's own gating missed or what changed
// underneath it since the Add Week modal was opened.
export function addRecoveryWeekCore(storage, { blockId, noteId }) {
  return runGuardedRecoveryAction({ blockId, noteId }, async () => {
    const ordered = await storage.loadRecoveryWeeksForBlock(blockId);
    const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
    if (current && !current.completed_at) {
      return { ok: false, code: 'WEEK_NOT_COMPLETE', error: 'Complete the current week before adding the next one.' };
    }
    try {
      const week = await storage.addRecoveryWeek({ blockId, noteId });
      return { ok: true, week };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not add the next recovery week.' };
    }
  });
}

// Create a brand-new workout note AND attach it as the next sequential week, as
// one durable journaled operation.
//
// Previously the note was created by the screen BEFORE any lock or journal record
// existed, and a failed attach was undone with a best-effort delete — so two
// failures in a row left an orphan note with no intent to attach or remove it,
// and two same-tick confirms could each create a note before either reached the
// serialized attach. Both the note id and the week ordinal are now minted exactly
// once here, inside the journal's single-flight lock, and recorded on the intent
// before anything is written. A replay writes those same seeds, so no retry can
// mint a second note or a second ordinal.
export function addRecoveryWeekWithNewNoteCore(storage, { blockId, title }) {
  return startRecoveryOperation({
    // Scoped on the block alone at start time: the note and week ids do not exist
    // yet, so nothing else can be holding them. Once journaled, the record's own
    // note_id/week_id are what block a conflicting linked-note delete.
    scope: { blockId },
    validate: async () => {
      const blocks = await storage.loadRecoveryBlocksRaw();
      const block = blocks.find(b => b.id === blockId);
      if (!block || !isLiveRecord(block) || block.completed_at) {
        return { ok: false, code: 'BLOCK_NOT_ACTIVE', error: 'No active recovery block to add a week to.' };
      }
      const weeks = await storage.loadRecoveryBlockWeeksRaw();
      const ordered = orderedLiveWeeks(weeks, blockId);
      const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
      if (current && !current.completed_at) {
        return { ok: false, code: 'WEEK_NOT_COMPLETE', error: 'Complete the current week before adding the next one.' };
      }

      const requestedCreatedAt = new Date().toISOString();
      // `raw_text` is deliberately empty: the seed persisted in the journal holds
      // the title the user typed and no workout-note text.
      const noteSeed = { ...makeWorkoutNoteItem({ title, raw_text: '' }), raw_text: '' };
      const weekSeed = buildRecoveryWeek({
        blockId,
        noteId: noteSeed.id,
        weekNumber: nextWeekNumber(weeks, blockId),
        now: requestedCreatedAt,
      });
      return {
        ok: true,
        intent: {
          type: RECOVERY_OPERATION_TYPES.ADD_WEEK_WITH_NEW_NOTE,
          block_id: blockId,
          week_id: weekSeed.id,
          note_id: noteSeed.id,
          requested_created_at: requestedCreatedAt,
          note_seed: noteSeed,
          week_seed: weekSeed,
          intended_outcome: `new workout note ${noteSeed.id} exists and is linked to block ${blockId} as week ${weekSeed.week_number}`,
        },
        noteSeed,
        weekSeed,
      };
    },
  }).then(result => (result.ok && result.week === undefined
    ? { ...result, week: result.week_id ? { id: result.week_id, block_id: result.block_id, note_id: result.note_id } : null }
    : result));
}

// Complete the block's current (still-open) week and the block itself as one
// atomic storage operation (storage/entries/recoveryStorage.js
// completeRecoveryBlockWithCurrentWeek): either both land, or neither does.
// The domain-forbidden combination — a completed block whose current week is
// still open — can never be observed, including when the block write fails
// after its week write already landed, since that write is reverted before
// the error propagates. The one exception is a `RecoveryReconciliationError`:
// the storage layer's own revert write also failed, which is surfaced as its
// own distinct code so the caller can tell "cleanly failed, retry freely"
// apart from "left in an unknown state, needs manual reconciliation" — never
// the same generic error either way.
export function completeRecoveryBlockCore(storage, { blockId }) {
  return startRecoveryOperation({
    scope: { blockId },
    // Step 1: validate against persisted state. Every rejection below happens
    // before any journal record or domain write exists, which is what makes
    // "cancellation and validation failures write nothing" provable.
    validate: async () => {
      const blocks = await storage.loadRecoveryBlocksRaw();
      const block = blocks.find(b => b.id === blockId);
      if (!block || block.deleted_at) {
        return { ok: false, code: 'BLOCK_NOT_FOUND', error: `No recovery block with id ${blockId}.` };
      }
      const ordered = orderedLiveWeeks(await storage.loadRecoveryBlockWeeksRaw(), blockId);
      const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
      const openWeek = current && !current.completed_at ? current : null;

      // Already in the requested final state: no intent, no writes, no
      // timestamp churn. Replay of a real record reaches the same conclusion.
      if (block.completed_at && !openWeek) {
        return { ok: true, skip: true, result: { block } };
      }

      // One immutable requested timestamp, reused by every replay, so the block
      // and its current week always converge to the SAME stable completed_at no
      // matter how many attempts it takes.
      const requestedCompletedAt = new Date().toISOString();
      return {
        ok: true,
        intent: {
          type: RECOVERY_OPERATION_TYPES.COMPLETE_BLOCK_WITH_WEEK,
          block_id: blockId,
          week_id: openWeek ? openWeek.id : null,
          note_id: null,
          requested_completed_at: requestedCompletedAt,
          intended_outcome: openWeek
            ? 'block and its open current week both completed at the requested timestamp'
            : 'block completed at the requested timestamp',
        },
      };
    },
  }).then(async (result) => {
    if (!result.ok) return result;
    // Postconditions are verified; re-read the block so the caller reports what
    // is actually persisted rather than what it hoped to write.
    if (result.block) return result;
    try {
      const blocks = await storage.loadRecoveryBlocksRaw();
      return { ...result, block: blocks.find(b => b.id === blockId) || null };
    } catch {
      return result;
    }
  });
}

// Unlink one week membership. Restricted to the latest live week of a still
// -active block — earlier/history weeks, and any week of a block that has
// since completed, keep the ordinal sequence gap-free and stable, so unlinking
// them is refused rather than silently reordering anything.
export function unlinkRecoveryWeekCore(storage, { blockId, weekId }) {
  return runGuardedRecoveryAction({ blockId, weekId }, async () => {
    const [blocks, ordered] = await Promise.all([
      storage.loadRecoveryBlocks(),
      storage.loadRecoveryWeeksForBlock(blockId),
    ]);
    const block = blocks.find(b => b.id === blockId);
    const latest = ordered.length > 0 ? ordered[ordered.length - 1] : null;
    if (!block || !isBlockActive(block) || !latest || latest.id !== weekId) {
      return { ok: false, code: 'NOT_LATEST_WEEK', error: 'Only the most recent week of an active block can be unlinked.' };
    }
    try {
      await storage.deleteRecoveryWeek(weekId);
      return { ok: true };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not unlink this week.' };
    }
  });
}

// Delete a workout note that is (or may be) a recovery week, as one durable
// journaled operation.
//
// This applies uniformly to any linked week — active or completed-history —
// unlike the position-restricted explicit Unlink action above.
//
// The single roll-forward outcome is: membership tombstoned AND note deleted
// (absent locally, tombstoned plus durable pending-sync intent in cloud mode).
// There is no rollback path, deliberately. A `deleteNote` call that persisted
// the removal and then threw is indistinguishable from one that never
// committed, and a failed verification read is evidence of neither outcome, so
// restoring the membership could point a live week at a note that is already
// gone. Replay always converges toward the recorded deletion, and the journal
// record is retained until both postconditions are read back from storage.
//
// A note with NO live membership is a single-domain delete: no journal record
// is written, because there is no second collection to keep consistent.
export function unlinkNoteForDeleteCore(storage, { noteId }) {
  return startRecoveryOperation({
    scope: { noteId },
    validate: async () => {
      const weeks = await storage.loadRecoveryBlockWeeks();
      const membership = findLiveMembershipForNote(weeks, noteId);
      if (!membership) {
        try {
          await deleteNoteViaJournalOperations(noteId);
        } catch (e) {
          return { ok: false, code: RECOVERY_OPERATION_CODES.OPERATION_FAILED, reason: 'NOTE_DELETE_FAILED', error: e?.message || 'Could not delete this note.' };
        }
        return { ok: true, skip: true, result: { week: null } };
      }
      return {
        ok: true,
        intent: {
          type: RECOVERY_OPERATION_TYPES.DELETE_LINKED_NOTE,
          block_id: membership.block_id,
          week_id: membership.id,
          note_id: noteId,
          requested_deleted_at: new Date().toISOString(),
          intended_outcome: 'recovery week membership tombstoned and workout note deleted',
        },
        membership,
      };
    },
  }).then((result) => (result.ok && result.week === undefined
    ? { ...result, week: result.week_id ? { id: result.week_id, note_id: result.note_id } : null }
    : result));
}

// Set one block's `include_in_normal_analytics` preference (#699).
//
// Guarded like every other recovery mutation so a toggle cannot land while a
// journaled operation over the same block is still unresolved. It writes no
// journal record of its own: this is a single-field patch on a single
// collection, so there is no second record whose partial write would need
// rolling forward.
//
// `updateRecoveryBlock` strips every immutable field (BLOCK_IMMUTABLE_FIELDS),
// so the frozen baseline, lifecycle timestamps, and record identity are
// untouched — and no workout note is rewritten. Completed blocks are patchable
// on purpose: reviewing a finished recovery and deciding it should count is a
// legitimate action.
export function setRecoveryNormalAnalyticsInclusionCore(storage, { blockId, include }) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    try {
      const block = await storage.updateRecoveryBlock(blockId, {
        include_in_normal_analytics: include === true,
      });
      return { ok: true, block };
    } catch (e) {
      return {
        ok: false,
        code: e?.code || null,
        error: e?.message || 'Could not change this block’s analytics setting.',
      };
    }
  });
}

export function useRecoveryBlockLifecycle() {
  const completeCurrentWeek = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await completeCurrentWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const addWeek = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await addRecoveryWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const addWeekWithNewNote = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await addRecoveryWeekWithNewNoteCore(RecoveryStorage, params);
    if (result.ok) {
      notifyRecoveryBlocks();
      // This operation also writes the notebook, so every mounted workout-note
      // instance reloads — after the verified result, never before it.
      reloadWorkoutNotes();
    }
    return result;
  }, []);
  const completeBlock = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await completeRecoveryBlockCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const unlinkWeek = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await unlinkRecoveryWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const unlinkNoteForDelete = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await unlinkNoteForDeleteCore(RecoveryStorage, params);
    if (result.ok) {
      notifyRecoveryBlocks();
      // This operation is the one that also changes the notebook. Reload (not
      // refresh) every mounted workout-note instance so the deleted note leaves
      // the Log tab without re-entering cloud sync from inside a lifecycle
      // action. Step 7: notify only after the verified result.
      reloadWorkoutNotes();
    }
    return result;
  }, []);
  // Step 7 for the failure side, and the `Retry recovery` affordance's engine:
  // the SAME reconciler startup, sync, and every pre-action gate use.
  const retryRecovery = useCallback(async () => {
    const result = await reconcileRecoveryOperations();
    notifyRecoveryBlocks();
    reloadWorkoutNotes();
    return result;
  }, []);

  // Toggling inclusion changes no note and no baseline, so the notebook is not
  // reloaded — only the recovery subscribers (including every mounted
  // `useRecoveryAnalyticsFilter`) refresh, which is what makes Home/Analytics
  // repopulate immediately.
  const setIncludeInNormalAnalytics = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await setRecoveryNormalAnalyticsInclusionCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);

  return { completeCurrentWeek, addWeek, addWeekWithNewNote, completeBlock, unlinkWeek, unlinkNoteForDelete, setIncludeInNormalAnalytics, retryRecovery };
}
