// The Track toggle as the single mint/retire point for a tracked span (#893).
//
// Track stays manual, explicit and unchanged as shipped copy. What changed is
// what the toggle WRITES: a canonical storage key, and an activation record that
// is born and dies with the flag. These tests drive the real hook against real
// storage, because the invariant that matters — a flag and its record never
// diverge — is a property of that write, not of any pure function.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { useTrackedLifts } from '../hooks/entries/trackedLiftHooks';
import * as Storage from '../storage/entries';
import { parseWorkoutNote } from '../lib/parser';
import { __resetMaybeSyncCloudForTests, maybeSyncCloud } from '../hooks/entries/storageMode';
import { SYNC_PHASE, SYNC_STATUS, getSyncState, __resetSyncQueue } from '../storage/syncRecovery';

let mountedTrees = [];

function renderHook() {
  const ref = { current: null };
  function Probe() {
    ref.current = useTrackedLifts();
    return null;
  }
  let tree;
  act(() => { tree = renderer.create(React.createElement(Probe)); });
  mountedTrees.push(tree);
  return ref;
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetSyncQueue();
  __resetMaybeSyncCloudForTests();
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
});

afterEach(() => {
  mountedTrees.forEach((t) => act(() => t.unmount()));
  mountedTrees = [];
  __resetMaybeSyncCloudForTests();
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  jest.restoreAllMocks();
});

const HISTORY = parseWorkoutNote('Monday\n-Bench\n225 5\n235 5\n245 5').sections;

describe('the Track toggle', () => {
  test('tracking mints a record anchored at the current logged-session count', async () => {
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flush();

    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    const records = await Storage.loadTrackedLiftActivations();
    expect(records.bench.anchor).toBe(3);
    expect(records.bench.witness.headings).toEqual(['Monday']);
    expect(typeof records.bench.at).toBe('string');
  });

  test('untracking deletes the flag and the record together', async () => {
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flush();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flush();

    expect(await Storage.loadTrackedLifts()).toEqual({});
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
  });

  test('retracking mints a FRESH record, so gap entries can never be inherited', async () => {
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flush();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flush();

    const withGap = parseWorkoutNote('Monday\n-Bench\n225 5\n235 5\n245 5\n255 5\n185 5').sections;
    await act(async () => { await ref.current.toggle('bench', withGap); });
    await flush();

    const records = await Storage.loadTrackedLiftActivations();
    expect(records.bench.anchor).toBe(5);
  });

  test('the storage key is the CANONICAL key, so an alias cannot open a second identity', async () => {
    const sections = parseWorkoutNote('Monday\n-iso row\n90 10\n100 10').sections;
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('hammer strength iso row', sections); });
    await flush();

    expect(Object.keys(await Storage.loadTrackedLifts())).toEqual(['hammer strength iso row']);
    expect(Object.keys(await Storage.loadTrackedLiftActivations())).toEqual(['hammer strength iso row']);
  });

  test('a legacy alias key is collapsed onto its canonical key at the next toggle, and tracked wins', async () => {
    // Two legacy keys for one movement. Toggling a THIRD, unrelated exercise is
    // enough to canonicalize the map — which is exactly the contract's "upgraded
    // only by that exercise's next toggle", applied at the write.
    await Storage.saveTrackedLifts({ 'iso row': true, 'hammer strength iso row': true, squat: true });
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('deadlift', HISTORY); });
    await flush();

    const lifts = await Storage.loadTrackedLifts();
    expect(lifts['hammer strength iso row']).toBe(true);
    expect(lifts['iso row']).toBeUndefined();
    expect(lifts['squat']).toBe(true);
  });

  test('a non-alias legacy key survives canonicalization byte-identically', async () => {
    await Storage.saveTrackedLifts({ 'face pull': true, 'cable fly': true });
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('deadlift', HISTORY); });
    await flush();

    const lifts = await Storage.loadTrackedLifts();
    expect(lifts['face pull']).toBe(true);
    expect(lifts['cable fly']).toBe(true);
  });

  test('an exercise with no logged history anchors at 0 with no witness', async () => {
    const sections = parseWorkoutNote('Monday\n-Brand New Lift 3x10').sections;
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('brand new lift', sections); });
    await flush();

    const records = await Storage.loadTrackedLiftActivations();
    expect(records['brand new lift']).toEqual({ anchor: 0, at: expect.any(String), witness: null });
  });

  test('a caller with no parse in hand gets the shipped boolean behavior and no record', async () => {
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('bench'); });
    await flush();

    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
  });

  test('the save-boundary reconcile retires a record whose movement is gone, keeping the flag', async () => {
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flush();

    const withoutBench = parseWorkoutNote('Monday\n-Squat\n315 5').sections;
    await act(async () => { await ref.current.reconcileActivations(withoutBench); });
    await flush();

    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
    // The explicit Track intent survives. Auto-untracking a movement that is out
    // of the routine for a deload, an injury, or a routine switch would destroy
    // exactly the intent the flag exists to carry.
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
  });

  test('a legacy flag map keeps every record whose key is still tracked when save() prunes', async () => {
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flush();

    // Dropping a different key must not disturb bench's record; dropping bench
    // must take its record with it, so nothing can outlive its flag.
    await act(async () => { await ref.current.save({ bench: true, squat: true }); });
    await flush();
    expect((await Storage.loadTrackedLiftActivations()).bench.anchor).toBe(3);

    await act(async () => { await ref.current.save({ squat: true }); });
    await flush();
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
  });

  test('the reconcile persists a stale-anchor repair so the span does not re-clamp forever', async () => {
    const ref = renderHook();
    await flush();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flush();

    const shorter = parseWorkoutNote('Monday\n-Bench\n225 5\n235 5').sections;
    await act(async () => { await ref.current.reconcileActivations(shorter); });
    await flush();

    const records = await Storage.loadTrackedLiftActivations();
    expect(records.bench.anchor).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cloud sync after a durable Track write (#1393)
// ─────────────────────────────────────────────────────────────────────────────
//
// A Track/untrack is health data on the consent-gated singleton. It used to sit
// unuploaded until some unrelated note/weight save or relaunch happened to run a
// pass. These drive the real hook and the real maybeSyncCloud coalescer against
// a cloud adapter whose sync() records what DURABLE storage held when the pass
// began, then blocks until the test releases it.

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function mockCloudAdapter() {
  const passes = [];
  const seen = [];
  const sync = jest.fn(async () => {
    seen.push({
      lifts: await Storage.loadTrackedLifts(),
      activations: await Storage.loadTrackedLiftActivations(),
    });
    const gate = deferred();
    passes.push(gate);
    return gate.promise;
  });
  jest.spyOn(Storage, 'getStorageAdapter').mockReturnValue({ mode: 'cloud', sync });
  return { sync, passes, seen };
}

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setImmediate(r)); });
  }
}

