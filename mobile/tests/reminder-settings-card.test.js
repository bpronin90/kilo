import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ReminderSettingsCard } from '../components/ReminderSettingsCard';
import * as Storage from '../storage/entries';
import { notifyWorkoutNotes } from '../hooks/entries/workoutNoteHooks';
import {
  requestReminderPermission,
  applyWeighInReminder,
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

  // #1018: each reminder is one group whose gap sets a uniform distance from
  // the label/switch row to every sub-element under it (weekday grid, time row,
  // inline error). No row carries a bottom margin, so an enabled weigh-in
  // time row is spaced identically to the workout weekday grid.
  describe('sub-element spacing (#1018)', () => {
    const { StyleSheet } = require('react-native');

    function groupOf(tree, childLabel) {
      return tree.root.findAll((n) => n.type === 'View'
        && (StyleSheet.flatten(n.props.style) || {}).gap === 8
        && n.findAll((c) => c.props?.accessibilityLabel === childLabel).length > 0)[0];
    }

    test('no reminder row carries a bottom margin; each reminder sits in an 8dp-gap group', async () => {
      let tree;
      await act(async () => {
        tree = createCard();
      });
      const rows = tree.root.findAll((n) => n.type === 'View'
        && (StyleSheet.flatten(n.props.style) || {}).justifyContent === 'space-between'
        && n.findAll((c) => c.props?.accessibilityRole === 'switch').length > 0);
      expect(rows.length).toBe(2);
      rows.forEach((row) => {
        const style = StyleSheet.flatten(row.props.style) || {};
        expect(style.marginBottom).toBeUndefined();
      });
      // The workout weekday grid and the workout switch share one group.
      expect(groupOf(tree, 'Nudge on Monday')).toBeTruthy();
      expect(groupOf(tree, 'Workout day nudge')).toBe(groupOf(tree, 'Nudge on Monday'));
    });

    test('an enabled weigh-in time row sits in the same 8dp-gap group as its switch', async () => {
      Storage.loadWeighInReminder.mockResolvedValue({ enabled: true, hour: 8, minute: 0 });
      let tree;
      await act(async () => {
        tree = createCard();
      });
      const timeButtonGroup = groupOf(tree, 'Weigh-in reminder time');
      expect(timeButtonGroup).toBeTruthy();
      expect(timeButtonGroup).toBe(groupOf(tree, 'Daily weigh-in reminder'));
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
  describe('storage failures (#1486)', () => {
    const SAVE_ERROR = 'Could not save the reminder setting. Your previous setting was kept. Please try again.';
    const texts = (tree) => tree.root.findAllByType(Text).map(textContent);
    const deferred = () => {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const find = (tree, label) => tree.root.findByProps({ accessibilityLabel: label });
    const mount = async () => {
      let tree;
      await act(async () => { tree = createCard(); });
      return tree;
    };
    const pickTime = async (tree, label, date) => {
      await act(async () => { find(tree, label).props.onPress(); });
      await act(async () => {
        tree.root.findByProps({ testID: 'mock-datetimepicker' }).props.onChange({ type: 'set' }, date);
      });
    };

    test('an edit before hydration is ignored, so the stored setting is never replaced by defaults', async () => {
      const pending = deferred();
      reconcileWorkoutReminder.mockReturnValueOnce(pending.promise);
      const tree = await mount();
      await act(async () => { find(tree, 'Nudge on Monday').props.onPress(); });
      expect(Storage.saveWorkoutReminder).not.toHaveBeenCalled();
      await act(async () => {
        pending.resolve({ workout: { enabled: true, hour: 19, minute: 30, fallbackWeekdays: [3] }, inferredWeekdays: [] });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(find(tree, 'Workout day nudge').props.value).toBe(true);
      expect(find(tree, 'Nudge on Tuesday').props.accessibilityState.checked).toBe(true);
      expect(find(tree, 'Nudge on Monday').props.accessibilityState.checked).toBe(false);
    });

    test('hydration failure leaves the card read-only with a truthful message', async () => {
      reconcileWorkoutReminder.mockRejectedValueOnce(new Error('boom'));
      const tree = await mount();
      expect(texts(tree).join('|')).toContain('Could not load your saved reminder settings');
      await act(async () => { find(tree, 'Nudge on Monday').props.onPress(); });
      await act(async () => { await find(tree, 'Daily weigh-in reminder').props.onValueChange(true); });
      expect(Storage.saveWorkoutReminder).not.toHaveBeenCalled();
      expect(Storage.saveWeighInReminder).not.toHaveBeenCalled();
      expect(requestReminderPermission).not.toHaveBeenCalled();
    });

    test('weigh-in enable rejection restores the switch, reports a save error, and does not schedule', async () => {
      Storage.saveWeighInReminder.mockRejectedValueOnce(new Error('disk full'));
      const tree = await mount();
      await act(async () => { await find(tree, 'Daily weigh-in reminder').props.onValueChange(true); });
      expect(find(tree, 'Daily weigh-in reminder').props.value).toBe(false);
      expect(texts(tree)).toContain(SAVE_ERROR);
      expect(applyWeighInReminder).not.toHaveBeenCalled();
    });

    test('workout disable rejection keeps the durable enabled setting', async () => {
      setReconciled({ enabled: true, hour: 17, minute: 0, fallbackWeekdays: [] }, [2]);
      Storage.saveWorkoutReminder.mockRejectedValueOnce(new Error('disk full'));
      const tree = await mount();
      await act(async () => { await find(tree, 'Workout day nudge').props.onValueChange(false); });
      expect(find(tree, 'Workout day nudge').props.value).toBe(true);
      expect(texts(tree)).toContain(SAVE_ERROR);
      expect(applyWorkoutReminder).not.toHaveBeenCalled();
    });

    test('time change rejection restores the last durable time', async () => {
      Storage.loadWeighInReminder.mockResolvedValue({ enabled: true, hour: 8, minute: 0 });
      Storage.saveWeighInReminder.mockRejectedValueOnce(new Error('disk full'));
      const tree = await mount();
      await pickTime(tree, 'Weigh-in reminder time', new Date(2026, 0, 1, 9, 30));
      expect(texts(tree)).toContain(SAVE_ERROR);
      expect(texts(tree)).toContain('8:00 AM');
      expect(applyWeighInReminder).not.toHaveBeenCalled();
    });

    test('fallback-day rejection restores the chip, then a retry succeeds and clears the error', async () => {
      Storage.saveWorkoutReminder.mockRejectedValueOnce(new Error('disk full'));
      const tree = await mount();
      await act(async () => { await find(tree, 'Nudge on Monday').props.onPress(); });
      expect(find(tree, 'Nudge on Monday').props.accessibilityState.checked).toBe(false);
      expect(texts(tree)).toContain(SAVE_ERROR);
      await act(async () => { await find(tree, 'Nudge on Monday').props.onPress(); });
      expect(find(tree, 'Nudge on Monday').props.accessibilityState.checked).toBe(true);
      expect(texts(tree)).not.toContain(SAVE_ERROR);
      expect(Storage.saveWorkoutReminder).toHaveBeenLastCalledWith(
        expect.objectContaining({ fallbackWeekdays: [2] }),
      );
    });

    test('a scheduling failure after a successful write is not reported as a save failure', async () => {
      applyWeighInReminder.mockRejectedValueOnce(new Error('alarm denied'));
      const tree = await mount();
      await act(async () => { await find(tree, 'Daily weigh-in reminder').props.onValueChange(true); });
      expect(Storage.saveWeighInReminder).toHaveBeenCalledTimes(2);
      expect(texts(tree).join('|')).toContain('Could not schedule the reminder');
      expect(texts(tree)).not.toContain(SAVE_ERROR);
      expect(find(tree, 'Daily weigh-in reminder').props.value).toBe(false);
    });

    test('a time edit whose schedule fails keeps the saved time and reports the schedule error', async () => {
      Storage.loadWeighInReminder.mockResolvedValue({ enabled: true, hour: 8, minute: 0 });
      applyWeighInReminder.mockRejectedValueOnce(new Error('alarm denied'));
      const tree = await mount();
      await pickTime(tree, 'Weigh-in reminder time', new Date(2026, 0, 1, 9, 30));
      expect(Storage.saveWeighInReminder).toHaveBeenCalledWith({ enabled: true, hour: 9, minute: 30 });
      expect(texts(tree)).toContain('9:30 AM');
      expect(texts(tree).join('|')).toContain('Could not schedule the reminder');
    });

    test('an earlier failed write cannot overwrite a newer durable change', async () => {
      const first = deferred();
      Storage.saveWorkoutReminder.mockImplementationOnce(() => first.promise);
      const tree = await mount();
      await act(async () => { find(tree, 'Nudge on Monday').props.onPress(); });
      await act(async () => { find(tree, 'Nudge on Tuesday').props.onPress(); });
      // Tuesday's draft composes on Monday's, so its write carries both days.
      await act(async () => {
        first.reject(new Error('disk full'));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(Storage.saveWorkoutReminder).toHaveBeenLastCalledWith(
        expect.objectContaining({ fallbackWeekdays: [2, 3] }),
      );
      expect(find(tree, 'Nudge on Monday').props.accessibilityState.checked).toBe(true);
      expect(find(tree, 'Nudge on Tuesday').props.accessibilityState.checked).toBe(true);
      expect(texts(tree)).not.toContain(SAVE_ERROR);
    });

    test('when the newest of two overlapping writes fails, the last durable value is restored', async () => {
      Storage.saveWorkoutReminder
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('disk full'));
      const tree = await mount();
      await act(async () => {
        find(tree, 'Nudge on Monday').props.onPress();
        find(tree, 'Nudge on Tuesday').props.onPress();
      });
      expect(find(tree, 'Nudge on Monday').props.accessibilityState.checked).toBe(true);
      expect(find(tree, 'Nudge on Tuesday').props.accessibilityState.checked).toBe(false);
      expect(texts(tree)).toContain(SAVE_ERROR);
    });

    test('writes are serialized in request order', async () => {
      const first = deferred();
      Storage.saveWorkoutReminder.mockImplementationOnce(() => first.promise);
      const tree = await mount();
      await act(async () => {
        find(tree, 'Nudge on Monday').props.onPress();
        find(tree, 'Nudge on Tuesday').props.onPress();
      });
      expect(Storage.saveWorkoutReminder).toHaveBeenCalledTimes(1);
      await act(async () => {
        first.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(Storage.saveWorkoutReminder).toHaveBeenCalledTimes(2);
    });

    test('a rejection that settles after unmount is swallowed without touching state', async () => {
      const pending = deferred();
      Storage.saveWeighInReminder.mockImplementationOnce(() => pending.promise);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const tree = await mount();
      await act(async () => { find(tree, 'Daily weigh-in reminder').props.onValueChange(true); });
      await act(async () => { tree.unmount(); });
      await act(async () => {
        pending.reject(new Error('disk full'));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    test('a failed enable that cannot be scheduled and cannot be turned off restores the durable value', async () => {
      applyWeighInReminder.mockRejectedValueOnce(new Error('alarm denied'));
      Storage.saveWeighInReminder
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('disk full'));
      const tree = await mount();
      await act(async () => { await find(tree, 'Daily weigh-in reminder').props.onValueChange(true); });
      expect(find(tree, 'Daily weigh-in reminder').props.value).toBe(true);
      expect(texts(tree)).toContain(SAVE_ERROR);
    });
  });
});
