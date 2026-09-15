// Module-split contract for the cloud sync adapter (issue #1062).
//
// syncAdapter.js was split into six focused modules — syncRecoveryResolution,
// syncTableIo, syncSingletons, signedOutReconciliation, syncOrchestrator, and
// syncRebuild — with syncAdapter.js kept as the public barrel. This suite pins
// the contract that split must preserve:
//
//   * the barrel re-exports every public name, each one the SAME reference as the
//     single module that now owns it (no name has two owners);
//   * RecoverySyncError keeps its identity (name + recoverySyncFailure flag);
//   * the shared cloud-operation queue is one owner across orchestration AND
//     rebuild (a rebuild and a sync serialize against each other);
//   * and every row of the card's state-transition matrix still holds, driven
//     end to end through the real engine against an in-memory cloud — with the
//     adversarial fixtures the card enumerates: stale/changed identity, a
//     malformed remote row, partial pull/push, a concurrent local write,
//     duplicate active blocks/weeks, phantom notes, a lost acknowledgement,
//     retry, and a clean rebuild.

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Storage from '../storage/entries';
import { setCloudTransport } from '../storage/cloudAdapter';
import { replaceArchivedWeightGoalsRaw } from '../storage/entries/weightGoal';
import {
  SYNC_TABLES,
  isTombstone,
  getDirtyRecords,
  enqueueDirtyMany,
  clearCursor,
  getSyncSnapshot,
  resetClientIdCacheForTests,
  resetStampClockForTests,
} from '../storage/syncQueue';
import { __resetSyncQueue } from '../storage/syncRecovery';

// The public barrel and each owning module, imported side by side so the suite
// can assert the barrel is a thin re-export of a single owner per name.
import * as barrel from '../storage/cloud/syncAdapter';
import * as orchestrator from '../storage/cloud/syncOrchestrator';
import * as recoveryResolution from '../storage/cloud/syncRecoveryResolution';
import * as tableIo from '../storage/cloud/syncTableIo';
import * as signedOut from '../storage/cloud/signedOutReconciliation';
import * as rebuildModule from '../storage/cloud/syncRebuild';

const {
  sync,
  rebuildCloudCopy,
  rearmGatedTablesForRebuild,
  reconcileSignedOutWrites,
  getPendingSyncIntent,
  RecoverySyncError,
  resolveDuplicateActiveBlocks,
  resolveDuplicateWeekMemberships,
  cascadeDeletedBlockMemberships,
} = barrel;

