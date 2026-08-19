// Regression coverage for #818: the cold-launch path no longer reads — and
// decrypts — the same device key once per mounted tab.
//
// All five tabs stay mounted (#527) and hydrate from the same keys, so a cold
// start used to issue the notebook, weight-table, current-routine and
// tracked-lift reads three times each and the weight goal twice, every one of
// them a full AES-GCM decrypt, all serialized behind the storage boundary's
// single operation queue. Because child effects run before the parent's, the
// shell's own note/weight reads — the two that gate Home's first paint — were
// enqueued last, behind every one of those duplicates.
//
// Two layers are pinned here:
//   1. the storage boundary's coalescing contract, including the exact points
//      at which a pending read must NOT be shared;
//   2. the real mounted-hook fan-out, which is the duplicated work itself.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import TestRenderer from 'react-test-renderer';

import * as Storage from '../storage/entries';
import { createDeviceStorage } from '../storage/secureStorage';
import { setStorageMode, STORAGE_MODES } from '../storage/entries/storageMode';
import { WORKOUT_NOTES_KEY, WEIGHT_KEY, CURRENT_WORKOUT_ID_KEY, TRACKED_LIFTS_KEY, WEIGHT_GOAL_KEY } from '../storage/entries/keys';

const { useWeightEntries, useWeightGoal, useArchivedWeightGoals } = require('../hooks/entries/weightHooks');
const { useWorkoutNotes } = require('../hooks/entries/workoutNoteHooks');
const { useTrackedLifts } = require('../hooks/entries/trackedLiftHooks');
const {
  useRecoveryBlockState,
  useRecoveryAnalyticsFilter,
  useRecoveryBlockLifecycle,
} = require('../hooks/entries/recoveryBlockHooks');

// One setImmediate macrotask fully drains a multi-hop microtask chain; see the
// identical helper in home-startup-latency.test.js.
async function flushAsync() {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

// A deterministic native fake for the encrypted path, matching the one
// secure-storage.test.js and home-startup-latency.test.js already use. Counts
// backing reads per key, which is what a decrypt actually costs.
function buildCountingStorage() {
  const values = new Map();
  const reads = [];
  let seed = 0;
  const backingStore = {
    getItem: jest.fn(async (key) => {
      reads.push(key);
      return values.has(key) ? values.get(key) : null;
    }),
    setItem: jest.fn(async (key, value) => { values.set(key, value); }),
    removeItem: jest.fn(async (key) => { values.delete(key); }),
    getAllKeys: jest.fn(async () => [...values.keys()]),
    multiSet: jest.fn(async (pairs) => { pairs.forEach(([k, v]) => values.set(k, v)); }),
    multiRemove: jest.fn(async (keys) => { keys.forEach((k) => values.delete(k)); }),
  };
  const secureValues = new Map();
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
        return Uint8Array.from({ length }, (_, i) => (seed * 7 + i) % 256);
      }),
    },
    platformOS: 'android',
    forceEncryption: true,
  });
  return { storage, backingStore, reads };
}

describe('device-storage read coalescing (#818)', () => {
  it('serves concurrent reads of one key from a single decrypt', async () => {
    const { storage, backingStore } = buildCountingStorage();
    await storage.setItem('kilo_workout_notes', '[{"id":"n1"}]');
    backingStore.getItem.mockClear();

    // Exactly the cold-start shape: several mounted consumers ask for the same
    // key in one synchronous burst, before any of them has resolved.
    const results = await Promise.all([
      storage.getItem('kilo_workout_notes'),
      storage.getItem('kilo_workout_notes'),
      storage.getItem('kilo_workout_notes'),
    ]);

    expect(results).toEqual(['[{"id":"n1"}]', '[{"id":"n1"}]', '[{"id":"n1"}]']);
    expect(backingStore.getItem).toHaveBeenCalledTimes(1);
  });

  it('does not share a pending read across a write to the same key', async () => {
    const { storage, backingStore } = buildCountingStorage();
    await storage.setItem('kilo_weight_goal', 'before');
    backingStore.getItem.mockClear();

    const first = storage.getItem('kilo_weight_goal');
    const write = storage.setItem('kilo_weight_goal', 'after');
    const second = storage.getItem('kilo_weight_goal');

    // The read enqueued before the write still resolves the pre-write value —
    // exactly what it would have returned from that queue position without
    // coalescing — and the read enqueued after it sees the write.
    await expect(first).resolves.toBe('before');
    await write;
    await expect(second).resolves.toBe('after');
    expect(backingStore.getItem).toHaveBeenCalledTimes(2);
  });

  it('does not share a pending read across removeItem, updateItem, or a device wipe', async () => {
    const { storage, backingStore } = buildCountingStorage();
    await storage.setItem('kilo_tracked_lifts', '{"Squat":true}');

    backingStore.getItem.mockClear();
    storage.removeItem('kilo_tracked_lifts');
    await expect(storage.getItem('kilo_tracked_lifts')).resolves.toBeNull();

    await storage.setItem('kilo_tracked_lifts', '{"Squat":true}');
    backingStore.getItem.mockClear();
    storage.updateItem('kilo_tracked_lifts', () => '{"Bench":true}');
    await expect(storage.getItem('kilo_tracked_lifts')).resolves.toBe('{"Bench":true}');

    await storage.setItem('kilo_weight_entries', '[{"id":"w1"}]');
    backingStore.getItem.mockClear();
    storage.wipeKiloData();
    await expect(storage.getItem('kilo_weight_entries')).resolves.toBeNull();
  });

  it('keeps sharing a pending read across the one-time plaintext migration', async () => {
    // App queues migrateKiloData() between the mounted tabs' hydration reads
    // and the shell's own, so treating it as a mutation would push the two
    // reads that gate Home's first paint back behind every duplicate. It only
    // re-encodes values that are already there, so the decrypted answer is
    // identical either side of it.
    const { storage, backingStore } = buildCountingStorage();
    await storage.setItem('kilo_workout_notes', '[{"id":"n1"}]');
    // Complete the one-time scan first, so this exercises the shape every cold
    // launch after the first actually has: a single marker check.
    await storage.migrateKiloData();
    backingStore.getItem.mockClear();

    const beforeMigration = storage.getItem('kilo_workout_notes');
    const migration = storage.migrateKiloData();
    const afterMigration = storage.getItem('kilo_workout_notes');

    await expect(beforeMigration).resolves.toBe('[{"id":"n1"}]');
    await expect(afterMigration).resolves.toBe('[{"id":"n1"}]');
    await migration;
    const notebookReads = backingStore.getItem.mock.calls
      .filter(([key]) => key === 'kilo_workout_notes').length;
    expect(notebookReads).toBe(1);
  });
});

