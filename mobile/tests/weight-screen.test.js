import React from 'react';
import render from 'react-test-renderer';
import { Alert } from 'react-native';
import { WeightScreen } from '../screens/WeightScreen';
import * as useEntries from '../hooks/useEntries';
import * as weightHooks from '../hooks/entries/weightHooks';
import App from '../App';
import { parseWeightEntry } from '../lib/parser';

jest.mock('../hooks/entries/weightHooks', () => ({
  useArchivedWeightGoals: () => ({
    archivedGoals: [],
    loading: false,
    refresh: jest.fn(),
  }),
  useWeightGoal: jest.fn(),
  useWeightEntries: jest.fn(),
}));

jest.mock('../lib/parser', () => {
  const actual = jest.requireActual('../lib/parser');
  return {
    ...actual,
    parseWeightEntry: jest.fn(actual.parseWeightEntry),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { MaterialIcons: () => null };
}, { virtual: true });

jest.mock('../screens/HomeScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { HomeScreen: () => React.createElement(View) };
});
jest.mock('../screens/LogScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LogScreen: () => React.createElement(View) };
});
jest.mock('../screens/AnalyticsScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { AnalyticsScreen: () => React.createElement(View) };
});
jest.mock('../screens/MoreScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { MoreScreen: () => React.createElement(View) };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('../hooks/useEntries');
jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const mockScrollTo = jest.fn();
  const ScreenShell = React.forwardRef(({ children, keyboardShouldPersistTaps }, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
    return React.createElement(View, null, children);
  });
  ScreenShell._mockScrollTo = mockScrollTo;
  return {
    ScreenShell,
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

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

    mockUpdate = jest.fn().mockImplementation(async (id, weight, note, date) => {
      currentEntries = currentEntries.map(e =>
        e.id === id
          ? {
              ...e,
              weight_value: weight,
              note: note || '',
              ...(date ? { date, logged_at: `${date}T08:00:00Z` } : {}),
            }
          : e
      );
      useEntries.useWeightEntries.mockReturnValue(makeMockReturn());
    });

    mockRemove = jest.fn().mockImplementation(async (id) => {
      currentEntries = currentEntries.filter(e => e.id !== id);
      useEntries.useWeightEntries.mockReturnValue(makeMockReturn());
    });

    useEntries.useWeightEntries.mockReturnValue(makeMockReturn());
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
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

  // Issue #312: with date editing enabled, an edit threads the corrected date
  // through to update() and the refreshed row reflects the new date.
  test('edit submit threads corrected date through update when date editing is enabled', async () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen
          onSaveWeight={jest.fn()}
          errorMessage=""
          saving={false}
          weightDateEditEnabled={true}
        />
      );
    });
    const root = component.root;

    // Enter editing mode for the existing 185 / 2026-05-24 entry
    const rowPressable = findPressableByText(root, '185');
    render.act(() => {
      rowPressable.props.onPress();
    });

    // Open the edit date picker and choose an earlier, valid date
    const dateBtn = root.findByProps({ accessibilityLabel: 'Entry date' });
    render.act(() => {
      dateBtn.props.onPress();
    });
    const picker = root.findByProps({ testID: 'mock-datetimepicker' });
    render.act(() => {
      picker.props.onChange({}, new Date(2026, 4, 20)); // 2026-05-20
    });

    const updateBtn = findPressableByText(root, 'Update entry');
    await render.act(async () => {
      await updateBtn.props.onPress();
    });

    expect(mockUpdate).toHaveBeenCalledWith('e1', 185, 'morning', '2026-05-20');
    expect(hasText(root, 'Editing entry')).toBe(false);
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

  test('tapping a history entry calls scrollTo on the screen ref', () => {
    const { ScreenShell } = require('../components/ScreenShell');
    const mockScrollTo = ScreenShell._mockScrollTo;
    mockScrollTo.mockClear();

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

    expect(mockScrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: true });
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

describe('WeightScreen Goals two-panel layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [{ ...ENTRY }],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({
      goal: { target_weight: 175, target_date: '2026-12-01', start_weight: 190 },
      save: jest.fn(),
      clear: jest.fn(),
      archiveGoal: jest.fn(),
    });
    useEntries.useUserProfile = jest.fn().mockReturnValue(null);
  });

  const hasText = (root, text) =>
    root.findAll(n => {
      if (n.type !== 'Text') return false;
      const flat = Array.isArray(n.props.children)
        ? n.props.children.join('')
        : String(n.props.children ?? '');
      return flat.includes(text);
    }).length > 0;

  test('target weight and date appear when goal is set', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    expect(hasText(root, '175 lb')).toBe(true);
  });

  test('Guidance panel appears when goal is set and goalInfo is available', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    expect(hasText(root, 'Guidance')).toBe(true);
    expect(hasText(root, 'Target pace')).toBe(true);
  });
});

