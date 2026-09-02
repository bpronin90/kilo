import React from 'react';
import render from 'react-test-renderer';
import { Alert, StyleSheet } from 'react-native';
import { WeightScreen } from '../screens/WeightScreen';
import { TrendSection } from '../components/WeightTrendSection';
import { buildTrendSections } from '../lib/WeightScreenHelpers';
import { LightColors } from '../theme/colors';
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

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
});

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
// Fake timers are installed per-test, not at module scope: a module-scope
// jest.useFakeTimers() contaminates React/react-test-renderer scheduler state
// during import-graph evaluation, which then leaks across Jest's shared worker
// into the next test file (#679).
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

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
      return true;
    });

    mockRemove = jest.fn().mockImplementation(async (id) => {
      currentEntries = currentEntries.filter(e => e.id !== id);
      useEntries.useWeightEntries.mockReturnValue(makeMockReturn());
    });

    useEntries.useWeightEntries.mockReturnValue(makeMockReturn());
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  });

  // WeightHistoryList is collapsed by default (#898); expand it once so a
  // row's content is on screen before searching for it.
  const expandHistoryIfCollapsed = (root) => {
    const expandBtn = root.findAll(
      n => n.props && n.props.accessibilityLabel === 'Expand history'
    )[0];
    if (expandBtn) render.act(() => { expandBtn.props.onPress(); });
  };

  // Walk up from each Text node containing `text` and return the first one
  // whose ancestor chain has a node with onPress. History rows only exist
  // once expanded, and the collapsed summary can itself contain a row's
  // weight text (e.g. "Latest: 185 lb") behind the header's own toggle
  // Pressable, so expansion always runs first rather than as a fallback —
  // otherwise a summary-text match would resolve to the collapse toggle
  // instead of the intended row.
  const findPressableByText = (root, text) => {
    expandHistoryIfCollapsed(root);
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

  const hasText = (root, text) => {
    const check = () => root.findAll(n => {
      if (n.type !== 'Text') return false;
      const flat = Array.isArray(n.props.children)
        ? n.props.children.join('')
        : String(n.props.children ?? '');
      return flat.includes(text);
    }).length > 0;
    if (check()) return true;
    expandHistoryIfCollapsed(root);
    return check();
  };

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

    // The note field is a secondary disclosure row (#897); its value is
    // discoverable in the collapsed row and editable once revealed.
    expect(hasText(root, 'Note · morning')).toBe(true);
    const noteToggle = root.findAllByProps({ testID: 'weight-edit-note-toggle' })
      .find(t => typeof t.props.onPress === 'function');
    render.act(() => {
      noteToggle.props.onPress();
    });
    const inputsAfterToggle = root.findAll(n => n.type === 'TextInput');
    expect(inputsAfterToggle[1].props.value).toBe('morning');
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

    // The date field defaults to today (unchanged) — an edit that never opens
    // the compact "Date · <value>" row still threads the entry's own date.
    expect(mockUpdate).toHaveBeenCalledWith('e1', 190, 'morning', '2026-05-24');
    // cancelEdit() triggers re-renders that pick up the updated entries
    expect(hasText(root, 'Editing entry')).toBe(false);
    expect(hasText(root, '190')).toBe(true);
    expect(hasText(root, '185 lb')).toBe(false);
  });

  // Issue #312 (relocated to a compact secondary row by #764): an edit threads
  // the corrected date through to update() and the refreshed row reflects the
  // new date. The full date control is absent from the default layout — the
  // compact "Date · <value>" row must be tapped first to reveal it.
  test('edit submit threads corrected date through update after revealing the compact date row', async () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen
          onSaveWeight={jest.fn()}
          errorMessage=""
          saving={false}
        />
      );
    });
    const root = component.root;

    // Enter editing mode for the existing 185 / 2026-05-24 entry
    const rowPressable = findPressableByText(root, '185');
    render.act(() => {
      rowPressable.props.onPress();
    });

    // The full date control is not on screen until the compact row is tapped.
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Entry date').length).toBe(0);

    const toggle = root.findAllByProps({ testID: 'weight-edit-date-toggle' })
      .find(t => typeof t.props.onPress === 'function');
    render.act(() => {
      toggle.props.onPress();
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

  // #764: tapping the compact "Date · <value>" row reveals the full date
  // control, and tapping "Done" (or the row again) collapses it safely
  // without discarding the weight/note the user already entered.
  test('the compact date row reveals and collapses the full date control without losing other edits', () => {
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

    const inputs = root.findAll(n => n.type === 'TextInput');
    render.act(() => {
      inputs[0].props.onChangeText('190');
    });

    const toggle = root.findAllByProps({ testID: 'weight-edit-date-toggle' })
      .find(t => typeof t.props.onPress === 'function');
    render.act(() => { toggle.props.onPress(); });
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Entry date').length).toBeGreaterThan(0);

    const doneBtn = root.findByProps({ accessibilityLabel: 'Done changing entry date' });
    render.act(() => { doneBtn.props.onPress(); });
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Entry date').length).toBe(0);

    // The weight edit made while the date row was open is preserved.
    const inputsAfter = root.findAll(n => n.type === 'TextInput');
    expect(inputsAfter[0].props.value).toBe('190');
  });

  // #897: a same-day weigh-in must require interaction only with the weight
  // field and Save weigh-in. Note and Date are secondary disclosure rows,
  // collapsed by default, with no full-size control on screen until tapped.
  test('a new-entry weigh-in shows only the weight field and Save by default, with Note/Date collapsed', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    // The weight TextInput is on screen; the Note field is not rendered
    // until its disclosure row is tapped.
    expect(root.findByProps({ placeholder: '185.0' })).toBeTruthy();
    expect(root.findAll(n => n.props && n.props.placeholder === 'Morning, fasted').length).toBe(0);
    expect(findPressableByText(root, 'Save weigh-in')).toBeTruthy();

    // Both secondary controls are present but collapsed, discoverable via
    // their compact rows.
    expect(hasText(root, 'Note · None')).toBe(true);
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Note').length).toBe(0);
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Weigh-in date').length).toBe(0);

    // Tapping the Note row reveals the field and does not disturb the date row.
    const noteToggle = root.findAllByProps({ testID: 'weight-new-note-toggle' })
      .find(t => typeof t.props.onPress === 'function');
    render.act(() => { noteToggle.props.onPress(); });
    const noteInput = root.findByProps({ accessibilityLabel: 'Note' });
    render.act(() => { noteInput.props.onChangeText('morning'); });
    expect(hasText(root, 'Note · morning')).toBe(true);

    const doneBtn = root.findByProps({ accessibilityLabel: 'Done adding note' });
    render.act(() => { doneBtn.props.onPress(); });
    expect(hasText(root, 'Note · morning')).toBe(true);
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Note').length).toBe(0);
  });

  // Issue #596 (review follow-up): a rapid double-press on "Save weigh-in"
  // while the first onSaveWeight() call is still in flight must not fire a
  // second write. Exercises the same submit handler / in-flight ref guard as
  // the edit-path duplicate-press test above, for the add path.
  test('rapid double-press on Save weigh-in during an in-flight save fires only one write', async () => {
    let resolveSave;
    const mockOnSaveWeight = jest.fn(() => new Promise((resolve) => {
      resolveSave = () => resolve(true);
    }));

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={mockOnSaveWeight} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    const inputs = root.findAll(n => n.type === 'TextInput');
    render.act(() => {
      inputs[0].props.onChangeText('190');
    });

    const saveBtn = findPressableByText(root, 'Save weigh-in');
    expect(saveBtn).toBeTruthy();
    // First press starts the in-flight save; a synchronous second press
    // (before the pending promise resolves) simulates a rapid double-tap.
    render.act(() => {
      saveBtn.props.onPress();
      saveBtn.props.onPress();
    });

    expect(mockOnSaveWeight).toHaveBeenCalledTimes(1);

    await render.act(async () => {
      resolveSave();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockOnSaveWeight).toHaveBeenCalledTimes(1);
  });

  // Feedback follow-up on #764 (finding 1, P1): WeightScreen stays mounted
  // under `display: none` across tab switches, so the new-entry date state
  // seeded at mount can go stale past local midnight. A default (never
  // explicitly picked) weigh-in must call onSaveWeight with undefined so
  // App.saveWeight recomputes localToday at submission time, rather than
  // threading the possibly-stale date captured earlier — this preserves the
  // "default-today" semantics the issue's own acceptance criteria require.
  test('an untouched new-entry save calls onSaveWeight with no explicit date, even though the compact date row shows a value', async () => {
    const mockOnSaveWeight = jest.fn(() => Promise.resolve(true));

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={mockOnSaveWeight} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    const inputs = root.findAll(n => n.type === 'TextInput');
    render.act(() => {
      inputs[0].props.onChangeText('190');
    });

    // The compact "Date · <value>" row is present (showing today's date) but
    // never tapped — the user never explicitly picked a date.
    const saveBtn = findPressableByText(root, 'Save weigh-in');
    await render.act(async () => {
      saveBtn.props.onPress();
    });

    expect(mockOnSaveWeight).toHaveBeenCalledWith(undefined);
  });

  // Companion case: once the user reveals the row and explicitly picks a
  // historical date, that choice must still be threaded through as before.
  test('an explicitly picked new-entry date is still passed to onSaveWeight', async () => {
    const mockOnSaveWeight = jest.fn(() => Promise.resolve(true));

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={mockOnSaveWeight} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    render.act(() => {
      root.findAll(n => n.type === 'TextInput')[0].props.onChangeText('190');
    });

    const toggle = root.findAllByProps({ testID: 'weight-new-date-toggle' })
      .find(t => typeof t.props.onPress === 'function');
    render.act(() => { toggle.props.onPress(); });
    const dateBtn = root.findByProps({ accessibilityLabel: 'Weigh-in date' });
    render.act(() => {
      dateBtn.props.onPress();
    });
    const picker = root.findByProps({ testID: 'mock-datetimepicker' });
    render.act(() => {
      picker.props.onChange({}, new Date(2026, 4, 25));
    });

    const saveBtn = findPressableByText(root, 'Save weigh-in');
    await render.act(async () => {
      saveBtn.props.onPress();
    });

    expect(mockOnSaveWeight).toHaveBeenCalledWith('2026-05-25');
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

  // Issue #596: a false return from update() (e.g. the record was not found)
  // must not silently close the edit — it should surface retryable copy and
  // keep the entered values in the form.
  test('edit submit shows retryable error and stays open when update() resolves false', async () => {
    mockUpdate.mockImplementation(async () => false);

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

    const inputs = root.findAll(n => n.type === 'TextInput');
    render.act(() => {
      inputs[0].props.onChangeText('190');
    });

    const updateBtn = findPressableByText(root, 'Update entry');
    await render.act(async () => {
      await updateBtn.props.onPress();
    });

    expect(mockUpdate).toHaveBeenCalledWith('e1', 190, 'morning', '2026-05-24');
    expect(hasText(root, 'Editing entry')).toBe(true);
    const inputsAfter = root.findAll(n => n.type === 'TextInput');
    expect(inputsAfter[0].props.value).toBe('190');
    expect(hasText(root, 'Could not update weight entry. Please try again.')).toBe(true);
  });

  // Issue #596: a thrown rejection from update() (e.g. a storage failure) must
  // be caught, surfaced as retryable copy, and must not close the edit either.
  test('edit submit shows retryable error and stays open when update() rejects', async () => {
    mockUpdate.mockImplementation(async () => {
      throw new Error('storage write failed');
    });

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

    const inputs = root.findAll(n => n.type === 'TextInput');
    render.act(() => {
      inputs[0].props.onChangeText('190');
    });

    const updateBtn = findPressableByText(root, 'Update entry');
    await render.act(async () => {
      await updateBtn.props.onPress();
    });

    expect(mockUpdate).toHaveBeenCalledWith('e1', 190, 'morning', '2026-05-24');
    expect(hasText(root, 'Editing entry')).toBe(true);
    const inputsAfter = root.findAll(n => n.type === 'TextInput');
    expect(inputsAfter[0].props.value).toBe('190');
    expect(hasText(root, 'Could not update weight entry. Please try again.')).toBe(true);
  });

  // Issue #596 (review follow-up): a rapid double-press on "Update entry"
  // while the first update() call is still in flight must not fire a second
  // write. The submit handler's synchronous in-flight ref should swallow the
  // second press until the first attempt settles.
  test('rapid double-press on Update entry during an in-flight update() fires only one write', async () => {
    let resolveUpdate;
    mockUpdate.mockImplementation(() => new Promise((resolve) => {
      resolveUpdate = () => resolve(true);
    }));

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

    const inputs = root.findAll(n => n.type === 'TextInput');
    render.act(() => {
      inputs[0].props.onChangeText('190');
    });

    const updateBtn = findPressableByText(root, 'Update entry');
    // First press starts the in-flight update; a synchronous second press
    // (before the pending promise resolves) simulates a rapid double-tap.
    render.act(() => {
      updateBtn.props.onPress();
      updateBtn.props.onPress();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Let the in-flight update settle and confirm the guard released so a
    // subsequent, distinct submit still works normally.
    await render.act(async () => {
      resolveUpdate();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
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

  test('goal-derived guidance is inlined into the goal card (no separate Guidance card)', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    // Guidance content now lives inside the goal card, not a standalone "Guidance" card.
    expect(hasText(root, 'Guidance')).toBe(false);
    expect(hasText(root, 'Target pace')).toBe(true);
  });

  test('goal card shows remaining distance to target', () => {
    // entry 185 lb vs target 175 lb -> 10.0 lb to go
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    expect(hasText(root, '10.0 lb')).toBe(true);
    expect(hasText(root, 'to go')).toBe(true);
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
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    // Reveal the full date control from the compact "Date · <value>" row,
    // then open the date picker.
    const toggle = root.findAllByProps({ testID: 'weight-new-date-toggle' })
      .find(t => typeof t.props.onPress === 'function');
    render.act(() => { toggle.props.onPress(); });
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

  // Issue #596: a thrown rejection from add() (e.g. a storage failure) must be
  // caught, surface retryable copy via errorMessage, and preserve the entered
  // value/note so the user does not lose their input.
  test('shows retryable error and preserves entered value when add() rejects', async () => {
    mockAdd.mockImplementation(async () => {
      throw new Error('storage write failed');
    });

    let component;
    render.act(() => {
      component = render.create(<App />);
    });
    const root = component.root;
    let weightScreen = root.findByType(WeightScreen);

    render.act(() => {
      weightScreen.props.setWeightValue('185');
      weightScreen.props.setWeightNote('morning');
    });

    let result;
    await render.act(async () => {
      result = await weightScreen.props.onSaveWeight();
    });

    expect(result).toBe(false);
    expect(mockAdd).toHaveBeenCalled();
    weightScreen = root.findByType(WeightScreen);
    expect(weightScreen.props.errorMessage).toBe('Could not save weight entry. Please try again.');
    expect(weightScreen.props.weightValue).toBe('185');
    expect(weightScreen.props.weightNote).toBe('morning');
  });

  // Issue #596 (review follow-up): a false-returning add() (e.g. a rejected
  // mutation that resolves rather than throws) must be treated as failure too,
  // not silently reported as success — surface retryable copy and preserve the
  // entered value/note.
  test('shows retryable error and preserves entered value when add() resolves false', async () => {
    mockAdd.mockImplementation(async () => false);

    let component;
    render.act(() => {
      component = render.create(<App />);
    });
    const root = component.root;
    let weightScreen = root.findByType(WeightScreen);

    render.act(() => {
      weightScreen.props.setWeightValue('185');
      weightScreen.props.setWeightNote('morning');
    });

    let result;
    await render.act(async () => {
      result = await weightScreen.props.onSaveWeight();
    });

    expect(result).toBe(false);
    expect(mockAdd).toHaveBeenCalled();
    weightScreen = root.findByType(WeightScreen);
    expect(weightScreen.props.errorMessage).toBe('Could not save weight entry. Please try again.');
    expect(weightScreen.props.weightValue).toBe('185');
    expect(weightScreen.props.weightNote).toBe('morning');
  });

  // Issue #596 (review follow-up): the cloud adapter's saveWeightEntry writes
  // the raw row BEFORE enqueueDirty(), so a thrown/false result can follow a
  // write that already partially landed. A naive retry that calls
  // makeWeightEntry() again would mint a new id and duplicate the row. This
  // models that exact sequence — first attempt persists a raw row then
  // rejects, a distinct later retry follows — and proves the retry reuses the
  // same id (upserting, per cloudDomainMethods.saveWeightEntry's
  // findIndex-based overwrite) so only one logical row results.
  test('retry after a partial-write rejection reuses the failed id instead of duplicating the row', async () => {
    let store = [];
    let callCount = 0;
    mockAdd.mockImplementation(async (entry) => {
      callCount += 1;
      if (callCount === 1) {
        // Simulate the cloud partial write: the raw row persists before the
        // (mocked) enqueueDirty() rejects.
        store.push(entry);
        throw new Error('enqueue failed');
      }
      // Retry: upsert by id, mirroring the real adapter's findIndex-based
      // overwrite instead of blindly pushing a second row.
      const idx = store.findIndex((e) => e.id === entry.id);
      if (idx >= 0) store[idx] = entry;
      else store.push(entry);
    });

    let component;
    render.act(() => {
      component = render.create(<App />);
    });
    const root = component.root;
    let weightScreen = root.findByType(WeightScreen);

    render.act(() => {
      weightScreen.props.setWeightValue('185');
    });

    let firstResult;
    await render.act(async () => {
      firstResult = await weightScreen.props.onSaveWeight();
    });

    expect(firstResult).toBe(false);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const firstEntryId = mockAdd.mock.calls[0][0].id;
    expect(store).toHaveLength(1);
    expect(store[0].id).toBe(firstEntryId);

    // Distinct later retry (not a same-flight double-press): the user sees
    // the error, the value/note are still intact, and presses save again.
    weightScreen = root.findByType(WeightScreen);
    expect(weightScreen.props.weightValue).toBe('185');

    let secondResult;
    await render.act(async () => {
      secondResult = await weightScreen.props.onSaveWeight();
    });

    expect(secondResult).toBe(true);
    expect(mockAdd).toHaveBeenCalledTimes(2);
    const secondEntryId = mockAdd.mock.calls[1][0].id;
    expect(secondEntryId).toBe(firstEntryId);
    expect(store).toHaveLength(1);
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

  test('renders a DOM date input instead of the native picker for new entries, once the compact date row is revealed', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    // The full date control (and its DOM input) is absent from the default
    // high-frequency layout until the compact "Date · <value>" row is tapped.
    expect(root.findAll(
      n => n.type === 'input' && n.props.type === 'date' && n.props['aria-label'] === 'Weigh-in date'
    ).length).toBe(0);

    const toggle = root.findAllByProps({ testID: 'weight-new-date-toggle' })
      .find(t => typeof t.props.onPress === 'function');
    render.act(() => { toggle.props.onPress(); });

    // Match the new-entry input specifically by its aria-label; the goal form
    // also renders a web date input ("Goal target date") when no goal is set.
    const dateInputs = root.findAll(
      n => n.type === 'input' && n.props.type === 'date' && n.props['aria-label'] === 'Weigh-in date'
    );
    expect(dateInputs.length).toBe(1);
    // The native picker must NOT be mounted on web.
    expect(root.findAll(n => n.props && n.props.testID === 'mock-datetimepicker').length).toBe(0);
  });

  test('changing the DOM date input updates the new-entry date value', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    const toggle = root.findAllByProps({ testID: 'weight-new-date-toggle' })
      .find(t => typeof t.props.onPress === 'function');
    render.act(() => { toggle.props.onPress(); });
    const dateInput = root.find(
      n => n.type === 'input' && n.props.type === 'date' && n.props['aria-label'] === 'Weigh-in date'
    );
    render.act(() => {
      dateInput.props.onChange({ target: { value: '2026-05-20' } });
    });
    const updated = root.find(
      n => n.type === 'input' && n.props.type === 'date' && n.props['aria-label'] === 'Weigh-in date'
    );
    expect(updated.props.value).toBe('2026-05-20');
  });
});

// ── Goal form web date fallback (#404) ────────────────────────────────────────
// The goal "By Date" field previously had no web fallback; on web the native
// DateTimePicker does not render. On web it must render a real DOM
// <input type="date"> that writes the chosen YYYY-MM-DD back to the goal target
// date. Native keeps the Pressable + picker path.
describe('WeightGoalCard goal date web fallback (#404)', () => {
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
    // No active goal → the goal form (with the "By Date" field) is shown.
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  });

  test('renders a DOM date input for the goal target date instead of the native picker', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    const dateInputs = root.findAll(n => n.type === 'input' && n.props.type === 'date');
    expect(dateInputs.length).toBe(1);
    // The native picker must NOT be mounted on web.
    expect(root.findAll(n => n.props && n.props.testID === 'mock-datetimepicker').length).toBe(0);
  });

  test('changing the DOM goal date input updates the goal target date value', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    const dateInput = root.find(n => n.type === 'input' && n.props.type === 'date');
    render.act(() => {
      dateInput.props.onChange({ target: { value: '2026-12-25' } });
    });
    const updated = root.find(n => n.type === 'input' && n.props.type === 'date');
    expect(updated.props.value).toBe('2026-12-25');
  });
});

// ── History date filter chip touch targets (#404) ─────────────────────────────
// The From/To date filter chips are visually compact; they expose an enlarged
// hitSlop so the effective touch target meets the 44px minimum without changing
// their visual size.
describe('WeightHistoryList date filter chip touch targets (#404)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  });

  test('From and To date chips expose an enlarged hitSlop', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    // #411 option B: reveal the From/To controls via the header filter icon.
    const filterBtn = root.findByProps({ accessibilityLabel: 'Filter by date range' });
    render.act(() => { filterBtn.props.onPress(); });
    const fromBtn = root.findByProps({ accessibilityLabel: 'From date' });
    const toBtn = root.findByProps({ accessibilityLabel: 'To date' });
    expect(fromBtn.props.hitSlop).toBe(12);
    expect(toBtn.props.hitSlop).toBe(12);
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

  // #898: the panel now opens collapsed to a latest/count summary so a
  // growing history doesn't dominate the daily Weight surface by default.
  test('toggle button shows expand-less when history is collapsed (default)', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const toggleBtn = component.root.findByProps({ accessibilityLabel: 'Expand history' });
    expect(toggleBtn).toBeTruthy();
  });

  test('toggle button shows Collapse history label after expanding', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const toggleBtn = component.root.findByProps({ accessibilityLabel: 'Expand history' });
    render.act(() => { toggleBtn.props.onPress(); });
    const collapseBtn = component.root.findByProps({ accessibilityLabel: 'Collapse history' });
    expect(collapseBtn).toBeTruthy();
  });

  test('collapsed default shows a latest/count summary instead of the row', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    const flat = JSON.stringify(component.toJSON());
    expect(flat).toContain('1 entry');
    expect(flat).toContain('Latest:');
    expect(flat).toContain('185');
    // The full row grid (with its per-row delete affordance) is not mapped
    // in the collapsed default.
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Delete weight entry').length).toBe(0);
  });

  test('an empty history shows a "0 entries" summary in the collapsed default', () => {
    useEntries.useWeightEntries.mockReturnValue({ entries: [], remove: jest.fn(), update: jest.fn() });
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    expect(JSON.stringify(component.toJSON())).toContain('0 entries');
  });

  // #898 44dp verification: the collapsed header is the sole tap target for a
  // brand-new account (0 entries), so it must itself clear the 44dp minimum
  // rather than relying on multi-line summary content to pad it out.
  test('the collapsed header toggle meets the 44dp minimum touch target even with 0 entries', () => {
    useEntries.useWeightEntries.mockReturnValue({ entries: [], remove: jest.fn(), update: jest.fn() });
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const toggle = component.root.findByProps({ accessibilityLabel: 'Expand history' });
    const flat = StyleSheet.flatten(toggle.props.style);
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
  });

  // #898 large-text verification: the collapsed summary and "Show more"
  // control must not opt out of the OS text-scaling that large-text settings
  // rely on.
  test('collapsed summary and Show more text scale with the OS large-text setting', () => {
    const manyEntries = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      date: `2026-0${(i % 9) + 1}-01`,
      logged_at: `2026-0${(i % 9) + 1}-01T08:00:00Z`,
      weight_value: 180 + i,
      note: '',
    }));
    useEntries.useWeightEntries.mockReturnValue({ entries: manyEntries, remove: jest.fn(), update: jest.fn() });
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    const summaryText = root.findByProps({ accessibilityLabel: 'Expand history' })
      .findAllByType('Text')[0];
    expect(summaryText.props.allowFontScaling).not.toBe(false);

    render.act(() => {
      root.findByProps({ accessibilityLabel: 'Expand history' }).props.onPress();
    });
    const showMoreBtn = root.findByProps({ testID: 'weight-history-show-more' });
    const showMoreText = showMoreBtn.findByType('Text');
    expect(showMoreText.props.allowFontScaling).not.toBe(false);
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

  test('cancelling From date picker preserves placeholder, does not commit sentinel', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const filterBtn1 = component.root.findByProps({ accessibilityLabel: 'Filter by date range' });
    render.act(() => { filterBtn1.props.onPress(); });
    const fromBtn = component.root.findByProps({ accessibilityLabel: 'From date' });
    render.act(() => { fromBtn.props.onPress(); });
    const picker = component.root.findByProps({ testID: 'mock-datetimepicker' });
    // simulate Android firing onChange with the sentinel value on cancel
    render.act(() => { picker.props.onChange({ type: 'dismissed' }, new Date(2000, 0, 1)); });
    const text = JSON.stringify(component.toJSON());
    expect(text).not.toContain('01-01-2000');
    expect(text).toContain('"From"');
  });

  test('cancelling To date picker does not set a date', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const filterBtn2 = component.root.findByProps({ accessibilityLabel: 'Filter by date range' });
    render.act(() => { filterBtn2.props.onPress(); });
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
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const filterBtn3 = component.root.findByProps({ accessibilityLabel: 'Filter by date range' });
    render.act(() => { filterBtn3.props.onPress(); });
    const fromBtn = component.root.findByProps({ accessibilityLabel: 'From date' });
    render.act(() => { fromBtn.props.onPress(); });
    const picker = component.root.findByProps({ testID: 'mock-datetimepicker' });
    render.act(() => { picker.props.onChange({ type: 'set' }, new Date(2026, 0, 15)); });
    // clear button appears when a date is committed
    const clearBtnTexts = component.root.findAll(n => n.props.children === '✕');
    expect(clearBtnTexts.length).toBeGreaterThan(0);
  });
});

