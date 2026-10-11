// Analytics Recovery "Manage block" + week selection (#1307).
//
// One sibling Manage block panel hosts every maintenance control for the focused
// block (reason, rebuild, match names, tidy names, group editor, reopen, inclusion)
// and the evidence card hosts none; the strength week rows are the sole week
// selector. Deep behavior of each control stays pinned in its own suite
// (analytics-recovery-section, recovery-reason, movement-groups); this file pins
// ownership, gating, per-block isolation and selection.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { BlockEvidence } from '../components/recovery/RecoveryEvidence';
import { RecoveryManageBlock } from '../components/recovery/RecoveryManageBlock';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import * as hooks from '../hooks/entries/recoveryBlockHooks';
import { formatDate } from '../lib/format';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const BASE = '-Bench\n- 100 5\n-Squat\n- 100 5';

function block(overrides = {}) {
  return {
    id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'Push Pull Legs',
    baseline: captureRecoveryBaselineFromText(BASE),
    started_at: '2026-05-01T00:00:00Z', completed_at: null,
    saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', deleted_at: null,
    ...overrides,
  };
}
const week = (n, noteId, o = {}) => ({
  id: `rw-${o.block_id || 'rb1'}-${n}`, block_id: 'rb1', note_id: noteId, week_number: n, completed_at: null,
  saved_at: '2026-05-08T00:00:00Z', updated_at: '2026-05-08T00:00:00Z', deleted_at: null, ...o,
});
const note = (id, raw_text, title = null) => ({ id, title: title ?? `Note ${id}`, raw_text });

const W = (w) => `-Bench\n- ${w} 5\n-Squat\n- ${w} 5`;
const NOTES = [note('nb', BASE), note('w1', W(60)), note('w2', W(80)), note('w3', W(90))];
const WEEKS = [week(1, 'w1'), week(2, 'w2'), week(3, 'w3')];

let mockLifecycle;
beforeEach(() => {
  mockLifecycle = {
    setIncludeInNormalAnalytics: jest.fn().mockResolvedValue({ ok: true }),
    reopenBlock: jest.fn().mockResolvedValue({ ok: true }),
    setBlockReason: jest.fn().mockResolvedValue({ ok: true }),
    rebuildBaseline: jest.fn().mockResolvedValue({ ok: true }),
  };
  jest.spyOn(hooks, 'useRecoveryBlockLifecycle').mockReturnValue(mockLifecycle);
});
afterEach(() => { jest.restoreAllMocks(); });

function mount(props = {}) {
  let c;
  act(() => { c = render.create(<AnalyticsRecoverySection blocks={[block()]} weeks={WEEKS} notes={NOTES} {...props} />); });
  return c;
}
const comp = (root, id) => root.findAll(n => typeof n.type !== 'string' && n.props.testID === id && n.props.onPress)[0];
const press = (root, id) => act(() => { comp(root, id).props.onPress(); });
const host = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
const byLabel = (root, l) => root.findAll(n => n.props && n.props.accessibilityLabel === l)[0];
const texts = (root) => root.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
const summary = (root) => host(root, 'recovery-strength-summary')[0].props.accessibilityLabel;
const openManage = (root) => press(root, 'recovery-manage-block-trigger');
const pickWeek = (root, n) => press(root, `recovery-strength-week-${n}`);
const isRow = (n) => typeof n.type !== 'string' && /^recovery-strength-week-\d+$/.test(n.props.testID || '') && n.props.onPress;

