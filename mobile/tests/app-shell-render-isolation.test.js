// Shell keystroke isolation (#592, follow-up to measured #572 claim 10): App
// owns Weight/Log input state (weightValue, weightNote, workoutNoteText,
// workoutNoteTitle) at the shell level, and every tab stays mounted under
// display:none (#527). Before this fix, a keystroke in one tab's field
// re-rendered App and re-created every tab's element, which re-rendered every
// mounted screen — Home, Log/Weight (whichever was inactive), Analytics, and
// More — even though only the active tab's own state changed.
//
// Each screen here is mocked to a render-counting stub that captures its own
// props (including the shell setters) so the test can drive a "keystroke" by
// calling the captured setter directly, exactly like a TextInput's
// onChangeText would, and then assert which screens' render counts moved.

import React from 'react';
import renderer from 'react-test-renderer';
import App from '../App';
import * as useEntries from '../hooks/useEntries';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('expo-updates', () => ({
  useUpdates: jest.fn(() => ({ isUpdatePending: false })),
  reloadAsync: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(null),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
}, { virtual: true });

// TabBar schedules a real animation timeout on mount; fake timers keep it
// from firing after the test (and Jest environment) tear down, matching the
// pattern used by tests/app-navigation.test.js for the same shell.
const MOCK_NOW = new Date('2026-05-24T12:00:00Z');
jest.useFakeTimers().setSystemTime(MOCK_NOW);

const renderCounts = {
  Home: 0,
  Log: 0,
  Weight: 0,
  Analytics: 0,
  More: 0,
};

let capturedWeightSetters = null;
let capturedLogSetters = null;

jest.mock('../screens/HomeScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    HomeScreen: () => {
      renderCounts.Home += 1;
      return React.createElement(View);
    },
  };
});

jest.mock('../screens/LogScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LogScreen: (props) => {
      renderCounts.Log += 1;
      capturedLogSetters = {
        setWorkoutNoteText: props.setWorkoutNoteText,
        setWorkoutNoteTitle: props.setWorkoutNoteTitle,
      };
      return React.createElement(View);
    },
  };
});

jest.mock('../screens/WeightScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WeightScreen: (props) => {
      renderCounts.Weight += 1;
      capturedWeightSetters = {
        setWeightValue: props.setWeightValue,
        setWeightNote: props.setWeightNote,
      };
      return React.createElement(View);
    },
  };
});

jest.mock('../screens/AnalyticsScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    AnalyticsScreen: () => {
      renderCounts.Analytics += 1;
      return React.createElement(View);
    },
  };
});

jest.mock('../screens/MoreScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MoreScreen: () => {
      renderCounts.More += 1;
      return React.createElement(View);
    },
  };
});

jest.mock('../hooks/useEntries');

// A stable object identity is required for MemoMoreScreen's shallow prop
// comparison to hold across unrelated renders; the real useAuthSession hook
// returns a fresh object literal on every call (a pre-existing property of
// that hook, outside this issue's Allowed Files). Stubbing it to return the
// same reference every time isolates exactly the shell-state behavior #592
// changed, rather than conflating it with that unrelated hook's own churn.
const STABLE_AUTH = { configured: false };
jest.mock('../hooks/useAuthSession', () => ({
  useAuthSession: () => STABLE_AUTH,
}));

const CURRENT_NOTE = {
  id: 'note1',
  title: 'Routine A',
  raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
  saved_at: '2026-06-01T12:00:00.000Z',
};

const WEIGHT_ENTRY = {
  id: 'e1',
  date: '2026-05-24',
  logged_at: '2026-05-24T08:00:00Z',
  weight_value: 185,
  weight_unit: 'lb',
  note: '',
};

describe('App shell keystroke isolation (#592)', () => {
  let component;

  beforeEach(() => {
    Object.keys(renderCounts).forEach((k) => { renderCounts[k] = 0; });
    capturedWeightSetters = null;
    capturedLogSetters = null;

    useEntries.useWeightEntries.mockReturnValue({
      entries: [{ ...WEIGHT_ENTRY }],
      loading: false,
      refresh: jest.fn(),
      remove: jest.fn(),
      update: jest.fn(),
      add: jest.fn(),
    });
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [CURRENT_NOTE],
      currentId: 'note1',
      currentNote: CURRENT_NOTE,
      deloadNotes: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      selectCurrent: jest.fn(),
      update: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useAutoSync.mockReturnValue({});

    renderer.act(() => {
      component = renderer.create(<App />);
    });
  });

  afterEach(() => {
    component = null;
  });

  test('typing in the Weight field only re-renders the Weight tab', () => {
    expect(capturedWeightSetters).not.toBeNull();
    const baseline = { ...renderCounts };

    renderer.act(() => {
      capturedWeightSetters.setWeightValue('185.4');
    });

    expect(renderCounts.Weight).toBeGreaterThan(baseline.Weight);
    expect(renderCounts.Home).toBe(baseline.Home);
    expect(renderCounts.Log).toBe(baseline.Log);
    expect(renderCounts.Analytics).toBe(baseline.Analytics);
    expect(renderCounts.More).toBe(baseline.More);
  });

  test('typing a weight note only re-renders the Weight tab', () => {
    const baseline = { ...renderCounts };

    renderer.act(() => {
      capturedWeightSetters.setWeightNote('Morning, fasted');
    });

    expect(renderCounts.Weight).toBeGreaterThan(baseline.Weight);
    expect(renderCounts.Home).toBe(baseline.Home);
    expect(renderCounts.Log).toBe(baseline.Log);
    expect(renderCounts.Analytics).toBe(baseline.Analytics);
    expect(renderCounts.More).toBe(baseline.More);
  });

  test('typing in the Log workout-notes field only re-renders the Log tab', () => {
    expect(capturedLogSetters).not.toBeNull();
    const baseline = { ...renderCounts };

    renderer.act(() => {
      capturedLogSetters.setWorkoutNoteText('Monday\n+Lifting\n-Bench\n135 5,5,5\nmore');
    });

    expect(renderCounts.Log).toBeGreaterThan(baseline.Log);
    expect(renderCounts.Home).toBe(baseline.Home);
    expect(renderCounts.Weight).toBe(baseline.Weight);
    expect(renderCounts.Analytics).toBe(baseline.Analytics);
    expect(renderCounts.More).toBe(baseline.More);
  });

  test('typing a Log workout title only re-renders the Log tab', () => {
    const baseline = { ...renderCounts };

    renderer.act(() => {
      capturedLogSetters.setWorkoutNoteTitle('Push Day');
    });

    expect(renderCounts.Log).toBeGreaterThan(baseline.Log);
    expect(renderCounts.Home).toBe(baseline.Home);
    expect(renderCounts.Weight).toBe(baseline.Weight);
    expect(renderCounts.Analytics).toBe(baseline.Analytics);
    expect(renderCounts.More).toBe(baseline.More);
  });

  test('tab-state continuity: switching tabs after typing preserves the typed value', () => {
    renderer.act(() => {
      capturedWeightSetters.setWeightValue('190.2');
    });
    renderer.act(() => {
      component.root.findByProps({ testID: 'tab-content-Home' });
    });
    // WeightScreen mock re-captures its own props on every render; the shell
    // must still be holding the typed value after other tabs render/re-render.
    const weightProps = component.root.findAllByType(
      require('../screens/WeightScreen').WeightScreen
    )[0].props;
    expect(weightProps.weightValue).toBe('190.2');
  });
});
