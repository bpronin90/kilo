// Regression coverage for issue #813: concurrent maybeSyncCloud() callers share
// passes instead of each running their own, and the entry hooks read on-device
// storage once at mount unless a pass actually ran.
//
// Background: every write broadcast fans out to every mounted useWorkoutNotes()
// / useWeightEntries() instance, and each instance's refresh() calls
// maybeSyncCloud(). Those calls serialize on the recovery-operation guard, so
// adapter.sync()'s single-flight never saw them together: one Log autosave with
// every tab mounted ran three complete pull/merge/push passes back to back.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import * as Storage from '../storage/entries';
import { WORKOUT_NOTES_KEY, WEIGHT_KEY, CURRENT_WORKOUT_ID_KEY } from '../storage/entries/keys';
import { secureStorage } from '../storage/secureStorage';
import {
  SYNC_PHASE,
  SYNC_STATUS,
  getSyncState,
  loadLastSuccessfulSyncAt,
  resetPhase,
  runPhase,
  __resetSyncQueue,
} from '../storage/syncRecovery';
import {
  SINGLETON_SYNC_ID,
  SYNC_TABLES,
  resetClientIdCacheForTests,
  resetStampClockForTests,
} from '../storage/syncQueue';
import { useTrackedLifts } from '../hooks/entries/trackedLiftHooks';
import { parseWorkoutNote } from '../lib/parser';
import { cloudAdapter, setCloudTransport } from '../storage/cloudAdapter';
import { maybeSyncCloud, __resetMaybeSyncCloudForTests } from '../hooks/entries/storageMode';
import { useWeightEntries, useWorkoutNotes } from '../hooks/useEntries';
import { makeXidFakeCloud } from './mocks/xidFakeCloud';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// A cloud adapter whose sync() blocks until the test releases it, so the test
// controls exactly when a pass is "running".
function mockBlockingCloudAdapter() {
  const passes = [];
  const sync = jest.fn(() => {
    const gate = deferred();
    passes.push(gate);
    return gate.promise;
  });
  jest.spyOn(Storage, 'getStorageAdapter').mockReturnValue({ mode: 'cloud', sync });
  return { sync, passes };
}

async function flushAsync(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetSyncQueue();
  __resetMaybeSyncCloudForTests();
  resetClientIdCacheForTests();
  resetStampClockForTests();
  jest.restoreAllMocks();
  setCloudTransport(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
});

afterEach(() => {
  __resetMaybeSyncCloudForTests();
  setCloudTransport(null);
  Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
  jest.restoreAllMocks();
});