describe('Manage block ownership', () => {
  test('is a sibling of the evidence card, collapsed by default, and openable', () => {
    const c = mount();
    const evidence = c.root.findAllByType(BlockEvidence)[0];
    expect(c.root.findAllByType(RecoveryManageBlock)).toHaveLength(1);
    expect(evidence.findAllByType(RecoveryManageBlock)).toHaveLength(0);
    expect(host(c.root, 'recovery-manage-block')).toHaveLength(0);
    const trigger = comp(c.root, 'recovery-manage-block-trigger');
    expect(trigger.props.accessibilityRole).toBe('button');
    expect(trigger.props.accessibilityState).toEqual({ expanded: false });
    expect(StyleSheet.flatten(trigger.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(texts(c.root)).toContain('Manage block');
    openManage(c.root);
    expect(comp(c.root, 'recovery-manage-block-trigger').props.accessibilityState).toEqual({ expanded: true });
    expect(host(c.root, 'recovery-manage-block')).toHaveLength(1);
  });

  test('every maintenance control is inside Manage block and none inside the evidence card', () => {
    const v1 = { version: 1, exercises: [{ key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, volume: 300, sets_completed: 3 }] };
    const c = mount({
      blocks: [block({ baseline: v1, completed_at: '2026-06-01T00:00:00Z', reason: 'sprain' })],
    });
    openManage(c.root);
    const evidence = c.root.findAllByType(BlockEvidence)[0];
    const manage = c.root.findAllByType(RecoveryManageBlock)[0];
    const labels = [
      'Edit reason for this recovery block: sprain',
      'Rebuild baseline',
      'Reopen recovery block: Push Pull Legs',
    ];
    for (const l of labels) {
      expect(manage.findAll(n => n.props.accessibilityLabel === l).length).toBeGreaterThan(0);
      expect(evidence.findAll(n => n.props.accessibilityLabel === l)).toHaveLength(0);
    }
    expect(manage.findAll(n => n.props.testID === 'recovery-inclusion-switch-rb1').length).toBeGreaterThan(0);
    expect(manage.findAll(n => n.props.testID === 'recovery-manage-groups-header').length).toBeGreaterThan(0);
    expect(evidence.findAll(n => /^recovery-inclusion-switch/.test(n.props.testID || ''))).toHaveLength(0);
    expect(evidence.findAll(n => n.props.testID === 'recovery-manage-groups-header')).toHaveLength(0);
    // The evidence keeps a quiet read-only reason, with no edit affordance.
    expect(host(evidence, 'recovery-reason-context')).toHaveLength(1);
    expect(evidence.findAll(n => n.props.testID === 'recovery-reason-row')).toHaveLength(0);
  });

  test('opening and closing the panel writes nothing', () => {
    const c = mount({ blocks: [block({ completed_at: '2026-06-01T00:00:00Z' })] });
    openManage(c.root);
    openManage(c.root);
    for (const fn of Object.values(mockLifecycle)) expect(fn).not.toHaveBeenCalled();
  });

  test('collapsing keeps the panel mounted but hidden from layout and assistive tech, draft intact', () => {
    const c = mount({ blocks: [block({ reason: 'sprain' })] });
    openManage(c.root);
    act(() => { byLabel(c.root, 'Edit reason for this recovery block: sprain').props.onPress(); });
    act(() => { byLabel(c.root, 'Reason for this recovery block').props.onChangeText('typed'); });
    openManage(c.root); // collapse
    const body = host(c.root, 'recovery-manage-block')[0];
    expect(StyleSheet.flatten(body.props.style).display).toBe('none');
    expect(body.props.accessibilityElementsHidden).toBe(true);
    expect(body.props.importantForAccessibility).toBe('no-hide-descendants');
    openManage(c.root); // reopen
    expect(StyleSheet.flatten(host(c.root, 'recovery-manage-block')[0].props.style).display).toBeUndefined();
    expect(host(c.root, 'recovery-manage-block')[0].props.accessibilityElementsHidden).toBe(false);
    expect(byLabel(c.root, 'Reason for this recovery block').props.value).toBe('typed');
  });

  test('a write started, collapsed and then failed still shows its error and draft on reopen', async () => {
    let fail;
    mockLifecycle.setBlockReason.mockImplementation(() => new Promise(r => { fail = r; }));
    const c = mount({ blocks: [block({ reason: 'sprain' })] });
    openManage(c.root);
    act(() => { byLabel(c.root, 'Edit reason for this recovery block: sprain').props.onPress(); });
    act(() => { byLabel(c.root, 'Reason for this recovery block').props.onChangeText('typed'); });
    let saving;
    act(() => { saving = byLabel(c.root, 'Save the reason').props.onPress(); });
    openManage(c.root); // collapse mid-write
    await act(async () => { fail({ ok: false, error: 'offline' }); await saving; });
    openManage(c.root);
    expect(texts(c.root)).toContain('offline');
    expect(byLabel(c.root, 'Reason for this recovery block').props.value).toBe('typed');
  });
});

describe('Manage block gates', () => {
  test.each([
    ['mutations not allowed', { mutationsAllowed: false }],
    ['pending recovery write', { pendingRecovery: [{ operation_id: 1, block_id: 'rb1', error: null }] }],
  ])('%s: panel still opens, explains why, and disables every write', (_l, props) => {
    const c = mount({ blocks: [block({ completed_at: '2026-06-01T00:00:00Z', reason: 'sprain' })], ...props });
    openManage(c.root);
    expect(host(c.root, 'recovery-manage-locked')).toHaveLength(1);
    expect(byLabel(c.root, 'Edit reason for this recovery block: sprain').props.accessibilityState.disabled).toBe(true);
    expect(byLabel(c.root, 'Reopen recovery block: Push Pull Legs').props.accessibilityState.disabled).toBe(true);
    expect(host(c.root, 'recovery-inclusion-switch-rb1')[0].props.disabled).toBe(true);
  });

  test('a stale read pauses names and groups, and the note says only that', () => {
    const c = mount({ stateStale: true });
    openManage(c.root);
    const note = host(c.root, 'recovery-manage-locked');
    expect(note).toHaveLength(1);
    expect(texts(note[0])[0]).toMatch(/^Some changes \(matching or tidying names, and movement groups\) are paused/);
    // Reason stays editable under a stale-only read (existing gating).
    expect(byLabel(c.root, 'Add a reason for this recovery block').props.accessibilityState.disabled).toBe(false);
  });

  test('a lock note does not claim names-only pausing', () => {
    const c = mount({ mutationsAllowed: false });
    openManage(c.root);
    expect(texts(host(c.root, 'recovery-manage-locked')[0])[0]).toMatch(/^Changes are paused while a Recovery change is pending/);
  });

  test('unlocked panel shows no locked note', () => {
    const c = mount();
    openManage(c.root);
    expect(host(c.root, 'recovery-manage-locked')).toHaveLength(0);
  });
});

describe('Reopen eligibility', () => {
  const done = (id, at) => block({ id, completed_at: at });
  test('only the newest completed block, and only with no active block', async () => {
    const newest = done('rb-new', '2026-06-01T00:00:00Z');
    const older = done('rb-old', '2026-05-01T00:00:00Z');
    const c = mount({ blocks: [newest, older], weeks: [] });
    openManage(c.root);
    expect(byLabel(c.root, 'Reopen recovery block: Push Pull Legs')).toBeDefined();
    // Focus the older block: no Reopen on it.
    act(() => { byLabel(c.root, 'Expand recovery history').props.onPress(); });
    act(() => { byLabel(c.root, `View recovery evidence for Push Pull Legs, completed ${formatDate(older.completed_at)}`).props.onPress(); });
    openManage(c.root);
    expect(byLabel(c.root, 'Reopen recovery block: Push Pull Legs')).toBeUndefined();
    // With an active block no completed block offers it.
    const withActive = mount({ blocks: [block(), newest], weeks: [] });
    act(() => { byLabel(withActive.root, 'Expand recovery history').props.onPress(); });
    act(() => { byLabel(withActive.root, `View recovery evidence for Push Pull Legs, completed ${formatDate(newest.completed_at)}`).props.onPress(); });
    openManage(withActive.root);
    expect(byLabel(withActive.root, 'Reopen recovery block: Push Pull Legs')).toBeUndefined();
  });
});

describe('Reason editing', () => {
  test('saving empty clears via the raw draft; Cancel discards; a failed save keeps the editor with the error', async () => {
    const c = mount({ blocks: [block({ reason: 'sprain' })] });
    openManage(c.root);
    act(() => { byLabel(c.root, 'Edit reason for this recovery block: sprain').props.onPress(); });
    act(() => { byLabel(c.root, 'Reason for this recovery block').props.onChangeText('x'); });
    act(() => { byLabel(c.root, 'Cancel editing the reason').props.onPress(); });
    expect(mockLifecycle.setBlockReason).not.toHaveBeenCalled();

    act(() => { byLabel(c.root, 'Edit reason for this recovery block: sprain').props.onPress(); });
    act(() => { byLabel(c.root, 'Reason for this recovery block').props.onChangeText(''); });
    mockLifecycle.setBlockReason.mockResolvedValueOnce({ ok: false, error: 'offline' });
    await act(async () => { await byLabel(c.root, 'Save the reason').props.onPress(); });
    expect(mockLifecycle.setBlockReason).toHaveBeenCalledWith({ blockId: 'rb1', reason: '' });
    expect(texts(c.root)).toContain('offline');
    expect(byLabel(c.root, 'Reason for this recovery block')).toBeDefined();
    await act(async () => { await byLabel(c.root, 'Save the reason').props.onPress(); });
    expect(byLabel(c.root, 'Reason for this recovery block')).toBeUndefined();
  });

  test('a draft never follows focus onto another block', () => {
    const active = block({ reason: 'active reason' });
    const done = block({ id: 'rb-done', completed_at: '2026-06-01T00:00:00Z', baseline_note_title: 'Old', reason: 'old reason' });
    const c = mount({ blocks: [active, done], weeks: [] });
    openManage(c.root);
    act(() => { byLabel(c.root, 'Edit reason for this recovery block: active reason').props.onPress(); });
    act(() => { byLabel(c.root, 'Reason for this recovery block').props.onChangeText('half-typed'); });
    act(() => { byLabel(c.root, 'Expand recovery history').props.onPress(); });
    act(() => { byLabel(c.root, `View recovery evidence for Old, completed ${formatDate(done.completed_at)}. Reason: old reason`).props.onPress(); });
    expect(byLabel(c.root, 'Reason for this recovery block')).toBeUndefined();
    openManage(c.root);
    expect(byLabel(c.root, 'Edit reason for this recovery block: old reason')).toBeDefined();
    act(() => { byLabel(c.root, 'View active recovery block').props.onPress(); });
    openManage(c.root);
    expect(byLabel(c.root, 'Reason for this recovery block')).toBeUndefined();
    expect(byLabel(c.root, 'Edit reason for this recovery block: active reason')).toBeDefined();
  });
});

describe('Inclusion never filters recovery strength', () => {
  test('the strength summary is identical whether the block is included or not', () => {
    const off = summary(mount({ blocks: [block({ include_in_normal_analytics: false })] }).root);
    const on = summary(mount({ blocks: [block({ include_in_normal_analytics: true })] }).root);
    expect(on).toBe(off);
  });
});

describe('Week rows are the sole selector', () => {
  test('no WeekPicker; rows default to the latest and carry role, name, selected state and 44dp', () => {
    const c = mount();
    expect(c.root.findAll(n => /^recovery-week-(chip|picker)/.test(n.props.testID || ''))).toHaveLength(0);
    expect(texts(c.root).filter(t => t === 'Week')).toHaveLength(0);
    const rows = c.root.findAll(isRow);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.props.accessibilityRole).toBe('button');
      expect(r.props.accessibilityLabel).toMatch(/^Week \d: /);
      expect(StyleSheet.flatten(r.props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
    expect(rows.map(r => r.props.accessibilityState.selected)).toEqual([false, false, true]);
    expect(summary(c.root)).toMatch(/^Week 3: /);
  });

  test('first/latest selection re-derives headline, ladder and group scores together', () => {
    const c = mount();
    press(c.root, 'recovery-movement-groups-header');
    const snap = () => ({
      summary: summary(c.root),
      ladder: JSON.stringify(texts(c.root.findAll(n => n.props.testID === 'recovery-strength-ladder')[0])),
      groups: ['push', 'legs'].map(id => (host(c.root, `movement-group-value-${id}`)[0] || { props: {} }).props.children),
    });
    const latest = snap();
    pickWeek(c.root, 1);
    const first = snap();
    expect(first.summary).toMatch(/^Week 1: /);
    expect(first.summary).not.toBe(latest.summary);
    expect(first.ladder).not.toBe(latest.ladder);
    expect(first.groups).not.toEqual(latest.groups);
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([true, false, false]);
    pickWeek(c.root, 3);
    expect(snap()).toEqual(latest);
  });

  test('a missing or unreadable week is selectable and reveals its explicit notice', () => {
    const c = mount({ weeks: [week(1, 'w1'), week(2, 'ghost'), week(3, 'w3')] });
    pickWeek(c.root, 2);
    expect(texts(c.root).some(t => t.includes('no longer available'))).toBe(true);
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([false, true, false]);
    expect(byLabel(c.root, 'Week 2: no readable evidence')).toBeDefined();
  });

  test('selection survives evidence updates while the id exists and falls back to the latest when removed', () => {
    const el = (weeks) => <AnalyticsRecoverySection blocks={[block()]} weeks={weeks} notes={NOTES} />;
    let c;
    act(() => { c = render.create(el(WEEKS)); });
    pickWeek(c.root, 2);
    act(() => { c.update(el(WEEKS.map(w => ({ ...w, updated_at: '2026-06-01T00:00:00Z' })))); });
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([false, true, false]);
    act(() => { c.update(el([WEEKS[0], WEEKS[2]])); });
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([false, true]);
    expect(summary(c.root)).toMatch(/^Week 3: /);
  });

  test('changing the focused block resets the selection to its latest week', () => {
    const done = block({ id: 'rb-done', completed_at: '2026-06-01T00:00:00Z', baseline_note_title: 'Old' });
    const oldWeeks = [week(1, 'w1', { block_id: 'rb-done' }), week(2, 'w2', { block_id: 'rb-done' })];
    const c = mount({ blocks: [block(), done], weeks: [...WEEKS, ...oldWeeks] });
    pickWeek(c.root, 1);
    act(() => { byLabel(c.root, 'Expand recovery history').props.onPress(); });
    act(() => { byLabel(c.root, `View recovery evidence for Old, completed ${formatDate(done.completed_at)}`).props.onPress(); });
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([false, true]);
    act(() => { byLabel(c.root, 'View active recovery block').props.onPress(); });
    expect(summary(c.root)).toMatch(/^Week 3: /);
  });
});

describe('History focus and Log navigation', () => {
  test('a history week row focuses that block and week; the Log link is a separate target that navigates by note id', () => {
    const onNavigate = jest.fn();
    const done = block({ id: 'rb-done', completed_at: '2026-06-01T00:00:00Z', baseline_note_title: 'Old' });
    const oldWeeks = [week(1, 'w1', { block_id: 'rb-done' }), week(2, 'w2', { block_id: 'rb-done' })];
    const c = mount({ blocks: [block(), done], weeks: [...WEEKS, ...oldWeeks], onNavigate });
    act(() => { byLabel(c.root, 'Expand recovery history').props.onPress(); });
    press(c.root, 'recovery-history-week-rb-done-1');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(summary(c.root)).toMatch(/^Week 1: /);
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([true, false]);
    expect(comp(c.root, 'recovery-history-week-rb-done-1').props.accessibilityState).toEqual({ selected: true });
    press(c.root, 'recovery-history-week-log-rb-done-2');
    expect(onNavigate).toHaveBeenCalledWith('Log', { kind: 'note', noteId: 'w2' });
  });
});

describe('Manage block rows', () => {
  test('ineligible Rebuild/Match leave no empty padded row or stray divider', () => {
    const c = mount();
    openManage(c.root);
    expect(host(c.root, 'recovery-rebuild-baseline')).toHaveLength(0);
    expect(host(c.root, 'recovery-match-names')).toHaveLength(0);
    const list = host(c.root, 'recovery-manage-block')[0];
    // Reason, Tidy names, Movement groups, inclusion: every child has content.
    // Ineligible actions render nothing (no wrapper row): the rendered rows are
    // exactly Reason, Tidy names, Movement groups and inclusion.
    const rendered = list.children.filter(k => typeof k !== 'string' && k.children.length > 0);
    expect(rendered).toHaveLength(4);
    expect(host(c.root, 'recovery-tidy-names')).toHaveLength(1);
  });
});

describe('History focus selection', () => {
  const done = block({ id: 'rb-done', completed_at: '2026-06-01T00:00:00Z', baseline_note_title: 'Old' });
  const oldWeeks = [week(1, 'w1', { block_id: 'rb-done' }), week(2, 'w2', { block_id: 'rb-done' })];
  const open = () => {
    const c = mount({ blocks: [block(), done], weeks: [...WEEKS, ...oldWeeks] });
    act(() => { byLabel(c.root, 'Expand recovery history').props.onPress(); });
    return c;
  };
  const histSel = (c, n) => comp(c.root, `recovery-history-week-rb-done-${n}`).props.accessibilityState.selected;
  const focusOld = (c) => act(() => { byLabel(c.root, `View recovery evidence for Old, completed ${formatDate(done.completed_at)}`).props.onPress(); });

  test('with no explicit selection the latest week row is highlighted, matching the evidence', () => {
    const c = open();
    focusOld(c);
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([false, true]);
    expect([histSel(c, 1), histSel(c, 2)]).toEqual([false, true]);
    press(c.root, 'recovery-history-week-rb-done-1');
    expect([histSel(c, 1), histSel(c, 2)]).toEqual([true, false]);
  });

  test('re-tapping the already-focused block keeps its selected week', () => {
    const c = open();
    press(c.root, 'recovery-history-week-rb-done-1');
    focusOld(c);
    expect(summary(c.root)).toMatch(/^Week 1: /);
    expect([histSel(c, 1), histSel(c, 2)]).toEqual([true, false]);
  });
});

describe('Robustness and single-week selector', () => {
  test('a parser-unreadable week is selectable with its unavailable presentation', () => {
    const { MAX_RAW_TEXT_LENGTH } = require('../lib/parser/workoutNote');
    const notes = [...NOTES, note('huge', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1))];
    const c = mount({ weeks: [week(1, 'w1'), week(2, 'huge'), week(3, 'w3')], notes });
    expect(byLabel(c.root, 'Week 2: no readable evidence')).toBeDefined();
    pickWeek(c.root, 2);
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([false, true, false]);
    expect(texts(comp(c.root, 'recovery-strength-week-2'))).toContain('No data');
  });

  test('a selection never resurrects after focus falls back through a data update', () => {
    const A = block();
    const B = block({ id: 'rb-b', completed_at: '2026-06-01T00:00:00Z', baseline_note_title: 'Old' });
    const bWeeks = [week(1, 'w1', { block_id: 'rb-b' }), week(2, 'w2', { block_id: 'rb-b' })];
    const el = (blocks) => <AnalyticsRecoverySection blocks={blocks} weeks={[...WEEKS, ...bWeeks]} notes={NOTES} />;
    let c;
    act(() => { c = render.create(el([A, B])); });
    pickWeek(c.root, 1);
    expect(summary(c.root)).toMatch(/^Week 1: /);
    act(() => { c.update(el([B])); }); // A disappears: B is focused
    expect(summary(c.root)).toMatch(/^Week 2: /);
    act(() => { c.update(el([A, B])); }); // A returns
    expect(summary(c.root)).toMatch(/^Week 3: /);
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([false, false, true]);
  });

  test('a single live week renders one selected, pressable row', () => {
    const c = mount({ weeks: [WEEKS[0]] });
    const rows = c.root.findAll(isRow);
    expect(rows).toHaveLength(1);
    expect(rows[0].props.accessibilityRole).toBe('button');
    expect(rows[0].props.accessibilityState.selected).toBe(true);
    expect(rows[0].props.accessibilityLabel).toMatch(/^Week 1: /);
  });

  test('an unreadable baseline does not crash Manage block; Reason and Inclusion stay usable', () => {
    const bad = block({ baseline: { version: 2, exercises: {} } });
    const c = mount({ blocks: [bad], weeks: [] });
    expect(() => openManage(c.root)).not.toThrow();
    expect(byLabel(c.root, 'Add a reason for this recovery block')).toBeDefined();
    expect(host(c.root, 'recovery-inclusion-switch-rb1')).toHaveLength(1);
    expect(host(c.root, 'recovery-manage-groups')).toHaveLength(0);
  });

  test('collapsing Movement groups mid-write keeps the failure and draft for the next open', async () => {
    const setGroup = jest.fn();
    jest.spyOn(require('../hooks/entries/movementGroupHooks'), 'useMovementGroupEditor')
      .mockReturnValue({ setMovementGroup: setGroup });
    let fail;
    setGroup.mockImplementation(() => new Promise(r => { fail = r; }));
    const c = mount();
    openManage(c.root);
    press(c.root, 'recovery-manage-groups-header');
    press(c.root, 'movement-group-edit-squat');
    press(c.root, 'movement-group-option-squat-hinge');
    press(c.root, 'recovery-manage-groups-header'); // collapse mid-write
    const body = host(c.root, 'recovery-manage-groups-body')[0];
    expect(body.props.accessibilityElementsHidden).toBe(true);
    expect(body.props.importantForAccessibility).toBe('no-hide-descendants');
    await act(async () => { fail({ ok: false, error: 'disk full' }); });
    press(c.root, 'recovery-manage-groups-header');
    expect(host(c.root, 'movement-group-error-squat')[0].props.children).toBe('Not saved: disk full');
    expect(host(c.root, 'movement-group-option-squat-hinge')[0].props.accessibilityState.selected).toBe(true);
  });
});

describe('Selection invalidation across every focus transition', () => {
  const A = block();
  const el = (props) => <AnalyticsRecoverySection blocks={[A]} weeks={WEEKS} notes={NOTES} {...props} />;
  const start = () => {
    let c;
    act(() => { c = render.create(el({})); });
    pickWeek(c.root, 1);
    expect(summary(c.root)).toMatch(/^Week 1: /);
    return c;
  };
  const latestAgain = (c) => {
    expect(summary(c.root)).toMatch(/^Week 3: /);
    expect(c.root.findAll(isRow).map(r => r.props.accessibilityState.selected)).toEqual([false, false, true]);
  };

  test('A -> no blocks (section hidden) -> A resets to the latest week', () => {
    const c = start();
    act(() => { c.update(el({ blocks: [] })); });
    expect(c.toJSON()).toBeNull();
    act(() => { c.update(el({})); });
    latestAgain(c);
  });

  test('A -> not-ready banner -> A resets to the latest week', () => {
    const c = start();
    act(() => { c.update(el({ stateReady: false, stateError: new Error('x') })); });
    expect(c.root.findAll(isRow)).toHaveLength(0);
    act(() => { c.update(el({})); });
    latestAgain(c);
  });

  test('A -> stale banner with no blocks -> A resets to the latest week', () => {
    const c = start();
    act(() => { c.update(el({ blocks: [], stateStale: true })); });
    expect(c.root.findAll(isRow)).toHaveLength(0);
    act(() => { c.update(el({})); });
    latestAgain(c);
  });

  test('re-tapping the already-focused block keeps its week', () => {
    const B = block({ id: 'rb-b', completed_at: '2026-06-01T00:00:00Z', baseline_note_title: 'Old' });
    const bWeeks = [week(1, 'w1', { block_id: 'rb-b' }), week(2, 'w2', { block_id: 'rb-b' })];
    let c;
    act(() => { c = render.create(<AnalyticsRecoverySection blocks={[B]} weeks={bWeeks} notes={NOTES} />); });
    pickWeek(c.root, 1);
    act(() => { byLabel(c.root, 'Expand recovery history').props.onPress(); });
    act(() => { byLabel(c.root, `View recovery evidence for Old, completed ${formatDate(B.completed_at)}`).props.onPress(); });
    expect(summary(c.root)).toMatch(/^Week 1: /);
  });
});
