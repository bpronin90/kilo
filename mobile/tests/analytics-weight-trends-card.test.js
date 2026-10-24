import React from 'react';
import render from 'react-test-renderer';
import { AnalyticsWeightTrendsCard } from '../components/AnalyticsWeightTrendsCard';
import { setWeightUnitPreference, __resetWeightUnitForTests } from '../lib/unitPreference';

// The card renders one LineChart; tests read its props off the rendered tree.
jest.mock('../components/UI', () => ({
  Card: ({ children }) => children,
  SectionTitle: ({ children }) => children,
  LineChart: function MockLineChart() { return null; },
}));
const { LineChart: MockLineChart } = require('../components/UI');

function charts(root) {
  return root.findAllByType(MockLineChart);
}

function selectPoint(root, point) {
  render.act(() => { charts(root)[0].props.onSelect(point); });
}

const plotOf = (root) => charts(root)[0].props.weightPlot;

function pickWindow(root, key) {
  render.act(() => { root.findByProps({ testID: `weight-trends-window-${key}` }).props.onPress(); });
}

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const BASE_SUMMARY = {
  latestWeightValue: '185',
  showUnit: true,
  weightCount: '8',
  avg7: '184.2 lb',
  avg30: '183.0 lb',
  paceFlag: null,
  paceLevel: null,
};

// Eight weigh-in dates, newest first, as AnalyticsScreen passes them (lb).
const DATES = ['2026-05-26', '2026-05-25', '2026-05-24', '2026-05-23', '2026-05-22', '2026-05-21', '2026-05-20', '2026-05-19'];
const ENTRIES = DATES.map((date, i) => ({
  id: `w${i}`,
  date,
  weight_value: 185 - i * 0.5,
  note: i === 5 ? 'Morning, fasted' : '',
}));
const series = (base, step) => [...DATES].reverse().map((date, i) => ({
  value: Number((base + i * step).toFixed(1)),
  label: date.split('-').slice(1).join('/'),
  unit: 'lb',
}));
const ROLLING7 = series(181.5, 0.5);
const ROLLING30 = series(182.0, 0.4);

const TRENDS = {
  currentWeight: 185,
  avg7: 184.2,
  avg30: 183.0,
  priorAvg7: 184.9,
  priorAvg30: 185.3,
  recentDateWeight: 185,
  priorDateWeight: 184.5,
};

const GOAL = { direction: 'loss', target: 175, met: false, info: { direction: 'loss', required_weekly_pace: -1.25, warnings: [] } };

