// Contract tests for the sync-queue module split (issue #1061).
//
// storage/syncQueue.js was split into six focused modules under storage/sync
// (records, dirtyQueue, cursors, snapshots, reconciliation, tableSync) behind an
// unchanged public barrel. These tests pin the contract that split must not
// break:
//
//   * the exact public export surface (nothing dropped, nothing leaked),
//   * every storage key string,
//   * the SINGLE ownership of each piece of shared mutable state — the monotonic
//     stamp clock, the client-id cache, the dirty-listener registry, and the
//     at-rest snapshot cache — across the modules that now touch it,
//   * the SyncReconciliationConflictError type,
//   * and the full state-transition matrix plus the adversarial fixtures the
//     card requires (stale identity, malformed cursor/snapshot, concurrent write
//     during push, partial acknowledgement, tombstone conflict, clock collision,
//     restart, and clean convergence).
//
// The point of testing through the barrel (not the individual modules) is that a
// mistake such as duplicating a singleton across two modules, or exposing a
// private helper, is exactly what would slip past module-local tests.

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as barrel from '../storage/syncQueue';
import {
  SYNC_TABLES,
  SINGLETON_SYNC_ID,
  DERIVED_NOTE_FIELDS,
  getClientId,
  resetClientIdCacheForTests,
  resetStampClockForTests,
  subscribeDirtyQueue,
  stampWrite,
  stampTombstone,
  isTombstone,
  isServerRow,
  pickWinner,
  resolveRecord,
  mergeRecords,
  stableStringify,
  enqueueDirty,
  enqueueDirtyMany,
  getDirtyRecords,
  clearDirty,
  getCursor,
  setCursor,
  clearCursor,
  maxUpdatedAt,
  assessCursorTrust,
  SyncReconciliationConflictError,
  syncTable,
  getSyncSnapshot,
  setSyncSnapshot,
  clearSyncSnapshot,
  samePayload,
  diffAgainstBaseline,
  syncDiffTable,
  reconcileAgainstBaseline,
  reconcileAgainstRemote,
  reconcileLocalWrites,
} from '../storage/syncQueue';
import { makeXidFakeCloud } from './mocks/xidFakeCloud';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ISO = (s) => new Date(s).toISOString();

beforeEach(async () => {
  await AsyncStorage.clear();
  resetClientIdCacheForTests();
  resetStampClockForTests();
});

// ── public export surface ───────────────────────────────────────────────────────

describe('public export surface', () => {
  const EXPECTED_EXPORTS = {
    SYNC_TABLES: 'object',
    SINGLETON_SYNC_ID: 'string',
    DERIVED_NOTE_FIELDS: 'object',
    getClientId: 'function',
    resetClientIdCacheForTests: 'function',
    subscribeDirtyQueue: 'function',
    resetStampClockForTests: 'function',
    stampWrite: 'function',
    stampTombstone: 'function',
    isTombstone: 'function',
    isServerRow: 'function',
    pickWinner: 'function',
    resolveRecord: 'function',
    mergeRecords: 'function',
    enqueueDirty: 'function',
    enqueueDirtyMany: 'function',
    getDirtyRecords: 'function',
    clearDirty: 'function',
    getCursor: 'function',
    setCursor: 'function',
    clearCursor: 'function',
    maxUpdatedAt: 'function',
    assessCursorTrust: 'function',
    SyncReconciliationConflictError: 'function',
    syncTable: 'function',
    getSyncSnapshot: 'function',
    setSyncSnapshot: 'function',
    clearSyncSnapshot: 'function',
    purgeDerivedSectionsFromWorkoutNoteSyncState: 'function',
    stableStringify: 'function',
    samePayload: 'function',
    diffAgainstBaseline: 'function',
    syncDiffTable: 'function',
    reconcileAgainstBaseline: 'function',
    reconcileAgainstRemote: 'function',
    reconcileLocalWrites: 'function',
  };

  it('exposes every documented export with the right type', () => {
    for (const [name, type] of Object.entries(EXPECTED_EXPORTS)) {
      expect(typeof barrel[name]).toBe(type);
    }
  });

  it('does not leak private cross-module helpers or key constants', () => {
    const PRIVATE = [
      'PULL_META_FIELD',
      'ROW_XID_FIELD',
      'CLIENT_ID_KEY',
      'DIRTY_KEY_PREFIX',
      'dirtyKey',
      'stripDirtyMap',
      'parseCommitSafeCursor',
      'normalizePullResult',
      'advanceCursorFromServerEvidence',
      'payloadFingerprint',
      'snapshotKey',
    ];
    for (const name of PRIVATE) expect(barrel[name]).toBeUndefined();
  });

  it('preserves the frozen protocol constants', () => {
    expect(Object.isFrozen(SYNC_TABLES)).toBe(true);
    expect(Object.isFrozen(DERIVED_NOTE_FIELDS)).toBe(true);
    expect(SINGLETON_SYNC_ID).toBe('self');
    expect(SYNC_TABLES.WEIGHT_ENTRIES).toBe('weight_entries');
    expect(SYNC_TABLES.WORKOUT_NOTES).toBe('workout_notes');
    expect(SYNC_TABLES.USER_HEALTH_PROFILE).toBe('user_health_profile');
    expect(SYNC_TABLES.RECOVERY_BLOCK_WEEKS).toBe('recovery_block_weeks');
    expect(DERIVED_NOTE_FIELDS).toContain('session_checkins');
  });
});

