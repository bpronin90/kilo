// Redesign v3 Analytics Progress (#1604): the 1K panel, Progressive Overload
// status chips / rows / detail sheet. Presentation only — every value asserted
// here comes from the existing derivations (mocked at deriveWorkoutNoteAnalytics
// like the other Analytics screen suites).

import React from 'react';
import render from 'react-test-renderer';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import * as useEntries from '../hooks/useEntries';
import * as data from '../lib/data';
import { overloadSessionHistory } from '../screens/analytics/OverloadExerciseSheet';
import { filterGroupsByStatus, overloadRowModel } from '../screens/analytics/OverloadRows';
import { overloadChipsVisible, overloadCounts } from '../screens/analytics/OverloadFilterChips';
import { oneKToGoText } from '../screens/analytics/AnalyticsProgressPanels';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('../components/LineChart', () => ({ LineChart: jest.fn(() => null) }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));
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
    useWeightGoal: jest.fn(() => ({ goal: null })),
  };
});

const NOTE = {
  id: 'n1',
  raw_text: 'Monday\n+ lifting\n1. bench press\n2. barbell row\n\nFriday\n+ lifting\n1. squat',
};
const SIGNALS = [
  { name: 'Bench Press', latest_pr: 225, kilo_max: 250, latest_top_weight: 185, overload_trend: 'up' },
  { name: 'Barbell Row', latest_pr: 205, kilo_max: 210, latest_top_weight: 165, overload_trend: 'flat' },
  { name: 'Squat', latest_pr: 315, kilo_max: 290, latest_top_weight: 275, overload_trend: 'down' },
];
const NAMES = new Map([['bench press', 'Bench Press'], ['barbell row', 'Barbell Row'], ['squat', 'Squat']]);

let trees = [];
afterEach(() => {
  render.act(() => { trees.forEach(t => t.unmount()); });
  trees = [];
  jest.restoreAllMocks();
});

async function mount({ note = NOTE, signals = SIGNALS, onNavigate, oneK = null, series = null } = {}) {
  jest.spyOn(data, 'deriveWorkoutNoteAnalytics').mockReturnValue({
    signals, nameDisplayMap: NAMES, repDropOffFlags: {}, perDaySignals: {},
  });
  if (oneK) jest.spyOn(data, 'derive1kTotalFromSectionsList').mockReturnValue(oneK);
  if (series) jest.spyOn(data, 'derive1kTotalSeriesFromSectionsList').mockReturnValue(series);
  useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: true, deloadModeEnabled: true });
  useEntries.useWeightEntries.mockReturnValue({ entries: [], loading: false, error: null });
  useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: { 'bench press': true, 'barbell row': true, squat: true }, activations: {}, loading: false });
  useEntries.useWorkoutNotes.mockReturnValue({ notes: [note], currentNote: note, loading: false, update: jest.fn() });
  useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
  useEntries.useRecoveryBlockState.mockReturnValue({ blocks: [], weeks: [], loading: false, ready: true });
  let tree;
  render.act(() => { tree = render.create(<AnalyticsScreen multiplier={1.07} onNavigate={onNavigate} />); });
  trees.push(tree);
  // The Recovery population check settles in an effect; the 1K panel and the
  // list hold their loading state until it has.
  await render.act(async () => {});
  return tree;
}

const press = (root, testID) => {
  const node = root.findAll(n => n.props?.testID === testID && typeof n.props.onPress === 'function')[0];
  render.act(() => { node.props.onPress(); });
};
const texts = root => root.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
const has = (root, needle) => texts(root).some(t => t.includes(needle));
const rows = root => root.findAll(n => typeof n.props?.testID === 'string' && n.props.testID.startsWith('po-row-') && typeof n.props.onPress === 'function');
const sheets = root => root.findAll(n => n.props?.testID === 'po-exercise-sheet' && typeof n.type === 'string');
const flat = n => [].concat(n.props.style ?? []).reduce((acc, s) => (s ? Object.assign(acc, s) : acc), {});

