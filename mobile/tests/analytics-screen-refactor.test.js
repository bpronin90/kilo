// Card #1051: AnalyticsScreen.js was split into presentation modules under
// mobile/screens/analytics/ (AnalyticsOverview, AnalyticsProgression,
// AnalyticsStates, analyticsStyles) purely to bring the screen file itself
// under 600 lines. This suite pins the two things that split could break
// silently:
//
//   1. The public boundary: `AnalyticsScreen` is still the same named export
//      other screens/tests import and mock (grep hits: app-navigation,
//      app-shell-render-isolation, one-k-progress-consistency, weight-screen,
//      app-startup, app-update-banner, app-workout-hydration, app-shell-back).
//   2. The extraction contract: AnalyticsOverview/AnalyticsProgression return
//      FLAT arrays of elements (not a single wrapped component), because
//      AnalyticsScreen spreads them into one array before
//      `React.Children.toArray` — the sticky header and its adjacent
//      overload-list anchor must stay ordinary flat siblings there for
//      `stickyHeaderIndices` (and ScrollView's real sticky-header behavior)
//      to keep resolving to the same slot they always did.
//
// Full behavioral coverage (readiness states, calculations, chart inputs,
// progression/overload presentation, Recovery filtering) lives in
// analytics-screen.test.js, unchanged and untouched by this refactor. This
// file only spot-checks that the boundary and section routing still work
// once presentation moved out.

import React from 'react';
import render from 'react-test-renderer';
import { View } from 'react-native';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { AnalyticsOverview } from '../screens/analytics/AnalyticsOverview';
import { AnalyticsProgression } from '../screens/analytics/AnalyticsProgression';
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

describe('AnalyticsOverview / AnalyticsProgression return flat arrays (card #1051)', () => {
  test('AnalyticsOverview returns a flat array, not a single wrapped element', () => {
    const recoveryStub = React.createElement(View, { key: 'recovery-stub' });
    const items = AnalyticsOverview({
      notesError: null,
      refreshNotes: jest.fn(),
      weightError: null,
      refreshWeightEntries: jest.fn(),
      overviewRows: [],
      overviewLoading: false,
      overviewAsOf: null,
      onSelectSection: jest.fn(),
      handleWeightLayout: jest.fn(),
      weightSummary: {},
      rolling7: [],
      rolling30: [],
      isWeightLoading: false,
      onNavigate: jest.fn(),
      hasRecoverySection: false,
      handleRecoveryLayout: jest.fn(),
      recoverySection: recoveryStub,
    });

    expect(Array.isArray(items)).toBe(true);
    // Load-failure banners (both null here), overview card, weight trends
    // card, recovery slot — five flat top-level siblings, always.
    expect(items).toHaveLength(5);
    expect(items[0]).toBeNull();
    expect(items[1]).toBeNull();
    expect(items[2]?.key).toBe('overview-card');
    expect(items[3]?.key).toBe('weight-trends-card');
    // hasRecoverySection: false → the recovery element passes through
    // unwrapped, exactly as it did inline before the split.
    expect(items[4]).toBe(recoveryStub);
  });

  test('AnalyticsOverview wraps the recovery section in its measurable anchor only when hasRecoverySection is true', () => {
    const recoveryStub = React.createElement(View, { key: 'recovery-stub' });
    const items = AnalyticsOverview({
      notesError: null, refreshNotes: jest.fn(), weightError: null, refreshWeightEntries: jest.fn(),
      overviewRows: [], overviewLoading: false, overviewAsOf: null, onSelectSection: jest.fn(),
      handleWeightLayout: jest.fn(), weightSummary: {}, rolling7: [], rolling30: [], isWeightLoading: false,
      onNavigate: jest.fn(),
      hasRecoverySection: true,
      handleRecoveryLayout: jest.fn(),
      recoverySection: recoveryStub,
    });
    const wrapper = items[4];
    expect(wrapper.props.testID).toBe('recovery-section-anchor');
    expect(wrapper.props.children).toBe(recoveryStub);
  });

  test('AnalyticsProgression returns a flat array whose sticky header and overload-list anchor are adjacent siblings', () => {
    const styles = createStyles({
      textMuted: '#888', background: '#fff', text: '#000', inputBackground: '#eee',
      inputBorder: '#ccc', divider: '#ddd', subtleBg: '#f5f5f5', accentText: '#00f', accent: '#00f',
    });
    const items = AnalyticsProgression({
      isActiveRecovery: false,
      baselineCollapsed: true,
      setBaselineCollapsed: jest.fn(),
      styles,
      colors: { textMuted: '#888', accent: '#00f' },
      sinceDeload: 0,
      sessionCount: 0,
      deloadModeEnabled: false,
      fatigueTrackingEnabled: true,
      checkInHistory: [],
      fatigueExpanded: false,
      setFatigueExpanded: jest.fn(),
      handleCheckInEdit: jest.fn(),
      handleStrengthLayout: jest.fn(),
      isNotesLoading: false,
      isTrackedLoading: false,
      oneK: null,
      oneKCanonical: null,
      oneKChartData: [],
      progressionSuggestionView: { visible: [], muted: [] },
      onMuteProgression: jest.fn(),
      onUnmuteProgression: jest.fn(),
      onDismissProgression: jest.fn(),
      handleProgressiveOverloadHeaderLayout: jest.fn(),
      handleProgressiveOverloadListLayout: jest.fn(),
      groupedSignals: [],
      toggleAllGroups: jest.fn(),
      allGroupsCollapsed: false,
      collapsedGroups: new Set(),
      toggleGroup: jest.fn(),
      searchQuery: '',
      setSearchQuery: jest.fn(),
      analytics: { nonWeightedMetrics: {}, nameDisplayMap: new Map() },
      trackedLiftActivations: {},
      unit: 'lb',
      onNavigate: jest.fn(),
      activeSlot: null,
      handleSlotTap: jest.fn(),
      SLOT_LABELS: { bench: 'Bench', squat: 'Squat', deadlift: 'Deadlift' },
      oneKSelections: {},
      noteExerciseNames: [],
      handleSelectExercise: jest.fn(),
    });

    expect(Array.isArray(items)).toBe(true);
    // Not in active Recovery, so the baseline disclosure toggle is absent (null)
    // and everything else — Fatigue title, gauge, fatigue card, strength
    // section, sticky header, overload-list anchor, big3 card — renders: 8
    // flat top-level siblings, always.
    expect(items).toHaveLength(8);
    const keys = items.map(el => el?.key ?? null);
    expect(keys).toEqual([
      null, 'combined-section-title', 'session-gauge', 'fatigue-card',
      'strength-section', 'sticky-header', 'overload-list', 'big3-mapping',
    ]);

    // The exact adjacency `AnalyticsScreen`'s stickyHeaderIndices depends on:
    // the overload-list anchor is the sticky header's immediate next sibling.
    const stickyIdx = items.findIndex(el => el?.props?.testID === 'sticky-header');
    expect(items[stickyIdx + 1]?.props?.testID).toBe('overload-list-anchor');
  });
});

