// Card #1051 split AnalyticsScreen.js into presentation modules under
// mobile/screens/analytics/ to keep the screen under 600 lines. The evidence
// hierarchy pass replaced the Overview/Progression composers with
// AnalyticsLayout (pure section ordering), AnalyticsProgressiveOverload,
// AnalyticsStates and analyticsStyles. This suite pins:
//
//   1. The public boundary: `AnalyticsScreen` is still the same named export
//      other screens/tests import and mock.
//   2. The ordering contract: `orderAnalyticsSections` places the same
//      elements in the normal or active-Recovery hierarchy, never adding or
//      dropping a section between them.
//
// Full behavioral coverage lives in analytics-screen.test.js.

import React from 'react';
import render from 'react-test-renderer';
import { View } from 'react-native';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { orderAnalyticsSections } from '../screens/analytics/AnalyticsLayout';
import { createStyles } from '../screens/analytics/analyticsStyles';
import { describePoRowState, renderOverloadListContent } from '../screens/analytics/AnalyticsStates';
import * as useEntries from '../hooks/useEntries';

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
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// Every mounted instance subscribes to the reload/notify fan-outs, so trees
// MUST be unmounted between tests or listeners leak across them (#679-style;
// see one-k-progress-consistency.test.js).
let mountedTrees = [];
afterEach(() => {
  render.act(() => { mountedTrees.forEach(t => t.unmount()); });
  mountedTrees = [];
});

function setup({ hookOverrides = {} } = {}) {
  useEntries.useFeatureToggles.mockReturnValue({
    fatigueTrackingEnabled: true,
    deloadModeEnabled: true,
    setFatigueTrackingEnabled: jest.fn(),
    setDeloadModeEnabled: jest.fn(),
  });
  useEntries.useWeightEntries.mockReturnValue({ entries: [], loading: false, error: null });
  useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, activations: {}, loading: false });
  useEntries.useWorkoutNotes.mockReturnValue({ notes: [], currentNote: null, loading: false, update: jest.fn(), ...hookOverrides });
  useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
  useEntries.useRecoveryBlockState.mockReturnValue({
    blocks: [], weeks: [], loading: false, activeBlock: null, ready: true, stale: false, pendingRecovery: [],
  });

  const scrollTo = jest.fn();
  let component;
  render.act(() => {
    component = render.create(
      <AnalyticsScreen
        multiplier={1.07}
        section={hookOverrides.section ?? null}
        sectionNonce={hookOverrides.sectionNonce}
        onNavigate={hookOverrides.onNavigate}
      />
    );
  });
  mountedTrees.push(component);
  const { ScrollView } = require('react-native');
  const inst = component.root.findAllByType(ScrollView)[0]?.instance;
  if (inst) inst.scrollTo = scrollTo;
  return { component, scrollTo };
}

describe('AnalyticsScreen public boundary (card #1051)', () => {
  test('AnalyticsScreen is still exported by name from the screen module', () => {
    expect(typeof AnalyticsScreen).toBe('function');
    expect(AnalyticsScreen.name).toBe('AnalyticsScreen');
  });

  test('AnalyticsScreen still mounts and renders without the extracted files changing its own contract', () => {
    const { component } = setup();
    expect(component.toJSON()).not.toBeNull();
  });
});

