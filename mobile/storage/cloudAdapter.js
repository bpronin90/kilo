// Public compatibility barrel for the cloud storage adapter.
// Implementation is split into focused modules under storage/cloud/.
// All previously-exported names remain available from this file.

import * as Storage from './entries';
import { ADAPTER_METHODS } from './localAdapter';
import { CloudNotImplementedError } from './cloud/errors';
import { sync } from './cloud/syncAdapter';
import { bootstrapFromLocal } from './cloud/bootstrap';
import {
  loadWeightEntries,
  saveWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  loadWorkoutNotes,
  saveWorkoutNoteItem,
  deleteWorkoutNoteItem,
} from './cloud/cloudDomainMethods';

export { CloudNotImplementedError } from './cloud/errors';
export { BootstrapError } from './cloud/errors';
export { synthesizeSessionsNote, buildBootstrapPlan } from './cloud/bootstrapPlan';
export { bootstrapFromLocal, isLocalDataEmpty } from './cloud/bootstrap';
export { setCloudTransport } from './cloud/transport';
export { setRecomputeDerived } from './cloud/transport';
export { sync } from './cloud/syncAdapter';
// The recovery operation journal's cloud-mode deletion-outcome probe (#696).
// Deliberately NOT an adapter method: it is protocol machinery for the journal,
// not a domain call any screen or hook makes, and the adapter surface is a
// contract pinned 1:1 against the local adapter.
export { loadWorkoutNoteDeletionState } from './cloud/cloudDomainMethods';

// ── recovery blocks + week memberships (issues #692/#693) ────────────────────
//
// Cloud mode delegates these straight to the same storage module local mode
// uses, with no write-time enqueue wrapper — deliberately, and it is the one
// place in this adapter where that is the RIGHT answer rather than a shortcut.
//
// The recovery domain enforces cross-record invariants (one active block, one
// live membership per note, domain-assigned ordinals) that need to see the whole
// collection, so every write goes through recoveryStorage regardless of adapter.
// A queue hook here would therefore capture only the SIGNED-IN half of that, and
// the sync engine would still need the other half. It already has a mechanism
// that covers both: reconcileSignedOutWrites (#525) diffs each collection
// against the last server-confirmed baseline at the start of every pass, which
// detects a write whichever adapter made it, including one made while signed
// out. Adding a second, partial detection path on top would create two ways for
// a row to become dirty and only one of them correct.
//
// The visible consequence is that a recovery write is stamped at SYNC time
// rather than edit time, so the convergence rule for these two tables is the one
// documented in syncQueue.js for the diff-tracked tables: last write to REACH
// the server wins. getPendingSyncIntent reports these tables through the same
// baseline reconciliation, so "pending upload" stays accurate between the write
// and the pass.
const RECOVERY_METHODS = {
  loadRecoveryBlocks: (...args) => Storage.loadRecoveryBlocks(...args),
  getActiveRecoveryBlock: (...args) => Storage.getActiveRecoveryBlock(...args),
  createRecoveryBlock: (...args) => Storage.createRecoveryBlock(...args),
  updateRecoveryBlock: (...args) => Storage.updateRecoveryBlock(...args),
  completeRecoveryBlock: (...args) => Storage.completeRecoveryBlock(...args),
  deleteRecoveryBlock: (...args) => Storage.deleteRecoveryBlock(...args),
  loadRecoveryBlockWeeks: (...args) => Storage.loadRecoveryBlockWeeks(...args),
  loadRecoveryWeeksForBlock: (...args) => Storage.loadRecoveryWeeksForBlock(...args),
  addRecoveryWeek: (...args) => Storage.addRecoveryWeek(...args),
  updateRecoveryWeek: (...args) => Storage.updateRecoveryWeek(...args),
  completeRecoveryWeek: (...args) => Storage.completeRecoveryWeek(...args),
  deleteRecoveryWeek: (...args) => Storage.deleteRecoveryWeek(...args),
};

const IMPLEMENTED = {
  sync,
  loadWeightEntries,
  saveWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  loadWorkoutNotes,
  saveWorkoutNoteItem,
  deleteWorkoutNoteItem,
  ...RECOVERY_METHODS,
};

function buildCloudAdapter() {
  const adapter = { mode: 'cloud', sync };
  for (const method of ADAPTER_METHODS) {
    adapter[method] = IMPLEMENTED[method]
      ? IMPLEMENTED[method]
      : () => {
          throw new CloudNotImplementedError(method);
        };
  }
  adapter.bootstrapFromLocal = bootstrapFromLocal;
  return adapter;
}

export const cloudAdapter = buildCloudAdapter();

export default cloudAdapter;
