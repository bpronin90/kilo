import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  enqueueDirty,
  enqueueDirtyMany,
  getClientId,
  getCursor,
  getDirtyRecords,
  getSyncSnapshot,
  resetClientIdCacheForTests,
  resetStampClockForTests,
  setCursor,
  setSyncSnapshot,
  stampTombstone,
  stampWrite,
  syncDiffTable,
  syncTable,
  SYNC_TABLES,
} from '../storage/syncQueue';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cloneRecords(records) {
  return records.map((record) => JSON.parse(JSON.stringify(record)));
}

describe('dirty queue compare-and-clear', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    resetStampClockForTests();
  });

  describe.each(['live', 'tombstone'])('syncTable newer %s snapshot', (newerKind) => {
    it('keeps a same-id enqueue made while the older snapshot is pushing', async () => {
      const table = SYNC_TABLES.WEIGHT_ENTRIES;
      const clientId = await getClientId();
      const older = stampWrite(
        { id: 'weight-race', weight_value: 180 },
        clientId,
        '2026-07-17T10:00:00.000Z'
      );
      const newer =
        newerKind === 'tombstone'
          ? stampTombstone(older, clientId, '2026-07-17T10:01:00.000Z')
          : stampWrite(
              { ...older, weight_value: 181 },
              clientId,
              '2026-07-17T10:01:00.000Z'
            );

      let local = [older];
      await enqueueDirty(table, older);

      const pushStarted = deferred();
      const releaseFirstPush = deferred();
      const pushed = [];
      let pushCount = 0;
      const transport = {
        async pull() {
          return [];
        },
        async push(_table, records) {
          pushed.push(cloneRecords(records));
          pushCount += 1;
          if (pushCount === 1) {
            pushStarted.resolve();
            await releaseFirstPush.promise;
          }
        },
      };

      const firstPass = syncTable({
        table,
        transport,
        async readLocal() {
          return local;
        },
        async writeLocal(records) {
          local = records;
        },
      });

      await pushStarted.promise;
      local = [newer];
      await enqueueDirty(table, newer);
      releaseFirstPush.resolve();
      await firstPass;

      expect(await getDirtyRecords(table)).toEqual([newer]);

      await syncTable({
        table,
        transport,
        async readLocal() {
          return local;
        },
        async writeLocal(records) {
          local = records;
        },
      });

      expect(pushed).toHaveLength(2);
      expect(pushed[0]).toEqual([older]);
      expect(pushed[1]).toEqual([newer]);
      expect(await getDirtyRecords(table)).toEqual([]);
    });
  });

  describe.each(['live', 'tombstone'])('syncDiffTable newer %s snapshot', (newerKind) => {
    it('keeps a same-id enqueue made while the older snapshot is pushing', async () => {
      const table = SYNC_TABLES.DELOAD_HISTORY;
      const clientId = await getClientId();
      const older = stampWrite(
        { id: 'deload-race', raw_text: 'old' },
        clientId,
        '2026-07-17T11:00:00.000Z'
      );
      const newer =
        newerKind === 'tombstone'
          ? stampTombstone(older, clientId, '2026-07-17T11:01:00.000Z')
          : stampWrite(
              { ...older, raw_text: 'new' },
              clientId,
              '2026-07-17T11:01:00.000Z'
            );

      let current = [{ id: older.id, raw_text: older.raw_text }];
      let applied = [];
      await setSyncSnapshot(table, [older]);
      await enqueueDirty(table, older);

      const pushStarted = deferred();
      const releaseFirstPush = deferred();
      const pushed = [];
      let pushCount = 0;
      const transport = {
        async pull() {
          return [];
        },
        async push(_table, records) {
          pushed.push(cloneRecords(records));
          pushCount += 1;
          if (pushCount === 1) {
            pushStarted.resolve();
            await releaseFirstPush.promise;
          }
        },
      };
      const runPass = () =>
        syncDiffTable({
          table,
          transport,
          async buildLocal() {
            return current;
          },
          async applyMerged(records) {
            applied = records;
          },
          payloadFields: ['raw_text'],
          allowDelete: true,
        });

      const firstPass = runPass();
      await pushStarted.promise;
      current = newerKind === 'tombstone' ? [] : [{ id: newer.id, raw_text: newer.raw_text }];
      await enqueueDirty(table, newer);
      releaseFirstPush.resolve();
      await firstPass;

      expect(applied).toEqual([older]);
      expect(await getDirtyRecords(table)).toEqual([newer]);

      await runPass();

      expect(pushed).toHaveLength(2);
      expect(pushed[0]).toEqual([older]);
      if (newerKind === 'tombstone') {
        expect(pushed[1][0].id).toBe(newer.id);
        expect(pushed[1][0].deleted_at).toEqual(expect.any(String));
      } else {
        expect(pushed[1][0]).toMatchObject({ id: newer.id, raw_text: 'new', deleted_at: null });
      }
      expect(await getDirtyRecords(table)).toEqual([]);
    });
  });

  it('clears the queued snapshot when the pushed row only gained local-only fields', async () => {
    const table = SYNC_TABLES.WORKOUT_NOTES;
    const clientId = await getClientId();
    const queued = stampWrite(
      { id: 'note-local-only', raw_text: '-Squat\n- 225 5,5,5' },
      clientId,
      '2026-07-17T11:30:00.000Z'
    );
    let local = [{ ...queued, isCurrent: true }];
    await enqueueDirty(table, queued);

    const pushed = [];
    await syncTable({
      table,
      transport: {
        async pull() {
          return [];
        },
        async push(_table, records) {
          pushed.push(cloneRecords(records));
        },
      },
      async readLocal() {
        return local;
      },
      async writeLocal(records) {
        local = records;
      },
    });

    expect(pushed).toEqual([[{ ...queued, isCurrent: true }]]);
    expect(await getDirtyRecords(table)).toEqual([]);
  });

  it('leaves the acknowledged snapshot queued when push fails, then clears it after retry', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    const record = stampWrite(
      { id: 'weight-retry', weight_value: 175 },
      clientId,
      '2026-07-17T12:00:00.000Z'
    );
    let local = [record];
    await enqueueDirty(table, record);

    let shouldFail = true;
    const transport = {
      async pull() {
        return [];
      },
      async push() {
        if (shouldFail) throw new Error('offline');
      },
    };
    const runPass = () =>
      syncTable({
        table,
        transport,
        async readLocal() {
          return local;
        },
        async writeLocal(records) {
          local = records;
        },
      });

    await expect(runPass()).rejects.toThrow('offline');
    expect(await getDirtyRecords(table)).toEqual([record]);

    shouldFail = false;
    await runPass();
    expect(await getDirtyRecords(table)).toEqual([]);
  });
});