// ── storage keys ─────────────────────────────────────────────────────────────

describe('storage keys', () => {
  it('writes the exact documented AsyncStorage keys and nothing else', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    await getClientId();
    await enqueueDirty(table, { id: 'k1', weight_value: 100 });
    await setCursor(table, 'xid:7');
    await setSyncSnapshot(table, [{ id: 'k1' }]);

    const keys = (await AsyncStorage.getAllKeys()).sort();
    expect(keys).toEqual(
      [
        'kilo_sync_client_id',
        'kilo_sync_cursor_weight_entries',
        'kilo_sync_dirty_weight_entries',
        'kilo_sync_snapshot_weight_entries',
      ].sort()
    );
  });

  it('clearCursor and clearSyncSnapshot remove their exact keys', async () => {
    const table = SYNC_TABLES.DELOAD_HISTORY;
    await setCursor(table, 'xid:1');
    await setSyncSnapshot(table, [{ id: 'a' }]);
    await clearCursor(table);
    await clearSyncSnapshot(table);
    expect(await getCursor(table)).toBeNull();
    expect(await getSyncSnapshot(table)).toBeNull();
  });
});

// ── singleton single-owner invariants ──────────────────────────────────────────

describe('shared mutable state has a single owner', () => {
  it('shares one monotonic stamp clock across stamping, diff, and reconcile', () => {
    resetStampClockForTests();
    // Direct stamping advances the clock.
    const w = stampWrite({ id: 'x', v: 1 }, 'c');
    // diffAgainstBaseline (snapshots module) stamps via the SAME clock, so a
    // changed row minted afterwards must be strictly newer than `w`.
    const { dirty: diffDirty } = diffAgainstBaseline({
      current: [{ id: 'x', v: 2 }],
      baseline: [{ id: 'x', v: 1, updated_at: w.updated_at, client_id: 'c' }],
      clientId: 'c',
      payloadFields: ['v'],
    });
    expect(diffDirty).toHaveLength(1);
    expect(diffDirty[0].updated_at > w.updated_at).toBe(true);

    // reconcileAgainstBaseline (reconciliation module) also shares that clock.
    const { dirty: recDirty } = reconcileAgainstBaseline({
      current: [],
      baseline: [{ id: 'gone', updated_at: w.updated_at, client_id: 'c' }],
      clientId: 'c',
    });
    expect(recDirty).toHaveLength(1);
    expect(recDirty[0].updated_at > diffDirty[0].updated_at).toBe(true);
  });

  it('mints monotonically increasing stamps within one device', () => {
    resetStampClockForTests();
    const a = stampWrite({ id: '1' }, 'c');
    const b = stampWrite({ id: '1' }, 'c');
    const c = stampTombstone({ id: '1' }, 'c');
    expect(b.updated_at > a.updated_at).toBe(true);
    expect(c.updated_at > b.updated_at).toBe(true);
  });

  it('shares one client-id cache between the barrel and syncTable', async () => {
    resetClientIdCacheForTests();
    const id1 = await getClientId();
    const res = await syncTable({
      table: SYNC_TABLES.WEIGHT_ENTRIES,
      transport: { async pull() { return []; }, async push() { return []; } },
      async readLocal() { return []; },
      async writeLocal() {},
    });
    expect(res.clientId).toBe(id1);
    // A second read returns the same cached id.
    expect(await getClientId()).toBe(id1);
  });

  it('shares one dirty-listener registry between direct enqueue and the sync loop', async () => {
    const events = [];
    const unsub = subscribeDirtyQueue(() => events.push('fire'));

    await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, { id: 'd1' });
    expect(events).toHaveLength(1);

    // syncDiffTable enqueues its diff through the dirtyQueue module's
    // enqueueDirtyMany; the externally-subscribed listener must still fire.
    events.length = 0;
    await syncDiffTable({
      table: SYNC_TABLES.DELOAD_HISTORY,
      transport: { async pull() { return []; }, async push(_t, r) { return r; } },
      async buildLocal() { return [{ id: 'row1', v: 5 }]; },
      async applyMerged() {},
      payloadFields: ['v'],
    });
    expect(events.length).toBeGreaterThanOrEqual(1);

    unsub();
    events.length = 0;
    await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, { id: 'd2' });
    expect(events).toHaveLength(0);
  });

  it('shares one at-rest snapshot cache: an identical baseline write is skipped', async () => {
    const table = SYNC_TABLES.DELOAD_HISTORY;
    const transport = { async pull() { return []; }, async push() { return []; } };
    const io = {
      async buildLocal() { return []; },
      async applyMerged() {},
      payloadFields: ['v'],
    };
    const snapKey = `kilo_sync_snapshot_${table}`;
    // The async-storage jest mock exposes setItem as a jest.fn already, so
    // jest.spyOn + mockRestore would wipe its implementation for later tests.
    // Wrap and restore the reference manually to count writes without that.
    const realSetItem = AsyncStorage.setItem;
    let setKeys = [];
    AsyncStorage.setItem = (key, value, cb) => {
      setKeys.push(key);
      return realSetItem(key, value, cb);
    };
    try {
      // Pass 1 seeds the baseline (writes the snapshot key once).
      await syncDiffTable({ table, transport, ...io });
      const writesP1 = setKeys.filter((k) => k === snapKey).length;

      // Pass 2: getSyncSnapshot grounds the at-rest cache, and setSyncSnapshot
      // sees byte-identical bytes, so it MUST skip the write. This only holds if
      // both functions read/write the same Map (single owner).
      setKeys = [];
      await syncDiffTable({ table, transport, ...io });
      const writesP2 = setKeys.filter((k) => k === snapKey).length;

      expect(writesP1).toBeGreaterThanOrEqual(1);
      expect(writesP2).toBe(0);
    } finally {
      AsyncStorage.setItem = realSetItem;
    }
  });
});

