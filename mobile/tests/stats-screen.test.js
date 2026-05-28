import React from 'react';
import render from 'react-test-renderer';
import { StatsScreen } from '../screens/StatsScreen';
import * as useEntries from '../hooks/useEntries';
import * as data from '../lib/data';


jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../components/LineChart', () => {
  const React = require('react');
  return { LineChart: () => null };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { MaterialIcons: () => null };
}, { virtual: true });

jest.mock('../hooks/useEntries');

const MOCK_NOW = new Date('2026-05-26T12:00:00Z');
jest.useFakeTimers().setSystemTime(MOCK_NOW);

function setup({ entries = [], hookOverrides = {} } = {}) {
  useEntries.useWeightEntries.mockReturnValue({ entries, loading: false, error: null });
  useEntries.useTrackedLifts.mockReturnValue({ 
    trackedLifts: hookOverrides.trackedLifts || {}, 
    loading: false 
  });
  useEntries.useWorkoutNotes.mockReturnValue({
    notes: [],
    currentNote: null,
    loading: false,
    update: jest.fn(),
    ...hookOverrides,
  });

  let component;
  render.act(() => {
    component = render.create(<StatsScreen multiplier={1.07} section={null} />);
  });
  return component;
}

function findAllText(root) {
  return root.findAllByType('Text').map(t => {
    const children = t.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
  });
}

function hasText(root, needle) {
  return findAllText(root).some(s => s.includes(needle));
}

// ── StatsScreen weight summary — consumer drift regression ────────────────────

describe('StatsScreen weight summary — sourced from deriveWeightGoalAnalytics', () => {
  afterEach(() => jest.restoreAllMocks());

  test('latest weight displayed is the value returned by deriveWeightGoalAnalytics, not a local sort', () => {
    // Entries where date order and weight_value are deliberately set up so that
    // any independent local re-sort would yield the same date-sorted order.
    // We spy on deriveWeightGoalAnalytics and make it return a sentinel currentWeight
    // that is different from every entry's weight_value — proving the screen
    // reads from the shared layer, not from the raw array.
    const entries = [
      { id: '1', date: '2026-05-26', logged_at: '2026-05-26T08:00:00Z', weight_value: 185.0, weight_unit: 'lb' },
      { id: '2', date: '2026-05-25', logged_at: '2026-05-25T08:00:00Z', weight_value: 184.0, weight_unit: 'lb' },
    ];

    const sentinel = 42.0;

    jest.spyOn(data, 'deriveWeightGoalAnalytics').mockReturnValue({
      trendSummary: {
        currentWeight: sentinel,
        priorDayWeight: null,
        avg7: sentinel,
        avg30: sentinel,
        paceFlag: null,
        priorAvg7: null,
        priorAvg30: null,
      },
      paceLevel: null,
      rollingSeries: [],
      goalInfo: null,
      calorieEstimate: null,
    });

    const component = setup({ entries });
    const root = component.root;

    expect(data.deriveWeightGoalAnalytics).toHaveBeenCalledWith(entries, null);
    expect(hasText(root, `${sentinel} lb`)).toBe(true);
    // No raw entry weight_value should appear as the latest-weight display
    expect(hasText(root, '185.0 lb')).toBe(false);
    expect(hasText(root, '184.0 lb')).toBe(false);
  });

  test('7-day and 30-day averages displayed are values from deriveWeightGoalAnalytics', () => {
    const entries = [
      { id: '1', date: '2026-05-26', logged_at: '2026-05-26T08:00:00Z', weight_value: 200.0, weight_unit: 'lb' },
    ];

    jest.spyOn(data, 'deriveWeightGoalAnalytics').mockReturnValue({
      trendSummary: {
        currentWeight: 200.0,
        priorDayWeight: null,
        avg7: 188.8,
        avg30: 177.7,
        paceFlag: null,
        priorAvg7: null,
        priorAvg30: null,
      },
      paceLevel: null,
      rollingSeries: [],
      goalInfo: null,
      calorieEstimate: null,
    });

    const component = setup({ entries });
    const root = component.root;

    expect(hasText(root, '188.8 lb')).toBe(true);
    expect(hasText(root, '177.7 lb')).toBe(true);
  });
});

describe('StatsScreen Progressive Overload — grouping and layout', () => {
  afterEach(() => jest.restoreAllMocks());

  test('exercises are grouped by routine day', () => {
    const currentNote = {
      id: 'n1',
      raw_text: 'Monday\n+ lifting\n1. bench press\n\nWednesday\n+ lifting\n1. squat',
    };
    const hookOverrides = {
      currentNote,
      trackedLifts: { 'bench press': true, 'squat': true },
    };
    const signals = [
      { name: 'Bench Press', latest_pr: 225, kilo_max: 200, latest_top_weight: 185, overload_trend: 'up' },
      { name: 'Squat', latest_pr: 315, kilo_max: 280, latest_top_weight: 225, overload_trend: 'flat' },
    ];

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals,
      nameDisplayMap: new Map([['bench press', 'Bench Press'], ['squat', 'Squat']]),
      repDropOffFlags: {},
    });

    const component = setup({ hookOverrides });
    const root = component.root;

    expect(hasText(root, 'Monday')).toBe(true);
    expect(hasText(root, 'Wednesday')).toBe(true);
    expect(hasText(root, 'Bench Press')).toBe(true);
    expect(hasText(root, 'Squat')).toBe(true);
  });

  test('multi-day exercises show cross-day summary', () => {
    const currentNote = {
      id: 'n1',
      raw_text: 'Monday\n+ lifting\n1. bench press\n\nFriday\n+ lifting\n1. bench press',
    };

    const hookOverrides = {
      currentNote,
      trackedLifts: { 'bench press': true },
    };
    const signals = [
      { name: 'Bench Press', latest_pr: 225, kilo_max: 200, latest_top_weight: 185, overload_trend: 'up' },
    ];

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals,
      nameDisplayMap: new Map([['bench press', 'Bench Press']]),
      repDropOffFlags: {},
    });

    const component = setup({ hookOverrides });
    const root = component.root;

    expect(findAllText(root).some(s => s.includes('Also on Friday'))).toBe(true);
  });
});

describe('StatsScreen 1K Progress Card', () => {
  afterEach(() => jest.restoreAllMocks());

  test('displays redesigned 1K progress with full labels', () => {
    const oneK = { total: 1000, squat: 400, bench: 300, deadlift: 300 };
    
    // Setup analytics to return the mocked oneK
    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals: [],
      nameDisplayMap: new Map(),
      repDropOffFlags: {},
    });
    jest.spyOn(data, 'derive1kTotal').mockReturnValue(oneK);

    const component = setup();
    const root = component.root;

    expect(hasText(root, '1K Progress')).toBe(true);
    expect(hasText(root, '1000')).toBe(true);
    expect(hasText(root, 'Squats')).toBe(true);
    expect(hasText(root, 'Bench')).toBe(true);
    expect(hasText(root, 'Deadlifts')).toBe(true);
  });
});
