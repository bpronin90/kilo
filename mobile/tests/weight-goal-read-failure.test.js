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
// These drive the REAL hook with a rejecting `Storage.loadWeightGoal`, which is
// the boundary the hook actually owns. Note that the shipped LOCAL
// implementation of that function swallows its own errors and resolves `null`
// (see storage/entries/weightGoal.js), so today the local path cannot reach
// these branches; the hook is nonetheless the correct place for the contract,
// and it governs any read path that does reject.

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
  return { ...actual, loadWeightGoal: jest.fn() };
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

  test('a rejected read resolves loading, records the error, and does not leak the rejection', async () => {
    // An unhandled rejection is a defect in its own right — the missing
    // `.catch` produced one — so this asserts on it rather than letting it
    // pass as a console warning.
    const onUnhandled = jest.fn();
    process.on('unhandledRejection', onUnhandled);
    Storage.loadWeightGoal.mockRejectedValue(new Error('storage unavailable'));

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
    Storage.loadWeightGoal.mockResolvedValue(null);
    const component = await mount();

    expect(read(component, 'goal')).toBe('no-goal');
    expect(read(component, 'loading')).toBe('false');
    // Same goal value as the failure case above, different state — which is the
    // whole point of carrying `error` across the boundary.
    expect(read(component, 'error')).toBe('none');

    await render.act(async () => { component.unmount(); });
  });

  test('refresh clears the error and adopts the value once the read succeeds', async () => {
    Storage.loadWeightGoal.mockRejectedValueOnce(new Error('storage unavailable'));
    const component = await mount();
    expect(read(component, 'error')).toBe('error');

    Storage.loadWeightGoal.mockResolvedValue(GOAL);
    await render.act(async () => {
      await component.root.findByProps({ testID: 'refresh' }).props.onPress();
    });

    expect(read(component, 'error')).toBe('none');
    expect(read(component, 'goal')).toBe('175');

    await render.act(async () => { component.unmount(); });
  });

  test('a failed refresh keeps the previously loaded goal instead of reverting to none', async () => {
    Storage.loadWeightGoal.mockResolvedValue(GOAL);
    const component = await mount();
    expect(read(component, 'goal')).toBe('175');

    Storage.loadWeightGoal.mockRejectedValue(new Error('storage unavailable'));
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
    Storage.loadWeightGoal.mockRejectedValue(new Error('storage unavailable'));

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
    Storage.loadWeightGoal.mockRejectedValue(new Error('storage unavailable'));

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

    Storage.loadWeightGoal.mockResolvedValue(GOAL);
    await render.act(async () => { await hookSave(GOAL); });

    expect(read(probe, 'probe-error')).toBe('none');
    expect(read(probe, 'probe-goal')).toBe('175');

    await render.act(async () => { probe.unmount(); });
  });
});