// ── SyncReconciliationConflictError type ────────────────────────────────────────

describe('SyncReconciliationConflictError', () => {
  it('preserves its name, fields, flag, and Error identity', () => {
    const err = new SyncReconciliationConflictError({
      table: 'weight_entries',
      reason: 'malformed',
      ids: ['a', 'b'],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SyncReconciliationConflictError');
    expect(err.reconciliationConflict).toBe(true);
    expect(err.table).toBe('weight_entries');
    expect(err.reason).toBe('malformed');
    expect(err.ids).toEqual(['a', 'b']);
    expect(err.message).toContain('weight_entries');
    expect(err.message).toContain('malformed');
  });
});

// ── state-transition matrix ─────────────────────────────────────────────────────

describe('state-transition matrix', () => {
  it('Local write: stamps monotonically and persists dirty intent before sync', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    resetStampClockForTests();
    const first = stampWrite({ id: 'w1', weight_value: 100 }, clientId);
    const second = stampWrite({ id: 'w1', weight_value: 101 }, clientId);
    expect(second.updated_at > first.updated_at).toBe(true);
    expect(second.deleted_at).toBeNull();
    expect(second.client_id).toBe(clientId);

    await enqueueDirty(table, second);
    // Dirty intent is durable in storage before any transport runs.
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).toContain(`kilo_sync_dirty_${table}`);
    expect(await getDirtyRecords(table)).toEqual([second]);
  });

  it('Push acknowledgement: clears only the exact acknowledged version, retaining concurrent writes', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    const older = stampWrite({ id: 'x', weight_value: 1 }, clientId, ISO('2026-07-17T10:00:00Z'));
    const newer = stampWrite({ id: 'x', weight_value: 2 }, clientId, ISO('2026-07-17T10:01:00Z'));

    await enqueueDirty(table, older);
    // A concurrent write replaces the queued snapshot under the same id.
    await enqueueDirty(table, newer);

    // Acknowledging the OLDER snapshot must not delete the replacement.
    await clearDirty(table, [older]);
    expect(await getDirtyRecords(table)).toEqual([newer]);

    // Acknowledging the exact current version clears it.
    await clearDirty(table, [newer]);
    expect(await getDirtyRecords(table)).toEqual([]);
  });

  it('Pull/cursor: advances only from a commit-safe trusted result, never a device clock', async () => {
    const cloud = makeXidFakeCloud();
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    // A local write stamped far in the future on the device clock.
    const rec = stampWrite({ id: 'w1', weight_value: 5 }, clientId, ISO('2999-01-01T00:00:00Z'));
    await enqueueDirty(table, rec);
    let local = [rec];

    await syncTable({
      table,
      transport: cloud.transport,
      async readLocal() { return local; },
      async writeLocal(l) { local = l; return l; },
    });

    const cursor = await getCursor(table);
    expect(cursor).toMatch(/^xid:\d+$/);
    // The device's future timestamp never became the cursor.
    expect(cursor).not.toContain('2999');
    expect(await getDirtyRecords(table)).toEqual([]);
    expect(cloud.remoteRow(table, 'w1')).toBeTruthy();
  });

  it('Conflict: preserves the LWW winner, tombstone ordering, and per-table derived recompute', () => {
    // Server row (no client_id) wins an exact updated_at tie so devices converge.
    const local = { id: 'x', updated_at: 't', client_id: 'c1' };
    const server = { id: 'x', updated_at: 't' };
    expect(pickWinner(local, server)).toBe(server);
    // Between two local rows the greater client_id wins.
    expect(
      pickWinner({ id: 'x', updated_at: 't', client_id: 'a' }, { id: 'x', updated_at: 't', client_id: 'b' })
    ).toEqual({ id: 'x', updated_at: 't', client_id: 'b' });

    // A tombstone competes on updated_at like any other write.
    const edit = stampWrite({ id: 'x' }, 'c', ISO('2026-01-01T00:00:00Z'));
    const laterDelete = stampTombstone({ id: 'x' }, 'c', ISO('2026-01-02T00:00:00Z'));
    expect(pickWinner(edit, laterDelete)).toBe(laterDelete);
    const earlierDelete = stampTombstone({ id: 'x' }, 'c', ISO('2026-01-01T00:00:00Z'));
    const laterEdit = stampWrite({ id: 'x' }, 'c', ISO('2026-01-02T00:00:00Z'));
    expect(pickWinner(earlierDelete, laterEdit)).toBe(laterEdit);

    // Workout-note derived recompute: same raw_text, derived cache recomputed
    // rather than trusting either side's stale value.
    const recomputeDerived = (raw) => ({ derived: raw.length });
    const resolved = resolveRecord(
      { id: 'n', raw_text: 'abc', derived: 999, updated_at: 't1', client_id: 'c' },
      { id: 'n', raw_text: 'abc', derived: 1, updated_at: 't2' },
      { table: SYNC_TABLES.WORKOUT_NOTES, recomputeDerived }
    );
    expect(resolved.derived).toBe(3);

    // mergeRecords applies LWW per id and never mutates inputs.
    const merged = mergeRecords(
      [{ id: 'a', updated_at: 't1', client_id: 'c' }],
      [{ id: 'a', updated_at: 't2' }]
    );
    expect(merged.get('a')).toEqual({ id: 'a', updated_at: 't2' });
  });

  it('Partial failure/restart: resumes from the dirty queue without dropping or duplicating a write', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    const rec = stampWrite({ id: 'w1', weight_value: 9 }, clientId, ISO('2026-08-01T00:00:00Z'));
    await enqueueDirty(table, rec);
    let local = [rec];

    let failNext = true;
    const pushed = [];
    const transport = {
      async pull() { return []; },
      async push(_t, records) {
        if (failNext) {
          failNext = false;
          throw new Error('network down');
        }
        pushed.push(records.map((r) => r.id));
      },
    };

    // First pass fails during push.
    await expect(
      syncTable({
        table,
        transport,
        async readLocal() { return local; },
        async writeLocal(l) { local = l; return l; },
      })
    ).rejects.toThrow('network down');

    // Cursor was not advanced and the dirty intent is intact for retry.
    expect(await getCursor(table)).toBeNull();
    expect(await getDirtyRecords(table)).toEqual([rec]);

    // Simulate a process restart: caches forgotten, persisted state survives.
    resetClientIdCacheForTests();
    resetStampClockForTests();

    await syncTable({
      table,
      transport,
      async readLocal() { return local; },
      async writeLocal(l) { local = l; return l; },
    });

    // Pushed exactly once, then cleared: no drop, no duplicate.
    expect(pushed).toEqual([['w1']]);
    expect(await getDirtyRecords(table)).toEqual([]);
  });

  it('Clean restoration: reconciliation converges and clears only proven stale state', () => {
    const clientId = 'cB';
    const baseline = [
      { id: 'keep', v: 1, updated_at: 't', client_id: 'c' },
      { id: 'gone', v: 2, updated_at: 't', client_id: 'c' },
    ];
    // 'keep' unchanged locally; 'gone' was deleted locally while signed out.
    const { dirty, deferred: isDeferred } = reconcileAgainstBaseline({
      current: [{ id: 'keep', v: 1 }],
      baseline,
      clientId,
    });
    expect(isDeferred).toBe(false);
    // Only the proven-stale row is enqueued, as a tombstone.
    expect(dirty).toHaveLength(1);
    expect(dirty[0].id).toBe('gone');
    expect(isTombstone(dirty[0])).toBe(true);
  });
});

