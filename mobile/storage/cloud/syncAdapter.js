// Public barrel for the cloud sync adapter (issue #1062).
//
// The implementation was split out of this file — which had grown past 1,800
// lines — into focused modules under storage/cloud/, one per concern:
//
//   syncRecoveryResolution.js  pure cross-device duplicate-Recovery resolution,
//                              statement-safe push ordering, recovery table set
//   syncTableIo.js             the pass-scoped table cache, phantom-note cleanup,
//                              deleted-block membership cascade, per-table I/O map
//   syncSingletons.js          singleton / diff-tracked table mappings + DIFF_TABLES
//   signedOutReconciliation.js reconcile writes made while signed out (#525)
//   syncOrchestrator.js        the sync pass, pending-intent read, RecoverySyncError,
//                              and the process-local cloud-operation queue
//   syncRebuild.js             the reconsent post-purge cloud rebuild (#538)
//
// Every name previously exported from this file remains exported here unchanged,
// so the adapter API, its mock seams, and RecoverySyncError's identity are
// preserved for all callers and tests.
export {
  resolveDuplicateActiveBlocks,
  resolveDuplicateWeekMemberships,
} from './syncRecoveryResolution';
export { cascadeDeletedBlockMemberships } from './syncTableIo';
export { reconcileSignedOutWrites } from './signedOutReconciliation';
export { getPendingSyncIntent, RecoverySyncError, sync } from './syncOrchestrator';
export { rearmGatedTablesForRebuild, rebuildCloudCopy } from './syncRebuild';
