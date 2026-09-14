// Contract test for card #1050 (split WeightScreen.js / WeightHistoryList.js
// below 600 lines into cohesive presentation modules).
//
// This does not re-verify entry/editing/filtering/pagination/goal-history/
// units/date behavior — the existing named suites (weight-screen,
// weight-goal-ui, weight-goal-read-failure, weight-history-list-render-
// isolation, unit-display-ui, interaction-target-a11y) already own that.
// What this file asserts is specific to the *split itself*:
//
//   1. Export parity: `../screens/WeightScreen` and `../components/
//      WeightHistoryList` still expose exactly the same public surface
//      (named exports) that every consumer/test imports, unchanged by the
//      extraction.
//   2. The new extracted modules (screens/weight/*, components/weight/*)
//      render correctly in isolation — a direct, structural benefit of the
//      split.
//   3. Render-isolation spot checks: the #592/#898 WeightHistoryList
//      React.memo boundary, and the WeightScreen -> WeightHistoryList
//      prop-stability contract that boundary depends on, both survive the
//      extraction of WeightEntryForm/GoalHistoryPanel out of WeightScreen.

import React from 'react';
import render from 'react-test-renderer';

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../hooks/entries/weightHooks', () => ({
  useArchivedWeightGoals: () => ({ archivedGoals: [], loading: false, refresh: jest.fn() }),
  useWeightGoal: jest.fn(),
  useWeightEntries: jest.fn(),
}));

jest.mock('../hooks/useEntries');

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children }, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollTo: jest.fn() }));
    return React.createElement(View, null, children);
  });
  return { ScreenShell, ScrollContext: React.createContext({ onScroll: () => {} }) };
});

// Partial mock of lib/format: keep every real formatter (formatDate,
// formatDelta, ...) but wrap getWeightDeltaSeverity in a spy so we can assert
// on how many rows WeightHistoryList actually mapped, exactly like
// weight-history-list-render-isolation.test.js does at the WeightHistoryList
// boundary — here applied one level up, at the WeightScreen boundary that
// owns and passes this callback down.
jest.mock('../lib/format', () => {
  const actual = jest.requireActual('../lib/format');
  return { ...actual, getWeightDeltaSeverity: jest.fn(actual.getWeightDeltaSeverity) };
});

const { WeightScreen } = require('../screens/WeightScreen');
const { WeightHistoryList } = require('../components/WeightHistoryList');
const { WeightEntryForm } = require('../screens/weight/WeightEntryForm');
const { GoalHistoryPanel } = require('../screens/weight/GoalHistoryPanel');
const { WeightHistoryFilters } = require('../components/weight/WeightHistoryFilters');
const { getWeightDeltaSeverity } = require('../lib/format');
const useEntries = require('../hooks/useEntries');

describe('#1050 export parity: WeightScreen.js and WeightHistoryList.js keep their public boundary', () => {
  test('screens/WeightScreen.js exports exactly { WeightScreen }, unchanged for consumers', () => {
    const mod = require('../screens/WeightScreen');
    expect(Object.keys(mod).sort()).toEqual(['WeightScreen']);
    expect(typeof mod.WeightScreen).toBe('function');
  });

  test('components/WeightHistoryList.js exports exactly { WeightHistoryList }, still React.memo-wrapped', () => {
    const mod = require('../components/WeightHistoryList');
    expect(Object.keys(mod).sort()).toEqual(['WeightHistoryList']);
    // React.memo() returns an object descriptor, not a plain function — this
    // is the #592 memoization boundary the render-isolation suite depends on.
    expect(typeof mod.WeightHistoryList).toBe('object');
    expect(mod.WeightHistoryList.$$typeof).toBe(Symbol.for('react.memo'));
    expect(typeof mod.WeightHistoryList.type).toBe('function');
  });
});

describe('#1050 new modules render standalone (screens/weight/*, components/weight/*)', () => {
  test('WeightEntryForm renders standalone given the props WeightScreen passes it', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WeightEntryForm
          editingId={null}
          cancelEdit={() => {}}
          displayError=""
          unit="lb"
          weightValue=""
          setWeightValue={() => {}}
          weightNote=""
          setWeightNote={() => {}}
          newEntryDate="2026-01-01"
          setNewEntryDate={() => {}}
          setNewEntryDateTouched={() => {}}
          editDate=""
          setEditDate={() => {}}
          handleSubmit={() => {}}
          saving={false}
        />
      );
    });
    expect(component.root.findAllByProps({ accessibilityLabel: 'Weigh-in date' }).length).toBeGreaterThan(0);
    expect(component.toJSON()).not.toBeNull();
  });

  test('WeightEntryForm renders its editing header when editingId is set', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WeightEntryForm
          editingId="e1"
          cancelEdit={() => {}}
          displayError=""
          unit="lb"
          weightValue="180"
          setWeightValue={() => {}}
          weightNote=""
          setWeightNote={() => {}}
          newEntryDate="2026-01-01"
          setNewEntryDate={() => {}}
          setNewEntryDateTouched={() => {}}
          editDate="2026-01-01"
          setEditDate={() => {}}
          handleSubmit={() => {}}
          saving={false}
        />
      );
    });
    expect(component.root.findAllByProps({ accessibilityLabel: 'Cancel' }).length).toBeGreaterThan(0);
    expect(component.root.findAllByProps({ accessibilityLabel: 'Entry date' }).length).toBeGreaterThan(0);
  });

  test('GoalHistoryPanel renders standalone given the props WeightScreen passes it', () => {
    const goals = [
      { id: 'g1', target_weight: 150, completed_weight: 148, archived_at: '2026-01-01', target_date: '2026-01-15' },
    ];
    let component;
    render.act(() => {
      component = render.create(
        <GoalHistoryPanel
          sortedArchivedGoals={goals}
          collapsed={true}
          setCollapsed={() => {}}
          latestArchivedOutcome={{ label: 'Success', met: true }}
          unit="lb"
        />
      );
    });
    expect(component.root.findAllByProps({ accessibilityLabel: 'Expand goal history' }).length).toBeGreaterThan(0);
  });

  test('WeightHistoryFilters renders standalone given the props WeightHistoryList passes it', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WeightHistoryFilters
          visible={true}
          fromDate=""
          setFromDate={() => {}}
          toDate=""
          setToDate={() => {}}
          showFromPicker={false}
          setShowFromPicker={() => {}}
          showToPicker={false}
          setShowToPicker={() => {}}
        />
      );
    });
    expect(component.root.findAllByProps({ testID: 'weight-history-date-filter-controls' }).length).toBeGreaterThan(0);
  });

  test('WeightHistoryFilters renders nothing for the filter row when not visible', () => {
    let component;
    render.act(() => {
      component = render.create(
        <WeightHistoryFilters
          visible={false}
          fromDate=""
          setFromDate={() => {}}
          toDate=""
          setToDate={() => {}}
          showFromPicker={false}
          setShowFromPicker={() => {}}
          showToPicker={false}
          setShowToPicker={() => {}}
        />
      );
    });
    expect(component.root.findAllByProps({ testID: 'weight-history-date-filter-controls' }).length).toBe(0);
  });
});