// ── adversarial fixtures ────────────────────────────────────────────────────────

describe('adversarial: stale identity', () => {
  it('classifies server vs local rows and rejects a cursor ahead of the server', () => {
    expect(isServerRow({ id: 'x', updated_at: 't' })).toBe(true);
    expect(isServerRow({ id: 'x', updated_at: 't', client_id: 'c' })).toBe(false);

    expect(
      assessCursorTrust({
        cursor: '2030-01-01T00:00:00.000Z',
        remote: [{ updated_at: '2026-01-01T00:00:00.000Z' }],
      })
    ).toEqual({ trusted: false, reason: 'ahead-of-server' });

    expect(maxUpdatedAt([{ updated_at: 'a' }, { updated_at: 'c' }, { updated_at: 'b' }])).toBe('c');
  });
});

describe('adversarial: malformed cursor and snapshot', () => {
  it('reports malformed/uncorroborated/absent cursor trust and treats corrupt snapshots as absent', async () => {
    expect(assessCursorTrust({ cursor: 'not-a-cursor', remote: [] })).toEqual({
      trusted: false,
      reason: 'malformed',
    });
    expect(assessCursorTrust({ cursor: null, remote: [] })).toEqual({
      trusted: false,
      reason: 'absent',
    });
    expect(assessCursorTrust({ cursor: 'xid:42', remote: [] })).toEqual({
      trusted: true,
      reason: 'commit-safe-boundary',
    });
    expect(
      assessCursorTrust({
        cursor: '2026-06-01T00:00:00.000Z',
        remote: [{ updated_at: '2026-07-01T00:00:00.000Z' }],
      })
    ).toEqual({ trusted: false, reason: 'uncorroborated' });
    expect(
      assessCursorTrust({
        cursor: '2026-06-01T00:00:00.000Z',
        remote: [{ updated_at: '2026-06-01T00:00:00.000Z' }],
      })
    ).toEqual({ trusted: true, reason: 'corroborated' });

    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    await AsyncStorage.setItem(`kilo_sync_snapshot_${table}`, 'not json{');
    expect(await getSyncSnapshot(table)).toBeNull();
    await AsyncStorage.setItem(`kilo_sync_snapshot_${table}`, '{"not":"an array"}');
    expect(await getSyncSnapshot(table)).toBeNull();
  });

  it('surfaces an honest conflict (not a guess) on an owned device with an untrustworthy cursor', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    await setCursor(table, 'not-a-cursor');
    const transport = {
      async pull() {
        return [{ id: 'r1', weight_value: 5, updated_at: '2026-01-01T00:00:00.000Z' }];
      },
      async push() { return []; },
    };
    let local = [];

    await expect(
      syncTable({
        table,
        transport,
        async readLocal() { return local; },
        async writeLocal(l) { local = l; return l; },
        reconcileUnbaselined: true,
        ownedDevice: true,
      })
    ).rejects.toMatchObject({
      name: 'SyncReconciliationConflictError',
      reconciliationConflict: true,
      table,
      reason: 'malformed',
      ids: ['r1'],
    });

    // Nothing was deleted: the merge restored the row locally, and no baseline
    // was recorded (the pass threw before writing it).
    expect(local.map((r) => r.id)).toContain('r1');
    expect(await getSyncSnapshot(table)).toBeNull();
  });
});

