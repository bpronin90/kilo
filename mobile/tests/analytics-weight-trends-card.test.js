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
  weightCount: '10',
  avg7: '184.2 lb',
  avg30: '183.0 lb',
  paceFlag: null,
  paceLevel: null,
};

const ROLLING7 = [
  { value: 183.0, label: '05/20', unit: 'lb' },
  { value: 183.5, label: '05/21', unit: 'lb' },
  { value: 184.0, label: '05/22', unit: 'lb' },
  { value: 184.2, label: '05/23', unit: 'lb' },
  { value: 184.5, label: '05/24', unit: 'lb' },
  { value: 184.8, label: '05/25', unit: 'lb' },
  { value: 185.0, label: '05/26', unit: 'lb' },
];

const ROLLING30 = [
  ...ROLLING7,
  { value: 182.0, label: '05/19', unit: 'lb' },
];

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

describe('AnalyticsWeightTrendsCard — default state', () => {
  test('shows Latest weigh-in label and current summary values', () => {
    const component = setup();
    const root = component.root;
    expect(hasText(root, 'Latest weigh-in')).toBe(true);
    expect(hasText(root, '185')).toBe(true);
    expect(hasText(root, '184.2 lb')).toBe(true);
    expect(hasText(root, '183.0 lb')).toBe(true);
  });
});

describe('AnalyticsWeightTrendsCard — selected date state', () => {
  test('selecting a chart point updates the header to show selected date and rolling value', () => {
    const component = setup();
    const root = component.root;

    selectPoint(root, { value: 183.5, label: '05/21', unit: 'lb' });

    expect(hasText(root, 'Selected · 05/21')).toBe(true);
    expect(hasText(root, '183.5')).toBe(true);
    expect(hasText(root, 'Latest weigh-in')).toBe(false);
  });

  test('selecting a point updates 7-day and 30-day footer stats for that date', () => {
    const component = setup();
    const root = component.root;

    selectPoint(root, { value: 183.5, label: '05/21', unit: 'lb' });

    // Both rolling7 and rolling30 have 05/21 → both footer stats update
    expect(hasText(root, '183.5 lb')).toBe(true);
  });

  test('deselecting (onSelect null) restores the default summary', () => {
    const component = setup();
    const root = component.root;

    selectPoint(root, { value: 183.5, label: '05/21', unit: 'lb' });
    expect(hasText(root, 'Selected · 05/21')).toBe(true);

    selectPoint(root, null);

    expect(hasText(root, 'Latest weigh-in')).toBe(true);
    expect(hasText(root, '185')).toBe(true);
    expect(hasText(root, '184.2 lb')).toBe(true);
  });

  test('selecting a point only in rolling30 (not in rolling7) shows N/A for 7-day avg', () => {
    const component = setup();
    const root = component.root;

    // 05/19 exists only in rolling30, which the 30-day view draws
    pickWindow(root, '30');
    selectPoint(root, { value: 182.0, label: '05/19', unit: 'lb' });

    expect(hasText(root, 'Selected · 05/19')).toBe(true);
    // 7-day avg shows N/A since 05/19 is not in rolling7
    expect(findAllText(root).some(s => s === 'N/A')).toBe(true);
    // 30-day avg shows the matching value
    expect(hasText(root, '182.0 lb')).toBe(true);
  });

  test('selected kg chart point keeps one decimal in the header', () => {
    setWeightUnitPreference('kg');
    const kgRolling7 = [
      { value: 83.9, label: '05/20', unit: 'kg' },
      { value: 84, label: '05/21', unit: 'kg' },
    ];
    const kgRolling30 = [
      ...kgRolling7,
      { value: 83.5, label: '05/19', unit: 'kg' },
    ];
    const component = setup({
      weightSummary: {
        latestWeightValue: '84.0',
        showUnit: true,
        weightCount: '10',
        avg7: '84.0 kg',
        avg30: '83.8 kg',
        paceFlag: null,
        paceLevel: null,
      },
      rolling7: kgRolling7,
      rolling30: kgRolling30,
    });
    const root = component.root;

    selectPoint(root, { value: 84, label: '05/21', unit: 'kg' });

    expect(hasText(root, 'Selected · 05/21')).toBe(true);
    expect(hasText(root, '84.0')).toBe(true);
    expect(hasText(root, '84 kg')).toBe(false);
  });
});

describe('AnalyticsWeightTrendsCard — pace badge elapsed period (#941)', () => {
  test('spike badge names the elapsed span alongside the fast-change label', () => {
    const component = setup({
      weightSummary: {
        ...BASE_SUMMARY,
        paceFlag: 'gain',
        paceLevel: 'spike',
        paceElapsedDays: 1,
      },
    });
    const root = component.root;
    expect(hasText(root, '↑ Gaining fast')).toBe(true);
    expect(hasText(root, 'day-over-day')).toBe(true);
  });

  test('multi-day notable badge names the number of days', () => {
    const component = setup({
      weightSummary: {
        ...BASE_SUMMARY,
        paceFlag: 'loss',
        paceLevel: 'notable',
        paceElapsedDays: 5,
      },
    });
    const root = component.root;
    expect(hasText(root, '↓ Losing fast')).toBe(true);
    expect(hasText(root, 'over 5 days')).toBe(true);
  });
});

