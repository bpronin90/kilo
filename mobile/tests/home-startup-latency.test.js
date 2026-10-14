// Regression coverage for #809: Home's first paint reads on-device storage
// immediately instead of waiting on the initial cloud sync round trip, and the
// encrypted-storage startup migration scan does not repeat its full-table scan
// on every cold start once a device has already completed it once.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import TestRenderer from 'react-test-renderer';

import * as Storage from '../storage/entries';
import { setStorageMode, STORAGE_MODES } from '../storage/entries/storageMode';

jest.mock('../hooks/entries/storageMode', () => {
  const actual = jest.requireActual('../hooks/entries/storageMode');
  return {
    ...actual,
    maybeSyncCloud: jest.fn(),
  };
});

const { maybeSyncCloud } = require('../hooks/entries/storageMode');
const { useWeightEntries } = require('../hooks/entries/weightHooks');
const { useWorkoutNotes } = require('../hooks/entries/workoutNoteHooks');

function driveHook(useHook) {
  const ref = { current: null };
  function Probe() {
    ref.current = useHook();
    return null;
  }
  TestRenderer.act(() => {
    TestRenderer.create(React.createElement(Probe));
  });
  return ref;
}

// See offline-sync.test.js's identical helper: one setImmediate macrotask
// fully drains a multi-hop microtask chain (AsyncStorage.getItem -> .then ->
// .finally) rather than gambling on a fixed number of manual Promise ticks.
async function flushAsync() {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

describe("Home's first paint does not wait on the initial cloud sync (#809)", () => {
  beforeEach(() => {
    setStorageMode(STORAGE_MODES.LOCAL);
    maybeSyncCloud.mockReset();
  });

  it('useWeightEntries shows existing local entries while the initial cloud sync is still in flight', async () => {
    await Storage.saveWeightEntry({
      id: 'w1',
      weight_value: 180,
      logged_at: '2026-08-10T12:00:00.000Z',
    });

    let resolveSync;
    maybeSyncCloud.mockImplementation(() => new Promise((resolve) => { resolveSync = resolve; }));

    const hook = driveHook(useWeightEntries);
    await flushAsync();

    // The local read has already settled even though maybeSyncCloud() (the
    // mocked network sync) has not resolved yet.
    expect(hook.current.loading).toBe(false);
    expect(hook.current.entries.map((e) => e.id)).toEqual(['w1']);
    expect(maybeSyncCloud).toHaveBeenCalled();

    // The background sync can still resolve and settle without error.
    await TestRenderer.act(async () => { resolveSync(); });
    await flushAsync();
    expect(hook.current.loading).toBe(false);
  });

  it('useWorkoutNotes shows existing local notes while the initial cloud sync is still in flight', async () => {
    await Storage.saveWorkoutNoteItem({
      id: 'n1',
      title: 'Push Day',
      raw_text: '-Bench\n135 5,5',
      created_at: '2026-08-10T12:00:00.000Z',
      updated_at: '2026-08-10T12:00:00.000Z',
    });

    let resolveSync;
    maybeSyncCloud.mockImplementation(() => new Promise((resolve) => { resolveSync = resolve; }));

    const hook = driveHook(useWorkoutNotes);
    await flushAsync();

    expect(hook.current.loading).toBe(false);
    expect(hook.current.notes.map((n) => n.id)).toEqual(['n1']);
    expect(maybeSyncCloud).toHaveBeenCalled();

    await TestRenderer.act(async () => { resolveSync(); });
    await flushAsync();
    expect(hook.current.loading).toBe(false);
  });
});

describe('encrypted-storage startup migration does not re-scan every launch (#809)', () => {
  it('skips the full-table scan once a prior pass already confirmed every key is encrypted', async () => {
    const { createDeviceStorage } = require('../storage/secureStorage');
    const values = new Map([['kilo_weight_entries', '[{"id":"legacy"}]']]);
    const backingStore = {
      getItem: jest.fn(async (key) => (values.has(key) ? values.get(key) : null)),
      setItem: jest.fn(async (key, value) => { values.set(key, value); }),
      removeItem: jest.fn(async (key) => { values.delete(key); }),
      getAllKeys: jest.fn(async () => [...values.keys()]),
      multiSet: jest.fn(),
      multiRemove: jest.fn(),
    };
    const secureValues = new Map();
    let seed = 0;
    const storage = createDeviceStorage({
      backingStore,
      secureStore: {
        WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
        getItemAsync: jest.fn(async (key) => secureValues.get(key) ?? null),
        setItemAsync: jest.fn(async (key, value) => { secureValues.set(key, value); }),
        deleteItemAsync: jest.fn(async (key) => { secureValues.delete(key); }),
      },
      crypto: {
        getRandomBytesAsync: jest.fn(async (length) => {
          seed += 1;
          return Uint8Array.from({ length }, (_, i) => (seed + i) % 256);
        }),
      },
      platformOS: 'android',
      forceEncryption: true,
    });

    await expect(storage.migrateKiloData()).resolves.toEqual({ migrated: 1 });
    expect(backingStore.getAllKeys).toHaveBeenCalledTimes(1);

    backingStore.getAllKeys.mockClear();
    await expect(storage.migrateKiloData()).resolves.toEqual({ migrated: 0 });
    // The second (and every later) cold-start pass must not repeat the
    // full-table getAllKeys()/per-key getItem() scan — that is exactly the
    // redundant blocking work #809 removes from the launch path.
    expect(backingStore.getAllKeys).not.toHaveBeenCalled();
  });
});

// #1364: an ordinary populated cold launch proves the device key with one canary
// read. Every raw backing read is accounted for by the startup counters, so a
// hidden full-store validation scan cannot creep back onto the launch path.
describe('device-key validation on an ordinary cold launch (#1364)', () => {
  it('reads only the canary for key validation and never enumerates storage', async () => {
    const { createDeviceStorage } = require('../storage/secureStorage');
    const timing = require('../storage/entries/startupTiming');
    const values = new Map();
    const backingStore = {
      getItem: jest.fn(async (key) => (values.has(key) ? values.get(key) : null)),
      setItem: jest.fn(async (key, value) => { values.set(key, value); }),
      removeItem: jest.fn(async (key) => { values.delete(key); }),
      getAllKeys: jest.fn(async () => [...values.keys()]),
      multiSet: jest.fn(async (pairs) => pairs.forEach(([k, v]) => values.set(k, v))),
      multiRemove: jest.fn(async (keys) => keys.forEach((k) => values.delete(k))),
    };
    const secureValues = new Map();
    let seed = 0;
    const primitives = {
      secureStore: {
        getItemAsync: jest.fn(async (key) => secureValues.get(key) ?? null),
        setItemAsync: jest.fn(async (key, value) => { secureValues.set(key, value); }),
        deleteItemAsync: jest.fn(async (key) => { secureValues.delete(key); }),
      },
      crypto: {
        getRandomBytesAsync: jest.fn(async (length) => {
          seed += 1;
          return Uint8Array.from({ length }, (_, i) => (seed + i) % 256);
        }),
      },
    };
    const open = () => createDeviceStorage({ backingStore, ...primitives, platformOS: 'android', forceEncryption: true });

    // A previous process populated the device, including Cloud Sync state.
    const previous = open();
    await previous.migrateKiloData();
    for (const key of ['kilo_workout_notes', 'kilo_weight_entries', 'kilo_sync_dirty_notes', 'kilo_sync_cursor', 'kilo_sync_snapshot']) {
      // eslint-disable-next-line no-await-in-loop
      await previous.setItem(key, `{"k":"${key}"}`);
    }
    backingStore.getItem.mockClear();
    backingStore.getAllKeys.mockClear();
    timing.resetStartupTiming();

    const storage = open();
    await Promise.all([
      storage.migrateKiloData(),
      storage.probeDeviceKey(),
      storage.getItem('kilo_workout_notes'),
      storage.getItem('kilo_weight_entries'),
    ]);

    expect(backingStore.getAllKeys).not.toHaveBeenCalled();
    expect(timing.getStartupKeyCheckCounts()).toEqual({ canary: 1, scan: 0 });
    const { issued } = timing.getStartupStorageReadCounts();
    const raw = backingStore.getItem.mock.calls.map(([key]) => key);
    // Raw reads = counted domain reads + the canary + the two plain markers
    // (recovery journal, migration completion). Nothing else may be read.
    expect(raw.filter((key) => !['kilorecovery.journal', 'kilo_plaintext_migration_v1_complete', 'kilo_device_key_check_v1'].includes(key)))
      .toHaveLength(issued);
    expect(raw.filter((key) => key === 'kilo_device_key_check_v1')).toHaveLength(1);
    expect(raw).not.toContain('kilo_sync_dirty_notes');
    expect(raw).not.toContain('kilo_sync_snapshot');
  });
});
