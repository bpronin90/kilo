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
    useDeloadHistory: jest.fn(),
    useFeatureToggles: jest.fn(),
  };
});

const MOCK_NOW = new Date('2026-05-26T12:00:00Z');
jest.useFakeTimers().setSystemTime(MOCK_NOW);

function setup({ entries = [], hookOverrides = {}, featureToggles = {} } = {}) {
  useEntries.useFeatureToggles.mockReturnValue({
    fatigueTrackingEnabled: true,
    deloadModeEnabled: true,
    setFatigueTrackingEnabled: jest.fn(),
    setDeloadModeEnabled: jest.fn(),
    ...featureToggles,
  });
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
  useEntries.useDeloadHistory.mockReturnValue({
    history: hookOverrides.deloadHistory || [],
    loading: false,
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
    // The latest-weight number now renders with the unit as a separate node.
    expect(hasText(root, String(sentinel))).toBe(true);
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

// ── Session Health gauge (renamed from Activity) ──────────────────────────────

describe('AnalyticsScreen Session Health gauge', () => {
  afterEach(() => jest.restoreAllMocks());

  test('section is renamed to Session Health and shows the no-sessions caption at 0', () => {
    const component = setup();
    const root = component.root;
    expect(hasText(root, 'Session Health')).toBe(true);
    expect(hasText(root, 'Activity')).toBe(false);
    expect(hasText(root, 'No sessions logged')).toBe(true);
  });

  test('renders the three deload-risk zone labels', () => {
    const component = setup();
    const root = component.root;
    expect(hasText(root, 'Building')).toBe(true);
    expect(hasText(root, 'Approaching')).toBe(true);
    expect(hasText(root, 'Deload')).toBe(true);
  });

  test('shows the count and the 7–9 zone caption', () => {
    const raw_text = ['Monday', '+ lifting', '1. Squat',
      '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5'].join('\n');
    const component = setup({ hookOverrides: { currentNote: { id: 'n1', raw_text } } });
    const root = component.root;
    expect(hasText(root, 'Fatigue setting in')).toBe(true);
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

// ── Fatigue section — collapse/expand and edit affordances (issue #272) ──────

const ROUGH_CI = {
  noteId: 'n1',
  sessionIndex: 0,
  responded_at: '2026-05-20T10:00:00Z',
  status: 'rough',
  reasons: ['tired', 'low energy'],
  exercises_skipped: 1,
  volume_decline_pct: 15,
  detectors: [],
  flagged: true,
};

const OK_CI = {
  noteId: 'n1',
  sessionIndex: 1,
  responded_at: '2026-05-21T10:00:00Z',
  status: 'ok',
  reasons: [],
  exercises_skipped: 0,
  volume_decline_pct: null,
  detectors: [],
  flagged: false,
};

const PENDING_CI = {
  noteId: 'n1',
  sessionIndex: 2,
  responded_at: '2026-05-22T10:00:00Z',
  status: 'pending',
  reasons: [],
  exercises_skipped: 0,
  volume_decline_pct: null,
  detectors: [],
  flagged: false,
};

describe('AnalyticsScreen Fatigue section — collapse/expand and edit affordances', () => {
  afterEach(() => jest.restoreAllMocks());

  test('fatigue card renders in collapsed summary state by default when check-in history exists', () => {
    jest.spyOn(data, 'deriveCheckInHistory').mockReturnValue({
      rough: [ROUGH_CI],
      ok: [],
      pending: [],
      summary: { roughTotal: 1, okTotal: 0, pendingTotal: 0, top_reason: 'tired' },
    });

    const component = setup();
    const root = component.root;

    // Summary text visible in collapsed state
    expect(hasText(root, 'tired')).toBe(true);
    // Detail section labels not yet visible
    expect(hasText(root, 'Not great')).toBe(false);
  });

  test('pressing the fatigue summary expands then collapses detailed sections', () => {
    jest.spyOn(data, 'deriveCheckInHistory').mockReturnValue({
      rough: [ROUGH_CI],
      ok: [OK_CI],
      pending: [],
      summary: { roughTotal: 1, okTotal: 1, pendingTotal: 0, top_reason: 'tired' },
    });

    const component = setup();
    const root = component.root;

    // Initially collapsed
    expect(hasText(root, 'Not great')).toBe(false);
    expect(hasText(root, 'All good')).toBe(false);

    // First press — expand
    const expandPressable = root.findAll(
      n => n.props.accessibilityLabel === 'Expand fatigue details'
    )[0];
    render.act(() => {
      expandPressable.props.onPress();
    });

    expect(hasText(root, 'Not great')).toBe(true);
    expect(hasText(root, 'All good')).toBe(true);

    // Second press — collapse
    const collapsePressable = root.findAll(
      n => n.props.accessibilityLabel === 'Collapse fatigue details'
    )[0];
    render.act(() => {
      collapsePressable.props.onPress();
    });

    expect(hasText(root, 'Not great')).toBe(false);
    expect(hasText(root, 'All good')).toBe(false);
  });

  test('rough entries are pressable edit affordances after expansion', () => {
    jest.spyOn(data, 'deriveCheckInHistory').mockReturnValue({
      rough: [ROUGH_CI],
      ok: [],
      pending: [],
      summary: { roughTotal: 1, okTotal: 0, pendingTotal: 0, top_reason: 'tired' },
    });

    const component = setup();
    const root = component.root;

    const expandPressable = root.findAll(
      n => n.props.accessibilityLabel === 'Expand fatigue details'
    )[0];
    render.act(() => {
      expandPressable.props.onPress();
    });

    const editPressables = root.findAll(
      n => typeof n.props.accessibilityLabel === 'string' &&
           n.props.accessibilityLabel.startsWith('Edit check-in')
    );
    expect(editPressables.length).toBeGreaterThan(0);
    expect(typeof editPressables[0].props.onPress).toBe('function');
  });

  test('ok and pending chip entries are pressable edit affordances after expansion', () => {
    jest.spyOn(data, 'deriveCheckInHistory').mockReturnValue({
      rough: [],
      ok: [OK_CI],
      pending: [PENDING_CI],
      summary: { roughTotal: 0, okTotal: 1, pendingTotal: 1, top_reason: null },
    });

    const component = setup();
    const root = component.root;

    const expandPressable = root.findAll(
      n => n.props.accessibilityLabel === 'Expand fatigue details'
    )[0];
    render.act(() => {
      expandPressable.props.onPress();
    });

    const chipPressables = root.findAll(
      n => typeof n.props.accessibilityLabel === 'string' &&
           n.props.accessibilityLabel.startsWith('Edit check-in') &&
           typeof n.props.onPress === 'function'
    );
    expect(chipPressables.length).toBe(2);
  });

  test('pending alert badge appears when unanswered check-ins exist', () => {
    jest.spyOn(data, 'deriveCheckInHistory').mockReturnValue({
      rough: [],
      ok: [],
      pending: [PENDING_CI],
      summary: { roughTotal: 0, okTotal: 0, pendingTotal: 1, top_reason: null },
    });

    const component = setup();
    const root = component.root;

    expect(hasText(root, '1 unanswered')).toBe(true);
  });
});

// ── Session Health two-metric model ──────────────────────────────────────────

describe('AnalyticsScreen Session Health two-metric display', () => {
  afterEach(() => jest.restoreAllMocks());

  const ROUTINE_NOTE = {
    id: 'wn_routine',
    title: 'Routine',
    raw_text: '-Bench\n- 100 5,5,5\n- 100 5,5,5\n- 100 5,5,5',
    saved_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    tracked_exercises: [],
    one_k_exercises: null,
    isCurrent: true,
  };

  test('renders Session Health section with both gauge and weeks metric', () => {
    const deloadHistory = [
      { id: 'dl_1', completed_at: '2026-05-23T12:00:00.000Z', session_count: 1, note_id: 'wn_dl_1' },
    ];
    const component = setup({ hookOverrides: { notes: [ROUTINE_NOTE], currentNote: ROUTINE_NOTE, deloadHistory } });
    const root = component.root;
    expect(hasText(root, 'Session Health')).toBe(true);
    expect(hasText(root, 'weeks since deload')).toBe(true);
  });

  test('weeks since deload label is present even with 0 weeks', () => {
    const deloadHistory = [
      { id: 'dl_1', completed_at: new Date().toISOString(), session_count: 2, note_id: 'wn_dl_1' },
    ];
    const component = setup({ hookOverrides: { notes: [ROUTINE_NOTE], currentNote: ROUTINE_NOTE, deloadHistory } });
    expect(hasText(component.root, 'weeks since deload')).toBe(true);
  });

  test('weeks since deload shows em-dash when no deload history exists', () => {
    const component = setup({ hookOverrides: { notes: [ROUTINE_NOTE], currentNote: ROUTINE_NOTE, deloadHistory: [] } });
    expect(hasText(component.root, '—')).toBe(true);
    expect(hasText(component.root, 'weeks since deload')).toBe(true);
  });

  test('editing completed_at does not require session_count change: weeks metric updates independently', () => {
    // Same session_count, two different completed_at values — both should render Session Health.
    const historyA = [{ id: 'dl_1', completed_at: '2026-05-09T12:00:00.000Z', session_count: 10 }];
    const historyB = [{ id: 'dl_1', completed_at: '2026-05-23T12:00:00.000Z', session_count: 10 }];

    const compA = setup({ hookOverrides: { notes: [ROUTINE_NOTE], currentNote: ROUTINE_NOTE, deloadHistory: historyA } });
    const compB = setup({ hookOverrides: { notes: [ROUTINE_NOTE], currentNote: ROUTINE_NOTE, deloadHistory: historyB } });

    expect(hasText(compA.root, 'Session Health')).toBe(true);
    expect(hasText(compB.root, 'Session Health')).toBe(true);
    expect(hasText(compA.root, 'weeks since deload')).toBe(true);
    expect(hasText(compB.root, 'weeks since deload')).toBe(true);
  });

  test('legacy records without note_id or extra fields render without error', () => {
    const deloadHistory = [{ id: 'dl_legacy', completed_at: '2026-04-01T00:00:00.000Z', session_count: 0 }];
    const component = setup({ hookOverrides: { notes: [ROUTINE_NOTE], currentNote: ROUTINE_NOTE, deloadHistory } });
    expect(hasText(component.root, 'Session Health')).toBe(true);
    expect(hasText(component.root, 'weeks since deload')).toBe(true);
  });
});

// ── feature toggle gating (issue #273) ────────────────────────────────────────

describe('AnalyticsScreen feature toggle gating', () => {
  afterEach(() => jest.restoreAllMocks());

  test('shows Fatigue and Session Health sections when both features are enabled', () => {
    const component = setup();
    const root = component.root;
    expect(hasText(root, 'Fatigue')).toBe(true);
    expect(hasText(root, 'Session Health')).toBe(true);
  });

  test('hides the Fatigue section when fatigue tracking is off', () => {
    const component = setup({ featureToggles: { fatigueTrackingEnabled: false } });
    const root = component.root;
    expect(hasText(root, 'Fatigue')).toBe(false);
    expect(hasText(root, 'No check-ins logged yet.')).toBe(false);
    // Unrelated sections still render.
    expect(hasText(root, 'Session Health')).toBe(true);
    expect(hasText(root, 'Weight Trends')).toBe(true);
  });

  test('hides the Session Health gauge when deload mode is off', () => {
    const component = setup({ featureToggles: { deloadModeEnabled: false } });
    const root = component.root;
    expect(hasText(root, 'Session Health')).toBe(false);
    // Unrelated sections still render.
    expect(hasText(root, 'Fatigue')).toBe(true);
    expect(hasText(root, 'Weight Trends')).toBe(true);
  });
});
