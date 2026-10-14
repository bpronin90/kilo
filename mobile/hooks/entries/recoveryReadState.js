// Recovery read lifecycle + shared store (#695, #711, #716, #868; split #1058).
//
// SINGLE OWNER of every piece of shared mutable recovery state: the verified
// authoritative snapshot, the ordinary-analytics filter snapshot, the lifecycle
// status, the coalescing in-flight reads, and the listener/subscriber
// registries. The analytics-filter, eligibility, and mutation modules all read
// this store; none duplicate any of its state. Behavior is unchanged by #1058.

import { useState, useEffect, useCallback, useMemo } from 'react';
import * as Storage from '../../storage/entries';
import {
  RECOVERY_OPERATION_CODES,
  reconcileRecoveryOperations,
} from '../../storage/entries/recoveryOperationJournal';
import { findActiveBlock } from '../../lib/data/recoveryBlocks';
import { arePersistedRecoveryRecordsWellFormed } from '../../lib/data/activeTrainingContext';
import { safeNotify } from './shared';
import {
  markStartupPhase,
  recordStartupReconcileStart,
  whenStartupBackgroundWorkReleased,
} from '../../storage/entries/startupTiming';
import { SYNC_PHASE, SYNC_STATUS, subscribeSyncState } from '../../storage/syncRecovery';
// Imported for its module-load side effect as well as nothing else: it
// registers the mode-aware note-deletion operations into the recovery journal
// (see hooks/entries/storageMode.js). Without it the journal would fall back to
// its local-only default even in cloud mode, and the reconcile-then-read pass
// below replays journaled operations that depend on those registrations.
import './storageMode';

let recoveryListeners = [];
const notifyRecoveryBlocks = () => safeNotify(recoveryListeners);

// ── one authoritative Recovery read-and-reconcile contract (#716) ─────────────
//
// Log and Analytics once each ran their own reconcile-then-read, so a FAILED
// read looked like a VERIFIED EMPTY one (every gate derived from `[]` said yes)
// and two consumers could reconcile concurrently and disagree. This store is
// the single owner of the verified snapshot and its lifecycle, behind one
// coalescing entry point, so mounted consumers share one snapshot and never run
// two concurrent reconciliations.
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

const INITIAL_RECOVERY_LIFECYCLE = Object.freeze({
  status: RECOVERY_STATUS.IDLE,
  error: null,
  refreshError: null,
  journalCorrupt: false,
  pendingRecovery: [],
  recoveryPendingError: null,
});

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

// The single in-flight authoritative read, plus at most one queued follow-up
// shared by every caller that arrives mid-read (it may predate their mutation).
let recoveryReadInFlight = null;
let recoveryReadQueued = null;

// Resolves with the OUTCOME of this exact pass (`{ ok, pendingCount, corrupt,
// error }`), which is what `ensureVerifiedRecoveryState` gates mutations on.
// Display state (`recoveryLifecycle.status`, `lastAuthoritativeSnapshot`) is
// separate and keeps degrading to STALE-with-last-known-good regardless, so a
// recheck that FAILED or found pending work is never read as "safe to mutate".
function runAuthoritativeRecoveryRead() {
  const generation = recoveryReadGeneration;
  recordStartupReconcileStart();
  setRecoveryLifecycle({
    status: lastAuthoritativeSnapshot.verified ? RECOVERY_STATUS.REFRESHING : RECOVERY_STATUS.LOADING,
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
      // Invalidated mid-read (#1366): a device wipe happened after this pass
      // started, so what it read belongs to the previous owner. Publish nothing.
      if (generation !== recoveryReadGeneration) return OBSOLETE_OUTCOME;
      publishRecoverySnapshot(blocks, weeks);
      setRecoveryLifecycle({
        status: RECOVERY_STATUS.READY,
        error: null,
        refreshError: null,
        journalCorrupt: false,
        pendingRecovery: pending,
        recoveryPendingError: pendingError,
      });
      markStartupPhase('recovery:reload:done');
      // READY display status does NOT by itself mean "safe to mutate": a
      // non-zero `pending` count means this exact pass found conflicting
      // operations still unresolved, so its own outcome is not clean even
      // though nothing was corrupt and the read itself succeeded.
      return { ok: pending.length === 0, pendingCount: pending.length, corrupt: false, error: null };
    })
    .catch((e) => {
      if (generation !== recoveryReadGeneration) return OBSOLETE_OUTCOME;
      // A failed read never publishes "nothing is recovering": a verified
      // snapshot goes STALE (last-known-good), an unverified one goes ERROR,
      // and a corrupt journal blocks mutations in either. Only a successful
      // authoritative pass ever writes `lastAuthoritativeSnapshot`, so this
      // check is exactly "did an authoritative read ever succeed" (#711).
      if (lastAuthoritativeSnapshot.verified) {
        setRecoveryLifecycle({ status: RECOVERY_STATUS.STALE, refreshError: e, journalCorrupt: !!e?.corrupt });
      } else {
        setRecoveryLifecycle({ status: RECOVERY_STATUS.ERROR, error: e, journalCorrupt: !!e?.corrupt });
      }
      // THIS pass failed, whatever the display state above resolves to.
      return { ok: false, pendingCount: 0, corrupt: !!e?.corrupt, error: e };
    });
}

