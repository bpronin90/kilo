// Redesign v3 Weight screen structure (#1601): the vertical order of panels,
// the RootHeader context line, the Latest panel's goal-aware tone and its
// Analytics handoff, the stored-start-only goal progress bar, and the compact
// no-goal state. Values come from existing analytics; nothing here is new math.
import React from 'react';
import render from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { WeightScreen } from '../screens/WeightScreen';
import * as useEntries from '../hooks/useEntries';
import * as weightHooks from '../hooks/entries/weightHooks';
import { KUA_PALETTES } from '../theme/colors';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-community/datetimepicker', () => function MockDateTimePicker() { return null; });
jest.mock('../hooks/useEntries');
jest.mock('../hooks/entries/weightHooks');

const KUA = KUA_PALETTES.hardCourt.light;
const MOCK_NOW = new Date(2026, 4, 24, 12, 0, 0);
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

const entry = (id, date, weight) => ({ id, date, logged_at: `${date}T08:00:00Z`, weight_value: weight, note: '' });
const DOWN = [entry('1', '2026-05-24', 190), entry('2', '2026-05-23', 191)];
const UP = [entry('1', '2026-05-24', 191), entry('2', '2026-05-23', 190)];
const ARCHIVED = [{ id: 'ag', target_weight: 185, target_date: '2026-03-01', start_weight: 200, completed_weight: 184, archived_at: '2026-03-02T08:00:00.000Z' }];

function mount({ goal = null, entries = DOWN, archived = [], entriesLoading = false, onNavigate = jest.fn() } = {}) {
  useEntries.useWeightEntries.mockReturnValue({ entries, loading: entriesLoading, error: null, remove: jest.fn(), update: jest.fn(), refresh: jest.fn() });
  useEntries.useWeightGoal.mockReturnValue({ goal, loading: false, error: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn(), refresh: jest.fn() });
  weightHooks.useArchivedWeightGoals.mockReturnValue({ archivedGoals: archived, loading: false, refresh: jest.fn() });
  let component;
  render.act(() => {
    component = render.create(
      <WeightScreen
        weightValue=""
        setWeightValue={jest.fn()}
        weightNote=""
        setWeightNote={jest.fn()}
        onSaveWeight={jest.fn()}
        errorMessage=""
        saving={false}
        onNavigate={onNavigate}
      />
    );
  });
  return component.root;
}

const host = (root, testID) => root.findAll(n => n.props?.testID === testID && typeof n.type === 'string');
const flatText = (node) => {
  const walk = (c) => {
    if (c == null || c === false) return '';
    if (typeof c === 'string' || typeof c === 'number') return String(c);
    if (Array.isArray(c)) return c.map(walk).join('');
    return c.props ? walk(c.props.children) : '';
  };
  return walk(node.props.children);
};
const texts = (root) => root.findAllByType('Text').map(flatText);