// ── Trend section semantics, colors, alignment (#406) ─────────────────────────
describe('Trends section label rename (#406, M-5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntries.useUserProfile = jest.fn().mockReturnValue(null);
  });

  test('first trend section is titled "Today", not the misleading "Pace"', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;

    const exactText = (label) =>
      root.findAll(n => n.type === 'Text' && String(n.props.children ?? '').trim() === label);

    expect(exactText('Today').length).toBeGreaterThan(0);
    // The section header should no longer read "Pace".
    expect(exactText('Pace').length).toBe(0);
  });
});

// The Weight tab's Trends card is a summary; the full weight history lives in
// Analytics. This link carries the user there instead of making them re-find the
// weight section by tab (#717).
describe('WeightScreen "See full trends" handoff (#717)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY],
      remove: jest.fn(),
      update: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntries.useUserProfile = jest.fn().mockReturnValue(null);
  });

  const renderWithNavigate = (onNavigate) => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen
          onSaveWeight={jest.fn()}
          errorMessage=""
          saving={false}
          onNavigate={onNavigate}
        />
      );
    });
    return component.root.findByProps({ testID: 'weight-see-full-trends' });
  };

  test('the link targets the Analytics weight section and is reusable', () => {
    const onNavigate = jest.fn();
    const link = renderWithNavigate(onNavigate);

    render.act(() => { link.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'weight');

    render.act(() => { link.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'Analytics', 'weight');
  });

  test('the link is an accessible button whose label matches its visible text', () => {
    const link = renderWithNavigate(jest.fn());
    expect(link.props.accessibilityRole).toBe('button');
    expect(link.props.accessibilityLabel).toBe('See full trends');

    const labels = link.findAllByType('Text').map(t => String(t.props.children ?? '').trim());
    expect(labels).toContain('See full trends');
  });

  test('the link declares a >=44pt target and owns its press region', () => {
    // Structural guard only; react-test-renderer runs no layout. Rendered
    // validation at 320/375/448dp with enlarged text is in artifacts/717-d4/.
    const link = renderWithNavigate(jest.fn());
    const style = [].concat(link.props.style ?? []).reduce(
      (acc, s) => (s ? Object.assign(acc, s) : acc),
      {}
    );

    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(link.props.hitSlop).not.toBeUndefined();
    // No fixed height, so a scaled-up label grows rather than clipping.
    expect(style.height).toBeUndefined();
    expect(link.findAll(n => n !== link && typeof n.props?.onPress === 'function')).toHaveLength(0);
  });

  test('without a navigation handler the link is inert rather than throwing', () => {
    const link = renderWithNavigate(undefined);
    expect(() => render.act(() => { link.props.onPress(); })).not.toThrow();
  });
});

