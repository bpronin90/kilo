// Tidy names card (#1309): one action, a complete preview, single Confirm,
// block-scoped state, accessible >=44dp controls, Undo, and conflict resolution.
import React from 'react';
import render, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { TidyRecoveryNamesAction } from '../components/recovery/TidyRecoveryNames';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { DarkColors, LightColors } from '../theme/colors';
import { ThemeContext } from '../theme/ThemeContext';

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const STAMP = '2026-05-01T00:00:00Z';
const block = (over = {}) => ({
  id: 'rb1', baseline: captureRecoveryBaselineFromText('-Squat\n- 225 5'), completed_at: null, deleted_at: null, ...over,
});
const weeks = [1, 2].map(n => ({ id: `w${n}`, block_id: 'rb1', note_id: `n${n}`, week_number: n, deleted_at: null }));
const notes = [
  { id: 'n1', raw_text: '-Squat 3x6-8, step up\n- 135 8\n', updated_at: STAMP },
  { id: 'n2', raw_text: '-Squat 3x8\n- 135 8\n', updated_at: STAMP },
];

const byLabel = (root, label) => root.findAll(i => i.props.accessibilityLabel === label)[0];
const texts = (root) => root.findAll(n => typeof n.type === 'string' && n.type === 'Text').map(n => [].concat(n.props.children).join(''));
const hasText = (root, s) => texts(root).some(t => t.includes(s));

function mount(props = {}, colors = LightColors) {
  const handlers = {
    onTidy: jest.fn().mockResolvedValue({ ok: true }),
  };
  let c;
  act(() => {
    c = render.create(
      <ThemeContext.Provider value={{ colors, mode: 'light', preference: 'light', setPreference: () => {} }}>
        <TidyRecoveryNamesAction block={block()} weeks={weeks} notes={notes} {...handlers} {...props} />
      </ThemeContext.Provider>
    );
  });
  return { root: c.root, c, handlers };
}
const press = (root, label) => act(() => { byLabel(root, label).props.onPress(); });
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

