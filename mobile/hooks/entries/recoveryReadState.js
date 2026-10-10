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
import { safeNotify } from './shared';
import { markStartupPhase } from '../../storage/entries/startupTiming';
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

// Resolves with the OUTCOME of this exact pass — `{ ok, pendingCount, corrupt,
// error }` — in addition to its side effects on the shared lifecycle/snapshot
// display state. This return value is what `ensureVerifiedRecoveryState`
// gates mutations on (see below); display state (`recoveryLifecycle.status`,
// `lastAuthoritativeSnapshot`) is a separate concern that must keep degrading
// to STALE-with-last-known-good exactly as before, no matter what this pass's
// own outcome was (a confirm-time recheck that merely FAILED or found
// operations still pending must never be conflated with "safe to mutate" just
// because the DISPLAY state resolves to something other than terminal ERROR).
function runAuthoritativeRecoveryRead() {
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
      // A failed read never publishes "nothing is recovering". A previously
      // verified snapshot stays authoritative and is marked stale; an
      // unverified one becomes a terminal error with a retry path. In neither
      // case is the empty placeholder promoted to a result. A corrupt journal
      // additionally blocks mutations regardless of which of those two states
      // applies (see `journalCorrupt` above).
      //
      // `lastAuthoritativeSnapshot` is written ONLY by a successful pass right
      // here — nothing else (in particular, no filter read) can ever touch it
      // — so this check is exactly "did an authoritative read ever succeed",
      // never "did some unrelated, less-trusted read happen to publish
      // something more recently" (#711 review finding 1, round 3: the earlier
      // shared-object design let an unreconciled publish flip this to false
      // and turn a refresh failure into a terminal ERROR instead of STALE).
      if (lastAuthoritativeSnapshot.verified) {
        setRecoveryLifecycle({ status: RECOVERY_STATUS.STALE, refreshError: e, journalCorrupt: !!e?.corrupt });
      } else {
        setRecoveryLifecycle({ status: RECOVERY_STATUS.ERROR, error: e, journalCorrupt: !!e?.corrupt });
      }
      // THIS pass failed, full stop — regardless of what the display state
      // above resolves to (STALE still shows last-known-good; that display
      // decision is intentionally independent of this outcome).
      return { ok: false, pendingCount: 0, corrupt: !!e?.corrupt, error: e };
    });
}