// ── in-memory fake cloud ─────────────────────────────────────────────────────
//
// Models Postgres: it accepts every upsert and stamps `updated_at` itself
// (transport.js omits the column because a trigger forces now()), and `client_id`
// is not a stored column so nothing pulled ever carries one. Adds three hooks the
// adversarial fixtures need: seedRemote (another device's row), purge (a
// withdrawal), and failPush (a push that the server never applies).
function makeFakeCloud() {
  const tables = {};
  for (const table of Object.values(SYNC_TABLES)) tables[table] = new Map();

  const singletons = new Set([
    SYNC_TABLES.USER_PROFILE,
    SYNC_TABLES.USER_HEALTH_PROFILE,
    SYNC_TABLES.FEATURE_TOGGLES,
    SYNC_TABLES.WEIGHT_GOAL,
  ]);

  const pushes = [];
  const failing = new Set();
  let lastServerMs = 0;
  function serverNow(table) {
    let maxMs = Math.max(lastServerMs, Date.now());
    for (const row of tables[table].values()) {
      const ms = Date.parse(row.updated_at || 0);
      if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
    }
    lastServerMs = maxMs + 1;
    return new Date(lastServerMs).toISOString();
  }

  const transport = {
    async pull(table, cursor) {
      const rows = [...tables[table].values()];
      const changed = cursor ? rows.filter((r) => (r.updated_at || '') >= cursor) : rows;
      const sorted = changed.sort((a, b) =>
        (a.updated_at || '').localeCompare(b.updated_at || '')
      );
      // eslint-disable-next-line no-unused-vars
      const served = sorted.map(({ client_id: _c, ...row }) => row);
      if (!singletons.has(table)) return served;
      // eslint-disable-next-line no-unused-vars
      return served.map(({ id: _id, ...row }) => row);
    },
    async push(table, records) {
      if (failing.has(table)) throw new Error(`push denied: ${table}`);
      pushes.push({ table, ids: records.map((r) => r.id) });
      const written = [];
      for (const rec of records) {
        // eslint-disable-next-line no-unused-vars
        const { client_id: _clientId, ...row } = rec;
        const stored = { ...row, updated_at: serverNow(table) };
        tables[table].set(rec.id, stored);
        written.push(singletons.has(table) ? { ...stored, id: undefined } : stored);
      }
      return written;
    },
  };

  return {
    transport,
    pushes,
    pushedIds: (table) => pushes.filter((p) => p.table === table).flatMap((p) => p.ids),
    remoteRow: (table, id) => tables[table].get(id),
    remoteRows: (table) => [...tables[table].values()],
    liveRemoteRows: (table) => [...tables[table].values()].filter((r) => !isTombstone(r)),
    // Another device wrote this row directly to the server.
    seedRemote(table, row) {
      const stored = { ...row, updated_at: row.updated_at || serverNow(table) };
      tables[table].set(row.id, stored);
      return stored;
    },
    // A withdrawal purge empties the gated tables server-side.
    purge(purged) {
      for (const table of purged) tables[table] = new Map();
    },
    failPush: (table) => failing.add(table),
    healPush: (table) => failing.delete(table),
  };
}

let cloud;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetClientIdCacheForTests();
  resetStampClockForTests();
  __resetSyncQueue();
  cloud = makeFakeCloud();
  setCloudTransport(cloud.transport);
  Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
});

