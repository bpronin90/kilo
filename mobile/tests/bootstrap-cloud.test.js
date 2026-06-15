// Cloud bootstrap-substrate tests (Phase 4 / Task 11).
//
// Task 11 implements the offline LWW sync layer that bootstrap (#319) sits on
// top of. Bootstrap itself (the explicit, reversible import of existing local
// AsyncStorage data into the cloud model) is a separate issue and is not present
// on this branch. These tests pin the sync-layer invariants bootstrap depends
// on, so they hold regardless of bootstrap's own import flow:
//
//   - first sync against an empty cloud pushes existing local records up and
//     leaves the local cache intact (the "seed the cloud from local" direction)
//   - a failed push (still offline) leaves local AsyncStorage untouched and the
//     dirty queue retained, so a failed bootstrap/sync never loses local data
//   - per-table cursors only advance after a successful push, so an interrupted
//     pass safely re-pulls and re-pushes
//
// If/when #319 lands, its bootstrap-specific assertions can extend this file.

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as Storage from '../storage/entries';
import { cloudAdapter, setCloudTransport } from '../storage/cloudAdapter';
import {
  pickWinner,
  getCursor,
  getDirtyRecords,
  resetClientIdCacheForTests,
  SYNC_TABLES,
} from '../storage/syncQueue';

function makeFakeCloud() {
  const tables = {
    [SYNC_TABLES.WEIGHT_ENTRIES]: new Map(),
    [SYNC_TABLES.WORKOUT_NOTES]: new Map(),
  };
  const state = { online: true };
  const transport = {
    async pull(table, cursor) {
      if (!state.online) throw new Error('offline');
      const rows = [...tables[table].values()];
      return cursor ? rows.filter((r) => (r.updated_at || '') > cursor) : rows;
    },
    async push(table, records) {
      if (!state.online) throw new Error('offline');
      for (const rec of records) {
        const existing = tables[table].get(rec.id);
        tables[table].set(rec.id, existing ? pickWinner(existing, rec) : rec);
      }
    },
  };
  return {
    transport,
    state,
    remoteRow: (table, id) => tables[table].get(id),
    setOnline: (v) => {
      state.online = v;
    },
  };
}

let cloud;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetClientIdCacheForTests();
  cloud = makeFakeCloud();
  setCloudTransport(cloud.transport);
  Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
});

afterEach(() => {
  setCloudTransport(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
});

const entry = (id, value) => ({
  id,
  entry_type: 'weight',
  date: '2026-06-15',
  logged_at: '2026-06-15T12:00:00.000Z',
  weight_value: value,
});

describe('first sync against an empty cloud (seed-from-local direction)', () => {
  it('pushes existing local records to the cloud and keeps the local cache intact', async () => {
    await cloudAdapter.saveWeightEntry(entry('w1', 180));
    await cloudAdapter.saveWeightEntry(entry('w2', 181));

    // Cloud is empty before the first sync.
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1')).toBeUndefined();

    await cloudAdapter.sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1').weight_value).toBe(180);
    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w2').weight_value).toBe(181);

    // Local cache still holds both records.
    const local = await cloudAdapter.loadWeightEntries();
    expect(local.map((e) => e.id).sort()).toEqual(['w1', 'w2']);

    // Dirty queue drained after a successful push.
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
  });
});

describe('failed sync leaves local data intact (failed-bootstrap invariant)', () => {
  it('keeps local records and retains the dirty queue when the push fails offline', async () => {
    await cloudAdapter.saveWeightEntry(entry('w1', 180));

    cloud.setOnline(false);
    await expect(cloudAdapter.sync()).rejects.toThrow('offline');

    // Local AsyncStorage cache is untouched.
    const local = await cloudAdapter.loadWeightEntries();
    expect(local.map((e) => e.id)).toEqual(['w1']);
    expect(local[0].weight_value).toBe(180);

    // Dirty queue retained so the record re-pushes on the next pass.
    const dirty = await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES);
    expect(dirty.map((d) => d.id)).toEqual(['w1']);

    // Cursor never advanced, so nothing was silently marked as synced.
    expect(await getCursor(SYNC_TABLES.WEIGHT_ENTRIES)).toBeNull();
  });

  it('re-pushes successfully once back online with no data loss', async () => {
    await cloudAdapter.saveWeightEntry(entry('w1', 180));

    cloud.setOnline(false);
    await expect(cloudAdapter.sync()).rejects.toThrow('offline');

    cloud.setOnline(true);
    await cloudAdapter.sync();

    expect(cloud.remoteRow(SYNC_TABLES.WEIGHT_ENTRIES, 'w1').weight_value).toBe(180);
    expect(await getDirtyRecords(SYNC_TABLES.WEIGHT_ENTRIES)).toHaveLength(0);
    expect(await getCursor(SYNC_TABLES.WEIGHT_ENTRIES)).toBeTruthy();
  });
});
