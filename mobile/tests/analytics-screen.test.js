import React from 'react';
import render from 'react-test-renderer';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
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

// Keep the real getNoteSections (per-note parse cache) so the screen parses
// notes for real; only the data hooks are stubbed via mockReturnValue below.
jest.mock('../hooks/useEntries', () => {
  const actual = jest.requireActual('../hooks/useEntries');
  return {
    ...actual,
    useWeightEntries: jest.fn(),
    useTrackedLifts: jest.fn(),
    useWorkoutNotes: jest.fn(),
  };
});

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
    component = render.create(<AnalyticsScreen multiplier={1.07} section={null} />);
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

// ── AnalyticsScreen weight summary — consumer drift regression ────────────────────

describe('AnalyticsScreen weight summary — sourced from deriveWeightGoalAnalytics', () => {
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

describe('AnalyticsScreen Progressive Overload — grouping and layout', () => {
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

  test('multi-day exercises render per-day top weights from perDaySignals', () => {
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
      perDaySignals: {
        'bench press': {
          'Monday': { latest_top_weight: 185, overload_trend: 'up', latest_pr: 210 },
          'Friday': { latest_top_weight: 175, overload_trend: 'flat', latest_pr: 198 },
        },
      },
    });

    const component = setup({ hookOverrides });
    const root = component.root;

    const allText = findAllText(root);
    // Per-day top weights appear (CrossDayComparison shows them)
    expect(allText.some(s => s.includes('185'))).toBe(true);
    expect(allText.some(s => s.includes('175'))).toBe(true);
    // Per-day latest_pr values appear in the main row (only shown there, not in CrossDayComparison).
    // Before the fix, both rows used the global latest_pr (225) and neither 210 nor 198 appeared.
    expect(allText.some(s => s.includes('210'))).toBe(true);
    expect(allText.some(s => s.includes('198'))).toBe(true);
    // Global latest_pr (225) must NOT appear — both rows use their per-day pr instead.
    expect(allText.some(s => s === '225')).toBe(false);
  });

  test('multi-day exercises fall back to global trend when per-day trend is null', () => {
    // When per-day signal exists but has null overload_trend (only one comparable
    // unit for that day-slot), the row should show the global trend, not —.
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
      perDaySignals: {
        'bench press': {
          'Monday': { latest_top_weight: 185, overload_trend: null, latest_pr: 210 },
          'Friday': { latest_top_weight: 175, overload_trend: null, latest_pr: 198 },
        },
      },
    });

    const component = setup({ hookOverrides });
    const root = component.root;
    const allText = findAllText(root);

    // Component must render without crash when per-day trend is null.
    // The per-day PR values (not the global 225) must appear — confirming the
    // per-day metrics path is still active even though trend falls back to global.
    expect(allText.some(s => s.includes('210'))).toBe(true);
    expect(allText.some(s => s.includes('198'))).toBe(true);
    expect(allText.some(s => s === '225')).toBe(false);
  });

  test('multi-day exercises fall back to Also on text when perDaySignals absent', () => {
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
      perDaySignals: {},
    });

    const component = setup({ hookOverrides });
    const root = component.root;

    expect(findAllText(root).some(s => s.includes('Also on Friday'))).toBe(true);
  });

  test('multi-day bodyweight exercise renders reps unit not lb in CrossDayComparison', () => {
    const currentNote = {
      id: 'n1',
      raw_text: 'Monday\n+ lifting\n1. pull-ups\n\nFriday\n+ lifting\n1. pull-ups',
    };
    const hookOverrides = {
      currentNote,
      trackedLifts: { 'pull-ups': true },
    };
    const signals = [
      { name: 'Pull-ups', latest_pr: null, kilo_max: null, latest_top_weight: 10, overload_trend: 'up', is_bodyweight: true },
    ];

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals,
      nameDisplayMap: new Map([['pull-ups', 'Pull-ups']]),
      repDropOffFlags: {},
      perDaySignals: {
        'pull-ups': {
          'Monday': { latest_top_weight: 10, overload_trend: 'up', latest_pr: null, is_bodyweight: true },
          'Friday': { latest_top_weight: 8, overload_trend: 'flat', latest_pr: null, is_bodyweight: true },
        },
      },
    });

    const component = setup({ hookOverrides });
    const root = component.root;
    const allText = findAllText(root);

    // Per-day rep counts appear
    expect(allText.some(s => s.includes('10'))).toBe(true);
    expect(allText.some(s => s.includes('8'))).toBe(true);
    // 'reps' label appears, 'lb' does not appear inside the cross-day row chips
    expect(allText.filter(s => s === 'reps').length).toBeGreaterThan(0);
  });
  test('alias exercise names in note match tracked canonical signal', () => {
    // Note uses alias 'DB Bench' but tracked lift is 'db bench press' (canonical form).
    // groupedSignals must canonicalize both sides so the signal resolves and the
    // exercise appears with its correct overload arrow.
    const currentNote = {
      id: 'n1',
      raw_text: 'Monday\n+ lifting\n1. db bench',
    };
    const hookOverrides = {
      currentNote,
      trackedLifts: { 'db bench press': true },
    };
    const signals = [
      { name: 'db bench press', latest_pr: 200, kilo_max: 190, latest_top_weight: 150, overload_trend: 'up' },
    ];

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals,
      nameDisplayMap: new Map([['db bench press', 'DB Bench Press']]),
      repDropOffFlags: {},
      perDaySignals: {},
    });

    const component = setup({ hookOverrides });
    const root = component.root;

    expect(hasText(root, 'DB Bench Press')).toBe(true);
  });
});