describe('Weight redesign v3 structure (#1601)', () => {
  test('panels render in the approved vertical order', () => {
    const root = mount({ goal: { target_weight: 180, target_date: '2026-09-01', start_weight: 200 }, archived: ARCHIVED });
    const order = ['weight-entry-panel', 'weight-latest-panel', 'weight-goal-panel', 'weight-history-panel', 'weight-goal-history'];
    const all = root.findAll(n => typeof n.type === 'string' && order.includes(n.props?.testID));
    const firstSeen = [];
    for (const n of all) if (!firstSeen.includes(n.props.testID)) firstSeen.push(n.props.testID);
    expect(firstSeen).toEqual(order);
  });

  test('the Weight screen draws no trend chart or trend table (Analytics owns it)', () => {
    const root = mount({ goal: { target_weight: 180, target_date: '2026-09-01', start_weight: 200 } });
    const all = texts(root);
    expect(all).not.toContain('Trends');
    expect(all.some(t => t.includes('7-day rolling'))).toBe(false);
    expect(root.findAll(n => /chart/i.test(String(n.props?.testID ?? '')))).toHaveLength(0);
  });

  test('RootHeader names the screen with a verified count and goal context', () => {
    const root = mount({ goal: { target_weight: 180, target_date: '2026-09-01', start_weight: 200 } });
    const header = host(root, 'weight-root-header')[0];
    expect(header).toBeTruthy();
    const headerTexts = header.findAllByType('Text').map(flatText);
    expect(headerTexts).toContain('Weight');
    expect(headerTexts).toContain('2 weigh-ins · Cutting → 180 lb');
  });

  test('the header context is withheld until the weigh-in read is verified', () => {
    const root = mount({ entries: [], entriesLoading: true });
    const header = host(root, 'weight-root-header')[0];
    const headerTexts = header.findAllByType('Text').map(flatText);
    expect(headerTexts.some(t => t.includes('weigh-in'))).toBe(false);
  });

  test('Latest shows the newest weigh-in as the hero with its date and the 7/30-day averages', () => {
    const root = mount();
    const latest = host(root, 'weight-latest-panel')[0];
    const t = latest.findAllByType('Text').map(flatText);
    expect(t).toContain('Latest · 05-24-2026');
    expect(t).toContain('190');
    expect(t).toContain('-1.0');
    expect(t).toContain('vs previous');
    expect(host(root, 'weight-avg-7')).toHaveLength(1);
    expect(host(root, 'weight-avg-30')).toHaveLength(1);
  });

  test('the Latest change is toned by goal direction: toward a loss goal is success, away is error', () => {
    const cut = { target_weight: 180, target_date: '2026-09-01', start_weight: 200 };
    const changeColor = (root) => {
      const node = host(root, 'weight-latest-change')[0].findAllByType('Text')[0];
      return StyleSheet.flatten(node.props.style).color;
    };
    expect(changeColor(mount({ goal: cut, entries: DOWN }))).toBe(KUA.success);
    expect(changeColor(mount({ goal: cut, entries: UP }))).toBe(KUA.errorText);
    const bulk = { target_weight: 200, target_date: '2026-09-01', start_weight: 180 };
    expect(changeColor(mount({ goal: bulk, entries: UP }))).toBe(KUA.success);
  });

  test('"Full trend in Analytics" deep-links to the Analytics weight section', () => {
    const onNavigate = jest.fn();
    const root = mount({ onNavigate });
    const link = root.findAll(n => n.props?.testID === 'weight-see-full-trends' && n.props?.accessibilityRole === 'button')[0];
    render.act(() => { link.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Analytics', 'weight');
  });
});

describe('Weight goal panel (#1601)', () => {
  test('a stored start_weight draws the progress bar from start to target', () => {
    // 200 -> 180, current 190: half way.
    const root = mount({ goal: { target_weight: 180, target_date: '2026-09-01', start_weight: 200 } });
    const progress = host(root, 'weight-goal-progress');
    expect(progress).toHaveLength(1);
    const bar = root.findAll(n => n.props?.accessibilityRole === 'progressbar' && typeof n.type === 'string'
      && n.props.accessibilityValue)[0];
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
    const t = progress[0].findAllByType('Text').map(flatText);
    expect(t).toEqual(['Start 200', '50%', 'Target 180']);
  });

  test('without a stored start_weight no progress bar is drawn (never inferred)', () => {
    const root = mount({ goal: { target_weight: 180, target_date: '2026-09-01' } });
    expect(host(root, 'weight-goal-progress')).toHaveLength(0);
    // The rest of the active goal still renders.
    const t = texts(root);
    expect(t).toContain('Target pace');
    expect(t.some(x => x.includes('lb to go'))).toBe(true);
  });

  test('an active goal shows mode, to-go, weeks left, the Target / Target date split and Edit + Clear', () => {
    const root = mount({ goal: { target_weight: 180, target_date: '2026-09-01', start_weight: 200 } });
    const panel = host(root, 'weight-goal-panel')[0];
    const t = panel.findAllByType('Text').map(flatText);
    expect(t).toContain('Goal · Cutting');
    expect(t.some(x => /^10\.0 lb to go · \d+ weeks left$/.test(x))).toBe(true);
    expect(t).toContain('Target');
    expect(t).toContain('180 lb');
    expect(t).toContain('Target date');
    expect(t).toContain('09-01-2026');
    const actions = panel.findAll(n => typeof n.props?.onPress === 'function' && n.props.accessibilityRole === 'button'
      && typeof n.type !== 'string').map(n => n.props.accessibilityLabel);
    expect(actions).toEqual(expect.arrayContaining(['Edit', 'Clear']));
    expect(actions).not.toContain('Archive');
  });

  test('no goal shows only a compact "Set a goal" with no progress, pace or deficit', () => {
    const root = mount({ goal: null });
    const panel = host(root, 'weight-goal-panel')[0];
    const t = panel.findAllByType('Text').map(flatText);
    expect(t).toEqual(expect.arrayContaining(['Goal', 'No goal set.', 'Set a goal']));
    expect(t.some(x => /pace|Suggested|to go|cal\/day/i.test(x))).toBe(false);
    expect(host(root, 'weight-goal-progress')).toHaveLength(0);
  });

  test('a cancelled no-goal setup draft stops toning Latest and is not restored on reopen', () => {
    const root = mount({ goal: null, entries: DOWN });
    const changeColor = () => StyleSheet.flatten(host(root, 'weight-latest-change')[0].findAllByType('Text')[0].props.style).color;
    const press = (label) => {
      const btn = root.find(n => n.props && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
      render.act(() => { btn.props.onPress(); });
    };
    const targetField = () => root.find(n => n.props && n.props.label === 'Target (lb)' && typeof n.props.onChangeText === 'function');

    const before = changeColor();
    expect(before).toBe(KUA.success);

    press('Set a goal');
    render.act(() => { targetField().props.onChangeText('200'); });
    // While setup is open the draft drives the tone live (a gain draft turns a loss red).
    expect(changeColor()).toBe(KUA.errorText);

    press('Cancel');
    expect(texts(host(root, 'weight-goal-panel')[0])).toEqual(expect.arrayContaining(['No goal set.']));
    expect(changeColor()).toBe(before);

    press('Set a goal');
    expect(targetField().props.value).toBe('');
    expect(changeColor()).toBe(before);
  });
});
