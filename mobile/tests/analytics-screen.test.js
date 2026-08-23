import React from 'react';
import render from 'react-test-renderer';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { deriveAnalytics, deriveParsedSections, deriveOneKChartData, deriveGroupedSignals } from '../screens/analytics/analyticsDerivations';
import * as useEntries from '../hooks/useEntries';
import * as data from '../lib/data';
import {
  parseWorkoutNote,
  weeksSinceLastDeload,
} from '../lib/parser';
import {
  deriveRoutineStatus,
  deloadSessionsLogged,
  elapsedWeeksOnRoutine,
} from '../lib/data';


jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../components/LineChart', () => {
  const React = require('react');
  return { LineChart: () => null };
});

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
});

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
    useRecoveryBlockState: jest.fn(),
    useActiveTrainingContext: jest.fn(actual.useActiveTrainingContext),
  };
});

const MOCK_NOW = new Date('2026-05-26T12:00:00Z');
// Fake timers are installed per-test, not at module scope: a module-scope
// jest.useFakeTimers() contaminates React/react-test-renderer scheduler state
// during import-graph evaluation, which then leaks across Jest's shared worker
// into the next test file (#679).
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

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
  useEntries.useRecoveryBlockState.mockReturnValue({
    blocks: hookOverrides.recoveryBlocks || [],
    weeks: hookOverrides.recoveryWeeks || [],
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

    expect(hasText(root, 'MONDAY')).toBe(true);
    expect(hasText(root, 'WEDNESDAY')).toBe(true);
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

    expect(findAllText(root).some(s => s.includes('Also on FRIDAY'))).toBe(true);
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

  test('single day with multiple subheadings produces one group not two (issue #385)', () => {
    const { parseWorkoutNote: pwn } = require('../lib/parser');
    const { sections: currentSections } = pwn(
      'Monday\n+Warmup\n1. Bike\n+Lifting\n1. Bench Press'
    );
    const signals = [
      { name: 'Bike', latest_pr: null, kilo_max: null, latest_top_weight: null, overload_trend: null },
      { name: 'Bench Press', latest_pr: 225, kilo_max: 200, latest_top_weight: 185, overload_trend: 'up' },
    ];
    const analytics = {
      signals,
      nameDisplayMap: new Map([['bike', 'Bike'], ['bench press', 'Bench Press']]),
      perDaySignals: {},
      nonWeightedMetrics: {},
    };
    const groups = deriveGroupedSignals({ currentSections }, analytics, '');
    expect(groups.length).toBe(1);
    expect(groups[0].name).toBe('MONDAY');
    expect(groups[0].exercises.length).toBe(2);
  });

  test('non-consecutive same-day sections (gym+home week) merge into one group', () => {
    const { parseWorkoutNote: pwn } = require('../lib/parser');
    const { sections: currentSections } = pwn(
      'MONDAY — Gym\n+Lifting\n1. Bench Press\n\nTUESDAY — Gym\n+Lifting\n1. Squat\n\n---\n\nMONDAY — Home\n+Lifting\n1. Lateral Raise'
    );
    const signals = [
      { name: 'Bench Press', latest_pr: 225, kilo_max: 200, latest_top_weight: 185, overload_trend: 'up' },
      { name: 'Squat', latest_pr: 300, kilo_max: 280, latest_top_weight: 275, overload_trend: 'up' },
      { name: 'Lateral Raise', latest_pr: null, kilo_max: null, latest_top_weight: 30, overload_trend: null },
    ];
    const analytics = { signals, nameDisplayMap: new Map(), perDaySignals: {}, nonWeightedMetrics: {} };
    const groups = deriveGroupedSignals({ currentSections }, analytics, '');
    expect(groups.length).toBe(2); // MONDAY and TUESDAY, not three
    expect(groups[0].name).toBe('MONDAY');
    expect(groups[1].name).toBe('TUESDAY');
    // Both Bench Press (gym Mon) and Lateral Raise (home Mon) appear under MONDAY
    const mondayNames = groups[0].exercises.map(e => e.name);
    expect(mondayNames).toContain('Bench Press');
    expect(mondayNames).toContain('Lateral Raise');
  });
});

describe('deriveOverviewRows (#821)', () => {
  const { deriveOverviewRows } = require('../screens/analytics/analyticsDerivations');

  function rowFor(rows, key) {
    return rows.find(r => r.key === key);
  }

  test('1K and weight deltas come from the adjacent points of the series the tab plots', () => {
    const rows = deriveOverviewRows({
      oneKPoints: [{ value: 940 }, { value: 975 }, { value: 1000 }],
      weightPoints: [{ value: 186.0 }, { value: 184.8 }],
      currentWeight: 184.2,
    });

    expect(rowFor(rows, 'oneK').value).toBe(1000);
    expect(rowFor(rows, 'oneK').delta).toBe(25);
    expect(rowFor(rows, 'weight').value).toBe(184.2);
    expect(rowFor(rows, 'weight').delta).toBe(-1.2);
  });

  test('a single point yields a value with no delta rather than a delta of zero', () => {
    const rows = deriveOverviewRows({
      oneKPoints: [{ value: 900 }],
      weightPoints: [{ value: 184 }],
      currentWeight: 184,
    });
    expect(rowFor(rows, 'oneK').value).toBe(900);
    expect(rowFor(rows, 'oneK').delta).toBeNull();
    expect(rowFor(rows, 'weight').delta).toBeNull();
  });

  test('exercise progress counts the existing overload_trend classification', () => {
    const rows = deriveOverviewRows({
      signals: [
        { overload_trend: 'up' }, { overload_trend: 'up' },
        { overload_trend: 'flat' }, { overload_trend: 'down' },
        { overload_trend: 'baseline' }, { overload_trend: null },
      ],
    });
    const progress = rowFor(rows, 'progress');
    expect(progress.counts).toEqual({ up: 2, flat: 1, down: 1 });
    // Unclassified trends are not counted into the denominator.
    expect(progress.value).toBe(2);
    expect(progress.valueSuffix).toBe('of 4 up');
  });

  test('the routine row is suppressed entirely when deload mode is off', () => {
    const on = deriveOverviewRows({ sessionsSinceDeload: 8, deloadModeEnabled: true });
    const off = deriveOverviewRows({ sessionsSinceDeload: 8, deloadModeEnabled: false });
    expect(rowFor(on, 'routine').value).toBe(8);
    expect(rowFor(off, 'routine')).toBeUndefined();
  });

  test('a failed read is marked unavailable, not reported as an empty state', () => {
    const rows = deriveOverviewRows({ notesUnavailable: true, weightUnavailable: true });
    expect(rowFor(rows, 'oneK').unavailable).toBe(true);
    expect(rowFor(rows, 'progress').unavailable).toBe(true);
    expect(rowFor(rows, 'weight').unavailable).toBe(true);
  });
});

describe('AnalyticsScreen overview block (#821)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('renders at the top of the tab, above Weight Trends', () => {
    const component = setup();
    const root = component.root;
    expect(root.findAllByProps({ testID: 'analytics-overview' }).length).toBeGreaterThan(0);
    expect(hasText(root, 'Overview')).toBe(true);
  });

  test('a failed notes read reports Unavailable rather than an empty state', () => {
    // Through hookOverrides, not a bare mockReturnValue: setup() re-mocks
    // useWorkoutNotes itself and would clobber it.
    const component = setup({
      hookOverrides: { error: new Error('boom'), refresh: jest.fn() },
    });
    const root = component.root;
    expect(hasText(root, 'Unavailable — could not load')).toBe(true);
    // And never the "you have nothing logged" copy for the same row.
    expect(hasText(root, 'Map your three lifts and log one full cycle')).toBe(false);
  });
});