describe('adversarial: concurrent write during push and partial acknowledgement', () => {
  it('keeps a same-id enqueue made while an older snapshot is in flight', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    const older = stampWrite({ id: 'race', weight_value: 1 }, clientId, ISO('2026-07-17T10:00:00Z'));
    const newer = stampWrite({ id: 'race', weight_value: 2 }, clientId, ISO('2026-07-17T10:01:00Z'));

    let local = [older];
    await enqueueDirty(table, older);

    const pushStarted = deferred();
    const releasePush = deferred();
    const pushed = [];
    let pushCount = 0;
    const transport = {
      async pull() { return []; },
      async push(_t, records) {
        pushed.push(records.map((r) => ({ ...r })));
        pushCount += 1;
        if (pushCount === 1) {
          pushStarted.resolve();
          await releasePush.promise;
        }
      },
    };

    const firstPass = syncTable({
      table,
      transport,
      async readLocal() { return local; },
      async writeLocal(l) { local = l; return l; },
    });

    await pushStarted.promise;
    // Concurrent write lands mid-push.
    local = [newer];
    await enqueueDirty(table, newer);
    releasePush.resolve();
    await firstPass;

    // The concurrent write is retained, not cleared by the older push ack.
    expect(await getDirtyRecords(table)).toEqual([newer]);
  });

  it('clears only the acknowledged subset on a partial acknowledgement', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    const a = stampWrite({ id: 'a', weight_value: 1 }, clientId);
    const b = stampWrite({ id: 'b', weight_value: 2 }, clientId);
    await enqueueDirtyMany(table, [a, b]);
    expect((await getDirtyRecords(table)).map((r) => r.id).sort()).toEqual(['a', 'b']);

    // Only 'a' is acknowledged.
    await clearDirty(table, [a]);
    expect((await getDirtyRecords(table)).map((r) => r.id)).toEqual(['b']);

    // Primitive-id form clears whatever is currently queued under that id.
    await clearDirty(table, ['b']);
    expect(await getDirtyRecords(table)).toEqual([]);
  });
});

