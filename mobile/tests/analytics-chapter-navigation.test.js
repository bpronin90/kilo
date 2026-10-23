// Redesign v3 Analytics chapters (#1602): the sticky chapter index, chapter
// headers, tap-to-scroll (reduce-motion aware), scroll-spy, the active-Recovery
// chapter set, and deep links that land inside the paused baseline body.

import React from 'react';
import render from 'react-test-renderer';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import * as useEntries from '../hooks/useEntries';
import { ACTIVE_TRAINING_STATUS } from '../lib/data/activeTrainingContext';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('../components/LineChart', () => ({ LineChart: () => null }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('../lib/useReducedMotion', () => ({ useReducedMotion: jest.fn(() => false) }));
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

const { useReducedMotion } = require('../lib/useReducedMotion');
const actualContext = jest.requireActual('../hooks/useEntries').useActiveTrainingContext;

const ACTIVE_BLOCK = {
  id: 'rb-open', baseline_note_id: 'note-baseline', baseline_note_title: 'Push Pull Legs',
  baseline: { exercises: [] }, started_at: '2026-05-01T00:00:00Z', completed_at: null,
  saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', deleted_at: null,
};

let trees = [];
afterEach(() => {
  render.act(() => { trees.forEach(t => t.unmount()); });
  trees = [];
  useReducedMotion.mockReturnValue(false);
  useEntries.useActiveTrainingContext.mockImplementation(actualContext);
  jest.restoreAllMocks();
});

function mount({ section = null, nonce = 0, activeRecovery = false, onNavigate } = {}) {
  useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: true, deloadModeEnabled: true });
  useEntries.useWeightEntries.mockReturnValue({ entries: [], loading: false, error: null });
  useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: {}, activations: {}, loading: false });
  useEntries.useWorkoutNotes.mockReturnValue({ notes: [], currentNote: null, loading: false, update: jest.fn() });
  useEntries.useDeloadHistory.mockReturnValue({ history: [], loading: false });
  useEntries.useRecoveryBlockState.mockReturnValue({ blocks: activeRecovery ? [ACTIVE_BLOCK] : [], weeks: [], loading: false, ready: true });
  if (activeRecovery) {
    useEntries.useActiveTrainingContext.mockReturnValue({
      status: ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK, activeNoteId: null, baselineNoteId: 'note-baseline',
      baselinePaused: true, recoveryWeekNumber: 1, nextAction: null, activeBlock: { id: 'rb-open' }, stale: false, pending: false,
    });
  }
  let tree;
  render.act(() => {
    tree = render.create(<AnalyticsScreen multiplier={1.07} section={section} sectionNonce={nonce} onNavigate={onNavigate} />);
  });
  trees.push(tree);
  const { ScrollView } = require('react-native');
  const scroll = tree.root.findAllByType(ScrollView)[0];
  const scrollTo = jest.fn();
  scroll.instance.scrollTo = scrollTo;
  return { tree, scrollTo, scroll };
}

const host = (root, testID) => root.findAll(n => n.props?.testID === testID && typeof n.type !== 'string')[0];
const indexItem = (root, id) => root.findAll(n => n.props?.testID === `analytics-chapter-index-${id}` && n.props.accessibilityRole === 'tab')[0];
const texts = (node) => node.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
const layout = (node, y) => render.act(() => { node.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 343, height: 40 } } }); });
const fireChapters = (root, offsets) => Object.entries(offsets).forEach(([id, y]) => layout(host(root, `analytics-chapter-${id}`), y));
const scrollEvent = (scroll, y, { height = 700, content = 5000 } = {}) => render.act(() => {
  scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y }, layoutMeasurement: { width: 390, height }, contentSize: { width: 390, height: content } } });
});
const selectedId = (root, ids) => ids.find(id => indexItem(root, id).props.accessibilityState.selected);

const NORMAL = ['progress', 'training', 'bodyweight', 'recovery'];
const OFFSETS = { progress: 16, training: 1600, bodyweight: 2600, recovery: 3400 };