describe('AnalyticsScreen Training breakdown (#1580, dashboard #1588)', () => {
  const notes = [{ id: 'n1', title: 'Routine', date: '2026-05-26', raw_text: 'Monday\n-Barbell Bench Press: 3x5\n135 5,5,5' }];

  test('renders the dashboard after Strength from the verified, paired population', async () => {
    const { component } = setup({ hookOverrides: { notes, currentNote: notes[0] } });
    for (let i = 0; i < 5; i++) await render.act(async () => { await Promise.resolve(); });
    const json = JSON.stringify(component.toJSON());
    expect(json.indexOf('Strength')).toBeLessThan(json.indexOf('Training breakdown'));
    expect(json.indexOf('Training breakdown')).toBeLessThan(json.indexOf('Routine Health'));
    const { AnalyticsTrainingBreakdown } = require('../components/AnalyticsTrainingBreakdown');
    const props = component.root.findByType(AnalyticsTrainingBreakdown).props;
    expect(props.populationVerified).toBe(true);
    expect(props.parsedSections.normalNotes.map((n) => n.id)).toEqual(['n1']);
    expect(props.parsedSections.noteSectionsList).toHaveLength(1);
    const sets = component.root.findAll((n) => n.props.testID === 'training-breakdown-completed-sets' && typeof n.type !== 'string');
    expect([].concat(sets[0].props.children).join('')).toBe('3');
  });

  test('an unverified Recovery boundary passes populationVerified=false and never paints a breakdown', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const hooks = require('../hooks/entries/recoveryBlockHooks');
    hooks._resetRecoveryAnalyticsFilterCache();
    AsyncStorage.getItem.mockImplementation(async (key) => {
      if (key === 'kilo_recovery_blocks' || key === 'kilo_recovery_block_weeks') throw new Error('storage unavailable');
      return null;
    });
    try {
      const { component } = setup({ hookOverrides: { notes, currentNote: notes[0] } });
      for (let i = 0; i < 5; i++) await render.act(async () => { await Promise.resolve(); });
      const { AnalyticsTrainingBreakdown } = require('../components/AnalyticsTrainingBreakdown');
      expect(component.root.findByType(AnalyticsTrainingBreakdown).props.populationVerified).toBe(false);
      expect(component.root.findAll((n) => n.props.testID === 'training-breakdown-completed-sets')).toHaveLength(0);
      expect(component.root.findAll((n) => n.props.testID === 'training-breakdown-empty')).toHaveLength(0);
    } finally {
      AsyncStorage.getItem.mockReset();
      hooks._resetRecoveryAnalyticsFilterCache();
    }
  });

  test('with no notes it shows the empty state rather than zeros', () => {
    const { component } = setup();
    const empty = component.root.findAllByProps({ testID: 'training-breakdown-empty' });
    const pending = component.root.findAllByProps({ testID: 'training-breakdown-loading' });
    expect(empty.length + pending.length).toBeGreaterThan(0);
    expect(component.root.findAllByProps({ testID: 'training-breakdown-completed-sets' })).toHaveLength(0);
  });
});

describe('orderAnalyticsSections — the two hierarchies', () => {
  const el = (key) => React.createElement(View, { key });
  const parts = () => ({
    banners: [null, el('weight-error-banner')],
    strength: el('strength'),
    trainingBreakdown: el('tb'),
    progressiveOverload: el('po'),
    weight: el('weight'),
    routineHealth: el('routine'),
    recovery: el('recovery'),
    disclosure: el('disclosure'),
  });
  const keys = (items) => items.filter(Boolean).map(i => i.key);

  test('normal training: Strength → Training breakdown → Routine Health → Progressive Overload → Weight → Recovery history', () => {
    expect(keys(orderAnalyticsSections({ isActiveRecovery: false, baselineExpanded: false, ...parts() })))
      .toEqual(['weight-error-banner', 'strength', 'tb', 'routine', 'po', 'weight', 'recovery']);
  });

  test('normal training with no Recovery history leaves no slot behind', () => {
    expect(keys(orderAnalyticsSections({ isActiveRecovery: false, ...parts(), recovery: null })))
      .toEqual(['weight-error-banner', 'strength', 'tb', 'routine', 'po', 'weight']);
  });

  test('active Recovery, collapsed: Recovery → Weight → disclosure, baseline hidden', () => {
    expect(keys(orderAnalyticsSections({ isActiveRecovery: true, baselineExpanded: false, ...parts() })))
      .toEqual(['weight-error-banner', 'recovery', 'weight', 'disclosure']);
  });

  test('active Recovery, expanded: disclosure holds Strength → Training breakdown → Progressive Overload → Routine Health', () => {
    expect(keys(orderAnalyticsSections({ isActiveRecovery: true, baselineExpanded: true, ...parts() })))
      .toEqual(['weight-error-banner', 'recovery', 'weight', 'disclosure', 'strength', 'tb', 'po', 'routine']);
  });

  test('a caller that supplies no Training breakdown leaves no slot behind', () => {
    const { trainingBreakdown, ...rest } = parts();
    expect(keys(orderAnalyticsSections({ isActiveRecovery: false, ...rest })))
      .toEqual(['weight-error-banner', 'strength', 'routine', 'po', 'weight', 'recovery']);
  });

  test('the disclosure never renders outside active Recovery', () => {
    expect(keys(orderAnalyticsSections({ isActiveRecovery: false, baselineExpanded: true, ...parts() })))
      .not.toContain('disclosure');
  });
});