describe('Tidy names action', () => {
  test('exactly one entry point; opening and cancelling write nothing', async () => {
    const { root, handlers } = mount();
    await flush();
    expect(root.findAll(i => typeof i.type === 'string' && i.props.accessibilityLabel === 'Tidy names')).toHaveLength(1);
    press(root, 'Tidy names');
    expect(byLabel(root, 'Confirm tidy names')).toBeDefined();
    press(root, 'Cancel');
    expect(byLabel(root, 'Confirm tidy names')).toBeUndefined();
    expect(handlers.onTidy).not.toHaveBeenCalled();
  });

  test('preview lists every occurrence with scheme and moved note', async () => {
    const { root } = mount();
    press(root, 'Tidy names');
    expect(hasText(root, 'Week 1: Squat 3x6-8, step up → Squat 3x6-8')).toBe(true);
    expect(hasText(root, 'Keeps 3x6-8')).toBe(true);
    expect(hasText(root, 'Moves to a note: step up')).toBe(true);
    expect(hasText(root, 'Week headers (1)')).toBe(true);
    expect(hasText(root, 'Numbers never change')).toBe(true);
    expect(byLabel(root, 'Undo tidy names')).toBeUndefined();
  });

  test('one Confirm sends the reviewed evidence and signature; double tap sends once', async () => {
    let release;
    const { root, handlers } = mount();
    handlers.onTidy.mockImplementation(() => new Promise(r => { release = r; }));
    press(root, 'Tidy names');
    act(() => { byLabel(root, 'Confirm tidy names').props.onPress(); });
    act(() => { byLabel(root, 'Confirm tidy names').props.onPress(); });
    expect(handlers.onTidy).toHaveBeenCalledTimes(1);
    expect(handlers.onTidy).toHaveBeenCalledWith({ blockId: 'rb1', evidence: expect.any(String), signature: expect.any(String) });
    expect(byLabel(root, 'Confirm tidy names').props.disabled).toBe(true);
    await act(async () => { release({ ok: true }); });
    expect(byLabel(root, 'Confirm tidy names')).toBeUndefined();
    expect(hasText(root, 'Names tidied')).toBe(true);
  });

  test('a rejected review stays open and shows the reason', async () => {
    const { root, handlers } = mount();
    handlers.onTidy.mockResolvedValue({ ok: false, error: 'These names changed since you opened the review. Review them again.' });
    press(root, 'Tidy names');
    await act(async () => { await byLabel(root, 'Confirm tidy names').props.onPress(); });
    expect(hasText(root, 'These names changed')).toBe(true);
    expect(byLabel(root, 'Confirm tidy names')).toBeDefined();
  });

  test('an empty plan says so explicitly and offers no Confirm', async () => {
    const clean = [{ id: 'n1', raw_text: '-Squat\n- 135 8\n', updated_at: STAMP }, { id: 'n2', raw_text: '-Squat\n- 135 8\n', updated_at: STAMP }];
    const { root } = mount({ notes: clean });
    press(root, 'Tidy names');
    expect(hasText(root, 'Names are already tidy. Nothing to change.')).toBe(true);
    expect(byLabel(root, 'Confirm tidy names')).toBeUndefined();
    press(root, 'Close');
    expect(byLabel(root, 'Close')).toBeUndefined();
  });

  test('an unreadable week is a clear error, never a partial plan', async () => {
    const { root } = mount({ notes: notes.slice(0, 1) });
    press(root, 'Tidy names');
    expect(hasText(root, 'can’t be read')).toBe(true);
    expect(byLabel(root, 'Confirm tidy names')).toBeUndefined();
  });

  test('skipped lifts are listed with their reason', async () => {
    const dup = [{ id: 'n1', raw_text: '-Squat 3x6-8, step up\n- 135 8\n-Squat\n- 135 8\n', updated_at: STAMP }, notes[1]];
    const { root } = mount({ notes: dup });
    press(root, 'Tidy names');
    expect(hasText(root, 'Skipped (1)')).toBe(true);
    expect(hasText(root, 'would merge')).toBe(true);
  });

  test('absent for a v1 baseline; disabled while locked or busy', async () => {
    const v1 = { version: 1, exercises: [{ key: 'x', name: 'X', exercise_class: 'reps_only' }] };
    expect(byLabel(mount({ block: block({ baseline: v1 }) }).root, 'Tidy names')).toBeUndefined();
    const { root } = mount({ locked: true });
    press(root, 'Tidy names');
    expect(byLabel(root, 'Confirm tidy names').props.disabled).toBe(true);
  });

  test('controls are >=44dp with a button role and the visible label', async () => {
    const { root } = mount();
    press(root, 'Tidy names');
    for (const label of ['Tidy names', 'Cancel', 'Confirm tidy names']) {
      const node = root.findAll(i => i.props.accessibilityLabel === label && i.props.accessibilityRole === 'button')[0];
      expect(node).toBeDefined();
      const style = StyleSheet.flatten(node.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
    expect(texts(root)).toEqual(expect.arrayContaining(['Tidy names', 'Cancel', 'Confirm tidy names']));
  });

  test('renders in dark mode', async () => {
    const { root } = mount({}, DarkColors);
    press(root, 'Tidy names');
    expect(byLabel(root, 'Confirm tidy names')).toBeDefined();
  });
});

describe('block scoping', () => {
  test('switching blocks (parent re-keys by block id) resets the open review and any error', async () => {
    const el = (id) => (
      <ThemeContext.Provider value={{ colors: LightColors, mode: 'light', preference: 'light', setPreference: () => {} }}>
        <TidyRecoveryNamesAction key={id} block={block({ id })} weeks={weeks} notes={notes} onTidy={jest.fn()} />
      </ThemeContext.Provider>
    );
    let c;
    act(() => { c = render.create(el('rb1')); });
    press(c.root, 'Tidy names');
    expect(byLabel(c.root, 'Confirm tidy names')).toBeDefined();
    act(() => { c.update(el('rb2')); });
    expect(byLabel(c.root, 'Confirm tidy names')).toBeUndefined();
  });
});

describe('review snapshot and inventory', () => {
  test('Confirm submits the plan captured when the review opened, even after evidence changes', async () => {
    const el = (ns) => (
      <ThemeContext.Provider value={{ colors: LightColors, mode: 'light', preference: 'light', setPreference: () => {} }}>
        <TidyRecoveryNamesAction block={block()} weeks={weeks} notes={ns} onTidy={onTidy} />
      </ThemeContext.Provider>
    );
    const onTidy = jest.fn().mockResolvedValue({ ok: false, error: 'stale' });
    let c;
    act(() => { c = render.create(el(notes)); });
    press(c.root, 'Tidy names');
    await act(async () => { await byLabel(c.root, 'Confirm tidy names').props.onPress(); });
    const first = onTidy.mock.calls[0][0];
    act(() => { c.update(el([{ ...notes[0], raw_text: '-Squat 3x6-8, step up\n- 145 8\n', updated_at: 'later' }, notes[1]])); });
    await act(async () => { await byLabel(c.root, 'Confirm tidy names').props.onPress(); });
    expect(onTidy.mock.calls[1][0]).toEqual(first);
    press(c.root, 'Cancel');
    press(c.root, 'Tidy names');
    await act(async () => { await byLabel(c.root, 'Confirm tidy names').props.onPress(); });
    expect(onTidy.mock.calls[2][0].evidence).not.toBe(first.evidence);
  });

  test('lists already-clean occurrences and warmups', async () => {
    const ns = [notes[0], { id: 'n2', raw_text: '+WARMUP\n-Squat\n- 45 8\n+LIFT\n-Squat 3x8\n- 135 8\n', updated_at: STAMP }];
    const { root } = mount({ notes: ns });
    press(root, 'Tidy names');
    expect(hasText(root, 'Week 2: Squat (no change)')).toBe(true);
    expect(hasText(root, 'Warmups, never changed (1)')).toBe(true);
    expect(hasText(root, 'Week 2: Squat')).toBe(true);
  });
});

