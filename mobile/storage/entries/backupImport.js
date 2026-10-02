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
export { exportBackup, buildCloudExport, hydrateProfileFromCloud } from './backupExport';
export { importBackup, IMPORT_MODES } from './backupRestore';