describe('adversarial: tombstone conflict', () => {
  it('propagates a delivered signed-out delete but preserves a post-window remote row', () => {
    const clientId = 'cX';
    const cursor = '2026-06-01T00:00:00.000Z';
    const anchor = { id: 'a', updated_at: cursor }; // corroborates trust; present locally
    const gone = { id: 'gone', updated_at: '2026-05-01T00:00:00.000Z' }; // delivered, absent
    const future = { id: 'fut', updated_at: '2026-07-01T00:00:00.000Z' }; // after window, absent

    const { dirty, unresolved, cursorTrust } = reconcileAgainstRemote({
      current: [anchor],
      remote: [anchor, gone, future],
      clientId,
      cursor,
      ownedDevice: true,
    });

    expect(cursorTrust).toEqual({ trusted: true, reason: 'corroborated' });
    expect(unresolved).toEqual([]);
    const goneTombstone = dirty.find((d) => d.id === 'gone');
    expect(goneTombstone).toBeTruthy();
    expect(isTombstone(goneTombstone)).toBe(true);
    // The post-window row is preserved (no tombstone), restored by the merge.
    expect(dirty.find((d) => d.id === 'fut')).toBeUndefined();
  });

  it('needs no inference for a remote row that is already a tombstone', () => {
    const { dirty, unresolved } = reconcileAgainstRemote({
      current: [],
      remote: [{ id: 'dead', updated_at: '2026-05-01T00:00:00.000Z', deleted_at: '2026-05-01T00:00:00.000Z' }],
      clientId: 'c',
      cursor: null,
      ownedDevice: true,
    });
    expect(dirty).toEqual([]);
    expect(unresolved).toEqual([]);
  });
});