describe('TrendSection goal-direction aware colors (#406, H-3)', () => {
  const renderSection = (props) => {
    let component;
    render.act(() => {
      component = render.create(
        <TrendSection
          title="7-day rolling"
          col1={{ label: 'Average', value: '184.0 lb' }}
          col2={{ label: 'Vs Prior 7d', value: '+1.0 lb' }}
          col3={{ label: 'Trend', value: '↑ Gaining' }}
          isLast
          {...props}
        />
      );
    });
    return component.root;
  };

  // Flatten the col3 value style and return its resolved color.
  const col3Color = (root, value) => {
    const node = root.findAll(
      n => n.type === 'Text' && String(n.props.children ?? '').trim() === value.trim()
    )[0];
    return StyleSheet.flatten(node.props.style).color;
  };

  test('upward trend is success (green) for a gain goal', () => {
    const root = renderSection({ goalDirection: 'gain', col3: { label: 'Trend', value: '↑ Gaining' } });
    expect(col3Color(root, '↑ Gaining')).toBe(LightColors.success);
  });

  test('upward trend is error (red) for a loss goal', () => {
    const root = renderSection({ goalDirection: 'loss', col3: { label: 'Trend', value: '↑ Gaining' } });
    expect(col3Color(root, '↑ Gaining')).toBe(LightColors.error);
  });

  test('downward trend is success (green) for a loss goal', () => {
    const root = renderSection({ goalDirection: 'loss', col3: { label: 'Trend', value: '↓ Losing' } });
    expect(col3Color(root, '↓ Losing')).toBe(LightColors.success);
  });

  test('downward trend is error (red) for a gain goal', () => {
    const root = renderSection({ goalDirection: 'gain', col3: { label: 'Trend', value: '↓ Losing' } });
    expect(col3Color(root, '↓ Losing')).toBe(LightColors.error);
  });

  // #408: with no active goal the goal-relative meaning is absent, but ↑/↓ keep
  // a visible directional cue (gaining = error tone, losing = success tone)
  // rather than falling back to flat neutral text.
  test('with no goal direction ↑ Gaining keeps a visible directional color (#408)', () => {
    const root = renderSection({ col3: { label: 'Trend', value: '↑ Gaining' } });
    const color = col3Color(root, '↑ Gaining');
    expect(color).toBe(LightColors.error);
    expect(color).not.toBe(LightColors.text);
  });

  test('with no goal direction ↓ Losing keeps a visible directional color (#408)', () => {
    const root = renderSection({ col3: { label: 'Trend', value: '↓ Losing' } });
    const color = col3Color(root, '↓ Losing');
    expect(color).toBe(LightColors.success);
    expect(color).not.toBe(LightColors.text);
  });

  test('with no goal direction → Stable stays neutral (#408)', () => {
    const root = renderSection({ col3: { label: 'Trend', value: '→ Stable' } });
    const color = col3Color(root, '→ Stable');
    expect(color).toBe(LightColors.text);
    expect(color).not.toBe(LightColors.success);
    expect(color).not.toBe(LightColors.error);
  });

  test('pace anomaly keeps its severity color regardless of goal direction', () => {
    const root = renderSection({
      goalDirection: 'gain',
      paceLevel: 'spike',
      col3: { label: 'Trend', value: '↑ Gaining' },
    });
    expect(col3Color(root, '↑ Gaining')).toBe(LightColors.error);
  });

  test('col3 value is right-aligned for stable scanning (M-8)', () => {
    const root = renderSection({ col3: { label: 'Trend', value: '→ Stable' } });
    const node = root.findAll(
      n => n.type === 'Text' && String(n.props.children ?? '').trim() === '→ Stable'
    )[0];
    expect(StyleSheet.flatten(node.props.style).textAlign).toBe('right');
  });
});