describe('AnalyticsWeightTrendsCard — one chart with a 7d/30d window', () => {
  test('renders exactly one chart, drawing the canonical 7-day series by default', () => {
    const root = setup().root;
    expect(charts(root)).toHaveLength(1);
    // Same reference: the card draws the prop it was given, never a derived copy.
    expect(charts(root)[0].props.data).toBe(ROLLING7);
    expect(charts(root)[0].props.seriesLabel).toBe('7-day rolling average bodyweight');
    expect(root.findByProps({ testID: 'weight-trends-window-7' }).props.accessibilityState).toEqual({ selected: true });
  });

  test('the selector swaps the displayed series between the existing rolling7 and rolling30', () => {
    const root = setup().root;
    pickWindow(root, '30');
    expect(charts(root)).toHaveLength(1);
    expect(charts(root)[0].props.data).toBe(ROLLING30);
    expect(charts(root)[0].props.seriesLabel).toBe('30-day rolling average bodyweight');
    expect(root.findByProps({ testID: 'weight-trends-window-30' }).props.accessibilityState).toEqual({ selected: true });

    pickWindow(root, '7');
    expect(charts(root)[0].props.data).toBe(ROLLING7);
  });

  test('both averages stay visible in either window', () => {
    const root = setup().root;
    for (const key of ['7', '30']) {
      pickWindow(root, key);
      expect(hasText(root, '184.2 lb')).toBe(true);
      expect(hasText(root, '183.0 lb')).toBe(true);
      expect(hasText(root, '7-day avg')).toBe(true);
      expect(hasText(root, '30-day avg')).toBe(true);
    }
  });

  test('selection in the 30-day view shows that point and both averages for its date', () => {
    const root = setup().root;
    pickWindow(root, '30');
    selectPoint(root, { value: 184.0, label: '05/22', unit: 'lb' });
    expect(hasText(root, 'Selected · 05/22')).toBe(true);
    expect(findAllText(root).filter(t => t === '184.0 lb')).toHaveLength(2);
  });

  test('switching windows clears a selection so the header matches the visible chart', () => {
    const root = setup().root;
    selectPoint(root, { value: 183.5, label: '05/21', unit: 'lb' });
    pickWindow(root, '30');
    expect(hasText(root, 'Latest weigh-in')).toBe(true);
    expect(hasText(root, 'Selected ·')).toBe(false);
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

  test('same date with different values per series: the selected view supplies the header, both footers look up their own series', () => {
    const r7 = [{ value: 180.4, label: '06/01', unit: 'lb' }, { value: 180.6, label: '06/02', unit: 'lb' }];
    const r30 = [{ value: 182.1, label: '06/01', unit: 'lb' }, { value: 182.3, label: '06/02', unit: 'lb' }];
    const root = setup({ rolling7: r7, rolling30: r30 }).root;

    selectPoint(root, r7[1]);
    expect(hasText(root, 'Selected · 06/02')).toBe(true);
    expect(hasText(root, '180.6')).toBe(true);
    expect(hasText(root, '182.3 lb')).toBe(true);

    pickWindow(root, '30');
    selectPoint(root, r30[0]);
    expect(hasText(root, 'Selected · 06/01')).toBe(true);
    expect(hasText(root, '182.1')).toBe(true);
    expect(hasText(root, '180.4 lb')).toBe(true);
    expect(hasText(root, '182.1 lb')).toBe(true);
  });

  test('switching windows never mutates either input series', () => {
    const r7 = Object.freeze(ROLLING7.map(p => Object.freeze({ ...p })));
    const r30 = Object.freeze(ROLLING30.map(p => Object.freeze({ ...p })));
    const snap7 = JSON.stringify(r7);
    const snap30 = JSON.stringify(r30);
    const root = setup({ rolling7: r7, rolling30: r30 }).root;
    pickWindow(root, '30');
    selectPoint(root, r30[2]);
    pickWindow(root, '7');
    expect(charts(root)[0].props.data).toBe(r7);
    expect(JSON.stringify(r7)).toBe(snap7);
    expect(JSON.stringify(r30)).toBe(snap30);
  });

  test('the window header wraps so the selector cannot overlap the label at large font scales', () => {
    const { createStyles } = require('../components/AnalyticsWeightTrendsCard');
    const styles = createStyles({});
    expect(styles.chartHeader.flexWrap).toBe('wrap');
    expect(styles.chartLabelFlex.flexShrink).toBe(1);
  });

  test('loading shows one spinner in place of the chart', () => {
    const root = setup({ rolling7: [], rolling30: [], isWeightLoading: true }).root;
    expect(charts(root)).toHaveLength(0);
    expect(root.findAllByType('ActivityIndicator')).toHaveLength(1);
  });
});
