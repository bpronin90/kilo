// Offline sync engine (Phase 4 / Task 11).
//
// Pure, transport-agnostic last-write-wins (LWW) sync primitives used by the
// cloud storage adapter. This module owns:
//
//   - sync metadata stamping (`client_id`, `updated_at`, `deleted_at`)
//   - the per-table dirty queue, persisted in AsyncStorage so edits made while
//     offline survive an app restart and still push after reconnect
//   - per-table pull cursors (server snapshot-xmin transaction boundaries)
//   - the deterministic LWW merge: newer `updated_at` wins; exact ties break by
//     `client_id` lexicographic order
//   - tombstone-first deletes: a delete writes a `deleted_at` tombstone that is
//     synced before any physical cleanup
//   - derived-JSON recompute: when only the cached derived fields differ but the
//     canonical `raw_text` is unchanged, the conflict is resolved by recompute,
//     never surfaced to the user
//
// The cloud transport (Supabase) is injected, so this engine is fully testable
// without a network and without coupling to bootstrap (#319). The roadmap
// loop shape is: pull changed rows since cursor -> merge into local cache ->
// push dirty local records -> advance the per-table cursor only after a
// successful push.

import {
  SYNC_TABLES as _SYNC_TABLES,
  SINGLETON_SYNC_ID as _SINGLETON_SYNC_ID,
  DERIVED_NOTE_FIELDS as _DERIVED_NOTE_FIELDS,
  getClientId as _getClientId,
  resetClientIdCacheForTests as _resetClientIdCacheForTests,
  resetStampClockForTests as _resetStampClockForTests,
  stampWrite as _stampWrite,
  stampTombstone as _stampTombstone,
  isTombstone as _isTombstone,
  isServerRow as _isServerRow,
  pickWinner as _pickWinner,
  resolveRecord as _resolveRecord,
  mergeRecords as _mergeRecords,
  stableStringify as _stableStringify,
  samePayload as _samePayload,
  SYNC_METADATA_FIELDS as _SYNC_METADATA_FIELDS,
  SyncReconciliationConflictError as _SyncReconciliationConflictError,
  payloadFingerprint as _payloadFingerprint,
} from './sync/records';

import {
  subscribeDirtyQueue as _subscribeDirtyQueue,
  enqueueDirty as _enqueueDirty,
  enqueueDirtyMany as _enqueueDirtyMany,
  getDirtyRecords as _getDirtyRecords,
  clearDirty as _clearDirty,
} from './sync/dirtyQueue';

import {
  getCursor as _getCursor,
  setCursor as _setCursor,
  clearCursor as _clearCursor,
  maxUpdatedAt as _maxUpdatedAt,
  assessCursorTrust as _assessCursorTrust,
} from './sync/cursors';

import {
  getSyncSnapshot as _getSyncSnapshot,
  setSyncSnapshot as _setSyncSnapshot,
  clearSyncSnapshot as _clearSyncSnapshot,
  purgeDerivedSectionsFromWorkoutNoteSyncState as _purgeDerivedSectionsFromWorkoutNoteSyncState,
} from './sync/snapshots';

import {
  syncTable as _syncTable,
  syncDiffTable as _syncDiffTable,
} from './sync/tableSync';

import {
  diffAgainstBaseline as _diffAgainstBaseline,
  reconcileAgainstBaseline as _reconcileAgainstBaseline,
  reconcileAgainstRemote as _reconcileAgainstRemote,
  reconcileLocalWrites as _reconcileLocalWrites,
} from './sync/reconciliation';

// Direct assignments produce writable, configurable exports so jest.spyOn works.
export const SYNC_TABLES = _SYNC_TABLES;
export const SINGLETON_SYNC_ID = _SINGLETON_SYNC_ID;
export const DERIVED_NOTE_FIELDS = _DERIVED_NOTE_FIELDS;
export const getClientId = _getClientId;
export const resetClientIdCacheForTests = _resetClientIdCacheForTests;
export const resetStampClockForTests = _resetStampClockForTests;
export const stampWrite = _stampWrite;
export const stampTombstone = _stampTombstone;
export const isTombstone = _isTombstone;
export const isServerRow = _isServerRow;
export const pickWinner = _pickWinner;
export const resolveRecord = _resolveRecord;
export const mergeRecords = _mergeRecords;
export const stableStringify = _stableStringify;
export const samePayload = _samePayload;
export const SYNC_METADATA_FIELDS = _SYNC_METADATA_FIELDS;
export const SyncReconciliationConflictError = _SyncReconciliationConflictError;
export const payloadFingerprint = _payloadFingerprint;

export const subscribeDirtyQueue = _subscribeDirtyQueue;
export const enqueueDirty = _enqueueDirty;
export const enqueueDirtyMany = _enqueueDirtyMany;
export const getDirtyRecords = _getDirtyRecords;
export const clearDirty = _clearDirty;

export const getCursor = _getCursor;
export const setCursor = _setCursor;
export const clearCursor = _clearCursor;
export const maxUpdatedAt = _maxUpdatedAt;
export const assessCursorTrust = _assessCursorTrust;

export const getSyncSnapshot = _getSyncSnapshot;
export const setSyncSnapshot = _setSyncSnapshot;
export const clearSyncSnapshot = _clearSyncSnapshot;
export const purgeDerivedSectionsFromWorkoutNoteSyncState = _purgeDerivedSectionsFromWorkoutNoteSyncState;

export const syncTable = _syncTable;
export const syncDiffTable = _syncDiffTable;

export const diffAgainstBaseline = _diffAgainstBaseline;
export const reconcileAgainstBaseline = _reconcileAgainstBaseline;
export const reconcileAgainstRemote = _reconcileAgainstRemote;
export const reconcileLocalWrites = _reconcileLocalWrites;
