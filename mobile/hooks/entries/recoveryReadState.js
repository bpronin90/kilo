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
import {
  arePersistedRecoveryRecordsWellFormed,
  partitionRecoveryRecords,
} from '../../lib/data/activeTrainingContext';
import { safeNotify } from './shared';
import {
  markStartupPhase,
  recordStartupReconcileStart,
  whenStartupBackgroundWorkReleased,
} from '../../storage/entries/startupTiming';
import { SYNC_PHASE, SYNC_STATUS, subscribeSyncState } from '../../storage/syncRecovery';
// Side-effect import: registers the mode-aware note-deletion operations into
// the recovery journal (hooks/entries/storageMode.js); the reconcile-then-read
// pass below replays journaled operations that depend on them.
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

// User-facing copy for the non-ready conditions, owned here so no two screens
// describe one condition differently; `Retry recovery` is the exact accessible
// name of the button beside them (ui-design-rules §12).
export const RECOVERY_LOADING_MESSAGE = 'Loading recovery data…';
export const RECOVERY_UNVERIFIED_MESSAGE =
  'Recovery data could not be read, so recovery status is unknown. Tap Retry recovery.';
// Also the unresolved-data notice (#1368): some readable records are set aside
// and shown data may be incomplete. Retry re-checks; it promises no fix.
export const RECOVERY_STALE_MESSAGE =
  'Showing recovery data that may be out of date or incomplete: the latest refresh failed or some records could not be resolved. Tap Retry recovery.';

const INITIAL_RECOVERY_LIFECYCLE = Object.freeze({
  status: RECOVERY_STATUS.IDLE,
  error: null,
  refreshError: null,
  journalCorrupt: false,
  pendingRecovery: [],
  recoveryPendingError: null,
  unresolvedCount: 0,
});

let recoveryLifecycle = {
  status: RECOVERY_STATUS.IDLE,
  // Terminal first-load failure. Only ever set while nothing is verified.
  error: null,
  // Latest refresh failure over an already-verified snapshot.
  refreshError: null,
  // True only while the latest pass found the operation journal unreadable or
  // corrupt (#711). Orthogonal to `status`: it blocks mutations even over a
  // STALE snapshot.
  journalCorrupt: false,
  // Unverified journaled operations (#696): a resumed operation converges
  // before the user can act on the records it touches.
  pendingRecovery: [],
  recoveryPendingError: null,
  // Well-formed records set aside as unresolved by the last pass (#1368).
  unresolvedCount: 0,
};

let recoveryStateListeners = [];

function setRecoveryLifecycle(patch) {
  recoveryLifecycle = { ...recoveryLifecycle, ...patch };
  safeNotify(recoveryStateListeners);
}

// The in-flight authoritative read, plus at most one shared queued follow-up.
let recoveryReadInFlight = null;
let recoveryReadQueued = null;

// Resolves with the OUTCOME of this exact pass, which is what
// `ensureVerifiedRecoveryState` gates mutations on. Display state is separate
// (STALE-with-last-known-good), so a failed or unclean recheck is never read as
// "safe to mutate".
function runAuthoritativeRecoveryRead() {
  const generation = recoveryReadGeneration;
  recordStartupReconcileStart();
  setRecoveryLifecycle({
    status: lastAuthoritativeSnapshot.verified ? RECOVERY_STATUS.REFRESHING : RECOVERY_STATUS.LOADING,
  });
  let pending = [];
  let pendingError = null;
  let unresolvedCount = 0;
  // Reconciliation first, reads second: replay can change what the reads return.
  return reconcileRecoveryOperations()
    .then((reconciliation) => {
      // A corrupt journal means "recovery actions are paused": a failed read,
      // routed into the storage-failure catch below (#711 finding 2).
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
      // #1368: a failed repair pass is a failure of this exact pass.
      if (reconciliation.repair && !reconciliation.repair.ok) throw reconciliation.repair.error;
      return loadRecoveryLists();
    })
    .then(([allBlocks, allWeeks, wellFormed, part]) => {
      // #1366: a malformed persisted record is a failed read (ERROR/STALE with
      // retry, mutations closed), never verified Normal.
      if (!wellFormed) throw new Error('Recovery records on this device are malformed.');
      // #1368: well-formed unresolved records stay persisted. When one could
      // change the mode answer, this pass fails (ERROR, or STALE keeping
      // last-known-good); otherwise they are excluded and the rest verifies.
      if (part.modeRelevant) throw Object.assign(new Error('Recovery data is unresolved.'), { unresolved: true });
      const blocks = allBlocks.filter(b => !part.excludedBlockIds.has(b.id));
      const weeks = allWeeks.filter(w => !part.excludedWeekIds.has(w.id));
      unresolvedCount = part.unresolvedCount;
      // Invalidated mid-read (#1366): a device wipe happened after this pass
      // started, so what it read belongs to the previous owner. Publish nothing.
      if (generation !== recoveryReadGeneration) return OBSOLETE_OUTCOME;
      publishRecoverySnapshot(blocks, weeks);
      setRecoveryLifecycle({
        unresolvedCount,
        status: RECOVERY_STATUS.READY,
        error: null,
        refreshError: null,
        journalCorrupt: false,
        pendingRecovery: pending,
        recoveryPendingError: pendingError,
      });
      markStartupPhase('recovery:reload:done');
      // Pending operations make this pass not clean. Unresolved records that
      // cannot change the mode do not: actions that touch them are refused
      // per target at the journal entry points (recoveryJournalReplay.js).
      return {
        ok: pending.length === 0,
        pendingCount: pending.length,
        unresolvedCount,
        corrupt: false,
        error: null,
      };
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
      return { ok: false, pendingCount: pending.length, corrupt: !!e?.corrupt, error: e };
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

// Confirm-time authoritative precondition recheck: every lifecycle mutation
// re-establishes verified state when confirmed, deciding on the OUTCOME of the
// exact pass it awaited, never on display state read back afterward (#711).
export async function ensureVerifiedRecoveryState() {
  // Always a fresh (coalesced) authoritative read (#711 finding 3).
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
  // Unresolved data that affects the mode keeps the display honest (unknown or
  // STALE) but does not refuse every edit here: the journal entry points refuse,
  // per target and under the lock, only actions that depend on it (#1368).
  if (outcome && outcome.error && outcome.error.unresolved) return { ok: true, unresolved: true };
  return {
    ok: false,
    code: 'RECOVERY_STATE_UNVERIFIED',
    error: 'Recovery data could not be read, so this change was not made. Try again.',
  };
}

// Read-model for Log and Analytics: the active block, live weeks, a note-id ->
// week-number lookup for the active block, and the explicit lifecycle status.
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
    const {
      status, error, refreshError, journalCorrupt, pendingRecovery, recoveryPendingError, unresolvedCount,
    } = view.lifecycle;
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
      // Unresolved records (#1368) reuse the stale presentation: the verified
      // snapshot excludes them, so it is shown with the notice and Retry.
      stale: status === RECOVERY_STATUS.STALE || (!!verified && unresolvedCount > 0),
      staleError: refreshError,
      unresolvedCount: unresolvedCount || 0,
      error,
      // Closed until verified and while the journal is corrupt even over a STALE
      // snapshot (#711). Unresolved records gate per target (#1368).
      mutationsAllowed: !!verified && status !== RECOVERY_STATUS.ERROR && !journalCorrupt,
      refresh,
      pendingRecovery,
      recoveryPendingError,
      // `Retry recovery` is the same call every other read path makes.
      retryRecovery: refresh,
      // Display-only UNRECONCILED read (#1366), offered while the first pass is
      // pending; never feeds `ready`/`mutationsAllowed`. A FAILED plain read is
      // offered as unreadable (null arrays): unknown, never Normal.
      provisional: verified || status === RECOVERY_STATUS.ERROR ? null
        : view.filterRead && view.filter.wellFormed ? { blocks: view.filter.blocks, weeks: view.filter.weeks }
          : view.filterRead || view.filterFailed ? { blocks: null, weeks: null } : null,
    };
  }, [view, refresh]);
}