describe('#1050 render-isolation spot check: WeightHistoryList memo boundary survives the split', () => {
  const ENTRIES = Array.from({ length: 6 }, (_, i) => ({
    id: `e${i}`,
    date: `2026-01-0${i + 1}`,
    logged_at: `2026-01-0${i + 1}T08:00:00Z`,
    weight_value: 180 + i,
    weight_unit: 'lb',
    note: '',
  }));

  test('re-rendering WeightHistoryList with identical props does not remap rows', () => {
    const severityFn = jest.fn(getWeightDeltaSeverity);
    const handleEditEntry = () => {};
    const handleDelete = () => {};
    let component;
    render.act(() => {
      component = render.create(
        <WeightHistoryList
          entries={ENTRIES}
          editingId={null}
          handleEditEntry={handleEditEntry}
          handleDelete={handleDelete}
          getWeightDeltaSeverity={severityFn}
          goalInfo={null}
        />
      );
    });
    const expandBtn = component.root.findByProps({ accessibilityLabel: 'Expand history' });
    render.act(() => { expandBtn.props.onPress(); });
    expect(severityFn.mock.calls.length).toBeGreaterThan(0);
    severityFn.mockClear();

    render.act(() => {
      component.update(
        <WeightHistoryList
          entries={ENTRIES}
          editingId={null}
          handleEditEntry={handleEditEntry}
          handleDelete={handleDelete}
          getWeightDeltaSeverity={severityFn}
          goalInfo={null}
        />
      );
    });

    expect(severityFn).not.toHaveBeenCalled();
  });
});

describe('#1050 render-isolation spot check: WeightScreen -> WeightHistoryList wiring survives extracting WeightEntryForm/GoalHistoryPanel', () => {
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

  const ENTRIES = Array.from({ length: 6 }, (_, i) => ({
    id: `e${i}`,
    date: `2026-01-0${i + 1}`,
    logged_at: `2026-01-0${i + 1}T08:00:00Z`,
    weight_value: 180 + i,
    weight_unit: 'lb',
    note: '',
  }));

  beforeEach(() => {
    getWeightDeltaSeverity.mockClear();
    useEntries.useWeightEntries.mockReturnValue({ entries: ENTRIES, remove: jest.fn(), update: jest.fn() });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  });

  test('both extracted modules are wired into the rendered tree', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    // From WeightEntryForm (screens/weight/WeightEntryForm.js).
    expect(root.findAllByProps({ accessibilityLabel: 'Weigh-in date' }).length).toBeGreaterThan(0);
    // From WeightHistoryList (components/WeightHistoryList.js), still reached
    // through WeightScreen exactly as before the split.
    expect(root.findAllByProps({ accessibilityLabel: 'Expand history' }).length).toBeGreaterThan(0);
  });

  test('a Weight-field keystroke re-render does not remap WeightHistoryList rows (#592 boundary preserved after the split)', () => {
    let component;
    render.act(() => {
      component = render.create(
        <ControlledWeightScreen onSaveWeight={jest.fn()} errorMessage="" saving={false} />
      );
    });
    const root = component.root;
    const expandBtn = root.findByProps({ accessibilityLabel: 'Expand history' });
    render.act(() => { expandBtn.props.onPress(); });
    expect(getWeightDeltaSeverity.mock.calls.length).toBeGreaterThan(0);
    getWeightDeltaSeverity.mockClear();

    // Simulate a keystroke in the Weight field, exactly like a real user
    // typing — this is the re-render that #592 originally fixed and that the
    // WeightEntryForm extraction must not regress: entries/callbacks passed
    // to WeightHistoryList stay referentially stable, so its memo bails out
    // and no row gets remapped.
    const weightInput = root.findByProps({ placeholder: '185.0' });
    render.act(() => { weightInput.props.onChangeText('123'); });

    expect(getWeightDeltaSeverity).not.toHaveBeenCalled();
  });
});