// Resolves with the outcome (`{ ok, pendingCount, corrupt, error }`) of
// whichever pass actually answers THIS call — the one it started, or the one
// it coalesced onto/queued behind. A caller that queues behind an in-flight
// read gets the QUEUED pass's own fresh outcome (never the in-flight one it
// arrived too late to trust), because the queued branch below awaits the
// in-flight promise only to sequence itself after it, then explicitly
// re-invokes and returns a brand new call.
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
//
// Decides on the OUTCOME of the exact pass it just awaited (`{ ok,
// pendingCount, corrupt }` from `refreshRecoveryState`/
// `runAuthoritativeRecoveryRead`), never on global display state read back
// afterward. This distinction is the fix for #711 review finding (round 4):
// `recoveryLifecycle.status`/`lastAuthoritativeSnapshot.verified` are DISPLAY
// state — a transient confirm-time failure correctly degrades display to
// STALE-with-last-known-good (which this must not disturb), and a
// successful-but-still-pending reconciliation correctly displays READY.
// Neither of those display outcomes means THIS RECHECK succeeded: the gate
// looks only at what the pass it awaited actually reported about itself.
export async function ensureVerifiedRecoveryState() {
  // Always perform a fresh authoritative read here — including when a snapshot
  // is already verified. REFRESHING and STALE are both "verified" in the
  // render-time sense, but neither has necessarily reconciled since the
  // confirmation dialog opened, which is exactly the window this recheck
  // exists to close (#711 review finding 3). `refreshRecoveryState` coalesces
  // with any read already in flight, so this never starts a second concurrent
  // reconciliation.
  const outcome = await refreshRecoveryState();
  if (outcome && outcome.ok) {
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
  }));

  const sync = useCallback(() => {
    setView(prev => (
      prev.snapshot === lastAuthoritativeSnapshot
        && prev.lifecycle === recoveryLifecycle
        ? prev
        : {
          snapshot: lastAuthoritativeSnapshot,
          lifecycle: recoveryLifecycle,
        }
    ));
  }, []);

  const refresh = useCallback(() => refreshRecoveryState(), []);

  useEffect(() => {
    sync();
    // Single shared subscription (#711 review finding 3, rounds 1 and 2): the
    // FIRST consumer to mount (in this process, or after every previous one
    // has unmounted) is the one that both kicks off the initial authoritative
    // read AND owns the ongoing listeners that trigger every LATER automatic
    // read — the `recoveryListeners` mutation/import notification and the
    // sync-completion broadcast. Every other consumer mounted at the same
    // time only subscribes to the resulting snapshot/lifecycle (`sync`); it
    // registers no listener of its own. Owning the listener registration
    // itself, not just the mount-time call, is what collapses N mounted
    // consumers down to exactly one refresh per signal.
    recoveryBlockStateConsumerCount += 1;
    if (recoveryBlockStateConsumerCount === 1) {
      refreshRecoveryState();
      recoveryListeners.push(sharedRecoveryBlockStateRefresh);
      recoverySharedSyncUnsubscribe = subscribeSyncState(handleSharedSyncState);
    }
    // Subscribing to the shared snapshot as well as the lifecycle status is what
    // makes Log and Analytics agree while mounted together: a publish from
    // either one's read (or from `useRecoveryAnalyticsFilter`) re-renders both
    // against the SAME object.
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
      // `ready` is the only safe basis for treating an empty `blocks` array as
      // "no recovery blocks exist". Until it is true the arrays are placeholders.
      // Read directly off the CURRENTLY PUBLISHED snapshot's own `verified`
      // flag — not a separately-tracked module boolean — so a later publish
      // of different, less-trusted data cannot leave a stale "verified" bit
      // pointing at content it never actually verified (#711 review finding 1).
      ready: !!verified,
      // Initial load only. A terminal first-load failure is NOT loading — it has
      // its own error/retry state — and a refresh over verified data is
      // `refreshing`, so the two progress kinds stay distinguishable.
      loading: !verified && status !== RECOVERY_STATUS.ERROR,
      refreshing: status === RECOVERY_STATUS.REFRESHING,
      stale: status === RECOVERY_STATUS.STALE,
      staleError: refreshError,
      error,
      // Recovery eligibility and every mutation stay closed until persisted
      // state is verified — and stay closed while the journal itself is
      // corrupt even over an otherwise-verified (STALE) snapshot, since the
      // journal contract says recovery actions are paused in that case
      // (#711 review finding 2).
      mutationsAllowed: !!verified && status !== RECOVERY_STATUS.ERROR && !journalCorrupt,
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

// Consumer refcount backing the single-shared-subscription behavior above.
// Module scope (not a ref) because it must be shared across every
// simultaneously mounted `useRecoveryBlockState` instance, not per-component.
let recoveryBlockStateConsumerCount = 0;

// The ONE listener registered in `recoveryListeners` for the lifetime of the
// shared subscription (i.e. while `recoveryBlockStateConsumerCount > 0`), and
// the ONE sync-completion subscription backing it — module-level singletons,
// not per-hook-instance closures, which is what makes "N mounted consumers,
// one refresh per signal" hold for every later automatic trigger (a
// recovery mutation, a restored backup, a completed cloud sync), not merely
// for the initial mount (#711 review finding 3, round 2).
const sharedRecoveryBlockStateRefresh = () => refreshRecoveryState();
let recoverySharedSyncUnsubscribe = null;
let recoverySharedLastSyncStatus = null;
const handleSharedSyncState = (syncState) => {
  const s = syncState?.[SYNC_PHASE.SYNC];
  if (s && s.status === SYNC_STATUS.COMPLETE && recoverySharedLastSyncStatus !== SYNC_STATUS.COMPLETE) {
    refreshRecoveryState();
  }
  recoverySharedLastSyncStatus = s ? s.status : null;
};

// ── normal-analytics membership filter store (#699) ───────────────────────────

// TWO separate snapshots, not one shared object (#711 review finding 1). Each
// consumer owns its own snapshot entirely, so neither can ever overwrite what
// the other renders — the fix for a retention regression where a later,
// less-trusted filter publish replaced the record `useRecoveryBlockState`
// renders, evicting last-known-good data and turning a later refresh failure
// into a terminal ERROR instead of STALE (breaking #716's last-known-good
// requirement):
//
// - `lastAuthoritativeSnapshot` is written ONLY by the reconcile-then-read
//   pass (`publishRecoverySnapshot`). This is what `useRecoveryBlockState`
//   renders, and it is what `ensureVerifiedRecoveryState`/mutation gates
//   check. Once verified, it is never un-verified or overwritten by anything
//   BUT a later authoritative publish — a plain filter read cannot touch it,
//   so last-known-good data and the mutation-trust flag can never drift out
//   of sync with each other, and a refresh failure always sees the same
//   long-lived record it always did.
// - `lastFilterSnapshot` is written by EITHER the authoritative pass (whose
//   data is strictly better evidence) or a plain filter read. This is what
//   `useRecoveryAnalyticsFilter` renders. It is free to move forward on
//   unreconciled data because nothing downstream of it ever authorizes a
//   mutation — that boundary lives entirely on `lastAuthoritativeSnapshot`.
let lastAuthoritativeSnapshot = { blocks: [], weeks: [], verified: false };
let lastAuthoritativeSignature = '';
let lastFilterSnapshot = { blocks: [], weeks: [] };
let lastFilterSignature = '';
// Gates `useRecoveryAnalyticsFilter`'s own `ready` only — true once EITHER
// the authoritative pass or a plain filter read has produced a real
// (possibly unreconciled) result at least once in this process. This is
// deliberately NOT what gates Log's mutations; that lives entirely on
// `lastAuthoritativeSnapshot.verified` above, which only the authoritative
// pass can set true.
let recoveryFilterVerified = false;

// Everyone who renders from either shared snapshot: every mounted
// `useRecoveryAnalyticsFilter` AND every mounted `useRecoveryBlockState`. One
// publish notifies both kinds of subscriber; each hook's own `sync` only
// re-renders when the specific module-level record IT reads actually
// changed identity, so a filter-only publish causes no extra render for
// `useRecoveryBlockState` and vice versa.
let recoverySnapshotSubscribers = [];

// Authoritative publish: called ONLY by the reconcile-then-read pass.
// Updates BOTH snapshots — reconciled data is strictly better evidence than a
// plain filter read, so it satisfies the filter boundary too — but the two
// records stay independently addressable, so nothing here can ever cause a
// LATER filter-only publish to affect `lastAuthoritativeSnapshot`.
//
// All state (both snapshots' data, `recoveryFilterVerified`) is finalized
// BEFORE the single `safeNotify` call at the end, so every subscriber that
// reacts to this publish — including a `useRecoveryAnalyticsFilter` that was
// previously stuck unverified after a cold failure — observes the complete,
// consistent result of this read in one render, not a partial one (publishing
// then flipping `recoveryFilterVerified` afterward would let a subscriber
// notified in between read the new data with the OLD, unverified boundary).
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
  safeNotify(recoverySnapshotSubscribers);
  return lastAuthoritativeSnapshot;
}

// Filter-only publish: called by the read-only `useRecoveryAnalyticsFilter`
// refresh. Touches ONLY `lastFilterSnapshot` — an ordinary, unreconciled
// filter read can never reach `lastAuthoritativeSnapshot`, so it can neither
// grant mutation trust it never earned (finding 1, round 1) nor evict the
// last-known-good data `useRecoveryBlockState` is rendering (finding 1,
// round 3).
function publishRecoveryFilterSnapshot(blocks, weeks) {
  const signature = _recoverySignature(blocks, weeks);
  if (signature !== lastFilterSignature || !recoveryFilterVerified) {
    lastFilterSignature = signature;
    lastFilterSnapshot = { blocks, weeks };
  }
  recoveryFilterVerified = true;
  safeNotify(recoverySnapshotSubscribers);
  return lastFilterSnapshot;
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

export function runRecoveryFilterRead() {
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
// The filter hook (recoveryAnalyticsHooks.js) renders from this store's
// `lastFilterSnapshot`/`recoveryFilterVerified` and registers on the SAME
// registries the read-lifecycle hook uses. These accessors keep that state
// owned solely here — the hook holds no copy — preserving the exact
// push-then-filter bookkeeping and read-fresh-at-call-time semantics.
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

// Module-level broadcast for recovery records that changed outside the hook
// mutations above — today, a restored local backup, which replaces both
// collections wholesale without going through any lifecycle action. Mirrors
// `reloadWorkoutNotes` in workoutNoteHooks.js: every mounted subscriber re-reads
// so a mounted Home/Analytics cannot keep serving the pre-import memberships and
// preferences.
export function reloadRecoveryBlocks() {
  notifyRecoveryBlocks();
}

// Fired by every mutation hook after a verified result so consumers re-read.
export { notifyRecoveryBlocks };

// Test seam: drop the shared snapshot AND the lifecycle state built on it, so
// one test's recovery records or failed read cannot seed the next test's first
// render.
export function _resetRecoveryAnalyticsFilterCache() {
  lastAuthoritativeSnapshot = { blocks: [], weeks: [], verified: false };
  lastAuthoritativeSignature = '';
  lastFilterSnapshot = { blocks: [], weeks: [] };
  lastFilterSignature = '';
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
  recoveryBlockStateConsumerCount = 0;
  recoverySharedSyncUnsubscribe = null;
  recoverySharedLastSyncStatus = null;
}