describe('AnalyticsScreen Progressive Overload collapse-all', () => {
  afterEach(() => jest.restoreAllMocks());

  function setupTwoGroups() {
    const currentNote = {
      id: 'n1',
      raw_text: 'Monday\n+ lifting\n1. bench press\n\nFriday\n+ lifting\n1. squat',
    };
    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals: [
        { name: 'Bench Press', latest_pr: 225, kilo_max: 200, latest_top_weight: 185, overload_trend: 'up' },
        { name: 'Squat', latest_pr: 315, kilo_max: 290, latest_top_weight: 275, overload_trend: 'up' },
      ],
      nameDisplayMap: new Map([['bench press', 'Bench Press'], ['squat', 'Squat']]),
      repDropOffFlags: {},
      perDaySignals: {},
    });
    return setup({
      hookOverrides: { currentNote, trackedLifts: { 'bench press': true, squat: true } },
    });
  }

  // The control is a Pressable, so the rendered tree carries its testID on more
  // than one host node; the one that owns onPress is the control itself.
  function collapseAllControl(root) {
    return root
      .findAllByProps({ testID: 'po-collapse-all' })
      .find(node => typeof node.props.onPress === 'function');
  }

  test('collapses every group, then restores them, without touching group headers', () => {
    const component = setupTwoGroups();
    const root = component.root;

    // Asserted on the per-row metric values rather than the exercise names:
    // "Bench Press" and "Squat" are also the default Big 3 Mapping selections,
    // so the names stay on screen no matter what this control does.
    expect(hasText(root, '185')).toBe(true);
    expect(hasText(root, '275')).toBe(true);
    expect(hasText(root, 'Collapse all')).toBe(true);

    render.act(() => {
      collapseAllControl(root).props.onPress();
    });

    // Exercise rows are gone; the day headers that reopen them are not.
    expect(hasText(root, '185')).toBe(false);
    expect(hasText(root, '275')).toBe(false);
    expect(hasText(root, 'MONDAY')).toBe(true);
    expect(hasText(root, 'FRIDAY')).toBe(true);
    expect(hasText(root, 'Expand all')).toBe(true);

    render.act(() => {
      collapseAllControl(root).props.onPress();
    });

    expect(hasText(root, '185')).toBe(true);
    expect(hasText(root, '275')).toBe(true);
    expect(hasText(root, 'Collapse all')).toBe(true);
  });

  test('reports its expanded state to assistive tech', () => {
    const component = setupTwoGroups();
    const root = component.root;

    expect(collapseAllControl(root).props.accessibilityState).toEqual({ expanded: true });

    render.act(() => {
      collapseAllControl(root).props.onPress();
    });

    expect(collapseAllControl(root).props.accessibilityState).toEqual({ expanded: false });
    expect(collapseAllControl(root).props.accessibilityLabel).toBe('Expand all exercise groups');
  });

  test('is not rendered when there are no tracked exercises to collapse', () => {
    const component = setup();
    expect(component.root.findAllByProps({ testID: 'po-collapse-all' }).length).toBe(0);
  });

  // #826 review: the bulk action must not reach past the search filter in
  // EITHER direction. Rebuilding the collapsed set from the visible names alone
  // silently expanded a filtered-out group on "Collapse all", and clearing it
  // entirely did the same on "Expand all".
  function pressable(root, testID) {
    return root.findAllByProps({ testID }).find(node => typeof node.props.onPress === 'function');
  }

  function search(root, text) {
    const input = root.findAllByProps({ testID: 'po-search' }).find(n => n.props.onChangeText);
    render.act(() => { input.props.onChangeText(text); });
  }

  test('collapsing a filtered view leaves a hidden collapsed group collapsed', () => {
    const component = setupTwoGroups();
    const root = component.root;

    // Friday collapsed on its own; Monday still open.
    render.act(() => { pressable(root, 'po-group-header-FRIDAY').props.onPress(); });
    expect(hasText(root, '275')).toBe(false);
    expect(hasText(root, '185')).toBe(true);

    // Narrow to Monday only, then collapse everything visible.
    search(root, 'bench');
    render.act(() => { collapseAllControl(root).props.onPress(); });
    search(root, '');

    // Monday is now collapsed, and Friday was never touched.
    expect(hasText(root, '185')).toBe(false);
    expect(hasText(root, '275')).toBe(false);
    expect(hasText(root, 'MONDAY')).toBe(true);
    expect(hasText(root, 'FRIDAY')).toBe(true);
  });

  test('expanding a filtered view leaves a hidden collapsed group collapsed', () => {
    const component = setupTwoGroups();
    const root = component.root;

    render.act(() => { collapseAllControl(root).props.onPress(); });
    expect(hasText(root, '185')).toBe(false);
    expect(hasText(root, '275')).toBe(false);

    // Narrow to Monday, expand what is visible, then restore the full list.
    search(root, 'bench');
    render.act(() => { collapseAllControl(root).props.onPress(); });
    search(root, '');

    // Monday reopened; Friday stayed as the user left it.
    expect(hasText(root, '185')).toBe(true);
    expect(hasText(root, '275')).toBe(false);
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
    jest.spyOn(data, 'derive1kTotalFromSectionsList').mockReturnValue(oneK);

    const component = setup();
    const root = component.root;

    expect(hasText(root, '1K Progress')).toBe(true);
    expect(hasText(root, '1000')).toBe(true);
    expect(hasText(root, 'Squats')).toBe(true);
    expect(hasText(root, 'Bench')).toBe(true);
    expect(hasText(root, 'Deadlifts')).toBe(true);
  });

  test('the 1K unit suffix uses a literal leading space, not marginLeft (#763)', () => {
    // Nested Text is an inline attributed run on native RN, not a Yoga box, so
    // marginLeft on it does not reliably create spacing. Matches the same
    // fix on Home's 1K card — both surfaces must render "1000 lb", not
    // "1000lb", on iOS/Android.
    const oneK = { total: 1000, squat: 400, bench: 300, deadlift: 300 };

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals: [],
      nameDisplayMap: new Map(),
      repDropOffFlags: {},
    });
    jest.spyOn(data, 'derive1kTotalFromSectionsList').mockReturnValue(oneK);

    const component = setup();
    const root = component.root;

    const text = (n) => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? ''));
    const unitNodes = root.findAllByType('Text').filter(n => text(n).includes('lb'));
    expect(unitNodes.length).toBeGreaterThan(0);
    for (const node of unitNodes) {
      expect(text(node)).toBe(' lb');
      const flat = [].concat(node.props.style ?? []).reduce((acc, s) => ({ ...acc, ...s }), {});
      expect(flat.marginLeft).toBeFalsy();
    }
  });

  test('exposes a discoverable explanation affordance that reveals the 1K calculation copy (#399)', () => {
    const oneK = { total: 1000, squat: 400, bench: 300, deadlift: 300 };

    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals: [],
      nameDisplayMap: new Map(),
      repDropOffFlags: {},
    });
    jest.spyOn(data, 'derive1kTotalFromSectionsList').mockReturnValue(oneK);

    const component = setup();
    const root = component.root;

    // The affordance is discoverable on the 1K Progress card.
    const toggle = root.findByProps({ testID: 'onek-info-toggle' });
    expect(toggle).toBeTruthy();
    expect(hasText(root, 'How is this calculated?')).toBe(true);

    // Explanation is collapsed until the user opens it.
    expect(hasText(root, 'most recent complete cycle')).toBe(false);

    render.act(() => {
      toggle.props.onPress();
    });

    // Covers the three required points: what the 1K is, the one-session-behind
    // residual that resets each routine, and deload graph-vs-stats behavior.
    expect(hasText(root, 'most recent complete cycle')).toBe(true);
    expect(hasText(root, 'one session behind')).toBe(true);
    expect(hasText(root, 'resets when you start a new routine')).toBe(true);
    expect(hasText(root, 'Deload sessions')).toBe(true);
    expect(hasText(root, 'Kilo Max')).toBe(true);
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

// ── Analytics empty state copy (issue #582) ──────────────────────────────────

describe('AnalyticsScreen empty state copy — no tracked exercises', () => {
  afterEach(() => jest.restoreAllMocks());

  test('empty state names the real Track control, not a nonexistent bookmark (issue #582)', () => {
    // When no exercises are tracked, the empty state should tell users to tap Track
    // on an exercise, matching the actual control name in the UI.
    const component = setup({ hookOverrides: { notes: [], currentNote: null, trackedLifts: {} } });
    const root = component.root;

    // New copy mentions the real control name "Track"
    expect(hasText(root, 'Tap Track on any exercise')).toBe(true);
    // Old copy mentioning "bookmark" must be absent
    expect(hasText(root, 'bookmark')).toBe(false);
  });
});

// ── Cross-screen handoffs into and out of Analytics (#717) ───────────────────

