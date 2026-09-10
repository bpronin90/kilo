import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ReminderSettingsCard } from '../components/ReminderSettingsCard';
import * as Storage from '../storage/entries';
import { notifyWorkoutNotes } from '../hooks/entries/workoutNoteHooks';
import {
  requestReminderPermission,
  applyWorkoutReminder,
  reconcileWorkoutReminder,
} from '../lib/reminderScheduler';

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('../storage/entries', () => ({
  loadWeighInReminder: jest.fn(),
  loadWorkoutReminder: jest.fn(),
  saveWeighInReminder: jest.fn(async () => {}),
  saveWorkoutReminder: jest.fn(async () => {}),
}));

// reconcileWorkoutReminder itself (routine text/identity resolution,
// idempotent dedup, disabled-stays-unscheduled) is covered directly against
// reminderScheduler.js in reminder-scheduler.test.js, and against the
// always-on broadcast (no Settings screen mounted at all) in
// reminder-always-on-reconciliation.test.js. This suite only proves
// ReminderSettingsCard's own wiring: it displays whatever
// reconcileWorkoutReminder reports, refreshes that display on the
// workout-note broadcast, and — per the PR #649 review finding — does NOT
// also call applyWorkoutReminder itself for routine changes, since that
// would double-schedule alongside the always-on subscriber in
// workoutNoteHooks.js.
jest.mock('../lib/reminderScheduler', () => ({
  remindersSupported: jest.fn(() => true),
  requestReminderPermission: jest.fn(async () => true),
  applyWeighInReminder: jest.fn(async () => {}),
  applyWorkoutReminder: jest.fn(async () => {}),
  reconcileWorkoutReminder: jest.fn(),
}));

function setReconciled(workout, inferredWeekdays) {
  reconcileWorkoutReminder.mockResolvedValue({ workout, inferredWeekdays });
}

let trees = [];
function createCard() {
  const tree = renderer.create(<ReminderSettingsCard />);
  trees.push(tree);
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  Storage.loadWeighInReminder.mockResolvedValue({ enabled: false, hour: 8, minute: 0 });
  setReconciled({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] }, []);
});

afterEach(async () => {
  // Each card subscribes to the shared workoutNotesListeners broadcast for
  // the lifetime of the test; unmount so later tests' notifyWorkoutNotes()
  // calls don't also touch stale instances from earlier tests.
  await act(async () => {
    trees.forEach((tree) => tree.unmount());
  });
  trees = [];
});

function textContent(node) {
  if (typeof node === 'string') return node;
  if (!node?.props?.children) return '';
  return React.Children.toArray(node.props.children).map(textContent).join('');
}

