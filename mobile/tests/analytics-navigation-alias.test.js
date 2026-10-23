// #1602: `bodyweight` is the redesigned Analytics chapter's name for the weight
// section. It is accepted by typed navigation, reports the existing 'weight'
// measurement variant, and lands on the same anchor as 'weight' in Analytics.

import React from 'react';
import render from 'react-test-renderer';
import { normalizeNavTarget, analyticsSectionVariant } from '../app/navigation';
import { resolveSectionId } from '../screens/analytics/useAnalyticsChapterNavigation';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import * as useEntries from '../hooks/useEntries';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('../components/LineChart', () => ({ LineChart: () => null }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('../lib/productMeasurement', () => ({ recordProductMeasurement: jest.fn() }));
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
  };
});

describe('bodyweight alias in typed navigation (#1602)', () => {
  test('accepted on Analytics in both the typed and the bare string form', () => {
    expect(normalizeNavTarget('Analytics', { kind: 'section', id: 'bodyweight' })).toEqual({ kind: 'section', id: 'bodyweight' });
    expect(normalizeNavTarget('Analytics', 'bodyweight')).toEqual({ kind: 'section', id: 'bodyweight' });
    expect(normalizeNavTarget('Weight', 'bodyweight')).toBe(null);
  });

  test('reports the existing weight variant, never a new one', () => {
    expect(analyticsSectionVariant('bodyweight')).toBe('weight');
    expect(analyticsSectionVariant('weight')).toBe('weight');
    expect(analyticsSectionVariant('progressive-overload')).toBe('strength');
    expect(analyticsSectionVariant('recovery')).toBe('other');
  });

  test('production section ids resolve to themselves; only the alias is rewritten', () => {
    for (const id of ['overview', 'weight', 'strength', 'progressive-overload', 'recovery']) {
      expect(resolveSectionId(id)).toBe(id);
    }
    expect(resolveSectionId('bodyweight')).toBe('weight');
  });
});

describe('AnalyticsScreen resolves the bodyweight alias to the weight anchor (#1602)', () => {
  let trees = [];
  afterEach(() => {
    render.act(() => { trees.forEach(t => t.unmount()); });
    trees = [];
  });

  function mount(section, nonce) {
    useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: true });
    useEntries.useWeightEntries.mockReturnValue({ entries: [], loading: false, error: null });
    useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, activations: {}, loading: false });
    useEntries.useWorkoutNotes.mockReturnValue({ notes: [], currentNote: null, loading: false, update: jest.fn() });
    useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
    useEntries.useRecoveryBlockState.mockReturnValue({ blocks: [], weeks: [], loading: false, ready: true });
    let tree;
    render.act(() => { tree = render.create(<AnalyticsScreen multiplier={1.07} section={section} sectionNonce={nonce} />); });
    trees.push(tree);
    const { ScrollView } = require('react-native');
    const scrollTo = jest.fn();
    tree.root.findAllByType(ScrollView)[0].instance.scrollTo = scrollTo;
    return { tree, scrollTo };
  }

  const fireWeightLayout = (tree, y) => {
    const handler = tree.root.findAll(n => typeof n.props?.handleWeightLayout === 'function')[0].props.handleWeightLayout;
    render.act(() => { handler({ nativeEvent: { layout: { y } } }); });
  };

  test('a pending bodyweight request lands on the weight section once it is laid out', () => {
    const { tree, scrollTo } = mount('bodyweight', 1);
    expect(scrollTo).not.toHaveBeenCalled();
    fireWeightLayout(tree, 640);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 640 }));
  });

  test('repeated weight and bodyweight requests each re-land on the same anchor', () => {
    const { tree, scrollTo } = mount(null, 0);
    fireWeightLayout(tree, 640);
    let nonce = 0;
    for (const section of ['bodyweight', 'bodyweight', 'weight', 'bodyweight']) {
      nonce += 1;
      render.act(() => { tree.update(<AnalyticsScreen multiplier={1.07} section={section} sectionNonce={nonce} />); });
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ y: 640 }));
    }
    expect(scrollTo).toHaveBeenCalledTimes(4);
  });
});
