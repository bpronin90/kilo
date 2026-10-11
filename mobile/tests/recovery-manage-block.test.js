// Analytics Recovery week selection and the read-only contract (#1307, #1315).
//
// Analytics holds NO maintenance control: Manage block lives in Log (see
// log-recovery-manage.test.js). This file pins the strength week rows as the sole
// week selector, history focus, per-block selection scoping, and that the only
// path to maintenance is one quiet `Manage in Log` link carrying the exact block id.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { BlockEvidence } from '../components/recovery/RecoveryEvidence';
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
const pickWeek = (root, n) => press(root, `recovery-strength-week-${n}`);
const isRow = (n) => typeof n.type !== 'string' && /^recovery-strength-week-\d+$/.test(n.props.testID || '') && n.props.onPress;

describe('Analytics Recovery is read-only (#1315)', () => {
  test('no maintenance control renders and no write hook is invoked', () => {
    const c = mount({ blocks: [block({ completed_at: '2026-06-01T00:00:00Z', reason: 'sprain' })] });
    const labels = c.root.findAll(n => typeof n.props.accessibilityLabel === 'string').map(n => n.props.accessibilityLabel);
    expect(labels.some(l => /^Manage recovery block|Reopen recovery block|Edit reason|Add a reason|Rebuild baseline|Tidy|Match/.test(l))).toBe(false);
    expect(host(c.root, 'recovery-inclusion-switch-rb1')).toHaveLength(0);
    expect(host(c.root, 'recovery-manage-groups')).toHaveLength(0);
    for (const fn of Object.values(mockLifecycle)) expect(fn).not.toHaveBeenCalled();
  });

  test('one quiet Manage in Log link carries the exact focused block id and writes nothing', () => {
    const onNavigate = jest.fn();
    const done = block({ id: 'rb-done', completed_at: '2026-06-01T00:00:00Z', baseline_note_title: 'Old' });
    const c = mount({ blocks: [block(), done], weeks: WEEKS, onNavigate });
    const links = host(c.root, 'recovery-manage-in-log');
    expect(links).toHaveLength(1);
    expect(StyleSheet.flatten(links[0].props.style).minHeight).toBeGreaterThanOrEqual(44);
    press(c.root, 'recovery-manage-in-log');
    expect(onNavigate).toHaveBeenLastCalledWith('Log', { kind: 'recovery-manage', blockId: 'rb1' });
    // Focus the completed block: the link follows the focused block, by id.
    act(() => { byLabel(c.root, 'Expand recovery history').props.onPress(); });
    act(() => { byLabel(c.root, `View recovery evidence for Old, completed ${formatDate(done.completed_at)}`).props.onPress(); });
    press(c.root, 'recovery-manage-in-log');
    expect(onNavigate).toHaveBeenLastCalledWith('Log', { kind: 'recovery-manage', blockId: 'rb-done' });
    for (const fn of Object.values(mockLifecycle)) expect(fn).not.toHaveBeenCalled();
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
    const snap = () => {
      // Disclosures reset to collapsed on a week change (#1315): open lifts + groups.
      const lifts = byLabel(c.root, 'Expand lifts');
      if (lifts) act(() => { lifts.props.onPress(); });
      if (!host(c.root, 'movement-group-row-push').length) press(c.root, 'recovery-movement-groups-header');
      return {
      summary: summary(c.root),
      ladder: JSON.stringify(texts(c.root.findAll(n => n.props.testID === 'recovery-strength-ladder')[0])),
      groups: ['push', 'legs'].map(id => (host(c.root, `movement-group-value-${id}`)[0] || { props: {} }).props.children),
      };
    };
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
