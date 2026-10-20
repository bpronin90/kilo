// Weight-goal archive retries are idempotent (#1477).
//
// archiveGoal crosses three durable boundaries: persist the archived record,
// enqueue it for push, clear the active goal. It used to mint a fresh random id
// per attempt, so a failure after the first boundary left a durable archive AND
// the active goal, and the retry archived the same goal a second time. These
// tests inject a failure at each boundary against an in-memory AsyncStorage,
// retry (in place and after a remount), and assert exactly one archive.

import React from 'react';
import render from 'react-test-renderer';
import { View, Text, Pressable } from 'react-native';

const mockStore = new Map();
const mockFailures = { setArchived: 0, enqueue: 0, removeGoal: 0 };

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
  setItem: jest.fn(async (key, value) => {
    if (key === 'kilo_archived_weight_goals' && mockFailures.setArchived > 0) {
      mockFailures.setArchived -= 1;
      throw new Error('injected archive write failure');
    }
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key) => {
    if (key === 'kilo_weight_goal' && mockFailures.removeGoal > 0) {
      mockFailures.removeGoal -= 1;
      throw new Error('injected goal clear failure');
    }
    mockStore.delete(key);
  }),
}));

let mockOnEnqueue = null;
jest.mock('../storage/syncQueue', () => {
  const actual = jest.requireActual('../storage/syncQueue');
  return {
    ...actual,
    enqueueDirty: jest.fn(async (table, record) => {
      if (mockOnEnqueue) await mockOnEnqueue();
      if (mockFailures.enqueue > 0) {
        mockFailures.enqueue -= 1;
        throw new Error('injected enqueue failure');
      }
      return actual.enqueueDirty(table, record);
    }),
  };
});

jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));

const { useWeightGoal, useArchivedWeightGoals } = require('../hooks/entries/weightHooks');
const { useWeightGoalForm } = require('../hooks/useWeightGoalForm');
const { saveWeightGoal } = require('../storage/entries/weightGoal');
const { enqueueDirty } = require('../storage/syncQueue');
const { Alert } = require('../lib/platformAlert');

const GOAL = {
  target_weight: 175,
  target_date: '2026-09-01',
  start_weight: 200,
  saved_at: '2026-06-01T08:00:00.000Z',
};

const archived = () => JSON.parse(mockStore.get('kilo_archived_weight_goals') || '[]');
const storedGoal = () => (mockStore.has('kilo_weight_goal') ? JSON.parse(mockStore.get('kilo_weight_goal')) : null);

let hook;
function HookWrapper() {
  hook = useWeightGoal();
  const { archivedGoals } = useArchivedWeightGoals();
  return (
    <View>
      <Text testID="goal">{hook.goal ? `${hook.goal.target_weight}` : 'no-goal'}</Text>
      <Text testID="archived-count">{archivedGoals.length}</Text>
      <Pressable testID="archive" onPress={() => hook.archiveGoal(174)} />
    </View>
  );
}

const read = (component, testID) => component.root.findByProps({ testID }).props.children;

async function mount() {
  let component;
  await render.act(async () => { component = render.create(<HookWrapper />); });
  return component;
}

async function archive() {
  let error = null;
  await render.act(async () => {
    try { await hook.archiveGoal(174); } catch (e) { error = e; }
  });
  return error;
}

beforeEach(() => {
  mockStore.clear();
  mockStore.set('kilo_weight_goal', JSON.stringify(GOAL));
  Object.assign(mockFailures, { setArchived: 0, enqueue: 0, removeGoal: 0 });
  mockOnEnqueue = null;
  enqueueDirty.mockClear();
  Alert.alert.mockClear();
});

