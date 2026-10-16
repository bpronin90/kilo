// Temporary Recovery navigation on the Log screen (#1423): no Recovery tab for
// completed history alone, one compact `Recovery ›` entry when verified inactive,
// a dedicated management screen (Back returns to Routine), and the active
// Recovery | Routine navigation with Deload hidden.

import React from 'react';
import render from 'react-test-renderer';
import { LogScreen } from '../screens/LogScreen';
import * as useEntries from '../hooks/useEntries';
import { Alert } from '../lib/platformAlert';
import { getRecoverySnapshot, compactRecoverySummary } from '../lib/data/recoverySnapshot';
import { withLiveWeek } from '../components/recovery/LogRecoveryHistory';

jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItem: jest.fn(async (k, v) => { store.set(k, v); }),
    removeItem: jest.fn(async (k) => { store.delete(k); }),
    clear: jest.fn(async () => { store.clear(); }),
  };
});
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/LogEmptyState', () => ({ LogEmptyState: () => null }));
jest.mock('../components/SessionCheckInModal', () => ({ SessionCheckInModal: () => null }));
jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ScreenShell: React.forwardRef(({ children, headerRight }, ref) => React.createElement(View, { testID: 'screen-shell' }, headerRight, children)),
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});
jest.mock('../hooks/useEntries');

const recoveryStorage = require('../storage/entries/recoveryStorage');
const journal = require('../storage/entries/recoveryOperationJournal');

const baseline = { id: 'baseline1', title: 'Push Day', raw_text: 'Push\n-Bench\n100 5,5,5', updated_at: '2026-01-01T00:00:00.000Z' };
const completed = (id, at, o = {}) => ({
  id, baseline_note_id: baseline.id, baseline_note_title: 'Push Day', started_at: '2026-01-01T00:00:00.000Z',
  completed_at: at, deleted_at: null, ...o,
});
const done = completed('rb-done', '2026-02-01T00:00:00.000Z');
const weekOf = (blockId, n = 1) => ({ id: `rw-${blockId}-${n}`, block_id: blockId, note_id: 'week-note', week_number: n, completed_at: '2026-01-08T00:00:00.000Z', deleted_at: null });
const active = { id: 'rb-active', baseline_note_id: 'other', baseline_note_title: 'Other', started_at: '2026-03-01T00:00:00.000Z', completed_at: null, deleted_at: null };

let state;
let refresh;
let alertSpy;
const notes = [baseline, { id: 'week-note', title: 'Week 1', raw_text: 'Push\n-Bench\n105 5,5,5', updated_at: '2026-01-08T00:00:00.000Z' }];

function setup(next = {}, { deload = false } = {}) {
  refresh = jest.fn();
  state = { blocks: [done], weeks: [weekOf('rb-done')], ready: true, stale: false, pending: [], ...next };
  useEntries.useWorkoutNotes.mockReturnValue({
    notes, currentId: baseline.id, currentNote: baseline, deloadNotes: [], loading: false, error: null, refresh: jest.fn(),
    selectCurrent: jest.fn(), update: jest.fn(), add: jest.fn(), remove: jest.fn(),
  });
  useEntries.useTrackedLifts.mockReturnValue({ trackedLifts: [], toggle: jest.fn() });
  useEntries.useDeloadNote.mockReturnValue({ note: null, loading: false, save: jest.fn(), clear: jest.fn() });
  useEntries.useDeloadHistory.mockReturnValue({ history: [], completeDeload: jest.fn(), deleteDeload: jest.fn(), deleteDeloadNote: jest.fn(), updateDeload: jest.fn() });
  useEntries.useFeatureToggles.mockReturnValue({ fatigueTrackingEnabled: false, deloadModeEnabled: deload });
  useEntries.useRecoveryBlockState.mockImplementation(() => ({
    activeBlock: state.blocks.find(b => !b.completed_at) || null, blocks: state.blocks, weeks: state.weeks,
    recoveryWeekNumberByNoteId: {}, loading: false, error: null, refresh, ready: state.ready, stale: state.stale,
    pendingRecovery: state.pending, mutationsAllowed: true,
  }));
  useEntries.useStartRecoveryBlock.mockReturnValue({ startBlock: jest.fn() });
  const actual = jest.requireActual('../hooks/entries/recoveryBlockHooks');
  useEntries.isEligibleBaselineNote.mockImplementation(actual.isEligibleBaselineNote);
  useEntries.isEligibleRecoveryWeekNote.mockImplementation(actual.isEligibleRecoveryWeekNote);
}