afterEach(() => {
  setCloudTransport(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  __resetSyncQueue();
});

// A device that is signed in and fully synced, so a baseline exists for the
// steady-state reconciliation to diff against.
async function seedSyncedDevice() {
  const adapter = Storage.getStorageAdapter();
  await adapter.saveWeightEntry({
    id: 'w-existing',
    weight_value: 180,
    logged_at: '2026-07-01T08:00:00.000Z',
    date: '2026-07-01',
  });
  await adapter.saveWorkoutNoteItem({
    id: 'wn-existing',
    title: 'Routine A',
    raw_text: 'Squat 100x5',
    saved_at: '2026-07-01T08:00:00.000Z',
  });
  await sync();
}

// A linked recovery block (baseline note + block + one week membership) written
// straight to local storage, the way the domain writes them in both adapter modes.
async function seedLinkedRecoveryBlock() {
  const adapter = Storage.getStorageAdapter();
  await adapter.saveWorkoutNoteItem({
    id: 'wn-baseline',
    title: 'Baseline routine',
    raw_text: 'Squat 100x5',
    saved_at: '2026-08-01T08:00:00.000Z',
  });
  await Storage.replaceRecoveryBlocksRaw([
    {
      id: 'rb-1',
      baseline_note_id: 'wn-baseline',
      baseline_note_title: 'Baseline routine',
      baseline: { volume: 1000 },
      include_in_normal_analytics: false,
      started_at: '2026-08-01T09:00:00.000Z',
      completed_at: null,
      saved_at: '2026-08-01T09:00:00.000Z',
      deleted_at: null,
    },
  ]);
  await Storage.replaceRecoveryBlockWeeksRaw([
    {
      id: 'rw-1',
      block_id: 'rb-1',
      note_id: 'wn-baseline',
      week_number: 1,
      completed_at: null,
      saved_at: '2026-08-01T09:00:00.000Z',
      deleted_at: null,
    },
  ]);
}

// ── barrel is a thin, single-owner re-export ────────────────────────────────
describe('the adapter barrel preserves the public API with one owner per name', () => {
  it('re-exports every previously public name', () => {
    for (const name of [
      'sync',
      'reconcileSignedOutWrites',
      'rebuildCloudCopy',
      'rearmGatedTablesForRebuild',
      'getPendingSyncIntent',
      'RecoverySyncError',
      'resolveDuplicateActiveBlocks',
      'resolveDuplicateWeekMemberships',
      'cascadeDeletedBlockMemberships',
    ]) {
      expect(barrel[name]).toBeDefined();
    }
    expect(typeof sync).toBe('function');
    expect(typeof rebuildCloudCopy).toBe('function');
    expect(typeof rearmGatedTablesForRebuild).toBe('function');
    expect(typeof reconcileSignedOutWrites).toBe('function');
    expect(typeof getPendingSyncIntent).toBe('function');
    expect(typeof resolveDuplicateActiveBlocks).toBe('function');
    expect(typeof resolveDuplicateWeekMemberships).toBe('function');
    expect(typeof cascadeDeletedBlockMemberships).toBe('function');
    expect(typeof RecoverySyncError).toBe('function');
  });

  it('binds each name to exactly one owning module', () => {
    expect(barrel.sync).toBe(orchestrator.sync);
    expect(barrel.getPendingSyncIntent).toBe(orchestrator.getPendingSyncIntent);
    expect(barrel.RecoverySyncError).toBe(orchestrator.RecoverySyncError);
    expect(barrel.reconcileSignedOutWrites).toBe(signedOut.reconcileSignedOutWrites);
    expect(barrel.resolveDuplicateActiveBlocks).toBe(
      recoveryResolution.resolveDuplicateActiveBlocks
    );
    expect(barrel.resolveDuplicateWeekMemberships).toBe(
      recoveryResolution.resolveDuplicateWeekMemberships
    );
    expect(barrel.cascadeDeletedBlockMemberships).toBe(tableIo.cascadeDeletedBlockMemberships);
    expect(barrel.rebuildCloudCopy).toBe(rebuildModule.rebuildCloudCopy);
    expect(barrel.rearmGatedTablesForRebuild).toBe(rebuildModule.rearmGatedTablesForRebuild);
  });

  it('keeps RecoverySyncError identity intact', () => {
    const error = new RecoverySyncError([
      { table: SYNC_TABLES.RECOVERY_BLOCKS, error: new Error('boom') },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RecoverySyncError');
    expect(error.recoverySyncFailure).toBe(true);
    expect(error.failures).toHaveLength(1);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.message).toContain(SYNC_TABLES.RECOVERY_BLOCKS);
  });

  it('routes rebuild and sync through one shared cloud-operation queue', async () => {
    // If the queue had two owners, these would interleave. One owner serializes
    // them, so the rebuild's rearm/passes never overlap an in-flight sync.
    await seedSyncedDevice();
    const order = [];
    const realPush = cloud.transport.push;
    cloud.transport.push = async (table, records) => {
      order.push(`push:${table}`);
      return realPush(table, records);
    };
    const a = sync().then(() => order.push('sync-done'));
    const b = rebuildCloudCopy().then(() => order.push('rebuild-done'));
    await Promise.all([a, b]);
    cloud.transport.push = realPush;
    // The first-scheduled operation fully finishes before the second reports done.
    expect(order.indexOf('sync-done')).toBeLessThan(order.indexOf('rebuild-done'));
  });
});

// ── Missing identity: reconcile only the supported signed-out writes, else fail closed ──
describe('signed-out reconciliation reconciles only the supported tables and fails closed', () => {
  it('reconciles exactly the collection tables, once each', async () => {
    await seedSyncedDevice();
    const results = await reconcileSignedOutWrites();
    const tablesSeen = results.map((r) => r.table);
    expect(tablesSeen).toEqual([
      SYNC_TABLES.WEIGHT_ENTRIES,
      SYNC_TABLES.WORKOUT_NOTES,
      SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
      SYNC_TABLES.RECOVERY_BLOCKS,
      SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
    ]);
    // No settings/singleton table is reconciled through this path.
    expect(tablesSeen).not.toContain(SYNC_TABLES.USER_HEALTH_PROFILE);
    expect(tablesSeen).not.toContain(SYNC_TABLES.WEIGHT_GOAL);
  });

  it('carries an unreadable recovery table as an isolated failure instead of throwing', async () => {
    await seedSyncedDevice();
    const boom = new Error('recovery bytes will not parse');
    // A tableIo whose recovery read fails closed, standing in for a
    // CorruptStorageError on the recovery collection.
    const failingReadIo = {
      [SYNC_TABLES.WEIGHT_ENTRIES]: { read: () => Storage.loadWeightEntriesRaw() },
      [SYNC_TABLES.WORKOUT_NOTES]: { read: () => Storage.loadWorkoutNotesRaw() },
      [SYNC_TABLES.ARCHIVED_WEIGHT_GOALS]: {
        read: () => Storage.loadRecoveryBlocksRaw().then(() => []),
      },
      [SYNC_TABLES.RECOVERY_BLOCKS]: { read: () => Promise.reject(boom) },
      [SYNC_TABLES.RECOVERY_BLOCK_WEEKS]: { read: () => Storage.loadRecoveryBlockWeeksRaw() },
    };
    const results = await reconcileSignedOutWrites(failingReadIo);
    const blocks = results.find((r) => r.table === SYNC_TABLES.RECOVERY_BLOCKS);
    expect(blocks.error).toBe(boom);
    expect(blocks.deferred).toBe(false);
    // The unrelated tables still reconciled rather than being taken down with it.
    const weights = results.find((r) => r.table === SYNC_TABLES.WEIGHT_ENTRIES);
    expect(weights.error).toBeUndefined();
  });
});

// ── Duplicate-Recovery resolution is deterministic and content-only ──────────
describe('cross-device duplicate resolution collapses deterministically', () => {
  it('keeps the most recently started active block and completes the older one', () => {
    const blocks = [
      { id: 'rb-old', started_at: '2026-01-01T00:00:00.000Z', completed_at: null, saved_at: '2026-01-01T00:00:00.000Z' },
      { id: 'rb-new', started_at: '2026-02-01T00:00:00.000Z', completed_at: null, saved_at: '2026-02-01T00:00:00.000Z' },
    ];
    const forward = resolveDuplicateActiveBlocks(blocks, 'client-a');
    const reversed = resolveDuplicateActiveBlocks(blocks.slice().reverse(), 'client-b');

    expect(forward.changed.map((b) => b.id)).toEqual(['rb-old']);
    expect(forward.changed[0].completed_at).toBe('2026-02-01T00:00:00.000Z');
    expect(forward.list.find((b) => b.id === 'rb-new').completed_at).toBeNull();
    // Deterministic: survivor and completion are identical regardless of input
    // order or which device (client_id) runs the collapse.
    expect(reversed.changed.map((b) => b.id)).toEqual(['rb-old']);
    expect(reversed.changed[0].completed_at).toBe('2026-02-01T00:00:00.000Z');
  });

  it('tombstones the later of two live memberships for one note (rule 1)', () => {
    const weeks = [
      { id: 'rw-early', note_id: 'n1', block_id: 'b1', week_number: 1, saved_at: '2026-01-01T00:00:00.000Z' },
      { id: 'rw-late', note_id: 'n1', block_id: 'b2', week_number: 1, saved_at: '2026-02-01T00:00:00.000Z' },
    ];
    const { changed } = resolveDuplicateWeekMemberships(weeks, 'client-a');
    expect(changed.map((w) => w.id)).toEqual(['rw-late']);
    expect(isTombstone(changed[0])).toBe(true);
    // Retracted at its OWN creation time, so every device writes the same bytes.
    expect(changed[0].deleted_at).toBe('2026-02-01T00:00:00.000Z');
  });

  it('renumbers a colliding ordinal to the next free slot rather than dropping it (rule 2)', () => {
    const weeks = [
      { id: 'rw-a', note_id: 'na', block_id: 'b1', week_number: 2, saved_at: '2026-01-01T00:00:00.000Z' },
      { id: 'rw-b', note_id: 'nb', block_id: 'b1', week_number: 2, saved_at: '2026-02-01T00:00:00.000Z' },
    ];
    const { changed } = resolveDuplicateWeekMemberships(weeks, 'client-a');
    expect(changed.map((w) => w.id)).toEqual(['rw-b']);
    expect(isTombstone(changed[0])).toBe(false);
    expect(changed[0].week_number).toBe(3);
  });

  it('converges a two-device duplicate active block inside one sync() call', async () => {
    await seedSyncedDevice();
    // Another device already holds an active block; this device started its own
    // while offline. Both are legitimately active until they meet here.
    cloud.seedRemote(SYNC_TABLES.RECOVERY_BLOCKS, {
      id: 'rb-remote',
      baseline_note_id: 'wn-existing',
      baseline: { volume: 900 },
      started_at: '2026-08-10T09:00:00.000Z',
      completed_at: null,
      saved_at: '2026-08-10T09:00:00.000Z',
      deleted_at: null,
    });
    await clearCursor(SYNC_TABLES.RECOVERY_BLOCKS);
    await Storage.replaceRecoveryBlocksRaw([
      {
        id: 'rb-local',
        baseline_note_id: 'wn-existing',
        baseline: { volume: 1000 },
        started_at: '2026-08-11T09:00:00.000Z',
        completed_at: null,
        saved_at: '2026-08-11T09:00:00.000Z',
        deleted_at: null,
      },
    ]);

    await sync();

    // Exactly one active block survives across the account, and it is the most
    // recently started (rb-local). The older one is completed, not deleted.
    const live = cloud.liveRemoteRows(SYNC_TABLES.RECOVERY_BLOCKS);
    const active = live.filter((b) => !b.completed_at);
    expect(active.map((b) => b.id)).toEqual(['rb-local']);
    expect(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCKS, 'rb-remote').completed_at).toBe(
      '2026-08-11T09:00:00.000Z'
    );
  });
});

// ── Phantom notes ────────────────────────────────────────────────────────────
describe('legacy phantom notes are cleaned only when real notes coexist', () => {
  it('tombstones a live legacy phantom in local storage and pushes the tombstone', async () => {
    await seedSyncedDevice();
    const existing = await Storage.loadWorkoutNotesRaw();
    await Storage.replaceWorkoutNotesRaw([
      ...existing,
      {
        id: 'wn_legacy_owner-1',
        title: 'Legacy note',
        raw_text: 'Bench 60x5',
        saved_at: '2026-07-02T08:00:00.000Z',
      },
    ]);

    await sync();

    const local = await Storage.loadWorkoutNotesRaw();
    const phantom = local.find((n) => n.id === 'wn_legacy_owner-1');
    expect(isTombstone(phantom)).toBe(true);
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn_legacy_owner-1'))).toBe(true);
    // The real note is untouched.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn-existing'))).toBe(false);
  });

  it('preserves a legacy-only user whose sole note is the phantom', async () => {
    // Establish baselines against an empty account so this is steady-state.
    await sync();
    await Storage.replaceWorkoutNotesRaw([
      {
        id: 'wn_legacy_owner-2',
        title: 'Only note',
        raw_text: 'Deadlift 100x5',
        saved_at: '2026-07-03T08:00:00.000Z',
      },
    ]);

    await sync();

    const local = await Storage.loadWorkoutNotesRaw();
    const phantom = local.find((n) => n.id === 'wn_legacy_owner-2');
    expect(isTombstone(phantom)).toBe(false);
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn_legacy_owner-2'))).toBe(false);
  });
});

// ── Recovery dependencies: a pulled block tombstone cascades to its memberships ──
describe('a pulled block tombstone cascades to its live membership', () => {
  it('tombstones the orphaned membership locally and in the cloud', async () => {
    await seedLinkedRecoveryBlock();
    await sync();
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, 'rw-1'))).toBe(false);

    // Another device deleted the block. The tombstone arrives by pull, carrying
    // no membership cascade of its own.
    cloud.seedRemote(SYNC_TABLES.RECOVERY_BLOCKS, {
      id: 'rb-1',
      baseline_note_id: 'wn-baseline',
      baseline: { volume: 1000 },
      started_at: '2026-08-01T09:00:00.000Z',
      completed_at: null,
      saved_at: '2026-08-01T09:00:00.000Z',
      deleted_at: '2026-08-05T10:00:00.000Z',
    });
    await clearCursor(SYNC_TABLES.RECOVERY_BLOCKS);

    await sync();

    const localWeek = (await Storage.loadRecoveryBlockWeeksRaw()).find((w) => w.id === 'rw-1');
    expect(isTombstone(localWeek)).toBe(true);
    // Inherits the BLOCK's deleted_at, not now(), so the cascade is byte-stable.
    expect(localWeek.deleted_at).toBe('2026-08-05T10:00:00.000Z');
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, 'rw-1'))).toBe(true);
  });
});