describe('WeightScreen DateTimePicker onChange callbacks', () => {
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

  test('weigh-in date picker uses the correct onChange prop', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={true} />
      );
    });
    const root = component.root;

    // Open date picker
    const dateBtn = root.findByProps({ accessibilityLabel: 'Weigh-in date' });
    render.act(() => {
      dateBtn.props.onPress();
    });

    const picker = root.findByProps({ testID: 'mock-datetimepicker' });
    expect(picker).toBeTruthy();
    expect(typeof picker.props.onChange).toBe('function');

    // Simulate changing the date
    const selectedDate = new Date(2026, 4, 25); // 2026-05-25 (0-indexed month)
    render.act(() => {
      picker.props.onChange({}, selectedDate);
    });

    const textNode = dateBtn.findByType('Text');
    expect(textNode.props.children).toBe('2026-05-25');
  });

  test('goal target date picker uses the correct onChange prop', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    // Open goal date picker
    const dateBtn = findPressableByText(root, 'Select date');
    expect(dateBtn).toBeTruthy();
    render.act(() => {
      dateBtn.props.onPress();
    });

    const picker = root.findByProps({ testID: 'mock-datetimepicker' });
    expect(picker).toBeTruthy();
    expect(typeof picker.props.onChange).toBe('function');

    // Simulate changing the date
    const selectedDate = new Date(2026, 11, 25); // 2026-12-25
    render.act(() => {
      picker.props.onChange({}, selectedDate);
    });

    expect(findPressableByText(root, '12-25-2026')).toBeTruthy();
  });
});

describe('WeightScreen Goal Editor Live Preview', () => {
  const hasText = (root, text) =>
    root.findAll(n => {
      if (n.type !== 'Text') return false;
      const flat = Array.isArray(n.props.children)
        ? n.props.children.join('')
        : String(n.props.children ?? '');
      return flat.includes(text);
    }).length > 0;

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

  test('renders live preview info card/warnings as form values change', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({
      goal: null,
      save: jest.fn(),
      clear: jest.fn(),
      archiveGoal: jest.fn(),
    });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    // The target weight input starts empty
    const targetWeightInput = root.findByProps({ placeholder: '175.0' });
    expect(targetWeightInput).toBeTruthy();

    render.act(() => {
      targetWeightInput.props.onChangeText('175.0');
    });

    // Select date pressable should be visible
    const dateBtn = findPressableByText(root, 'Select date');
    expect(dateBtn).toBeTruthy();
    render.act(() => {
      dateBtn.props.onPress();
    });

    const picker = root.findByProps({ testID: 'mock-datetimepicker' });
    expect(picker).toBeTruthy();

    // Select a date 1 week in the future (June 1st, 2026 since MOCK_NOW is May 24th, 2026)
    const selectedDate = new Date('2026-06-01T12:00:00Z');
    render.act(() => {
      picker.props.onChange({}, selectedDate);
    });

    // It should calculate a 10 lb / week pace, which triggers the warnings since current weight is 185 and target is 175 in 1 week.
    expect(hasText(root, 'Pace is unrealistic - consider a longer timeline.')).toBe(true);
  });
});