const Screen = () => (
  <LogScreen
    workoutNoteText={baseline.raw_text} setWorkoutNoteText={jest.fn()} workoutNoteTitle="Push Day" setWorkoutNoteTitle={jest.fn()}
    isCollapsed={false} toggleCollapsed={jest.fn()} onSaveWorkout={jest.fn()} onCheckInPrompt={jest.fn()}
  />
);
function mount() {
  let c;
  render.act(() => { c = render.create(<Screen />); });
  return c;
}
const rerender = (c) => render.act(() => { c.update(<Screen />); });
const byId = (root, id) => root.findAll(n => n.props.testID === id);
const pressable = (root, id) => root.findAll(n => n.props.testID === id && n.props.onPress)[0];
const press = (root, id) => { const n = pressable(root, id); expect(n).toBeTruthy(); render.act(() => { n.props.onPress(); }); };
const textsOf = (root) => root.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
const hasText = (root, t) => textsOf(root).includes(t);
const tab = (root, label) => root.findAll(n => n.props.accessibilityRole === 'tab' && n.props.onPress && textsOf(n).includes(label))[0] || null;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  require('@react-native-async-storage/async-storage').__store.clear();
  journal.__resetRecoveryOperationJournal();
});
afterEach(() => { alertSpy.mockRestore(); jest.restoreAllMocks(); journal.__resetRecoveryOperationJournal(); });

describe('inactive Recovery navigation', () => {
  test('completed history alone shows no Recovery tab, one compact entry, and no Start/Reopen slab', () => {
    setup({}, { deload: true });
    const { root } = mount();
    expect(tab(root, 'Recovery')).toBeNull();
    expect(tab(root, 'Routine')).toBeTruthy();
    expect(tab(root, 'Deload')).toBeTruthy();
    expect(byId(root, 'log-recovery-entry').length).toBeGreaterThan(0);
    expect(hasText(root, 'Start recovery block')).toBe(false);
    expect(textsOf(root).some(t => t.startsWith('Reopen recovery block'))).toBe(false);
  });

  test('the entry summary is the canonical compact summary with the live week count', () => {
    setup();
    const { root } = mount();
    const expected = withLiveWeek(compactRecoverySummary(getRecoverySnapshot({ block: done, weeks: state.weeks, notes })), state.weeks, done);
    expect(byId(root, 'log-recovery-entry-summary').length).toBeGreaterThan(0);
    expect(hasText(root, expected.text)).toBe(true);
    expect(expected.text).toContain('Week 1');
  });

  test('an empty history still has a reachable management entry and invents no result', () => {
    setup({ blocks: [], weeks: [] });
    const { root } = mount();
    expect(byId(root, 'log-recovery-entry-summary')).toHaveLength(0);
    press(root, 'log-recovery-entry');
    expect(byId(root, 'log-recovery-management').length).toBeGreaterThan(0);
    expect(hasText(root, 'Start recovery block')).toBe(true);
    expect(hasText(root, 'No completed recovery blocks yet.')).toBe(true);
    expect(byId(root, 'recovery-history')).toHaveLength(0);
  });

  test('the entry opens management with the completed block selectable; Back returns to Routine', () => {
    setup();
    const { root } = mount();
    press(root, 'log-recovery-entry');
    expect(byId(root, 'log-recovery-management').length).toBeGreaterThan(0);
    expect(byId(root, 'log-recovery-entry')).toHaveLength(0);
    expect(tab(root, 'Routine')).toBeNull(); // a dedicated screen, not another tab
    expect(byId(root, 'recovery-history').length).toBeGreaterThan(0);
    press(root, 'log-recovery-management-back');
    expect(byId(root, 'log-recovery-management')).toHaveLength(0);
    expect(byId(root, 'log-recovery-entry').length).toBeGreaterThan(0);
  });

  test('loading, stale or pending state is never treated as verified inactivity', () => {
    setup({ ready: false });
    expect(byId(mount().root, 'log-recovery-entry')).toHaveLength(0);
    setup({ stale: true });
    expect(byId(mount().root, 'log-recovery-entry')).toHaveLength(0);
    setup({ pending: [{ id: 'op1', error: 'still applying' }] });
    const pending = mount().root;
    expect(byId(pending, 'log-recovery-entry')).toHaveLength(0);
    expect(tab(pending, 'Recovery')).toBeTruthy();
  });

  test('a stale refresh while management is open swaps to the Recovery view with its retry, not a verified state', () => {
    setup();
    const c = mount();
    press(c.root, 'log-recovery-entry');
    state.stale = true;
    rerender(c);
    expect(byId(c.root, 'log-recovery-management')).toHaveLength(0);
    expect(tab(c.root, 'Recovery')).toBeTruthy();
    expect(c.root.findAll(n => n.props.accessibilityLabel === 'Retry recovery').length).toBeGreaterThan(0);
  });

  test('a focused block that vanishes is reported, never replaced by another block', () => {
    const other = completed('rb-other', '2026-01-15T00:00:00.000Z');
    setup({ blocks: [done, other], weeks: [weekOf('rb-done'), weekOf('rb-other')] });
    const c = mount();
    press(c.root, 'log-recovery-entry');
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-other');
    state.blocks = [done];
    rerender(c);
    expect(byId(c.root, 'recovery-manage-unavailable').length).toBeGreaterThan(0);
  });
});

