// Backup-import application command extracted from App.js (#1495).
//
// Owns the ORDER of the import boundaries and nothing else: resolve the
// storage mode, await the durable restore, then (only when it committed)
// refresh the mounted domains. The backup engine (validation + durable
// restore) and the refresh implementations are injected, so this module has no
// storage or React dependency and App.js keeps the existing mock seams.
//
// Failure policy is unchanged: a rejected restore propagates to the caller and
// triggers NO refresh; a resolved { ok: false } result (validation or write
// failure reported by the engine) is returned as-is with NO refresh.
//
// deps:
//   importBackup(payload, mode, options) -> Promise<{ ok, ... }>
//   getStorageMode()                     -> active storage mode (may be absent)
//   refreshers                           -> post-commit refresh callbacks, run
//                                           synchronously in array order
export async function runBackupImport(payload, { importBackup, getStorageMode, refreshers = [] }) {
  // Import has a local contract and a cloud contract (#526): passing the active
  // storage mode is what makes a signed-in user's "replace" stamp and queue the
  // imported rows and tombstone the records the backup dropped (#522 claim 5).
  // Resolved defensively because app-shell tests mock './storage/entries' with a
  // partial object. An unresolvable mode falls back to the local contract, which
  // never fabricates sync intent.
  const mode = typeof getStorageMode === 'function' ? getStorageMode() : undefined;
  const result = await importBackup(payload, 'replace', { mode });
  if (result.ok) {
    for (const refresh of refreshers) refresh();
  }
  return result;
}
