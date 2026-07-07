import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ReminderSettingsCard } from '../components/ReminderSettingsCard';
import * as Storage from '../storage/entries';
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

beforeEach(() => {
  jest.clearAllMocks();
  Storage.loadWeighInReminder.mockResolvedValue({ enabled: false, hour: 8, minute: 0 });
  Storage.loadWorkoutReminder.mockResolvedValue({ enabled: false, hour: 17, minute: 0, fallbackWeekdays: [] });
  Storage.loadWorkoutNotes.mockResolvedValue([
    { id: 'note-1', isCurrent: true, raw_text: ['Push day', '-Bench press', '185 5x5'].join('\n') },
  ]);
  Storage.loadCurrentWorkoutId.mockResolvedValue('note-1');
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
      tree = renderer.create(<ReminderSettingsCard />);
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
      tree = renderer.create(<ReminderSettingsCard />);
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
});
