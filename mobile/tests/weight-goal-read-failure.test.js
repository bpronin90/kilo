// useWeightGoal read-failure contract (#737 review).
//
// Every other read hook in hooks/entries — useWeightEntries, useTrackedLifts —
// exposes `{ error, refresh }` so a consumer can keep loading, failure, and
// verified-empty apart. useWeightGoal was the outlier: it used
// `.then(setGoal).finally(() => setLoading(false))` with no `.catch`, so a
// rejected read left the hook in `{ goal: null, loading: false }` — byte
// identical to a verified "no goal set" — and let the rejection escape
// unhandled. WeightScreen and Home then rendered that failure as an answer.
//
// The local storage read was the other half of the problem:
// `loadWeightGoal()` catches its own errors and resolves `null`, so the hook
// could never observe a failure through it. `loadWeightGoalResult()` was added
// alongside it (additive — `loadWeightGoal()` keeps its never-throws contract
// for the sync/bootstrap/export callers) and returns `{ ok, goal, error }`; the
// hook now reads through that.
//
// The first group drives the hook against a stubbed result read; the last group
// drives the whole path for real, against AsyncStorage itself, so the local
// failure is proven end to end rather than only at a mocked seam.

import React from 'react';
import render from 'react-test-renderer';
import { View, Text, Pressable } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(null),
}));

jest.mock('../storage/entries', () => {
  const actual = jest.requireActual('../storage/entries');
  return { ...actual, loadWeightGoalResult: jest.fn() };
});

const Storage = require('../storage/entries');
const { useWeightGoal } = require('../hooks/entries/weightHooks');

const GOAL = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };

function HookWrapper() {
  const hook = useWeightGoal();
  return (
    <View>
      <Text testID="goal">{hook.goal ? `${hook.goal.target_weight}` : 'no-goal'}</Text>
      <Text testID="loading">{String(hook.loading)}</Text>
      <Text testID="error">{hook.error ? 'error' : 'none'}</Text>
      <Pressable testID="refresh" onPress={() => hook.refresh()} />
    </View>
  );
}

const read = (component, testID) => component.root.findByProps({ testID }).props.children;

async function mount() {
  let component;
  await render.act(async () => { component = render.create(<HookWrapper />); });
  return component;
}

