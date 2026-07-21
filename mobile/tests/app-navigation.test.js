// Android Back handler-ownership regression (#527): all tab screens stay mounted
// under display:none, so a stale hidden-tab handler could otherwise outrace the
// visible tab's handler after a tab switch. These tests mount the real LogScreen
// and WeightScreen (not stubs) alongside the app shell to prove that exactly the
// active tab's in-tab state intercepts Android hardware Back, across tab-switch
// sequences, and that ownership does not leak once a tab is left.

import React from 'react';
import renderer from 'react-test-renderer';
import { BackHandler, Platform } from 'react-native';
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

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('../screens/HomeScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { HomeScreen: () => React.createElement(View) };
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

jest.mock('../hooks/entries/weightHooks', () => ({
  useArchivedWeightGoals: () => ({ archivedGoals: [], loading: false, refresh: jest.fn() }),
  useWeightGoal: jest.fn(),
  useWeightEntries: jest.fn(),
  reloadWeightEntries: jest.fn(),
}));

jest.mock('../hooks/useEntries');

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children, headerRight }, ref) => (
    React.createElement(View, null, headerRight, children)
  ));
  return {
    ScreenShell,
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

// WeightScreen schedules a real setTimeout for its midnight-refresh effect; fake
// timers keep that from becoming a live open handle across test runs.
const MOCK_NOW = new Date('2026-05-24T12:00:00Z');
jest.useFakeTimers().setSystemTime(MOCK_NOW);

let capturedTabPress = null;
jest.mock('../components/TabBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    TabBar: (props) => {
      capturedTabPress = props.onTabPress;
      return React.createElement(View, { testID: 'tab-bar' });
    },
  };
});

function findByTestID(tree, testID) {
  if (!tree) return null;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findByTestID(child, testID);
      if (found) return found;
    }
    return null;
  }
  if (tree.props?.testID === testID) return tree;
  if (tree.children) {
    for (const child of tree.children) {
      const found = findByTestID(child, testID);
      if (found) return found;
    }
  }
  return null;
}

function getTabStyle(component, tabName) {
  const tree = component.toJSON();
  const el = findByTestID(tree, `tab-content-${tabName}`);
  if (!el) return {};
  return [].concat(el.props.style).reduce(
    (acc, s) => (s ? Object.assign(acc, s) : acc),
    {}
  );
}

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

// Every tab stays mounted (display:none) at once, so a bare text search can match
// the wrong tab's identically-labeled control (e.g. both Log and Weight render an
// "Edit" button). Scope the search to one tab's subtree via its tab-content testID.
function withinTab(component, tabName) {
  return component.root.findByProps({ testID: `tab-content-${tabName}` });
}

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

const WEIGHT_GOAL = { target_weight: 170, target_date: '2026-07-01', start_weight: 190 };

describe('Android Back handler ownership across tab switches (#527)', () => {
  let addListenerSpy;
  let component;
  let originalOS;
  let mockUpdateNote;

  beforeAll(() => {
    originalOS = Platform.OS;
    Platform.OS = 'android';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  beforeEach(() => {
    capturedTabPress = null;
    mockUpdateNote = jest.fn().mockResolvedValue({});

    useEntries.useWeightEntries.mockReturnValue({
      entries: [{ ...WEIGHT_ENTRY }],
      loading: false,
      refresh: jest.fn(),
      remove: jest.fn(),
      update: jest.fn(),
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
      update: mockUpdateNote,
      add: jest.fn(),
      remove: jest.fn(),
    });
    useEntries.useWeightGoal.mockReturnValue({
      goal: WEIGHT_GOAL,
      save: jest.fn(),
      clear: jest.fn(),
      archiveGoal: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
    useEntries.useDeloadNote.mockReturnValue({ note: { raw_text: '' }, loading: false, save: jest.fn(), clear: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({
      history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn(),
    });
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: false });
    useEntries.useUserProfile.mockReturnValue(null);
    useEntries.useAutoSync.mockReturnValue({});

    addListenerSpy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(
      (_event, handler) => ({ remove: jest.fn(), handler })
    );
    renderer.act(() => {
      component = renderer.create(<App />);
    });
  });

  afterEach(() => {
    addListenerSpy.mockRestore();
    component = null;
    capturedTabPress = null;
  });

  function getLatestBackHandler() {
    const calls = addListenerSpy.mock.calls.filter(
      ([event]) => event === 'hardwareBackPress'
    );
    return calls[calls.length - 1]?.[1];
  }

  test('Back on the Log tab finishes the active current-routine editor instead of falling back to Home', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => {
      findPressableByText(withinTab(component, 'Log'), 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });
    expect(findPressableByText(withinTab(component, 'Log'), 'Edit')).toBeNull(); // now in the editor

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    expect(result).toBe(true);
    // Back closed the editor and stayed on the Log tab; it did not fall through to Home.
    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(getTabStyle(component, 'Home').display).toBe('none');
  });

  test('switching away from an editing Log tab and back preserves handler precedence for the visible tab', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => {
      findPressableByText(withinTab(component, 'Log'), 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });

    // Switch to Weight and back; the shell re-registers its own listener on every
    // tab change (activeTab dependency), which is exactly the scenario #522 found
    // could outrace an in-tab handler.
    renderer.act(() => { capturedTabPress('Weight'); });
    renderer.act(() => { capturedTabPress('Log'); });

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    expect(result).toBe(true);
    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(getTabStyle(component, 'Home').display).toBe('none');
  });

  test('a hidden Log editor cannot consume Back while another tab is active', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => {
      findPressableByText(withinTab(component, 'Log'), 'Edit').props.onPress({ stopPropagation: jest.fn() });
    });

    // Leave Log mid-edit; its editor stays mounted (display:none) in the background.
    renderer.act(() => { capturedTabPress('Weight'); });

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    // With no in-tab state on the now-active Weight tab, Back falls back to Home —
    // the stale Log editor handler must not have intercepted it instead.
    expect(result).toBe(true);
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Weight').display).toBe('none');
  });

  test('editing the weight goal, then switching to Log, does not let Log cancel the hidden goal edit', () => {
    renderer.act(() => { capturedTabPress('Weight'); });
    renderer.act(() => {
      findPressableByText(withinTab(component, 'Weight'), 'Edit').props.onPress();
    });
    expect(findPressableByText(withinTab(component, 'Weight'), 'Save goal')).toBeTruthy();

    renderer.act(() => { capturedTabPress('Log'); });

    const handler = getLatestBackHandler();
    renderer.act(() => { handler(); });

    // Back on the now-active Log tab must not reach into the hidden Weight tab's
    // goal-edit state; the goal edit is untouched (still mounted with Save goal).
    expect(findPressableByText(withinTab(component, 'Weight'), 'Save goal')).toBeTruthy();
  });

  test('with no active in-tab state on any tab, Back still returns a non-Home tab to Home', () => {
    renderer.act(() => { capturedTabPress('Weight'); });

    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });

    expect(result).toBe(true);
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Weight').display).toBe('none');
  });
});