describe('maybeSyncCloud coalescing (#813)', () => {
  it('resolves false without touching the adapter outside cloud mode', async () => {
    const { sync } = mockBlockingCloudAdapter();
    await expect(maybeSyncCloud()).resolves.toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it('callers that arrive together share one pass and all resolve true', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes } = mockBlockingCloudAdapter();

    // The write broadcast: three mounted instances, same synchronous fan-out.
    const results = Promise.all([maybeSyncCloud(), maybeSyncCloud(), maybeSyncCloud()]);
    await flushAsync();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.RUNNING);

    passes[0].resolve({ ok: true });
    await expect(results).resolves.toEqual([true, true, true]);
    await flushAsync();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
  });

  it('callers that arrive while a pass is running get exactly one trailing pass, shared', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes } = mockBlockingCloudAdapter();

    const first = maybeSyncCloud();
    await flushAsync();
    expect(sync).toHaveBeenCalledTimes(1);

    // Two more writes land while the first pass is in flight. Neither may join
    // it (it may already have read the queue), and they must not each start a
    // pass of their own.
    const second = maybeSyncCloud();
    const third = maybeSyncCloud();
    await flushAsync();
    expect(sync).toHaveBeenCalledTimes(1);

    passes[0].resolve({ ok: true });
    await expect(first).resolves.toBe(true);
    await flushAsync();
    // The trailing pass began only after the first finished.
    expect(sync).toHaveBeenCalledTimes(2);

    passes[1].resolve({ ok: true });
    await expect(Promise.all([second, third])).resolves.toEqual([true, true]);
    await flushAsync();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('a call after everything settled starts a fresh pass', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes } = mockBlockingCloudAdapter();
    const first = maybeSyncCloud();
    await flushAsync();
    passes[0].resolve({ ok: true });
    await first;
    await flushAsync();

    const later = maybeSyncCloud();
    await flushAsync();
    expect(sync).toHaveBeenCalledTimes(2);
    passes[1].resolve({ ok: true });
    await expect(later).resolves.toBe(true);
  });

  it('a failed pass still resolves true for every sharer and marks the phase failed', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { passes } = mockBlockingCloudAdapter();
    const results = Promise.all([maybeSyncCloud(), maybeSyncCloud()]);
    await flushAsync();
    passes[0].reject(new Error('offline'));
    await expect(results).resolves.toEqual([true, true]);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.FAILED);
  });

  it('a pending pass re-checks the storage mode when it actually starts', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync } = mockBlockingCloudAdapter();
    const pending = maybeSyncCloud();
    // Signed out before the deferred start ran.
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    await expect(pending).resolves.toBe(false);
    expect(sync).not.toHaveBeenCalled();
  });

  it('a pass that finishes after sign-out leaves the reset phase idle, so the next sign-in still syncs', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { passes } = mockBlockingCloudAdapter();
    const running = maybeSyncCloud();
    await flushAsync();
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.RUNNING);

    // What useAutoSync does on sign-out while the pass is still in flight.
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    resetPhase(SYNC_PHASE.SYNC);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.IDLE);

    passes[0].resolve({ ok: true });
    await expect(running).resolves.toBe(true);
    // Not COMPLETE: the automatic sign-in sync only runs from IDLE, and a stale
    // completion here would have skipped it and stranded signed-out writes.
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.IDLE);

    // The failure path is guarded the same way.
    __resetMaybeSyncCloudForTests();
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const failing = maybeSyncCloud();
    await flushAsync();
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    resetPhase(SYNC_PHASE.SYNC);
    passes[1].reject(new Error('offline'));
    await expect(failing).resolves.toBe(true);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.IDLE);
  });

  // The phase is reset AND claimed again before the old pass settles, so the
  // status is back to RUNNING and looks exactly like the old pass's own. Only a
  // per-run ownership token can tell the two apart (issue #813 review).
  it('a pass that finishes after sign-out and a re-sign-in cannot settle the new pass', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { passes } = mockBlockingCloudAdapter();

    // Pass A is in flight.
    const passA = maybeSyncCloud();
    await flushAsync();
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.RUNNING);

    // Sign-out, while pass A is still in flight.
    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    resetPhase(SYNC_PHASE.SYNC);

    // Sign back in: the independent runPhase path starts pass B.
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const gateB = deferred();
    const passB = runPhase(SYNC_PHASE.SYNC, () => gateB.promise);
    await flushAsync();
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.RUNNING);

    // Pass A settles now. It must publish nothing: pass B owns the phase and is
    // still running, and a stale success here would also stamp a last-successful
    // -sync time for a pass that has not finished.
    passes[0].resolve({ ok: true });
    await expect(passA).resolves.toBe(true);
    await flushAsync();
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.RUNNING);
    expect(getSyncState()[SYNC_PHASE.SYNC].error).toBeNull();
    await expect(loadLastSuccessfulSyncAt()).resolves.toBeNull();

    // Pass B still settles its own phase normally.
    gateB.resolve({ ok: true });
    await passB;
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    await expect(loadLastSuccessfulSyncAt()).resolves.toEqual(expect.any(String));
  });

  it('a pass that FAILS after sign-out and a re-sign-in cannot fail the new pass', async () => {
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { passes } = mockBlockingCloudAdapter();

    const passA = maybeSyncCloud();
    await flushAsync();

    Storage.setStorageMode(Storage.STORAGE_MODES.LOCAL);
    resetPhase(SYNC_PHASE.SYNC);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);

    const gateB = deferred();
    const passB = runPhase(SYNC_PHASE.SYNC, () => gateB.promise);
    await flushAsync();

    passes[0].reject(new Error('offline'));
    await expect(passA).resolves.toBe(true);
    await flushAsync();
    // Not FAILED: pass B is still running and has not failed.
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.RUNNING);
    expect(getSyncState()[SYNC_PHASE.SYNC].retryable).toBe(false);

    gateB.resolve({ ok: true });
    await passB;
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
  });
});

