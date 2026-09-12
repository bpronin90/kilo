// Offline sync engine (Phase 4 / Task 11) — public barrel.
//
// Pure, transport-agnostic last-write-wins (LWW) sync primitives used by the
// cloud storage adapter. The implementation was split into focused modules
// under ./sync (issue #1061); this file is the unchanged public surface every
// consumer (hooks, screens, the cloud adapter, and the test suites) imports
// from. It re-exports each symbol as a plain value binding, exactly as the
// former single-file module did, so existing `jest.spyOn(syncQueue, ...)` and
// `import * as` mock seams keep working.
//
// The engine owns:
//
//   - sync metadata stamping (`client_id`, `updated_at`, `deleted_at`) and the
//     deterministic LWW merge — ./sync/records
//   - the per-table dirty queue, persisted in AsyncStorage so offline edits
//     survive a restart and still push after reconnect — ./sync/dirtyQueue
//   - per-table pull cursors (server snapshot-xmin boundaries) and cursor trust
//     — ./sync/cursors
//   - last-synced baseline snapshots and the diff engine — ./sync/snapshots
//   - signed-out write reconciliation (issue #525) — ./sync/reconciliation
//   - the per-table sync loop that ties them together — ./sync/tableSync
//
// The cloud transport (Supabase) is injected, so this engine is fully testable
// without a network and without coupling to bootstrap (#319). The roadmap loop
// shape is: pull changed rows since cursor -> merge into local cache -> push
// dirty local records -> advance the per-table cursor only after a successful
// push.

import * as records from './sync/records';
import * as dirtyQueue from './sync/dirtyQueue';
import * as cursors from './sync/cursors';
import * as snapshots from './sync/snapshots';
import * as reconciliation from './sync/reconciliation';
import * as tableSync from './sync/tableSync';

// ── protocol constants, client id, stamping, LWW (./sync/records) ──────────────
export const SYNC_TABLES = records.SYNC_TABLES;
export const SINGLETON_SYNC_ID = records.SINGLETON_SYNC_ID;
export const DERIVED_NOTE_FIELDS = records.DERIVED_NOTE_FIELDS;
export const getClientId = records.getClientId;
export const resetClientIdCacheForTests = records.resetClientIdCacheForTests;
export const resetStampClockForTests = records.resetStampClockForTests;
export const stampWrite = records.stampWrite;
export const stampTombstone = records.stampTombstone;
export const isTombstone = records.isTombstone;
export const isServerRow = records.isServerRow;
export const pickWinner = records.pickWinner;
export const resolveRecord = records.resolveRecord;
export const mergeRecords = records.mergeRecords;
export const stableStringify = records.stableStringify;

// ── dirty queue + listeners (./sync/dirtyQueue) ────────────────────────────────
export const subscribeDirtyQueue = dirtyQueue.subscribeDirtyQueue;
export const enqueueDirty = dirtyQueue.enqueueDirty;
export const enqueueDirtyMany = dirtyQueue.enqueueDirtyMany;
export const getDirtyRecords = dirtyQueue.getDirtyRecords;
export const clearDirty = dirtyQueue.clearDirty;

// ── cursors + cursor trust (./sync/cursors) ────────────────────────────────────
export const getCursor = cursors.getCursor;
export const setCursor = cursors.setCursor;
export const clearCursor = cursors.clearCursor;
export const maxUpdatedAt = cursors.maxUpdatedAt;
export const assessCursorTrust = cursors.assessCursorTrust;

// ── snapshots + diff engine (./sync/snapshots) ─────────────────────────────────
export const getSyncSnapshot = snapshots.getSyncSnapshot;
export const setSyncSnapshot = snapshots.setSyncSnapshot;
export const clearSyncSnapshot = snapshots.clearSyncSnapshot;
export const purgeDerivedSectionsFromWorkoutNoteSyncState =
  snapshots.purgeDerivedSectionsFromWorkoutNoteSyncState;
export const samePayload = snapshots.samePayload;
export const diffAgainstBaseline = snapshots.diffAgainstBaseline;

// ── signed-out write reconciliation (./sync/reconciliation) ────────────────────
export const SyncReconciliationConflictError = reconciliation.SyncReconciliationConflictError;
export const reconcileAgainstBaseline = reconciliation.reconcileAgainstBaseline;
export const reconcileAgainstRemote = reconciliation.reconcileAgainstRemote;
export const reconcileLocalWrites = reconciliation.reconcileLocalWrites;

// ── per-table sync loop (./sync/tableSync) ─────────────────────────────────────
export const syncTable = tableSync.syncTable;
export const syncDiffTable = tableSync.syncDiffTable;