describe('server-authoritative cursor advancement', () => {
  const POISONED_CURSOR = '2099-01-01T00:00:00.000Z';
  const SERVER_HIDDEN_AT = '2026-07-17T11:59:00.000Z';
  const SERVER_PUSHED_AT = '2026-07-17T12:00:00.000Z';
  const SERVER_LATER_AT = '2026-07-17T12:01:00.000Z';

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    resetStampClockForTests();
  });

  function makeServerTransport() {
    const rows = new Map();
    const pullCursors = [];
    const pushes = [];
    return {
      rows,
      pullCursors,
      pushes,
      transport: {
        async pull(_table, cursor) {
          pullCursors.push(cursor);
          return [...rows.values()]
            .filter((row) => !cursor || row.updated_at >= cursor)
            .sort(
              (a, b) =>
                a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id)
            )
            .map((row) => ({ ...row }));
        },
        async push(_table, records) {
          pushes.push(cloneRecords(records));
          return records.map((record) => {
            const payload = { ...record };
            delete payload.client_id;
            delete payload.updated_at;
            delete payload.local_only;
            const serverRow = { ...payload, updated_at: SERVER_PUSHED_AT };
            rows.set(serverRow.id, serverRow);
            return { ...serverRow };
          });
        },
      },
    };
  }

  describe.each([
    ['future', '2099-01-01T00:00:00.000Z'],
    ['lagging', '2020-01-01T00:00:00.000Z'],
  ])('%s device clock', (_clockKind, deviceTime) => {
    it.each(['syncTable', 'syncDiffTable'])(
      '%s advances and merges from server timestamps only',
      async (syncKind) => {
        const table =
          syncKind === 'syncTable'
            ? SYNC_TABLES.WEIGHT_ENTRIES
            : SYNC_TABLES.DELOAD_HISTORY;
        const cloud = makeServerTransport();
        let visible = [];
        let runPass;
        let restoreClock = () => {};

        if (syncKind === 'syncTable') {
          const clientId = await getClientId();
          const local = stampWrite(
            { id: 'local-row', value: 'local edit', local_only: 'preserve me' },
            clientId,
            deviceTime
          );
          visible = [local];
          await enqueueDirty(table, local);
          runPass = () =>
            syncTable({
              table,
              transport: cloud.transport,
              async readLocal() {
                return visible;
              },
              async writeLocal(records) {
                visible = records;
              },
            });
        } else {
          const baseline = {
            id: 'local-row',
            value: 'before edit',
            updated_at: '2026-07-17T11:00:00.000Z',
          };
          await setSyncSnapshot(table, [baseline]);
          visible = [{ id: 'local-row', value: 'local edit' }];
          const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(deviceTime));
          restoreClock = () => nowSpy.mockRestore();
          runPass = () =>
            syncDiffTable({
              table,
              transport: cloud.transport,
              async buildLocal() {
                return visible.map(({ id, value }) => ({ id, value }));
              },
              async applyMerged(records) {
                visible = records;
              },
              payloadFields: ['value'],
              allowDelete: true,
            });
        }

        try {
          await runPass();

          expect(await getCursor(table)).toBe(SERVER_PUSHED_AT);
          expect(visible.find((row) => row.id === 'local-row')?.updated_at).toBe(
            SERVER_PUSHED_AT
          );
          if (syncKind === 'syncTable') {
            expect(visible.find((row) => row.id === 'local-row')?.local_only).toBe(
              'preserve me'
            );
          }

          cloud.rows.set('later-row', {
            id: 'later-row',
            value: 'remote edit',
            updated_at: SERVER_LATER_AT,
          });
          await runPass();

          expect(cloud.pullCursors).toEqual([null, SERVER_PUSHED_AT]);
          expect(visible).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: 'local-row', updated_at: SERVER_PUSHED_AT }),
              expect.objectContaining({ id: 'later-row', updated_at: SERVER_LATER_AT }),
            ])
          );
          expect(cloud.pushes).toHaveLength(1);
          expect(await getCursor(table)).toBe(SERVER_LATER_AT);
        } finally {
          restoreClock();
        }
      }
    );
  });

  it.each(['syncTable', 'syncDiffTable'])(
    '%s clears an already-poisoned cursor and recovers every hidden row',
    async (syncKind) => {
      const table =
        syncKind === 'syncTable'
          ? SYNC_TABLES.WEIGHT_ENTRIES
          : SYNC_TABLES.DELOAD_HISTORY;
      const cloud = makeServerTransport();
      cloud.rows.set('hidden-row', {
        id: 'hidden-row',
        value: 'previously hidden remote edit',
        updated_at: SERVER_HIDDEN_AT,
      });
      await setCursor(table, POISONED_CURSOR);

      let visible = [];
      let runPass;
      let restoreClock = () => {};
      if (syncKind === 'syncTable') {
        const clientId = await getClientId();
        const local = stampWrite(
          { id: 'local-row', value: 'local edit' },
          clientId,
          POISONED_CURSOR
        );
        visible = [local];
        await enqueueDirty(table, local);
        runPass = () =>
          syncTable({
            table,
            transport: cloud.transport,
            async readLocal() {
              return visible;
            },
            async writeLocal(records) {
              visible = records;
            },
          });
      } else {
        await setSyncSnapshot(table, [
          {
            id: 'local-row',
            value: 'before edit',
            updated_at: '2026-07-17T11:00:00.000Z',
          },
        ]);
        visible = [{ id: 'local-row', value: 'local edit' }];
        const nowSpy = jest
          .spyOn(Date, 'now')
          .mockReturnValue(Date.parse(POISONED_CURSOR));
        restoreClock = () => nowSpy.mockRestore();
        runPass = () =>
          syncDiffTable({
            table,
            transport: cloud.transport,
            async buildLocal() {
              return visible.map(({ id, value }) => ({ id, value }));
            },
            async applyMerged(records) {
              visible = records;
            },
            payloadFields: ['value'],
            allowDelete: true,
          });
      }

      try {
        await runPass();
        expect(cloud.pullCursors).toEqual([POISONED_CURSOR]);
        expect(await getCursor(table)).toBeNull();

        await runPass();
        expect(cloud.pullCursors).toEqual([POISONED_CURSOR, null]);
        expect(visible).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'hidden-row', updated_at: SERVER_HIDDEN_AT }),
            expect.objectContaining({ id: 'local-row', updated_at: SERVER_PUSHED_AT }),
          ])
        );
        expect(cloud.pushes).toHaveLength(1);
        expect(await getCursor(table)).toBe(SERVER_PUSHED_AT);
      } finally {
        restoreClock();
      }
    }
  );
});