describe('1K panel (#1604)', () => {
  const ONE_K = { total: 882, squat: 274, bench: 228, deadlift: 380 };
  const SERIES = [
    { session: 1, total: 800, bench: 200, squat: 250, deadlift: 350 },
    { session: 2, total: 882, bench: 228, squat: 274, deadlift: 380 },
  ];

  test('leads with total / 1,000 lb, the remaining amount and a per-lift stacked bar in one panel', async () => {
    const { root } = await mount({ oneK: ONE_K, series: SERIES });
    expect(root.findAllByProps({ testID: 'onek-panel' }).length).toBeGreaterThan(0);
    expect(has(root, '882')).toBe(true);
    expect(has(root, '/ 1,000 lb')).toBe(true);
    expect(has(root, '118 to go')).toBe(true);
    const fill = root.findAll(n => n.type === 'View' && flat(n).height === '100%' && /%$/.test(String(flat(n).width)));
    expect(fill).toHaveLength(1);
    const segments = fill[0].findAll(n => n.type === 'View' && typeof flat(n).flex === 'number' && flat(n).backgroundColor);
    expect(segments.map(s => flat(s).flex)).toEqual([274, 228, 380]);
  });

  test('keeps plate loading on every lift and the What is 1K Progress info', async () => {
    const { root } = await mount({ oneK: ONE_K, series: SERIES });
    const plates = root.findAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show plate loading') && n.props.onPress);
    expect(plates).toHaveLength(3);
    expect(root.findAll(n => n.props.testID === 'onek-info-toggle' && n.props.accessibilityLabel === 'What is 1K Progress?').length).toBeGreaterThan(0);
  });

  test('the session chart is behind a collapsed disclosure that exposes its state', async () => {
    const { LineChart } = require('../components/LineChart');
    LineChart.mockClear();
    const { root } = await mount({ oneK: ONE_K, series: SERIES });
    const toggle = () => root.findAll(n => n.props.testID === 'onek-chart-disclosure-toggle' && typeof n.props.onPress === 'function')[0];
    expect(toggle().props.accessibilityState).toEqual({ expanded: false });
    expect(LineChart.mock.calls).toHaveLength(0);
    press(root, 'onek-chart-disclosure-toggle');
    expect(toggle().props.accessibilityState).toEqual({ expanded: true });
    const props = LineChart.mock.calls[LineChart.mock.calls.length - 1][0];
    expect(props.seriesLabel).toBe('1K total by session');
    expect(props.data).toHaveLength(2);
  });

  test('closing the chart restores the latest total after a session was selected', async () => {
    const { LineChart } = require('../components/LineChart');
    LineChart.mockClear();
    const { root } = await mount({ oneK: ONE_K, series: SERIES });
    press(root, 'onek-chart-disclosure-toggle');
    const onSelect = () => LineChart.mock.calls[LineChart.mock.calls.length - 1][0].onSelect;
    render.act(() => { onSelect()({ value: 800, squat: 250, bench: 200, deadlift: 350, valueLb: 800, squatLb: 250, benchLb: 200, deadliftLb: 350 }); });
    expect(has(root, '800')).toBe(true);
    press(root, 'onek-chart-disclosure-toggle');
    expect(has(root, '882')).toBe(true);
  });

  test('Big 3 mapping is a disclosure row inside the same panel, collapsed by default', async () => {
    const { root } = await mount({ oneK: ONE_K, series: SERIES });
    const panel = root.findAll(n => n.props.testID === 'onek-panel')[0];
    expect(panel.findAll(n => n.props.testID === 'big3-mapping').length).toBeGreaterThan(0);
    expect(has(root, 'Bench Press')).toBe(true); // mapping summary line
    const header = root.findAll(n => n.props.accessibilityLabel === 'Expand Big 3 mapping' && n.props.onPress)[0];
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    expect(flat(header).minHeight).toBeGreaterThanOrEqual(44);
  });

  test('oneKToGoText reads the displayed target and total, never negative', async () => {
    expect(oneKToGoText(882, 1000)).toBe('118 to go');
    expect(oneKToGoText(1000, 1000)).toBe('Reached');
    expect(oneKToGoText(400, 454)).toBe('54 to go');
  });
});

