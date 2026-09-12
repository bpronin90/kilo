// Source/export boundary coverage for the #1049 Home screen split.
//
// HomeScreen.js was carved into screens/home/{HomeHeader,HomeDashboard,
// HomeRecoverySummary,homeStyles}.js. The split is behavior-only, so this
// suite pins the two things a mechanical move can silently break:
//   1. export parity — the public surface every other module and test imports
//      (`WELCOME_*`, `CloudSyncNotice`, `HomeRecoverySummary`, `HomeScreen`)
//      must still resolve from `../screens/HomeScreen`, and the re-exported
//      `HomeRecoverySummary` must be the very identity the extracted module
//      defines (not an accidental duplicate);
//   2. the first-paint / four-source boundary — HomeScreen still owns the
//      skeleton → welcome → composed-dashboard gate, and the loaded branch
//      must actually mount the extracted HomeHeader and HomeDashboard.

import React from 'react';
import render from 'react-test-renderer';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children }) => React.createElement(View, null, children),
    Path: () => null,
    Rect: () => null,
  };
});

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ScreenShell: ({ children }) => React.createElement(View, null, children),
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

jest.mock('../components/UI', () => {
  const React = require('react');
  const { View, Text, Pressable } = require('react-native');
  return {
    Card: ({ children, style }) => React.createElement(View, { style }, children),
    HeroMetric: {
      hero: { fontSize: 48, fontWeight: '900', lineHeight: 52 },
      statSecondary: { fontSize: 24, fontWeight: '900' },
    },
    LineChart: () => null,
    getSessionTone: () => 'neutral',
    Button: ({ title, onPress }) => React.createElement(Text, { onPress }, title),
    ErrorBanner: ({ message, onRetry }) => React.createElement(
      View,
      { testID: 'error-banner' },
      React.createElement(Text, null, message),
      onRetry ? React.createElement(Pressable, { testID: 'error-banner-retry', onPress: onRetry }) : null
    ),
  };
});

jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lbs' }));

jest.mock('../hooks/useEntries', () => {
  const actual = jest.requireActual('../hooks/useEntries');
  return { ...actual, useWeightGoal: jest.fn(), useTrackedLifts: jest.fn() };
});

const useEntriesModule = require('../hooks/useEntries');
const recoveryHooks = require('../hooks/entries/recoveryBlockHooks');
const AsyncStorage = require('@react-native-async-storage/async-storage');

// Count host nodes only (string element type, e.g. 'View'): a composite
// wrapper and the host it renders can both carry the same forwarded testID,
// so counting every match would double- or triple-count one element.
const byTestId = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props && n.props.testID === id);
const hasText = (root, needle) => root.findAll(n => {
  if (n.type !== 'Text') return false;
  const flat = Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '');
  return flat.includes(needle);
}).length > 0;

const props = (over = {}) => ({
  weightEntries: [],
  workoutNote: null,
  notes: [],
  successMessage: '',
  onNavigate: jest.fn(),
  loading: false,
  ...over,
});

describe('#1049 export parity', () => {
  test('HomeScreen re-exports its full public surface', () => {
    const HS = require('../screens/HomeScreen');
    expect(typeof HS.HomeScreen).toBe('function');
    expect(typeof HS.CloudSyncNotice).toBe('function');
    expect(typeof HS.HomeRecoverySummary).toBe('function');
    expect(HS.WELCOME_EXAMPLE_EXERCISE_LINE).toBe('-Squat');
    expect(HS.WELCOME_EXAMPLE_SETS_LINE).toBe('315 5,5');
  });

  test('the extracted modules own their pieces', () => {
    expect(typeof require('../screens/home/HomeHeader').HomeHeader).toBe('function');
    expect(typeof require('../screens/home/HomeDashboard').HomeDashboard).toBe('function');
    expect(typeof require('../screens/home/HomeRecoverySummary').HomeRecoverySummary).toBe('function');
    expect(typeof require('../screens/home/homeStyles').createStyles).toBe('function');
  });

  test('the re-exported HomeRecoverySummary is the extracted identity, not a copy', () => {
    const fromScreen = require('../screens/HomeScreen').HomeRecoverySummary;
    const fromModule = require('../screens/home/HomeRecoverySummary').HomeRecoverySummary;
    expect(fromScreen).toBe(fromModule);
  });
});

describe('#1049 first-paint / four-source boundary', () => {
  const { HomeScreen } = require('../screens/HomeScreen');

  beforeEach(() => {
    jest.clearAllMocks();
    recoveryHooks._resetRecoveryAnalyticsFilterCache();
    AsyncStorage.getItem.mockImplementation(async () => null);
    useEntriesModule.useWeightGoal.mockReturnValue({ goal: null, loading: false, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntriesModule.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false, save: jest.fn(), toggle: jest.fn() });
  });

  afterEach(() => {
    AsyncStorage.getItem.mockReset();
    recoveryHooks._resetRecoveryAnalyticsFilterCache();
  });

  test('the shell paints the skeleton while any source is still loading', async () => {
    let component;
    await render.act(async () => { component = render.create(<HomeScreen {...props({ loading: true })} />); });

    expect(byTestId(component.root, 'home-skeleton').length).toBe(1);
    // No welcome and no composed dashboard while loading.
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
    expect(byTestId(component.root, 'home-current-routine-link').length).toBe(0);
    expect(byTestId(component.root, 'home-one-k-link').length).toBe(0);

    await render.act(async () => { component.unmount(); });
  });

  test('a verified-empty read paints the welcome card, not a fabricated dashboard', async () => {
    let component;
    await render.act(async () => { component = render.create(<HomeScreen {...props()} />); });

    expect(byTestId(component.root, 'home-skeleton').length).toBe(0);
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(true);
    expect(byTestId(component.root, 'home-one-k-link').length).toBe(0);

    await render.act(async () => { component.unmount(); });
  });

  test('a loaded read composes the extracted HomeHeader and HomeDashboard', async () => {
    useEntriesModule.useWeightGoal.mockReturnValue({
      goal: { target_weight: 180, target_date: '2026-12-31', start_weight: 200, start_date: '2026-01-01' },
      loading: false, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(),
    });

    let component;
    await render.act(async () => { component = render.create(<HomeScreen {...props()} />); });

    // Skeleton and welcome are gone; the loaded branch is up.
    expect(byTestId(component.root, 'home-skeleton').length).toBe(0);
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
    // Header seam (HomeHeader) and dashboard seam (HomeDashboard) both mounted.
    expect(byTestId(component.root, 'home-current-routine-link').length).toBe(1);
    expect(byTestId(component.root, 'home-one-k-link').length).toBe(1);

    await render.act(async () => { component.unmount(); });
  });

  test('a source-read failure surfaces the banner without inventing a dashboard', async () => {
    let component;
    await render.act(async () => { component = render.create(<HomeScreen {...props({ loadError: true, onRetryLoad: jest.fn() })} />); });

    expect(byTestId(component.root, 'error-banner').length).toBe(1);
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
    expect(byTestId(component.root, 'home-one-k-link').length).toBe(0);

    await render.act(async () => { component.unmount(); });
  });
});