describe('commit-safe pull boundary advancement', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    resetStampClockForTests();
  });

  it.each(['syncTable', 'syncDiffTable'])(
    '%s advances only to the completed server boundary and recovers a later commit',
    async (syncKind) => {
      const table =
        syncKind === 'syncTable'
          ? SYNC_TABLES.WEIGHT_ENTRIES
          : SYNC_TABLES.DELOAD_HISTORY;
      const pullCursors = [];
      let pullNumber = 0;
      let visible = [];
      const transport = {
        async pull(_table, cursor) {
          pullCursors.push(cursor);
          pullNumber += 1;
          if (pullNumber === 1) {
            return [
              {
                id: 'visible-before-boundary',
                value: 'first',
                updated_at: '2026-07-22T12:00:00.000Z',
              },
              {
                __kilo_pull_meta: {
                  cursor: 'xid:200',
                  row_xids: { 'visible-before-boundary': '150' },
                },
              },
            ];
          }
          return [
            {
              id: 'writer-committed-later',
              value: 'recovered',
              updated_at: '2026-07-22T11:59:00.000Z',
            },
            {
              __kilo_pull_meta: {
                cursor: 'xid:300',
                row_xids: { 'writer-committed-later': '200' },
              },
            },
          ];
        },
        async push() {
          throw new Error('no push expected');
        },
      };

      const runPass =
        syncKind === 'syncTable'
          ? () =>
              syncTable({
                table,
                transport,
                async readLocal() {
                  return visible;
                },
                async writeLocal(records) {
                  visible = records;
                },
              })
          : () =>
              syncDiffTable({
                table,
                transport,
                async buildLocal() {
                  return visible.map(({ id, value }) => ({ id, value }));
                },
                async applyMerged(records) {
                  visible = records;
                },
                payloadFields: ['value'],
                allowDelete: true,
              });

      await runPass();
      expect(await getCursor(table)).toBe('xid:200');

      await runPass();
      expect(pullCursors).toEqual([null, 'xid:200']);
      expect(await getCursor(table)).toBe('xid:300');
      expect(visible).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'writer-committed-later', value: 'recovered' }),
        ])
      );
    }
  );
});