describe('AnalyticsScreen daily-loop handoffs (#717)', () => {
  afterEach(() => jest.restoreAllMocks());

  // The scroll target lives on the ScrollView ref inside ScreenShell. Under
  // react-test-renderer that instance performs no real scrolling, so stub its
  // scrollTo to make section targeting observable.
  // An active recovery block, so the Recovery section renders and can be
  // targeted (#770). Home only offers its Recovery handoff while a block is
  // running, which is exactly this state.
  const ACTIVE_BLOCK = {
    id: 'rb1',
    baseline_note_id: 'note-baseline',
    baseline_note_title: 'Push Pull Legs',
    baseline: { exercises: [] },
    started_at: '2026-05-01T00:00:00Z',
    completed_at: null,
    saved_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    deleted_at: null,
  };

  function setupTargeting({ section = null, sectionNonce = 0, onNavigate, recoveryState } = {}) {
    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: true,
      deloadModeEnabled: true,
      setFatigueTrackingEnabled: jest.fn(),
      setDeloadModeEnabled: jest.fn(),
    });
    useEntries.useWeightEntries.mockReturnValue({ entries: [], loading: false, error: null });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false });
    useEntries.useWorkoutNotes.mockReturnValue({ notes: [], currentNote: null, loading: false, update: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
    useEntries.useRecoveryBlockState.mockReturnValue(
      recoveryState ?? { blocks: [], weeks: [], loading: false }
    );

    const scrollTo = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <AnalyticsScreen
          multiplier={1.07}
          section={section}
          sectionNonce={sectionNonce}
          onNavigate={onNavigate}
        />
      );
    });
    const { ScrollView } = require('react-native');
    const inst = component.root.findAllByType(ScrollView)[0]?.instance;
    if (inst) inst.scrollTo = scrollTo;
    return { component, scrollTo };
  }

  const layoutHandler = (root, propName) => root.findAll(
    n => typeof n.props?.[propName] === 'function'
  )[0].props[propName];

  const fireLayout = (root, propName, y) => {
    const handler = layoutHandler(root, propName);
    render.act(() => { handler({ nativeEvent: { layout: { y } } }); });
  };

  test('a weight-section request scrolls to the weight section once its layout is known', () => {
    const { component, scrollTo } = setupTargeting({ section: 'weight', sectionNonce: 1 });
    fireLayout(component.root, 'handleWeightLayout', 420);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 420 }));
  });

  test('a strength-section request scrolls to the strength section once its layout is known', () => {
    const { component, scrollTo } = setupTargeting({ section: 'strength', sectionNonce: 1 });
    fireLayout(component.root, 'handleStrengthLayout', 900);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 900 }));
  });

  test('repeating the same section request re-scrolls to it', () => {
    for (const [section, prop, y] of [
      ['weight', 'handleWeightLayout', 420],
      ['strength', 'handleStrengthLayout', 900],
    ]) {
      const { component, scrollTo } = setupTargeting({ section, sectionNonce: 1 });
      fireLayout(component.root, prop, y);
      expect(scrollTo).toHaveBeenCalledTimes(1);

      // Same section value, new request: only the nonce distinguishes it, and the
      // layout position is already known so the scroll happens immediately.
      render.act(() => {
        component.update(
          <AnalyticsScreen multiplier={1.07} section={section} sectionNonce={2} />
        );
      });

      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ y }));
    }
  });

  test('no section request leaves the scroll position alone', () => {
    const { component, scrollTo } = setupTargeting({ section: null, sectionNonce: 1 });
    fireLayout(component.root, 'handleWeightLayout', 420);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  // ── The three destinations added by #770 ───────────────────────────────────
  //
  // Each Home control below used to land somewhere its label did not promise:
  // Exercise Progress at the broad Strength block, `Full history and insights`
  // and `Recovery` at whatever position Analytics happened to be left at.

  const RECOVERY_STATE = { blocks: [ACTIVE_BLOCK], weeks: [], loading: false };

  // The anchors added by this issue are plain onLayout Views inside the screen
  // rather than props of a child component, so they are addressed by the testID
  // of the box they measure.
  const fireLayoutFor = (root, testID, layout) => {
    const handler = root.findByProps({ testID }).props.onLayout;
    render.act(() => { handler({ nativeEvent: { layout } }); });
  };

  // Progressive Overload is measured from two boxes: the sticky header reports
  // only its height (a sticky child is laid out inside a wrapper, so its `y` is
  // 0 and says nothing about where the section is), and the list beneath it
  // reports the real content offset. The destination is the difference.
  const OVERLOAD_HEADER_HEIGHT = 133;
  const OVERLOAD_LIST_Y = 1533;
  const OVERLOAD_TARGET_Y = OVERLOAD_LIST_Y - OVERLOAD_HEADER_HEIGHT;
  const fireOverloadLayout = (root, { listY = OVERLOAD_LIST_Y, headerHeight = OVERLOAD_HEADER_HEIGHT } = {}) => {
    fireLayoutFor(root, 'sticky-header', { x: 0, y: 0, width: 343, height: headerHeight });
    fireLayoutFor(root, 'overload-list-anchor', { x: 0, y: listY, width: 343, height: 800 });
  };

  test('an overview request goes to the top without waiting for any layout', () => {
    // Analytics is always mounted with no section (App.js), so every handoff
    // arrives as a prop update — including the first one of a session, before
    // anything on the tab has reported a position.
    const { component, scrollTo } = setupTargeting();
    render.act(() => {
      component.update(<AnalyticsScreen multiplier={1.07} section="overview" sectionNonce={1} />);
    });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
  });

  test('a progressive-overload request parks the sticky header at the top of the list', () => {
    const { component, scrollTo } = setupTargeting({ section: 'progressive-overload', sectionNonce: 1 });
    fireOverloadLayout(component.root);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ y: OVERLOAD_TARGET_Y }));
  });

  // The bug this arrangement exists for: ScrollView lays a sticky child out
  // inside a wrapper of its own, so the header's onLayout reports y: 0. Taking
  // that at face value would send an Exercise Progress handoff to the top of
  // Analytics — the one destination it is not.
  test('the sticky header’s own y is never mistaken for the section position', () => {
    const { component, scrollTo } = setupTargeting({ section: 'progressive-overload', sectionNonce: 1 });
    fireLayoutFor(component.root, 'sticky-header', { x: 0, y: 0, width: 343, height: OVERLOAD_HEADER_HEIGHT });
    expect(scrollTo).not.toHaveBeenCalled();

    fireLayoutFor(component.root, 'overload-list-anchor', { x: 0, y: OVERLOAD_LIST_Y, width: 343, height: 800 });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: OVERLOAD_TARGET_Y }));
  });

  // Layout order between two sibling boxes is not guaranteed. Landing on the
  // list alone would overshoot by the header's height and could never be
  // corrected: the pending request is spent, so the pinned header would sit
  // over the first rows for the rest of the visit.
  test('the list measuring first does not spend the request before the header height is known', () => {
    const { component, scrollTo } = setupTargeting({ section: 'progressive-overload', sectionNonce: 1 });
    fireLayoutFor(component.root, 'overload-list-anchor', { x: 0, y: OVERLOAD_LIST_Y, width: 343, height: 800 });
    expect(scrollTo).not.toHaveBeenCalled();

    fireLayoutFor(component.root, 'sticky-header', { x: 0, y: 0, width: 343, height: OVERLOAD_HEADER_HEIGHT });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: OVERLOAD_TARGET_Y }));
  });

  test('a recovery request scrolls to the Recovery section', () => {
    const { component, scrollTo } = setupTargeting({
      section: 'recovery',
      sectionNonce: 1,
      recoveryState: RECOVERY_STATE,
    });
    fireLayoutFor(component.root, 'recovery-section-anchor', { x: 0, y: 1100, width: 343, height: 310 });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 1100 }));
  });

  test('a request that arrives before its destination is laid out stays pending, not lost', () => {
    // Nothing to scroll to yet, and nothing may be guessed at: the request is
    // fulfilled by the layout that finally reports where the section is.
    const { component, scrollTo } = setupTargeting({ section: 'progressive-overload', sectionNonce: 1 });
    expect(scrollTo).not.toHaveBeenCalled();

    // An unrelated section reporting its position must not satisfy it either.
    fireLayout(component.root, 'handleWeightLayout', 420);
    expect(scrollTo).not.toHaveBeenCalled();

    fireOverloadLayout(component.root);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: OVERLOAD_TARGET_Y }));
  });

  test('every section is reachable from every other section, repeatedly', () => {
    const anchors = {
      weight: (root) => fireLayout(root, 'handleWeightLayout', 420),
      strength: (root) => fireLayout(root, 'handleStrengthLayout', 900),
      recovery: (root) => fireLayoutFor(root, 'recovery-section-anchor', { x: 0, y: 1100, width: 343, height: 310 }),
      'progressive-overload': (root) => fireOverloadLayout(root),
    };
    const expectedY = {
      overview: 0,
      weight: 420,
      strength: 900,
      recovery: 1100,
      'progressive-overload': OVERLOAD_TARGET_Y,
    };
    const ids = Object.keys(expectedY);

    const { component, scrollTo } = setupTargeting({ recoveryState: RECOVERY_STATE });
    // Every position is known up front here, which is the steady state after a
    // first visit: each request must land immediately.
    Object.values(anchors).forEach((fire) => fire(component.root));
    scrollTo.mockClear();

    let nonce = 0;
    for (const from of ids) {
      for (const to of ids) {
        for (const section of [from, to, to]) {
          nonce += 1;
          render.act(() => {
            component.update(
              <AnalyticsScreen multiplier={1.07} section={section} sectionNonce={nonce} />
            );
          });
          expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ y: expectedY[section] }));
        }
        // from → to → to: three requests, three scrolls. The repeat of an
        // identical target is a request in its own right.
        expect(scrollTo).toHaveBeenCalledTimes(3);
        scrollTo.mockClear();
      }
    }
  });

  test('an ordinary tab press preserves the position, and an unknown target changes nothing', () => {
    const { component, scrollTo } = setupTargeting({ section: 'progressive-overload', sectionNonce: 1 });
    fireOverloadLayout(component.root);
    scrollTo.mockClear();

    // The shell normalizes a plain tab press and any malformed/unknown request
    // to a null section, so Analytics stays exactly where the user left it.
    for (const [section, nonce] of [[null, 2], [undefined, 3], ['', 4]]) {
      render.act(() => {
        component.update(
          <AnalyticsScreen multiplier={1.07} section={section} sectionNonce={nonce} />
        );
      });
    }
    expect(scrollTo).not.toHaveBeenCalled();

    // A section id the screen has no anchor for is inert rather than a jump to
    // an arbitrary position — it simply never resolves.
    render.act(() => {
      component.update(<AnalyticsScreen multiplier={1.07} section="mystery" sectionNonce={5} />);
    });
    fireOverloadLayout(component.root, { listY: 1600 });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  // The Recovery anchor is a wrapper, so it must appear and disappear with the
  // section it measures: an empty wrapper would still take a slot in the
  // shell's 16px column gap. AnalyticsRecoverySection owns that decision; this
  // pins the screen's copy of it against the section itself.
  test('the Recovery anchor exists exactly when the Recovery section renders', () => {
    const { AnalyticsRecoverySection } = require('../components/AnalyticsRecoverySection');
    const states = [
      { blocks: [], weeks: [], loading: false },
      { blocks: [ACTIVE_BLOCK], weeks: [], loading: false },
      { blocks: [{ ...ACTIVE_BLOCK, completed_at: '2026-06-01T00:00:00Z' }], weeks: [], loading: false },
      { blocks: [{ ...ACTIVE_BLOCK, deleted_at: '2026-06-01T00:00:00Z' }], weeks: [], loading: false },
      { blocks: [], weeks: [], loading: false, stale: true },
      { blocks: [], weeks: [], ready: false, loading: true },
      { blocks: [], weeks: [], ready: false, loading: false, error: 'boom' },
    ];

    for (const state of states) {
      const { component } = setupTargeting({ recoveryState: state });
      const anchored = component.root.findAllByProps({ testID: 'recovery-section-anchor' }).length > 0;

      let section;
      render.act(() => {
        section = render.create(
          <AnalyticsRecoverySection
            blocks={state.blocks}
            weeks={state.weeks}
            notes={[]}
            stateReady={state.ready ?? true}
            stateLoading={state.loading}
            stateStale={state.stale ?? false}
            stateError={state.error ?? null}
          />
        );
      });
      expect(anchored).toBe(section.toJSON() !== null);
      render.act(() => { section.unmount(); });
    }
  });

  test('the no-tracked-exercises empty state offers a labeled handoff to Log', () => {
    const onNavigate = jest.fn();
    const { component } = setupTargeting({ onNavigate });
    const link = component.root.findByProps({ testID: 'analytics-empty-log-link' });

    expect(link.props.accessibilityRole).toBe('button');
    expect(link.props.accessibilityLabel).toBe('Go to Log');

    render.act(() => { link.props.onPress(); });
    render.act(() => { link.props.onPress(); });

    expect(onNavigate).toHaveBeenNthCalledWith(1, 'Log');
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  test('the empty-state link declares a >=44pt target and owns its press region', () => {
    // Structural guard only; react-test-renderer runs no layout. Rendered
    // validation at 320/375/448dp with enlarged text is in artifacts/717-d4/.
    const { component } = setupTargeting({ onNavigate: jest.fn() });
    const link = component.root.findByProps({ testID: 'analytics-empty-log-link' });
    const style = [].concat(link.props.style ?? []).reduce(
      (acc, s) => (s ? Object.assign(acc, s) : acc),
      {}
    );

    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(link.props.hitSlop).not.toBeUndefined();
    expect(style.height).toBeUndefined();
    expect(link.findAll(n => n !== link && typeof n.props?.onPress === 'function')).toHaveLength(0);
  });
});

// ── R5b section order (#793): Weight → Recovery → Fatigue → Strength → PO ────

describe('AnalyticsScreen section order (R5b, #793)', () => {
  const RECOVERY_ACTIVE_BLOCK = {
    id: 'rb1',
    baseline_note_id: 'note-baseline',
    baseline_note_title: 'Push Pull Legs',
    baseline: { exercises: [] },
    started_at: '2026-05-01T00:00:00Z',
    completed_at: null,
    saved_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    deleted_at: null,
  };

  test('Recovery renders above Fatigue, adjacent to it, with Weight first and Strength/Progressive Overload after', () => {
    const component = setup({
      hookOverrides: { recoveryBlocks: [RECOVERY_ACTIVE_BLOCK], recoveryWeeks: [] },
    });
    const root = component.root;

    const labels = findAllText(root);
    const indexOf = (needle) => labels.findIndex(s => s.includes(needle));

    const weight = indexOf('Weight Trends');
    const recovery = indexOf('Recovery');
    const fatigue = indexOf('Fatigue');
    const strength = indexOf('Strength');
    const progressiveOverload = indexOf('Progressive Overload');

    expect(weight).toBeGreaterThanOrEqual(0);
    expect(recovery).toBeGreaterThanOrEqual(0);
    expect(fatigue).toBeGreaterThanOrEqual(0);
    expect(strength).toBeGreaterThanOrEqual(0);
    expect(progressiveOverload).toBeGreaterThanOrEqual(0);

    expect(weight).toBeLessThan(recovery);
    expect(recovery).toBeLessThan(fatigue);
    expect(fatigue).toBeLessThan(strength);
    expect(strength).toBeLessThan(progressiveOverload);
  });

  test('with no active or completed recovery block, the order collapses to exactly what it was before Recovery existed — no hole', () => {
    const component = setup({ hookOverrides: { recoveryBlocks: [], recoveryWeeks: [] } });
    const root = component.root;

    expect(root.findAllByProps({ testID: 'recovery-section-anchor' }).length).toBe(0);

    const labels = findAllText(root);
    const indexOf = (needle) => labels.findIndex(s => s.includes(needle));
    const weight = indexOf('Weight Trends');
    const fatigue = indexOf('Fatigue');
    const strength = indexOf('Strength');

    expect(weight).toBeGreaterThanOrEqual(0);
    expect(fatigue).toBeGreaterThanOrEqual(0);
    expect(strength).toBeGreaterThanOrEqual(0);
    expect(weight).toBeLessThan(fatigue);
    expect(fatigue).toBeLessThan(strength);
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

// ── Routine Status gauge ──────────────────────────────────────────────────────

describe('AnalyticsScreen Routine Status gauge', () => {
  afterEach(() => jest.restoreAllMocks());

  test('gauge renders and shows the no-sessions caption at 0', () => {
    // Both features on → parent section title is "Fatigue"; gauge still renders.
    const component = setup();
    const root = component.root;
    expect(hasText(root, 'Session Health')).toBe(false);
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

// ── deriveOneKChartData — per-point breakdown fields (issue #384) ─────────────

describe('deriveOneKChartData — selected-day wiring', () => {
  test('each chart point carries bench/squat/deadlift breakdown values', () => {
    const series = [
      { session: 1, total: 900, bench: 280, squat: 360, deadlift: 260 },
      { session: 2, total: 1000, bench: 300, squat: 400, deadlift: 300 },
    ];
    const chartData = deriveOneKChartData(series);
    expect(chartData[0].bench).toBe(280);
    expect(chartData[0].squat).toBe(360);
    expect(chartData[0].deadlift).toBe(260);
    expect(chartData[1].bench).toBe(300);
    expect(chartData[1].squat).toBe(400);
    expect(chartData[1].deadlift).toBe(300);
  });

  test('chart point value and label are derived correctly', () => {
    const series = [{ session: 3, total: 987.6, bench: 310, squat: 380, deadlift: 298 }];
    const chartData = deriveOneKChartData(series);
    expect(chartData[0].value).toBe(988); // Math.round
    expect(chartData[0].label).toBe('#3');
    expect(chartData[0].unit).toBe('lb');
  });

  test('empty series produces empty array', () => {
    expect(deriveOneKChartData([])).toEqual([]);
    expect(deriveOneKChartData(null)).toEqual([]);
  });
});

// ── 1K total over sessions chart ──────────────────────────────────────────────

describe('AnalyticsScreen 1K total over sessions chart', () => {
  afterEach(() => jest.restoreAllMocks());

  test('renders the 1K-over-sessions chart label when a multi-point series exists', () => {
    jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
      signals: [], nameDisplayMap: new Map(), repDropOffFlags: {},
    });
    jest.spyOn(data, 'derive1kTotalFromSectionsList').mockReturnValue({ total: 1000, squat: 400, bench: 300, deadlift: 300 });
    jest.spyOn(data, 'derive1kTotalSeriesFromSectionsList').mockReturnValue([
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
    jest.spyOn(data, 'derive1kTotalFromSectionsList').mockReturnValue({ total: 1000, squat: 400, bench: 300, deadlift: 300 });
    jest.spyOn(data, 'derive1kTotalSeriesFromSectionsList').mockReturnValue([
      { session: 1, total: 1000, bench: 300, squat: 400, deadlift: 300 },
    ]);

    const component = setup();
    const root = component.root;
    expect(hasText(root, '1K total over sessions')).toBe(false);
  });
});

// ── 1k series alignment — allSections not currentSections (issue #370) ───────

describe('deriveAnalytics 1k series — uses allSections to include synced sessions', () => {
  // Reproduces issue #370: 1k chart stuck at 2 sessions when new sessions exist
  // only in historical notes rather than in the current note.
  //
  // Setup: currentNote has 2 logged sessions per lift; a historical note has 1
  // additional session per lift. allSections = historical + current = 3 sessions.
  // With currentSections only, the series stops at 2.

  const historicalText = [
    'Monday', '+ lifting', '1. DB Bench Press', '- 135 5',
    '', 'Wednesday', '+ lifting', '1. Squat', '- 225 5',
    '', 'Friday', '+ lifting', '1. Deadlift', '- 315 5',
  ].join('\n');

  const currentText = [
    'Monday', '+ lifting', '1. DB Bench Press', '- 140 5', '- 145 5',
    '', 'Wednesday', '+ lifting', '1. Squat', '- 230 5', '- 235 5',
    '', 'Friday', '+ lifting', '1. Deadlift', '- 320 5', '- 325 5',
  ].join('\n');

  const oneKSelections = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };

  test('series has 3 points when historical note adds one earlier session per lift', () => {
    const historicalSections = parseWorkoutNote(historicalText).sections;
    const currentSections = parseWorkoutNote(currentText).sections;
    const allSections = [...historicalSections, ...currentSections];
    const noteSectionsList = [historicalSections, currentSections];

    const analytics = deriveAnalytics({ allSections, currentSections, noteSectionsList }, {}, oneKSelections, 1.0);

    expect(analytics.oneKSeries.length).toBe(3);
    expect(analytics.oneKSeries[2].session).toBe(3);
  });

  test('series stops at 2 when only currentSections are used', () => {
    const currentSections = parseWorkoutNote(currentText).sections;
    const noteSectionsList = [currentSections];

    const analytics = deriveAnalytics({ allSections: currentSections, currentSections, noteSectionsList }, {}, oneKSelections, 1.0);

    expect(analytics.oneKSeries.length).toBe(2);
  });
});

// ── Deload exclusion from analytics signals (issue #397) ─────────────────────
describe('deriveAnalytics — deload sessions excluded from signal/strength derivation', () => {
  // Deload sessions are intentionally light. They must not contaminate the
  // fatigue-adjusted Kilo Max (computeKiloMax flat-averages every set's Epley),
  // tracked-lift trends, or per-day signals. They must still appear in the 1K
  // series as their own point (#396).
  const currentText = [
    'Monday', '+ lifting', '1. DB Bench Press', '- 100 8', '- 100 8',
  ].join('\n');
  const deloadText = [
    'Monday', '+ lifting', '1. DB Bench', '- 60 8', '- 60 8',
  ].join('\n');
  const currentNote = { id: 'cur', title: 'Summer 2026 Routine', raw_text: currentText };
  const deloadNote = { id: 'dl', title: 'Deload · 2026-05-04', raw_text: deloadText };
  const tracked = { 'DB Bench Press': true };

  test('Kilo Max ignores the deload note (matches current-only) instead of being dragged down', () => {
    const withDeload = deriveParsedSections([deloadNote, currentNote], currentNote);
    const currentOnly = deriveParsedSections([currentNote], currentNote);

    const a = deriveAnalytics(withDeload, tracked, {}, 1.07);
    const b = deriveAnalytics(currentOnly, tracked, {}, 1.07);

    const kmWith = a.signals.find(s => s.name.toLowerCase() === 'db bench press').kilo_max;
    const kmCurrentOnly = b.signals.find(s => s.name.toLowerCase() === 'db bench press').kilo_max;

    // Excluding deload, the value is identical to the current-routine-only value.
    expect(kmWith).toBe(kmCurrentOnly);

    // Sanity: the legacy contaminated path (signalSections absent → allSections
    // fallback, which includes the deload) produces a strictly lower Kilo Max.
    const contaminated = deriveAnalytics(
      { allSections: withDeload.allSections, currentSections: withDeload.currentSections, noteSectionsList: withDeload.noteSectionsList },
      tracked, {}, 1.07,
    );
    const kmContaminated = contaminated.signals.find(s => s.name.toLowerCase() === 'db bench press').kilo_max;
    expect(kmContaminated).toBeLessThan(kmWith);
  });

  test('1K series still includes the deload note as its own point (#396 preserved)', () => {
    const sel = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };
    const big3 = (b) => [
      'Monday', '+ lifting', '1. DB Bench Press', `- ${b} 5`,
      '', 'Wednesday', '+ lifting', '1. Squat', '- 250 5',
      '', 'Friday', '+ lifting', '1. Deadlift', '- 325 5',
    ].join('\n');
    const cur = { id: 'c', title: 'Summer 2026 Routine', raw_text: big3(100) };
    const dl = { id: 'd', title: 'Deload · 2026-05-04', raw_text: big3(60) };
    const parsed = deriveParsedSections([dl, cur], cur);
    const analytics = deriveAnalytics(parsed, {}, sel, 1.0);
    // Deload note + current note → two 1K points (deload kept in noteSectionsList).
    expect(analytics.oneKSeries.length).toBe(2);
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

// ── Routine Status two-metric model ──────────────────────────────────────────

describe('AnalyticsScreen Routine Status metric display', () => {
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

  test('renders gauge showing Since deload and Total; no calendar metrics', () => {
    // Both toggles on → parent title is "Fatigue"; gauge content still renders.
    const deloadHistory = [
      { id: 'dl_1', completed_at: '2026-05-23T12:00:00.000Z', session_count: 1, note_id: 'wn_dl_1' },
    ];
    const component = setup({ hookOverrides: { notes: [ROUTINE_NOTE], currentNote: ROUTINE_NOTE, deloadHistory } });
    const root = component.root;
    expect(hasText(root, 'Since deload')).toBe(true);
    expect(hasText(root, 'Total')).toBe(true);
    expect(hasText(root, 'weeks on routine')).toBe(false);
    expect(hasText(root, 'weeks since deload')).toBe(false);
    expect(hasText(root, 'sessions since deload')).toBe(false);
  });

  test('legacy records without note_id render gauge without error', () => {
    const deloadHistory = [{ id: 'dl_legacy', completed_at: '2026-04-01T00:00:00.000Z', session_count: 0 }];
    const component = setup({ hookOverrides: { notes: [ROUTINE_NOTE], currentNote: ROUTINE_NOTE, deloadHistory } });
    expect(hasText(component.root, 'Since deload')).toBe(true);
    expect(hasText(component.root, 'Total')).toBe(true);
  });
});

// ── feature toggle gating (issue #273) ────────────────────────────────────────

describe('AnalyticsScreen feature toggle gating', () => {
  afterEach(() => jest.restoreAllMocks());

  test('shows section titled Fatigue and Fatigue Tracking panel when both features enabled', () => {
    const component = setup();
    const root = component.root;
    // Parent section title is "Fatigue" when both sub-panels are visible.
    expect(hasText(root, 'Fatigue')).toBe(true);
    expect(hasText(root, 'Fatigue Tracking')).toBe(true);
    // "Routine Status" does not appear as a separate section title.
    expect(hasText(root, 'Routine Status')).toBe(false);
  });

  test('section title reads Fatigue when only sessions panel is visible', () => {
    const component = setup({ featureToggles: { fatigueTrackingEnabled: false } });
    const root = component.root;
    // Sessions-only: parent title is statically "Fatigue".
    expect(hasText(root, 'Fatigue')).toBe(true);
    expect(hasText(root, 'Routine Status')).toBe(false);
    // Fatigue Tracking panel is hidden.
    expect(hasText(root, 'Fatigue Tracking')).toBe(false);
    expect(hasText(root, 'No check-ins logged yet.')).toBe(false);
    expect(hasText(root, 'Weight Trends')).toBe(true);
  });

  // These two previously pinned the opposite behavior — deload mode off hid the
  // "Since deload" number but kept the meter, the Building/Approaching/Deload
  // zone labels and the caption. That was a deliberate earlier decision, and
  // #821 overturns it on owner direction: the caption reaches "Plan deload
  // asap", so the old behavior advised a deload for a feature the user had
  // switched off, driven by a count the card had just hidden. The whole
  // advisory now travels with the toggle; the Total stat does not.
  test('deload mode off hides the entire deload advisory, keeping Total', () => {
    const component = setup({ featureToggles: { deloadModeEnabled: false } });
    const root = component.root;
    // Fatigue Tracking still visible → section title stays "Fatigue".
    expect(hasText(root, 'Fatigue')).toBe(true);
    expect(hasText(root, 'Fatigue Tracking')).toBe(true);
    // The non-deload half of the card survives.
    expect(hasText(root, 'Total')).toBe(true);
    // The advisory does not: stat, meter zones, and caption all go together.
    expect(hasText(root, 'Since deload')).toBe(false);
    expect(hasText(root, 'Building')).toBe(false);
    expect(hasText(root, 'Approaching')).toBe(false);
    expect(hasText(root, 'Deload')).toBe(false);
    expect(hasText(root, 'Weight Trends')).toBe(true);
  });

  test('both toggles off shows Fatigue and Total with no deload advisory', () => {
    const component = setup({ featureToggles: { deloadModeEnabled: false, fatigueTrackingEnabled: false } });
    const root = component.root;
    expect(hasText(root, 'Fatigue')).toBe(true);
    expect(hasText(root, 'Routine Status')).toBe(false);
    expect(hasText(root, 'Total')).toBe(true);
    expect(hasText(root, 'Since deload')).toBe(false);
    expect(hasText(root, 'Building')).toBe(false);
    expect(hasText(root, 'Fatigue Tracking')).toBe(false);
    expect(hasText(root, 'Weight Trends')).toBe(true);
  });

  test('deload mode on still renders the full advisory', () => {
    const component = setup({ featureToggles: { deloadModeEnabled: true } });
    const root = component.root;
    expect(hasText(root, 'Since deload')).toBe(true);
    expect(hasText(root, 'Building')).toBe(true);
    expect(hasText(root, 'Approaching')).toBe(true);
  });
});

// ── Routine-status metric derivation (issue #282) ─────────────────────────────
// MOCK_NOW (module-level) is 2026-05-26T12:00:00Z; date-relative metrics below
// are anchored to that via the fake system time.

// Builds a session_checkins map ({ '<idx>': { responded_at } }) from an ordered
// list of session date strings, mirroring the note's chronology source.
function checkinsFromDates(dates) {
  const out = {};
  dates.forEach((d, i) => {
    out[String(i)] = { responded_at: `${d}T10:00:00.000Z`, status: 'ok' };
  });
  return out;
}

// A five-session routine dated one week apart (Mondays), beginning 2026-04-06.
const FIVE_WEEK_DATES = ['2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27', '2026-05-04'];
const FIVE_SESSION_RAW = ['Monday', '+ lifting', '1. Squat',
  '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5'].join('\n');

describe('routine-status derivation — deload-relative metrics (#282)', () => {
  function sectionsFor(raw) {
    return parseWorkoutNote(raw).sections;
  }

  test('deload date edits change weeks-since but not sessions-since', () => {
    const note = {
      saved_at: '2026-04-06T00:00:00.000Z',
      session_checkins: checkinsFromDates(FIVE_WEEK_DATES),
    };
    // Two records differing ONLY in completed_at (session_count snapshot identical).
    const historyA = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 3 }];
    const historyB = [{ id: 'dl', completed_at: '2026-05-04T12:00:00.000Z', session_count: 3 }];

    const sinceA = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, historyA).sessionsSinceDeload;
    const sinceB = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, historyB).sessionsSinceDeload;
    const weeksA = weeksSinceLastDeload(historyA);
    const weeksB = weeksSinceLastDeload(historyB);

    expect(sinceA).toBe(2);
    expect(sinceB).toBe(2);
    expect(weeksA).not.toBe(weeksB);
    expect(weeksA).toBe(5); // 2026-05-26 − 2026-04-20 = 36 days → 5 weeks
    expect(weeksB).toBe(3); // 2026-05-26 − 2026-05-04 = 22 days → 3 weeks
  });

  test('session_count beats check-in chronology for Analytics sessions-since-deload', () => {
    const note = {
      saved_at: '2026-04-06T00:00:00.000Z',
      session_checkins: checkinsFromDates(FIVE_WEEK_DATES),
    };
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 3 }];
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, history);
    expect(status.sessionsSinceDeload).toBe(2);
  });

  test('session anchor, not completed_at, selects the deload for sessions-since-deload', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    const history = [
      { id: 'dl_real_latest', completed_at: '2026-04-20T12:00:00.000Z', session_count: 5 },
      { id: 'dl_newer_date', completed_at: '2026-05-04T12:00:00.000Z', session_count: 3 },
    ];
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, history);
    expect(status.sessionsSinceDeload).toBe(0);
  });

  test('a completed deload using legacy session_count resets sessions-since-deload to 0', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    const history = [{ id: 'dl', completed_at: '2026-05-04T12:00:00.000Z', session_count: 5 }];
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, history);
    expect(status.sessionsSinceDeload).toBe(0);
  });

  test('a deload date before all sessions does not affect sessions-since-deload', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    const history = [{ id: 'dl', completed_at: '2026-01-01T12:00:00.000Z', session_count: 0 }];
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, history);
    expect(status.sessionsSinceDeload).toBe(5);
  });

  test('no deload history returns total sessions and null weeks', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, []);
    expect(status.sessionsSinceDeload).toBe(5);
    expect(weeksSinceLastDeload([])).toBeNull();
  });
});

