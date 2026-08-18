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
import { WORKOUT_NOTES_KEY, WEIGHT_KEY } from '../storage/entries/keys';
import { SYNC_PHASE, SYNC_STATUS, getSyncState, resetPhase, __resetSyncQueue } from '../storage/syncRecovery';
import { SYNC_TABLES, resetClientIdCacheForTests, resetStampClockForTests } from '../storage/syncQueue';
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

  it('useWorkoutNotes: one notebook read per instance in local mode, and no sync', async () => {
    await Storage.saveWorkoutNoteItem({ id: 'n1', title: 'Push', raw_text: '-Bench\n135 5,5' });
    const { sync } = mockBlockingCloudAdapter();
    AsyncStorage.getItem.mockClear();

    const { refs, tree } = mount(useWorkoutNotes);
    await flushAsync();

    expect(refs.every((r) => r.loading === false)).toBe(true);
    expect(refs.every((r) => r.notes.map((n) => n.id).join() === 'n1')).toBe(true);
    // Three mounted instances, three reads - not six.
    expect(readsOf(WORKOUT_NOTES_KEY)).toBe(3);
    expect(sync).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('useWeightEntries: one table read per instance in local mode', async () => {
    await Storage.saveWeightEntry({ id: 'w1', weight_value: 180, logged_at: '2026-08-10T12:00:00.000Z' });
    AsyncStorage.getItem.mockClear();
    const { refs, tree } = mount(useWeightEntries);
    await flushAsync();
    expect(refs.every((r) => r.entries.map((e) => e.id).join() === 'w1')).toBe(true);
    expect(readsOf(WEIGHT_KEY)).toBe(3);
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
    expect(readsOf(WORKOUT_NOTES_KEY)).toBe(3);
    expect(sync).toHaveBeenCalledTimes(1);

    passes[0].resolve({ ok: true });
    await flushAsync();
    // The post-pass reload: once per instance.
    expect(readsOf(WORKOUT_NOTES_KEY)).toBe(6);
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
