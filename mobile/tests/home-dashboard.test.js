// Regression tests for issue #379: 1k progress mismatch between Home and Analytics.
//
// Root cause: deriveHomeDashboardData called derive1kTotal with sections from the
// current workout note only, while deriveAnalytics used allSections. When squats
// were only in a historical note, Home showed a null total and Analytics showed the
// correct value.
//
// Fix: Home now passes allSections to derive1kTotal, matching Analytics.

import { parseWorkoutNote, epleyPR } from '../lib/parser';
import { derive1kTotal, DEFAULT_1K_EXERCISES } from '../lib/data';
import { deriveHomeDashboardData } from '../screens/home/homeDashboardData';
import { deriveAnalytics, deriveParsedSections } from '../screens/analytics/analyticsDerivations';

// Historical note: all three Big-3 lifts logged in one session.
const HISTORICAL_TEXT = '-DB Bench Press\n135 5\n-Squat\n225 5\n-Deadlift\n315 5';

// Current note: only bench and deadlift — squat was done in the historical note.
const CURRENT_TEXT = '-DB Bench Press\n140 5\n-Deadlift\n320 5';

const SEL = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };

describe('1k progress — Home vs Analytics consistency (issue #379)', () => {
  test('Home and Analytics produce the same non-null 1k total when squats are in a historical note', () => {
    const historicalSections = parseWorkoutNote(HISTORICAL_TEXT).sections;
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const allSections = [...historicalSections, ...currentSections];

    const historicalNote = { id: 'n1', raw_text: HISTORICAL_TEXT, one_k_exercises: null };
    const currentNote = { id: 'n2', raw_text: CURRENT_TEXT, one_k_exercises: null };
    const notes = [historicalNote, currentNote];

    const { oneK: homeOneK } = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: currentNote,
      weightGoal: null,
      allSections,
      trackedLifts: {},
    });

    const parsedSections = deriveParsedSections(notes, currentNote);
    const { oneK: analyticsOneK } = deriveAnalytics(parsedSections, {}, SEL, 1.0);

    expect(homeOneK.total).not.toBeNull();
    expect(homeOneK.total).toBeCloseTo(analyticsOneK.total, 5);
    expect(homeOneK.squat).not.toBeNull();
    expect(homeOneK.squat).toBeCloseTo(analyticsOneK.squat, 5);
  });

  test('squat contribution is accounted when it only appears in historical note', () => {
    const historicalSections = parseWorkoutNote(HISTORICAL_TEXT).sections;
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const allSections = [...historicalSections, ...currentSections];

    const currentNote = { id: 'n2', raw_text: CURRENT_TEXT, one_k_exercises: null };

    const { oneK } = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: currentNote,
      weightGoal: null,
      allSections,
      trackedLifts: {},
    });

    // The historical note gives one complete cycle — squat from that cycle is used.
    expect(oneK.squat).toBeCloseTo(epleyPR(225, 5), 5);
    expect(oneK.total).toBeCloseTo(epleyPR(135, 5) + epleyPR(225, 5) + epleyPR(315, 5), 5);
  });

  test('pre-fix behavior: current-only sections give null total when squat is absent', () => {
    // Documents what the bug looked like: passing only the current note's sections
    // returns null because there's no complete Big-3 cycle without squats.
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const result = derive1kTotal(currentSections, SEL);
    expect(result.total).toBeNull();
    expect(result.squat).toBeNull();
  });
});

// ── HomeScreen hydration gating (issue #442) ─────────────────────────────────
//
// Problem: the empty/get-started card flashed briefly on fresh app open for
// returning users. Root causes:
//   1. reload() in weightHooks and workoutNoteHooks did not return its promise,
//      so refresh()'s .finally fired (setting loading=false) before entries were
//      set, creating a window where loading=false but entries=[].
//   2. isEmptyState did not account for weightGoal or trackedLifts as data
//      sources, so a user with only a goal or tracked lifts still saw the flash.