describe('Progressive Overload status chips (#1604)', () => {
  test('chips show the canonical counts and expose radio semantics', async () => {
    const { root } = await mount();
    const group = root.findAll(n => n.props.accessibilityRole === 'radiogroup' && n.props.testID === 'po-filter-chips')[0];
    expect(group).toBeTruthy();
    for (const [key, label, count] of [['all', 'All', 3], ['progressing', 'Progressing', 1], ['stalled', 'Steady', 1], ['regressing', 'Regressing', 1]]) {
      const chip = root.findAll(n => n.props.testID === `po-filter-${key}` && typeof n.props.onPress === 'function')[0];
      expect(chip.props.accessibilityRole).toBe('radio');
      expect(chip.props.accessibilityLabel).toBe(`${label}, ${count}`);
      expect(flat(chip).minHeight).toBeGreaterThanOrEqual(44);
    }
    expect(root.findAll(n => n.props.testID === 'po-filter-all')[0].props.accessibilityState.selected).toBe(true);
  });

  test('a chip filters rows to its status, composes with search, and keeps counts', async () => {
    const { root } = await mount();
    expect(rows(root)).toHaveLength(3);
    press(root, 'po-filter-regressing');
    expect(rows(root).map(r => r.props.testID)).toEqual(['po-row-squat|Friday']);
    expect(root.findAll(n => n.props.testID === 'po-filter-regressing' && n.props.onPress)[0].props.accessibilityState.selected).toBe(true);
    // Counts are the canonical ones, not the filtered row count.
    expect(root.findAll(n => n.props.testID === 'po-filter-all' && n.props.onPress)[0].props.accessibilityLabel).toBe('All, 3');
    // Search narrows further; a status with nothing under it says so.
    const search = root.findAll(n => n.props.testID === 'po-search' && n.props.onChangeText)[0];
    render.act(() => { search.props.onChangeText('bench'); });
    expect(rows(root)).toHaveLength(0);
    expect(has(root, 'No matches for "bench"')).toBe(true);
    render.act(() => { search.props.onChangeText(''); });
    press(root, 'po-filter-all');
    expect(rows(root)).toHaveLength(3);
  });

  test('a status with no rows shows a filter message, not the empty-tracked prompt', async () => {
    const { root } = await mount({ signals: [SIGNALS[0], SIGNALS[1]] });
    press(root, 'po-filter-regressing');
    expect(rows(root)).toHaveLength(0);
    expect(has(root, 'No exercises match this filter')).toBe(true);
    expect(root.findAll(n => n.props.testID === 'analytics-empty-log-link')).toHaveLength(0);
    expect(root.findAll(n => n.props.testID === 'po-filter-chips').length).toBeGreaterThan(0);
  });

  test('filtered-away groups keep their collapse state, and Collapse all acts only on what is shown', async () => {
    const { root } = await mount();
    press(root, 'po-group-header-FRIDAY');
    expect(rows(root).map(r => r.props.testID)).toEqual(['po-row-bench press|Monday', 'po-row-barbell row|Monday']);
    press(root, 'po-filter-progressing');
    press(root, 'po-collapse-all');
    expect(rows(root)).toHaveLength(0);
    press(root, 'po-filter-all');
    // Monday collapsed by the bulk action, Friday still collapsed on its own.
    expect(rows(root)).toHaveLength(0);
    press(root, 'po-group-header-MONDAY');
    expect(rows(root)).toHaveLength(2);
  });

  test('pure helpers: counts, chip visibility and status filtering', async () => {
    expect(overloadCounts({ classified: 5, newlyTracked: 2, progressing: 3, stalled: 1, regressing: 1 })).toEqual({ all: 7, progressing: 3, stalled: 1, regressing: 1 });
    const progress = { classified: 0, newlyTracked: 2, progressing: 0, stalled: 0, regressing: 0 };
    expect(overloadChipsVisible({ exerciseProgress: progress, signals: [{}] }, false)).toBe(false); // baseline state
    expect(overloadChipsVisible({ exerciseProgress: { ...progress, classified: 1, progressing: 1 }, signals: [{}] }, false)).toBe(true);
    expect(overloadChipsVisible({ exerciseProgress: { ...progress, classified: 1 }, signals: [{}] }, true)).toBe(false); // loading
    const groups = [{ name: 'MONDAY', exercises: [{ name: 'Bench Press', overload_trend: 'up', currentDayHeading: 'Monday' }, { name: 'Row', overload_trend: 'flat', currentDayHeading: 'Monday' }] }];
    expect(filterGroupsByStatus(groups, 'all', {}, 'lb')).toBe(groups);
    expect(filterGroupsByStatus(groups, 'stalled', { nameDisplayMap: new Map() }, 'lb')[0].exercises.map(e => e.name)).toEqual(['Row']);
    expect(filterGroupsByStatus(groups, 'regressing', { nameDisplayMap: new Map() }, 'lb')).toEqual([]);
  });
});