describe('active Recovery navigation', () => {
  test('an active block shows Recovery | Routine, hides Deload and the inactive entry', () => {
    setup({ blocks: [active, done], weeks: [weekOf('rb-done')] }, { deload: true });
    const { root } = mount();
    expect(tab(root, 'Recovery')).toBeTruthy();
    expect(tab(root, 'Routine')).toBeTruthy();
    expect(tab(root, 'Deload')).toBeNull();
    expect(byId(root, 'log-recovery-entry')).toHaveLength(0);
  });

  test('a successful Reopen from management lands in the active workspace; ending restores inactive navigation', async () => {
    setup({}, { deload: true });
    jest.spyOn(recoveryStorage, 'uncompleteRecoveryBlock').mockResolvedValue({ ...done, completed_at: null });
    refresh.mockImplementation(() => { state.blocks = [{ ...done, completed_at: null }]; });
    const c = mount();
    press(c.root, 'log-recovery-entry');
    press(c.root, 'recovery-manage-trigger-rb-done');
    press(c.root, 'recovery-reopen-rb-done');
    const confirm = alertSpy.mock.calls[0][2].find(b => b.text === 'Reopen block');
    await render.act(async () => { await confirm.onPress(); });
    rerender(c);
    expect(byId(c.root, 'log-recovery-management')).toHaveLength(0);
    expect(tab(c.root, 'Recovery')).toBeTruthy();
    expect(tab(c.root, 'Deload')).toBeNull();
    // End: the block completes again.
    state.blocks = [done];
    rerender(c);
    expect(tab(c.root, 'Recovery')).toBeNull();
    expect(tab(c.root, 'Deload')).toBeTruthy();
    expect(byId(c.root, 'log-recovery-entry').length).toBeGreaterThan(0);
  });

  test('a failed Reopen keeps management open and never switches to an active state', async () => {
    setup();
    jest.spyOn(recoveryStorage, 'uncompleteRecoveryBlock').mockRejectedValue(new Error('Could not reopen.'));
    const c = mount();
    press(c.root, 'log-recovery-entry');
    press(c.root, 'recovery-manage-trigger-rb-done');
    press(c.root, 'recovery-reopen-rb-done');
    await render.act(async () => { await alertSpy.mock.calls[0][2].find(b => b.text === 'Reopen block').onPress(); });
    expect(alertSpy).toHaveBeenCalledWith('Could not reopen this recovery block', 'Could not reopen.');
    expect(refresh).not.toHaveBeenCalled();
    expect(byId(c.root, 'log-recovery-management').length).toBeGreaterThan(0);
    expect(tab(c.root, 'Recovery')).toBeNull();
  });
});
