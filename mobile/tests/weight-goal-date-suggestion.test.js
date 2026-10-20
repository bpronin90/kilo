// Suggested weight-goal target date is one local calendar month ahead, clamped
// to the destination month's last day (#1501).

import React from 'react';
import render from 'react-test-renderer';

jest.mock('../lib/platformAlert', () => ({ Alert: { alert: jest.fn() } }));

const { suggestedTargetDate, useWeightGoalForm } = require('../hooks/useWeightGoalForm');
const { Alert } = require('../lib/platformAlert');

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0);

describe('suggestedTargetDate', () => {
  test.each([
    [at(2026, 1, 31), '2026-02-28'],
    [at(2028, 1, 31), '2028-02-29'],
    [at(2026, 1, 29), '2026-02-28'],
    [at(2028, 1, 29), '2028-02-29'],
    [at(2026, 3, 31), '2026-04-30'],
    [at(2026, 5, 31), '2026-06-30'],
    [at(2026, 8, 31), '2026-09-30'],
    [at(2026, 10, 31), '2026-11-30'],
    [at(2026, 12, 15), '2027-01-15'],
    [at(2026, 12, 31), '2027-01-31'],
    [at(2026, 5, 24), '2026-06-24'],
    [at(2026, 6, 30), '2026-07-30'],
    // DST-adjacent days keep their day number.
    [at(2026, 3, 8, 1, 30), '2026-04-08'],
    [at(2026, 10, 31, 0, 30), '2026-11-30'],
    [at(2026, 11, 1, 1, 30), '2026-12-01'],
    // Local midnight edges: local components win even when UTC disagrees.
    [at(2026, 1, 31, 0, 5), '2026-02-28'],
    [at(2026, 1, 31, 23, 55), '2026-02-28'],
  ])('%s -> %s', (now, expected) => {
    expect(suggestedTargetDate(now)).toBe(expected);
  });

  test('defaults to the current clock', () => {
    jest.useFakeTimers().setSystemTime(at(2026, 1, 31));
    try {
      expect(suggestedTargetDate()).toBe('2026-02-28');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('useWeightGoalForm date suggestion', () => {
  let hook;
  // Like the real store, clearing or archiving removes the active goal.
  function Wrapper({ goal: initial }) {
    const [goal, setGoal] = React.useState(initial);
    hook = useWeightGoalForm(goal, jest.fn(), async () => setGoal(null), async () => setGoal(null));
    return null;
  }
  const mount = async (goal) => {
    let c;
    await render.act(async () => { c = render.create(<Wrapper goal={goal} />); });
    return c;
  };
  const press = async (title, label) => {
    const buttons = Alert.alert.mock.calls.at(-1)[2];
    await render.act(async () => { await buttons.find((b) => b.text === label).onPress(); });
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(at(2026, 1, 31));
    Alert.alert.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  test('new goal entry uses the clamped suggestion', async () => {
    await mount(null);
    expect(hook.goalTargetDate).toBe('2026-02-28');
  });

  test('editing an existing goal preserves its saved date', async () => {
    await mount({ target_weight: 170, target_date: '2026-03-31', start_weight: 200 });
    await render.act(async () => { hook.startEditGoal(); });
    expect(hook.goalTargetDate).toBe('2026-03-31');
  });

  test('clear and archive resets use the same rule', async () => {
    await mount({ target_weight: 170, target_date: '2026-03-31', start_weight: 200 });
    await render.act(async () => { hook.startEditGoal(); });
    await render.act(async () => { hook.handleClearGoal(); });
    await press('Clear Goal', 'Clear');
    expect(hook.goalTargetDate).toBe('2026-02-28');

    await render.act(async () => { hook.startEditGoal(); });
    await render.act(async () => { hook.setGoalTargetDate('2026-07-04'); });
    await render.act(async () => { hook.handleArchiveGoal(175); });
    await press('Archive Goal', 'Archive');
    expect(hook.goalTargetDate).toBe('2026-02-28');
  });

  test('a user-entered date is not rewritten by a re-render', async () => {
    const c = await mount(null);
    await render.act(async () => { hook.setGoalTargetDate('2026-09-15'); });
    await render.act(async () => { c.update(<Wrapper goal={null} />); });
    expect(hook.goalTargetDate).toBe('2026-09-15');
  });
});