describe('ReminderSettingsCard', () => {
  test('keeps workout nudge off when no inferred or fallback weekdays exist', async () => {
    let tree;
    await act(async () => {
      tree = createCard();
    });

    const workoutSwitch = tree.root.findByProps({ accessibilityLabel: 'Workout day nudge' });
    await act(async () => {
      await workoutSwitch.props.onValueChange(true);
    });

    expect(requestReminderPermission).not.toHaveBeenCalled();
    expect(Storage.saveWorkoutReminder).not.toHaveBeenCalled();
    expect(applyWorkoutReminder).not.toHaveBeenCalled();
    expect(workoutSwitch.props.value).toBe(false);
    expect(tree.root.findAllByType(Text).map(textContent)).toContain(
      'Pick at least one workout day before enabling the nudge.'
    );
    expect(tree.root.findByProps({ accessibilityLabel: 'Nudge on Monday' })).toBeTruthy();
  });

  test('lets fallback weekdays be selected before enabling the workout nudge', async () => {
    let tree;
    await act(async () => {
      tree = createCard();
    });

    const mondayChip = tree.root.findByProps({ accessibilityLabel: 'Nudge on Monday' });
    await act(async () => {
      await mondayChip.props.onPress();
    });

    expect(Storage.saveWorkoutReminder).toHaveBeenLastCalledWith({
      enabled: false,
      hour: 17,
      minute: 0,
      fallbackWeekdays: [2],
    });

    jest.clearAllMocks();
    setReconciled({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [2] }, []);

    const workoutSwitch = tree.root.findByProps({ accessibilityLabel: 'Workout day nudge' });
    await act(async () => {
      await workoutSwitch.props.onValueChange(true);
    });

    expect(requestReminderPermission).toHaveBeenCalledTimes(1);
    expect(Storage.saveWorkoutReminder).toHaveBeenCalledWith({
      enabled: true,
      hour: 17,
      minute: 0,
      fallbackWeekdays: [2],
    });
    expect(applyWorkoutReminder).toHaveBeenCalledWith({
      enabled: true,
      hour: 17,
      minute: 0,
      fallbackWeekdays: [2],
    }, [2]);
  });

  // #1018: the reminder sub-elements (weekday grid, time rows, inline errors)
  // carry one consistent gap from the switch row above them, and the wrapped
  // weekday grid keeps its two rows apart.
  describe('sub-element spacing (#1018)', () => {
    const { StyleSheet } = require('react-native');

    test('the weekday grid is separated from the row above and its wrapped rows do not touch', async () => {
      let tree;
      await act(async () => {
        tree = createCard();
      });
      const monday = tree.root.findByProps({ accessibilityLabel: 'Nudge on Monday' });
      // The grid container is the Monday chip's parent row.
      const row = tree.root.findAll((n) => n.type === 'View'
        && n.findAll((c) => c.props?.accessibilityLabel === 'Nudge on Monday').length > 0
        && (StyleSheet.flatten(n.props.style) || {}).flexWrap === 'wrap')[0];
      const style = StyleSheet.flatten(row.props.style) || {};
      expect(style.marginTop).toBe(4);
      expect(style.rowGap).toBe(4);
      expect(monday).toBeTruthy();
    });

    test('an enabled reminder time row carries the same gap', async () => {
      Storage.loadWeighInReminder.mockResolvedValue({ enabled: true, hour: 8, minute: 0 });
      let tree;
      await act(async () => {
        tree = createCard();
      });
      const timeButton = tree.root.findByProps({ accessibilityLabel: 'Weigh-in reminder time' });
      const subRow = tree.root.findAll((n) => n.type === 'View'
        && n.findAll((c) => c.props?.accessibilityLabel === 'Weigh-in reminder time').length > 0
        && (StyleSheet.flatten(n.props.style) || {}).justifyContent === 'space-between')[0];
      expect((StyleSheet.flatten(subRow.props.style) || {}).marginTop).toBe(4);
      expect(timeButton).toBeTruthy();
    });
  });

  describe('reconciliation wiring (#590 / PR #649 review)', () => {
    test('displays the inferred weekdays reconcileWorkoutReminder reports on mount', async () => {
      setReconciled({ enabled: true, hour: 17, minute: 0, fallbackWeekdays: [] }, [2, 4]);

      let tree;
      await act(async () => {
        tree = createCard();
      });

      expect(reconcileWorkoutReminder).toHaveBeenCalledTimes(1);
      const workoutSwitch = tree.root.findByProps({ accessibilityLabel: 'Workout day nudge' });
      expect(workoutSwitch.props.value).toBe(true);
      expect(tree.root.findAllByType(Text).map(textContent)).toContain(
        'On your routine’s training days: Mon, Wed'
      );
      // Mounting the card must not itself reschedule — reconciliation is
      // owned by reminderScheduler.js/workoutNoteHooks.js, not the card.
      expect(applyWorkoutReminder).not.toHaveBeenCalled();
    });

    test('refreshes the displayed weekdays on the workout-note broadcast without calling applyWorkoutReminder itself', async () => {
      setReconciled({ enabled: true, hour: 17, minute: 0, fallbackWeekdays: [] }, [2]);

      let tree;
      await act(async () => {
        tree = createCard();
      });

      // The always-on subscriber in workoutNoteHooks.js is what actually
      // reschedules in the real app; this card only needs to reflect the
      // latest reconciled state it reports. Simulate that here by changing
      // what the next reconcileWorkoutReminder() call resolves to.
      setReconciled({ enabled: true, hour: 17, minute: 0, fallbackWeekdays: [] }, [2, 4]);
      await act(async () => {
        notifyWorkoutNotes();
        await Promise.resolve();
        await Promise.resolve();
      });

      // reconcileWorkoutReminder is mocked, so both the card's own display
      // listener AND the always-on subscriber registered by
      // hooks/entries/workoutNoteHooks.js (imported transitively by the card)
      // call it in response to the same broadcast: 1 mount + 2 on notify.
      expect(reconcileWorkoutReminder).toHaveBeenCalledTimes(3);
      expect(tree.root.findAllByType(Text).map(textContent)).toContain(
        'On your routine’s training days: Mon, Wed'
      );
      // The card itself never calls applyWorkoutReminder in response to a
      // routine change — only in response to a direct user toggle/edit,
      // which this test never triggers. Double-scheduling alongside the
      // always-on subscriber would violate idempotency.
      expect(applyWorkoutReminder).not.toHaveBeenCalled();
    });

    test('a disabled reminder stays displayed as off across a routine broadcast', async () => {
      setReconciled({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] }, [2]);

      let tree;
      await act(async () => {
        tree = createCard();
      });

      setReconciled({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] }, [2, 4]);
      await act(async () => {
        notifyWorkoutNotes();
        await Promise.resolve();
        await Promise.resolve();
      });

      const workoutSwitch = tree.root.findByProps({ accessibilityLabel: 'Workout day nudge' });
      expect(workoutSwitch.props.value).toBe(false);
      expect(applyWorkoutReminder).not.toHaveBeenCalled();
      expect(requestReminderPermission).not.toHaveBeenCalled();
    });
  });
});