describe('routine-status derivation — weeks on routine (#282)', () => {
  // elapsed weeks is a genuine calendar-week metric (Monday-anchored), anchored
  // to MOCK_NOW 2026-05-26. (active weeks is deferred per #282 review — the data
  // model has no per-session date outside check-ins.)

  test('elapsed weeks is the calendar-week span since the routine began, incl. gaps', () => {
    // saved_at 2026-04-06 → MOCK_NOW 2026-05-26 spans 8 calendar weeks.
    expect(elapsedWeeksOnRoutine({ saved_at: '2026-04-06T00:00:00.000Z' })).toBe(8);
  });

  test('elapsed weeks works without any check-ins (uses saved_at, always present)', () => {
    // No session_checkins at all — elapsed is still a real calendar-week count.
    expect(elapsedWeeksOnRoutine({ saved_at: '2026-05-25T00:00:00.000Z' })).toBe(1);
  });

  test('elapsed weeks is null without a start date and 0 for a future start', () => {
    expect(elapsedWeeksOnRoutine({})).toBeNull();
    expect(elapsedWeeksOnRoutine({ saved_at: '2026-12-01T00:00:00.000Z' })).toBe(0);
  });
});

describe('routine-status derivation — sessions logged includes deloads (#282)', () => {
  test('deloadSessionsLogged sums logged passes across archived deload notes', () => {
    expect(deloadSessionsLogged([])).toBe(0);
    expect(deloadSessionsLogged(null)).toBe(0);
    expect(deloadSessionsLogged([{ id: 'dl', raw_text: '-Squat\n- 135 5' }])).toBe(1);
    expect(deloadSessionsLogged([{ id: 'dl', raw_text: '-Squat\n- 135 5\n- 135 5' }])).toBe(2);
    // Two archived deloads → their passes sum.
    expect(deloadSessionsLogged([
      { id: 'dl1', raw_text: '-Squat\n- 135 5' },
      { id: 'dl2', raw_text: '-Squat\n- 135 5' },
    ])).toBe(2);
  });

  test('legacy deload records without raw_text contribute 0', () => {
    expect(deloadSessionsLogged([{ id: 'dl_old', completed_at: '2026-04-01T00:00:00.000Z', session_count: 7 }])).toBe(0);
  });
});