// ── Partial pull/push retains work; the retry converges ──────────────────────
describe('a partial recovery push is retained and converges on retry', () => {
  it('reports RecoverySyncError while syncing every unrelated table, then converges', async () => {
    await seedSyncedDevice();
    await seedLinkedRecoveryBlock();
    // Also a plain weight write, to prove the unrelated tables complete.
    await Storage.getStorageAdapter().saveWeightEntry({
      id: 'w-partial',
      weight_value: 179,
      logged_at: '2026-08-06T08:00:00.000Z',
      date: '2026-08-06',
    });
    cloud.failPush(SYNC_TABLES.RECOVERY_BLOCKS);

    let thrown;
    try {
      await sync();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RecoverySyncError);
    expect(thrown.recoverySyncFailure).toBe(true);

    // Unrelated tables reached the cloud despite the recovery failure.
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-partial')).toMatchObject({
      weight_value: 179,
    });
    // The block never uploaded, and the dependent membership was never attempted.
    expect(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCKS, 'rb-1')).toBeUndefined();
    expect(cloud.pushedIds(SYNC_TABLES.RECOVERY_BLOCK_WEEKS)).toEqual([]);
    // The failed table never recorded a baseline over its unproven row, and the
    // local rows are retained, so the next pass rediscovers and re-pushes them.
    const blockBaseline = (await getSyncSnapshot(SYNC_TABLES.RECOVERY_BLOCKS)) || [];
    expect(blockBaseline.map((r) => r.id)).not.toContain('rb-1');
    expect((await Storage.loadRecoveryBlocksRaw()).map((r) => r.id)).toContain('rb-1');
    expect((await Storage.loadRecoveryBlockWeeksRaw()).map((r) => r.id)).toContain('rw-1');

    cloud.healPush(SYNC_TABLES.RECOVERY_BLOCKS);
    await expect(sync()).resolves.toBeDefined();
    expect(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCKS, 'rb-1')).toBeTruthy();
    expect(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, 'rw-1')).toBeTruthy();
  });
});

