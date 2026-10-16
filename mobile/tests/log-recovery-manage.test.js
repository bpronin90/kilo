// Log's single Recovery maintenance surface (#1315): every control that used to
// live in Analytics' Manage block, for the active block AND completed blocks, the
// Recovery History selector, per-block state isolation, and the typed
// `recovery-manage` navigation intent.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { LogRecoverySection } from '../components/LogRecoverySection';
import { useLogRecoveryManage, MANAGE_TARGET_UNAVAILABLE } from '../screens/log/useLogRecoveryManage';
import { normalizeNavTarget } from '../app/navigation';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import * as hooks from '../hooks/entries/recoveryBlockHooks';
import { formatDate } from '../lib/format';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const BASE = '-Bench\n- 100 5\n-Squat\n- 100 5';
const V1 = { version: 1, exercises: [{ key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, volume: 300, sets_completed: 3 }] };
const block = (o = {}) => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'Push Pull Legs', baseline: captureRecoveryBaselineFromText(BASE),
  started_at: '2026-05-01T00:00:00Z', completed_at: null, saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', deleted_at: null, ...o,
});
const done = (id, at, o = {}) => block({ id, completed_at: at, baseline_note_title: id === 'rb-new' ? 'New' : 'Old', ...o });
const NOTES = [{ id: 'nb', title: 'Push Pull Legs', raw_text: BASE }];

let mockLifecycle;
beforeEach(() => {
  mockLifecycle = {
    setIncludeInNormalAnalytics: jest.fn().mockResolvedValue({ ok: true }),
    setBlockReason: jest.fn().mockResolvedValue({ ok: true }),
    rebuildBaseline: jest.fn().mockResolvedValue({ ok: true }),
  };
  jest.spyOn(hooks, 'useRecoveryBlockLifecycle').mockReturnValue(mockLifecycle);
});
afterEach(() => { jest.restoreAllMocks(); });

const host = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
const byLabel = (root, l) => root.findAll(n => n.props && n.props.accessibilityLabel === l)[0];
const texts = (root) => root.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
const press = (root, id) => act(() => { root.findAll(n => typeof n.type !== 'string' && n.props.testID === id && n.props.onPress)[0].props.onPress(); });
const tap = (root, label) => act(() => { byLabel(root, label).props.onPress(); });

// Mirrors LogScreen: the focus hook feeds the section's `manage` prop.
function Harness({ blocks, onReopen = () => {}, nav = {}, hide = false, onShow, ...rest }) {
  const hist = useLogRecoveryManage({
    blocks, ready: rest.stateReady !== false, readError: rest.stateError || null,
    navManageBlockId: nav.id || null, navKey: nav.key || 0, onShow,
  });
  if (hide) return null;
  return (
    <LogRecoverySection
      blocks={blocks} weeks={[]} notes={NOTES} {...rest}
      manage={{ ...hist.manage, completedBlocks: hist.completedBlocks, notesError: null, onReopenBlock: onReopen }}
    />
  );
}
function mount(props) {
  let c;
  act(() => { c = render.create(<Harness {...props} />); });
  return c;
}
const cards = (root) => root.findAll(n => typeof n.type === 'string' && /^recovery-manage-card-/.test(n.props.testID || ''));
const shown = (root) => cards(root).filter(n => !(n.props.style && StyleSheet.flatten(n.props.style).display === 'none')).map(n => n.props.testID);

describe('Recovery History reads before Manage (#1329)', () => {
  test('the selector renders above the focused Manage card, so a pick reads top-down', () => {
    const c = mount({ blocks: [done('rb-old', '2026-05-01T00:00:00Z'), done('rb-new', '2026-06-01T00:00:00Z')] });
    const order = c.root.findAll(n => typeof n.type === 'string'
      && (n.props.testID === 'recovery-history' || /^recovery-manage-card-/.test(n.props.testID || '')))
      .map(n => n.props.testID);
    expect(order[0]).toBe('recovery-history');
    expect(order.slice(1)).toContain('recovery-manage-card-rb-new');
  });
});

