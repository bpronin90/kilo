// Regression coverage for #984: the device-storage boundary lets independent
// reads overlap, so Home's first paint waits on the SLOWEST of the keys its
// gate depends on rather than the SUM of all of them — without weakening any
// term of that gate, and without relaxing read-vs-write ordering.
//
// #809 removed the cloud round trip from the launch path and #818 removed the
// duplicate per-tab reads (twenty device reads down to twelve). What was left
// is that the survivors still queued: every operation shared one strictly
// serial FIFO, so the eight DIFFERENT keys the four gating sources read
// (weight goal, tracked lifts, tracked-lift activations, recovery blocks,
// recovery block weeks, notebook, current-routine pointer, weight table) were
// executed one after another even though none depends on another.
//
// Three layers are pinned here:
//   1. the boundary's readers/writer contract, including every point at which
//      a read must still NOT overlap a write;
//   2. the measured cold-start latency shape, with an injected per-read cost;
//   3. Home's four-term first-paint gate itself, which this must not relax.

import React from 'react';
import TestRenderer from 'react-test-renderer';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Storage from '../storage/entries';
import { createDeviceStorage } from '../storage/secureStorage';
import { setStorageMode, STORAGE_MODES } from '../storage/entries/storageMode';

const { useWeightEntries, useWeightGoal, useArchivedWeightGoals } = require('../hooks/entries/weightHooks');
const { useWorkoutNotes } = require('../hooks/entries/workoutNoteHooks');
const { useTrackedLifts } = require('../hooks/entries/trackedLiftHooks');
const {
  useRecoveryBlockState,
  useRecoveryAnalyticsFilter,
  useRecoveryBlockLifecycle,
} = require('../hooks/entries/recoveryBlockHooks');