describe('analyticsStyles.createStyles (card #1051)', () => {
  test('exposes the style keys the sticky header / disclosure / row presentation depend on', () => {
    const styles = createStyles({
      textMuted: '#888', background: '#fff', text: '#000', inputBackground: '#eee',
      inputBorder: '#ccc', divider: '#ddd', subtleBg: '#f5f5f5', accentText: '#00f',
    });
    for (const key of [
      'baselineDisclosureToggle', 'signalStickyHeader', 'searchInput',
      'poContainer', 'groupHeader', 'signalRow', 'trackingCaption',
      'emptyTracked', 'emptyTrackedLink',
    ]) {
      expect(styles[key]).toBeDefined();
    }
  });
});

describe('AnalyticsStates.describePoRowState (card #1051)', () => {
  test('no capability data → no caption', () => {
    expect(describePoRowState({ hasActivation: true, isFirstSpanSession: true, hasCapabilityData: false })).toBeNull();
  });

  test('first session, no explicit activation → "First session"', () => {
    expect(describePoRowState({ hasActivation: false, isFirstSpanSession: true, hasCapabilityData: true }))
      .toBe('First session');
  });

  test('first session, explicit activation → "New tracked span" caption', () => {
    expect(describePoRowState({ hasActivation: true, isFirstSpanSession: true, hasCapabilityData: true }))
      .toBe('New tracked span — Est./Kilo/Best above stay historical');
  });

  test('not first session, no explicit activation → "Inherited tracking" caption', () => {
    expect(describePoRowState({ hasActivation: false, isFirstSpanSession: false, hasCapabilityData: true }))
      .toBe('Inherited tracking — full history');
  });

  test('fully classified row (explicit activation, not first session) → no caption', () => {
    expect(describePoRowState({ hasActivation: true, isFirstSpanSession: false, hasCapabilityData: true })).toBeNull();
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

  test('the sticky header and overload-list anchor still both render, adjacent, through the split', () => {
    const { component } = setup();
    const stickyHeader = component.root.findByProps({ testID: 'sticky-header' });
    const overloadAnchor = component.root.findByProps({ testID: 'overload-list-anchor' });
    expect(stickyHeader).toBeTruthy();
    expect(overloadAnchor).toBeTruthy();
  });
});
