// Adversarial fixtures for the sync-queue module split (issue #1061).
// Verifies that the public barrel re-exports are wired to the correct
// implementations after records/dirtyQueue/cursors/snapshots/tableSync/
// reconciliation were separated, and that no invariant relies on co-location.

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  SYNC_TABLES,
  SINGLETON_SYNC_ID,
  SyncReconciliationConflictError,
  assessCursorTrust,
  clearCursor,
  clearDirty,
  clearSyncSnapshot,
  diffAgainstBaseline,
  enqueueDirty,
  enqueueDirtyMany,
  getClientId,
  getCursor,
  getDirtyRecords,
  getSyncSnapshot,
  isTombstone,
  maxUpdatedAt,
  mergeRecords,
  pickWinner,
  reconcileAgainstBaseline,
  reconcileAgainstRemote,
  reconcileLocalWrites,
  resetClientIdCacheForTests,
  resetStampClockForTests,
  samePayload,
  setCursor,
  setSyncSnapshot,
  stableStringify,
  stampTombstone,
  stampWrite,
  subscribeDirtyQueue,
  syncDiffTable,
  syncTable,
} from '../storage/syncQueue';

const TABLE = SYNC_TABLES.WEIGHT_ENTRIES;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetClientIdCacheForTests();
  resetStampClockForTests();
});

// ── stale identity ─────────────────────────────────────────────────────────────