// One setImmediate macrotask fully drains a multi-hop microtask chain; see the
// identical helper in startup-read-coalescing.test.js.
async function flushAsync() {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

// Deterministic native fake matching secure-storage.test.js /
// startup-read-coalescing.test.js, plus concurrency accounting: `maxConcurrent`
// is the high-water mark of backing reads in flight at once, which is exactly
// the quantity the old single FIFO pinned at 1.
function buildInstrumentedStorage({ readDelayMs = 0 } = {}) {
  const values = new Map();
  const trace = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  let seed = 0;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const backingStore = {
    getItem: jest.fn(async (key) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      trace.push({ op: 'read:start', key });
      if (readDelayMs) await wait(readDelayMs);
      trace.push({ op: 'read:end', key });
      inFlight -= 1;
      return values.has(key) ? values.get(key) : null;
    }),
    setItem: jest.fn(async (key, value) => {
      trace.push({ op: 'write:start', key });
      values.set(key, value);
      trace.push({ op: 'write:end', key });
    }),
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
  return {
    storage,
    backingStore,
    trace,
    counters: { get maxConcurrent() { return maxConcurrent; } },
  };
}

describe('device-storage reads overlap instead of queueing (#984)', () => {
  it('runs reads of different keys concurrently', async () => {
    const { storage, counters } = buildInstrumentedStorage({ readDelayMs: 5 });
    const keys = ['kilo_weight_goal', 'kilo_tracked_lifts', 'kilo_recovery_blocks', 'kilo_workout_notes'];
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      await storage.setItem(key, `${key}-value`);
    }
    const started = Date.now();
    const results = await Promise.all(keys.map((key) => storage.getItem(key)));
    const elapsed = Date.now() - started;

    expect(results).toEqual(keys.map((key) => `${key}-value`));
    // The whole point: four independent keys cost about ONE read's latency, not
    // four. Bounded generously so this pins the shape, not the machine.
    expect(elapsed).toBeLessThan(4 * 5);
    expect(counters.maxConcurrent).toBe(4);
  });

  it('still serves concurrent reads of ONE key from a single decrypt (#818)', async () => {
    const { storage, backingStore } = buildInstrumentedStorage();
    await storage.setItem('kilo_workout_notes', '[{"id":"n1"}]');
    backingStore.getItem.mockClear();

    const results = await Promise.all([
      storage.getItem('kilo_workout_notes'),
      storage.getItem('kilo_workout_notes'),
      storage.getItem('kilo_workout_notes'),
    ]);

    expect(results).toEqual(['[{"id":"n1"}]', '[{"id":"n1"}]', '[{"id":"n1"}]']);
    expect(backingStore.getItem).toHaveBeenCalledTimes(1);
  });

  it('never overlaps a read with a write, in either direction', async () => {
    const { storage, trace } = buildInstrumentedStorage({ readDelayMs: 3 });
    await storage.setItem('kilo_weight_goal', 'before');
    await storage.setItem('kilo_weight_entries', '[]');
    trace.length = 0;

    // A read already admitted, then a write, then a read behind that write.
    const early = storage.getItem('kilo_weight_entries');
    const write = storage.setItem('kilo_weight_goal', 'after');
    const late = storage.getItem('kilo_weight_goal');

    await expect(early).resolves.toBe('[]');
    await write;
    // The read enqueued BEFORE the write still resolves what its old FIFO
    // position would have handed it; the one enqueued after sees the write.
    await expect(late).resolves.toBe('after');

    // No read may be in flight while the write runs.
    let open = 0;
    for (const step of trace) {
      if (step.op === 'read:start') open += 1;
      if (step.op === 'read:end') open -= 1;
      if (step.op === 'write:start') expect(open).toBe(0);
    }
  });

  it('does not share a pending read across removeItem, updateItem, or a device wipe', async () => {
    const { storage, backingStore } = buildInstrumentedStorage();
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

  it('a failed read neither wedges the boundary nor rejects a later write', async () => {
    // The barrier a write waits on holds every admitted read. If a rejected
    // read were tracked in its rejecting form it would take the next write —
    // and every operation after it — down with it.
    const { storage, backingStore } = buildInstrumentedStorage();
    await storage.setItem('kilo_weight_goal', 'value');
    backingStore.getItem.mockImplementationOnce(async () => { throw new Error('device read failed'); });

    const failing = storage.getItem('kilo_weight_goal');
    await expect(failing).rejects.toThrow('device read failed');

    await expect(storage.setItem('kilo_weight_goal', 'next')).resolves.toBeUndefined();
    await expect(storage.getItem('kilo_weight_goal')).resolves.toBe('next');
  });

  it('keeps writes totally ordered with respect to each other', async () => {
    const { storage } = buildInstrumentedStorage();
    await Promise.all([
      storage.setItem('kilo_weight_goal', 'first'),
      storage.setItem('kilo_weight_goal', 'second'),
      storage.setItem('kilo_weight_goal', 'third'),
    ]);
    expect(await storage.getItem('kilo_weight_goal')).toBe('third');
  });
});

// ── the cold-start shape itself ───────────────────────────────────────────────
//
// Exactly the hooks each mounted tab instantiates (App.js renderContent mounts
// all four tab subtrees at once), in mount order, with the shell as the parent
// so its own effects run last — the same probe shape startup-read-coalescing
// uses, extended to observe every term of Home's first-paint gate.
const gate = {};
function HomeProbe() {
  const goal = useWeightGoal();
  const tracked = useTrackedLifts();
  const filter = useRecoveryAnalyticsFilter();
  useRecoveryBlockState();
  gate.goalLoading = goal.loading;
  gate.trackedLiftsLoading = tracked.loading;
  gate.recoveryBoundaryReady = filter.ready;
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
function ColdStartShell() {
  const weight = useWeightEntries();
  const notes = useWorkoutNotes();
  gate.loading = weight.loading || notes.loading;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(HomeProbe),
    React.createElement(LogProbe),
    React.createElement(WeightProbe),
    React.createElement(AnalyticsProbe),
  );
}

describe("Home's first-paint gate (#984)", () => {
  it('clears only once every one of its four sources has resolved', async () => {
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
    await Storage.saveTrackedLifts({ Squat: true });

    for (const key of Object.keys(gate)) delete gate[key];
    AsyncStorage.getItem.mockClear();

    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(ColdStartShell));
    });
    await flushAsync();
    await flushAsync();

    // All four terms of `isLoading` in HomeScreen.js resolve — none of them was
    // dropped, defaulted, or raced to clear the skeleton sooner. In particular
    // `recoveryBoundaryReady` is still an independently-established fact
    // (#699), not something inferred from the other three.
    expect(gate.loading).toBe(false);
    expect(gate.goalLoading).toBe(false);
    expect(gate.trackedLiftsLoading).toBe(false);
    expect(gate.recoveryBoundaryReady).toBe(true);

    // And the launch still issues one read per key: overlapping reads must not
    // reintroduce the duplicates #818 removed by defeating the coalescing map.
    const readsByKey = {};
    for (const [key] of AsyncStorage.getItem.mock.calls) {
      readsByKey[key] = (readsByKey[key] || 0) + 1;
    }
    expect(readsByKey.kilo_workout_notes).toBe(1);
    expect(readsByKey.kilo_weight_entries).toBe(1);
    expect(readsByKey.kilo_tracked_lifts).toBe(1);
    expect(readsByKey.kilo_weight_goal).toBe(1);
  });
});