describe('normal training chapters', () => {
  test('four index items in order, the first selected with aria-current', () => {
    const { tree } = mount();
    const index = host(tree.root, 'analytics-chapter-index');
    expect(index.props.accessibilityRole).toBe('tablist');
    expect(texts(index)).toEqual(['PROGRESS', 'TRAINING', 'BODYWEIGHT', 'RECOVERY']);
    expect(indexItem(tree.root, 'progress').props.accessibilityState).toEqual({ selected: true });
    expect(indexItem(tree.root, 'progress').props['aria-current']).toBe('true');
    expect(indexItem(tree.root, 'training').props['aria-current']).toBeUndefined();
  });

  test('numbered chapter headers in reading order, with no Active/Paused tags', () => {
    const { tree } = mount();
    const headers = NORMAL.map(id => texts(host(tree.root, `analytics-chapter-${id}`)));
    expect(headers).toEqual([['01', 'Progress'], ['02', 'Training'], ['03', 'Bodyweight'], ['04', 'Recovery']]);
  });

  test('tapping an index item scrolls (animated) to the measured chapter header and selects it', () => {
    const { tree, scrollTo } = mount();
    fireChapters(tree.root, OFFSETS);
    render.act(() => { indexItem(tree.root, 'bodyweight').props.onPress(); });
    expect(scrollTo).toHaveBeenCalledWith({ y: 2600, animated: true });
    expect(selectedId(tree.root, NORMAL)).toBe('bodyweight');
  });

  test('reduce motion jumps without animation', () => {
    useReducedMotion.mockReturnValue(true);
    const { tree, scrollTo } = mount();
    fireChapters(tree.root, OFFSETS);
    render.act(() => { indexItem(tree.root, 'training').props.onPress(); });
    expect(scrollTo).toHaveBeenCalledWith({ y: 1600, animated: false });
  });

  test('scroll-spy follows the reader, and the end of the scroll selects the last chapter', () => {
    const { tree, scroll } = mount();
    fireChapters(tree.root, OFFSETS);
    scrollEvent(scroll, 900);
    expect(selectedId(tree.root, NORMAL)).toBe('progress');
    scrollEvent(scroll, 1590);
    expect(selectedId(tree.root, NORMAL)).toBe('training');
    expect(indexItem(tree.root, 'training').props['aria-current']).toBe('true');
    scrollEvent(scroll, 2700);
    expect(selectedId(tree.root, NORMAL)).toBe('bodyweight');
    scrollEvent(scroll, 4300, { height: 700, content: 5000 });
    expect(selectedId(tree.root, NORMAL)).toBe('recovery');
  });

  test('an animated tap holds the index while the scroll passes through other chapters', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { tree, scroll } = mount();
    fireChapters(tree.root, OFFSETS);
    render.act(() => { indexItem(tree.root, 'recovery').props.onPress(); });
    scrollEvent(scroll, 1700);
    expect(selectedId(tree.root, NORMAL)).toBe('recovery');
    now.mockReturnValue(5000);
    scrollEvent(scroll, 1700);
    expect(selectedId(tree.root, NORMAL)).toBe('training');
  });

  test('an index tap before a chapter is measured selects it but does not guess a position', () => {
    const { tree, scrollTo } = mount();
    render.act(() => { indexItem(tree.root, 'recovery').props.onPress(); });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(selectedId(tree.root, NORMAL)).toBe('recovery');
  });
});

describe('active Recovery chapters', () => {
  const ACTIVE = ['recovery', 'bodyweight', 'baseline'];

  test('index is RECOVERY / BODYWEIGHT / PAUSED; headers carry the Active and Paused tags', () => {
    const { tree } = mount({ activeRecovery: true });
    expect(texts(host(tree.root, 'analytics-chapter-index'))).toEqual(['RECOVERY', 'BODYWEIGHT', 'PAUSED']);
    expect(texts(host(tree.root, 'analytics-chapter-recovery'))).toEqual(['01', 'Recovery', 'ACTIVE']);
    expect(texts(host(tree.root, 'analytics-chapter-bodyweight'))).toEqual(['02', 'Bodyweight']);
    expect(texts(host(tree.root, 'analytics-chapter-baseline'))).toEqual(['03', 'Baseline training', 'PAUSED']);
    expect(selectedId(tree.root, ACTIVE)).toBe('recovery');
  });

  test('the paused toggle starts collapsed; expanded content renders below it in the dashed body', () => {
    const { tree } = mount({ activeRecovery: true });
    expect(tree.root.findAllByProps({ testID: 'baseline-paused-body' })).toHaveLength(0);
    const toggle = tree.root.findAll(n => n.props?.testID === 'baseline-disclosure-toggle' && typeof n.props.onPress === 'function')[0];
    expect(texts(toggle)).toEqual(['Progress and Training · paused during Recovery']);
    render.act(() => { toggle.props.onPress(); });
    const body = host(tree.root, 'baseline-paused-body');
    expect(body.findAllByProps({ testID: 'progressive-overload-section' }).length).toBeGreaterThan(0);
    expect(body.findAllByProps({ testID: 'training-breakdown-section' }).length).toBeGreaterThan(0);
    expect(body.findAllByProps({ testID: 'routine-health-section' }).length).toBeGreaterThan(0);
    expect(texts(toggle)).toEqual(['Hide paused Progress and Training']);
  });

  test('a deep link into the collapsed baseline expands it, then lands at body + section offset', () => {
    const { tree, scrollTo } = mount({ activeRecovery: true, section: 'progressive-overload', nonce: 1 });
    const body = host(tree.root, 'baseline-paused-body');
    expect(body).toBeTruthy();
    // The section reports its offset inside the body; nothing is scrolled until
    // the body's own position is known too.
    layout(host(tree.root, 'progressive-overload-section'), 900);
    expect(scrollTo).not.toHaveBeenCalled();
    layout(body, 1500);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 2400 }));
  });

  test('Manage recovery in Log and the history entry hand off to Log with typed intents', () => {
    const onNavigate = jest.fn();
    const { tree } = mount({ activeRecovery: true, onNavigate });
    const button = (id) => tree.root.findAll(n => n.props?.testID === id && n.props.accessibilityRole === 'button')[0];
    render.act(() => { button('analytics-recovery-manage').props.onPress(); });
    expect(onNavigate).toHaveBeenLastCalledWith('Log', { kind: 'recovery-manage', blockId: 'rb-open' });
    render.act(() => { button('analytics-recovery-history-entry').props.onPress(); });
    expect(onNavigate).toHaveBeenLastCalledWith('Log', { kind: 'recovery-note', noteId: null });
  });

  test('normal training offers no Manage row (there is no active block to manage)', () => {
    const { tree } = mount();
    expect(tree.root.findAllByProps({ testID: 'analytics-recovery-manage' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'analytics-recovery-history-entry' }).length).toBeGreaterThan(0);
  });
});