const syncStatus = () => getSyncState()[SYNC_PHASE.SYNC].status;

describe('a durable Track write requests a cloud pass (#1393)', () => {
  test('local mode: the write lands and no cloud pass runs', async () => {
    const { sync } = mockCloudAdapter();
    const ref = renderHook();
    await settle();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await settle();

    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    expect(sync).not.toHaveBeenCalled();
    expect(syncStatus()).toBe(SYNC_STATUS.IDLE);
  });

  test('Track starts one pass that sees BOTH the flag and its activation record', async () => {
    const ref = renderHook();
    await settle();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudAdapter();

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await settle();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(seen[0].lifts).toEqual({ bench: true });
    expect(seen[0].activations.bench.anchor).toBe(3);
    expect(syncStatus()).toBe(SYNC_STATUS.RUNNING);

    passes[0].resolve({ ok: true });
    await settle();
    expect(syncStatus()).toBe(SYNC_STATUS.COMPLETE);
  });

  test('untrack starts a pass that sees the flag and the record gone together', async () => {
    const ref = renderHook();
    await settle();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await settle();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudAdapter();

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await settle();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({ lifts: {}, activations: {} });
    passes[0].resolve({ ok: true });
    await settle();
  });

  test('bulk save starts a pass over the saved flags and the pruned records', async () => {
    const ref = renderHook();
    await settle();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await settle();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudAdapter();

    await act(async () => { await ref.current.save({ squat: true }); });
    await settle();

    expect(sync).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({ lifts: { squat: true }, activations: {} });
    passes[0].resolve({ ok: true });
    await settle();
  });

  test('a CHANGED save-boundary reconcile requests a pass; a no-change one does not', async () => {
    const ref = renderHook();
    await settle();
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await settle();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudAdapter();

    // Same population the record was minted from: nothing to retire or repair.
    await act(async () => { await ref.current.reconcileActivations(HISTORY); });
    await settle();
    expect(sync).not.toHaveBeenCalled();

    const withoutBench = parseWorkoutNote('Monday\n-Squat\n315 5').sections;
    await act(async () => { await ref.current.reconcileActivations(withoutBench); });
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({ lifts: { bench: true }, activations: {} });
    passes[0].resolve({ ok: true });
    await settle();
  });

  test('a failed pass keeps the local change, reports failed/retryable, and a retry uploads it', async () => {
    const ref = renderHook();
    await settle();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudAdapter();

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await settle();
    passes[0].reject(new Error('offline'));
    await settle();

    const state = getSyncState()[SYNC_PHASE.SYNC];
    expect(state.status).toBe(SYNC_STATUS.FAILED);
    expect(state.retryable).toBe(true);
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    expect((await Storage.loadTrackedLiftActivations()).bench.anchor).toBe(3);

    const retry = maybeSyncCloud();
    await settle();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(seen[1].lifts).toEqual({ bench: true });
    expect(seen[1].activations.bench.anchor).toBe(3);
    passes[1].resolve({ ok: true });
    await expect(retry).resolves.toBe(true);
    expect(syncStatus()).toBe(SYNC_STATUS.COMPLETE);
  });

  test('a storage write failure starts no pass for the incomplete pair, and the queue survives', async () => {
    const ref = renderHook();
    await settle();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudAdapter();
    // The flag write lands; the paired record write fails at the device store.
    // AsyncStorage is the package's jest mock, so swap its implementation and put
    // the original back rather than spying (a restore would strip the mock).
    const realSetItem = AsyncStorage.setItem.getMockImplementation();
    let failed = false;
    AsyncStorage.setItem.mockImplementation((key, value) => {
      if (!failed && key === 'kilo_tracked_lift_activations') {
        failed = true;
        return Promise.reject(new Error('disk full'));
      }
      return realSetItem(key, value);
    });

    let thrown = null;
    await act(async () => {
      await ref.current.toggle('bench', HISTORY).catch((e) => { thrown = e; });
    });
    await settle();
    expect(thrown?.message).toBe('disk full');
    expect(sync).not.toHaveBeenCalled();
    expect(syncStatus()).toBe(SYNC_STATUS.IDLE);

    // A later write is not poisoned by the failed one and syncs normally.
    AsyncStorage.setItem.mockImplementation(realSetItem);
    expect(failed).toBe(true);
    await act(async () => { await ref.current.toggle('squat', HISTORY); });
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(seen[0].lifts.squat).toBe(true);
    expect(seen[0].activations.squat).toEqual(expect.objectContaining({ anchor: 0 }));
    passes[0].resolve({ ok: true });
    await settle();
  });

  test('rapid toggles during a running pass share ONE trailing pass that carries the final intent', async () => {
    const ref = renderHook();
    await settle();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudAdapter();

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);

    // Pass 0 is still blocked on the network. The toggles must still complete
    // (the write queue does not wait on it) and must not each start a pass.
    await act(async () => {
      await ref.current.toggle('squat', HISTORY);
      await ref.current.toggle('bench', HISTORY);
      await ref.current.toggle('deadlift', HISTORY);
      await ref.current.toggle('squat', HISTORY);
    });
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(await Storage.loadTrackedLifts()).toEqual({ deadlift: true });

    passes[0].resolve({ ok: true });
    await settle();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(seen[1].lifts).toEqual({ deadlift: true });
    expect(Object.keys(seen[1].activations)).toEqual(['deadlift']);

    passes[1].resolve({ ok: true });
    await settle();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(syncStatus()).toBe(SYNC_STATUS.COMPLETE);
  });

  test('a burst of toggles while a pass is pending ends in a pass over the final pair', async () => {
    const ref = renderHook();
    await settle();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudAdapter();

    await act(async () => {
      await Promise.all([
        ref.current.toggle('bench', HISTORY),
        ref.current.toggle('squat', HISTORY),
        ref.current.toggle('bench', HISTORY),
        ref.current.toggle('bench', HISTORY),
      ]);
    });
    await settle();
    // Four requests; the coalescer allows at most the pass that began plus one
    // trailing pass, never one per toggle.
    expect(sync.mock.calls.length).toBeLessThanOrEqual(2);
    for (let i = 0; i < 2; i++) {
      passes.forEach((p) => p.resolve({ ok: true }));
      // eslint-disable-next-line no-await-in-loop
      await settle();
    }
    expect(sync.mock.calls.length).toBeLessThanOrEqual(2);
    const last = seen[seen.length - 1];
    expect(last.lifts).toEqual({ bench: true, squat: true });
    expect(Object.keys(last.activations).sort()).toEqual(['bench', 'squat']);
    expect(syncStatus()).toBe(SYNC_STATUS.COMPLETE);
  });
});