// Resolves with the outcome of the pass that answers THIS call; a caller
// arriving mid-read gets the QUEUED follow-up's own outcome.
export function refreshRecoveryState() {
  if (!recoveryReadInFlight) {
    const pass = runAuthoritativeRecoveryRead().finally(() => {
      if (recoveryReadInFlight === pass) recoveryReadInFlight = null;
    });
    recoveryReadInFlight = pass;
    return pass;
  }
  if (!recoveryReadQueued) {
    // Bound to its generation (#1366): a follow-up queued before a wipe never
    // runs a pass for — or reports success to — a caller from the old owner.
    const generation = recoveryReadGeneration;
    const queued = recoveryReadInFlight.then(() => {
      if (recoveryReadQueued === queued) recoveryReadQueued = null;
      return generation === recoveryReadGeneration ? refreshRecoveryState() : OBSOLETE_OUTCOME;
    });
    recoveryReadQueued = queued;
  }
  return recoveryReadQueued;
}

// Confirm-time authoritative precondition recheck. A confirmation dialog can
// sit open while the snapshot behind its button goes stale, so every lifecycle
// mutation re-establishes verified state when confirmed. It decides on the
// OUTCOME of the exact pass it awaited, never on display state read back
// afterward: STALE-with-last-known-good and READY-but-pending are display
// outcomes, not a successful recheck (#711 round 4).
export async function ensureVerifiedRecoveryState() {
  // Always a fresh (coalesced) authoritative read: REFRESHING and STALE are
  // "verified" for rendering but may predate the dialog (#711 finding 3).
  const generation = recoveryReadGeneration;
  const outcome = await refreshRecoveryState();
  // A wipe while this recheck ran voids it, whatever the pass reported.
  if (outcome && outcome.ok && generation === recoveryReadGeneration) {
    return { ok: true };
  }
  if (outcome && outcome.corrupt) {
    return {
      ok: false,
      code: 'RECOVERY_JOURNAL_CORRUPT',
      error: 'Recovery actions are paused until recovery data can be read again. Try again.',
    };
  }
  if (outcome && outcome.pendingCount > 0) {
    return {
      ok: false,
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      error: 'A recovery change is still finishing. Try again in a moment.',
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
    snapshot: lastAuthoritativeSnapshot,
    lifecycle: recoveryLifecycle,
    filter: lastFilterSnapshot,
    filterRead: recoveryFilterVerified,
    filterFailed: recoveryFilterReadFailed,
  }));

  const sync = useCallback(() => {
    setView(prev => (
      prev.snapshot === lastAuthoritativeSnapshot
        && prev.lifecycle === recoveryLifecycle
        && prev.filter === lastFilterSnapshot
        && prev.filterRead === recoveryFilterVerified
        && prev.filterFailed === recoveryFilterReadFailed
        ? prev
        : {
          snapshot: lastAuthoritativeSnapshot,
          lifecycle: recoveryLifecycle,
          filter: lastFilterSnapshot,
          filterRead: recoveryFilterVerified,
          filterFailed: recoveryFilterReadFailed,
        }
    ));
  }, []);

  const refresh = useCallback(() => refreshRecoveryState(), []);

  useEffect(() => {
    sync();
    // Single shared subscription (#711 finding 3): the FIRST consumer to mount
    // requests the initial read and owns the one mutation/import listener and
    // the one sync-completion subscription; later consumers only `sync`. That
    // collapses N mounted consumers to one refresh per signal.
    recoveryBlockStateConsumerCount += 1;
    if (recoveryBlockStateConsumerCount === 1) {
      requestBackgroundRecoveryRead();
      recoveryListeners.push(sharedRecoveryBlockStateRefresh);
      recoverySharedSyncUnsubscribe = subscribeSyncState(handleSharedSyncState);
    }
    // Snapshot AND lifecycle subscription keeps every mounted consumer on the
    // SAME published object.
    recoverySnapshotSubscribers.push(sync);
    recoveryStateListeners.push(sync);

    return () => {
      recoveryBlockStateConsumerCount -= 1;
      if (recoveryBlockStateConsumerCount === 0) {
        recoveryListeners = recoveryListeners.filter(l => l !== sharedRecoveryBlockStateRefresh);
        recoverySharedSyncUnsubscribe?.();
        recoverySharedSyncUnsubscribe = null;
        recoverySharedLastSyncStatus = null;
      }
      recoverySnapshotSubscribers = recoverySnapshotSubscribers.filter(l => l !== sync);
      recoveryStateListeners = recoveryStateListeners.filter(l => l !== sync);
    };
  }, [sync]);

  return useMemo(() => {
    const { blocks, weeks, verified } = view.snapshot;
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
      // `ready` is the only safe basis for reading an empty `blocks` as "no
      // recovery blocks"; it is the published snapshot's own flag (#711).
      ready: !!verified,
      // Initial load only: a terminal first-load failure is ERROR, a refresh
      // over verified data is `refreshing`.
      loading: !verified && status !== RECOVERY_STATUS.ERROR,
      refreshing: status === RECOVERY_STATUS.REFRESHING,
      stale: status === RECOVERY_STATUS.STALE,
      staleError: refreshError,
      error,
      // Closed until verified, and while the journal is corrupt even over a
      // STALE snapshot (#711 finding 2).
      mutationsAllowed: !!verified && status !== RECOVERY_STATUS.ERROR && !journalCorrupt,
      refresh,
      pendingRecovery,
      recoveryPendingError,
      // `Retry recovery` is the same call every other read path makes.
      retryRecovery: refresh,
      // Display-only persisted read (#1366): the plain, UNRECONCILED
      // blocks/weeks the analytics filter already read, offered while the
      // first authoritative pass is still pending so Home can paint the
      // last-known mode instead of a skeleton. It never feeds `ready`,
      // `mutationsAllowed`, or `ensureVerifiedRecoveryState`; it is null once
      // anything verified exists or the authoritative read has failed, since a
      // failure must render as unknown rather than as the pre-replay data. A
      // FAILED plain read is offered as unreadable (null arrays), which every
      // consumer treats as inconsistent: unknown, never a skeleton or Normal.
      provisional: verified || status === RECOVERY_STATUS.ERROR ? null
        : view.filterRead && view.filter.wellFormed ? { blocks: view.filter.blocks, weeks: view.filter.weeks }
          : view.filterRead || view.filterFailed ? { blocks: null, weeks: null } : null,
    };
  }, [view, refresh]);
}