describe('stale identity', () => {
  it('getClientId returns the same id after a cache reset if storage is intact', async () => {
    const id1 = await getClientId();
    resetClientIdCacheForTests();
    const id2 = await getClientId();
    expect(id2).toBe(id1);
  });

  it('getClientId mints a new id when storage is cleared and cache is reset', async () => {
    const id1 = await getClientId();
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    const id2 = await getClientId();
    expect(id2).not.toBe(id1);
  });

  it('concurrent getClientId calls share one id even before storage settles', async () => {
    const [a, b, c] = await Promise.all([getClientId(), getClientId(), getClientId()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ── malformed cursor ───────────────────────────────────────────────────────────

describe('malformed cursor', () => {
  it('assessCursorTrust returns malformed for non-ISO, non-xid cursor', () => {
    const trust = assessCursorTrust({ cursor: 'not-a-cursor', remote: [] });
    expect(trust.trusted).toBe(false);
    expect(trust.reason).toBe('malformed');
  });

  it('assessCursorTrust treats absent cursor as absent, not malformed', () => {
    const trust = assessCursorTrust({ cursor: null, remote: [] });
    expect(trust.trusted).toBe(false);
    expect(trust.reason).toBe('absent');
  });

  it('assessCursorTrust trusts an xid cursor unconditionally', () => {
    const trust = assessCursorTrust({
      cursor: 'xid:99999999',
      remote: [{ id: 'r1', updated_at: '2030-01-01T00:00:00.000Z' }],
    });
    expect(trust.trusted).toBe(true);
    expect(trust.reason).toBe('commit-safe-boundary');
  });

  it('assessCursorTrust detects a future-clock-poisoned cursor', () => {
    const remote = [{ id: 'r1', updated_at: '2026-01-01T00:00:00.000Z' }];
    const trust = assessCursorTrust({ cursor: '2030-01-01T00:00:00.000Z', remote });
    expect(trust.trusted).toBe(false);
    expect(trust.reason).toBe('ahead-of-server');
  });

  it('assessCursorTrust is uncorroborated when no remote row matches cursor', () => {
    const remote = [{ id: 'r1', updated_at: '2026-01-01T00:00:00.001Z' }];
    const trust = assessCursorTrust({ cursor: '2026-01-01T00:00:00.000Z', remote });
    expect(trust.trusted).toBe(false);
    expect(trust.reason).toBe('uncorroborated');
  });
});

// ── malformed snapshot ─────────────────────────────────────────────────────────

describe('malformed snapshot', () => {
  it('getSyncSnapshot returns null for a non-array JSON value', async () => {
    await AsyncStorage.setItem('kilo_sync_snapshot_weight_entries', JSON.stringify({ not: 'array' }));
    expect(await getSyncSnapshot(TABLE)).toBeNull();
  });

  it('getSyncSnapshot returns null for corrupt JSON', async () => {
    await AsyncStorage.setItem('kilo_sync_snapshot_weight_entries', 'not-json');
    expect(await getSyncSnapshot(TABLE)).toBeNull();
  });

  it('clearSyncSnapshot forces next getSyncSnapshot to null even if key still present', async () => {
    await setSyncSnapshot(TABLE, [{ id: 'a', updated_at: '2026-01-01T00:00:00.000Z' }]);
    await clearSyncSnapshot(TABLE);
    expect(await getSyncSnapshot(TABLE)).toBeNull();
  });
});

// ── concurrent write during push ───────────────────────────────────────────────

describe('concurrent write during push', () => {
  it('clearDirty does not remove a record whose snapshot changed while in-flight', async () => {
    const clientId = await getClientId();
    const v1 = stampWrite({ id: 'r1', weight_value: 100 }, clientId);
    await enqueueDirty(TABLE, v1);

    // Snapshot the queue for the push batch.
    const batch = await getDirtyRecords(TABLE);

    // A concurrent local write replaces the record while "in-flight".
    const v2 = stampWrite({ id: 'r1', weight_value: 110 }, clientId);
    await enqueueDirty(TABLE, v2);

    // The push succeeds and tries to clear v1's snapshot.
    await clearDirty(TABLE, batch);

    // v2 must still be queued — the snapshot changed.
    const remaining = await getDirtyRecords(TABLE);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].weight_value).toBe(110);
  });

  it('enqueueDirtyMany fires dirty listeners once, not once per record', async () => {
    const clientId = await getClientId();
    const listener = jest.fn();
    const unsub = subscribeDirtyQueue(listener);
    const records = Array.from({ length: 5 }, (_, i) =>
      stampWrite({ id: `r${i}`, weight_value: i }, clientId)
    );
    await enqueueDirtyMany(TABLE, records);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });
});

// ── partial acknowledgement ────────────────────────────────────────────────────

describe('partial acknowledgement', () => {
  it('syncTable retains dirty records when push throws', async () => {
    const clientId = await getClientId();
    const record = stampWrite({ id: 'r1', weight_value: 80 }, clientId);
    await enqueueDirty(TABLE, record);

    const transport = {
      pull: async () => [],
      push: async () => { throw new Error('Network error'); },
    };
    let local = [record];

    await expect(
      syncTable({
        table: TABLE,
        transport,
        readLocal: async () => local,
        writeLocal: async (list) => { local = list; return list; },
      })
    ).rejects.toThrow('Network error');

    const dirty = await getDirtyRecords(TABLE);
    expect(dirty.some((d) => d.id === 'r1')).toBe(true);
  });

  it('syncTable does not advance the cursor when push fails', async () => {
    const clientId = await getClientId();
    await setCursor(TABLE, '2026-06-01T00:00:00.000Z');
    const record = stampWrite({ id: 'r1', weight_value: 90 }, clientId);
    await enqueueDirty(TABLE, record);

    const transport = {
      pull: async () => [],
      push: async () => { throw new Error('Push failed'); },
    };
    let local = [record];

    await expect(
      syncTable({
        table: TABLE,
        transport,
        readLocal: async () => local,
        writeLocal: async (list) => { local = list; return list; },
      })
    ).rejects.toThrow();

    expect(await getCursor(TABLE)).toBe('2026-06-01T00:00:00.000Z');
  });
});

// ── tombstone conflict ─────────────────────────────────────────────────────────

describe('tombstone conflict', () => {
  it('pickWinner: later tombstone beats earlier live record', () => {
    const a = { id: 'r1', updated_at: '2026-01-01T00:00:00.001Z', deleted_at: '2026-01-01T00:00:00.001Z', client_id: 'c1' };
    const b = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z', client_id: 'c1' };
    expect(pickWinner(a, b)).toBe(a);
    expect(isTombstone(pickWinner(a, b))).toBe(true);
  });

  it('pickWinner: later live record beats earlier tombstone (revive)', () => {
    const a = { id: 'r1', updated_at: '2026-01-01T00:00:00.001Z', client_id: 'c1' };
    const b = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: '2026-01-01T00:00:00.000Z', client_id: 'c1' };
    const winner = pickWinner(a, b);
    expect(winner).toBe(a);
    expect(isTombstone(winner)).toBe(false);
  });

  it('stampWrite clears deleted_at on a tombstoned record (revive)', () => {
    const tombstone = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: '2026-01-01T00:00:00.000Z' };
    const revived = stampWrite(tombstone, 'c1');
    expect(revived.deleted_at).toBeNull();
    expect(isTombstone(revived)).toBe(false);
  });

  it('reconcileAgainstBaseline produces a tombstone for a locally deleted live row', () => {
    const base = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z', client_id: 'c1' };
    const { dirty } = reconcileAgainstBaseline({
      current: [],
      baseline: [base],
      clientId: 'c1',
    });
    expect(dirty).toHaveLength(1);
    expect(isTombstone(dirty[0])).toBe(true);
    expect(dirty[0].id).toBe('r1');
  });

  it('reconcileAgainstBaseline does not re-tombstone an already-synced tombstone', () => {
    const base = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: '2026-01-01T00:00:00.000Z', client_id: 'c1' };
    const { dirty } = reconcileAgainstBaseline({
      current: [],
      baseline: [base],
      clientId: 'c1',
    });
    expect(dirty).toHaveLength(0);
  });
});

// ── clock collision ─────────────────────────────────────────────────────────────

describe('clock collision (monotonic stamping)', () => {
  it('rapid successive stampWrite calls produce strictly increasing updated_at', () => {
    const clientId = 'c1';
    const stamps = Array.from({ length: 10 }, (_, i) =>
      stampWrite({ id: `r${i}` }, clientId).updated_at
    );
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i] > stamps[i - 1]).toBe(true);
    }
  });

  it('after resetStampClockForTests, a new stamp is still valid ISO', () => {
    resetStampClockForTests();
    const record = stampWrite({ id: 'r1' }, 'c1');
    expect(new Date(record.updated_at).toISOString()).toBe(record.updated_at);
  });
});

