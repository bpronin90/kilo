// Redesign v3 Home (#1605): presentation contract for the new Home pieces —
// the root top bar, the Exercise Progress ring, the 1K panel and the body
// weight card's two handoffs. Values come in as props; nothing here derives data.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../theme/ThemeContext';
import { DarkColors, KUA_PALETTES } from '../theme/colors';
import { HomeTopBar, syncIconName } from '../screens/home/HomeHeader';
import { HomeProgressLegend, HomeProgressRing, progressSummaryText } from '../screens/home/HomeProgressRing';
import { HomeOneKPanel, oneKRemainingText } from '../screens/home/HomeOneKPanel';
import { HomeWeightCard } from '../screens/home/HomeWeightCard';

const mockCloudSync = { current: null };
jest.mock('../hooks/useEntries', () => ({
  useCloudSyncSummary: () => mockCloudSync.current,
}));

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const pass = (name) => ({ children, testID }) => React.createElement(View, { testID, 'data-svg': name }, children);
  return {
    __esModule: true,
    default: pass('Svg'),
    Circle: pass('Circle'),
    Path: pass('Path'),
    Line: pass('Line'),
    Rect: pass('Rect'),
    Defs: pass('Defs'),
    Pattern: pass('Pattern'),
  };
});

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockMaterialIcons({ name }) {
    return React.createElement(View, { 'data-icon': name });
  };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
const KUA = KUA_PALETTES.hardCourt.dark;
const hosts = (tree, testID) => tree.root.findAll(n => typeof n.type === 'string' && n.props.testID === testID);
const host = (tree, testID) => hosts(tree, testID)[0];
const pressable = (tree, testID) => tree.root.findAll(n => typeof n.type !== 'string' && n.props.testID === testID && typeof n.props.onPress === 'function')[0];
const textContent = (node) => node.findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).filter(c => typeof c === 'string' || typeof c === 'number').join('')).join('');