// Consumer refcount backing the single shared subscription above.
let recoveryBlockStateConsumerCount = 0;

// The ONE mutation/import listener and ONE sync-completion subscription for
// the shared subscription's lifetime — module singletons, so "N consumers, one
// refresh per signal" holds for every later trigger too (#711 round 2).
const sharedRecoveryBlockStateRefresh = () => refreshRecoveryState();
let recoverySharedSyncUnsubscribe = null;
let recoverySharedLastSyncStatus = null;
const handleSharedSyncState = (syncState) => {
  const s = syncState?.[SYNC_PHASE.SYNC];
  if (s && s.status === SYNC_STATUS.COMPLETE && recoverySharedLastSyncStatus !== SYNC_STATUS.COMPLETE) {
    requestBackgroundRecoveryRead();
  }
  recoverySharedLastSyncStatus = s ? s.status : null;
};

// ── startup scheduling (#1366) ────────────────────────────────────────────────
//
// Every AUTOMATIC authoritative read — the first consumer's mount, a completed
// cloud sync — goes through here, so no mounted subscriber (Home, or the hidden
// Log/Analytics tabs) can start journal replay before Home's first usable paint
// while the shell holds startup background work (startupTiming.js). Deferred
// requests collapse into one pass, started only if a consumer is still mounted
// and nothing authoritative has run meanwhile. Explicit callers — a mutation's
// confirm-time `ensureVerifiedRecoveryState`, `Retry recovery`, a mutation
// notification — still call `refreshRecoveryState` directly: an action needs a
// verified answer now, so it is never parked behind paint.
let deferredRecoveryRead = null;
function requestBackgroundRecoveryRead() {
  if (deferredRecoveryRead) return;
  let ranNow = false;
  const cancel = whenStartupBackgroundWorkReleased(() => {
    ranNow = true;
    deferredRecoveryRead = null;
    if (recoveryBlockStateConsumerCount > 0) refreshRecoveryState();
  });
  if (!ranNow) deferredRecoveryRead = { cancel };
}