// ── Android Back ownership (#527): the shell holds one back-consumer slot;
// the weight-goal form must claim it through registerBackConsumer (not
// BackHandler directly) and only while the Weight tab is active, so a
// hidden goal edit cannot outrace the visible tab after a tab switch.
describe('Android Back routes weight-goal edit through registerBackConsumer, gated by isActive (#527)', () => {
  const GOAL = { target_weight: 170, target_date: '2026-07-01', start_weight: 190 };

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

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightEntries.mockReturnValue({ entries: [{ ...ENTRY }], remove: jest.fn(), update: jest.fn() });
    useEntries.useWeightGoal.mockReturnValue({ goal: GOAL, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  });

  test('registers a back consumer while editing on the active Weight tab and unregisters when it becomes inactive', () => {
    let unregister;
    const registerBackConsumer = jest.fn(() => {
      unregister = jest.fn();
      return unregister;
    });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });
    render.act(() => { findPressableByText(component.root, 'Edit').props.onPress(); });
    expect(registerBackConsumer).toHaveBeenCalledTimes(1);

    render.act(() => {
      component.update(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} isActive={false} registerBackConsumer={registerBackConsumer} />
      );
    });
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  test('does not register a back consumer while editing on an inactive Weight tab', () => {
    const registerBackConsumer = jest.fn(() => jest.fn());
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} isActive={false} registerBackConsumer={registerBackConsumer} />
      );
    });
    render.act(() => { findPressableByText(component.root, 'Edit').props.onPress(); });
    expect(registerBackConsumer).not.toHaveBeenCalled();
  });

  test('does not register a back consumer with no active goal edit, letting the shell fall back to Home', () => {
    const registerBackConsumer = jest.fn(() => jest.fn());
    render.act(() => {
      render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });
    expect(registerBackConsumer).not.toHaveBeenCalled();
  });

  test('the registered consumer cancels the goal edit and consumes Back', () => {
    let capturedConsumer;
    const registerBackConsumer = jest.fn((consumer) => {
      capturedConsumer = consumer;
      return jest.fn();
    });

    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} isActive={true} registerBackConsumer={registerBackConsumer} />
      );
    });
    const root = component.root;
    render.act(() => { findPressableByText(root, 'Edit').props.onPress(); });
    expect(findPressableByText(root, 'Save goal')).toBeTruthy();

    let handled;
    render.act(() => { handled = capturedConsumer(); });

    expect(handled).toBe(true);
    expect(findPressableByText(root, 'Save goal')).toBeNull();
  });
});