// ── restart recovery ───────────────────────────────────────────────────────────

describe('restart recovery', () => {
  it('dirty queue survives AsyncStorage persistence across a simulated restart', async () => {
    const clientId = await getClientId();
    const record = stampWrite({ id: 'r1', weight_value: 50 }, clientId);
    await enqueueDirty(TABLE, record);

    // Simulate restart: reset in-memory caches, AsyncStorage data persists.
    resetClientIdCacheForTests();
    resetStampClockForTests();

    const dirty = await getDirtyRecords(TABLE);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].id).toBe('r1');
  });

  it('cursor survives restart and is re-read correctly', async () => {
    await setCursor(TABLE, '2026-07-01T00:00:00.000Z');
    resetClientIdCacheForTests();
    expect(await getCursor(TABLE)).toBe('2026-07-01T00:00:00.000Z');
  });

  it('snapshot survives restart and is re-read correctly', async () => {
    const snap = [{ id: 'r1', updated_at: '2026-07-01T00:00:00.000Z' }];
    await setSyncSnapshot(TABLE, snap);
    resetClientIdCacheForTests();
    const loaded = await getSyncSnapshot(TABLE);
    expect(loaded).toEqual(snap);
  });
});

// ── clean convergence ──────────────────────────────────────────────────────────

describe('clean convergence', () => {
  it('two-device LWW: higher updated_at wins regardless of client_id', () => {
    const a = { id: 'r1', updated_at: '2026-01-02T00:00:00.000Z', client_id: 'c_zzz' };
    const b = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z', client_id: 'c_aaa' };
    expect(pickWinner(a, b)).toBe(a);
    expect(pickWinner(b, a)).toBe(a);
  });

  it('two-device LWW: server row beats local row on tied updated_at', () => {
    const local = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z', client_id: 'c1' };
    const server = { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z' }; // no client_id
    expect(pickWinner(local, server)).toBe(server);
  });

  it('mergeRecords: all devices converge on the same winner map', () => {
    const local = [
      { id: 'r1', updated_at: '2026-01-02T00:00:00.000Z', client_id: 'c1' },
      { id: 'r2', updated_at: '2026-01-01T00:00:00.000Z', client_id: 'c1' },
    ];
    const remote = [
      { id: 'r1', updated_at: '2026-01-01T00:00:00.000Z' }, // older; local wins
      { id: 'r2', updated_at: '2026-01-02T00:00:00.000Z' }, // newer; remote wins
    ];
    const merged = mergeRecords(local, remote);
    expect(merged.get('r1').client_id).toBe('c1');
    expect(merged.get('r2').client_id).toBeUndefined();
  });

  it('reconcileAgainstBaseline deferred=false and deferred=true are correct', () => {
    const { deferred: withBaseline } = reconcileAgainstBaseline({
      current: [],
      baseline: [],
      clientId: 'c1',
    });
    expect(withBaseline).toBe(false);

    const { deferred: withoutBaseline } = reconcileAgainstBaseline({
      current: [],
      baseline: null,
      clientId: 'c1',
    });
    expect(withoutBaseline).toBe(true);
  });

  it('reconcileAgainstRemote on clean device (absent cursor, ownedDevice=false) yields no unresolved', () => {
    const remote = [{ id: 'r1', updated_at: '2026-07-01T00:00:00.000Z' }];
    const { unresolved } = reconcileAgainstRemote({
      current: [],
      remote,
      clientId: 'c1',
      cursor: null,
      ownedDevice: false,
    });
    expect(unresolved).toHaveLength(0);
  });

  it('reconcileAgainstRemote on owned device (absent cursor, ownedDevice=true) reports unresolved', () => {
    const remote = [{ id: 'r1', updated_at: '2026-07-01T00:00:00.000Z' }];
    const { unresolved } = reconcileAgainstRemote({
      current: [],
      remote,
      clientId: 'c1',
      cursor: null,
      ownedDevice: true,
    });
    expect(unresolved).toContain('r1');
  });

  it('syncTable with unresolved conflict throws SyncReconciliationConflictError', async () => {
    // Place a remote row that cannot be classified because cursor is missing on an owned device.
    const remoteRow = { id: 'mystery', updated_at: '2026-07-01T00:00:00.000Z' };
    const transport = {
      pull: async () => [remoteRow],
      push: async () => undefined,
    };
    let local = [];

    await expect(
      syncTable({
        table: TABLE,
        transport,
        readLocal: async () => local,
        writeLocal: async (list) => { local = list; return list; },
        reconcileUnbaselined: true,
        ownedDevice: true,
        knownUnbaselined: true,
      })
    ).rejects.toBeInstanceOf(SyncReconciliationConflictError);
  });

  it('stableStringify is key-order-independent', () => {
    const a = stableStringify({ z: 1, a: 2 });
    const b = stableStringify({ a: 2, z: 1 });
    expect(a).toBe(b);
  });

  it('samePayload ignores postgres type round-trips (numeric as string)', () => {
    const a = { id: 'r1', weight_value: 80 };
    const b = { id: 'r1', weight_value: '80' };
    expect(samePayload(a, b, ['weight_value'], { weight_value: 'number' })).toBe(true);
  });

  it('diffAgainstBaseline seeded pass never infers a delete for a missing row', () => {
    const baseline = [{ id: 'cloud-only', updated_at: '2026-01-01T00:00:00.000Z' }];
    const { localList, dirty } = diffAgainstBaseline({
      current: [],
      baseline,
      clientId: 'c1',
      payloadFields: ['weight_value'],
      seeded: true,
    });
    expect(dirty).toHaveLength(0);
    expect(localList.some((r) => r.id === 'cloud-only')).toBe(true);
  });

  it('maxUpdatedAt advances past null current', () => {
    const records = [
      { updated_at: '2026-01-02T00:00:00.000Z' },
      { updated_at: '2026-01-01T00:00:00.000Z' },
    ];
    expect(maxUpdatedAt(records, null)).toBe('2026-01-02T00:00:00.000Z');
  });

  it('reconcileLocalWrites returns deferred=true when no snapshot exists', async () => {
    const result = await reconcileLocalWrites({
      table: TABLE,
      readLocal: async () => [{ id: 'r1', updated_at: '2026-01-01T00:00:00.000Z' }],
    });
    expect(result.deferred).toBe(true);
    expect(await getDirtyRecords(TABLE)).toHaveLength(0);
  });

  it('syncDiffTable on a seeded pass does not re-stamp unchanged cloud row', async () => {
    const cloudTs = '2026-05-01T00:00:00.000Z';
    const cloudRow = { id: SINGLETON_SYNC_ID, weight_value: 70, updated_at: cloudTs };
    const transport = {
      pull: async () => [cloudRow],
      push: async () => undefined,
    };
    const applied = [];
    await syncDiffTable({
      table: SYNC_TABLES.WEIGHT_GOAL,
      transport,
      buildLocal: async () => [{ id: SINGLETON_SYNC_ID, weight_value: 70 }],
      applyMerged: async (list) => applied.push(...list),
      payloadFields: ['weight_value'],
    });
    // The merged row should carry the cloud's timestamp, not a fresh local one.
    expect(applied[0].updated_at).toBe(cloudTs);
  });
});

// ── export-surface parity ──────────────────────────────────────────────────────

describe('export surface parity', () => {
  // Exact set of names the original syncQueue.js exported before the split.
  // If a private helper leaks into the barrel, this test catches it; if a
  // required export disappears, it also catches that.
  const EXPECTED_EXPORTS = new Set([
    'DERIVED_NOTE_FIELDS',
    'SINGLETON_SYNC_ID',
    'SYNC_TABLES',
    'SyncReconciliationConflictError',
    'assessCursorTrust',
    'clearCursor',
    'clearDirty',
    'clearSyncSnapshot',
    'diffAgainstBaseline',
    'enqueueDirty',
    'enqueueDirtyMany',
    'getClientId',
    'getCursor',
    'getDirtyRecords',
    'getSyncSnapshot',
    'isServerRow',
    'isTombstone',
    'maxUpdatedAt',
    'mergeRecords',
    'pickWinner',
    'purgeDerivedSectionsFromWorkoutNoteSyncState',
    'reconcileAgainstBaseline',
    'reconcileAgainstRemote',
    'reconcileLocalWrites',
    'resetClientIdCacheForTests',
    'resetStampClockForTests',
    'resolveRecord',
    'samePayload',
    'setCursor',
    'setSyncSnapshot',
    'stableStringify',
    'stampTombstone',
    'stampWrite',
    'subscribeDirtyQueue',
    'syncDiffTable',
    'syncTable',
  ]);

  it('barrel exports exactly the original public surface — no more, no less', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const barrel = require('../storage/syncQueue');
    const actual = new Set(Object.keys(barrel).filter((k) => k !== '__esModule'));
    const extra = [...actual].filter((k) => !EXPECTED_EXPORTS.has(k));
    const missing = [...EXPECTED_EXPORTS].filter((k) => !actual.has(k));
    expect(extra).toEqual([]);
    expect(missing).toEqual([]);
  });
});
