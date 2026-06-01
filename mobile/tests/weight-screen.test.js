import React from 'react';
import render from 'react-test-renderer';
import { Alert } from 'react-native';
import { WeightScreen } from '../screens/WeightScreen';
import * as useEntries from '../hooks/useEntries';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return function MockDateTimePicker() {
    return null;
  };
});

jest.mock('../hooks/useEntries');

const MOCK_NOW = new Date('2026-05-24T12:00:00Z');
jest.useFakeTimers().setSystemTime(MOCK_NOW);

// Wrapper that owns form state so handleEditEntry/setWeightValue callbacks propagate
function ControlledWeightScreen(props) {
  const [weightValue, setWeightValue] = React.useState('');
  const [weightNote, setWeightNote] = React.useState('');
  return (
    <WeightScreen
      {...props}
      weightValue={weightValue}
      setWeightValue={setWeightValue}
      weightNote={weightNote}
      setWeightNote={setWeightNote}
    />
  );
}

const ENTRY = {
  id: 'e1',
  date: '2026-05-24',
  logged_at: '2026-05-24T08:00:00Z',
  weight_value: 185,
  weight_unit: 'lb',
  note: 'morning',
};

describe('WeightScreen edit and delete correction flows', () => {
  let mockRemove;
  let mockUpdate;
  let currentEntries;

  beforeEach(() => {
    jest.clearAllMocks();
    currentEntries = [{ ...ENTRY }];

    // Stateful mocks: update the hook return value when entries change so that
    // any re-render triggered by the component (e.g. cancelEdit state changes)
    // picks up the new entries list.
    const makeMockReturn = () => ({
      entries: currentEntries,
      remove: mockRemove,
      update: mockUpdate,
    });

    mockUpdate = jest.fn().mockImplementation(async (id, weight, note) => {
      currentEntries = currentEntries.map(e =>
        e.id === id ? { ...e, weight_value: weight, note: note || '' } : e
      );
      useEntries.useWeightEntries.mockReturnValue(makeMockReturn());
    });

    mockRemove = jest.fn().mockImplementation(async (id) => {
      currentEntries = currentEntries.filter(e => e.id !== id);
      useEntries.useWeightEntries.mockReturnValue(makeMockReturn());
    });

    useEntries.useWeightEntries.mockReturnValue(makeMockReturn());
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn() });
  });

  // Walk up from each Text node containing `text` and return the first one
  // whose ancestor chain has a node with onPress.
  const findPressableByText = (root, text) => {
    const matches = root.findAll(n => {
      if (n.type !== 'Text') return false;
      const children = n.props.children;
      const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
      return flat.includes(text);
    });
    for (const match of matches) {
      let node = match.parent;
      while (node) {
        if (node.props && typeof node.props.onPress === 'function') return node;
        node = node.parent;
      }
    }
    return null;
  };

  const hasText = (root, text) =>
    root.findAll(n => {
      if (n.type !== 'Text') return false;
      const flat = Array.isArray(n.props.children)
        ? n.props.children.join('')
        : String(n.props.children ?? '');
      return flat.includes(text);
    }).length > 0;

  test('tapping a history row loads both weight and note into the form in editing mode', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    expect(hasText(root, 'Editing entry')).toBe(false);

    const rowPressable = findPressableByText(root, '185');
    render.act(() => {
      rowPressable.props.onPress();
    });

    expect(hasText(root, 'Editing entry')).toBe(true);
    const inputs = root.findAll(n => n.type === 'TextInput');
    expect(inputs[0].props.value).toBe('185');
    expect(inputs[1].props.value).toBe('morning');
  });

  test('edit submit persists corrected weight, exits editing mode, and refreshes the row', async () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    // Enter editing mode
    const rowPressable = findPressableByText(root, '185');
    render.act(() => {
      rowPressable.props.onPress();
    });

    // Correct the weight field before submitting
    const inputs = root.findAll(n => n.type === 'TextInput');
    render.act(() => {
      inputs[0].props.onChangeText('190');
    });

    // Press "Update entry" and await the full async chain (parseWeightEntry → update → cancelEdit)
    const updateBtn = findPressableByText(root, 'Update entry');
    expect(updateBtn).toBeTruthy();
    await render.act(async () => {
      await updateBtn.props.onPress();
    });

    expect(mockUpdate).toHaveBeenCalledWith('e1', 190, 'morning', undefined);
    // cancelEdit() triggers re-renders that pick up the updated entries
    expect(hasText(root, 'Editing entry')).toBe(false);
    expect(hasText(root, '190')).toBe(true);
    expect(hasText(root, '185 lb')).toBe(false);
  });

  test('edit submit shows validation error and does not call update for invalid weight', async () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    const rowPressable = findPressableByText(root, '185');
    render.act(() => {
      rowPressable.props.onPress();
    });

    // Overwrite weight field with invalid value
    const inputs = root.findAll(n => n.type === 'TextInput');
    render.act(() => {
      inputs[0].props.onChangeText('abc');
    });

    const updateBtn = findPressableByText(root, 'Update entry');
    await render.act(async () => {
      await updateBtn.props.onPress();
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(hasText(root, 'Enter a number only')).toBe(true);
  });

  test('tapping the delete affordance shows a confirm prompt, calls remove, and removes the row', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    let component;
    const screenProps = { onSaveWeight: jest.fn(), errorMessage: '', saving: false };
    render.act(() => {
      component = render.create(<ControlledWeightScreen {...screenProps} />);
    });
    const root = component.root;

    expect(hasText(root, '185 lb')).toBe(true);

    const deleteBtn = findPressableByText(root, '✕');
    render.act(() => {
      deleteBtn.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete Entry',
      expect.any(String),
      expect.any(Array)
    );

    const alertButtons = alertSpy.mock.calls[0][2];
    const confirmButton = alertButtons.find(b => b.style === 'destructive');
    await render.act(async () => {
      await confirmButton.onPress();
    });

    expect(mockRemove).toHaveBeenCalledWith('e1');

    // Force a re-render so the updated entries list (now empty) is reflected.
    // handleDelete does not call cancelEdit when the deleted entry is not being edited,
    // so no internal state change drives a re-render automatically.
    render.act(() => {
      component.update(<ControlledWeightScreen {...screenProps} />);
    });

    expect(hasText(root, '185 lb')).toBe(false);
    expect(hasText(root, 'No weight entries yet.')).toBe(true);
  });

  test('cancelling the delete prompt does not call remove', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    const deleteBtn = findPressableByText(root, '✕');
    render.act(() => {
      deleteBtn.props.onPress();
    });

    const alertButtons = alertSpy.mock.calls[0][2];
    const cancelButton = alertButtons.find(b => b.style === 'cancel');
    render.act(() => {
      cancelButton.onPress?.();
    });

    expect(mockRemove).not.toHaveBeenCalled();
  });
});