import React from 'react';
import render from 'react-test-renderer';
import { HomeScreen } from '../screens/HomeScreen';

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
  const { View, Text } = require('react-native');
  return {
    Card: ({ children, style }) => React.createElement(View, { style }, children),
    HeroMetric: { hero: {} },
    LineChart: () => null,
    getSessionTone: () => 'neutral',
    Button: ({ title, onPress }) => React.createElement(Text, { onPress }, title),
  };
});

jest.mock('../lib/unitPreference', () => ({
  useWeightUnit: () => 'lbs',
}));

jest.mock('../hooks/useEntries', () => {
  const actual = jest.requireActual('../hooks/useEntries');
  return {
    ...actual,
    useWeightGoal: jest.fn(),
    useTrackedLifts: jest.fn(),
  };
});

const useEntries = require('../hooks/useEntries');

const MOCK_NOW = new Date('2026-07-07T12:00:00Z');
jest.useFakeTimers().setSystemTime(MOCK_NOW);

function makeHomeProps(overrides = {}) {
  return {
    weightEntries: [],
    workoutNote: null,
    notes: [],
    successMessage: '',
    onNavigate: jest.fn(),
    loading: false,
    ...overrides,
  };
}

function setupHooks({ goalLoading = false, trackedLiftsLoading = false, goal = null, trackedLifts = {} } = {}) {
  useEntries.useWeightGoal.mockReturnValue({ goal, loading: goalLoading, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
  useEntries.useTrackedLifts.mockReturnValue({ trackedLifts, loading: trackedLiftsLoading, save: jest.fn(), toggle: jest.fn() });
}

function hasText(root, needle) {
  return root.findAll(n => {
    if (n.type !== 'Text') return false;
    const flat = Array.isArray(n.props.children)
      ? n.props.children.join('')
      : String(n.props.children ?? '');
    return flat.includes(needle);
  }).length > 0;
}

describe('HomeScreen — hydration gating (issue #442)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('shows nothing while the parent loading prop is true, not the empty state', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: false });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: true })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
    expect(hasText(component.root, 'Week')).toBe(false);
  });

  test('shows nothing while goalLoading is still true, even when parent loading is false and entries are empty', () => {
    // Reproduces the pre-hydration race window: loading went false early (before
    // entries arrived) but goal hasn't resolved yet. isLoading must stay true.
    setupHooks({ goalLoading: true, trackedLiftsLoading: false });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('shows nothing while trackedLiftsLoading is still true, even when parent loading is false and entries are empty', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: true });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('shows the empty state only after all sources fully resolve with no data', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: false, goal: null, trackedLifts: {} });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(true);
  });

  test('does not show empty state when weight entries exist after hydration', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: false });
    const entry = { id: 'e1', date: '2026-07-07', logged_at: '2026-07-07T08:00:00Z', weight_value: 185 };
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false, weightEntries: [entry] })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('does not show empty state when notes exist after hydration', () => {
    setupHooks({ goalLoading: false, trackedLiftsLoading: false });
    const note = { id: 'n1', raw_text: '-Squat\n225 5', title: 'My Workout' };
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false, notes: [note], workoutNote: note })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('does not show empty state when a weight goal is set, even with no entries or notes', () => {
    // A user with only a weight goal should not see the get-started card.
    const goal = { target_weight: 175, target_date: '2026-12-01', start_weight: 190, start_date: '2026-01-01' };
    setupHooks({ goalLoading: false, trackedLiftsLoading: false, goal });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });

  test('does not show empty state when tracked lifts are active, even with no entries or notes', () => {
    // A user with tracked lifts should not see the get-started card.
    setupHooks({ goalLoading: false, trackedLiftsLoading: false, trackedLifts: { Squat: true } });
    let component;
    render.act(() => {
      component = render.create(<HomeScreen {...makeHomeProps({ loading: false })} />);
    });
    expect(hasText(component.root, 'Welcome to Kilo')).toBe(false);
  });
});
