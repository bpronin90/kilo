import React from 'react';
import renderer from 'react-test-renderer';
import App from '../App';
import * as Updates from 'expo-updates';

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
  useAutoSync: () => {},
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
jest.mock('../components/TabBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { TabBar: () => React.createElement(View, { testID: 'tab-bar' }) };
});
jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  return {
    ScrollContext: React.createContext({ onScroll: () => {} }),
    ScreenShell: ({ children }) => React.createElement(React.Fragment, null, children),
  };
});

function findByTestID(tree, testID) {
  if (!tree || typeof tree !== 'object') return null;
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

describe('App-level OTA update pending banner (#426)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Updates.useUpdates.mockReturnValue({ isUpdatePending: false });
  });

  test('banner is not shown when no update is pending', () => {
    let component;
    renderer.act(() => {
      component = renderer.create(<App />);
    });
    const banner = findByTestID(component.toJSON(), 'update-pending-banner');
    expect(banner).toBeNull();
  });

  test('banner appears when an update is pending', () => {
    Updates.useUpdates.mockReturnValue({ isUpdatePending: true });
    let component;
    renderer.act(() => {
      component = renderer.create(<App />);
    });
    const banner = findByTestID(component.toJSON(), 'update-pending-banner');
    expect(banner).not.toBeNull();
  });

  test('banner contains "Restart to apply" text', () => {
    Updates.useUpdates.mockReturnValue({ isUpdatePending: true });
    let component;
    renderer.act(() => {
      component = renderer.create(<App />);
    });
    const json = JSON.stringify(component.toJSON());
    expect(json).toContain('Restart to apply');
    expect(json).toContain('Update ready');
  });

  test('pressing Restart to apply calls Updates.reloadAsync', () => {
    Updates.useUpdates.mockReturnValue({ isUpdatePending: true });
    let component;
    renderer.act(() => {
      component = renderer.create(<App />);
    });
    const restartButton = component.root.findByProps({ accessibilityLabel: 'Restart to apply update' });
    expect(restartButton).toBeTruthy();
    renderer.act(() => {
      restartButton.props.onPress();
    });
    expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  });
});