// Bumped by `invalidateRecoveryReadState`. A pass that started under an older
// generation resolves without publishing anything.
let recoveryReadGeneration = 0;
const OBSOLETE_OUTCOME = Object.freeze({
  ok: false, pendingCount: 0, corrupt: false, error: new Error('Recovery read was superseded.'),
});

// Device wipe (#1366): drop every published snapshot and in-flight read so the
// remounted shell starts from IDLE and no read begun for the previous owner can
// republish its records.
export function invalidateRecoveryReadState() {
  recoveryReadGeneration += 1;
  deferredRecoveryRead?.cancel();
  deferredRecoveryRead = null;
  lastAuthoritativeSnapshot = { blocks: [], weeks: [], verified: false };
  lastAuthoritativeSignature = '';
  lastFilterSnapshot = { blocks: [], weeks: [] };
  lastFilterSignature = '';
  recoveryFilterVerified = false;
  recoveryFilterReadFailed = false;
  recoveryReadInFlight = null;
  recoveryReadQueued = null;
  recoveryFilterReadInFlight = null;
  recoveryLifecycle = { ...INITIAL_RECOVERY_LIFECYCLE };
  safeNotify(recoverySnapshotSubscribers);
  safeNotify(recoveryStateListeners);
}

// ── normal-analytics membership filter store (#699) ───────────────────────────

// TWO separate snapshots (#711 finding 1), so neither can evict what the other
// renders:
// - `lastAuthoritativeSnapshot` is written ONLY by the reconcile-then-read
//   pass. `useRecoveryBlockState` renders it and every mutation gate checks it;
//   a plain filter read can never touch it, so last-known-good data and the
//   mutation-trust flag cannot drift apart.
// - `lastFilterSnapshot` is written by either the authoritative pass or a plain
//   (unreconciled) filter read. `useRecoveryAnalyticsFilter` renders it, and
//   since #1366 `useRecoveryBlockState` offers it as display-only `provisional`
//   data. Nothing downstream of it authorizes a mutation.
let lastAuthoritativeSnapshot = { blocks: [], weeks: [], verified: false };
let lastAuthoritativeSignature = '';
let lastFilterSnapshot = { blocks: [], weeks: [] };
let lastFilterSignature = '';
// True once either pass has produced a real (possibly unreconciled) result.
// Gates the filter's `ready` only — never Log's mutations.
let recoveryFilterVerified = false;
// The latest plain filter read failed and none has succeeded since (#1366).
let recoveryFilterReadFailed = false;

// Every mounted filter hook AND `useRecoveryBlockState`.
let recoverySnapshotSubscribers = [];

// Authoritative publish: called ONLY by the reconcile-then-read pass. Updates
// both snapshots (reconciled data is better filter evidence too) and finalizes
// all state BEFORE the single notify, so no subscriber sees new data under the
// old, unverified boundary.
function publishRecoverySnapshot(blocks, weeks) {
  const signature = _recoverySignature(blocks, weeks);
  if (signature !== lastAuthoritativeSignature || !lastAuthoritativeSnapshot.verified) {
    lastAuthoritativeSignature = signature;
    lastAuthoritativeSnapshot = { blocks, weeks, verified: true };
  }
  if (signature !== lastFilterSignature) {
    lastFilterSignature = signature;
    lastFilterSnapshot = { blocks, weeks };
  }
  recoveryFilterVerified = true;
  recoveryFilterReadFailed = false;
  safeNotify(recoverySnapshotSubscribers);
  return lastAuthoritativeSnapshot;
}