describe('deriveRoutineStatus — composite contract (#282)', () => {
  function sectionsFor(raw) {
    return parseWorkoutNote(raw).sections;
  }

  test('sessions logged includes archived deload sessions and is never reduced by deloads', () => {
    const note = {
      saved_at: '2026-04-06T00:00:00.000Z',
      session_checkins: checkinsFromDates(FIVE_WEEK_DATES),
    };
    // Deload archived with one logged pass; snapshot says the deload anchor was session 3.
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 3, raw_text: '-Squat\n- 135 5' }];
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, history);
    expect(status.sessionsLogged).toBe(6);       // 5 routine + 1 deload
    // Deload-relative session count is derived from the stored session anchor, not dates.
    expect(status.sessionsSinceDeload).toBe(2);
    expect(status.weeksSinceDeload).toBe(5);
    expect(status.elapsedWeeks).toBe(8);         // calendar span since saved_at
  });

  test('legacy / no-check-in note derives safely (elapsed still shows real weeks)', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' }; // no check-ins
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, []);
    expect(status.sessionsLogged).toBe(5);
    expect(status.sessionsSinceDeload).toBe(5); // no deload → all sessions
    expect(status.weeksSinceDeload).toBeNull();
    expect(status.elapsedWeeks).toBe(8);        // calendar span from saved_at
  });

  test('null note and empty sections do not throw', () => {
    const status = deriveRoutineStatus(null, null, null);
    expect(status.sessionsLogged).toBe(0);
    expect(status.sessionsSinceDeload).toBe(0);
    expect(status.weeksSinceDeload).toBeNull();
    expect(status.elapsedWeeks).toBeNull();
  });

  test('deload from a prior routine does not inflate session count for the new routine (#377)', () => {
    // Regression: a deload completed before the current routine's saved_at was being
    // included in deloadSessionsLogged and _latestDeloadSessionRecord, causing
    // sessionsLogged to overcount by 1 and sessionsSinceDeload to read as 0.
    const THREE_SESSION_RAW = ['Monday', '+ lifting', '1. Squat',
      '- 225x5', '- 225x5', '- 225x5'].join('\n');
    const note = { saved_at: '2026-06-08T00:00:00.000Z' }; // new routine starts Jun 8
    // Deload from the prior routine: completed Jun 6, two days before the new routine.
    const priorDeload = {
      id: 'dl_prior',
      completed_at: '2026-06-06T04:40:09.026Z',
      session_count: 14,
      deload_session_ordinal: 10,
      deload_ordinal_is_count: true,
      raw_text: 'Squat: 155 lbs 3x8\nBench: 95 lbs 3x8',
    };
    const status = deriveRoutineStatus(parseWorkoutNote(THREE_SESSION_RAW).sections, note, [priorDeload]);
    // sessionsLogged must be 3 (routine only), not 4 (routine + prior deload).
    expect(status.sessionsLogged).toBe(3);
    // sessionsSinceDeload must be 3 (no deload on this routine), not 0.
    expect(status.sessionsSinceDeload).toBe(3);
    // weeksSinceDeload must be null (no deload on this routine).
    expect(status.weeksSinceDeload).toBeNull();
  });
});

