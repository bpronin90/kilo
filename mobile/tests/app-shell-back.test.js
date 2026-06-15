import React from 'react';
import renderer from 'react-test-renderer';
import { BackHandler, Alert, Platform } from 'react-native';
import App from '../App';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(null),
  removeItem: jest.fn().mockResolvedValue(null),
}));

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
jest.mock('../screens/WeightScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { WeightScreen: () => React.createElement(View) };
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

jest.mock('../hooks/useEntries', () => ({
  useWeightEntries: () => ({ entries: [], loading: false, refresh: jest.fn() }),
  useWorkoutNotes: () => ({
    notes: [],
    currentNote: null,
    currentId: null,
    loading: false,
    add: jest.fn(),
    update: jest.fn(),
    selectCurrent: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock('../storage/entries', () => ({
  exportBackup: jest.fn(),
  importBackup: jest.fn(),
  loadFatigueMultiplier: jest.fn().mockResolvedValue(1.07),
  saveFatigueMultiplier: jest.fn(),
  loadWorkoutCollapsed: jest.fn().mockResolvedValue(false),
  saveWorkoutCollapsed: jest.fn(),
  loadWeightDateEditEnabled: jest.fn().mockResolvedValue(false),
  saveWeightDateEditEnabled: jest.fn(),
  loadDeloadDateEditEnabled: jest.fn().mockResolvedValue(false),
  saveDeloadDateEditEnabled: jest.fn(),
}));

jest.mock('../lib/parser', () => ({ parseWeightEntry: jest.fn() }));
jest.mock('../lib/data', () => ({ makeWeightEntry: jest.fn() }));

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

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  return { ScrollContext: React.createContext({ onScroll: () => {} }) };
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

describe('App shell tab switching', () => {
  let component;

  beforeEach(() => {
    capturedTabPress = null;
    renderer.act(() => {
      component = renderer.create(<App />);
    });
  });

  afterEach(() => {
    component = null;
    capturedTabPress = null;
  });

  test('Home tab is active on initial render', () => {
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
  });

  test('non-active tabs are hidden on initial render', () => {
    expect(getTabStyle(component, 'Log').display).toBe('none');
    expect(getTabStyle(component, 'Weight').display).toBe('none');
  });

  test('pressing Log tab makes Log active and Home inactive', () => {
    renderer.act(() => {
      capturedTabPress('Log');
    });
    expect(getTabStyle(component, 'Log').display).not.toBe('none');
    expect(getTabStyle(component, 'Home').display).toBe('none');
  });

  test('pressing Home tab from Log restores Home as active', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    renderer.act(() => { capturedTabPress('Home'); });
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Log').display).toBe('none');
  });

  test('each tab in TABS can become active', () => {
    for (const tab of ['Log', 'Weight', 'Analytics', 'More', 'Home']) {
      renderer.act(() => { capturedTabPress(tab); });
      expect(getTabStyle(component, tab).display).not.toBe('none');
    }
  });
});

describe('App shell back handler (Android)', () => {
  let addListenerSpy;
  let component;
  let originalOS;

  beforeAll(() => {
    originalOS = Platform.OS;
    Platform.OS = 'android';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  beforeEach(() => {
    capturedTabPress = null;
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

  test('back press from non-Home tab navigates to Home and consumes the event', () => {
    renderer.act(() => { capturedTabPress('Log'); });
    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });
    expect(result).toBe(true);
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
    expect(getTabStyle(component, 'Log').display).toBe('none');
  });

  test('back press from Home tab shows exit alert and consumes the event', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const handler = getLatestBackHandler();
    let result;
    renderer.act(() => { result = handler(); });
    expect(result).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith(
      'Exit app?',
      expect.any(String),
      expect.any(Array)
    );
    alertSpy.mockRestore();
  });

  test('back press from Home tab does not change active tab', () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const handler = getLatestBackHandler();
    renderer.act(() => { handler(); });
    expect(getTabStyle(component, 'Home').display).not.toBe('none');
  });
});