// ── honest first-paint and failed-read states (#737) ──────────────────────────
//
// The weigh-in form is never gated — logging has to stay available the moment
// the tab opens — but Goal / Trends / Weight History are derived from `entries`
// and `goal`, and before this they rendered a confident "no weigh-ins, no goal"
// answer while those reads were still in flight or after they had failed.
describe('Weight loading and failure states (#737)', () => {
  const mount = () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    return component;
  };
  const has = (component, testID) => component.root.findAll(n => n.props?.testID === testID).length > 0;
  const hasText = (component, needle) => component.root.findAll(
    n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(needle)
  ).length > 0;

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useWeightGoal.mockReturnValue({ goal: null, loading: false, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntries.useUserProfile = jest.fn().mockReturnValue(null);
  });

  test('an unresolved first read paints a placeholder while the form stays usable', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [], loading: true, error: null, remove: jest.fn(), update: jest.fn(), refresh: jest.fn(),
    });
    const component = mount();

    expect(has(component, 'weight-skeleton')).toBe(true);
    const skeleton = component.root.find(n => n.props?.testID === 'weight-skeleton');
    expect(skeleton.props.accessibilityLabel).toBe('Loading your weight history');
    // The derived sections are withheld, not faked.
    expect(hasText(component, 'Weight History')).toBe(false);
    // The entry form is untouched: logging never waits on history.
    expect(hasText(component, 'Save weigh-in')).toBe(true);
  });

  test('an unresolved goal read also holds the derived sections', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY], loading: false, error: null, remove: jest.fn(), update: jest.fn(), refresh: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, loading: true, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    const component = mount();

    expect(has(component, 'weight-skeleton')).toBe(true);
  });

  test('a refresh over already-loaded entries does not flip back to a placeholder', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY], loading: true, error: null, remove: jest.fn(), update: jest.fn(), refresh: jest.fn(),
    });
    const component = mount();

    expect(has(component, 'weight-skeleton')).toBe(false);
    expect(hasText(component, 'Weight History')).toBe(true);
  });

  test('a failed read shows the retry banner and withholds the derived sections', () => {
    const refresh = jest.fn();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [], loading: false, error: new Error('read failed'), remove: jest.fn(), update: jest.fn(), refresh,
    });
    const component = mount();

    expect(hasText(component, 'Could not load weight entries.')).toBe(true);
    // Never "0 weigh-ins" as if that were a verified answer.
    expect(hasText(component, 'Weight History')).toBe(false);
    expect(has(component, 'weight-skeleton')).toBe(false);

    const retry = component.root.find(
      n => typeof n.props?.onPress === 'function'
        && n.findAll(c => c.type === 'Text' && String(c.props.children ?? '') === 'Retry').length > 0
    );
    render.act(() => { retry.props.onPress(); });
    expect(refresh).toHaveBeenCalled();
  });

  test('a verified read renders the derived sections as before', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY], loading: false, error: null, remove: jest.fn(), update: jest.fn(), refresh: jest.fn(),
    });
    const component = mount();

    expect(has(component, 'weight-skeleton')).toBe(false);
    expect(hasText(component, 'Weight History')).toBe(true);
    expect(hasText(component, 'Trends')).toBe(true);
  });
});