describe('Progressive Overload rows and detail sheet (#1604)', () => {
  test('rows are pressable >=60dp with a trend pill and values under the column header', async () => {
    const { root } = await mount();
    const bench = rows(root)[0];
    expect(flat({ props: { style: bench.props.style({ pressed: false }) } }).minHeight).toBeGreaterThanOrEqual(60);
    expect(bench.props.accessibilityRole).toBe('button');
    expect(bench.props.accessibilityLabel).toBe('Bench Press, Progressing, 1RM 225 lb, Kilo 250 lb, Best 185 lb');
    expect(has(root, 'Progressing')).toBe(true);
    expect(has(root, 'Steady')).toBe(true);
    expect(has(root, 'Regressing')).toBe(true);
    const header = root.findAll(n => n.props.testID === 'po-column-header')[0];
    expect(texts(header)).toEqual(['Exercise', '1RM', 'Kilo', 'Best']);
  });

  test('a row opens the sheet with its values; close returns to the list with the same row', async () => {
    const { root } = await mount();
    expect(sheets(root)).toHaveLength(0);
    render.act(() => { rows(root)[0].props.onPress(); });
    const sheet = sheets(root)[0];
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    expect(texts(sheet)).toEqual(expect.arrayContaining(['Bench Press', '225 lb', '250 lb', '185 lb']));
    const close = root.findAll(n => n.props.testID === 'po-sheet-close' && n.props.onPress)[0];
    expect(close.props.accessibilityLabel).toBe('Close exercise details');
    render.act(() => { close.props.onPress(); });
    expect(sheets(root)).toHaveLength(0);
    expect(rows(root)).toHaveLength(3);
  });

  test('View in Log uses the typed note target for the current routine', async () => {
    const onNavigate = jest.fn();
    const { root } = await mount({ onNavigate });
    render.act(() => { rows(root)[0].props.onPress(); });
    press(root, 'po-sheet-view-in-log');
    expect(onNavigate).toHaveBeenCalledWith('Log', { kind: 'note', noteId: 'n1' });
    expect(sheets(root)).toHaveLength(0);
  });

  test('the selection is dropped when the routine changes', async () => {
    const { root } = await mount();
    render.act(() => { rows(root)[0].props.onPress(); });
    expect(sheets(root)).toHaveLength(1);
    const other = { id: 'n2', raw_text: NOTE.raw_text };
    useEntries.useWorkoutNotes.mockReturnValue({ notes: [other], currentNote: other, loading: false, update: jest.fn() });
    render.act(() => { trees[0].update(<AnalyticsScreen multiplier={1.07} />); });
    expect(sheets(root)).toHaveLength(0);
  });

  test('a chip chosen on one routine does not filter another', async () => {
    const { root } = await mount();
    press(root, 'po-filter-regressing');
    expect(rows(root)).toHaveLength(1);
    const other = { id: 'n2', raw_text: NOTE.raw_text };
    useEntries.useWorkoutNotes.mockReturnValue({ notes: [other], currentNote: other, loading: false, update: jest.fn() });
    render.act(() => { trees[0].update(<AnalyticsScreen multiplier={1.07} />); });
    expect(rows(root)).toHaveLength(3);
  });

  test('overloadSessionHistory lists parsed sessions newest first and marks skipped ones', async () => {
    const sections = [{
      heading: 'Monday',
      exercises: [{
        name: 'Bench Press',
        session_entries: [
          { sets: [{ weight_value: 135, rep_count: 5 }, { weight_value: 135, rep_count: 5 }] },
          { skipped: true, sets: [] },
          { sets: [{ weight_value: 145, rep_count: 3 }] },
        ],
      }],
    }];
    const sig = { name: 'Bench Press', currentDayHeading: 'Monday' };
    expect(overloadSessionHistory(sections, sig, 'lb')).toEqual([
      { ordinal: 3, text: '145 lb 3', muted: false },
      { ordinal: 2, text: 'Skipped', muted: true },
      { ordinal: 1, text: '135 lb 5, 5', muted: false },
    ]);
    expect(overloadSessionHistory(sections, { name: 'Squat', currentDayHeading: 'Monday' }, 'lb')).toEqual([]);
    expect(overloadSessionHistory(sections, { name: 'Bench Press', currentDayHeading: 'Friday' }, 'lb')).toEqual([]);
  });

  test('non-weighted rows keep their own AVG / BEST values and first-session rows have no pill', async () => {
    const analytics = {
      nameDisplayMap: new Map(),
      nonWeightedMetrics: { 'pull-up': { exercise_class: 'reps_only', avg_reps: 8, best_set_reps: 10, reps_arrow: 'up' } },
    };
    const model = overloadRowModel({ name: 'pull-up', currentDayHeading: 'Monday' }, analytics, 'lb');
    expect(model.status).toBe('progressing');
    expect(model.columns).toEqual([
      { text: '8', suffix: null, caption: 'AVG' },
      null,
      { text: '10', suffix: null, caption: 'BEST' },
    ]);
    const first = overloadRowModel({ name: 'Squat', latest_pr: 300, kilo_max: 290, latest_top_weight: 275, overload_trend: 'first_session', currentDayHeading: 'Friday' }, { nameDisplayMap: new Map() }, 'lb');
    expect(first.status).toBeNull();
    expect(first.caption).toBe('First session');
  });
});