// Consumer refcount backing the single shared subscription above.
let recoveryBlockStateConsumerCount = 0;

// The ONE mutation/import listener and ONE sync-completion subscription for
// the shared subscription's lifetime (#711 round 2).
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
// Every AUTOMATIC authoritative read (first mount, completed cloud sync) goes
// through here, so none starts journal replay before app local-ready
// while the shell holds startup work (startupTiming.js). Deferred requests
// collapse into one pass. Explicit callers (confirm-time
// `ensureVerifiedRecoveryState`, `Retry recovery`, mutation notifications) call
// `refreshRecoveryState` directly and are never parked behind local-ready.
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

// TWO separate snapshots (#711 finding 1), so neither can evict the other:
// - `lastAuthoritativeSnapshot`: written ONLY by the reconcile-then-read pass;
//   `useRecoveryBlockState` renders it and every mutation gate checks it.
// - `lastFilterSnapshot`: written by the authoritative pass or a plain
//   (unreconciled) filter read; the analytics filter renders it and, since
//   #1366, it is offered as display-only `provisional` data. It never
//   authorizes a mutation.
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

// Authoritative publish: ONLY the reconcile-then-read pass. Updates both
// snapshots and finalizes all state BEFORE the single notify.
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
// refresh. Touches ONLY `lastFilterSnapshot`, so an unreconciled filter read
// can neither grant mutation trust nor evict last-known-good data.
// `wellFormed` (#1366): whether the RAW persisted records passed validation;
// only then may it back a provisional display.
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

// The filtered lists, whether the RAW records are well-formed (#1366), and their
// unresolved partition (#1368). A raw-read failure means "not well-formed".
function loadRecoveryLists() {
  return Promise.all([
    Storage.loadRecoveryBlocks(),
    Storage.loadRecoveryBlockWeeks(),
    Promise.resolve()
      .then(() => Promise.all([Storage.loadRecoveryBlocksRaw(), Storage.loadRecoveryBlockWeeksRaw()]))
      .then(
        ([rawBlocks, rawWeeks]) => {
          const ok = arePersistedRecoveryRecordsWellFormed(rawBlocks, rawWeeks);
          return [ok, ok ? partitionRecoveryRecords(rawBlocks, rawWeeks) : null];
        },
        () => [false, null]
      ),
  ]).then(([blocks, weeks, [wellFormed, part]]) => [blocks, weeks, wellFormed, part]);
}

export function runRecoveryFilterRead() {
  if (!recoveryFilterReadInFlight) {
    const generation = recoveryReadGeneration;
    const read = (
      recoveryReadInFlight
        // The authoritative pass already publishes (and reconciles) the
        // shared snapshot; just wait for it rather than re-reading.
        ? recoveryReadInFlight
        : loadRecoveryLists()
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

// Everything the boundary decision depends on, and nothing else. A reload with
// the same signature republishes the SAME snapshot object, so consumers bail
// out instead of re-rendering Home, Analytics, and the Log editor.
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