// ── Concurrent local write: the pass cache never erases a race ────────────────
describe('the pass cache folds in a domain write that raced its own write', () => {
  it('preserves a concurrent edit and a concurrent insert, keeping the pass write', async () => {
    const cache = tableIo.createPassCache();
    const base = [{ id: 'a', v: 1 }];
    await cache.read('t', async () => base);

    // Storage changed under the pass after it took its copy: 'a' was edited and
    // 'b' was inserted by a concurrent domain write.
    const current = [
      { id: 'a', v: 2 },
      { id: 'b', v: 9 },
    ];
    let persisted = null;
    const result = await cache.write(
      't',
      [
        { id: 'a', v: 1 },
        { id: 'c', v: 3 },
      ],
      async (list) => {
        persisted = list;
      },
      async () => current
    );

    const byId = Object.fromEntries(result.map((r) => [r.id, r.v]));
    expect(byId.a).toBe(2); // concurrent edit wins over the pass's stale copy
    expect(byId.b).toBe(9); // concurrent insert is retained, never erased
    expect(byId.c).toBe(3); // the pass's own new row is kept
    expect(persisted).toBe(result);
  });

  it('builds an isolated cache per pass so nothing leaks across passes', async () => {
    const first = tableIo.createPassCache();
    const second = tableIo.createPassCache();
    await first.read('t', async () => [{ id: 'x', v: 1 }]);
    const seen = await second.read('t', async () => [{ id: 'x', v: 2 }]);
    // The second pass reads its own source, not the first pass's cached copy.
    expect(seen).toEqual([{ id: 'x', v: 2 }]);
  });
});