describe('completed rows show the canonical total (#1378)', () => {
  test('the summary renders through Log, and a pick still focuses Manage without a write', () => {
    const weeks = [{ id: 'w-old-2', block_id: 'rb-old', note_id: 'n2', week_number: 2, deleted_at: null }];
    const notes = [...NOTES, { id: 'n2', title: 'W2', raw_text: '-Bench\n- 80 5\n-Squat\n- 80 5' }];
    const c = mount({ blocks: [done('rb-old', '2026-05-01T00:00:00Z'), done('rb-new', '2026-06-01T00:00:00Z')], weeks, notes });
    press(c.root, 'recovery-history-header');
    expect(texts(c.root)).toEqual(expect.arrayContaining(['80% total recovery · Week 2', 'Baseline captured. No week logged yet.']));
    press(c.root, 'recovery-history-row-rb-old');
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    for (const fn of Object.values(mockLifecycle)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('the selector is labelled Recovery Blocks, not History (#1331)', () => {
  test('with an active block the caption counts both kinds', () => {
    const c = mount({ blocks: [block(), done('rb-old', '2026-05-01T00:00:00Z'), done('rb-new', '2026-06-01T00:00:00Z')] });
    expect(texts(c.root)).toEqual(expect.arrayContaining(['Recovery Blocks', '1 active · 2 completed']));
    expect(texts(c.root)).not.toContain('Recovery History');
    expect(byLabel(c.root, 'Expand recovery blocks')).toBeDefined();
    press(c.root, 'recovery-history-header');
    expect(byLabel(c.root, 'Collapse recovery blocks')).toBeDefined();
  });

  test('with no active block the caption counts completed blocks only', () => {
    const one = mount({ blocks: [done('rb-new', '2026-06-01T00:00:00Z')] });
    expect(texts(one.root)).toContain('1 completed block');
    const two = mount({ blocks: [done('rb-old', '2026-05-01T00:00:00Z'), done('rb-new', '2026-06-01T00:00:00Z')] });
    expect(texts(two.root)).toContain('2 completed blocks');
  });
});

describe('completed blocks expose the maintenance controls under their gates', () => {
  test('reason, inclusion and the rest are on a completed block; unlink and end never are', () => {
    const c = mount({ blocks: [done('rb-new', '2026-06-01T00:00:00Z', { reason: 'sprain', baseline: V1 })] });
    press(c.root, 'recovery-manage-trigger-rb-new');
    expect(byLabel(c.root, 'Edit reason for this recovery block: sprain')).toBeDefined();
    expect(host(c.root, 'recovery-rebuild-baseline').length).toBeGreaterThan(0);
    expect(host(c.root, 'recovery-manage-groups')).toHaveLength(1);
    expect(byLabel(c.root, 'Counting in normal analytics: Off')).toBeDefined();
    expect(byLabel(c.root, 'End recovery block')).toBeUndefined();
    expect(texts(c.root).some(t => t.startsWith('Unlink Week'))).toBe(false);
  });

  test('inclusion writes once with the block id and shows a rejected write on that block', async () => {
    mockLifecycle.setIncludeInNormalAnalytics.mockResolvedValueOnce({ ok: false, error: 'offline' });
    const c = mount({ blocks: [done('rb-new', '2026-06-01T00:00:00Z')] });
    press(c.root, 'recovery-manage-trigger-rb-new');
    await act(async () => { await byLabel(c.root, 'Counting in normal analytics: Off').props.onPress(); });
    expect(mockLifecycle.setIncludeInNormalAnalytics).toHaveBeenCalledWith({ blockId: 'rb-new', include: true });
    expect(texts(c.root)).toContain('offline');
  });

  test('Reopen: only the newest completed block, only with no active block, via the existing confirm', () => {
    const newest = done('rb-new', '2026-06-01T00:00:00Z');
    const older = done('rb-old', '2026-05-01T00:00:00Z');
    const onReopen = jest.fn();
    const c = mount({ blocks: [older, newest], onReopen });
    press(c.root, 'recovery-manage-trigger-rb-new');
    expect(host(c.root, 'recovery-reopen-rb-new')).toHaveLength(1);
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    press(c.root, 'recovery-manage-trigger-rb-old');
    expect(host(c.root, 'recovery-reopen-rb-old')).toHaveLength(0);
    // Older blocks keep their other eligible maintenance without reopening.
    expect(host(c.root, 'recovery-manage-groups').length).toBeGreaterThan(0);
    press(c.root, 'recovery-history-row-rb-new');
    press(c.root, 'recovery-reopen-rb-new');
    expect(onReopen).toHaveBeenCalledTimes(1);

    const withActive = mount({ blocks: [block(), newest], onReopen });
    press(withActive.root, 'recovery-history-header');
    press(withActive.root, 'recovery-history-row-rb-new');
    press(withActive.root, 'recovery-manage-trigger-rb-new');
    expect(host(withActive.root, 'recovery-reopen-rb-new')).toHaveLength(0);
  });

  test('the active block keeps Unlink and End', () => {
    const c = mount({ blocks: [block()], weeks: [] });
    press(c.root, 'recovery-manage-trigger-rb1');
    expect(byLabel(c.root, 'End recovery block')).toBeDefined();
  });

  test.each([
    ['mutations not allowed', { mutationsAllowed: false }],
    ['pending recovery write', { pendingRecovery: [{ operation_id: 1, block_id: 'rb-new', error: null }] }],
  ])('%s: the card still opens, says why, and disables every write', (_l, props) => {
    const c = mount({ blocks: [done('rb-new', '2026-06-01T00:00:00Z', { reason: 'sprain' })], ...props });
    press(c.root, 'recovery-manage-trigger-rb-new');
    expect(host(c.root, 'recovery-manage-locked')).toHaveLength(1);
    expect(byLabel(c.root, 'Edit reason for this recovery block: sprain').props.accessibilityState.disabled).toBe(true);
    expect(byLabel(c.root, 'Counting in normal analytics: Off').props.accessibilityState.disabled).toBe(true);
    expect(host(c.root, 'recovery-reopen-rb-new')[0].props.accessibilityState.disabled).toBe(true);
  });

  test('stale: the card explains the name/group pause only', () => {
    const c = mount({ blocks: [done('rb-new', '2026-06-01T00:00:00Z')], stateStale: true });
    press(c.root, 'recovery-manage-trigger-rb-new');
    expect(texts(host(c.root, 'recovery-manage-locked')[0])[0]).toMatch(/^Some changes \(matching or tidying names, and movement groups\) are paused/);
  });
});

describe('Recovery History selector', () => {
  const newest = done('rb-new', '2026-06-01T00:00:00Z');
  const older = done('rb-old', '2026-05-01T00:00:00Z');

  test('collapsed by default, lists every live completed block newest first, with selected state', () => {
    const c = mount({ blocks: [older, newest] });
    expect(host(c.root, 'recovery-history-row-rb-new')).toHaveLength(0);
    const header = host(c.root, 'recovery-history-header')[0];
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    expect(StyleSheet.flatten(header.props.style).minHeight).toBeGreaterThanOrEqual(44);
    press(c.root, 'recovery-history-header');
    const rows = c.root.findAll(n => typeof n.type === 'string' && /^recovery-history-row-/.test(n.props.testID || ''));
    expect(rows.map(r => r.props.testID)).toEqual(['recovery-history-row-rb-new', 'recovery-history-row-rb-old']);
    expect(rows.map(r => r.props.accessibilityState.selected)).toEqual([true, false]);
  });

  test('exactly one Manage card is visible; active and completed never duplicate', () => {
    const c = mount({ blocks: [block(), newest, older] });
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb1']);
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    press(c.root, 'recovery-history-row-rb1');
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb1']);
    // History navigation itself writes nothing.
    for (const fn of Object.values(mockLifecycle)) expect(fn).not.toHaveBeenCalled();
  });

  test('picking a block opens its Manage card, since that card sits above the History list', () => {
    const c = mount({ blocks: [block(), newest, older] });
    expect(host(c.root, 'recovery-manage-trigger-rb1')[0].props.accessibilityState.expanded).toBe(false);
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    expect(host(c.root, 'recovery-manage-trigger-rb-old')[0].props.accessibilityState.expanded).toBe(true);
    for (const fn of Object.values(mockLifecycle)) expect(fn).not.toHaveBeenCalled();
  });

  test('a draft stays with its block across switching, and never leaks to another block', () => {
    const c = mount({ blocks: [newest, older] });
    press(c.root, 'recovery-manage-trigger-rb-new');
    tap(c.root, 'Add a reason for this recovery block');
    act(() => { byLabel(c.root, 'Reason for this recovery block').props.onChangeText('half-typed'); });
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    press(c.root, 'recovery-manage-trigger-rb-old');
    const oldCard = host(c.root, 'recovery-manage-card-rb-old')[0];
    expect(oldCard.findAll(n => n.props.accessibilityLabel === 'Reason for this recovery block')).toHaveLength(0);
    press(c.root, 'recovery-history-row-rb-new');
    expect(host(c.root, 'recovery-manage-card-rb-new')[0].findAll(n => n.props.accessibilityLabel === 'Reason for this recovery block')[0].props.value).toBe('half-typed');
  });

  test('a rejected write is still visible when returning to its block', async () => {
    mockLifecycle.setIncludeInNormalAnalytics.mockResolvedValueOnce({ ok: false, error: 'Only the newest block.' });
    const c = mount({ blocks: [newest, older] });
    press(c.root, 'recovery-manage-trigger-rb-new');
    await act(async () => { await byLabel(c.root, 'Counting in normal analytics: Off').props.onPress(); });
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    expect(host(c.root, 'recovery-manage-card-rb-old')[0].findAll(n => n.type === 'Text' && n.props.children === 'Only the newest block.')).toHaveLength(0);
    press(c.root, 'recovery-history-row-rb-new');
    expect(texts(c.root)).toContain('Only the newest block.');
  });
});

describe('regression coverage restored from the Analytics Manage block', () => {
  test('ineligible Rebuild/Match leave no empty padded row; groups and inclusion rows remain', () => {
    const c = mount({ blocks: [block()] });
    press(c.root, 'recovery-manage-trigger-rb1');
    expect(host(c.root, 'recovery-rebuild-baseline')).toHaveLength(0);
    expect(host(c.root, 'recovery-match-names')).toHaveLength(0);
    const body = host(c.root, 'recovery-manage-body-rb1')[0];
    const empty = body.children.filter(k => typeof k !== 'string' && k.children.length === 0);
    expect(empty).toHaveLength(0);
  });

  test('an unreadable baseline does not crash the Manage card; Reason and inclusion stay usable', () => {
    const bad = block({ baseline: { version: 2, exercises: {} } });
    const c = mount({ blocks: [bad] });
    expect(() => press(c.root, 'recovery-manage-trigger-rb1')).not.toThrow();
    expect(byLabel(c.root, 'Add a reason for this recovery block')).toBeDefined();
    expect(byLabel(c.root, 'Counting in normal analytics: Off')).toBeDefined();
    expect(host(c.root, 'recovery-manage-groups')).toHaveLength(0);
  });

  test('lock and stale notes say only what is true', () => {
    const locked = mount({ blocks: [block()], mutationsAllowed: false });
    press(locked.root, 'recovery-manage-trigger-rb1');
    expect(texts(host(locked.root, 'recovery-manage-locked')[0])[0]).toMatch(/^Changes are paused while a Recovery change is pending/);
    const stale = mount({ blocks: [block()], stateStale: true });
    press(stale.root, 'recovery-manage-trigger-rb1');
    expect(texts(host(stale.root, 'recovery-manage-locked')[0])[0]).not.toMatch(/^Changes are paused while/);
    const open = mount({ blocks: [block()] });
    press(open.root, 'recovery-manage-trigger-rb1');
    expect(host(open.root, 'recovery-manage-locked')).toHaveLength(0);
  });

  test('inclusion errors are kept per block: toggling another block never clears the first one', async () => {
    const a = done('rb-new', '2026-06-01T00:00:00Z');
    const b = done('rb-old', '2026-05-01T00:00:00Z');
    mockLifecycle.setIncludeInNormalAnalytics.mockResolvedValueOnce({ ok: false, error: 'A failed' });
    const c = mount({ blocks: [a, b] });
    press(c.root, 'recovery-manage-trigger-rb-new');
    await act(async () => { await byLabel(c.root, 'Counting in normal analytics: Off').props.onPress(); });
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    press(c.root, 'recovery-manage-trigger-rb-old');
    await act(async () => { await host(c.root, 'recovery-manage-card-rb-old')[0].findAll(n => n.props.accessibilityLabel === 'Counting in normal analytics: Off')[0].props.onPress(); });
    press(c.root, 'recovery-history-row-rb-new');
    expect(texts(host(c.root, 'recovery-manage-card-rb-new')[0])).toContain('A failed');
  });
});

describe('same-block collapse during a delayed write', () => {
  test('a reason save that fails after collapse keeps its error and draft on reopen', async () => {
    let fail;
    mockLifecycle.setBlockReason.mockImplementation(() => new Promise(r => { fail = r; }));
    const c = mount({ blocks: [done('rb-new', '2026-06-01T00:00:00Z', { reason: 'sprain' })] });
    press(c.root, 'recovery-manage-trigger-rb-new');
    tap(c.root, 'Edit reason for this recovery block: sprain');
    act(() => { byLabel(c.root, 'Reason for this recovery block').props.onChangeText('typed'); });
    let saving;
    act(() => { saving = byLabel(c.root, 'Save the reason').props.onPress(); });
    press(c.root, 'recovery-manage-trigger-rb-new'); // collapse mid-write
    expect(host(c.root, 'recovery-manage-body-rb-new')[0].props.accessibilityElementsHidden).toBe(true);
    await act(async () => { fail({ ok: false, error: 'offline' }); await saving; });
    press(c.root, 'recovery-manage-trigger-rb-new');
    expect(texts(c.root)).toContain('offline');
    expect(byLabel(c.root, 'Reason for this recovery block').props.value).toBe('typed');
    // Only Cancel discards.
    tap(c.root, 'Cancel editing the reason');
    expect(byLabel(c.root, 'Reason for this recovery block')).toBeUndefined();
  });
});

describe('focus follows a newly active block', () => {
  test('starting (or reopening) a block moves Manage focus off a previously selected completed block', () => {
    const newest = done('rb-new', '2026-06-01T00:00:00Z');
    const older = done('rb-old', '2026-05-01T00:00:00Z');
    let c;
    act(() => { c = render.create(<Harness blocks={[newest, older]} />); });
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    act(() => { c.update(<Harness blocks={[block(), newest, older]} />); });
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb1']);
  });
});

describe('review regressions (#1315, Codex @ d582a66c)', () => {
  const find = (root, pred) => root.findAll(pred);
  const withText = (root, t) => find(root, n => n.type === 'Text' && [].concat(n.props.children).join('') === t);

  test('completing the active block keeps its Manage card, draft, expansion and a late rejection', async () => {
    let fail;
    mockLifecycle.setBlockReason.mockImplementation(() => new Promise(r => { fail = r; }));
    let c;
    act(() => { c = render.create(<Harness blocks={[block({ reason: 'sprain' })]} />); });
    press(c.root, 'recovery-manage-trigger-rb1');
    tap(c.root, 'Edit reason for this recovery block: sprain');
    act(() => { byLabel(c.root, 'Reason for this recovery block').props.onChangeText('keep me'); });
    let saving;
    act(() => { saving = byLabel(c.root, 'Save the reason').props.onPress(); });
    // The SAME block (same id) is completed while the save is in flight.
    act(() => { c.update(<Harness blocks={[block({ reason: 'sprain', completed_at: '2026-06-01T00:00:00Z' })]} />); });
    expect(host(c.root, 'recovery-manage-trigger-rb1')[0].props.accessibilityState).toEqual({ expanded: true });
    expect(byLabel(c.root, 'Reason for this recovery block').props.value).toBe('keep me');
    await act(async () => { fail({ ok: false, error: 'offline' }); await saving; });
    expect(texts(c.root)).toContain('offline');
    expect(byLabel(c.root, 'Reason for this recovery block').props.value).toBe('keep me');
    // Active-only controls follow the new state; completed-only ones appear.
    expect(byLabel(c.root, 'End recovery block')).toBeUndefined();
  });

  test('a resolved target that is later deleted is reported, never replaced by another block\'s card', () => {
    const newest = done('rb-new', '2026-06-01T00:00:00Z');
    const old = done('rb-old', '2026-05-01T00:00:00Z');
    let c;
    act(() => { c = render.create(<Harness blocks={[block(), newest, old]} nav={{ id: 'rb-old', key: 1 }} />); });
    press(c.root, 'recovery-manage-trigger-rb1' );
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    // Same nonce, the target disappears from the authoritative blocks.
    act(() => { c.update(<Harness blocks={[block(), newest]} nav={{ id: 'rb-old', key: 1 }} />); });
    expect(texts(c.root)).toContain(MANAGE_TARGET_UNAVAILABLE);
    expect(shown(c.root)).toEqual([]);
    // The selector stays reachable, and picking a block clears the notice.
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb1');
    expect(texts(c.root)).not.toContain(MANAGE_TARGET_UNAVAILABLE);
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb1']);
  });

  test('a deleted history selection is reported too, even when only the active block remains', () => {
    const old = done('rb-old', '2026-05-01T00:00:00Z');
    let c;
    act(() => { c = render.create(<Harness blocks={[block(), old]} />); });
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    act(() => { c.update(<Harness blocks={[block()]} />); });
    expect(texts(c.root)).toContain(MANAGE_TARGET_UNAVAILABLE);
    expect(shown(c.root)).toEqual([]);
    expect(host(c.root, 'recovery-history-header')).toHaveLength(1);
  });

  test('write failures are announced: reason (editor and row), inclusion (sibling alert and switch label)', async () => {
    mockLifecycle.setBlockReason.mockResolvedValue({ ok: false, error: 'offline' });
    mockLifecycle.setIncludeInNormalAnalytics.mockResolvedValue({ ok: false, error: 'no network' });
    const c = mount({ blocks: [done('rb-new', '2026-06-01T00:00:00Z', { reason: 'sprain' })] });
    press(c.root, 'recovery-manage-trigger-rb-new');
    tap(c.root, 'Edit reason for this recovery block: sprain');
    await act(async () => { await byLabel(c.root, 'Save the reason').props.onPress(); });
    const editorErr = withText(c.root, 'offline')[0];
    expect(editorErr.props.accessibilityRole).toBe('alert');
    expect(editorErr.props.accessibilityLiveRegion).toBe('assertive');
    tap(c.root, 'Cancel editing the reason');
    await act(async () => { await byLabel(c.root, 'Counting in normal analytics: Off').props.onPress(); });
    const incErr = host(c.root, 'recovery-inclusion-error-rb-new')[0];
    expect(incErr.props.accessibilityRole).toBe('alert');
    expect(incErr.props.accessibilityLiveRegion).toBe('assertive');
    // The accessible switch itself reports the failure, not only On/Off.
    expect(byLabel(c.root, 'Counting in normal analytics: Off. Not saved: no network')).toBeDefined();
  });

});

describe('typed navigation intent', () => {
  test('normalizeNavTarget accepts an exact block id for Log only', () => {
    expect(normalizeNavTarget('Log', { kind: 'recovery-manage', blockId: 'rb1' })).toEqual({ kind: 'recovery-manage', noteId: null, blockId: 'rb1' });
    expect(normalizeNavTarget('Analytics', { kind: 'recovery-manage', blockId: 'rb1' })).toBeNull();
    expect(normalizeNavTarget('Log', { kind: 'recovery-manage' })).toBeNull();
    expect(normalizeNavTarget('Log', { kind: 'recovery-manage', blockId: '' })).toBeNull();
    // Ordinary note and recovery-note routes are unchanged.
    expect(normalizeNavTarget('Log', { kind: 'note', noteId: 'n1' })).toEqual({ kind: 'note', noteId: 'n1' });
    expect(normalizeNavTarget('Log', { kind: 'recovery-note', noteId: 'n1' })).toEqual({ kind: 'recovery-note', noteId: 'n1' });
  });

  const newest = done('rb-new', '2026-06-01T00:00:00Z');
  const older = done('rb-old', '2026-05-01T00:00:00Z');
  const el = (props) => <Harness blocks={[block(), newest, older]} {...props} />;

  test('selects and reveals the exact block (active or completed), and repeated same-target nonces re-reveal', () => {
    let c;
    act(() => { c = render.create(el({ nav: { id: 'rb-old', key: 1 } })); });
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    expect(host(c.root, 'recovery-manage-trigger-rb-old')[0].props.accessibilityState).toEqual({ expanded: true });
    // User moves elsewhere and collapses, then Analytics asks for the same block again.
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb1');
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb1']);
    act(() => { c.update(el({ nav: { id: 'rb-old', key: 2 } })); });
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    // An active-block target selects the active card.
    act(() => { c.update(el({ nav: { id: 'rb1', key: 3 } })); });
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb1']);
  });

  test('a deleted or unknown target is an explicit unavailable state and never opens another block', () => {
    let c;
    act(() => { c = render.create(el({ nav: { id: 'gone', key: 1 } })); });
    expect(texts(c.root)).toContain(MANAGE_TARGET_UNAVAILABLE);
    // Focus stays on the default (active) block, collapsed: nothing is edited or revealed.
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb1']);
    expect(host(c.root, 'recovery-manage-trigger-rb1')[0].props.accessibilityState).toEqual({ expanded: false });
    // Selecting a real block clears the notice.
    press(c.root, 'recovery-history-header');
    press(c.root, 'recovery-history-row-rb-old');
    expect(texts(c.root)).not.toContain(MANAGE_TARGET_UNAVAILABLE);
  });

  test('a deleted target with NO blocks left shows the explicit unavailable notice, never a silent Routine landing', () => {
    const onShow = jest.fn();
    const c = mount({ blocks: [], nav: { id: 'gone', key: 1 }, onShow });
    expect(texts(c.root)).toContain(MANAGE_TARGET_UNAVAILABLE);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  test('a failed read surfaces the Recovery view (with its retry) and applies the target after a verified retry', () => {
    const onShow = jest.fn();
    let c;
    act(() => { c = render.create(<Harness blocks={[]} stateReady={false} stateError={new Error('x')} nav={{ id: 'rb-old', key: 1 }} onShow={onShow} />); });
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(texts(c.root)).not.toContain(MANAGE_TARGET_UNAVAILABLE);
    act(() => { c.update(<Harness blocks={[block(), newest, older]} nav={{ id: 'rb-old', key: 1 }} onShow={onShow} />); });
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    expect(onShow).toHaveBeenCalledTimes(2);
  });

  test('a consumed reveal is one-shot: remounting the section (tab switch) neither re-expands nor re-scrolls', () => {
    let c;
    const tree = (hide) => <Harness blocks={[block(), newest, older]} nav={{ id: 'rb-old', key: 1 }} hide={hide} />;
    act(() => { c = render.create(tree(false)); });
    expect(host(c.root, 'recovery-manage-trigger-rb-old')[0].props.accessibilityState).toEqual({ expanded: true });
    act(() => { c.update(tree(true)); });
    act(() => { c.update(tree(false)); });
    // Focus is kept, but the card comes back collapsed.
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    expect(host(c.root, 'recovery-manage-trigger-rb-old')[0].props.accessibilityState).toEqual({ expanded: false });
  });

  test('a target waits for the verified read: not resolved against placeholder data, then applied', () => {
    let c;
    act(() => { c = render.create(<Harness blocks={[]} stateReady={false} stateError={new Error('x')} nav={{ id: 'rb-old', key: 1 }} />); });
    expect(texts(c.root)).not.toContain(MANAGE_TARGET_UNAVAILABLE);
    act(() => { c.update(el({ nav: { id: 'rb-old', key: 1 } })); });
    expect(shown(c.root)).toEqual(['recovery-manage-card-rb-old']);
    expect(texts(c.root)).not.toContain(MANAGE_TARGET_UNAVAILABLE);
  });
});