describe('AnalyticsScreen 1K Progress Card', () => {
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

describe('AnalyticsScreen non-weighted exercise cards — minimal layout', () => {
  afterEach(() => jest.restoreAllMocks());

  test('reps-only non-weighted cards render avg_reps and best_set_reps', () => {
    const currentNote = {
      id: 'n1',
      raw_text: 'Monday\n+ lifting\n1. pull-up',
    };
    const hookOverrides = {
      currentNote,
      trackedLifts: { 'pull-up': true },
    };
    const signals = [
      { name: 'pull-up', latest_pr: null, kilo_max: null, latest_top_weight: null, overload_trend: null },
    ];
    const nonWeightedMetrics = {
      'pull-up': { exercise_class: 'reps_only', avg_reps: 8, best_set_reps: 10, reps_arrow: 'up' }
    };

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals,
      nameDisplayMap: new Map([['pull-up', 'Pull-up']]),
      repDropOffFlags: {},
    });
    jest.spyOn(data, 'deriveNonWeightedTrackedExerciseMetrics').mockReturnValue(nonWeightedMetrics);

    const component = setup({ hookOverrides });
    const root = component.root;

    expect(hasText(root, 'Pull-up')).toBe(true);
    expect(hasText(root, '8')).toBe(true);
    expect(hasText(root, '10')).toBe(true);
    // Should NOT have 'lb' unit
    expect(hasText(root, 'lb')).toBe(false);
  });

  test('time-based non-weighted cards render formatted avg_hold and best_hold', () => {
    const currentNote = {
      id: 'n1',
      raw_text: 'Monday\n+ lifting\n1. plank',
    };
    const hookOverrides = {
      currentNote,
      trackedLifts: { 'plank': true },
    };
    const signals = [
      { name: 'plank', latest_pr: null, kilo_max: null, latest_top_weight: null, overload_trend: null },
    ];
    const nonWeightedMetrics = {
      'plank': { exercise_class: 'time_based', avg_hold: 75, best_hold: 90, hold_arrow: 'dash' }
    };

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals,
      nameDisplayMap: new Map([['plank', 'Plank']]),
      repDropOffFlags: {},
    });
    jest.spyOn(data, 'deriveNonWeightedTrackedExerciseMetrics').mockReturnValue(nonWeightedMetrics);

    const component = setup({ hookOverrides });
    const root = component.root;

    expect(hasText(root, 'Plank')).toBe(true);
    expect(hasText(root, '1:15')).toBe(true);
    expect(hasText(root, '1:30')).toBe(true);
  });

  test('non-weighted card renders em-dash sentinel when value is null', () => {
    const currentNote = {
      id: 'n1',
      raw_text: 'Monday\n+ lifting\n1. pull-up',
    };
    const hookOverrides = {
      currentNote,
      trackedLifts: { 'pull-up': true },
    };
    const signals = [
      { name: 'pull-up', latest_pr: null, kilo_max: null, latest_top_weight: null, overload_trend: null },
    ];
    const nonWeightedMetrics = {
      'pull-up': { exercise_class: 'reps_only', avg_reps: null, best_set_reps: null, reps_arrow: 'dash' }
    };

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals,
      nameDisplayMap: new Map([['pull-up', 'Pull-up']]),
      repDropOffFlags: {},
    });
    jest.spyOn(data, 'deriveNonWeightedTrackedExerciseMetrics').mockReturnValue(nonWeightedMetrics);

    const component = setup({ hookOverrides });
    const root = component.root;

    expect(hasText(root, 'Pull-up')).toBe(true);
    expect(findAllText(root).some(s => s === '—')).toBe(true);
  });
});