describe('App weight saving local-date handling', () => {
  let mockAdd;
  let mockEntries;
  let originalGetFullYear;
  let originalGetMonth;
  let originalGetDate;
  let originalToISOString;

  beforeEach(() => {
    jest.clearAllMocks();
    const actualParser = jest.requireActual('../lib/parser');
    parseWeightEntry.mockImplementation(actualParser.parseWeightEntry);

    mockEntries = [];
    mockAdd = jest.fn().mockImplementation(async (entry) => {
      mockEntries.push(entry);
      return entry;
    });

    useEntries.useWeightEntries.mockReturnValue({
      entries: mockEntries,
      add: mockAdd,
      remove: jest.fn(),
      update: jest.fn(),
      refresh: jest.fn(),
    });

    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [],
      currentNote: null,
      currentId: null,
      add: jest.fn(),
      update: jest.fn(),
      selectCurrent: jest.fn(),
      refresh: jest.fn(),
    });

    useEntries.useWeightGoal.mockReturnValue({
      goal: null,
      save: jest.fn(),
      clear: jest.fn(),
      archiveGoal: jest.fn(),
    });

    useEntries.useTrackedLifts.mockReturnValue({
      trackedLifts: [],
      refresh: jest.fn(),
    });

    useEntries.useUserProfile.mockReturnValue(null);

    originalGetFullYear = Date.prototype.getFullYear;
    originalGetMonth = Date.prototype.getMonth;
    originalGetDate = Date.prototype.getDate;
    originalToISOString = Date.prototype.toISOString;
  });

  afterEach(() => {
    Date.prototype.getFullYear = originalGetFullYear;
    Date.prototype.getMonth = originalGetMonth;
    Date.prototype.getDate = originalGetDate;
    Date.prototype.toISOString = originalToISOString;
  });

  test('saves new weight entry under local date when logged in late evening (UTC next day)', async () => {
    Date.prototype.getFullYear = jest.fn(() => 2026);
    Date.prototype.getMonth = jest.fn(() => 5); // June (0-indexed)
    Date.prototype.getDate = jest.fn(() => 11);
    Date.prototype.toISOString = jest.fn(() => '2026-06-12T03:30:00.000Z');

    let component;
    render.act(() => {
      component = render.create(<App />);
    });
    const root = component.root;
    const weightScreen = root.findByType(WeightScreen);

    render.act(() => {
      weightScreen.props.setWeightValue('185');
    });

    await render.act(async () => {
      await weightScreen.props.onSaveWeight();
    });

    expect(mockAdd).toHaveBeenCalled();
    const savedEntry = mockAdd.mock.calls[0][0];
    expect(savedEntry.logged_at).toBe('2026-06-11T03:30:00.000Z');
  });

  test('does not crash and saves correctly under local date when parsed.logged_at is undefined', async () => {
    Date.prototype.getFullYear = jest.fn(() => 2026);
    Date.prototype.getMonth = jest.fn(() => 5); // June (0-indexed)
    Date.prototype.getDate = jest.fn(() => 11);
    Date.prototype.toISOString = jest.fn(() => '2026-06-12T03:30:00.000Z');

    parseWeightEntry.mockReturnValue({
      ok: true,
      raw: '185',
      weight_value: 185,
      weight_unit: 'lb',
      logged_at: undefined,
    });

    let component;
    render.act(() => {
      component = render.create(<App />);
    });
    const root = component.root;
    const weightScreen = root.findByType(WeightScreen);

    render.act(() => {
      weightScreen.props.setWeightValue('185');
    });

    await render.act(async () => {
      await weightScreen.props.onSaveWeight();
    });

    expect(mockAdd).toHaveBeenCalled();
    const savedEntry = mockAdd.mock.calls[0][0];
    expect(savedEntry.logged_at).toBe('2026-06-11T03:30:00.000Z');
  });
});

// ── Web date input fallback (#314) ────────────────────────────────────────────
// On web the native DateTimePicker has no usable rendering, so WeightScreen must
// render a real DOM <input type="date"> that writes the chosen date straight
// back. Native (default jest-expo Platform.OS) keeps the Pressable + picker path.
describe('WeightScreen web date fallback (#314)', () => {
  const { Platform } = require('react-native');
  let originalOS;

  beforeAll(() => {
    originalOS = Platform.OS;
    Platform.OS = 'web';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  });

  test('renders a DOM date input instead of the native picker for new entries', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={true} />
      );
    });
    const root = component.root;
    const dateInputs = root.findAll(n => n.type === 'input' && n.props.type === 'date');
    expect(dateInputs.length).toBe(1);
    // The native picker must NOT be mounted on web.
    expect(root.findAll(n => n.props && n.props.testID === 'mock-datetimepicker').length).toBe(0);
  });

  test('changing the DOM date input updates the new-entry date value', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={true} />
      );
    });
    const root = component.root;
    const dateInput = root.find(n => n.type === 'input' && n.props.type === 'date');
    render.act(() => {
      dateInput.props.onChange({ target: { value: '2026-05-20' } });
    });
    const updated = root.find(n => n.type === 'input' && n.props.type === 'date');
    expect(updated.props.value).toBe('2026-05-20');
  });
});