// ── recovery collections in the engine (issue #693) ──────────────────────────
//
// Both recovery tables run through the same syncTable loop as weight entries and
// workout notes. What is worth pinning at the engine level is that a REJECTED
// push — the outcome the partial unique indexes produce when two devices race —
// behaves like any other failed push: nothing is lost, the queue stays armed,
// the cursor does not advance past rows this device has not reconciled, and no
// baseline is recorded that would launder the unpushed row into looking synced.
describe('recovery collections are ordinary, retryable collection tables', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    resetStampClockForTests();
  });

  it.each([SYNC_TABLES.RECOVERY_BLOCKS, SYNC_TABLES.RECOVERY_BLOCK_WEEKS])(
    '%s keeps a rejected push retryable and lands it on the next pass',
    async (table) => {
      const clientId = await getClientId();
      const record = stampWrite({ id: 'rec-1', week_number: 1, started_at: 'x' }, clientId);
      await enqueueDirty(table, record);

      let reject = true;
      const stored = new Map();
      const transport = {
        async pull() {
          return [...stored.values()];
        },
        async push(_table, records) {
          if (reject) {
            const error = new Error('duplicate key value violates unique constraint');
            error.code = '23505';
            throw error;
          }
          return records.map((row) => {
            const persisted = { ...row, updated_at: '2026-07-28T12:00:00.000Z' };
            delete persisted.client_id;
            stored.set(persisted.id, persisted);
            return { ...persisted };
          });
        },
      };

      let local = [record];
      const io = {
        table,
        transport,
        readLocal: async () => local,
        writeLocal: async (list) => {
          local = list;
        },
      };

      await expect(syncTable(io)).rejects.toThrow(/unique constraint/);
      expect(await getDirtyRecords(table)).toEqual([record]);
      expect(await getCursor(table)).toBeNull();
      expect(await getSyncSnapshot(table)).toBeNull();

      reject = false;
      const result = await syncTable(io);
      expect(result.pushed).toBe(1);
      expect(await getDirtyRecords(table)).toEqual([]);
      expect(stored.get('rec-1').week_number).toBe(1);
      // The record survived untouched: a rejected push never edits local data.
      expect(local.find((r) => r.id === 'rec-1').week_number).toBe(1);
    }
  );
});