// ── goal-read failure (#737 review) ───────────────────────────────────────────
//
// `useWeightGoal()` previously had no `.catch`: a rejected `loadWeightGoal()`
// left `goal` null with `loading` already cleared, so Weight rendered
// Goal/Trends/History as though "no goal set" were a verified answer — and the
// rejection went unhandled. The hook now carries the failure across the
// hook/screen boundary the same way useWeightEntries and useTrackedLifts do.
describe('Weight goal-read failure (#737 review)', () => {
  const mount = () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    return component;
  };
  const has = (component, testID) => component.root.findAll(n => n.props?.testID === testID).length > 0;
  const hasText = (component, needle) => component.root.findAll(
    n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(needle)
  ).length > 0;
  const retryFor = (component, message) => {
    const candidates = component.root.findAll(
      n => typeof n.type === 'string'
        && n.findAll(c => c.type === 'Text' && String(c.props.children ?? '').includes(message)).length > 0
        && n.findAll(c => typeof c.props?.onPress === 'function').length > 0
    );
    const banner = candidates[candidates.length - 1];
    const presses = banner.findAll(n => typeof n.props?.onPress === 'function');
    return presses[presses.length - 1];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useUserProfile = jest.fn().mockReturnValue(null);
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY], loading: false, error: null, remove: jest.fn(), update: jest.fn(), refresh: jest.fn(),
    });
  });

  test('a failed goal read is named and retryable, and never reads as "no goal set"', () => {
    const refreshGoal = jest.fn();
    useEntries.useWeightGoal.mockReturnValue({
      goal: null, loading: false, error: new Error('goal read failed'), refresh: refreshGoal,
      save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(),
    });
    const component = mount();

    expect(hasText(component, 'Could not load your weight goal.')).toBe(true);
    // The derived block is withheld rather than presented as a verified answer.
    expect(hasText(component, 'Goal')).toBe(false);
    expect(hasText(component, 'Weight History')).toBe(false);
    expect(has(component, 'weight-skeleton')).toBe(false);
    // The weigh-in form is untouched: a goal read has nothing to do with logging.
    expect(hasText(component, 'Save weigh-in')).toBe(true);

    render.act(() => { retryFor(component, 'Could not load your weight goal.').props.onPress(); });
    expect(refreshGoal).toHaveBeenCalled();
  });

  test('the two reads fail independently and each retries only its own source', () => {
    const refreshGoal = jest.fn();
    const refreshEntries = jest.fn();
    useEntries.useWeightEntries.mockReturnValue({
      entries: [], loading: false, error: new Error('entries read failed'),
      remove: jest.fn(), update: jest.fn(), refresh: refreshEntries,
    });
    useEntries.useWeightGoal.mockReturnValue({
      goal: null, loading: false, error: new Error('goal read failed'), refresh: refreshGoal,
      save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(),
    });
    const component = mount();

    expect(hasText(component, 'Could not load weight entries.')).toBe(true);
    expect(hasText(component, 'Could not load your weight goal.')).toBe(true);

    render.act(() => { retryFor(component, 'Could not load your weight goal.').props.onPress(); });
    expect(refreshGoal).toHaveBeenCalledTimes(1);
    expect(refreshEntries).not.toHaveBeenCalled();
  });

  test('a failed goal read that still has a cached goal keeps rendering it under the banner', () => {
    useEntries.useWeightGoal.mockReturnValue({
      goal: { target_weight: 180, target_date: '2026-12-01', start_weight: 200, start_date: '2026-01-01' },
      loading: false, error: new Error('refresh failed'), refresh: jest.fn(),
      save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(),
    });
    const component = mount();

    expect(hasText(component, 'Could not load your weight goal.')).toBe(true);
    // Stale but true beats withholding data the screen actually has.
    expect(hasText(component, 'Weight History')).toBe(true);
  });

  test('a clean goal read renders the derived sections with no banner', () => {
    useEntries.useWeightGoal.mockReturnValue({
      goal: null, loading: false, error: null, refresh: jest.fn(),
      save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(),
    });
    const component = mount();

    expect(hasText(component, 'Could not load your weight goal.')).toBe(false);
    expect(hasText(component, 'Weight History')).toBe(true);
  });
});