describe('analyticsStyles.createStyles (card #1051)', () => {
  test('exposes the style keys the section / disclosure / row presentation depend on', () => {
    const styles = createStyles({
      textMuted: '#888', background: '#fff', text: '#000', inputBackground: '#eee',
      inputBorder: '#ccc', divider: '#ddd', subtleBg: '#f5f5f5', accentText: '#00f',
    });
    for (const key of [
      'baselineDisclosureToggle', 'poSection', 'routineHealthSection', 'searchInput',
      'poContainer', 'groupHeader', 'signalRow', 'trackingCaption',
      'emptyTracked', 'emptyTrackedLink',
    ]) {
      expect(styles[key]).toBeDefined();
    }
  });
});

describe('AnalyticsStates.describePoRowState (card #1051)', () => {
  test('no capability data → no caption', () => {
    expect(describePoRowState({ isFirstSpanSession: true, hasCapabilityData: false })).toBeNull();
  });

  test('first session in the tracked span → "First session"', () => {
    expect(describePoRowState({ isFirstSpanSession: true, hasCapabilityData: true })).toBe('First session');
  });

  test('classified row → no inline methodology caption (it lives behind the PO info toggle)', () => {
    expect(describePoRowState({ isFirstSpanSession: false, hasCapabilityData: true })).toBeNull();
  });

  test('renderOverloadListContent shows the loading state while notes/tracked lifts are loading', () => {
    const element = renderOverloadListContent({
      isNotesLoading: true,
      isTrackedLoading: false,
      groupedSignals: [],
      collapsedGroups: new Set(),
      toggleGroup: jest.fn(),
      analytics: {},
      trackedLiftActivations: {},
      unit: 'lb',
      colors: { accent: '#00f' },
      styles: createStyles({ textMuted: '#888', background: '#fff', text: '#000', inputBackground: '#eee', inputBorder: '#ccc', divider: '#ddd', subtleBg: '#eee', accentText: '#00f' }),
      searchQuery: '',
      onNavigate: jest.fn(),
    });
    expect(element.key).toBe('loading');
  });

  test('renderOverloadListContent shows the empty-tracked state (with the Go to Log link) when there are no groups and no search', () => {
    const element = renderOverloadListContent({
      isNotesLoading: false,
      isTrackedLoading: false,
      groupedSignals: [],
      collapsedGroups: new Set(),
      toggleGroup: jest.fn(),
      analytics: {},
      trackedLiftActivations: {},
      unit: 'lb',
      colors: { accent: '#00f' },
      styles: createStyles({ textMuted: '#888', background: '#fff', text: '#000', inputBackground: '#eee', inputBorder: '#ccc', divider: '#ddd', subtleBg: '#eee', accentText: '#00f' }),
      searchQuery: '',
      onNavigate: jest.fn(),
    });
    expect(element.key).toBe('empty-tracked');
  });
});

describe('AnalyticsScreen section-routing spot checks through the recomposed boundary (card #1051)', () => {
  const layoutHandler = (root, propName) => root.findAll(
    n => typeof n.props?.[propName] === 'function'
  )[0].props[propName];

  const fireLayout = (root, propName, y) => {
    const handler = layoutHandler(root, propName);
    render.act(() => { handler({ nativeEvent: { layout: { y } } }); });
  };

  test('an overview request scrolls to offset 0 immediately (no measurement needed)', () => {
    // Mount with no section request first (the initial mount's own effect-driven
    // scroll fires before the scrollTo spy below exists to observe it — the spy
    // is attached to the real ScrollView instance only after `render.create`
    // resolves), then issue the overview request as a same-instance update, the
    // same way a same-screen tap arrives (#871 review finding).
    const { component, scrollTo } = setup({ hookOverrides: { section: null, sectionNonce: 0 } });
    render.act(() => {
      component.update(
        <AnalyticsScreen multiplier={1.07} section="overview" sectionNonce={1} />
      );
    });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0 }));
  });

  test('a weight-section request scrolls to the weight section once its layout is known', () => {
    const { component, scrollTo } = setup({ hookOverrides: { section: 'weight', sectionNonce: 1 } });
    fireLayout(component.root, 'handleWeightLayout', 420);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 420 }));
  });

  test('Progressive Overload renders as one measurable section with no sticky header', () => {
    const { component } = setup();
    expect(component.root.findByProps({ testID: 'progressive-overload-section' })).toBeTruthy();
    expect(component.root.findAllByProps({ testID: 'sticky-header' })).toHaveLength(0);
    const { ScrollView } = require('react-native');
    expect(component.root.findAllByType(ScrollView)[0].props.stickyHeaderIndices).toBeUndefined();
  });
});
