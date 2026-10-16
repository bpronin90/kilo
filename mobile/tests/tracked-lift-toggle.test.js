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
import { applyWorkoutNoteTextBatch, useWorkoutNotes } from '../hooks/entries/workoutNoteHooks';
import * as CloudNotes from '../storage/cloud/cloudDomainMethods';
import { withLocalWriteLock } from '../storage/sync/localWriteLock';
import { secureStorage } from '../storage/secureStorage';
import { SINGLETON_SYNC_ID, SYNC_TABLES, resetClientIdCacheForTests, resetStampClockForTests } from '../storage/syncQueue';
import { cloudAdapter, setCloudTransport } from '../storage/cloudAdapter';
import { makeXidFakeCloud } from './mocks/xidFakeCloud';
import { computeSaveClassifications } from '../screens/log/currentRoutineSave';
import * as DeloadStorage from '../storage/entries/deloadStorage';

jest.mock('../lib/reminderScheduler', () => ({ reconcileWorkoutReminder: () => Promise.resolve() }));
jest.mock('../lib/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));

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

// ─────────────────────────────────────────────────────────────────────────────
// A normalization apply carries Track to the renamed key (#1395)
// ─────────────────────────────────────────────────────────────────────────────
//
// The real apply (workoutNoteHooks → storage batch) against the real hook and
// the real coalescer. The cloud adapter's sync() records the durable tuple a
// pass would read, and blocks until released.

describe('a normalization apply carries Track (#1395)', () => {
  const AUTH = { id: 'ra', title: 'Auth', raw_text: 'Monday\n-DB Bench Press 3x6-8\n60 8' };
  const TARGET = { id: 'rt', title: 'Upper', raw_text: 'Monday\n-DB Bench Press 3x6-8, step up\n60 8\n60 8' };
  const NEXT = 'Monday\n-DB Bench Press 3x6-8\n60 8\n60 8\n-- step up';
  const SRC = 'db bench press 3x6-8, step up';
  const DST = 'db bench press';
  const notebook = () => parseWorkoutNote(`${AUTH.raw_text}\n---\n${TARGET.raw_text}`).sections;
  const request = () => ({
    authority: { id: 'ra', expected_raw_text: AUTH.raw_text, accepted_raw_texts: [] },
    items: [{ id: 'rt', expected_raw_text: TARGET.raw_text, next_raw_text: NEXT }],
  });

  async function seedNotes() {
    await Storage.saveWorkoutNoteItem(AUTH);
    await Storage.saveWorkoutNoteItem(TARGET);
  }

  async function durable() {
    const notes = await Storage.loadWorkoutNotesRaw();
    return {
      text: notes.find(n => n.id === 'rt')?.raw_text,
      lifts: await Storage.loadTrackedLifts(),
      activations: await Storage.loadTrackedLiftActivations(),
    };
  }

  function mockCloudApply() {
    const passes = [];
    const seen = [];
    const sync = jest.fn(async () => {
      seen.push(await durable());
      const gate = deferred();
      passes.push(gate);
      return gate.promise;
    });
    jest.spyOn(Storage, 'getStorageAdapter').mockReturnValue({
      mode: 'cloud',
      sync,
      applyWorkoutNoteTextBatchIfUnchanged: CloudNotes.applyWorkoutNoteTextBatchIfUnchanged,
    });
    return { sync, passes, seen };
  }

  // Tracks the source through the real toggle, so its record is a real one.
  async function trackSource(ref) {
    await act(async () => { await ref.current.toggle('DB Bench Press 3x6-8, step up', notebook()); });
    await settle();
  }

  test('local mode: the mounted hook shows the carried flag, a later toggle keeps it, and no pass runs', async () => {
    const { sync } = mockCloudApply();
    await seedNotes();
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    expect(ref.current.trackedLifts).toEqual({ [SRC]: true });

    let result;
    await act(async () => { result = await applyWorkoutNoteTextBatch(request()); });
    await settle();
    expect(result.saved.map(r => r.id)).toEqual(['rt']);
    expect(ref.current.trackedLifts).toEqual({ [DST]: true });
    expect(ref.current.activations[DST].anchor).toBe(3);

    // The next toggle derives from the committed transition, not a module cache.
    await act(async () => { await ref.current.toggle('squat', HISTORY); });
    await settle();
    expect(await durable()).toEqual({
      text: NEXT,
      lifts: { [DST]: true, squat: true },
      activations: { [DST]: expect.objectContaining({ anchor: 3 }), squat: expect.objectContaining({ anchor: 0 }) },
    });
    expect(sync).not.toHaveBeenCalled();
  });

  test('a toggle issued during the apply lands wholly before or after it; neither change is lost', async () => {
    await seedNotes();
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    await act(async () => {
      await Promise.all([applyWorkoutNoteTextBatch(request()), ref.current.toggle('squat', HISTORY)]);
    });
    await settle();
    const after = await durable();
    expect(after.lifts).toEqual({ [DST]: true, squat: true });
    expect(Object.keys(after.activations).sort()).toEqual([DST, 'squat']);
    expect(ref.current.trackedLifts).toEqual(after.lifts);
  });

  test('cloud mode: one pass after the commit, and it reads the complete note + flag + activation tuple', async () => {
    await seedNotes();
    const ref = renderHook();
    // A mounted notes consumer refreshes on the note broadcast; it joins the pass.
    function NotesProbe() { useWorkoutNotes(); return null; }
    act(() => { mountedTrees.push(renderer.create(React.createElement(NotesProbe))); });
    await settle();
    await trackSource(ref);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudApply();

    let result;
    await act(async () => { result = await applyWorkoutNoteTextBatch(request()); });
    await settle();
    expect(result.saved).toEqual([{ id: 'rt', pending_sync: true }]);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({ text: NEXT, lifts: { [DST]: true }, activations: { [DST]: expect.objectContaining({ anchor: 3 }) } });
    passes[0].resolve({ ok: true });
    await settle();
    expect(syncStatus()).toBe(SYNC_STATUS.COMPLETE);
  });

  test('cloud mode: an apply waits out a running pass, which therefore never reads half of it', async () => {
    await seedNotes();
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudApply();
    await act(async () => { maybeSyncCloud(); });
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);

    let done = false;
    const applying = applyWorkoutNoteTextBatch(request()).then((r) => { done = true; return r; });
    await settle();
    expect(done).toBe(false);
    expect((await durable()).text).toBe(TARGET.raw_text);

    passes[0].resolve({ ok: true });
    await act(async () => { await applying; });
    await settle();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(seen[1]).toEqual({ text: NEXT, lifts: { [DST]: true }, activations: { [DST]: expect.objectContaining({ anchor: 3 }) } });
    passes[1].resolve({ ok: true });
    await settle();
  });

  test('cloud mode: a failed pass keeps the committed transition and reports failed/retryable', async () => {
    await seedNotes();
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { passes } = mockCloudApply();
    await act(async () => { await applyWorkoutNoteTextBatch(request()); });
    await settle();
    passes[0].reject(new Error('offline'));
    await settle();
    expect(getSyncState()[SYNC_PHASE.SYNC]).toEqual(expect.objectContaining({ status: SYNC_STATUS.FAILED, retryable: true }));
    expect((await durable()).lifts).toEqual({ [DST]: true });
  });

  test('an unfinished commit is finished before the next toggle, and before a pass reads anything', async () => {
    await seedNotes();
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    // Rollback and roll-forward both fail at the activation write: the commit
    // stays recorded with the flags moved but the records not.
    const realSetItem = AsyncStorage.setItem.getMockImplementation();
    AsyncStorage.setItem.mockImplementation((key, value) => (key === 'kilo_tracked_lift_activations'
      ? Promise.reject(new Error('disk full'))
      : realSetItem(key, value)));
    let result;
    await act(async () => { result = await applyWorkoutNoteTextBatch(request()); });
    expect(result.failed).toEqual([expect.objectContaining({ id: 'rt', landed: true })]);

    // A pass cannot finish it while storage still fails, so it fails and reads nothing.
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { sync, passes, seen } = mockCloudApply();
    await act(async () => { await maybeSyncCloud(); });
    expect(sync).not.toHaveBeenCalled();
    expect(syncStatus()).toBe(SYNC_STATUS.FAILED);

    // Healed: the next toggle first finishes the commit, then applies on top.
    AsyncStorage.setItem.mockImplementation(realSetItem);
    await act(async () => { await ref.current.toggle('squat', HISTORY); });
    await settle();
    expect(await durable()).toEqual({
      text: NEXT,
      lifts: { [DST]: true, squat: true },
      activations: { [DST]: expect.objectContaining({ anchor: 3 }), squat: expect.objectContaining({ anchor: 0 }) },
    });
    expect(await AsyncStorage.getItem('kilo_normalization_apply_intent_v1')).toBeNull();
    expect(seen[0]).toEqual(await durable());
    passes.forEach(p => p.resolve({ ok: true }));
    await settle();
  });

  // Review round 4: a note writer's notebook lock finishes the record OUTSIDE the
  // hook's queue. The hook must adopt that durable transition (and show it)
  // before deriving its next write, or the toggle reverts the recovered rename.
  test('a record finished by an ordinary note write is adopted before the next toggle derives', async () => {
    await seedNotes();
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    const realSetItem = AsyncStorage.setItem.getMockImplementation();
    AsyncStorage.setItem.mockImplementation((key, value) => (key === 'kilo_tracked_lift_activations'
      ? Promise.reject(new Error('disk full'))
      : realSetItem(key, value)));
    let result;
    await act(async () => { result = await applyWorkoutNoteTextBatch(request()); });
    expect(result.failed).toEqual([expect.objectContaining({ id: 'rt', landed: true })]);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    const { passes } = mockCloudApply();
    await act(async () => { await maybeSyncCloud(); });

    AsyncStorage.setItem.mockImplementation(realSetItem);
    await act(async () => { await CloudNotes.updateWorkoutNoteItem('ra', { title: 'edited after recovery' }); });
    await settle();
    expect(await AsyncStorage.getItem('kilo_normalization_apply_intent_v1')).toBeNull();
    expect((await durable()).lifts).toEqual({ [DST]: true });
    // Mounted consumers show the recovered transition without any toggle.
    expect(ref.current.trackedLifts).toEqual({ [DST]: true });
    expect(ref.current.activations[DST]).toEqual(expect.objectContaining({ anchor: 3 }));

    await act(async () => { await ref.current.toggle('squat', HISTORY); });
    await settle();
    expect(await durable()).toEqual({
      text: NEXT,
      lifts: { [DST]: true, squat: true },
      activations: { [DST]: expect.objectContaining({ anchor: 3 }), squat: expect.objectContaining({ anchor: 0 }) },
    });
    passes.forEach(p => p.resolve({ ok: true }));
    await settle();
  });

  // The same invariant for any writer outside the queue (a sync pull, a backup
  // restore): the hook adopts it and shows it; its own writes need no re-read.
  test('any Track write made outside the hook is adopted before the next toggle', async () => {
    const ref = renderHook();
    await settle();
    await act(async () => { await ref.current.toggle('squat', HISTORY); });
    await settle();
    await act(async () => {
      await Storage.saveTrackedLifts({ squat: true, bench: true });
      await Storage.saveTrackedLiftActivations({ squat: (await Storage.loadTrackedLiftActivations()).squat, bench: { anchor: 0, at: '2026-09-01T00:00:00.000Z', witness: null } });
    });
    await settle();
    expect(ref.current.trackedLifts).toEqual({ squat: true, bench: true });
    await act(async () => { await ref.current.toggle('deadlift', HISTORY); });
    await settle();
    expect(await Storage.loadTrackedLifts()).toEqual({ squat: true, bench: true, deadlift: true });
    expect(Object.keys(await Storage.loadTrackedLiftActivations()).sort()).toEqual(['bench', 'deadlift', 'squat']);
  });

  // Review round 5: the adoption check, the derivation and the write of one
  // queued change are ONE local-write-lock section. A writer already holding
  // that lock (a sync write-back landing another device's normalized Track)
  // finishes first; the toggle then derives from what it wrote.
  const DST_RECORD = { anchor: 0, at: '2026-09-01T00:00:00.000Z', witness: null };

  test('a toggle queued behind a lock-holding Track writer derives from what that writer landed', async () => {
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    const held = deferred();
    const writer = withLocalWriteLock(async () => {
      await held.promise;
      await Storage.saveTrackedLifts({ [DST]: true });
      await Storage.saveTrackedLiftActivations({ [DST]: DST_RECORD });
    });
    let toggling;
    await act(async () => { toggling = ref.current.toggle('squat', HISTORY); });
    await settle();
    held.resolve();
    await act(async () => { await writer; await toggling; });
    await settle();
    expect(await Storage.loadTrackedLifts()).toEqual({ [DST]: true, squat: true });
    expect(Object.keys(await Storage.loadTrackedLiftActivations()).sort()).toEqual([DST, 'squat']);
    expect(ref.current.trackedLifts).toEqual({ [DST]: true, squat: true });
  });

  test('real pass: a toggle during an incoming normalized Track write-back keeps it, locally and on the server', async () => {
    resetClientIdCacheForTests();
    resetStampClockForTests();
    const cloud = makeXidFakeCloud();
    setCloudTransport(cloud.transport);
    Storage.setStorageMode(Storage.STORAGE_MODES.CLOUD);
    try {
      await cloudAdapter.sync({ ownedDevice: false });
      const ref = renderHook();
      await settle(8);
      await trackSource(ref);
      await settle(8);
      const healthRow = () => cloud.remoteRow(SYNC_TABLES.USER_HEALTH_PROFILE, SINGLETON_SYNC_ID);
      expect(healthRow().tracked_lifts).toEqual({ [SRC]: true });

      // Another device normalized the rename and uploaded its Track transition.
      const { __xid: _x, updated_at: _u, ...row } = healthRow(); // eslint-disable-line no-unused-vars
      await cloud.transport.push(SYNC_TABLES.USER_HEALTH_PROFILE, [{
        ...row, tracked_lifts: { [DST]: true }, tracked_lift_activations: { [DST]: DST_RECORD },
      }]);
      // Pause that pull's write-back inside its lock, before its first Track write.
      const held = deferred();
      const reached = deferred();
      let armed = true;
      const realSetItem = secureStorage.setItem.bind(secureStorage);
      jest.spyOn(secureStorage, 'setItem').mockImplementation(async (key, value) => {
        if (armed && key === 'kilo_tracked_lifts') {
          armed = false;
          reached.resolve();
          await held.promise;
        }
        return realSetItem(key, value);
      });
      let pulling;
      await act(async () => { pulling = maybeSyncCloud(); });
      await act(async () => { await reached.promise; });
      let toggling;
      await act(async () => { toggling = ref.current.toggle('squat', HISTORY); });
      await settle(8);
      held.resolve();
      await act(async () => { await pulling; await toggling; });
      await settle(16);

      expect(await Storage.loadTrackedLifts()).toEqual({ [DST]: true, squat: true });
      expect(healthRow().tracked_lifts).toEqual({ [DST]: true, squat: true });
      expect(Object.keys(healthRow().tracked_lift_activations).sort()).toEqual([DST, 'squat']);
      expect(syncStatus()).toBe(SYNC_STATUS.COMPLETE);
    } finally {
      setCloudTransport(null);
    }
  });

  // Review round 6: an ordinary save builds its reconcile population from the
  // notes it rendered. A rename that commits while that save is in flight must
  // not have its translated span shortened from the pre-rename population.
  async function saveWithPausedRead(ref, args) {
    const held = deferred();
    const reached = deferred();
    const real = DeloadStorage.loadDeloadHistory;
    jest.spyOn(DeloadStorage, 'loadDeloadHistory').mockImplementationOnce(async () => {
      reached.resolve();
      await held.promise;
      return real();
    });
    const saving = computeSaveClassifications({
      trackedLifts: ref.current.trackedLifts,
      trackedLiftActivations: ref.current.activations,
      reconcileTrackedLiftActivations: ref.current.reconcileActivations,
      ...args,
    });
    await act(async () => { await reached.promise; });
    return { saving, release: held.resolve };
  }

  test('a save in flight across a rename never shortens the translated span from its stale notes', async () => {
    await seedNotes();
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    const notes = await Storage.loadWorkoutNotes();
    const { saving, release } = await saveWithPausedRead(ref, { textToSave: AUTH.raw_text, currentId: 'ra', notes });
    await act(async () => { await applyWorkoutNoteTextBatch(request()); });
    await settle();
    expect((await Storage.loadTrackedLiftActivations())[DST].anchor).toBe(3);
    release();
    await act(async () => { await saving; });
    await settle();
    expect(await Storage.loadTrackedLifts()).toEqual({ [DST]: true });
    expect((await Storage.loadTrackedLiftActivations())[DST].anchor).toBe(3);

    // A later save over the current notebook agrees with it and leaves it.
    const fresh = await Storage.loadWorkoutNotes();
    const later = await saveWithPausedRead(ref, { textToSave: AUTH.raw_text, currentId: 'ra', notes: fresh });
    later.release();
    await act(async () => { await later.saving; });
    await settle();
    expect((await Storage.loadTrackedLiftActivations())[DST].anchor).toBe(3);

    // Once the notebook itself loses the moved sessions, the repair is applied.
    await Storage.saveWorkoutNoteItem({ ...TARGET, raw_text: 'Monday\n-Row\n50 8' });
    const shortened = await saveWithPausedRead(ref, { textToSave: AUTH.raw_text, currentId: 'ra', notes: await Storage.loadWorkoutNotes() });
    shortened.release();
    await act(async () => { await shortened.saving; });
    await settle();
    expect((await Storage.loadTrackedLiftActivations())[DST].anchor).toBe(1);
  });

  test('negative: with no rename in between, a save still clamps and retires in that same save', async () => {
    await seedNotes();
    const ref = renderHook();
    await settle();
    await trackSource(ref);
    const notes = await Storage.loadWorkoutNotes();
    const shorter = 'Monday\n-DB Bench Press 3x6-8, step up\n60 8';
    let pending = await saveWithPausedRead(ref, { textToSave: shorter, currentId: 'rt', notes });
    pending.release();
    await act(async () => { await pending.saving; });
    await settle();
    expect((await Storage.loadTrackedLiftActivations())[SRC].anchor).toBe(1);

    pending = await saveWithPausedRead(ref, { textToSave: 'Monday\n-Row\n50 8', currentId: 'rt', notes });
    pending.release();
    await act(async () => { await pending.saving; });
    await settle();
    expect(await Storage.loadTrackedLifts()).toEqual({ [SRC]: true });
    expect(await Storage.loadTrackedLiftActivations()).toEqual({});
  });
});
