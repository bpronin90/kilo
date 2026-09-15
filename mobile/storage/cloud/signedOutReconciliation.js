import { reconcileLocalWrites } from '../syncQueue';
import { createTableIo, COLLECTION_SYNC_TABLES } from './syncTableIo';
import { isRecoverySyncTable } from './syncRecoveryResolution';

// Reconcile writes made while signed out (issue #525).
//
// Only the CLOUD adapter enqueues dirty records at write time, so anything the
// user created, edited, or deleted while signed out is invisible to the sync
// loop: the pass pushes nothing and still reports success. This diffs each
// collection table against the baseline syncTable persists and enqueues whatever
// diverged, so the ordinary loop below uploads it.
//
// Runs at the START of every sync pass rather than only on the sign-in
// transition. Sync is the single funnel every path goes through — automatic
// sign-in sync, "Sync Now", and the #538 post-purge rebuild — so putting the
// reconciliation here means no caller can reach a successful SYNC phase without
// it, and a reconciliation that fails throws out of the phase runner instead of
// letting the UI show "Fully synced" over unreconciled local data. On a device
// with nothing to reconcile it is a keyed O(rows) comparison that enqueues
// nothing, so repeated passes stay idempotent.
//
// This is the STEADY-STATE half only. A table with no baseline yet returns
// `deferred: true` and enqueues nothing here, because local state alone cannot
// distinguish a signed-out write from an untouched row — syncTable handles that
// table against a full pull instead (see reconcileAgainstRemote). Both halves
// run inside the same sync phase, so neither can be skipped on the way to a
// successful SYNC.
//
// Recovery reconciliation is isolated (issue #693) for the same reason its sync
// pass is: an unreadable recovery collection — the fail-closed CorruptStorageError
// readList raises for a key whose bytes will not parse — must not stop weight
// entries and workout notes from reconciling and uploading. The failure is
// carried out on the result instead of thrown, and runSyncPass raises it after
// the rest of the pass has completed, so it is reported rather than swallowed.
export async function reconcileSignedOutWrites(tableIo = createTableIo(() => {})) {
  const results = [];
  for (const table of COLLECTION_SYNC_TABLES) {
    const reconcile = () => reconcileLocalWrites({ table, readLocal: tableIo[table].read });
    if (!isRecoverySyncTable(table)) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await reconcile());
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      results.push(await reconcile());
    } catch (error) {
      results.push({ table, reconciled: 0, deferred: false, error });
    }
  }
  return results;
}
