// Recovery Blocks rows print each completed block's canonical latest-week total
// (#1378), read from the shared snapshot and never re-derived.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { LogRecoveryHistory } from '../components/recovery/LogRecoveryHistory';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { getRecoverySnapshot, _resetRecoverySnapshotStore, _snapshotDerivationCount } from '../lib/data/recoverySnapshot';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const BASE = '-Bench\n- 100 5\n-Squat\n- 100 5';
const blk = (id, o = {}) => ({
  id, baseline_note_id: `nb-${id}`, baseline_note_title: `Routine ${id}`, baseline: captureRecoveryBaselineFromText(BASE),
  started_at: '2026-05-01T00:00:00Z', completed_at: '2026-06-01T00:00:00Z', deleted_at: null, ...o,
});
const wk = (blockId, n, noteId) => ({ id: `${blockId}-w${n}`, block_id: blockId, note_id: noteId, week_number: n, deleted_at: null });
const note = (id, raw_text) => ({ id, title: id, raw_text });
const lifts = (b, s) => `-Bench\n- ${b} 5\n-Squat\n- ${s} 5`;

const host = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
const rowText = (root, id) => host(root, `recovery-history-summary-${id}`).map(n => [].concat(n.props.children).join(''))[0];
const rowLabel = (root, id) => host(root, `recovery-history-row-${id}`)[0].props.accessibilityLabel;
const rowTexts = (root, id) => host(root, `recovery-history-row-${id}`)[0].findAllByType('Text').map(t => [].concat(t.props.children).join(''));

function mount(props) {
  let c;
  act(() => { c = render.create(<LogRecoveryHistory focusedBlockId={null} onSelect={() => {}} activeBlock={null} {...props} />); });
  const header = c.root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-history-header' && n.props.onPress)[0];
  act(() => { header.props.onPress(); });
  return c;
}
const one = (block, weeks, notes, extra = {}) => mount({ completedBlocks: [block], weeks, notes, ...extra });

beforeEach(() => { _resetRecoverySnapshotStore(); });

describe('canonical total per completed row (#1378)', () => {
  test('below 100% matches the detailed canonical display', () => {
    const b = blk('a');
    const weeks = [wk('a', 1, 'w1')];
    const notes = [note('nb-a', BASE), note('w1', lifts(80, 80))];
    const c = one(b, weeks, notes);
    const snap = getRecoverySnapshot({ block: b, weeks, notes });
    expect(snap.display.headline).toBe('80% total recovery');
    expect(rowText(c.root, 'a')).toBe('80% total recovery · Week 1');
  });

  test('exactly 100%, and above-baseline input keeps the 100% cap with the uncapped lift evidence', () => {
    const exact = one(blk('a'), [wk('a', 1, 'w1')], [note('nb-a', BASE), note('w1', BASE)]);
    expect(rowText(exact.root, 'a')).toBe('100% total recovery · Week 1');
    const b = blk('a');
    const weeks = [wk('a', 1, 'w2')];
    const notes = [note('nb-a', BASE), note('w2', lifts(130, 100))];
    const above = one(b, weeks, notes);
    expect(rowText(above.root, 'a')).toBe('100% total recovery · Week 1');
    expect(getRecoverySnapshot({ block: b, weeks, notes }).strength.lifts.map(l => l.percent)).toEqual([130, 100]);
  });

  test('a genuine canonical 0% stays 0%', () => {
    const c = one(blk('a'), [wk('a', 1, 'w1')], [note('nb-a', BASE), note('w1', '-Sled Push\n- 100 5,5')]);
    expect(rowText(c.root, 'a')).toBe('0% total recovery · Week 1');
  });

  test('empty, unavailable and non-scoreable states print truthful words, never a fabricated 0%', () => {
    const noWeeks = one(blk('a'), [], [note('nb-a', BASE)]);
    expect(rowText(noWeeks.root, 'a')).toBe('Baseline captured. No week logged yet.');
    expect(rowText(noWeeks.root, 'a')).not.toMatch(/Week \d/);
    const noBase = one(blk('a', { baseline: null }), [wk('a', 1, 'w1')], [note('nb-a', BASE), note('w1', BASE)]);
    expect(rowText(noBase.root, 'a')).toBe('Baseline data for this block isn’t available.');
    const repsOnly = '-Pull-up\n- 8,8,8';
    const ns = one(blk('a', { baseline: captureRecoveryBaselineFromText(repsOnly) }), [wk('a', 1, 'w1')], [note('nb-a', repsOnly), note('w1', repsOnly)]);
    expect(rowText(ns.root, 'a')).toBe('Week 1: No baseline lift can be scored for strength yet.');
    for (const c of [noWeeks, noBase, ns]) expect(rowText(c.root, 'a')).not.toMatch(/%/);
  });

  test('an unreadable latest week keeps the canonical carried total and says it adds nothing', () => {
    const c = one(blk('a'), [wk('a', 1, 'w1'), wk('a', 3, 'gone')], [note('nb-a', BASE), note('w1', lifts(80, 80))]);
    expect(rowText(c.root, 'a')).toBe('80% total recovery · Week 3');
    expect(rowTexts(c.root, 'a')).toContain('Week 3 note can’t be read; total is from earlier weeks');
    expect(rowLabel(c.root, 'a')).toContain('80% total recovery, Week 3. Week 3 note can’t be read; total is from earlier weeks.');
  });

  test('stale cached evidence is qualified visibly and in the label', () => {
    const c = one(blk('a'), [wk('a', 1, 'w1')], [note('nb-a', BASE), note('w1', lifts(80, 80))], { stale: true });
    expect(rowTexts(c.root, 'a')).toContain('From last saved data');
    expect(rowLabel(c.root, 'a')).toMatch(/From last saved data\.$/);
  });

  test('the label keeps title, dates and reason, then adds the summary', () => {
    const c = one(blk('a', { reason: 'sprain' }), [wk('a', 2, 'w1')], [note('nb-a', BASE), note('w1', lifts(80, 80))]);
    const label = rowLabel(c.root, 'a');
    expect(label).toMatch(/^Manage completed recovery block Routine a, .+ to .+\. Reason: sprain\. 80% total recovery, Week 2\.$/);
  });
});