describe('entry hooks read on-device storage once at mount unless a pass ran (#813)', () => {
  function mount(useHook, instances = 3) {
    const refs = [];
    function Probe() {
      for (let i = 0; i < instances; i++) refs[i] = useHook(); // eslint-disable-line react-hooks/rules-of-hooks
      return null;
    }
    let tree;
    act(() => { tree = TestRenderer.create(React.createElement(Probe)); });
    return { refs, tree };
  }

  const readsOf = (key) => AsyncStorage.getItem.mock.calls.filter(([k]) => k === key).length;

  it('useWorkoutNotes: one shared notebook read for every mounted instance in local mode, and no sync', async () => {
    await Storage.saveWorkoutNoteItem({ id: 'n1', title: 'Push', raw_text: '-Bench\n135 5,5' });
    const { sync } = mockBlockingCloudAdapter();
    AsyncStorage.getItem.mockClear();

    const { refs, tree } = mount(useWorkoutNotes);
    await flushAsync();

    expect(refs.every((r) => r.loading === false)).toBe(true);
    expect(refs.every((r) => r.notes.map((n) => n.id).join() === 'n1')).toBe(true);
    // Three mounted instances, one read - #813 got this down from six to three
    // (one per instance, none of them a post-sync re-read); #818 shares the one
    // in-flight decrypt between the instances, so the notebook is now read once.
    expect(readsOf(WORKOUT_NOTES_KEY)).toBe(1);
    expect(sync).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('useWeightEntries: one shared table read for every mounted instance in local mode', async () => {
    await Storage.saveWeightEntry({ id: 'w1', weight_value: 180, logged_at: '2026-08-10T12:00:00.000Z' });
    AsyncStorage.getItem.mockClear();
    const { refs, tree } = mount(useWeightEntries);
    await flushAsync();
    expect(refs.every((r) => r.entries.map((e) => e.id).join() === 'w1')).toBe(true);
    // One shared decrypt for all three instances (#818); see the note above.
    expect(readsOf(WEIGHT_KEY)).toBe(1);
    act(() => tree.unmount());
  });

  it('in cloud mode the instances paint from the device first, then share one pass and reload once each', async () => {
    await Storage.saveWorkoutNoteItem({ id: 'n1', title: 'Push', raw_text: '-Bench\n135 5,5' });
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes } = mockBlockingCloudAdapter();
    // In cloud mode the hooks read through the adapter; keep the mocked
    // adapter's reads on the same local notebook.
    Storage.getStorageAdapter.mockReturnValue({
      mode: 'cloud',
      sync,
      loadWorkoutNotes: Storage.loadWorkoutNotes,
    });
    AsyncStorage.getItem.mockClear();

    const { refs, tree } = mount(useWorkoutNotes);
    await flushAsync();
    // First paint from the device, while the (single) pass is still running.
    expect(refs.every((r) => r.loading === false && r.notes.length === 1)).toBe(true);
    expect(readsOf(WORKOUT_NOTES_KEY)).toBe(1);
    expect(sync).toHaveBeenCalledTimes(1);

    passes[0].resolve({ ok: true });
    await flushAsync();
    // The post-pass reload: still once per instance, but the three concurrent
    // reads share one decrypt (#818), so this is the second read of the key and
    // not the sixth.
    expect(readsOf(WORKOUT_NOTES_KEY)).toBe(2);
    expect(sync).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('end to end: a write broadcast runs one real pass and that pass uploads the write', async () => {
    // Real cloud adapter and engine against the xid-faithful fake transport, so
    // this proves upload eligibility, not just pass counts: the single pass the
    // broadcast shares must be the one that carries the caller's write.
    const cloud = makeXidFakeCloud();
    setCloudTransport(cloud.transport);
    await Storage.replaceWorkoutNotesRaw([{
      id: 'n1', title: 'Push', raw_text: '-Bench\n135 5,5', saved_at: '2026-08-01T10:00:00.000Z',
      updated_at: '2026-08-01T10:00:00.000Z', tracked_exercises: [], one_k_exercises: null, isCurrent: true,
    }]);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await cloudAdapter.sync({ ownedDevice: false });
    const passSpy = jest.spyOn(cloudAdapter, 'sync');

    const { refs, tree } = mount(useWorkoutNotes);
    await flushAsync(8);
    // Mounting three instances in cloud mode shared one background pass.
    expect(passSpy).toHaveBeenCalledTimes(1);
    passSpy.mockClear();
    const pushesBefore = cloud.calls.push;

    await act(async () => { await refs[1].update('n1', { raw_text: '-Bench\n140 5,5' }); });
    await flushAsync(8);

    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(cloud.calls.push - pushesBefore).toBe(1);
    expect(cloud.remoteRow(SYNC_TABLES.WORKOUT_NOTES, 'n1').raw_text).toBe('-Bench\n140 5,5');
    expect(refs.every((r) => r.notes[0].raw_text === '-Bench\n140 5,5')).toBe(true);
    act(() => tree.unmount());
  });

  it('a write broadcast with three mounted instances costs one pass and one reload per instance', async () => {
    await Storage.saveWorkoutNoteItem({ id: 'n1', title: 'Push', raw_text: '-Bench\n135 5,5' });
    const { refs, tree } = mount(useWorkoutNotes);
    await flushAsync();

    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes } = mockBlockingCloudAdapter();
    Storage.getStorageAdapter.mockReturnValue({
      mode: 'cloud',
      sync,
      loadWorkoutNotes: Storage.loadWorkoutNotes,
      saveWorkoutNoteItem: Storage.saveWorkoutNoteItem,
    });
    AsyncStorage.getItem.mockClear();

    await act(async () => { await refs[1].update('n1', { raw_text: '-Bench\n140 5,5' }); });
    await flushAsync();
    expect(sync).toHaveBeenCalledTimes(1);
    passes[0].resolve({ ok: true });
    await flushAsync();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(refs.every((r) => r.notes[0].raw_text === '-Bench\n140 5,5')).toBe(true);
    act(() => tree.unmount());
  });
});

// A Track toggle is a write too (#1393). Before this it requested no pass at
// all, so the health row stayed stale until some unrelated note/weight save,
// launch, or refresh happened to run one — while the indicator kept showing the
// last successful pass. Real cloud adapter and engine, xid-faithful transport.
describe('Track toggles upload through the shared pass (#1393)', () => {
  const HISTORY = parseWorkoutNote('Monday\n-Bench\n225 5\n235 5\n245 5').sections;

  function mountTracked() {
    const ref = { current: null };
    function Probe() {
      ref.current = useTrackedLifts();
      return null;
    }
    let tree;
    act(() => { tree = TestRenderer.create(React.createElement(Probe)); });
    return { ref, tree };
  }

  const healthRow = (cloud) => cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SINGLETON_SYNC_ID);

  async function signedInDevice(cloud) {
    setCloudTransport(cloud.transport);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await cloudAdapter.sync({ ownedDevice: false });
  }

  it('Track and untrack each reach kilo.user_health_profile with no other trigger', async () => {
    const cloud = makeXidFakeCloud();
    await signedInDevice(cloud);
    const passSpy = jest.spyOn(cloudAdapter, 'sync');
    const { ref, tree } = mountTracked();
    await flushAsync(8);
    expect(passSpy).not.toHaveBeenCalled();

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flushAsync(8);
    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(healthRow(cloud).tracked_lifts).toEqual({ bench: true });
    expect(healthRow(cloud).tracked_lift_activations.bench).toEqual(
      expect.objectContaining({ anchor: 3, witness: expect.objectContaining({ headings: ['Monday'] }) }),
    );
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flushAsync(8);
    expect(passSpy).toHaveBeenCalledTimes(2);
    expect(healthRow(cloud).tracked_lifts).toEqual({});
    expect(healthRow(cloud).tracked_lift_activations).toEqual({});
    act(() => tree.unmount());
  });

  it('an untrack made while the health-row push is in flight survives that push ack', async () => {
    const cloud = makeXidFakeCloud();
    await signedInDevice(cloud);
    const { ref, tree } = mountTracked();
    await flushAsync(8);

    const realPush = cloud.transport.push;
    let gate = null;
    let paused = false;
    cloud.transport.push = jest.fn(async (table, records) => {
      if (table === SYNC_TABLES.USER_HEALTH_PROFILE && !paused) {
        paused = true;
        gate = deferred();
        await gate.promise;
      }
      return realPush(table, records);
    });

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flushAsync(8);
    expect(gate).not.toBeNull();

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flushAsync(2);
    expect(await Storage.loadTrackedLifts()).toEqual({});

    gate.resolve();
    await flushAsync(16);

    expect(await Storage.loadTrackedLifts()).toEqual({});
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
    expect(healthRow(cloud).tracked_lifts).toEqual({});
    expect(healthRow(cloud).tracked_lift_activations).toEqual({});
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    act(() => tree.unmount());
  });

  // Codex FEEDBACK 2 on PR #1397: the untrack lands while the ack write-back is
  // INSIDE its own storage operations (after its re-read), not during a network
  // wait. Only a shared local-write lock between the write-back and the Track
  // write queue keeps the two from interleaving.
  it('an untrack landing during the ack write-back storage ops is neither reverted nor lost', async () => {
    const cloud = makeXidFakeCloud();
    await signedInDevice(cloud);
    const { ref, tree } = mountTracked();
    await flushAsync(8);

    // Arm once the health-row push has been acknowledged; the first
    // current-workout-id read after that is the guard's re-read, the second is
    // applyUserHealthProfile's, which this holds.
    let armed = false;
    let readsAfterAck = 0;
    let readGate = null;
    const realPush = cloud.transport.push;
    cloud.transport.push = jest.fn(async (table, records) => {
      const acks = await realPush(table, records);
      if (table === SYNC_TABLES.USER_HEALTH_PROFILE && readGate === null) armed = true;
      return acks;
    });
    const realGetItem = secureStorage.getItem.bind(secureStorage);
    jest.spyOn(secureStorage, 'getItem').mockImplementation(async (key) => {
      if (armed && key === CURRENT_WORKOUT_ID_KEY) {
        readsAfterAck += 1;
        if (readsAfterAck === 2) {
          armed = false;
          readGate = deferred();
          await readGate.promise;
        }
      }
      return realGetItem(key);
    });

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flushAsync(8);
    expect(readGate).not.toBeNull();

    // Untrack while the ack application is parked mid-storage-op. Not awaited
    // here: with the lock it must wait for the write-back to finish.
    let untrack;
    let untrackSettled = false;
    await act(async () => {
      untrack = ref.current.toggle('bench', HISTORY);
      untrack.then(() => { untrackSettled = true; });
    });
    await flushAsync(4);
    // The untrack is queued behind the write-back's locked section, not
    // interleaved inside it.
    expect(untrackSettled).toBe(false);

    readGate.resolve();
    await act(async () => { await untrack; });
    await flushAsync(16);

    expect(await Storage.loadTrackedLifts()).toEqual({});
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
    expect(healthRow(cloud).tracked_lifts).toEqual({});
    expect(healthRow(cloud).tracked_lift_activations).toEqual({});
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    act(() => tree.unmount());
  });

  // Codex FEEDBACK 3 on PR #1397: a refresh that starts AND finishes while a
  // queued write is waiting for the lock must not adopt the older durable state
  // over that write's optimistic module state, or the next toggle derives from
  // the stale value.
  it('a refresh while a write waits for the lock does not roll back the queued intent', async () => {
    const cloud = makeXidFakeCloud();
    await signedInDevice(cloud);
    const { ref, tree } = mountTracked();
    await flushAsync(8);

    let armed = false;
    let readsAfterAck = 0;
    let readGate = null;
    const realPush = cloud.transport.push;
    cloud.transport.push = jest.fn(async (table, records) => {
      const acks = await realPush(table, records);
      if (table === SYNC_TABLES.USER_HEALTH_PROFILE && readGate === null) armed = true;
      return acks;
    });
    const realGetItem = secureStorage.getItem.bind(secureStorage);
    jest.spyOn(secureStorage, 'getItem').mockImplementation(async (key) => {
      if (armed && key === CURRENT_WORKOUT_ID_KEY) {
        readsAfterAck += 1;
        if (readsAfterAck === 2) {
          armed = false;
          readGate = deferred();
          await readGate.promise;
        }
      }
      return realGetItem(key);
    });

    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flushAsync(8);
    expect(readGate).not.toBeNull();

    // Untrack queues behind the held write-back; module state is already {}.
    let untrack;
    await act(async () => { untrack = ref.current.toggle('bench', HISTORY); });
    await flushAsync(4);
    // A refresh starts and finishes during that wait (durable is still bench).
    await act(async () => { ref.current.refresh(); });
    await flushAsync(8);
    // Retrack, queued behind the untrack: must derive from {} and track again.
    let retrack;
    await act(async () => { retrack = ref.current.toggle('bench', HISTORY); });

    readGate.resolve();
    await act(async () => { await untrack; await retrack; });
    await flushAsync(16);

    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    expect((await Storage.loadTrackedLiftActivations()).bench).toEqual(expect.objectContaining({ anchor: 3 }));
    expect(healthRow(cloud).tracked_lifts).toEqual({ bench: true });
    expect(healthRow(cloud).tracked_lift_activations.bench).toEqual(expect.objectContaining({ anchor: 3 }));
    expect(ref.current.trackedLifts).toEqual({ bench: true });
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    act(() => tree.unmount());
  });

  it('negative: a refresh with no write pending adopts a value a pass pulled from another device', async () => {
    const cloud = makeXidFakeCloud();
    await signedInDevice(cloud);
    const { ref, tree } = mountTracked();
    await flushAsync(8);
    await act(async () => { await ref.current.toggle('bench', HISTORY); });
    await flushAsync(8);
    expect(healthRow(cloud).tracked_lifts).toEqual({ bench: true });

    // Another device replaces the health row's tracked lifts.
    const { __xid: _x, updated_at: _u, ...row } = healthRow(cloud); // eslint-disable-line no-unused-vars
    await cloud.transport.push(SYNC_TABLES.USER_HEALTH_PROFILE, [{
      ...row, tracked_lifts: { squat: true }, tracked_lift_activations: {},
    }]);
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true });

    await act(async () => { ref.current.refresh(); });
    await flushAsync(8);
    expect(ref.current.trackedLifts).toEqual({ squat: true });

    // And the next toggle derives from the adopted value, not the old one.
    await act(async () => { await ref.current.toggle('deadlift', HISTORY); });
    await flushAsync(8);
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true, deadlift: true });
    act(() => tree.unmount());
  });

  it('offline: the toggle stays local, the phase fails retryably, and a retry uploads it', async () => {
    const cloud = makeXidFakeCloud();
    await signedInDevice(cloud);
    const { ref, tree } = mountTracked();
    await flushAsync(8);

    const realPush = cloud.transport.push;
    cloud.transport.push = jest.fn(() => Promise.reject(new Error('Network request failed')));
    await act(async () => { await ref.current.toggle('squat', HISTORY); });
    await flushAsync(8);

    const failed = getSyncState()[SYNC_PHASE.SYNC];
    expect(failed.status).toBe(SYNC_STATUS.FAILED);
    expect(failed.retryable).toBe(true);
    expect(healthRow(cloud)?.tracked_lifts?.squat).toBeUndefined();
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true });

    cloud.transport.push = realPush;
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    expect(healthRow(cloud).tracked_lifts).toEqual({ squat: true });
    expect(healthRow(cloud).tracked_lift_activations.squat).toEqual(expect.objectContaining({ anchor: 0 }));
    act(() => tree.unmount());
  });
});