// ── the pending-retry window on screen (#737 review) ──────────────────────────
//
// The hook-level contract is in tests/weight-goal-read-failure.test.js; this
// asserts what the user actually sees. The hook states below are the exact
// shapes the real hook now produces before and during a retry — the point being
// that Weight must not fall back to its verified-empty rendering in between.
describe('Weight retry does not flash a verified-empty state (#737 review)', () => {
  const mount = () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    return component;
  };
  const hasText = (component, needle) => component.root.findAll(
    n => n.type === 'Text'
      && String(Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children ?? '').includes(needle)
  ).length > 0;

  beforeEach(() => {
    jest.clearAllMocks();
    useEntries.useUserProfile = jest.fn().mockReturnValue(null);
  });

  test('a goal retry still in flight keeps the banner up and the sections withheld', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY], loading: false, error: null, remove: jest.fn(), update: jest.fn(), refresh: jest.fn(),
    });
    // Mid-retry the hook holds the SAME shape it had before the retry: the read
    // has not completed, so the last completed read is still the truth.
    useEntries.useWeightGoal.mockReturnValue({
      goal: null, loading: false, error: new Error('goal read failed'), refresh: jest.fn(),
      save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(),
    });
    const component = mount();

    expect(hasText(component, 'Could not load your weight goal.')).toBe(true);
    // The window the finding named: this must not be a verified "no goal set".
    expect(hasText(component, 'Weight History')).toBe(false);
  });

  test('an entries retry still in flight keeps the banner up and the sections withheld', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [], loading: false, error: new Error('entries read failed'),
      remove: jest.fn(), update: jest.fn(), refresh: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({
      goal: null, loading: false, error: null, refresh: jest.fn(),
      save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(),
    });
    const component = mount();

    expect(hasText(component, 'Could not load weight entries.')).toBe(true);
    expect(hasText(component, 'Weight History')).toBe(false);
  });

  test('once the retry resolves cleanly the sections come back and the banner goes', () => {
    useEntries.useWeightEntries.mockReturnValue({
      entries: [ENTRY], loading: false, error: null, remove: jest.fn(), update: jest.fn(), refresh: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({
      goal: null, loading: false, error: null, refresh: jest.fn(),
      save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(),
    });
    const component = mount();

    expect(hasText(component, 'Could not load your weight goal.')).toBe(false);
    expect(hasText(component, 'Weight History')).toBe(true);
  });
});

