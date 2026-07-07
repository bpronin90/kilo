import React from 'react';
import render from 'react-test-renderer';
import { AnalyticsWeightTrendsCard } from '../components/AnalyticsWeightTrendsCard';
import { setWeightUnitPreference, __resetWeightUnitForTests } from '../lib/unitPreference';

// Capture onSelect callbacks from each LineChart instance by chart label (by order of rendering).
const capturedSelectors = [];

jest.mock('../components/LineChart', () => ({
  LineChart: ({ onSelect, data }) => {
    if (onSelect) capturedSelectors.push(onSelect);
    return null;
  },
}));

jest.mock('../components/UI', () => ({
  Card: ({ children }) => children,
  SectionTitle: ({ children }) => children,
  LineChart: ({ onSelect }) => {
    if (onSelect) capturedSelectors.push(onSelect);
    return null;
  },
}));

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
  capturedSelectors.length = 0;
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

    render.act(() => {
      // capturedSelectors[0] is the 7-day chart's onSelect
      capturedSelectors[0]({ value: 183.5, label: '05/21', unit: 'lb' });
    });

    expect(hasText(root, 'Selected · 05/21')).toBe(true);
    expect(hasText(root, '183.5')).toBe(true);
    expect(hasText(root, 'Latest weigh-in')).toBe(false);
  });

  test('selecting a point updates 7-day and 30-day footer stats for that date', () => {
    const component = setup();
    const root = component.root;

    render.act(() => {
      capturedSelectors[0]({ value: 183.5, label: '05/21', unit: 'lb' });
    });

    // Both rolling7 and rolling30 have 05/21 → both footer stats update
    expect(hasText(root, '183.5 lb')).toBe(true);
  });

  test('deselecting (onSelect null) restores the default summary', () => {
    const component = setup();
    const root = component.root;

    render.act(() => {
      capturedSelectors[0]({ value: 183.5, label: '05/21', unit: 'lb' });
    });
    expect(hasText(root, 'Selected · 05/21')).toBe(true);

    render.act(() => {
      capturedSelectors[0](null);
    });

    expect(hasText(root, 'Latest weigh-in')).toBe(true);
    expect(hasText(root, '185')).toBe(true);
    expect(hasText(root, '184.2 lb')).toBe(true);
  });

  test('selecting a point only in rolling30 (not in rolling7) shows — for 7-day avg', () => {
    const component = setup();
    const root = component.root;

    render.act(() => {
      // 05/19 exists only in rolling30, not rolling7
      capturedSelectors[1]({ value: 182.0, label: '05/19', unit: 'lb' });
    });

    expect(hasText(root, 'Selected · 05/19')).toBe(true);
    // 7-day avg shows em-dash since 05/19 is not in rolling7
    expect(findAllText(root).some(s => s === '—')).toBe(true);
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

    render.act(() => {
      capturedSelectors[0]({ value: 84, label: '05/21', unit: 'kg' });
    });

    expect(hasText(root, 'Selected · 05/21')).toBe(true);
    expect(hasText(root, '84.0')).toBe(true);
    expect(hasText(root, '84 kg')).toBe(false);
  });
});