// ── Lost acknowledgement: a re-armed push is idempotent, never duplicated ─────
describe('a lost acknowledgement re-pushes idempotently without duplicating rows', () => {
  it('re-pushes a row already on the server as an upsert, leaving one row', async () => {
    await seedSyncedDevice();
    const before = cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing');
    expect(before).toBeTruthy();

    // Simulate an acknowledgement that never landed: the row is still on the
    // server, but the dirty ack was lost so it is queued again.
    const local = (await Storage.loadWeightEntriesRaw()).find((r) => r.id === 'w-existing');
    await enqueueDirtyMany(SYNC_TABLES.WEIGHT_ENTRIES, [local]);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(1);

    await sync();

    // The upsert converged onto the single existing row; no duplicate appeared.
    const rows = cloud.remoteRows(SYNC_TABLES.WEIGHT_ENTRIES).filter((r) => r.id === 'w-existing');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ weight_value: 180 });
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
  });
});

// ── Malformed remote row: the singleton mapping refuses to write it ───────────
describe('a malformed remote singleton row is rejected rather than applied', () => {
  it('ignores an out-of-range fatigue multiplier and a non-object tracked_lifts', async () => {
    const localBefore = await Storage.loadFatigueMultiplier();
    // Another device (or a tampered row) serves values outside every validator.
    cloud.seedRemote(SYNC_TABLES.USER_HEALTH_PROFILE, {
      current_workout_note_id: null,
      fatigue_multiplier: 999,
      tracked_lifts: ['not', 'an', 'object'],
      updated_at: '2026-09-01T00:00:00.000Z',
    });

    await expect(sync()).resolves.toBeDefined();

    // The bogus multiplier was never written into fatigue calc.
    expect(Number(await Storage.loadFatigueMultiplier())).not.toBe(999);
    expect(Number(await Storage.loadFatigueMultiplier())).toBe(Number(localBefore));
    // The array masquerading as tracked_lifts was rejected too.
    const trackedLifts = await Storage.loadTrackedLifts();
    expect(Array.isArray(trackedLifts)).toBe(false);
  });
});