function setup(overrides = {}) {
  let component;
  render.act(() => {
    component = render.create(
      <AnalyticsWeightTrendsCard
        handleWeightLayout={() => {}}
        weightSummary={BASE_SUMMARY}
        rolling7={ROLLING7}
        rolling30={ROLLING30}
        isWeightLoading={false}
        entries={ENTRIES}
        trends={TRENDS}
        goalContext={null}
        {...overrides}
      />
    );
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

afterEach(() => {
  __resetWeightUnitForTests();
});

describe('AnalyticsWeightTrendsCard — Latest weigh-in header', () => {
  test('shows the fixed Latest weigh-in metric with its date and change vs the previous weigh-in', () => {
    const root = setup().root;
    expect(hasText(root, 'Latest weigh-in')).toBe(true);
    expect(hasText(root, '185')).toBe(true);
    expect(hasText(root, '05-26-2026')).toBe(true);
    expect(hasText(root, 'vs previous weigh-in')).toBe(true);
    const change = root.findByProps({ testID: 'bodyweight-latest-change' });
    expect(change.props.text).toBe('+0.5');
  });

  test('selecting a chart point never replaces the Latest header or the averages', () => {
    const root = setup().root;
    const before = JSON.stringify(findAllText(root));
    selectPoint(root, plotOf(root).points[2]);
    expect(JSON.stringify(findAllText(root))).toBe(before);
    expect(hasText(root, 'Selected')).toBe(false);
    selectPoint(root, null);
    expect(JSON.stringify(findAllText(root))).toBe(before);
  });

  test('shows the averages with their signed changes', () => {
    const root = setup().root;
    expect(hasText(root, '7-day avg')).toBe(true);
    expect(hasText(root, '30-day avg')).toBe(true);
    expect(hasText(root, '184.2')).toBe(true);
    expect(hasText(root, '183.0')).toBe(true);
    expect(root.findByProps({ testID: 'bodyweight-avg-7-change' }).props.text).toBe('-0.7');
    expect(root.findByProps({ testID: 'bodyweight-avg-30-change' }).props.text).toBe('-2.3');
  });

  test('a first weigh-in has no change and no averages to compare', () => {
    const root = setup({
      entries: [ENTRIES[0]],
      rolling7: [ROLLING7[0]],
      rolling30: [ROLLING30[0]],
      trends: { ...TRENDS, priorAvg7: null, priorAvg30: null, priorDateWeight: null },
    }).root;
    expect(root.findAllByProps({ testID: 'bodyweight-latest-change' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'bodyweight-avg-7-change' })).toHaveLength(0);
    expect(charts(root)).toHaveLength(0);
  });

  test('no weigh-ins: N/A value, no metadata, no goal decorations', () => {
    const root = setup({
      entries: [],
      rolling7: [],
      rolling30: [],
      trends: null,
      weightSummary: { ...BASE_SUMMARY, latestWeightValue: 'N/A', showUnit: false, weightCount: '0' },
    }).root;
    expect(hasText(root, 'N/A')).toBe(true);
    expect(root.findAllByProps({ testID: 'bodyweight-latest-meta' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'bodyweight-goal' })).toHaveLength(0);
  });

  test('Log or manage weight opens Weight', () => {
    const onNavigate = jest.fn();
    const root = setup({ onNavigate }).root;
    render.act(() => { root.findByProps({ testID: 'bodyweight-log-weight' }).props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Weight');
  });
});

describe('AnalyticsWeightTrendsCard — goal-aware change tone', () => {
  const toneOf = (root, id) => root.findByProps({ testID: id }).props.tone;

  test('cutting: falling toward the goal is positive, rising is negative', () => {
    const root = setup({ goalContext: GOAL }).root;
    expect(toneOf(root, 'bodyweight-avg-7-change')).toBe('positive');
    const rising = setup({ goalContext: GOAL, trends: { ...TRENDS, avg7: 185.5, priorAvg7: 184.9 } }).root;
    expect(toneOf(rising, 'bodyweight-avg-7-change')).toBe('negative');
  });

  test('bulking inverts the same movement', () => {
    const bulk = { ...GOAL, direction: 'gain', target: 195, info: { ...GOAL.info, direction: 'gain', required_weekly_pace: 1 } };
    const root = setup({ goalContext: bulk }).root;
    expect(toneOf(root, 'bodyweight-avg-7-change')).toBe('negative');
  });

  test('zero change is neutral and carries no arrow direction', () => {
    const root = setup({ goalContext: GOAL, trends: { ...TRENDS, avg7: 184.9, priorAvg7: 184.9 } }).root;
    const delta = root.findByProps({ testID: 'bodyweight-avg-7-change' });
    expect(delta.props.text).toBe('0.0');
    expect(delta.props.tone).toBeNull();
    expect(delta.props.direction).toBe('flat');
  });

  test('without a verified goal a bare fall/rise keeps the directional tone', () => {
    const root = setup().root;
    expect(toneOf(root, 'bodyweight-avg-7-change')).toBe('losing');
  });
});

describe('AnalyticsWeightTrendsCard — goal decorations', () => {
  test('a verified active goal adds the dashed-line target, the mode/target/to-go cell and Target pace', () => {
    const root = setup({ goalContext: GOAL }).root;
    expect(plotOf(root).goal).toEqual({ value: 175, text: '175' });
    expect(hasText(root, 'Goal · Cutting')).toBe(true);
    expect(hasText(root, '10.0 to go')).toBe(true);
    expect(hasText(root, 'Target pace')).toBe(true);
    expect(hasText(root, '1.25')).toBe(true);
    expect(hasText(root, 'lb/wk')).toBe(true);
  });

  test.each([
    ['no goal / ended / unverified (null context)', null],
  ])('%s draws none of the goal decorations', (_n, goalContext) => {
    const root = setup({ goalContext }).root;
    expect(plotOf(root).goal).toBeNull();
    expect(root.findAllByProps({ testID: 'bodyweight-goal' })).toHaveLength(0);
    expect(root.findAllByProps({ testID: 'bodyweight-target-pace' })).toHaveLength(0);
    expect(hasText(root, 'to go')).toBe(false);
  });

  test('a met goal keeps the target but states no remaining distance', () => {
    const root = setup({ goalContext: { ...GOAL, met: true } }).root;
    expect(hasText(root, 'Goal · Cutting')).toBe(true);
    expect(hasText(root, 'to go')).toBe(false);
  });

  test('a maintain goal reads Maintain for the pace', () => {
    const maintain = { ...GOAL, direction: 'maintain', target: 185, info: { ...GOAL.info, direction: 'maintain', required_weekly_pace: 0 } };
    const root = setup({ goalContext: maintain }).root;
    expect(hasText(root, 'Goal · Maintaining')).toBe(true);
    expect(hasText(root, 'Maintain')).toBe(true);
  });

  test('a goal with no pace guidance shows a dash', () => {
    const root = setup({ goalContext: { ...GOAL, info: { ...GOAL.info, required_weekly_pace: null } } }).root;
    expect(findAllText(root).some(s => s === '-')).toBe(true);
  });
});

describe('AnalyticsWeightTrendsCard — pace badge elapsed period (#941)', () => {
  test('spike badge names the elapsed span alongside the fast-change label', () => {
    const root = setup({
      weightSummary: { ...BASE_SUMMARY, paceFlag: 'gain', paceLevel: 'spike', paceElapsedDays: 1 },
    }).root;
    expect(hasText(root, '↑ Gaining fast')).toBe(true);
    expect(hasText(root, 'day-over-day')).toBe(true);
  });

  test('multi-day notable badge names the number of days', () => {
    const root = setup({
      weightSummary: { ...BASE_SUMMARY, paceFlag: 'loss', paceLevel: 'notable', paceElapsedDays: 5 },
    }).root;
    expect(hasText(root, '↓ Losing fast')).toBe(true);
    expect(hasText(root, 'over 5 days')).toBe(true);
  });

  test('the badge stays in the header while a point is selected', () => {
    const root = setup({
      weightSummary: { ...BASE_SUMMARY, paceFlag: 'loss', paceLevel: 'notable', paceElapsedDays: 5 },
    }).root;
    selectPoint(root, plotOf(root).points[0]);
    expect(root.findAllByProps({ testID: 'bodyweight-pace-badge' }).length).toBeGreaterThan(0);
  });
});

describe('AnalyticsWeightTrendsCard — every weigh-in at its recorded date, one rolling line', () => {
  test('renders exactly one chart and plots every usable weigh-in in date order', () => {
    const root = setup().root;
    expect(charts(root)).toHaveLength(1);
    const { points } = plotOf(root);
    expect(points).toHaveLength(ENTRIES.length);
    expect(points.map(p => p.date)).toEqual([...DATES].reverse());
    expect(points.map(p => p.id)).toEqual(['w7', 'w6', 'w5', 'w4', 'w3', 'w2', 'w1', 'w0']);
    expect(points[points.length - 1].value).toBe(185);
    expect(charts(root)[0].props.seriesLabel).toBe('7-day rolling average bodyweight');
  });

  test('each point carries its recorded date, note and the active window average', () => {
    const root = setup().root;
    const point = plotOf(root).points.find(p => p.id === 'w5');
    expect(point.label).toBe('05-21-2026');
    expect(point.note).toBe('Morning, fasted');
    expect(point.avgText).toBe('7-day avg 182.5');
    expect(point.announce).toContain('note: Morning, fasted');
  });

  test('the selector swaps only the rolling line and average, never the weigh-ins or the date range', () => {
    const root = setup().root;
    const before = plotOf(root);
    pickWindow(root, '30');
    const after = plotOf(root);
    expect(charts(root)).toHaveLength(1);
    expect(charts(root)[0].props.seriesLabel).toBe('30-day rolling average bodyweight');
    expect(after.points.map(p => [p.id, p.date, p.value])).toEqual(before.points.map(p => [p.id, p.date, p.value]));
    expect(after.line.map(p => p.t)).toEqual(before.line.map(p => p.t));
    expect(after.line.map(p => p.value)).toEqual(ROLLING30.map(p => p.value));
    expect(after.points[0].avgText).toBe('30-day avg 182.0');
    expect(root.findByProps({ testID: 'weight-trends-window-30' }).props.accessibilityState).toEqual({ selected: true, checked: true });
    expect(root.findByProps({ testID: 'weight-trends-window-7' }).props.accessibilityState).toEqual({ selected: false, checked: false });
    pickWindow(root, '7');
    expect(plotOf(root).line.map(p => p.value)).toEqual(ROLLING7.map(p => p.value));
  });

  test('the toggle is a radio group with 44dp options', () => {
    const root = setup().root;
    const group = root.findByProps({ accessibilityRole: 'radiogroup' });
    expect(group.props.accessibilityLabel).toBe('Rolling average window');
    const { createStyles } = require('../components/AnalyticsWeightTrendsCard');
    expect(createStyles({}).toggleOption.minHeight).toBe(44);
    expect(createStyles({}).toggleOption.minWidth).toBeGreaterThanOrEqual(44);
  });

  test('the caption states count, recorded dates, rolling line and latest ring', () => {
    const root = setup().root;
    expect(hasText(root, '8 weigh-ins at recorded dates')).toBe(true);
    expect(hasText(root, 'Line: 7-day rolling average')).toBe(true);
    expect(hasText(root, 'Ring: latest weigh-in')).toBe(true);
    pickWindow(root, '30');
    expect(hasText(root, 'Line: 30-day rolling average')).toBe(true);
  });

  test('a notes-free weigh-in has an empty note, and an unmatched series attaches no average', () => {
    const root = setup({ rolling7: ROLLING7.slice(2) }).root;
    // rolling7 no longer lines up with the distinct dates: no wrong-day average.
    expect(plotOf(root).points.every(p => p.avg === null)).toBe(true);
    expect(plotOf(root).line).toEqual([]);
  });

  test('kg: weigh-ins and the goal are converted once, to one decimal', () => {
    setWeightUnitPreference('kg');
    const root = setup({
      goalContext: GOAL,
      rolling7: ROLLING7.map(p => ({ ...p, value: Math.round(p.value * 0.45359237 * 10) / 10, unit: 'kg' })),
    }).root;
    const { points, goal } = plotOf(root);
    expect(points[points.length - 1].value).toBe(83.9);
    expect(points[points.length - 1].unit).toBe('kg');
    expect(goal).toEqual({ value: 79.4, text: '79.4' });
  });

  test('each window keeps its own insufficient-data handoff', () => {
    const onNavigate = jest.fn();
    const root = setup({ rolling7: [ROLLING7[0]], onNavigate }).root;
    expect(charts(root)).toHaveLength(0);
    render.act(() => { root.findByProps({ testID: 'weight-trends-empty-log-link' }).props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Weight');

    pickWindow(root, '30');
    expect(charts(root)).toHaveLength(1);
    expect(root.findAllByProps({ testID: 'weight-trends-empty-log-link' })).toHaveLength(0);
  });

  test('switching windows never mutates the inputs', () => {
    const r7 = Object.freeze(ROLLING7.map(p => Object.freeze({ ...p })));
    const r30 = Object.freeze(ROLLING30.map(p => Object.freeze({ ...p })));
    const entries = Object.freeze(ENTRIES.map(e => Object.freeze({ ...e })));
    const snap = JSON.stringify([r7, r30, entries]);
    const root = setup({ rolling7: r7, rolling30: r30, entries }).root;
    pickWindow(root, '30');
    selectPoint(root, plotOf(root).points[2]);
    pickWindow(root, '7');
    expect(JSON.stringify([r7, r30, entries])).toBe(snap);
  });

  test('without entries the chart falls back to the rolling series alone', () => {
    const root = setup({ entries: null }).root;
    expect(charts(root)[0].props.data).toBe(ROLLING7);
    expect(plotOf(root)).toBeNull();
  });

  test('loading shows one spinner in place of the chart', () => {
    const root = setup({ rolling7: [], rolling30: [], entries: [], isWeightLoading: true }).root;
    expect(charts(root)).toHaveLength(0);
    expect(root.findAllByType('ActivityIndicator')).toHaveLength(1);
  });
});