// ── sync-pass cost (issue #806) ──────────────────────────────────────────────
//
// The engine paid three avoidable costs on every pass, and all three grew with
// the size of the account rather than with the amount of work actually pending:
//
//   1. the persisted dirty queue was re-read, re-serialized and re-encrypted
//      once PER RECORD enqueued, which is quadratic in the batch size;
//   2. the local table was re-read after writeLocal purely to record the
//      baseline, decrypting and parsing every row a second time;
//   3. a byte-identical baseline was rewritten every pass.
//
// These pin the cheaper behaviour AND the safety properties it must not trade
// away: the queue still ends up holding exactly what a per-record loop produced,
// a failed push still leaves the whole batch armed with the cursor unmoved, and
// the baseline still reflects what is actually on disk.
describe('sync pass does not re-do work that has not changed', () => {
  const dirtyKeyFor = (table) => `kilo_sync_dirty_${table}`;
  const snapshotKeyFor = (table) => `kilo_sync_snapshot_${table}`;

  function writesTo(key) {
    return AsyncStorage.setItem.mock.calls.filter(([written]) => written === key);
  }

  function readsOf(key) {
    return AsyncStorage.getItem.mock.calls.filter(([read]) => read === key);
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    resetClientIdCacheForTests();
    resetStampClockForTests();
  });

  it('enqueues a whole batch with a single queue write', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    const batch = Array.from({ length: 25 }, (_, i) =>
      stampWrite({ id: `we_${i}`, weight_value: 180 + i }, clientId)
    );

    AsyncStorage.setItem.mockClear();
    await enqueueDirtyMany(table, batch);

    expect(writesTo(dirtyKeyFor(table))).toHaveLength(1);
    expect(await getDirtyRecords(table)).toEqual(batch);
  });

  it('leaves the queue exactly as a record-by-record enqueue would', async () => {
    const table = SYNC_TABLES.WORKOUT_NOTES;
    const clientId = await getClientId();
    const first = [
      stampWrite({ id: 'wn_1', title: 'A' }, clientId),
      stampWrite({ id: 'wn_2', title: 'B' }, clientId),
    ];
    // Same id re-queued with a newer snapshot, plus an unrelated new id, plus
    // rows the queue must ignore.
    const second = [
      stampWrite({ id: 'wn_2', title: 'B2' }, clientId),
      stampTombstone({ id: 'wn_3', title: 'C' }, clientId),
      null,
      { title: 'no id' },
    ];

    await enqueueDirtyMany(table, first);
    await enqueueDirtyMany(table, second);
    const batched = await getDirtyRecords(table);

    await AsyncStorage.clear();
    for (const record of [...first, ...second]) {
      // eslint-disable-next-line no-await-in-loop
      await enqueueDirty(table, record);
    }
    expect(batched).toEqual(await getDirtyRecords(table));
    expect(batched.map((r) => r.id)).toEqual(['wn_1', 'wn_2', 'wn_3']);
    expect(batched.find((r) => r.id === 'wn_2').title).toBe('B2');
  });

  it('keeps a whole batch armed and the cursor unmoved when its push fails', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    const clientId = await getClientId();
    const batch = Array.from({ length: 10 }, (_, i) =>
      stampWrite({ id: `we_${i}`, weight_value: i }, clientId)
    );
    await enqueueDirtyMany(table, batch);

    let local = batch.slice();
    const io = {
      table,
      transport: {
        async pull() {
          return [];
        },
        async push() {
          throw new Error('offline');
        },
      },
      readLocal: async () => local,
      writeLocal: async (list) => {
        local = list;
        return list;
      },
    };

    await expect(syncTable(io)).rejects.toThrow('offline');
    expect(await getDirtyRecords(table)).toEqual(batch);
    expect(await getCursor(table)).toBeNull();
    expect(await getSyncSnapshot(table)).toBeNull();
  });

  it('records the baseline from what writeLocal persisted, never a re-read', async () => {
    const table = SYNC_TABLES.WORKOUT_NOTES;
    const kept = { id: 'wn_keep', title: 'Keep', updated_at: '2026-08-01T00:00:00.000Z' };
    const dropped = { id: 'wn_drop', title: 'Drop', updated_at: '2026-08-01T00:00:00.000Z' };

    // A transforming writer (the shape syncAdapter uses for phantom-note cleanup
    // and the recovery duplicate collapse): it persists something other than the
    // list handed to it, and reports what it persisted.
    let persisted = null;
    await syncTable({
      table,
      transport: {
        async pull() {
          return [];
        },
        async push() {
          return [];
        },
      },
      readLocal: async () => [kept, dropped],
      writeLocal: async (list) => {
        persisted = list.filter((rec) => rec.id !== 'wn_drop');
        // A domain write landing right here used to be swept into the baseline
        // by the re-read, laundering an un-uploaded row into looking synced.
        return persisted;
      },
    });

    expect(persisted).toEqual([kept]);
    expect(await getSyncSnapshot(table)).toEqual([kept]);
  });

  it('does not rewrite a baseline that has not changed', async () => {
    const table = SYNC_TABLES.ARCHIVED_WEIGHT_GOALS;
    const row = { id: 'ag_1', target_weight: 175, updated_at: '2026-08-01T00:00:00.000Z' };
    let local = [row];
    const io = {
      table,
      transport: {
        async pull() {
          return [];
        },
        async push() {
          return [];
        },
      },
      readLocal: async () => local,
      writeLocal: async (list) => {
        local = list;
        return list;
      },
    };

    await syncTable(io);
    const baseline = await getSyncSnapshot(table);

    AsyncStorage.setItem.mockClear();
    await syncTable(io);

    expect(writesTo(snapshotKeyFor(table))).toHaveLength(0);
    expect(await getSyncSnapshot(table)).toEqual(baseline);
  });

  it('rewrites the baseline as soon as the table genuinely changes', async () => {
    const table = SYNC_TABLES.ARCHIVED_WEIGHT_GOALS;
    let remote = [];
    let local = [{ id: 'ag_1', target_weight: 175, updated_at: '2026-08-01T00:00:00.000Z' }];
    const io = {
      table,
      transport: {
        async pull() {
          return remote;
        },
        async push() {
          return [];
        },
      },
      readLocal: async () => local,
      writeLocal: async (list) => {
        local = list;
        return list;
      },
    };

    await syncTable(io);
    remote = [{ id: 'ag_2', target_weight: 170, updated_at: '2026-08-02T00:00:00.000Z' }];

    AsyncStorage.setItem.mockClear();
    await syncTable(io);

    expect(writesTo(snapshotKeyFor(table))).toHaveLength(1);
    expect((await getSyncSnapshot(table)).map((r) => r.id).sort()).toEqual(['ag_1', 'ag_2']);
  });

  it('re-persists a baseline that was wiped underneath it', async () => {
    // The write-skip must never turn a purge into a silently missing baseline.
    // getSyncSnapshot re-grounds the decision on what storage actually holds.
    const table = SYNC_TABLES.ARCHIVED_WEIGHT_GOALS;
    const row = { id: 'ag_1', target_weight: 175, updated_at: '2026-08-01T00:00:00.000Z' };
    let local = [row];
    const io = {
      table,
      transport: {
        async pull() {
          return [];
        },
        async push() {
          return [];
        },
      },
      readLocal: async () => local,
      writeLocal: async (list) => {
        local = list;
        return list;
      },
    };

    await syncTable(io);
    await AsyncStorage.removeItem(snapshotKeyFor(table));
    await syncTable(io);

    expect(await getSyncSnapshot(table)).toEqual([row]);
  });

  it('uses a caller-supplied baseline answer instead of reading it again', async () => {
    const table = SYNC_TABLES.WEIGHT_ENTRIES;
    await setCursor(table, 'xid:500');
    const pulledCursors = [];
    const io = {
      table,
      reconcileUnbaselined: true,
      transport: {
        async pull(_table, cursor) {
          pulledCursors.push(cursor);
          return [];
        },
        async push() {
          return [];
        },
      },
      readLocal: async () => [],
      writeLocal: async (list) => list,
    };

    // No snapshot exists, so an unhinted pass would reconcile against a FULL
    // pull (cursor ignored). The hint says a baseline was already read this
    // pass, so the ordinary delta pull is used and no extra read is made.
    AsyncStorage.getItem.mockClear();
    await syncTable({ ...io, knownUnbaselined: false });
    expect(pulledCursors).toEqual(['xid:500']);
    expect(readsOf(snapshotKeyFor(table))).toHaveLength(0);

    // Omitting the hint restores the read-it-yourself behaviour.
    await AsyncStorage.removeItem(snapshotKeyFor(table));
    pulledCursors.length = 0;
    AsyncStorage.getItem.mockClear();
    await syncTable(io);
    expect(pulledCursors).toEqual([null]);
    expect(readsOf(snapshotKeyFor(table)).length).toBeGreaterThan(0);
  });

  it('mints one client id when concurrent passes race an uncached read', async () => {
    resetClientIdCacheForTests();
    const ids = await Promise.all(Array.from({ length: 8 }, () => getClientId()));
    expect(new Set(ids).size).toBe(1);
    expect(await AsyncStorage.getItem('kilo_sync_client_id')).toBe(ids[0]);
  });
});