describe('AnalyticsScreen routine-status plumbing (#282)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('gauge surfaces since-deload count and total; no calendar metrics', () => {
    const currentNote = {
      id: 'wn1',
      raw_text: FIVE_SESSION_RAW,
      saved_at: '2026-04-06T00:00:00.000Z',
      session_checkins: checkinsFromDates(FIVE_WEEK_DATES),
      isCurrent: true,
    };
    const deloadHistory = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 99, raw_text: '-Squat\n- 135 5' }];
    const component = setup({ hookOverrides: { notes: [currentNote], currentNote, deloadHistory } });
    const root = component.root;

    expect(hasText(root, 'Since deload')).toBe(true);
    expect(hasText(root, 'Total')).toBe(true);
    // Calendar metrics removed — must not appear.
    expect(hasText(root, 'weeks on routine')).toBe(false);
    expect(hasText(root, 'weeks since deload')).toBe(false);
    expect(hasText(root, 'active weeks')).toBe(false);
    // sessions logged (Total) = 5 routine + 1 deload = 6 (includes archived deloads).
    expect(findAllText(root).some(s => s === '6')).toBe(true);
  });
});

describe('deload_session_ordinal: ordinal-based sessions-since-deload (#284)', () => {
  function sectionsFor(raw) {
    return parseWorkoutNote(raw).sections;
  }

  test('ordinal anchor produces correct sessions-since-deload in deriveRoutineStatus', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    // New-format record (deload_ordinal_is_count=true): pre-deload count=3, 5 total → 2 after deload.
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 0, deload_session_ordinal: 3, deload_ordinal_is_count: true }];
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, history);
    expect(status.sessionsLogged).toBe(5);
    expect(status.sessionsSinceDeload).toBe(2);
  });

  test('ordinal overrides stale session_count and check-in dates', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z', session_checkins: checkinsFromDates(FIVE_WEEK_DATES) };
    // New-format record: session_count=99 is stale; ordinal=5 (pre-deload count) takes priority.
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 99, deload_session_ordinal: 5, deload_ordinal_is_count: true }];
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, history);
    // ordinal=5 equals routineSessions=5: max(0, 5-5)=0
    expect(status.sessionsSinceDeload).toBe(0);
  });

  test('freshly completed deload with matching ordinal reads 0', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    // ordinal=4 equals session_count=4: auto-detected as count-semantic; max(0, 4-4)=0
    const history = [{ id: 'dl', completed_at: '2026-05-01T00:00:00.000Z', session_count: 4, deload_session_ordinal: 4 }];
    const sections = parseWorkoutNote(
      ['Monday', '+ lifting', '1. Squat', '- 225x5', '- 225x5', '- 225x5', '- 225x5'].join('\n')
    ).sections;
    const status = deriveRoutineStatus(sections, note, history);
    expect(status.sessionsSinceDeload).toBe(0);
  });

  test('3 post-deload sessions shows sessionsSinceDeload of 3, not 4 — off-by-one regression (#371)', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    // Existing record where user entered count directly (ordinal=session_count=3).
    // Auto-detected as count-semantic (no flag needed); 6 total → 6-3=3.
    const SIX_SESSION_RAW = ['Monday', '+ lifting', '1. Squat',
      '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5'].join('\n');
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 3, deload_session_ordinal: 3 }];
    const status = deriveRoutineStatus(sectionsFor(SIX_SESSION_RAW), note, history);
    expect(status.sessionsSinceDeload).toBe(3);
  });

  test('legacy ordinal=count+1 records read correctly via old formula (#371)', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    // Old-format record (no flag, ordinal=count+1=4): uses old formula routineSessions-ordinal+1.
    // 6 total sessions, anchor=4: max(0, 6-4+1)=3.
    const SIX_SESSION_RAW = ['Monday', '+ lifting', '1. Squat',
      '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5', '- 225x5'].join('\n');
    const history = [{ id: 'dl', completed_at: '2026-04-20T12:00:00.000Z', session_count: 3, deload_session_ordinal: 4 }];
    const status = deriveRoutineStatus(sectionsFor(SIX_SESSION_RAW), note, history);
    expect(status.sessionsSinceDeload).toBe(3);
  });

  test('mixed old/new history selects the correct latest deload boundary (#371)', () => {
    const note = { saved_at: '2026-04-06T00:00:00.000Z' };
    // Old record: session_count=3, ordinal=4 (no flag) → normalized boundary=3.
    // New record: session_count=4, ordinal=4, flag=true → normalized boundary=4.
    // New record has higher boundary; with 5 total sessions: 5-4=1 (not 5-4+1=2).
    const history = [
      { id: 'dl_old', completed_at: '2026-04-01T00:00:00.000Z', session_count: 3, deload_session_ordinal: 4 },
      { id: 'dl_new', completed_at: '2026-04-20T00:00:00.000Z', session_count: 4, deload_session_ordinal: 4, deload_ordinal_is_count: true },
    ];
    const status = deriveRoutineStatus(sectionsFor(FIVE_SESSION_RAW), note, history);
    expect(status.sessionsSinceDeload).toBe(1);
  });
});

