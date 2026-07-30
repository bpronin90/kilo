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
import { markComplete, markFailed, markRunning, SYNC_PHASE } from '../../storage/syncRecovery';

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

export async function maybeSyncCloud() {
  if (getStorageMode() !== STORAGE_MODES.CLOUD) return;
  const adapter = getStorageAdapter();
  if (typeof adapter.sync !== 'function') return;
  markRunning(SYNC_PHASE.SYNC);
  try {
    await withRecoveryReconciliation(() => adapter.sync());
    markComplete(SYNC_PHASE.SYNC);
  } catch (error) {
    // Offline or transient failure: keep the local cache, expose a retryable
    // phase state, and invalidate any older complete/synced display.
    markFailed(SYNC_PHASE.SYNC, error);
  }
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