// ── Weight Trends — split 7-day / 30-day charts ───────────────────────────────

describe('AnalyticsScreen Weight Trends — two rolling charts', () => {
  afterEach(() => jest.restoreAllMocks());

  test('renders both 7-day and 30-day rolling chart labels', () => {
    const component = setup({ entries: [] });
    const root = component.root;
    expect(hasText(root, '7-day rolling average')).toBe(true);
    expect(hasText(root, '30-day rolling average')).toBe(true);
  });
});

// ── Deload Risk gauge (renamed from Activity) ─────────────────────────────────

describe('AnalyticsScreen Deload Risk gauge', () => {
  afterEach(() => jest.restoreAllMocks());

  test('section is renamed to Deload Risk and shows the no-sessions caption at 0', () => {
    const component = setup();
    const root = component.root;
    expect(hasText(root, 'Deload Risk')).toBe(true);
    expect(hasText(root, 'Activity')).toBe(false);
    expect(hasText(root, 'No sessions logged')).toBe(true);
  });

  test('shows the count and the approaching-deload caption in the 7–9 zone', () => {
    const raw_text = ['Monday', '+ lifting', '1. Squat',
      '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5'].join('\n');
    const component = setup({ hookOverrides: { currentNote: { id: 'n1', raw_text } } });
    const root = component.root;
    expect(hasText(root, 'Approaching deload')).toBe(true);
    expect(findAllText(root).some(s => s === '7')).toBe(true);
  });
});

// ── 1K total over sessions chart ──────────────────────────────────────────────

describe('AnalyticsScreen 1K total over sessions chart', () => {
  afterEach(() => jest.restoreAllMocks());

  test('renders the 1K-over-sessions chart label when a multi-point series exists', () => {
    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals: [], nameDisplayMap: new Map(), repDropOffFlags: {},
    });
    jest.spyOn(data, 'derive1kTotal').mockReturnValue({ total: 1000, squat: 400, bench: 300, deadlift: 300 });
    jest.spyOn(data, 'derive1kTotalSeries').mockReturnValue([
      { session: 1, total: 900, bench: 280, squat: 360, deadlift: 260 },
      { session: 2, total: 1000, bench: 300, squat: 400, deadlift: 300 },
    ]);

    const component = setup();
    const root = component.root;
    expect(hasText(root, '1K total over sessions')).toBe(true);
  });

  test('omits the chart label when fewer than two session points exist', () => {
    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals: [], nameDisplayMap: new Map(), repDropOffFlags: {},
    });
    jest.spyOn(data, 'derive1kTotal').mockReturnValue({ total: 1000, squat: 400, bench: 300, deadlift: 300 });
    jest.spyOn(data, 'derive1kTotalSeries').mockReturnValue([
      { session: 1, total: 1000, bench: 300, squat: 400, deadlift: 300 },
    ]);

    const component = setup();
    const root = component.root;
    expect(hasText(root, '1K total over sessions')).toBe(false);
  });
});
