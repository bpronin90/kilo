import { getStorageAdapter, getStorageMode, STORAGE_MODES } from '../../storage/entries';
import {
  RECOVERY_OPERATION_CODES,
  setRecoveryNoteOperations,
  withExclusiveRecoveryAccess,
} from '../../storage/entries/recoveryOperationJournal';
import * as Storage from '../../storage/entries';
import {
  loadWorkoutNoteDeletionState as cloudLoadWorkoutNoteDeletionState,
  ensureWorkoutNoteDeleted as cloudEnsureWorkoutNoteDeleted,
  loadWorkoutNotePresenceState as cloudLoadWorkoutNotePresenceState,
  ensureWorkoutNoteLive as cloudEnsureWorkoutNoteLive,
} from '../../storage/cloud/cloudDomainMethods';
import { getSyncState, markComplete, markFailed, markRunning, SYNC_PHASE, SYNC_STATUS } from '../../storage/syncRecovery';

// ── recovery journal ↔ storage mode wiring (#696) ────────────────────────────
//
// The recovery operation journal owns the "delete a linked workout note"
// outcome, but the note deletion itself must go through whichever adapter is
// active — local hard-delete, or cloud tombstone plus sync-queue bookkeeping.
// The journal lives in the storage layer and cannot import this hook module, so
// the mode-aware implementation is registered into it here, once, at load.
//
// Registered as thunks that resolve the mode at CALL time, not at load time: the
// user can sign in, sign out, or switch storage modes while a pending operation
// is journaled, and reconciliation must always use the adapter that is current
// when it runs. Local-only remains the default inside the journal, so repairing
// local invariants never requires network access or a signed-in session.
function isCloudMode() {
  return getStorageMode() === STORAGE_MODES.CLOUD;
}

// Exported so a test (or a module-registry reset) can re-establish the
// registration after `__resetRecoveryOperationJournal()` restores the journal's
// local-only default. Production calls it exactly once, at module load, below.
export function registerRecoveryNoteOperations() {
  setRecoveryNoteOperations({
    // The deletion-outcome probe is not an adapter method: the adapter surface is
    // pinned 1:1 against the local adapter and describes DOMAIN calls, while this
    // is journal protocol machinery. It is selected by mode directly instead.
    loadNoteState: (noteId) => (isCloudMode()
      ? cloudLoadWorkoutNoteDeletionState(noteId)
      : Storage.loadWorkoutNoteDeletionState(noteId)),
    // `deletedAt` is the journal record's immutable requested timestamp. Cloud mode
    // needs it to reconstruct a tombstone for a note this device already
    // hard-deleted in local mode before the storage mode changed — without it the
    // deletion would be declared finished locally and never reach the server.
    deleteNote: async (noteId, { deletedAt = null } = {}) => {
      if (isCloudMode()) {
        await cloudEnsureWorkoutNoteDeleted(noteId, { deletedAt });
      } else {
        await Storage.deleteWorkoutNoteItem(noteId);
      }
      // The cloud adapter tombstones the row but does not own the "current
      // routine" pointer, so a cloud-mode delete would otherwise leave the Log
      // tab pointing at a note that no longer exists. Local mode already does
      // this inside deleteWorkoutNoteItem; repeating it is idempotent.
      const currentId = await Storage.loadCurrentWorkoutId();
      if (currentId === noteId) await Storage.clearCurrentWorkoutId();
    },
    // The new-note week operation's own pair. `loadNoteLiveState` asks whether the
    // note is durably LIVE (not merely present, and not a tombstone), which in
    // cloud mode includes queued upload intent — `saveWorkoutNoteItem` persists
    // the row before it enqueues, so existence alone would verify a note that may
    // never upload. `ensureNoteLive` is the idempotent repair for every state that
    // check can reject, driven from the journal's recorded seed.
    loadNoteLiveState: (noteId) => (isCloudMode()
      ? cloudLoadWorkoutNotePresenceState(noteId)
      : Storage.loadWorkoutNotePresenceState(noteId)),
    ensureNoteLive: (noteSeed) => (isCloudMode()
      ? cloudEnsureWorkoutNoteLive(noteSeed)
      : Storage.saveWorkoutNoteItem({ ...noteSeed, deleted_at: null })),
    });
}