function mount(element) {
  let tree;
  act(() => {
    tree = renderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeContext.Provider value={{ colors: DarkColors, mode: 'dark', preference: 'dark', setPreference: () => {}, kuaPalette: KUA }}>
          {element}
        </ThemeContext.Provider>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

afterEach(() => { mockCloudSync.current = null; });

describe('HomeTopBar', () => {
  test('draws the wordmark and a sync icon that opens Cloud Sync with its status as the label', () => {
    const openCloudSync = jest.fn();
    mockCloudSync.current = { summary: { statusLabel: 'Synced', hasLastSuccess: true }, openCloudSync, retrySync: jest.fn() };
    const tree = mount(<HomeTopBar />);
    expect(host(tree, 'home-top-bar')).toBeTruthy();
    const button = host(tree, 'home-sync-status');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Cloud Sync: Synced');
    act(() => { pressable(tree, 'home-sync-status').props.onPress(); });
    expect(openCloudSync).toHaveBeenCalledTimes(1);
  });

  test('outside the shell (no sync summary) the icon is not drawn', () => {
    const tree = mount(<HomeTopBar />);
    expect(hosts(tree, 'home-sync-status')).toHaveLength(0);
  });

  test('the icon glyph follows the existing summary state', () => {
    expect(syncIconName(null)).toBe('cloud-queue');
    expect(syncIconName({ isRunning: true, hasFailed: true })).toBe('cloud-sync');
    expect(syncIconName({ hasFailed: true })).toBe('cloud-off');
    expect(syncIconName({ hasDirty: true, hasLastSuccess: true })).toBe('cloud-upload');
    expect(syncIconName({ hasLastSuccess: true })).toBe('cloud-done');
  });
});

describe('Exercise Progress ring', () => {
  test('the ring is decorative; the legend carries every count as text', () => {
    const counts = { progressing: 5, steady: 3, regressing: 1 };
    const tree = mount(<><HomeProgressRing {...counts} classified={9} /><HomeProgressLegend {...counts} /></>);
    const ring = host(tree, 'home-progress-ring');
    expect(ring.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(textContent(host(tree, 'home-progress-ring-total'))).toBe('9');
    expect(textContent(host(tree, 'home-progress-progressing'))).toMatch(/^5\s*Progressing$/);
    expect(textContent(host(tree, 'home-progress-steady'))).toMatch(/^3\s*Steady$/);
    expect(textContent(host(tree, 'home-progress-regressing'))).toMatch(/^1\s*Regressing$/);
    expect(progressSummaryText(counts)).toBe('5 progressing, 3 steady, 1 regressing');
  });
});

describe('1K panel', () => {
  const lifts = [
    { key: 'squat', label: 'Squat', value: 315 },
    { key: 'bench', label: 'Bench', value: 225 },
    { key: 'deadlift', label: 'Deadlift', value: 405 },
  ];

  test('remaining text counts down to the target and reads reached at or past it', () => {
    expect(oneKRemainingText(945, 1000, 'lb')).toBe('55 lb to 1,000');
    expect(oneKRemainingText(1000, 1000, 'lb')).toBe('1,000 lb reached');
    expect(oneKRemainingText(null, 1000, 'lb')).toBeNull();
  });

  test('one stacked bar holds the three existing lift values, then the remainder; title opens Strength', () => {
    const onTitlePress = jest.fn();
    const tree = mount(<HomeOneKPanel total={945} target={1000} unit="lb" lifts={lifts} onTitlePress={onTitlePress} />);
    expect(textContent(host(tree, 'home-one-k-total'))).toBe('945 lb');
    const fill = host(tree, 'home-one-k-progress-fill');
    expect(StyleSheet.flatten(fill.props.style).flex).toBe(945);
    for (const l of lifts) {
      expect(StyleSheet.flatten(host(tree, `home-one-k-bar-${l.key}`).props.style).flex).toBe(l.value);
      expect(textContent(host(tree, `home-one-k-lift-${l.key}-value`))).toBe(String(l.value));
    }
    expect(StyleSheet.flatten(host(tree, 'home-one-k-progress-rest').props.style).flex).toBe(55);
    expect(host(tree, 'home-one-k-progress-track').props.accessibilityLabel).toBe('Squat 315, Bench 225, Deadlift 405. 55 lb to 1,000.');
    act(() => { pressable(tree, 'home-one-k-link').props.onPress(); });
    expect(onTitlePress).toHaveBeenCalledTimes(1);
  });

  test('without a total the setup copy shows and no bar is drawn', () => {
    const tree = mount(<HomeOneKPanel total={null} target={1000} unit="lb" lifts={[lifts[1]]} emptyText="Log all three lifts." />);
    expect(hosts(tree, 'home-one-k-progress-track')).toHaveLength(0);
    expect(textContent(host(tree, 'home-one-k-setup'))).toBe('Log all three lifts.');
  });
});

describe('Body weight card handoffs', () => {
  const series = [
    { label: '05-01-2026', value: 182 },
    { label: '05-03-2026', value: 181.4 },
    { label: '05-05-2026', value: 180.8 },
  ];
  const data = (goalInfo) => ({ latestWeight: 180.8, weightSeries: series, goalInfo });
  const activeGoal = { direction: 'loss', isOverdue: false, weeks_remaining: 8, warnings: [] };

  test('the title opens Weight and the body opens Analytics weight, one navigation per press', () => {
    const onNavigate = jest.fn();
    const tree = mount(<HomeWeightCard dashboardData={data(activeGoal)} weightGoal={{ target_weight: 175 }} onNavigate={onNavigate} unit="lb" />);
    act(() => { pressable(tree, 'home-weight-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenLastCalledWith('Weight');
    act(() => { pressable(tree, 'home-weight-analytics-link').props.onPress(); });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenLastCalledWith('Analytics', 'weight');
    // The sparkline sits inside the body link, not inside the title link.
    const body = tree.root.findAll(n => n.props.testID === 'home-weight-analytics-link' && typeof n.type === 'string')[0];
    expect(body.findAll(n => n.props.testID === 'home-weight-trend')).not.toHaveLength(0);
    expect(body.props.accessibilityLabel).toMatch(/Latest 180\.8 lb/);
  });

  test('the goal line and goal context show only for an active goal', () => {
    const active = mount(<HomeWeightCard dashboardData={data(activeGoal)} weightGoal={{ target_weight: 175 }} onNavigate={jest.fn()} unit="lb" />);
    expect(hosts(active, 'home-weight-goal-line')).toHaveLength(1);
    expect(textContent(host(active, 'home-goal'))).toMatch(/Cutting.*8 weeks left/);

    const none = mount(<HomeWeightCard dashboardData={data(null)} weightGoal={null} onNavigate={jest.fn()} unit="lb" />);
    expect(hosts(none, 'home-weight-goal-line')).toHaveLength(0);
    expect(hosts(none, 'home-goal')).toHaveLength(0);

    const ended = mount(<HomeWeightCard dashboardData={data({ ...activeGoal, isOverdue: true })} weightGoal={{ target_weight: 175 }} onNavigate={jest.fn()} unit="lb" />);
    expect(hosts(ended, 'home-weight-goal-line')).toHaveLength(0);
    expect(textContent(host(ended, 'home-goal'))).toMatch(/Goal\u00A0ended/);
    expect(hosts(ended, 'home-goal-attention-action').length).toBeGreaterThan(0);
  });

  test('a single weigh-in draws no sparkline and no weigh-in keeps a plain body', () => {
    const one = mount(<HomeWeightCard dashboardData={{ latestWeight: 180, weightSeries: [series[0]], goalInfo: null }} weightGoal={null} onNavigate={jest.fn()} unit="lb" />);
    expect(hosts(one, 'home-weight-trend')).toHaveLength(0);
    const empty = mount(<HomeWeightCard dashboardData={{ latestWeight: null, weightSeries: [], goalInfo: null }} weightGoal={null} onNavigate={jest.fn()} unit="lb" />);
    expect(hosts(empty, 'home-weight-analytics-link')).toHaveLength(0);
  });
});
