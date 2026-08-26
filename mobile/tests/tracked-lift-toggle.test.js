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
});

afterEach(() => {
  mountedTrees.forEach((t) => act(() => t.unmount()));
  mountedTrees = [];
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