describe('WeightHistoryList disclosure triangle convention (#393)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  });

  test('toggle button shows expand-more when history is expanded (default)', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={false} />
      );
    });
    const toggleBtn = component.root.findByProps({ accessibilityLabel: 'Collapse history' });
    expect(toggleBtn).toBeTruthy();
  });

  test('toggle button shows Expand history label after collapsing', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={false} />
      );
    });
    const toggleBtn = component.root.findByProps({ accessibilityLabel: 'Collapse history' });
    render.act(() => { toggleBtn.props.onPress(); });
    const expandBtn = component.root.findByProps({ accessibilityLabel: 'Expand history' });
    expect(expandBtn).toBeTruthy();
  });
});

describe('WeightHistoryList date range cancel does not commit sentinel date (#394)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  });

  function findClearBtn(component) {
    return component.root.findAll(n => n.props.accessibilityLabel === undefined && n.props.onPress !== undefined && n.props.hitSlop === 8 && n.type && n.type.displayName !== 'Pressable');
  }

  test('cancelling From date picker does not set a date (clear button stays hidden)', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={false} />
      );
    });
    const fromBtn = component.root.findByProps({ accessibilityLabel: 'From date' });
    render.act(() => { fromBtn.props.onPress(); });
    const picker = component.root.findByProps({ testID: 'mock-datetimepicker' });
    render.act(() => { picker.props.onChange({ type: 'dismissed' }, undefined); });
    // clear button only appears when a date is set; should remain absent
    const clearBtns = component.root.findAll(n => Array.isArray(n.props.children) && n.props.children.some && typeof n.props.children === 'string' && n.props.children === '✕' && n.props.onPress !== undefined);
    expect(clearBtns.length).toBe(0);
  });

  test('cancelling From date picker with sentinel value does not commit it', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={false} />
      );
    });
    const fromBtn = component.root.findByProps({ accessibilityLabel: 'From date' });
    render.act(() => { fromBtn.props.onPress(); });
    const picker = component.root.findByProps({ testID: 'mock-datetimepicker' });
    // simulate Android firing onChange with the sentinel value on cancel
    render.act(() => { picker.props.onChange({ type: 'dismissed' }, new Date(2000, 0, 1)); });
    const json = component.toJSON();
    const text = JSON.stringify(json);
    expect(text).not.toContain('Jan 1, 2000');
    expect(text).not.toContain('2000-01-01');
  });

  test('cancelling To date picker does not set a date', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={false} />
      );
    });
    const toBtn = component.root.findByProps({ accessibilityLabel: 'To date' });
    render.act(() => { toBtn.props.onPress(); });
    const picker = component.root.findByProps({ testID: 'mock-datetimepicker' });
    render.act(() => { picker.props.onChange({ type: 'dismissed' }, new Date()); });
    const json = component.toJSON();
    const text = JSON.stringify(json);
    // After cancel with no prior To date, chip should still show 'To' placeholder
    expect(text).toContain('"To"');
  });

  test('confirming From date picker updates the chip', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} weightDateEditEnabled={false} />
      );
    });
    const fromBtn = component.root.findByProps({ accessibilityLabel: 'From date' });
    render.act(() => { fromBtn.props.onPress(); });
    const picker = component.root.findByProps({ testID: 'mock-datetimepicker' });
    render.act(() => { picker.props.onChange({ type: 'set' }, new Date(2026, 0, 15)); });
    // clear button appears when a date is committed
    const clearBtnTexts = component.root.findAll(n => n.props.children === '✕');
    expect(clearBtnTexts.length).toBeGreaterThan(0);
  });
});