describe('adversarial: clock collision', () => {
  it('resolves identical timestamps deterministically without dropping a write', () => {
    // Same explicit timestamp from two devices: greater client_id wins, always.
    const a = stampWrite({ id: 'x' }, 'aaa', ISO('2026-01-01T00:00:00Z'));
    const b = stampWrite({ id: 'x' }, 'bbb', ISO('2026-01-01T00:00:00Z'));
    expect(a.updated_at).toBe(b.updated_at);
    expect(pickWinner(a, b)).toBe(b);
    expect(pickWinner(b, a)).toBe(b);

    // A device's own successive writes never collide (monotonic clock bumps).
    resetStampClockForTests();
    const stamps = new Set();
    for (let i = 0; i < 50; i += 1) stamps.add(stampWrite({ id: 'x' }, 'c').updated_at);
    expect(stamps.size).toBe(50);
  });
});

describe('adversarial: restart and clean convergence', () => {
  it('converges over two passes against a commit-safe transport with no duplicate push', async () => {
    const cloud = makeXidFakeCloud();
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    const rec = stampWrite({ id: 'w1', weight_value: 200 }, clientId);
    await enqueueDirty(table, rec);
    let local = [rec];

    const pass = () =>
      syncTable({
        table,
        transport: cloud.transport,
        async readLocal() { return local; },
        async writeLocal(l) { local = l; return l; },
      });

    const res1 = await pass();
    expect(res1.pushed).toBe(1);
    expect(await getDirtyRecords(table)).toEqual([]);
    expect(cloud.remoteRow(table, 'w1')).toBeTruthy();

    // Simulate a restart between passes; persisted cursor/queue drive the resume.
    resetClientIdCacheForTests();
    resetStampClockForTests();

    const res2 = await pass();
    expect(res2.pushed).toBe(0);
    expect(cloud.calls.push).toBe(1); // pushed exactly once across both passes
    expect(await getDirtyRecords(table)).toEqual([]);
  });

  it('reconcileLocalWrites defers with no baseline and enqueues a tombstone once one exists', async () => {
    const table = SYNC_TABLES.ARCHIVED_WEIGHT_GOALS;
    // No snapshot yet: reconciliation is deferred to syncTable's unbaselined pass.
    const deferredResult = await reconcileLocalWrites({
      table,
      async readLocal() { return [{ id: 'x' }]; },
    });
    expect(deferredResult).toMatchObject({ table, reconciled: 0, deferred: true });
    expect(await getDirtyRecords(table)).toEqual([]);

    // With a baseline, a locally-deleted row is enqueued as a tombstone.
    await setSyncSnapshot(table, [{ id: 'gone', updated_at: 't', client_id: 'c' }]);
    const result = await reconcileLocalWrites({
      table,
      async readLocal() { return []; },
    });
    expect(result).toMatchObject({ table, reconciled: 1, deferred: false });
    const queue = await getDirtyRecords(table);
    expect(queue).toHaveLength(1);
    expect(isTombstone(queue[0])).toBe(true);
  });
});

// ── diff-engine helpers (samePayload / stableStringify) ─────────────────────────

describe('diff-engine payload comparison', () => {
  it('normalizes number and timestamp spellings and is key-order independent', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    // numeric string vs number are equal under the number kind.
    expect(samePayload({ n: '5.0' }, { n: 5 }, ['n'], { n: 'number' })).toBe(true);
    // Z vs +00:00 timestamp spellings are equal under the timestamp kind.
    expect(
      samePayload(
        { t: '2026-01-01T00:00:00Z' },
        { t: '2026-01-01T00:00:00+00:00' },
        ['t'],
        { t: 'timestamp' }
      )
    ).toBe(true);
    // A genuine payload difference is still detected.
    expect(samePayload({ v: 1 }, { v: 2 }, ['v'])).toBe(false);
  });
});