describe('per-block isolation and invalidation (#1378)', () => {
  const A = blk('a');
  const B = blk('b', { completed_at: '2026-07-01T00:00:00Z' });
  const weeks = [wk('a', 1, 'a1'), wk('a', 4, 'a4'), wk('b', 2, 'b2')];
  const notes = [note('nb-a', BASE), note('nb-b', BASE), note('a1', lifts(60, 60)), note('a4', lifts(90, 90)), note('b2', lifts(70, 70))];

  test('two completed blocks each show their own latest week, with nonconsecutive ordinals', () => {
    const c = mount({ completedBlocks: [B, A], weeks, notes });
    expect(rowText(c.root, 'a')).toBe('90% total recovery · Week 4');
    expect(rowText(c.root, 'b')).toBe('70% total recovery · Week 2');
  });

  test('note edits, week removal, block removal and reopen re-derive without leakage', () => {
    const c = mount({ completedBlocks: [B, A], weeks, notes });
    const update = (p) => act(() => { c.update(<LogRecoveryHistory focusedBlockId={null} onSelect={() => {}} activeBlock={null} completedBlocks={[B, A]} weeks={weeks} notes={notes} {...p} />); });
    update({ notes: notes.map(n => (n.id === 'a4' ? note('a4', lifts(100, 100)) : n)) });
    expect(rowText(c.root, 'a')).toBe('100% total recovery · Week 4');
    expect(rowText(c.root, 'b')).toBe('70% total recovery · Week 2');
    update({ weeks: weeks.filter(w => w.id !== 'a-w4') });
    expect(rowText(c.root, 'a')).toBe('60% total recovery · Week 1');
    update({ weeks: weeks.filter(w => w.block_id !== 'b') });
    expect(rowText(c.root, 'b')).toBe('Baseline captured. No week logged yet.');
    update({ completedBlocks: [A] });
    expect(host(c.root, 'recovery-history-row-b')).toHaveLength(0);
    expect(rowText(c.root, 'a')).toBe('90% total recovery · Week 4');
    // Reopened: B is active again and prints no completed-block summary.
    update({ activeBlock: { ...B, completed_at: null }, completedBlocks: [A] });
    expect(host(c.root, 'recovery-history-row-b')).toHaveLength(1);
    expect(host(c.root, 'recovery-history-summary-b')).toHaveLength(0);
    expect(rowText(c.root, 'a')).toBe('90% total recovery · Week 4');
  });

  test('selecting a row only reports the block id', () => {
    const onSelect = jest.fn();
    const c = mount({ completedBlocks: [B, A], weeks, notes, onSelect });
    act(() => { c.root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-history-row-a' && n.props.onPress)[0].props.onPress(); });
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('long histories stay bounded (#1378 review)', () => {
  test('30 completed blocks derive once each; selecting and rerendering re-derive nothing, and the shared snapshot survives', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `h${i}`);
    const blocks = ids.map(id => blk(id));
    const weeks = ids.map(id => wk(id, 1, `${id}-n`));
    const notes = ids.flatMap(id => [note(`nb-${id}`, BASE), note(`${id}-n`, lifts(80, 80))]);
    // A surface's full snapshot that must not be evicted by the rows.
    const shared = getRecoverySnapshot({ block: blocks[0], weeks, notes });
    const before = _snapshotDerivationCount();
    let selected = null;
    const el = (focused) => <LogRecoveryHistory focusedBlockId={focused} onSelect={(id) => { selected = id; }} activeBlock={null} completedBlocks={blocks} weeks={weeks} notes={notes} />;
    const c = mount({ completedBlocks: blocks, weeks, notes, onSelect: (id) => { selected = id; } });
    // h0 reuses the already-derived core; the other 29 derive once.
    expect(_snapshotDerivationCount() - before).toBe(29);
    expect(ids.every(id => rowText(c.root, id) === '80% total recovery · Week 1')).toBe(true);
    const afterExpand = _snapshotDerivationCount();
    act(() => { c.root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-history-row-h7' && n.props.onPress)[0].props.onPress(); });
    act(() => { c.update(el(selected)); });
    act(() => { c.update(el('h12')); });
    expect(selected).toBe('h7');
    expect(_snapshotDerivationCount()).toBe(afterExpand);
    expect(getRecoverySnapshot({ block: blocks[0], weeks, notes })).toBe(shared);
  });
});