// ── Stale / changed identity: writes go to the current transport, never the old one ──
describe('an identity change gates new I/O to the current transport', () => {
  it('routes a post-swap write to the new cloud, never the old one', async () => {
    await seedSyncedDevice();
    const pushesToOldAfterSwap = () => cloud.pushes.length;

    // A new local write, then the identity's transport is swapped (account change).
    await Storage.getStorageAdapter().saveWeightEntry({
      id: 'w-after-swap',
      weight_value: 175,
      logged_at: '2026-09-02T08:00:00.000Z',
      date: '2026-09-02',
    });
    const oldCloud = cloud;
    const oldPushCount = pushesToOldAfterSwap();
    const newCloud = makeFakeCloud();
    setCloudTransport(newCloud.transport);

    await sync();

    // The pass read getTransport() fresh, so the write reached the new cloud and
    // nothing further was pushed to the old one.
    expect(newCloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-after-swap')).toMatchObject({
      weight_value: 175,
    });
    expect(oldCloud.pushes.length).toBe(oldPushCount);
  });
});

// ── Clean rebuild: rearm the gated tables, converge, delete nothing unproven ──
describe('the post-purge rebuild re-uploads live rows and tombstones and converges', () => {
  const GATED = [
    SYNC_TABLES.WEIGHT_ENTRIES,
    SYNC_TABLES.WORKOUT_NOTES,
    SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
    SYNC_TABLES.RECOVERY_BLOCKS,
    SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
    SYNC_TABLES.USER_HEALTH_PROFILE,
    SYNC_TABLES.WEIGHT_GOAL,
    SYNC_TABLES.DELOAD_HISTORY,
    SYNC_TABLES.FATIGUE_CHECKINS,
  ];

  it('rebuilds every gated table from local state, tombstones included', async () => {
    await seedSyncedDevice();
    await seedLinkedRecoveryBlock();
    // A deleted-while-synced row, so the rebuild has a tombstone to re-arm.
    await replaceArchivedWeightGoalsRaw([
      { id: 'ag-live', target_weight: 165, saved_at: '2026-08-01T08:00:00.000Z' },
      {
        id: 'ag-dead',
        target_weight: 160,
        saved_at: '2026-08-01T08:00:00.000Z',
        deleted_at: '2026-08-02T08:00:00.000Z',
      },
    ]);
    await sync();
    expect(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCKS, 'rb-1')).toBeTruthy();

    // A completed withdrawal purge emptied every gated table server-side.
    cloud.purge(GATED);
    for (const table of GATED) expect(cloud.remoteRows(table)).toHaveLength(0);

    const result = await rebuildCloudCopy();
    expect(result).toMatchObject({ ok: true });

    // Live rows are back in the cloud, rebuilt from local state.
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w-existing')).toBeTruthy();
    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'wn-existing')).toBeTruthy();
    expect(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCKS, 'rb-1')).toBeTruthy();
    expect(cloud.remoteRow(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, 'rw-1')).toBeTruthy();
    // The tombstone was re-armed too, so row-count parity is restored.
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS, 'ag-dead'))).toBe(true);
    expect(isTombstone(cloud.remoteRow(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS, 'ag-live'))).toBe(false);

    // Local data was never touched by the rebuild.
    const localWeights = (await Storage.loadWeightEntriesRaw()).map((r) => r.id);
    expect(localWeights).toContain('w-existing');
  });

  it('rearmGatedTablesForRebuild re-queues local rows without pushing', async () => {
    await seedSyncedDevice();
    // Steady state: nothing queued after a clean sync.
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);

    await rearmGatedTablesForRebuild();

    // Rearm re-queues the local set so the next pass re-uploads it, but performs
    // no upload of its own.
    const queued = await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(queued.map((r) => r.id)).toContain('w-existing');
  });
});

// ── Steady-state idempotency and honest pending-intent reporting ─────────────
describe('steady-state passes stay idempotent and report intent honestly', () => {
  it('a repeat pass with no change pushes nothing and reports nothing pending', async () => {
    await seedSyncedDevice();
    const pushesAfterSeed = cloud.pushes.length;

    await sync();
    expect(cloud.pushes.length).toBe(pushesAfterSeed);

    const intent = await getPendingSyncIntent();
    expect(intent.hasPending).toBe(false);
    expect(intent.dirtyCount).toBe(0);
  });

  it('reports a recovery write as pending before the next pass uploads it', async () => {
    await seedSyncedDevice();
    await sync();
    await seedLinkedRecoveryBlock();

    // Recovery tables have no write-time queue hook, so pending intent must come
    // from the baseline reconciliation, not the dirty queue.
    const intent = await getPendingSyncIntent();
    expect(intent.hasPending).toBe(true);
    expect(intent.tables).toEqual(
      expect.arrayContaining([SYNC_TABLES.RECOVERY_BLOCKS, SYNC_TABLES.RECOVERY_BLOCK_WEEKS])
    );
  });
});