// Filter-only publish: called by the read-only `useRecoveryAnalyticsFilter`
// refresh. Touches ONLY `lastFilterSnapshot` — an ordinary, unreconciled
// filter read can never reach `lastAuthoritativeSnapshot`, so it can neither
// grant mutation trust it never earned (finding 1, round 1) nor evict the
// last-known-good data `useRecoveryBlockState` is rendering (finding 1,
// round 3).
// `wellFormed` (#1366) says whether the RAW persisted records behind this read
// passed validation; only then may it back a provisional display.
function publishRecoveryFilterSnapshot(blocks, weeks, wellFormed = false) {
  const signature = _recoverySignature(blocks, weeks);
  if (signature !== lastFilterSignature || !recoveryFilterVerified || lastFilterSnapshot.wellFormed !== wellFormed) {
    lastFilterSignature = signature;
    lastFilterSnapshot = { blocks, weeks, wellFormed };
  }
  recoveryFilterVerified = true;
  recoveryFilterReadFailed = false;
  safeNotify(recoverySnapshotSubscribers);
  return lastFilterSnapshot;
}

// The single in-flight filter read (#711 finding 4), shared by mounted filter
// hooks and piggybacking on an authoritative pass already in flight.
let recoveryFilterReadInFlight = null;

export function runRecoveryFilterRead() {
  if (!recoveryFilterReadInFlight) {
    const generation = recoveryReadGeneration;
    const read = (
      recoveryReadInFlight
        // The authoritative pass already publishes (and reconciles) the
        // shared snapshot; just wait for it rather than re-reading.
        ? recoveryReadInFlight
        : Promise.all([
          Storage.loadRecoveryBlocks(),
          Storage.loadRecoveryBlockWeeks(),
          // Same keys, read concurrently, so the storage boundary serves them
          // from the same decrypt. Any failure here only means "not provably
          // well-formed": unknown for display, never a failed filter read.
          Promise.resolve()
            .then(() => Promise.all([Storage.loadRecoveryBlocksRaw(), Storage.loadRecoveryBlockWeeksRaw()]))
            .then(([rawBlocks, rawWeeks]) => arePersistedRecoveryRecordsWellFormed(rawBlocks, rawWeeks), () => false),
        ])
          .then(([blocks, weeks, wellFormed]) => (
            generation === recoveryReadGeneration ? publishRecoveryFilterSnapshot(blocks, weeks, wellFormed) : lastFilterSnapshot
          ), (e) => {
            if (generation === recoveryReadGeneration && !recoveryFilterReadFailed) {
              recoveryFilterReadFailed = true;
              safeNotify(recoverySnapshotSubscribers);
            }
            throw e;
          })
    ).finally(() => {
      if (recoveryFilterReadInFlight === read) recoveryFilterReadInFlight = null;
    });
    recoveryFilterReadInFlight = read;
  }
  return recoveryFilterReadInFlight;
}

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

// ── shared-store access for the analytics-filter hook (#1058) ──────────────────
//
// The filter hook (recoveryAnalyticsHooks.js) reads this store's filter state
// and registers on the same registries; these accessors keep that state owned
// solely here, read fresh at call time.
export function getFilterSnapshot() {
  return lastFilterSnapshot;
}
export function isRecoveryFilterVerified() {
  return recoveryFilterVerified;
}
export function addRecoveryListener(listener) {
  recoveryListeners.push(listener);
}
export function removeRecoveryListener(listener) {
  recoveryListeners = recoveryListeners.filter(l => l !== listener);
}
export function addSnapshotSubscriber(subscriber) {
  recoverySnapshotSubscribers.push(subscriber);
}
export function removeSnapshotSubscriber(subscriber) {
  recoverySnapshotSubscribers = recoverySnapshotSubscribers.filter(l => l !== subscriber);
}

// Broadcast for records changed outside the mutation hooks (a restored backup).
export function reloadRecoveryBlocks() {
  notifyRecoveryBlocks();
}

// Fired by every mutation hook after a verified result so consumers re-read.
export { notifyRecoveryBlocks };

// Test seam: drop the shared snapshot and the lifecycle state built on it.
export function _resetRecoveryAnalyticsFilterCache() {
  lastAuthoritativeSnapshot = { blocks: [], weeks: [], verified: false };
  lastAuthoritativeSignature = '';
  lastFilterSnapshot = { blocks: [], weeks: [] };
  lastFilterSignature = '';
  recoveryFilterVerified = false;
  recoveryFilterReadFailed = false;
  recoveryLifecycle = { ...INITIAL_RECOVERY_LIFECYCLE };
  deferredRecoveryRead?.cancel();
  deferredRecoveryRead = null;
  recoveryReadInFlight = null;
  recoveryReadQueued = null;
  recoveryFilterReadInFlight = null;
  recoveryBlockStateConsumerCount = 0;
  recoverySharedSyncUnsubscribe = null;
  recoverySharedLastSyncStatus = null;
}
