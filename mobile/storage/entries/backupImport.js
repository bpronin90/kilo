// Backup engine public boundary (issue #1060).
//
// backupImport.js stays the single public entry point for the backup/import
// engine. The implementation is split across three cohesive modules, each under
// the 600-line cap, and re-exported here unchanged so every caller and test that
// imports from '.../entries/backupImport' - and the storage barrel entries.js -
// keeps working byte for byte:
//   - backupExport.js:     exportBackup, buildCloudExport, hydrateProfileFromCloud
//   - backupValidation.js: the validator primitives and format contract
//   - backupRestore.js:    importBackup, IMPORT_MODES, the validate-then-write pipeline
import { importBackup as restoreBackup } from './backupRestore';
import { withRecoveryOperationLock } from './recoveryJournalStore';
export { exportBackup, buildCloudExport, hydrateProfileFromCloud } from './backupExport';
export { IMPORT_MODES } from './backupRestore';

// A restore replaces the WHOLE recovery_blocks / recovery_block_weeks lists, like
// a sync pass or a journaled lifecycle action, and an interleaving of any two
// silently erases whichever change is written first (#1225: the baseline
// migration rewrites the same list). Every whole-list writer therefore holds the
// one recovery-operation lock; the restore runs entirely inside it, and nothing
// inside restoreBackup re-enters that lock.
export function importBackup(...args) {
  return withRecoveryOperationLock(() => restoreBackup(...args));
}