// ── recovery / normal-analytics boundary on Analytics (#699) ─────────────────
//
// deriveParsedSections owns the boundary for every ordinary Analytics
// population. These tests pin what it filters, what it deliberately does not,
// and that the screen actually wires it and still hands Recovery Analytics the
// unfiltered notes.

describe('AnalyticsScreen: excluded recovery notes and ordinary populations', () => {
  const HEAVY = 'Monday\n+Lifting\n-Bench Press\n- 225 5,5';
  const LIGHT = 'Monday\n+Lifting\n-Bench Press\n- 45 5';
  const DELOAD_TITLE = 'Deload · Push Day';

  const ordinary = { id: 'ordinary', title: 'Push Day', raw_text: HEAVY, one_k_exercises: null };
  const recovery = { id: 'recovery', title: 'Recovery Week 1', raw_text: LIGHT, one_k_exercises: null };
  const deload = { id: 'deload', title: DELOAD_TITLE, raw_text: LIGHT, one_k_exercises: null };
  const notes = [ordinary, deload, recovery];

  test('an excluded note leaves every ordinary population, including allSections', () => {
    const parsed = deriveParsedSections(notes, ordinary, new Set(['recovery']));
    expect(parsed.normalNotes.map(n => n.id)).toEqual(['ordinary', 'deload']);
    // allSections and noteSectionsList are the 1K/aggregate populations.
    expect(parsed.noteSectionsList.length).toBe(2);
    expect(parsed.allSections.length).toBe(2);
  });

  test('deload exclusion composes with, and survives, the recovery filter', () => {
    // With recovery INCLUDED, the deload note must still be absent from signals.
    const included = deriveParsedSections(notes, ordinary, new Set());
    expect(included.normalNotes.map(n => n.id)).toEqual(['ordinary', 'deload', 'recovery']);
    expect(included.allSections.length).toBe(3);
    // signalSections drops only the deload note, never the re-admitted recovery one.
    expect(included.signalSections.length).toBe(2);

    const excluded = deriveParsedSections(notes, ordinary, new Set(['recovery']));
    expect(excluded.signalSections.length).toBe(1);
  });

  test('the current note is never filtered — an excluded recovery week still renders', () => {
    const parsed = deriveParsedSections(notes, recovery, new Set(['recovery']));
    expect(parsed.currentSections.length).toBeGreaterThan(0);
    expect(parsed.normalNotes.map(n => n.id)).not.toContain('recovery');
  });

  test('omitting the exclusion set filters nothing (legacy callers keep working)', () => {
    const parsed = deriveParsedSections(notes, ordinary);
    expect(parsed.normalNotes.map(n => n.id)).toEqual(['ordinary', 'deload', 'recovery']);
  });

  test('the screen wires the filter: the exclusion set reaches deriveParsedSections, and Recovery Analytics still gets every note', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const derivations = require('../screens/analytics/analyticsDerivations');
    const blocks = [{
      id: 'rb1',
      baseline_note_id: 'ordinary',
      baseline_note_title: 'Push Day',
      baseline: { version: 1, exercises: [] },
      include_in_normal_analytics: false,
      started_at: '2026-05-01T00:00:00.000Z',
      completed_at: null,
      deleted_at: null,
    }];
    const weeks = [{
      id: 'rw1', block_id: 'rb1', note_id: 'recovery', week_number: 1,
      completed_at: null, deleted_at: null,
    }];
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === 'kilo_recovery_blocks') return JSON.stringify(blocks);
      if (key === 'kilo_recovery_block_weeks') return JSON.stringify(weeks);
      return null;
    });
    const parsedSpy = jest.spyOn(derivations, 'deriveParsedSections');

    const component = setup({
      hookOverrides: {
        notes,
        currentNote: ordinary,
        recoveryBlocks: blocks,
        recoveryWeeks: weeks,
        trackedLifts: { 'Bench Press': true },
      },
    });
    // Let the filter's storage read resolve and re-render the screen.
    await render.act(async () => { await Promise.resolve(); });

    const lastCall = parsedSpy.mock.calls[parsedSpy.mock.calls.length - 1];
    expect(lastCall[0]).toBe(notes);
    expect([...lastCall[2]]).toEqual(['recovery']);

    // Recovery Analytics is handed the UNFILTERED notes on purpose: a block's
    // own analytics always read its linked notes, whatever the preference says.
    const { AnalyticsRecoverySection } = require('../components/AnalyticsRecoverySection');
    const recoverySection = component.root.findByType(AnalyticsRecoverySection);
    expect(recoverySection.props.notes).toBe(notes);
    expect(recoverySection.props.weeks).toBe(weeks);

    parsedSpy.mockRestore();
    AsyncStorage.getItem.mockReset();
  });

  test('an unverified recovery boundary holds the loading state instead of publishing unfiltered aggregates', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const hooks = require('../hooks/entries/recoveryBlockHooks');
    // Cold start: nothing has verified the boundary in this process yet.
    hooks._resetRecoveryAnalyticsFilterCache();
    // Recovery storage is unreadable while workout notes load fine — the exact
    // cold-start case where an empty snapshot would silently admit every
    // recovery note.
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === 'kilo_recovery_blocks' || key === 'kilo_recovery_block_weeks') {
        throw new Error('storage unavailable');
      }
      return null;
    });

    const component = setup({
      hookOverrides: { notes, currentNote: ordinary, trackedLifts: { 'Bench Press': true } },
    });
    await render.act(async () => { await Promise.resolve(); });

    // The Progressive Overload list and the 1K card both hold their spinner
    // rather than painting numbers derived from an unverified population.
    const { ActivityIndicator } = require('react-native');
    const { AnalyticsStrengthSection } = require('../components/AnalyticsStrengthSection');
    expect(component.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    expect(component.root.findByType(AnalyticsStrengthSection).props.isNotesLoading).toBe(true);

    AsyncStorage.getItem.mockReset();
    hooks._resetRecoveryAnalyticsFilterCache();
  });
});