// #1398: a sync pass that durably applies another device's Track flags and
// activations must reach the mounted hook, so the NEXT toggle derives from the
// pulled state instead of uploading only its own lift over it. Real hook, real
// cloud adapter, xid-faithful transport.
describe('a pulled Track change is adopted by a mounted hook (#1398)', () => {
  const HISTORY = parseWorkoutNote('Monday\n-Bench\n225 5\n235 5\n245 5').sections;
  const RECORD = { anchor: 0, at: '2026-09-01T00:00:00.000Z', witness: null };
  const healthRow = (cloud) => cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SINGLETON_SYNC_ID);

  function mountTracked() {
    const ref = { current: null };
    function Probe() {
      ref.current = useTrackedLifts();
      return null;
    }
    let tree;
    act(() => { tree = TestRenderer.create(React.createElement(Probe)); });
    return { ref, tree };
  }

  // Device A: signed in, synced once, hook mounted and idle, Bench tracked.
  // Device B is a direct transport push of the health row.
  async function deviceA(cloud) {
    setCloudTransport(cloud.transport);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await cloudAdapter.sync({ ownedDevice: false });
    const mounted = mountTracked();
    await flushAsync(8);
    await act(async () => { await mounted.ref.current.toggle('bench', HISTORY); });
    await flushAsync(8);
    return mounted;
  }

  async function deviceBWrites(cloud, patch) {
    const { __xid: _x, updated_at: _u, ...row } = healthRow(cloud); // eslint-disable-line no-unused-vars
    await cloud.transport.push(SYNC_TABLES.USER_HEALTH_PROFILE, [{ ...row, ...patch }]);
  }

  const squatAdded = {
    tracked_lifts: { bench: true, squat: true },
    tracked_lift_activations: { bench: RECORD, squat: RECORD },
  };

  it('B tracks Squat, A pulls, A toggles Deadlift: both survive locally and in the upload', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    await deviceBWrites(cloud, squatAdded);
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    // Adopted with no refresh() call and no remount.
    expect(ref.current.trackedLifts).toEqual({ bench: true, squat: true });
    expect(Object.keys(ref.current.activations).sort()).toEqual(['bench', 'squat']);

    await act(async () => { await ref.current.toggle('deadlift', HISTORY); });
    await flushAsync(8);
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true, squat: true, deadlift: true });
    expect(Object.keys(await Storage.loadTrackedLiftActivations()).sort()).toEqual(['bench', 'deadlift', 'squat']);
    expect(healthRow(cloud).tracked_lifts).toEqual({ bench: true, squat: true, deadlift: true });
    expect(Object.keys(healthRow(cloud).tracked_lift_activations).sort()).toEqual(['bench', 'deadlift', 'squat']);
    expect(healthRow(cloud).tracked_lift_activations.squat).toEqual(RECORD);
    expect(ref.current.trackedLifts).toEqual({ bench: true, squat: true, deadlift: true });
    act(() => tree.unmount());
  });

  it('a pulled UNTRACK is adopted too, so the next toggle does not resurrect the lift', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    await deviceBWrites(cloud, { tracked_lifts: {}, tracked_lift_activations: {} });
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(ref.current.trackedLifts).toEqual({});

    await act(async () => { await ref.current.toggle('deadlift', HISTORY); });
    await flushAsync(8);
    expect(healthRow(cloud).tracked_lifts).toEqual({ deadlift: true });
    expect(Object.keys(healthRow(cloud).tracked_lift_activations)).toEqual(['deadlift']);
    act(() => tree.unmount());
  });

  it('negative: a pass that changes nothing starts no extra pass and leaves the hook state alone', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    const before = ref.current.trackedLifts;
    const passSpy = jest.spyOn(cloudAdapter, 'sync');
    const pushes = cloud.calls.push;

    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(passSpy).toHaveBeenCalledTimes(1);
    expect(cloud.calls.push).toBe(pushes);
    expect(ref.current.trackedLifts).toBe(before);
    act(() => tree.unmount());
  });

  it('negative: a row predating the activations column applies flags and keeps local records', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    const localBench = (await Storage.loadTrackedLiftActivations()).bench;
    const { __xid: _x, updated_at: _u, tracked_lift_activations: _a, ...row } = healthRow(cloud); // eslint-disable-line no-unused-vars
    await cloud.transport.push(SYNC_TABLES.USER_HEALTH_PROFILE, [{
      ...row, tracked_lifts: { bench: true, squat: true },
    }]);
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(ref.current.trackedLifts).toEqual({ bench: true, squat: true });
    expect((await Storage.loadTrackedLiftActivations()).bench).toEqual(localBench);
    act(() => tree.unmount());
  });

  it('a toggle racing the pull leaves hook, storage and server on one coherent pair', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    await deviceBWrites(cloud, squatAdded);
    let pulling;
    let toggling;
    await act(async () => {
      pulling = maybeSyncCloud();
      toggling = ref.current.toggle('deadlift', HISTORY);
    });
    await act(async () => { await pulling; await toggling; });
    await flushAsync(16);
    // Whole-row merge policy decides which device's row wins a true race; what
    // must hold is that nothing is torn or rolled back by a stale hook cache.
    const flags = await Storage.loadTrackedLifts();
    const records = await Storage.loadTrackedLiftActivations();
    expect(Object.keys(records).sort()).toEqual(Object.keys(flags).sort());
    expect(ref.current.trackedLifts).toEqual(flags);
    expect(Object.keys(ref.current.activations).sort()).toEqual(Object.keys(flags).sort());
    expect(healthRow(cloud).tracked_lifts).toEqual(flags);
    expect(Object.keys(healthRow(cloud).tracked_lift_activations).sort()).toEqual(Object.keys(flags).sort());
    expect(flags.bench).toBe(true);
    act(() => tree.unmount());
  });

  it('a failed storage write mid-apply publishes no half pair, and a later pass recovers', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    // The same pulled row also carries another field, which must not be left
    // half-applied (it would read as a local edit and upload over B's row).
    await deviceBWrites(cloud, { ...squatAdded, fatigue_multiplier: 1.2 });
    const realSetItem = secureStorage.setItem.bind(secureStorage);
    let failing = true;
    jest.spyOn(secureStorage, 'setItem').mockImplementation(async (key, value) => {
      if (failing && key === 'kilo_tracked_lift_activations') throw new Error('disk full');
      return realSetItem(key, value);
    });
    await act(async () => { await maybeSyncCloud().catch(() => {}); });
    await flushAsync(8);
    // The half-applied pair was rolled back: storage, hook and server never
    // hold flags without their records.
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    expect(await Storage.loadFatigueMultiplier()).toBe(1.07);
    expect(Object.keys(ref.current.trackedLifts).sort())
      .toEqual(Object.keys(await Storage.loadTrackedLifts()).sort());
    expect(Object.keys(ref.current.activations).sort())
      .toEqual(Object.keys(await Storage.loadTrackedLiftActivations()).sort());

    failing = false;
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(ref.current.trackedLifts).toEqual({ bench: true, squat: true });
    expect(Object.keys(ref.current.activations).sort()).toEqual(['bench', 'squat']);
    expect(await Storage.loadFatigueMultiplier()).toBe(1.2);
    expect(Object.keys(healthRow(cloud).tracked_lift_activations).sort()).toEqual(['bench', 'squat']);
    act(() => tree.unmount());
  });

  const CORRUPT = '{not json';
  const squatOnly = { tracked_lifts: { squat: true }, tracked_lift_activations: { squat: RECORD } };

  // Synced and EMPTY, so the corrupt (reads-as-{}) local map is no local edit
  // against the baseline and the pulled row is what wins.
  async function deviceAEmpty(cloud) {
    const mounted = await deviceA(cloud);
    await act(async () => { await mounted.ref.current.toggle('bench', HISTORY); });
    await flushAsync(8);
    return mounted;
  }

  it('a corrupt local flags map does not block a pull: a successful apply heals it', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceAEmpty(cloud);
    await deviceBWrites(cloud, squatOnly);
    await secureStorage.setItem('kilo_tracked_lifts', CORRUPT);
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true });
    expect(await secureStorage.getItem('kilo_tracked_lifts')).not.toBe(CORRUPT);
    expect(getSyncState()[SYNC_PHASE.SYNC].status).toBe(SYNC_STATUS.COMPLETE);
    expect(Object.keys(ref.current.activations)).toEqual(['squat']);
    act(() => tree.unmount());
  });

  it('a corrupt map plus an activation write failure restores the exact corrupt bytes, retryably', async () => {
    const cloud = makeXidFakeCloud();
    const { tree } = await deviceAEmpty(cloud);
    await deviceBWrites(cloud, squatOnly);
    await secureStorage.setItem('kilo_tracked_lifts', CORRUPT);
    const realSetItem = secureStorage.setItem.bind(secureStorage);
    let failing = true;
    jest.spyOn(secureStorage, 'setItem').mockImplementation(async (key, value) => {
      if (failing && key === 'kilo_tracked_lift_activations') throw new Error('disk full');
      return realSetItem(key, value);
    });
    await act(async () => { await maybeSyncCloud().catch(() => {}); });
    await flushAsync(8);
    expect(await secureStorage.getItem('kilo_tracked_lifts')).toBe(CORRUPT);
    const failed = getSyncState()[SYNC_PHASE.SYNC];
    expect(failed.status).toBe(SYNC_STATUS.FAILED);
    expect(failed.retryable).toBe(true);

    failing = false;
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true });
    act(() => tree.unmount());
  });

  it('a flags read error after the activation write never prunes the records to nothing', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    await deviceBWrites(cloud, squatAdded);
    const realSetItem = secureStorage.setItem.bind(secureStorage);
    const realGetItem = secureStorage.getItem.bind(secureStorage);
    let armed = false;
    let rejected = 0;
    jest.spyOn(secureStorage, 'setItem').mockImplementation(async (key, value) => {
      const out = await realSetItem(key, value);
      if (key === 'kilo_tracked_lift_activations') armed = true;
      return out;
    });
    jest.spyOn(secureStorage, 'getItem').mockImplementation(async (key) => {
      if (armed && rejected === 0 && key === 'kilo_tracked_lifts') {
        rejected += 1;
        throw new Error('transient read');
      }
      return realGetItem(key);
    });
    await act(async () => { await maybeSyncCloud().catch(() => {}); });
    await flushAsync(8);
    armed = false;
    expect(Object.keys(await Storage.loadTrackedLiftActivations()).sort()).toEqual(['bench', 'squat']);
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true, squat: true });
    expect(Object.keys(healthRow(cloud).tracked_lift_activations).sort()).toEqual(['bench', 'squat']);
    expect(Object.keys(ref.current.activations).sort()).toEqual(['bench', 'squat']);
    act(() => tree.unmount());
  });

  // After the raw snapshot the apply performs no storage read, so a read error
  // there cannot make a tolerant {} look equal to an incoming {} and skip a write.
  async function pullWithReadErrorAfterSnapshot(cloud, failKey) {
    const settings = jest.requireActual('../storage/entries/settings');
    const realSnapshot = settings.readTrackedLiftRaw;
    const realGetItem = secureStorage.getItem.bind(secureStorage);
    let armed = false;
    let rejected = 0;
    jest.spyOn(settings, 'readTrackedLiftRaw').mockImplementation(async (...args) => {
      const out = await realSnapshot(...args);
      armed = true;
      return out;
    });
    jest.spyOn(secureStorage, 'getItem').mockImplementation(async (key) => {
      if (armed && rejected === 0 && key === failKey) {
        rejected += 1;
        throw new Error('transient read');
      }
      return realGetItem(key);
    });
    await act(async () => { await maybeSyncCloud().catch(() => {}); });
    await flushAsync(8);
    armed = false;
    return rejected;
  }

  it('remote clear + flags comparison read error: both maps end cleared, not half applied', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    await deviceBWrites(cloud, { tracked_lifts: {}, tracked_lift_activations: {} });
    await pullWithReadErrorAfterSnapshot(cloud, 'kilo_tracked_lifts');
    expect(await Storage.loadTrackedLifts()).toEqual({});
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
    expect(ref.current.trackedLifts).toEqual({});
    act(() => tree.unmount());
  });

  it('remote clear of records + activations comparison read error: the records are cleared', async () => {
    const cloud = makeXidFakeCloud();
    const { tree } = await deviceA(cloud);
    await deviceBWrites(cloud, { tracked_lifts: { bench: true }, tracked_lift_activations: {} });
    await pullWithReadErrorAfterSnapshot(cloud, 'kilo_tracked_lift_activations');
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
    act(() => tree.unmount());
  });

  it('an unreadable rollback snapshot aborts the apply untouched; the pass is retryable and the next applies', async () => {
    const cloud = makeXidFakeCloud();
    const { ref, tree } = await deviceA(cloud);
    await deviceBWrites(cloud, squatAdded);
    // The strict snapshot read fails once; the later write of the activations
    // would also fail. With no snapshot, applying anyway would leave a half pair
    // that nothing can roll back.
    const settings = jest.requireActual('../storage/entries/settings');
    jest.spyOn(settings, 'readTrackedLiftRaw').mockRejectedValueOnce(new Error('transient read'));
    const realSetItem = secureStorage.setItem.bind(secureStorage);
    let failing = true;
    jest.spyOn(secureStorage, 'setItem').mockImplementation(async (key, value) => {
      if (failing && key === 'kilo_tracked_lift_activations') throw new Error('disk full');
      return realSetItem(key, value);
    });
    await act(async () => { await maybeSyncCloud().catch(() => {}); });
    await flushAsync(8);
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true });
    expect(Object.keys(await Storage.loadTrackedLiftActivations())).toEqual(['bench']);
    const failed = getSyncState()[SYNC_PHASE.SYNC];
    expect(failed.status).toBe(SYNC_STATUS.FAILED);
    expect(failed.retryable).toBe(true);

    failing = false;
    await act(async () => { await maybeSyncCloud(); });
    await flushAsync(8);
    expect(await Storage.loadTrackedLifts()).toEqual({ bench: true, squat: true });
    expect(Object.keys(ref.current.activations).sort()).toEqual(['bench', 'squat']);
    expect(Object.keys(healthRow(cloud).tracked_lift_activations).sort()).toEqual(['bench', 'squat']);
    act(() => tree.unmount());
  });
});
