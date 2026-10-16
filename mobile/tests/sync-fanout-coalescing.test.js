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
import {
  WORKOUT_NOTES_KEY,
  WEIGHT_KEY,
  CURRENT_WORKOUT_ID_KEY,
  USER_PROFILE_KEY,
  COLLAPSED_STATE_KEY,
  FATIGUE_MULTIPLIER_KEY,
  WEIGHT_DATE_EDIT_KEY,
  DELOAD_DATE_EDIT_KEY,
  FATIGUE_TRACKING_KEY,
  DELOAD_MODE_KEY,
  WORKOUT_DELOAD_NOTE_KEY,
  WORKOUT_DELOAD_HISTORY_KEY,
  WEIGHT_GOAL_KEY,
  TRACKED_LIFTS_KEY,
  TRACKED_LIFT_ACTIVATIONS_KEY,
} from '../storage/entries/keys';
import { mergeUserProfile } from '../storage/entries/profileStorage';
import { withLocalWriteLock } from '../storage/sync/localWriteLock';
import { migrateToNotebook } from '../storage/entries/migrations';
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
import { maybeSyncCloud, withRecoveryReconciliation, __resetMaybeSyncCloudForTests } from '../hooks/entries/storageMode';
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

// Diff-synced settings writers share the write-back's lock (#1399). Each case
// parks the ACK write-back inside its own storage operations (the apply's read
// of the setting's key, after the re-read guard), performs a local write while
// it is parked, and then checks the write was neither reverted nor lost: the
// durable value is the latest intent and the NEXT pass uploads it. Real cloud
// adapter, real storage, xid-faithful fake transport.
describe('settings writers vs the ack write-back (#1399)', () => {
  const SELF = SINGLETON_SYNC_ID;
  const tick = async (n = 8) => {
    for (let i = 0; i < n; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const remote = (cloud, table) => cloud.remoteRow(table, SELF);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ms = (t) => (t == null ? null : Date.parse(t));
  const goal = (target) => ({
    target_weight: target, target_date: '2026-12-01', start_weight: 190, start_date: '2026-06-01',
  });
  const dh = (id, text) => ({
    id, date: '2026-06-20', raw_text: text, saved_at: '2026-06-20T10:00:00.000Z',
  });

  // Runs: init pass -> setup (v0) -> pass -> first (v1) -> parked pass with
  // `during` writes fired while parked -> release -> one more pass.
  async function run({ table, key, setup, first, during, failFirstWriteOf = null }) {
    const cloud = makeXidFakeCloud();
    setCloudTransport(cloud.transport);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await cloudAdapter.sync({ ownedDevice: false });
    if (setup) {
      await setup();
      await cloudAdapter.sync();
    }
    await first();

    let armed = false;
    let reads = 0;
    let gate = null;
    const realPush = cloud.transport.push;
    cloud.transport.push = jest.fn(async (t, records) => {
      const acks = await realPush(t, records);
      if (t === table && gate === null) armed = true;
      return acks;
    });
    const realGet = secureStorage.getItem.bind(secureStorage);
    jest.spyOn(secureStorage, 'getItem').mockImplementation(async (k) => {
      if (armed && k === key) {
        reads += 1;
        if (reads === 2) {
          armed = false;
          gate = deferred();
          await gate.promise;
        }
      }
      return realGet(k);
    });
    if (failFirstWriteOf) {
      const realSet = secureStorage.setItem.bind(secureStorage);
      let failed = false;
      jest.spyOn(secureStorage, 'setItem').mockImplementation(async (k, v) => {
        if (gate && !failed && k === failFirstWriteOf) {
          failed = true;
          throw new Error('disk full');
        }
        return realSet(k, v);
      });
    }

    const pass = cloudAdapter.sync();
    for (let i = 0; i < 40 && gate === null; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tick(1);
    }
    expect(gate).not.toBeNull();

    const writes = during().map((p) => Promise.resolve(p).then(() => 'ok', () => 'failed'));
    await tick(6);
    gate.resolve();
    const outcomes = await Promise.all(writes);
    await pass;
    jest.restoreAllMocks();
    await cloudAdapter.sync();
    await tick(4);
    return { cloud, outcomes };
  }

  describe('user_profile', () => {
    const base = { table: SYNC_TABLES.USER_PROFILE, key: USER_PROFILE_KEY };
    const setup = () => Storage.saveUserProfile({
      display_name: 'A', unit_system: 'lb', height_cm: 180,
    });

    it('display_name edit keeps unit_system and device-local fields', async () => {
      const { cloud } = await run({
        ...base, setup,
        first: () => mergeUserProfile({ display_name: 'B' }),
        during: () => [mergeUserProfile({ display_name: 'C' })],
      });
      const p = await Storage.loadUserProfile();
      expect(p).toEqual(expect.objectContaining({ display_name: 'C', unit_system: 'lb', height_cm: 180 }));
      expect(remote(cloud, SYNC_TABLES.USER_PROFILE).display_name).toBe('C');
    });

    it('unit_system edit while a display_name ack applies keeps both', async () => {
      const { cloud } = await run({
        ...base, setup,
        first: () => mergeUserProfile({ display_name: 'B' }),
        during: () => [mergeUserProfile({ unit_system: 'kg' })],
      });
      const p = await Storage.loadUserProfile();
      expect(p).toEqual(expect.objectContaining({ display_name: 'B', unit_system: 'kg', height_cm: 180 }));
      expect(remote(cloud, SYNC_TABLES.USER_PROFILE).unit_system).toBe('kg');
    });

    it('a whole-record save lands and uploads', async () => {
      const { cloud } = await run({
        ...base, setup,
        first: () => mergeUserProfile({ display_name: 'B' }),
        during: () => [Storage.saveUserProfile({ display_name: 'D', unit_system: 'kg' })],
      });
      expect(await Storage.loadUserProfile()).toEqual(
        expect.objectContaining({ display_name: 'D', unit_system: 'kg' }),
      );
      expect(remote(cloud, SYNC_TABLES.USER_PROFILE)).toEqual(
        expect.objectContaining({ display_name: 'D', unit_system: 'kg' }),
      );
    });

    it('clearing the profile lands and uploads the cleared fields', async () => {
      const { cloud } = await run({
        ...base, setup,
        first: () => mergeUserProfile({ display_name: 'B' }),
        during: () => [Storage.clearUserProfile()],
      });
      expect(await Storage.loadUserProfile()).toBeNull();
      expect(remote(cloud, SYNC_TABLES.USER_PROFILE)).toEqual(
        expect.objectContaining({ display_name: null, unit_system: null }),
      );
    });

    it('rapid profile edits keep the last one', async () => {
      const { cloud } = await run({
        ...base, setup,
        first: () => mergeUserProfile({ display_name: 'B' }),
        during: () => [
          mergeUserProfile({ display_name: 'C' }),
          mergeUserProfile({ display_name: 'E' }),
        ],
      });
      expect((await Storage.loadUserProfile()).display_name).toBe('E');
      expect(remote(cloud, SYNC_TABLES.USER_PROFILE).display_name).toBe('E');
    });

    it('a collapsed-state flip lands and uploads', async () => {
      const { cloud } = await run({
        table: SYNC_TABLES.USER_PROFILE, key: COLLAPSED_STATE_KEY,
        first: () => Storage.saveWorkoutCollapsed(true),
        during: () => [Storage.saveWorkoutCollapsed(false)],
      });
      expect(await Storage.loadWorkoutCollapsed()).toBe(false);
      expect(remote(cloud, SYNC_TABLES.USER_PROFILE).ui_state.log_current_collapsed).toBe(false);
    });

    it('a collapsed-state set lands and uploads', async () => {
      const { cloud } = await run({
        table: SYNC_TABLES.USER_PROFILE, key: COLLAPSED_STATE_KEY,
        setup: () => Storage.saveWorkoutCollapsed(true),
        first: () => Storage.saveWorkoutCollapsed(false),
        during: () => [Storage.saveWorkoutCollapsed(true)],
      });
      expect(await Storage.loadWorkoutCollapsed()).toBe(true);
      expect(remote(cloud, SYNC_TABLES.USER_PROFILE).ui_state.log_current_collapsed).toBe(true);
    });
  });

  describe('user_health_profile', () => {
    const base = { table: SYNC_TABLES.USER_HEALTH_PROFILE };

    it('current workout id: set', async () => {
      const { cloud } = await run({
        ...base, key: CURRENT_WORKOUT_ID_KEY,
        setup: () => Storage.saveCurrentWorkoutId('wn_a'),
        first: () => Storage.saveCurrentWorkoutId('wn_b'),
        during: () => [Storage.saveCurrentWorkoutId('wn_c')],
      });
      expect(await Storage.loadCurrentWorkoutId()).toBe('wn_c');
      expect(remote(cloud, base.table).current_workout_note_id).toBe('wn_c');
    });

    it('current workout id: clear', async () => {
      const { cloud } = await run({
        ...base, key: CURRENT_WORKOUT_ID_KEY,
        setup: () => Storage.saveCurrentWorkoutId('wn_a'),
        first: () => Storage.saveCurrentWorkoutId('wn_b'),
        during: () => [Storage.clearCurrentWorkoutId()],
      });
      expect(await Storage.loadCurrentWorkoutId()).toBeNull();
      expect(remote(cloud, base.table).current_workout_note_id).toBeNull();
    });

    it('setCurrentWorkoutNote (notebook flags + direct id write)', async () => {
      const note = (id) => ({ id, raw_text: `Day ${id}\n-Bench\n135 5`, updated_at: '2026-06-01T00:00:00.000Z' });
      const { cloud } = await run({
        ...base, key: CURRENT_WORKOUT_ID_KEY,
        setup: async () => {
          await Storage.saveWorkoutNoteItem(note('wn_a'));
          await Storage.saveWorkoutNoteItem(note('wn_b'));
          await Storage.setCurrentWorkoutNote('wn_a');
        },
        first: () => Storage.saveCurrentWorkoutId('wn_b'),
        during: () => [Storage.setCurrentWorkoutNote('wn_a')],
      });
      expect(await Storage.loadCurrentWorkoutId()).toBe('wn_a');
      const notes = await Storage.loadWorkoutNotesRaw();
      expect(notes.find((n) => n.id === 'wn_a').isCurrent).toBe(true);
      expect(remote(cloud, base.table).current_workout_note_id).toBe('wn_a');
    });

    it('fatigue multiplier: edit', async () => {
      const r = await run({
        ...base, key: FATIGUE_MULTIPLIER_KEY,
        setup: () => Storage.saveFatigueMultiplier(1.1),
        first: () => Storage.saveFatigueMultiplier(1.2),
        during: () => [Storage.saveFatigueMultiplier(1.3)],
      });
      expect(await Storage.loadFatigueMultiplier()).toBe(1.3);
      expect(remote(r.cloud, base.table).fatigue_multiplier).toBe(1.3);
    });

    it('fatigue multiplier: a failed holder then a good write still completes', async () => {
      const r = await run({
        ...base, key: FATIGUE_MULTIPLIER_KEY,
        setup: () => Storage.saveFatigueMultiplier(1.1),
        first: () => Storage.saveFatigueMultiplier(1.2),
        during: () => [Storage.saveFatigueMultiplier(1.3), Storage.saveFatigueMultiplier(1.4)],
        failFirstWriteOf: FATIGUE_MULTIPLIER_KEY,
      });
      expect(r.outcomes).toEqual(['failed', 'ok']);
      expect(await Storage.loadFatigueMultiplier()).toBe(1.4);
      expect(remote(r.cloud, base.table).fatigue_multiplier).toBe(1.4);
    });

    it('active deload note: save', async () => {
      const r = await run({
        ...base, key: WORKOUT_DELOAD_NOTE_KEY,
        setup: () => Storage.saveDeloadNote('d0'),
        first: () => Storage.saveDeloadNote('d1'),
        during: () => [Storage.saveDeloadNote('d2')],
      });
      expect(JSON.parse(await AsyncStorage.getItem(WORKOUT_DELOAD_NOTE_KEY)).raw_text).toBe('d2');
      expect(remote(r.cloud, base.table).current_deload_note_raw_text).toBe('d2');
    });

    it('active deload note: clear', async () => {
      const r = await run({
        ...base, key: WORKOUT_DELOAD_NOTE_KEY,
        setup: () => Storage.saveDeloadNote('d0'),
        first: () => Storage.saveDeloadNote('d1'),
        during: () => [Storage.clearDeloadNote()],
      });
      expect(await AsyncStorage.getItem(WORKOUT_DELOAD_NOTE_KEY)).toBeNull();
      expect(remote(r.cloud, base.table).current_deload_note_raw_text).toBeNull();
    });
  });

  describe('active deload note timestamps', () => {
    const base = { table: SYNC_TABLES.USER_HEALTH_PROFILE, key: WORKOUT_DELOAD_NOTE_KEY };
    const stored = async () => JSON.parse(await AsyncStorage.getItem(WORKOUT_DELOAD_NOTE_KEY));

    it('updated_at moves with raw_text and saved_at unchanged', async () => {
      let before;
      const r = await run({
        ...base, first: async () => { before = await Storage.saveDeloadNote('d1'); await sleep(5); },
        during: () => [Storage.saveDeloadNote('d1')],
      });
      const note = await stored();
      expect(note.raw_text).toBe('d1');
      expect(note.saved_at).toBe(before.saved_at);
      expect(note.updated_at).not.toBe(before.updated_at);
      const row = remote(r.cloud, base.table);
      expect(ms(row.current_deload_note_saved_at)).toBe(ms(note.saved_at));
      expect(ms(row.current_deload_note_updated_at)).toBe(ms(note.updated_at));
    });

    it('saved_at and updated_at both move (re-generated deload, same text)', async () => {
      let before;
      let after;
      const r = await run({
        ...base, first: async () => { before = await Storage.saveDeloadNote('d1'); await sleep(5); },
        during: () => [
          Storage.clearDeloadNote().then(() => Storage.saveDeloadNote('d1')).then((n) => { after = n; }),
        ],
      });
      const note = await stored();
      expect(note.raw_text).toBe('d1');
      expect(note.saved_at).toBe(after.saved_at);
      expect(note.saved_at).not.toBe(before.saved_at);
      expect(note.updated_at).toBe(after.updated_at);
      const row = remote(r.cloud, base.table);
      expect(ms(row.current_deload_note_saved_at)).toBe(ms(after.saved_at));
      expect(ms(row.current_deload_note_updated_at)).toBe(ms(after.updated_at));
    });
  });

  describe('feature_toggles', () => {
    const toggles = [
      ['weight_date_edit_enabled', WEIGHT_DATE_EDIT_KEY, 'saveWeightDateEditEnabled', 'loadWeightDateEditEnabled'],
      ['deload_date_edit_enabled', DELOAD_DATE_EDIT_KEY, 'saveDeloadDateEditEnabled', 'loadDeloadDateEditEnabled'],
      ['fatigue_tracking_enabled', FATIGUE_TRACKING_KEY, 'saveFatigueTrackingEnabled', 'loadFatigueTrackingEnabled'],
      ['deload_mode_enabled', DELOAD_MODE_KEY, 'saveDeloadModeEnabled', 'loadDeloadModeEnabled'],
    ];
    const table = SYNC_TABLES.FEATURE_TOGGLES;

    it.each(toggles)('%s: cleared while an on-ack applies', async (field, key, save, load) => {
      const r = await run({
        table, key,
        first: () => Storage[save](true),
        during: () => [Storage[save](false)],
      });
      expect(await Storage[load]()).toBe(false);
      expect(remote(r.cloud, table)[field]).toBe(false);
    });

    it.each(toggles)('%s: set while an off-ack applies', async (field, key, save, load) => {
      const r = await run({
        table, key,
        setup: () => Storage[save](true),
        first: () => Storage[save](false),
        during: () => [Storage[save](true)],
      });
      expect(await Storage[load]()).toBe(true);
      expect(remote(r.cloud, table)[field]).toBe(true);
    });

    it('rapid toggles keep the last one', async () => {
      const r = await run({
        table, key: FATIGUE_TRACKING_KEY,
        first: () => Storage.saveFatigueTrackingEnabled(true),
        during: () => [
          Storage.saveFatigueTrackingEnabled(false),
          Storage.saveFatigueTrackingEnabled(true),
          Storage.saveFatigueTrackingEnabled(false),
        ],
      });
      expect(await Storage.loadFatigueTrackingEnabled()).toBe(false);
      expect(remote(r.cloud, table).fatigue_tracking_enabled).toBe(false);
    });

    it('a failed toggle write does not wedge the next one', async () => {
      const r = await run({
        table, key: DELOAD_MODE_KEY,
        first: () => Storage.saveDeloadModeEnabled(true),
        during: () => [Storage.saveDeloadModeEnabled(false), Storage.saveDeloadModeEnabled(false)],
        failFirstWriteOf: DELOAD_MODE_KEY,
      });
      expect(r.outcomes).toEqual(['failed', 'ok']);
      expect(await Storage.loadDeloadModeEnabled()).toBe(false);
      expect(remote(r.cloud, table).deload_mode_enabled).toBe(false);
    });
  });

  describe('weight_goal', () => {
    const base = { table: SYNC_TABLES.WEIGHT_GOAL, key: WEIGHT_GOAL_KEY };

    it('goal edit lands and uploads', async () => {
      const r = await run({
        ...base,
        setup: () => Storage.saveWeightGoal(goal(180)),
        first: () => Storage.saveWeightGoal(goal(175)),
        during: () => [Storage.saveWeightGoal(goal(170))],
      });
      expect((await Storage.loadWeightGoal()).target_weight).toBe(170);
      expect(remote(r.cloud, base.table).target_weight).toBe(170);
    });

    const GOAL_V1 = { ...goal(175), goal_json: { k: 'v1' } };
    const fieldCases = [
      ['target_date', { target_date: '2027-01-15' }],
      ['start_weight', { start_weight: 200 }],
      ['start_date', { start_date: '2026-07-04' }],
      ['goal_json', { goal_json: { k: 'v2' } }],
    ];
    it.each(fieldCases)('%s edit with target_weight unchanged lands and uploads', async (field, patch) => {
      const r = await run({
        ...base,
        setup: () => Storage.saveWeightGoal({ ...goal(180), goal_json: { k: 'v0' } }),
        first: () => Storage.saveWeightGoal(GOAL_V1),
        during: () => [Storage.saveWeightGoal({ ...GOAL_V1, ...patch })],
      });
      const durable = await Storage.loadWeightGoal();
      const row = remote(r.cloud, base.table);
      expect(durable.target_weight).toBe(175);
      expect(row.target_weight).toBe(175);
      expect(durable[field]).toEqual(patch[field]);
      expect(row[field]).toEqual(patch[field]);
      expect(ms(row.saved_at)).toBe(ms(durable.saved_at));
    });

    it('saved_at (re-stamped by the write) with every other field unchanged lands and uploads', async () => {
      let v1;
      const r = await run({
        ...base,
        setup: () => Storage.saveWeightGoal(GOAL_V1),
        first: async () => { v1 = await Storage.saveWeightGoal(GOAL_V1); await sleep(5); },
        during: () => [Storage.saveWeightGoal(GOAL_V1)],
      });
      const durable = await Storage.loadWeightGoal();
      expect(durable.saved_at).not.toBe(v1.saved_at);
      expect(ms(remote(r.cloud, base.table).saved_at)).toBe(ms(durable.saved_at));
    });

    it('goal clear lands and uploads as a delete', async () => {
      const r = await run({
        ...base,
        setup: () => Storage.saveWeightGoal(goal(180)),
        first: () => Storage.saveWeightGoal(goal(175)),
        during: () => [Storage.clearWeightGoal()],
      });
      expect(await Storage.loadWeightGoal()).toBeNull();
      expect(remote(r.cloud, base.table).deleted_at).toBeTruthy();
    });
  });

  describe('deload_history', () => {
    const base = { table: SYNC_TABLES.DELOAD_HISTORY, key: WORKOUT_DELOAD_HISTORY_KEY };
    const setup = async () => {
      await Storage.appendDeloadHistory(dh('dh_1', 'one'));
      await Storage.appendDeloadHistory(dh('dh_2', 'two'));
    };
    const first = () => Storage.updateDeloadHistory('dh_1', { raw_text: 'one-v1' });

    it('edits to both rows are kept and upload', async () => {
      const r = await run({
        ...base, setup, first,
        during: () => [
          Storage.updateDeloadHistory('dh_1', { raw_text: 'one-v2' }),
          Storage.updateDeloadHistory('dh_2', { raw_text: 'two-v2' }),
        ],
      });
      const list = await Storage.loadDeloadHistory();
      expect(list.map((x) => [x.id, x.raw_text])).toEqual([['dh_1', 'one-v2'], ['dh_2', 'two-v2']]);
      expect(r.cloud.remoteRow(base.table, 'dh_1').raw_text).toBe('one-v2');
      expect(r.cloud.remoteRow(base.table, 'dh_2').raw_text).toBe('two-v2');
    });

    it.each([
      ['date', { date: '2026-07-01' }],
      ['saved_at', { saved_at: '2026-07-01T09:30:00.000Z' }],
    ])('%s edit with raw_text unchanged lands and uploads', async (field, patch) => {
      const r = await run({
        ...base, setup, first,
        during: () => [Storage.updateDeloadHistory('dh_1', patch)],
      });
      const row = (await Storage.loadDeloadHistory()).find((x) => x.id === 'dh_1');
      const up = r.cloud.remoteRow(base.table, 'dh_1');
      expect(row.raw_text).toBe('one-v1');
      expect(up.raw_text).toBe('one-v1');
      const norm = (v) => (field === 'saved_at' ? ms(v) : v);
      expect(norm(row[field])).toBe(norm(patch[field]));
      expect(norm(up[field])).toBe(norm(patch[field]));
    });

    it('record_json metadata (session_count, completed_at) with raw_text unchanged lands and uploads', async () => {
      const patch = { session_count: 7, completed_at: '2026-07-02T11:00:00.000Z' };
      const r = await run({
        ...base, setup,
        first: () => Storage.updateDeloadHistory('dh_1', {
          raw_text: 'one-v1', session_count: 3, completed_at: '2026-07-01T11:00:00.000Z',
        }),
        during: () => [Storage.updateDeloadHistory('dh_1', patch)],
      });
      const row = (await Storage.loadDeloadHistory()).find((x) => x.id === 'dh_1');
      const up = r.cloud.remoteRow(base.table, 'dh_1');
      expect(row).toEqual(expect.objectContaining({ raw_text: 'one-v1', ...patch }));
      expect(up.raw_text).toBe('one-v1');
      expect(up.record_json).toEqual(expect.objectContaining(patch));
    });

    it('a delete is not resurrected and uploads as a tombstone', async () => {
      const r = await run({ ...base, setup, first, during: () => [Storage.deleteDeloadHistory('dh_1')] });
      expect((await Storage.loadDeloadHistory()).map((x) => x.id)).toEqual(['dh_2']);
      expect(r.cloud.remoteRow(base.table, 'dh_1').deleted_at).toBeTruthy();
    });

    it('an append is kept and uploads', async () => {
      const r = await run({
        ...base, setup, first,
        during: () => [Storage.appendDeloadHistory(dh('dh_3', 'three'))],
      });
      expect((await Storage.loadDeloadHistory()).map((x) => x.id)).toEqual(['dh_1', 'dh_2', 'dh_3']);
      expect(r.cloud.remoteRow(base.table, 'dh_3').raw_text).toBe('three');
      expect(r.cloud.remoteRow(base.table, 'dh_1').raw_text).toBe('one-v1');
    });

    it('a failed holder then a good delete still completes', async () => {
      const r = await run({
        ...base, setup, first,
        during: () => [Storage.deleteDeloadHistory('dh_1'), Storage.deleteDeloadHistory('dh_1')],
        failFirstWriteOf: WORKOUT_DELOAD_HISTORY_KEY,
      });
      expect(r.outcomes).toEqual(['failed', 'ok']);
      expect((await Storage.loadDeloadHistory()).map((x) => x.id)).toEqual(['dh_2']);
      expect(r.cloud.remoteRow(base.table, 'dh_1').deleted_at).toBeTruthy();
    });
  });
});

// #1409. Clean-cloud hydration and the current-id migration, traced against sync
// passes and ordinary locked writers.
//
// Hydration runs only from bootstrapFromLocal, whose sole production runner
// wraps it in withRecoveryReconciliation: the same recovery guard every sync pass
// holds. So a SYNC PASS cannot overlap it. The guard does NOT exclude ordinary
// local writers (a Track toggle takes the hook queue and local-write lock, never
// the guard), and hydration's flags -> read -> records sequence used raw savers.
describe('clean-cloud hydration vs ordinary writers (#1409)', () => {
  const REC = { anchor: 0, at: '2026-06-20T10:00:00.000Z', witness: null };
  const tick = async (n = 6) => {
    for (let i = 0; i < n; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const readJson = async (k) => JSON.parse(await secureStorage.getItem(k));

  // A Track toggle's storage section, as trackedLiftHooks runs it: both writes
  // inside one local-write section.
  const trackBench = () => withLocalWriteLock(async () => {
    await Storage.saveTrackedLifts({ squat: true, bench: true });
    await Storage.saveTrackedLiftActivations({ squat: REC, bench: REC });
  });

  async function hydrateWithTrackLanding() {
    const realGet = secureStorage.getItem.bind(secureStorage);
    let gate = null;
    jest.spyOn(secureStorage, 'getItem').mockImplementation(async (k) => {
      if (k === TRACKED_LIFTS_KEY && gate === null) {
        gate = deferred();
        await gate.promise;
      }
      return realGet(k);
    });
    const hydration = Storage.hydrateProfileFromCloud({
      tracked_lifts: { squat: true },
      tracked_lift_activations: { squat: REC },
    }, null);
    for (let i = 0; i < 40 && gate === null; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tick(1);
    }
    expect(gate).not.toBeNull();
    const track = trackBench();
    await tick(6);
    gate.resolve();
    await Promise.all([hydration, track]);
    jest.restoreAllMocks();
  }

  it('a Track toggle landing mid-hydration keeps its flag and its record', async () => {
    await hydrateWithTrackLanding();
    expect(await readJson(TRACKED_LIFTS_KEY)).toEqual({ squat: true, bench: true });
    expect(Object.keys(await readJson(TRACKED_LIFT_ACTIVATIONS_KEY)).sort()).toEqual(['bench', 'squat']);
  });

  it('the surviving pair uploads on the next pass', async () => {
    const cloud = makeXidFakeCloud();
    setCloudTransport(cloud.transport);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    await hydrateWithTrackLanding();
    await cloudAdapter.sync({ ownedDevice: false });
    const row = cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SINGLETON_SYNC_ID);
    expect(row.tracked_lifts).toEqual({ squat: true, bench: true });
    expect(Object.keys(row.tracked_lift_activations).sort()).toEqual(['bench', 'squat']);
  });

  it('hydration still prunes records whose flags are absent, and applies the allowlist', async () => {
    await Storage.hydrateProfileFromCloud({
      tracked_lifts: { squat: true },
      tracked_lift_activations: { squat: REC, ghost: REC },
      fatigue_multiplier: 1e9,
      display_name: 'Synthetic',
    }, { deload_mode_enabled: true });
    expect(await readJson(TRACKED_LIFT_ACTIVATIONS_KEY)).toEqual({ squat: REC });
    expect(await Storage.loadDeloadModeEnabled()).toBe(true);
    expect((await Storage.loadUserProfile()).display_name).toBe('Synthetic');
  });

  it('a failed holder inside hydration does not wedge later writers', async () => {
    const realSet = secureStorage.setItem.bind(secureStorage);
    jest.spyOn(secureStorage, 'setItem').mockImplementation(async (k, v) => {
      if (k === TRACKED_LIFTS_KEY) throw new Error('disk full');
      return realSet(k, v);
    });
    await expect(Storage.hydrateProfileFromCloud({ tracked_lifts: { squat: true } }, null))
      .rejects.toThrow('disk full');
    jest.restoreAllMocks();
    await trackBench();
    expect(await readJson(TRACKED_LIFTS_KEY)).toEqual({ squat: true, bench: true });
  });

  it('a sync pass cannot start while bootstrap holds the recovery guard', async () => {
    const order = [];
    const gate = deferred();
    const boot = withRecoveryReconciliation(async () => {
      order.push('boot:start');
      await gate.promise;
      order.push('boot:end');
    });
    await tick(2);
    const pass = withRecoveryReconciliation(async () => { order.push('pass'); });
    await tick(6);
    expect(order).toEqual(['boot:start']);
    gate.resolve();
    await Promise.all([boot, pass]);
    expect(order).toEqual(['boot:start', 'boot:end', 'pass']);
  });
});

// migrateToNotebook has no production caller: the only references outside
// storage/entries/migrations.js are the barrel and the local-adapter passthrough.
// Its current-id write is inside the notebook lock, which the other notebook-lock
// current-id writer (setCurrentWorkoutNote) also takes, so they serialize. No
// local-write locking is added for a path that never runs.
describe('current-id migration ordering (#1409)', () => {
  it('has no production caller beyond the barrel and adapter passthrough', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const hits = [];
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        if (['node_modules', 'tests', '.git', 'coverage'].includes(e.name)) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(js|jsx|ts|tsx)$/.test(e.name) && /\bmigrateToNotebook\b/.test(fs.readFileSync(full, 'utf8'))) {
          hits.push(path.relative(root, full));
        }
      });
    };
    walk(root);
    expect(hits.sort()).toEqual([
      'storage/cloud/bootstrapPlan.js',
      'storage/cloud/syncTableIo.js',
      'storage/entries.js',
      'storage/entries/migrations.js',
      'storage/localAdapter.js',
    ]);
  });

  it('concurrent migrations and a current-id writer serialize on the notebook lock', async () => {
    await Storage.saveWorkoutNote('-Squat\n225 5,5,5');
    const realSet = secureStorage.setItem.bind(secureStorage);
    const gate = deferred();
    let paused = false;
    jest.spyOn(secureStorage, 'setItem').mockImplementation(async (k, v) => {
      if (k === CURRENT_WORKOUT_ID_KEY && !paused) {
        paused = true;
        await gate.promise;
      }
      return realSet(k, v);
    });
    const first = migrateToNotebook();
    for (let i = 0; i < 40 && !paused; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(paused).toBe(true);
    const second = migrateToNotebook();
    const setter = Storage.setCurrentWorkoutNote('wn_other');
    await new Promise((resolve) => setImmediate(resolve));
    gate.resolve();
    const [a, b] = await Promise.all([first, second, setter]);
    jest.restoreAllMocks();
    const notes = JSON.parse(await secureStorage.getItem(WORKOUT_NOTES_KEY));
    expect(notes).toHaveLength(1);
    expect(b).toEqual(a);
    expect(JSON.parse(await secureStorage.getItem(CURRENT_WORKOUT_ID_KEY))).toBe('wn_other');
    expect(notes[0].isCurrent).toBe(false);
  });
});