registerRecoveryNoteOperations();

// Raised when a sync pass cannot honestly be reported as complete because a
// recovery lifecycle operation over workout notes, recovery blocks, or recovery
// weeks is still unresolved. Carries the reconciliation cause so the existing
// failed/retryable sync surface can explain WHY rather than showing a bare
// transport error.
export class RecoveryReconciliationPendingError extends Error {
  constructor(reconciliation) {
    super(
      reconciliation?.error ||
        'A recovery lifecycle operation is still pending, so recovery data is not fully synced.'
    );
    this.name = 'RecoveryReconciliationPendingError';
    this.code = reconciliation?.code || RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING;
    this.pending = reconciliation?.pending || [];
    if (reconciliation?.cause != null) this.cause = reconciliation.cause;
  }
}

// Wrap a cloud sync/bootstrap runner in the two reconciliation boundaries the
// #696 contract requires:
//
//   * BEFORE the pass, so a pending operation is replayed to its final outcome
//     before this device reads or pushes workout notes, recovery blocks, or
//     recovery weeks. Pushing mid-operation state would publish a partial
//     transition to every other device.
//   * AFTER the pull/merge and before publishing success, because a remote
//     change can alter an affected record while an operation is pending.
//
// A still-pending operation fails the pass. That is deliberate: reporting
// "synced" over a collection this device knows is mid-transition is the same
// dishonesty the recovery-table isolation in syncAdapter.js exists to avoid.
// The ENTIRE sequence — pre-reconcile, the pass, post-reconcile — holds the
// recovery-operation guard, so no journaled lifecycle action can execute while the
// pass is in flight. That exclusion is the point, not an optimisation: both sides
// read and rewrite whole `recovery_blocks`/`recovery_block_weeks` arrays, so an
// interleaving loses whichever change is written first, and the post-pass
// reconciliation cannot see it once the UI operation has verified and cleared its
// own record. Reconciliation inside the callback deliberately skips re-acquiring
// the guard (that is what `reconcile` is), so the nesting cannot deadlock.
export async function withRecoveryReconciliation(run) {
  return withExclusiveRecoveryAccess(async ({ reconcile }) => {
    const before = await reconcile();
    if (!before.ok) throw new RecoveryReconciliationPendingError(before);
    const result = await run();
    const after = await reconcile();
    if (!after.ok) throw new RecoveryReconciliationPendingError(after);
    return result;
  });
}

// The pass outcome belongs to the phase only while the phase still describes
// THIS pass. Sign-out (or any other switch back to local mode) resets the SYNC
// phase to idle while a pass may still be in flight; letting that pass mark the
// phase complete or failed afterwards would leave a signed-out device with a
// non-idle status, and the next sign-in's automatic sync only runs from idle -
// so a write made while signed out would sit unuploaded until something else
// triggered a pass (issue #813 review). If the phase is no longer running, or
// storage is no longer in cloud mode, whoever changed it owns it now.
function passStillOwnsPhase() {
  return (
    getStorageMode() === STORAGE_MODES.CLOUD &&
    getSyncState()[SYNC_PHASE.SYNC].status === SYNC_STATUS.RUNNING
  );
}

async function runCloudSyncPass(adapter) {
  markRunning(SYNC_PHASE.SYNC);
  try {
    await withRecoveryReconciliation(() => adapter.sync());
    if (passStillOwnsPhase()) markComplete(SYNC_PHASE.SYNC);
  } catch (error) {
    // Offline or transient failure: keep the local cache, expose a retryable
    // phase state, and invalidate any older complete/synced display.
    if (passStillOwnsPhase()) markFailed(SYNC_PHASE.SYNC, error);
  }
}

