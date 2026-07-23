import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ReminderSettingsCard } from '../components/ReminderSettingsCard';
import * as Storage from '../storage/entries';
import { notifyWorkoutNotes } from '../hooks/entries/workoutNoteHooks';
import {
  requestReminderPermission,
  applyWorkoutReminder,
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
  loadWorkoutNotes: jest.fn(),
  loadCurrentWorkoutId: jest.fn(),
  saveWeighInReminder: jest.fn(async () => {}),
  saveWorkoutReminder: jest.fn(async () => {}),
}));

jest.mock('../lib/reminderScheduler', () => ({
  remindersSupported: jest.fn(() => true),
  requestReminderPermission: jest.fn(async () => true),
  applyWeighInReminder: jest.fn(async () => {}),
  applyWorkoutReminder: jest.fn(async () => {}),
}));

const PUSH_DAY_NOTE = {
  id: 'note-1',
  isCurrent: true,
  raw_text: ['Push day', '-Bench press', '185 5x5'].join('\n'),
};

function setActiveNote(note) {
  Storage.loadWorkoutNotes.mockResolvedValue(note ? [note] : []);
  Storage.loadCurrentWorkoutId.mockResolvedValue(note?.id ?? null);
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
  Storage.loadWorkoutReminder.mockResolvedValue({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] });
  setActiveNote(PUSH_DAY_NOTE);
});

afterEach(async () => {
  // Each card subscribes to the shared workoutNotesListeners broadcast for
  // the lifetime of the test; unmount so later tests' notifyWorkoutNotes()
  // calls don't also reschedule stale instances from earlier tests.
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

  describe('reconciliation with the active routine (#590)', () => {
    const MONDAY_NOTE = {
      id: 'note-1',
      isCurrent: true,
      raw_text: ['Monday', '-Bench press', '185 5x5'].join('\n'),
    };
    const MONDAY_WEDNESDAY_NOTE = {
      id: 'note-1',
      isCurrent: true,
      raw_text: ['Monday', '-Bench press', '185 5x5', '', 'Wednesday', '-Squat', '225 5x5'].join('\n'),
    };
    const OTHER_ROUTINE_FRIDAY_NOTE = {
      id: 'note-2',
      isCurrent: true,
      raw_text: ['Friday', '-Deadlift', '315 3x5'].join('\n'),
    };
    const ENABLED_INFERRED_WORKOUT = { enabled: true, hour: 17, minute: 0, fallbackWeekdays: [] };

    test('reschedules an enabled inferred-weekday reminder after the routine text changes', async () => {
      setActiveNote(MONDAY_NOTE);
      Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

      await act(async () => {
        createCard();
      });

      expect(applyWorkoutReminder).not.toHaveBeenCalled();

      // Simulate the note's text being edited elsewhere in the app: the
      // reminder card re-reads storage in response to the same broadcast
      // useWorkoutNotes() screens use, then reschedules idempotently.
      setActiveNote(MONDAY_WEDNESDAY_NOTE);
      await act(async () => {
        notifyWorkoutNotes();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(applyWorkoutReminder).toHaveBeenCalledWith(ENABLED_INFERRED_WORKOUT, [2, 4]);
      expect(requestReminderPermission).not.toHaveBeenCalled();
    });

    test('reschedules an enabled inferred-weekday reminder after the active routine switches', async () => {
      setActiveNote(MONDAY_NOTE);
      Storage.loadWorkoutReminder.mockResolvedValue(ENABLED_INFERRED_WORKOUT);

      await act(async () => {
        createCard();
      });

      setActiveNote(OTHER_ROUTINE_FRIDAY_NOTE);
      await act(async () => {
        notifyWorkoutNotes();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(applyWorkoutReminder).toHaveBeenCalledWith(ENABLED_INFERRED_WORKOUT, [6]);
      expect(requestReminderPermission).not.toHaveBeenCalled();
    });

    test('keeps explicit fallback weekdays authoritative when the routine has no inferred days', async () => {
      const FALLBACK_WORKOUT = { enabled: true, hour: 17, minute: 0, fallbackWeekdays: [2] };
      setActiveNote(PUSH_DAY_NOTE);
      Storage.loadWorkoutReminder.mockResolvedValue(FALLBACK_WORKOUT);

      let tree;
      await act(async () => {
        tree = createCard();
      });

      expect(applyWorkoutReminder).not.toHaveBeenCalled();

      // A different note with no weekday headings still resolves via the
      // untouched fallback selection, not the (empty) inference.
      setActiveNote({ id: 'note-3', isCurrent: true, raw_text: 'Legs and arms' });
      await act(async () => {
        notifyWorkoutNotes();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(applyWorkoutReminder).not.toHaveBeenCalled();

      const workoutSwitch = tree.root.findByProps({ accessibilityLabel: 'Workout day nudge' });
      expect(workoutSwitch.props.value).toBe(true);
    });

    test('does not reschedule or reapply while the workout reminder is disabled', async () => {
      setActiveNote(MONDAY_NOTE);
      Storage.loadWorkoutReminder.mockResolvedValue({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] });

      let tree;
      await act(async () => {
        tree = createCard();
      });

      setActiveNote(MONDAY_WEDNESDAY_NOTE);
      await act(async () => {
        notifyWorkoutNotes();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(applyWorkoutReminder).not.toHaveBeenCalled();
      expect(requestReminderPermission).not.toHaveBeenCalled();
      const workoutSwitch = tree.root.findByProps({ accessibilityLabel: 'Workout day nudge' });
      expect(workoutSwitch.props.value).toBe(false);
    });
  });
});