// ── the duplicated work itself ───────────────────────────────────────────────
//
// The probes below instantiate exactly the hooks each mounted tab instantiates
// (see App.js's renderContent: all five tab subtrees mount at once), in the
// order React mounts them — every child's effects before the shell's own.
function HomeProbe() {
  useWeightGoal();
  useTrackedLifts();
  useRecoveryAnalyticsFilter();
  useRecoveryBlockState();
  return null;
}
function LogProbe() {
  useWorkoutNotes();
  useTrackedLifts();
  useRecoveryBlockState();
  useRecoveryBlockLifecycle();
  return null;
}
function WeightProbe() {
  useWeightEntries();
  useWeightGoal();
  useArchivedWeightGoals();
  return null;
}
function AnalyticsProbe() {
  useWorkoutNotes();
  useWeightEntries();
  useTrackedLifts();
  useRecoveryBlockState();
  useRecoveryAnalyticsFilter();
  return null;
}
// The shell's own useWeightEntries()/useWorkoutNotes() (App.js) — the two reads
// Home's `loading` prop is gated on. Declared as the parent so its effects run
// after all four tab subtrees', which is what put them last in the queue.
function ColdStartShell() {
  useWeightEntries();
  useWorkoutNotes();
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(HomeProbe),
    React.createElement(LogProbe),
    React.createElement(WeightProbe),
    React.createElement(AnalyticsProbe),
  );
}

describe('cold-start hydration reads each device key once (#818)', () => {
  it('mounting every tab plus the shell does not re-read the same key per instance', async () => {
    setStorageMode(STORAGE_MODES.LOCAL);
    await Storage.replaceWorkoutNotesRaw([
      {
        id: 'n1',
        title: 'Routine',
        raw_text: 'Week 1\n-Bench Press\n185 5,5,5',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await Storage.saveWeightEntry({ id: 'w1', weight_value: 180, logged_at: '2026-01-02T12:00:00.000Z' });
    await Storage.saveTrackedLifts({ 'Bench Press': true });

    AsyncStorage.getItem.mockClear();
    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(ColdStartShell));
    });
    await flushAsync();
    await flushAsync();

    const readsByKey = {};
    for (const [key] of AsyncStorage.getItem.mock.calls) {
      readsByKey[key] = (readsByKey[key] || 0) + 1;
    }

    // Three mounted useWorkoutNotes() instances (Log, Analytics, the shell),
    // three useWeightEntries() (Weight, Analytics, the shell), three
    // useTrackedLifts() (Home, Log, Analytics) and two useWeightGoal() (Home,
    // Weight) — one read each. Before #818 these were 3/3/3/3/2.
    expect(readsByKey[WORKOUT_NOTES_KEY]).toBe(1);
    expect(readsByKey[CURRENT_WORKOUT_ID_KEY]).toBe(1);
    expect(readsByKey[WEIGHT_KEY]).toBe(1);
    expect(readsByKey[TRACKED_LIFTS_KEY]).toBe(1);
    expect(readsByKey[WEIGHT_GOAL_KEY]).toBe(1);
  });

  it('the shell reads that gate Home first paint join the tabs read instead of queueing behind it', async () => {
    setStorageMode(STORAGE_MODES.LOCAL);
    await Storage.replaceWorkoutNotesRaw([
      {
        id: 'n1',
        title: 'Routine',
        raw_text: 'Week 1\n-Squat\n275 5,5,5',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    await Storage.saveWeightEntry({ id: 'w1', weight_value: 181, logged_at: '2026-01-03T12:00:00.000Z' });

    AsyncStorage.getItem.mockClear();
    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(ColdStartShell));
    });
    await flushAsync();
    await flushAsync();

    const order = AsyncStorage.getItem.mock.calls.map(([key]) => key);
    const notesIndex = order.indexOf(WORKOUT_NOTES_KEY);
    const entriesIndex = order.indexOf(WEIGHT_KEY);

    // Both gating reads must be issued inside the initial mount burst, not
    // appended after every other tab's hydration. Before #818 the shell's own
    // reads were the 15th and 16th of twenty; the assertion is on position
    // rather than a raw total so it fails loudly if a future screen
    // reintroduces a per-instance read ahead of them.
    expect(notesIndex).toBeGreaterThanOrEqual(0);
    expect(entriesIndex).toBeGreaterThanOrEqual(0);
    expect(order.length).toBeLessThanOrEqual(12);
    expect(Math.max(notesIndex, entriesIndex)).toBeLessThan(8);
  });
});