// Coalescing state for maybeSyncCloud (issue #813). `inFlightSync` describes
// the pass running (or about to run) right now; `trailingSync` is the single
// follow-up pass promised to every caller that arrived after that pass began.
let inFlightSync = null;
let trailingSync = null;

// Run a cloud sync pass for the caller, sharing passes between concurrent
// callers (issue #813).
//
// Every write broadcast fans out to every mounted useWorkoutNotes() /
// useWeightEntries() instance, and each instance's refresh() calls this. Those
// calls used to run one full pass EACH: adapter.sync() is single-flight, but the
// recovery-reconciliation guard around it is a strict queue, so the second
// caller only reached sync() after the first pass had finished and released its
// in-flight slot. One Log autosave with every tab mounted therefore ran three
// complete pull/merge/push passes back to back - three times the round trips
// and three times the full-table decrypts - for one write.
//
// The rule now. A caller's own writes are already durable when it calls (the
// hooks await the write, then broadcast), so what it needs is a pass that reads
// the dirty queue AFTER its call:
//   * no pass pending: start one - deferred by a microtask, so every caller in
//     the same synchronous fan-out joins it before it does any work;
//   * a pass is pending but has NOT started: join it, for the same reason;
//   * a pass has started: it may already have read the queue, so do not join
//     it - but do not start another one immediately either. Such callers are
//     promised exactly ONE trailing pass, shared with everyone else who arrives
//     while the current pass runs.
// So N callers arriving together cost one pass; a burst of writes during a pass
// costs one more, not N more; and every caller still gets a pass that began
// after its call, which is what makes its write eligible for upload in the pass
// it awaits. Broadcasting after the write is exactly as durable as before.
//
// Resolves `true` when a pass ran on the caller's behalf (successfully or not -
// a failed pass still marks the phase failed and may have merged some tables, so
// callers reload either way) and `false` when nothing ran because storage was
// not in cloud mode, re-checked at the moment a pass actually starts.
export function maybeSyncCloud() {
  if (getStorageMode() !== STORAGE_MODES.CLOUD) return Promise.resolve(false);
  const adapter = getStorageAdapter();
  if (typeof adapter.sync !== 'function') return Promise.resolve(false);

  if (inFlightSync && !inFlightSync.started) return inFlightSync.promise;

  if (!inFlightSync) {
    const entry = { started: false, promise: null };
    entry.promise = Promise.resolve().then(() => {
      entry.started = true;
      if (getStorageMode() !== STORAGE_MODES.CLOUD) return false;
      return runCloudSyncPass(getStorageAdapter()).then(() => true);
    });
    inFlightSync = entry;
    const clear = () => {
      if (inFlightSync === entry) inFlightSync = null;
    };
    entry.promise.then(clear, clear);
    return entry.promise;
  }

  if (!trailingSync) {
    trailingSync = inFlightSync.promise.then(() => {
      trailingSync = null;
      return maybeSyncCloud();
    });
  }
  return trailingSync;
}

// Test-only: forget any pending pass so suites that swap adapters or transports
// between tests never inherit a promise from a previous test.
export function __resetMaybeSyncCloudForTests() {
  inFlightSync = null;
  trailingSync = null;
}

export function readVia(method, localFn, ...args) {
  if (getStorageMode() === STORAGE_MODES.CLOUD) {
    const adapter = getStorageAdapter();
    if (typeof adapter[method] === 'function') return adapter[method](...args);
  }
  return localFn(...args);
}

export function writeVia(method, localFn, ...args) {
  if (getStorageMode() === STORAGE_MODES.CLOUD) {
    const adapter = getStorageAdapter();
    if (typeof adapter[method] === 'function') return adapter[method](...args);
  }
  return localFn(...args);
}
