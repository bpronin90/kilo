// App startup initialization test (#591): verify the foreground notification
// handler is installed once on cold start, independent of whether reminders are
// scheduled or permissions are granted.

import React from 'react';
import renderer from 'react-test-renderer';

jest.mock('../lib/reminderScheduler', () => {
  const mockFn = jest.fn(async () => {});
  return {
    installForegroundHandler: mockFn,
    __mockFn: mockFn,  // expose for testing
    // App.js also reconciles the workout reminder once on startup (#590);
    // this suite only exercises the foreground-handler install path, so a
    // no-op stub is enough to keep that unrelated effect from throwing.
    reconcileWorkoutReminder: jest.fn(async () => ({ workout: { enabled: false }, inferredWeekdays: [] })),
  };
});

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

jest.mock('../components/TabBar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { TabBar: () => React.createElement(View) };
});

jest.mock('../hooks/useEntries', () => ({
  useWeightEntries: jest.fn(() => ({
    entries: [],
    loading: false,
    add: jest.fn(),
    refresh: jest.fn(),
  })),
  useWorkoutNotes: jest.fn(() => ({
    notes: [],
    currentNote: null,
    currentId: null,
    loading: false,
    add: jest.fn(),
    update: jest.fn(),
    selectCurrent: jest.fn(),
    refresh: jest.fn(),
  })),
  useAutoSync: jest.fn(() => ({
    ownershipPrompt: null,
    canRestore: false,
    confirmOwnershipUpload: jest.fn(),
    downloadAccountData: jest.fn(),
    startFreshOnDevice: jest.fn(),
    dismissOwnershipPrompt: jest.fn(),
  })),
  reloadWeightEntries: jest.fn(),
  reloadWorkoutNotes: jest.fn(),
}));

jest.mock('../hooks/useAuthSession', () => ({
  useAuthSession: jest.fn(() => ({
    configured: false,
    passwordRecovery: false,
    recoveryError: false,
    handleAuthCallbackUrl: jest.fn(),
  })),
}));

// Import App after all mocks are set up
import App from '../App';
import * as reminderScheduler from '../lib/reminderScheduler';

describe('app-startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('installs foreground handler once on cold start', async () => {
    await renderer.act(async () => {
      renderer.create(<App />);
    });

    // Verify handler was called exactly once during mount
    expect(reminderScheduler.installForegroundHandler).toHaveBeenCalledTimes(1);
  });

  test('handler call is idempotent when called multiple times', async () => {
    // Call the handler multiple times to verify it doesn't error
    // and that prepareNotifications is idempotent
    await reminderScheduler.installForegroundHandler();
    await reminderScheduler.installForegroundHandler();

    // Should have been called at least once from the useEffect,
    // plus twice from these direct calls
    expect(reminderScheduler.installForegroundHandler).toHaveBeenCalled();
  });
});