describe('archiveGoal partial-failure retries (#1477)', () => {
  test.each([
    ['before archive persistence', 'setArchived'],
    ['after persistence, at dirty enqueue', 'enqueue'],
    ['after enqueue, at active-goal clear', 'removeGoal'],
  ])('failure %s rejects, keeps the goal, and a retry archives exactly once', async (_label, boundary) => {
    const component = await mount();
    mockFailures[boundary] = 1;

    expect(await archive()).toBeInstanceOf(Error);
    expect(storedGoal()).toEqual(GOAL);
    expect(read(component, 'goal')).toBe('175');

    expect(await archive()).toBeNull();
    expect(archived()).toHaveLength(1);
    expect(archived()[0]).toMatchObject({ target_weight: 175, completed_weight: 174 });
    expect(storedGoal()).toBeNull();
    expect(read(component, 'goal')).toBe('no-goal');
    expect(read(component, 'archived-count')).toBe(1);
    // Every enqueue (failed or not) targeted the one archive id.
    const ids = new Set(enqueueDirty.mock.calls.map(([, r]) => r.id));
    expect(ids).toEqual(new Set([archived()[0].id]));
  });

  test.each(['enqueue', 'removeGoal'])(
    'retry after a remount following a %s failure cannot duplicate the archive',
    async (boundary) => {
      let component = await mount();
      mockFailures[boundary] = 1;
      expect(await archive()).toBeInstanceOf(Error);
      const firstId = archived()[0].id;
      await render.act(async () => { component.unmount(); });

      component = await mount();
      expect(read(component, 'goal')).toBe('175');
      expect(await archive()).toBeNull();

      expect(archived()).toHaveLength(1);
      expect(archived()[0].id).toBe(firstId);
      expect(storedGoal()).toBeNull();
      expect(enqueueDirty.mock.calls.at(-1)[1].id).toBe(firstId);
    },
  );

  test('a replacement goal saved before the clear is not erased', async () => {
    const component = await mount();
    mockOnEnqueue = async () => {
      mockOnEnqueue = null;
      await saveWeightGoal({ target_weight: 165, target_date: '2026-12-01', start_weight: 174 });
    };

    expect(await archive()).toBeNull();
    expect(archived()).toHaveLength(1);
    expect(archived()[0].target_weight).toBe(175);
    expect(storedGoal()).toMatchObject({ target_weight: 165 });
    expect(read(component, 'goal')).toBe('165');
  });

  test('a different goal archives as its own record', async () => {
    await mount();
    expect(await archive()).toBeNull();
    mockStore.set('kilo_weight_goal', JSON.stringify({ ...GOAL, saved_at: '2026-10-01T08:00:00.000Z' }));
    await render.act(async () => { await hook.refresh(); });
    expect(await archive()).toBeNull();
    expect(archived()).toHaveLength(2);
    expect(new Set(archived().map((a) => a.id)).size).toBe(2);
  });
});

describe('handleArchiveGoal failure UI (#1477)', () => {
  let form;
  function FormWrapper({ archiveGoal }) {
    form = useWeightGoalForm(GOAL, jest.fn(), jest.fn(), archiveGoal);
    return null;
  }

  async function confirmArchive(archiveGoal) {
    await render.act(async () => { render.create(<FormWrapper archiveGoal={archiveGoal} />); });
    await render.act(async () => { form.setGoalEditing(true); form.setGoalTargetWeight('170'); });
    form.handleArchiveGoal(174);
    const buttons = Alert.alert.mock.calls[0][2];
    await render.act(async () => { await buttons.find((b) => b.text === 'Archive').onPress(); });
  }

  test('a failed archive is caught, reported, and does not reset the form', async () => {
    const archiveGoal = jest.fn().mockRejectedValue(new Error('boom'));
    await confirmArchive(archiveGoal);

    expect(archiveGoal).toHaveBeenCalledWith(174);
    expect(Alert.alert).toHaveBeenLastCalledWith('Archive failed', 'Could not archive your goal. Try again.');
    expect(form.goalEditing).toBe(true);
    expect(form.goalTargetWeight).toBe('170');
  });

  test('a successful archive resets the form', async () => {
    await confirmArchive(jest.fn().mockResolvedValue(undefined));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(form.goalEditing).toBe(false);
  });
});
