import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  enqueueDirty,
  getClientId,
  getCursor,
  getDirtyRecords,
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