describe('useWeightGoal read failure (#737 review)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('a failed read resolves loading, records the error, and leaks no rejection', async () => {
    // An unhandled rejection is a defect in its own right — the missing
    // `.catch` produced one — so this asserts on it rather than letting it
    // pass as a console warning.
    const onUnhandled = jest.fn();
    process.on('unhandledRejection', onUnhandled);
    Storage.loadWeightGoalResult.mockResolvedValue({ ok: false, goal: null, error: new Error('storage unavailable') });

    const component = await mount();

    expect(read(component, 'loading')).toBe('false');
    expect(read(component, 'error')).toBe('error');
    // Failure, never a verified empty answer.
    expect(read(component, 'goal')).toBe('no-goal');

    await new Promise(resolve => setImmediate(resolve));
    expect(onUnhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', onUnhandled);

    await render.act(async () => { component.unmount(); });
  });

  test('a verified empty read is distinct from a failed one', async () => {
    Storage.loadWeightGoalResult.mockResolvedValue({ ok: true, goal: null, error: null });
    const component = await mount();

    expect(read(component, 'goal')).toBe('no-goal');
    expect(read(component, 'loading')).toBe('false');
    // Same goal value as the failure case above, different state — which is the
    // whole point of carrying `error` across the boundary.
    expect(read(component, 'error')).toBe('none');

    await render.act(async () => { component.unmount(); });
  });

  test('refresh clears the error and adopts the value once the read succeeds', async () => {
    Storage.loadWeightGoalResult.mockResolvedValueOnce({ ok: false, goal: null, error: new Error('storage unavailable') });
    const component = await mount();
    expect(read(component, 'error')).toBe('error');

    Storage.loadWeightGoalResult.mockResolvedValue({ ok: true, goal: GOAL, error: null });
    await render.act(async () => {
      await component.root.findByProps({ testID: 'refresh' }).props.onPress();
    });

    expect(read(component, 'error')).toBe('none');
    expect(read(component, 'goal')).toBe('175');

    await render.act(async () => { component.unmount(); });
  });

  test('a failed refresh keeps the previously loaded goal instead of reverting to none', async () => {
    Storage.loadWeightGoalResult.mockResolvedValue({ ok: true, goal: GOAL, error: null });
    const component = await mount();
    expect(read(component, 'goal')).toBe('175');

    Storage.loadWeightGoalResult.mockResolvedValue({ ok: false, goal: null, error: new Error('storage unavailable') });
    await render.act(async () => {
      await component.root.findByProps({ testID: 'refresh' }).props.onPress();
    });

    expect(read(component, 'error')).toBe('error');
    // Stale but true: the read failed, it did not report "no goal".
    expect(read(component, 'goal')).toBe('175');

    await render.act(async () => { component.unmount(); });
  });

  // The error state always reflects the last authoritative READ. A write
  // fans out through notifyGoal(), so the re-read — not the write — decides.
  test('a write while reads still fail leaves the failure visible', async () => {
    Storage.loadWeightGoalResult.mockResolvedValue({ ok: false, goal: null, error: new Error('storage unavailable') });

    let hookSave;
    function SaveProbe() {
      const hook = useWeightGoal();
      hookSave = hook.save;
      return <Text testID="probe-error">{hook.error ? 'error' : 'none'}</Text>;
    }
    let probe;
    await render.act(async () => { probe = render.create(<SaveProbe />); });
    expect(read(probe, 'probe-error')).toBe('error');

    await render.act(async () => { await hookSave(GOAL); });
    // A successful write is not evidence that the read recovered, so the
    // banner must not be cleared on its behalf.
    expect(read(probe, 'probe-error')).toBe('error');

    await render.act(async () => { probe.unmount(); });
  });

  test('a write clears the failure once the read that follows it succeeds', async () => {
    Storage.loadWeightGoalResult.mockResolvedValue({ ok: false, goal: null, error: new Error('storage unavailable') });

    let hookSave;
    function SaveProbe() {
      const hook = useWeightGoal();
      hookSave = hook.save;
      return (
        <View>
          <Text testID="probe-error">{hook.error ? 'error' : 'none'}</Text>
          <Text testID="probe-goal">{hook.goal ? `${hook.goal.target_weight}` : 'no-goal'}</Text>
        </View>
      );
    }
    let probe;
    await render.act(async () => { probe = render.create(<SaveProbe />); });
    expect(read(probe, 'probe-error')).toBe('error');

    Storage.loadWeightGoalResult.mockResolvedValue({ ok: true, goal: GOAL, error: null });
    await render.act(async () => { await hookSave(GOAL); });

    expect(read(probe, 'probe-error')).toBe('none');
    expect(read(probe, 'probe-goal')).toBe('175');

    await render.act(async () => { probe.unmount(); });
  });
});