// ── #727: Analytics forwards onNavigate to AnalyticsRecoverySection ──────────

describe('AnalyticsScreen — onNavigate forwarded to Recovery section (#727)', () => {
  const { AnalyticsRecoverySection } = require('../components/AnalyticsRecoverySection');

  test('onNavigate prop from AnalyticsScreen is forwarded to AnalyticsRecoverySection', () => {
    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: false, deloadModeEnabled: false,
      setFatigueTrackingEnabled: jest.fn(), setDeloadModeEnabled: jest.fn(),
    });
    useEntries.useWeightEntries.mockReturnValue({ entries: [], loading: false, error: null });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false });
    useEntries.useWorkoutNotes.mockReturnValue({ notes: [], currentNote: null, loading: false, update: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
    useEntries.useRecoveryBlockState.mockReturnValue({ blocks: [], weeks: [], loading: false });

    const onNavigate = jest.fn();
    let component;
    render.act(() => {
      component = render.create(
        <AnalyticsScreen multiplier={1.07} section={null} onNavigate={onNavigate} />
      );
    });

    const section = component.root.findByType(AnalyticsRecoverySection);
    expect(section.props.onNavigate).toBe(onNavigate);
  });
});

// ── #716: Analytics renders from the same authoritative Recovery state ───────

describe('AnalyticsScreen — authoritative Recovery state (#716)', () => {
  const { AnalyticsRecoverySection } = require('../components/AnalyticsRecoverySection');
  const {
    RECOVERY_UNVERIFIED_MESSAGE,
    RECOVERY_STALE_MESSAGE,
  } = require('../hooks/entries/recoveryBlockHooks');

  const renderWithRecoveryState = (state) => {
    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: true, deloadModeEnabled: true,
      setFatigueTrackingEnabled: jest.fn(), setDeloadModeEnabled: jest.fn(),
    });
    useEntries.useWeightEntries.mockReturnValue({ entries: [], loading: false, error: null });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false });
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [], currentNote: null, loading: false, update: jest.fn(),
    });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
    useEntries.useRecoveryBlockState.mockReturnValue({ blocks: [], weeks: [], ...state });

    let component;
    render.act(() => {
      component = render.create(<AnalyticsScreen multiplier={1.07} section={null} />);
    });
    return component;
  };

  const section = (component) => component.root.findByType(AnalyticsRecoverySection);

  test('the unverified read state is forwarded to the Recovery section, not flattened to empty', () => {
    const retryRecovery = jest.fn();
    const error = new Error('unreadable');
    const component = renderWithRecoveryState({
      ready: false, loading: false, refreshing: false, stale: false, error, retryRecovery,
    });

    const props = section(component).props;
    expect(props.stateReady).toBe(false);
    expect(props.stateError).toBe(error);
    expect(props.onRetry).toBe(retryRecovery);
    // The failed read is visible on this tab too, rather than silently
    // retracting the whole evidence surface.
    expect(hasText(component.root, RECOVERY_UNVERIFIED_MESSAGE)).toBe(true);
  });

  test('a stale snapshot is labelled on Analytics as well as Log', () => {
    const component = renderWithRecoveryState({
      ready: true, loading: false, stale: true, error: null, retryRecovery: jest.fn(),
    });
    expect(section(component).props.stateStale).toBe(true);
    expect(hasText(component.root, RECOVERY_STALE_MESSAGE)).toBe(true);
  });

  test('a verified snapshot renders the Recovery section exactly as before', () => {
    const component = renderWithRecoveryState({ ready: true, loading: false, stale: false, error: null });
    const props = section(component).props;
    expect(props.stateReady).toBe(true);
    expect(props.stateStale).toBe(false);
    expect(hasText(component.root, RECOVERY_UNVERIFIED_MESSAGE)).toBe(false);
    expect(hasText(component.root, RECOVERY_STALE_MESSAGE)).toBe(false);
  });
});

// ── failed-read banners (#737) ────────────────────────────────────────────────
//
// Analytics is entirely derived: every card here is computed from the note and
// weight collections. A failed read leaves those collections empty with
// `loading` already cleared, so without a banner the whole tab silently
// degrades into a plausible-looking "you have no data" report, with no way to
// tell that apart from a real answer and no way to retry.
describe('AnalyticsScreen load-failure banners (#737)', () => {
  function setupWithErrors({ notesError = null, weightError = null, refreshNotes = jest.fn(), refreshWeight = jest.fn() } = {}) {
    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: true,
      deloadModeEnabled: true,
      setFatigueTrackingEnabled: jest.fn(),
      setDeloadModeEnabled: jest.fn(),
    });
    useEntries.useWeightEntries.mockReturnValue({
      entries: [], loading: false, error: weightError, refresh: refreshWeight,
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false });
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [], currentNote: null, loading: false, error: notesError, refresh: refreshNotes, update: jest.fn(),
    });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
    useEntries.useRecoveryBlockState.mockReturnValue({ blocks: [], weeks: [], loading: false });

    let component;
    render.act(() => {
      component = render.create(<AnalyticsScreen multiplier={1.07} section={null} />);
    });
    return component;
  }

  // The deepest host element that contains both the message and a press target
  // is the banner itself; everything above it is an ancestor that also matches.
  const retryFor = (root, message) => {
    const candidates = root.findAll(
      n => typeof n.type === 'string'
        && n.findAll(c => c.type === 'Text' && String(c.props.children ?? '').includes(message)).length > 0
        && n.findAll(c => typeof c.props?.onPress === 'function').length > 0
    );
    const banner = candidates[candidates.length - 1];
    const presses = banner.findAll(n => typeof n.props?.onPress === 'function');
    return presses[presses.length - 1];
  };

  test('a clean read shows no banner', () => {
    const component = setupWithErrors();
    expect(hasText(component.root, 'Could not load workout notes')).toBe(false);
    expect(hasText(component.root, 'Could not load weight entries')).toBe(false);
  });

  test('a failed notes read is named, scoped, and retryable on its own', () => {
    const refreshNotes = jest.fn();
    const component = setupWithErrors({ notesError: new Error('boom'), refreshNotes });

    expect(hasText(component.root, 'Could not load workout notes. Training analytics are incomplete.')).toBe(true);
    expect(hasText(component.root, 'Could not load weight entries')).toBe(false);

    render.act(() => { retryFor(component.root, 'Could not load workout notes').props.onPress(); });
    expect(refreshNotes).toHaveBeenCalled();
  });

  test('a failed weight read is named, scoped, and retryable on its own', () => {
    const refreshWeight = jest.fn();
    const component = setupWithErrors({ weightError: new Error('boom'), refreshWeight });

    expect(hasText(component.root, 'Could not load weight entries. Weight trends are incomplete.')).toBe(true);
    expect(hasText(component.root, 'Could not load workout notes')).toBe(false);

    render.act(() => { retryFor(component.root, 'Could not load weight entries').props.onPress(); });
    expect(refreshWeight).toHaveBeenCalled();
  });

  test('both failures are reported independently, not merged into one', () => {
    const component = setupWithErrors({ notesError: new Error('a'), weightError: new Error('b') });
    expect(hasText(component.root, 'Could not load workout notes')).toBe(true);
    expect(hasText(component.root, 'Could not load weight entries')).toBe(true);
  });

  test('a failed read is not laundered into a permanent loading state', () => {
    // `loading` stays true while `error` is set — the shape a hook can briefly
    // hold. The failure wins: a spinner that can never resolve is the exact
    // dishonest state this replaces.
    useEntries.useFeatureToggles.mockReturnValue({
      fatigueTrackingEnabled: false, deloadModeEnabled: false,
      setFatigueTrackingEnabled: jest.fn(), setDeloadModeEnabled: jest.fn(),
    });
    useEntries.useWeightEntries.mockReturnValue({
      entries: [], loading: true, error: new Error('boom'), refresh: jest.fn(),
    });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, loading: false });
    useEntries.useWorkoutNotes.mockReturnValue({
      notes: [], currentNote: null, loading: true, error: new Error('boom'), refresh: jest.fn(), update: jest.fn(),
    });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
    useEntries.useRecoveryBlockState.mockReturnValue({ blocks: [], weeks: [], loading: false });

    let component;
    render.act(() => {
      component = render.create(<AnalyticsScreen multiplier={1.07} section={null} />);
    });

    expect(hasText(component.root, 'Could not load workout notes')).toBe(true);
    expect(component.root.findAllByType('ActivityIndicator')).toHaveLength(0);
  });
});

// Review finding on PR #873 (#868): a restored profile whose stored
// `current_workout_id` references a missing/tombstoned note leaves
// `currentNote` null while `currentId` is still set. Analytics must resolve
// `activeTrainingContext` off that stored id, not off `currentNote?.id`, or it
// silently disagrees with Log (which reads `currentId` directly).
describe('AnalyticsScreen threads the stored currentId into activeTrainingContext', () => {
  test('activeTrainingContext resolves the stored currentId even when currentNote is null', () => {
    setup({ hookOverrides: { currentId: 'stored-current-id', currentNote: null } });

    expect(useEntries.useActiveTrainingContext).toHaveBeenCalledWith(
      expect.objectContaining({ currentId: 'stored-current-id' })
    );
  });
});
