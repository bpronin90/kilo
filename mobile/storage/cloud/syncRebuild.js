import {
  SYNC_TABLES,
  enqueueDirtyMany,
  clearCursor,
  clearSyncSnapshot,
} from '../syncQueue';
import { createTableIo, COLLECTION_SYNC_TABLES } from './syncTableIo';
import { enqueueCloudOperation, runSyncPass } from './syncOrchestrator';

// ── reconsent cloud rebuild (issue #538) ─────────────────────────────────────
//
// A completed withdrawal purge empties every gated table server-side. If the
// SAME device later re-grants, its dirty queue is already empty (everything it
// held was acknowledged before withdrawal) and every diff-tracked table's
// last-synced snapshot already agrees with what is now an intentionally empty
// cloud copy — so ordinary sync() above has nothing to detect and pushes
// nothing. The server tells the client this explicitly via a monotonic
// consent_state.cloud_rebuild_generation (storage/cloud/consent.js); when the
// server's generation is ahead of the one THIS device last rebuilt for
// (storage/entries/localDataOwner.js), the app runs rebuildCloudCopy() instead
// of an ordinary sync pass (see hooks/entries/syncRecoveryHooks.js).
//
// The rebuild reuses the SAME engine ordinary sync() uses for every one of the
// seven gated tables, rather than a separate one-off upload path: it only
// rearms each table's local bookkeeping so the next sync() pass treats every
// local record — live rows AND tombstones, since a tombstone is itself a row
// the purge deleted and omitting it would leave row-count parity wrong even
// though it stays invisible — as unpushed, then lets the ordinary
// pull/push/merge loop do the actual work. That keeps tombstone handling, LWW,
// and cursor advancement identical to every other sync pass instead of a
// second, differently-tested code path, and it naturally never pulls the
// (intentionally empty) post-purge cloud snapshot over local state first: the
// merge step unions local-only records straight into the push set exactly as
// it does for any other unsynced local write.
// The same dirty-queue-tracked collections defined above; every one of them is
// consent-gated and therefore emptied by a withdrawal purge. The two recovery
// collections (#693) are gated the same way and are included for the same
// reason — a rebuild that skipped them would leave the account's recovery
// history on the device only.
const REBUILD_COLLECTION_TABLES = COLLECTION_SYNC_TABLES;

// The diff-tracked tables among the seven gated ones. FEATURE_TOGGLES and
// USER_PROFILE are diff-tracked too but are NOT gated/purged — a withdrawal
// never touches them — so they are deliberately excluded: there is nothing on
// them to rebuild.
const REBUILD_DIFF_TABLES = Object.freeze([
  SYNC_TABLES.USER_HEALTH_PROFILE,
  SYNC_TABLES.WEIGHT_GOAL,
  SYNC_TABLES.DELOAD_HISTORY,
  SYNC_TABLES.FATIGUE_CHECKINS,
]);

// Re-enqueue every local record (including tombstones) of a dirty-queue
// tracked collection table, so the next syncTable pass pushes the complete
// local set instead of only whatever a write-time hook already queued.
// Idempotent: re-enqueuing an id already in the dirty queue just overwrites
// its snapshot with the same value, and clearing an already-clear cursor is a
// no-op — so re-running this after a partial or retried rebuild is safe.
async function reseedCollectionTable(table, readLocal) {
  const list = (await readLocal()) || [];
  await enqueueDirtyMany(
    table,
    list.filter((record) => record && record.id != null)
  );
  await clearCursor(table);
}

// Rearm every consent-gated table for a full reupload.
async function runRearmGatedTablesForRebuild() {
  const tableIo = createTableIo(() => {});
  for (const table of REBUILD_COLLECTION_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await reseedCollectionTable(table, tableIo[table].read);
  }
  for (const table of REBUILD_DIFF_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await clearSyncSnapshot(table);
    // eslint-disable-next-line no-await-in-loop
    await clearCursor(table);
  }
}

export function rearmGatedTablesForRebuild() {
  return enqueueCloudOperation(runRearmGatedTablesForRebuild);
}

// The full post-purge cloud rebuild: rearm every gated table, push everything
// through the ordinary sync loop, then run one more ordinary sync pass as the
// reconciliation the acceptance criteria require — proving the rebuild
// converged and picking up anything another device pushed concurrently.
//
// Recording that this device has caught up to the server's rebuild generation
// is the CALLER's job (syncRecoveryHooks.js), done only after this resolves
// successfully: keeping the per-device generation write next to the phase
// runner is what makes "the rebuild finished" and "we recorded that it
// finished" a single retryable unit. A failure at any step propagates,
// mirroring sync()'s own contract so the existing runPhase failure handling
// applies unchanged: local data is never touched by a failure here, this
// device's persisted generation is not advanced, and the next launch simply
// sees the server generation still ahead and rebuilds again. Every retry — a
// fresh rearm, a re-push of already-acknowledged rows — is idempotent: it can
// duplicate network traffic but never duplicate rows or lose data.
let inFlightRebuild = null;

export function rebuildCloudCopy() {
  if (inFlightRebuild) return inFlightRebuild;

  const rebuild = enqueueCloudOperation(async () => {
    // Do not call the public queued functions from inside this operation: that
    // would enqueue work behind this rebuild and deadlock. The enclosing queue
    // already gives these three steps exclusive access.
    await runRearmGatedTablesForRebuild();
    const rebuildResults = await runSyncPass();
    const reconciliationResults = await runSyncPass();
    return { ok: true, results: [...rebuildResults, ...reconciliationResults] };
  });
  inFlightRebuild = rebuild;
  const clearInFlight = () => {
    if (inFlightRebuild === rebuild) inFlightRebuild = null;
  };
  rebuild.then(clearInFlight, clearInFlight);
  return rebuild;
}