// ── the real local read path, end to end (#737 review) ────────────────────────
//
// The group above stubs the storage read, which proves the hook's contract but
// not that the shipped local path can actually produce a failure — the original
// defect was precisely that it could not. These drive the REAL
// loadWeightGoalResult against AsyncStorage, so an unreadable record reaches
// the hook as a failure rather than as `null`.
describe('local goal read distinguishes failure from absence (#737 review)', () => {
  const actualWeightGoal = jest.requireActual('../storage/entries/weightGoal');
  const AsyncStorage = require('@react-native-async-storage/async-storage');

  beforeEach(() => {
    jest.clearAllMocks();
    Storage.loadWeightGoalResult.mockImplementation(actualWeightGoal.loadWeightGoalResult);
  });

  test('an unreadable record surfaces as a failure, not as "no goal set"', async () => {
    AsyncStorage.getItem.mockRejectedValue(new Error('storage unavailable'));

    const component = await mount();

    expect(read(component, 'error')).toBe('error');
    expect(read(component, 'loading')).toBe('false');

    await render.act(async () => { component.unmount(); });
  });

  test('a corrupt record surfaces as a failure rather than silently as absence', async () => {
    // The JSON.parse throw is inside the same try/catch that used to return
    // null, so this is the case a user would actually hit.
    AsyncStorage.getItem.mockResolvedValue('{not valid json');

    const component = await mount();

    expect(read(component, 'error')).toBe('error');
    expect(read(component, 'goal')).toBe('no-goal');

    await render.act(async () => { component.unmount(); });
  });

  test('a genuinely absent record is still a verified absence', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);

    const component = await mount();

    expect(read(component, 'error')).toBe('none');
    expect(read(component, 'goal')).toBe('no-goal');

    await render.act(async () => { component.unmount(); });
  });

  test('a stored record still loads normally', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(GOAL));

    const component = await mount();

    expect(read(component, 'error')).toBe('none');
    expect(read(component, 'goal')).toBe('175');

    await render.act(async () => { component.unmount(); });
  });

  test('loadWeightGoal keeps its never-throws contract for sync and export callers', async () => {
    // The sync pass, bootstrap, and exportBackup all await this and are not
    // written to handle a rejection; that contract must not have moved.
    AsyncStorage.getItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(actualWeightGoal.loadWeightGoal()).resolves.toBeNull();

    AsyncStorage.getItem.mockResolvedValue('{not valid json');
    await expect(actualWeightGoal.loadWeightGoal()).resolves.toBeNull();

    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(GOAL));
    await expect(actualWeightGoal.loadWeightGoal()).resolves.toEqual(GOAL);
  });
});

// ── the pending-retry window (#737 review) ────────────────────────────────────
//
// `refresh()` used to call `setError(null)` on the way in. After an initial
// failure the hook sits at `{ goal: null, loading: false, error: <err> }`, so
// clearing the error synchronously left `{ goal: null, loading: false, error:
// null }` — indistinguishable from a verified "no goal set" — for the whole
// duration of the retry read. The failed state now survives until a read
// actually completes.
describe('useWeightGoal retry keeps the failure visible until it resolves (#737 review)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('the error survives the in-flight retry and clears only on success', async () => {
    Storage.loadWeightGoalResult.mockResolvedValue({ ok: false, goal: null, error: new Error('storage unavailable') });
    const component = await mount();
    expect(read(component, 'error')).toBe('error');

    // A retry that never settles while we look at the state mid-flight.
    let releaseRead;
    Storage.loadWeightGoalResult.mockReturnValue(new Promise((resolve) => {
      releaseRead = () => resolve({ ok: true, goal: GOAL, error: null });
    }));

    render.act(() => { component.root.findByProps({ testID: 'refresh' }).props.onPress(); });

    // Mid-retry: still failed, still no goal. This is the whole finding — the
    // combination `{ error: none, goal: no-goal, loading: false }` would read as
    // a verified "no goal set" to every consumer.
    expect(read(component, 'error')).toBe('error');
    expect(read(component, 'goal')).toBe('no-goal');

    await render.act(async () => { releaseRead(); await Promise.resolve(); });

    expect(read(component, 'error')).toBe('none');
    expect(read(component, 'goal')).toBe('175');

    await render.act(async () => { component.unmount(); });
  });

  test('a retry that fails again leaves the failure in place rather than flickering', async () => {
    Storage.loadWeightGoalResult.mockResolvedValue({ ok: false, goal: null, error: new Error('storage unavailable') });
    const component = await mount();
    expect(read(component, 'error')).toBe('error');

    await render.act(async () => {
      await component.root.findByProps({ testID: 'refresh' }).props.onPress();
    });

    expect(read(component, 'error')).toBe('error');

    await render.act(async () => { component.unmount(); });
  });
});