// ── buildTrendSections — pace copy names the elapsed period (#941) ────────────

describe('buildTrendSections pace copy', () => {
  const baseTrends = {
    currentWeight: 190, priorDayWeight: 185,
    avg7: 188, priorAvg7: 186, avg30: 187, priorAvg30: 185,
  };

  test('day-over-day spike keeps the direction value and the period as a separate caption', () => {
    const sections = buildTrendSections(
      { ...baseTrends, paceFlag: 'gain' },
      { direction: 'gain', level: 'spike', elapsedDays: 1 },
    );
    // Value stays a short direction cue; the elapsed span is its own field so it
    // does not get tail-ellipsized out of the narrow single-line trend column.
    expect(sections[0].col3.value).toBe('↑ Gaining');
    expect(sections[0].col3.caption).toBe('day-over-day');
    expect(sections[0].paceLevel).toBe('spike');
  });

  test('multi-day gap names the elapsed span in the caption', () => {
    const sections = buildTrendSections(
      { ...baseTrends, paceFlag: 'loss' },
      { direction: 'loss', level: 'notable', elapsedDays: 5 },
    );
    expect(sections[0].col3.value).toBe('↓ Losing');
    expect(sections[0].col3.caption).toBe('over 5 days');
    expect(sections[0].paceLevel).toBe('notable');
  });

  test('no pace flag falls back to a dash with no caption and no pace level', () => {
    const sections = buildTrendSections({ ...baseTrends, paceFlag: null }, null);
    expect(sections[0].col3.value).toBe('-');
    expect(sections[0].col3.caption).toBeNull();
    expect(sections[0].paceLevel).toBeNull();
  });
});

describe('TrendSection pace caption rendering (#941)', () => {
  const renderSection = (props) => {
    let component;
    render.act(() => {
      component = render.create(
        <TrendSection
          title="Today"
          col1={{ label: 'Current', value: '190.0 lb' }}
          col2={{ label: 'Vs Previous', value: '+5.0 lb' }}
          col3={{ label: 'Trend', value: '↑ Gaining', caption: 'over 5 days' }}
          paceLevel="notable"
          {...props}
        />
      );
    });
    return component.root;
  };

  const textNodes = (root) =>
    root.findAllByType('Text').map((n) => String(n.props.children ?? '').trim());

  test('the elapsed period renders as its own Text node, not embedded in the value', () => {
    const nodes = textNodes(renderSection());
    // The period is a standalone node — legible even though the value node is
    // single-line and right-aligned in a narrow column.
    expect(nodes).toContain('over 5 days');
    expect(nodes).toContain('↑ Gaining');
    // The value node itself is exactly the direction cue, with no period tail.
    expect(nodes.some((t) => t === '↑ Gaining · over 5 days')).toBe(false);
  });

  test('the caption Text is not clamped to a single line', () => {
    const root = renderSection();
    const caption = root
      .findAllByType('Text')
      .find((n) => String(n.props.children ?? '').trim() === 'over 5 days');
    expect(caption.props.numberOfLines).toBeUndefined();
  });

  test('no caption node when col3.caption is absent', () => {
    const nodes = textNodes(renderSection({ col3: { label: 'Trend', value: '→ Stable' } }));
    expect(nodes).toContain('→ Stable');
    expect(nodes).not.toContain('over 5 days');
  });
});
