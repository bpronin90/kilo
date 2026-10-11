// Compact default Recovery evidence with full context on demand (#1315): the %
// plus ONE caption, compact per-lift rows, one consistent collapsed counted
// disclosure for every per-exercise list, and every removed sentence preserved in
// an accessibility label, the "About these numbers" explainer or a disclosure.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { PACE_STATUS } from '../lib/data/recoveryStrength';
import { _resetRecoverySnapshotStore } from '../lib/data/recoverySnapshot';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { paceCompact, paceText } from '../components/recovery/RecoveryStrengthLadder';
import { notScoredEntries } from '../components/recovery/RecoveryStrengthDisclosures';
import { numbersInfoLines } from '../components/recovery/RecoveryNumbersInfo';
import { getRecoverySnapshot } from '../lib/data/recoverySnapshot';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const BASE = '-Bench\n- 100 5\n-Squat\n- 100 5\n-Deadlift\n- 100 5\n-Plank: 2x45s\n- 45,45\n-Curl\n- 30 10';
const mkBlock = () => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'Push Pull Legs', baseline: captureRecoveryBaselineFromText(BASE),
  started_at: '2026-05-01T00:00:00Z', completed_at: null, saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', deleted_at: null,
});
const wk = (n) => ({ id: `rw${n}`, block_id: 'rb1', note_id: `w${n}`, week_number: n, completed_at: null, saved_at: '2026-05-08T00:00:00Z', updated_at: '2026-05-08T00:00:00Z', deleted_at: null });
const note = (id, raw_text) => ({ id, title: id, raw_text });
const NOTES = [
  note('nb', BASE),
  note('w1', '-Bench\n- 60 5\n-Squat\n- 60 5\n-Plank: 2x45s\n- 45,45'),
  note('w2', '-Bench\n- 70 5\n-Squat\n- 70 5\n-Plank: 2x45s\n- 45,45'),
  note('w3', '-Bench\n- 80 5\n-Squat\n- 90 5\n-Plank: 2x45s\n- 45,45'),
];
const WEEKS = [wk(1), wk(2), wk(3)];

const host = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
const texts = (root) => root.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
const byLabel = (root, l) => root.findAll(n => n.props && n.props.accessibilityLabel === l)[0];
const tap = (root, l) => act(() => { byLabel(root, l).props.onPress(); });
function mount(props = {}) {
  _resetRecoverySnapshotStore();
  let c;
  act(() => { c = render.create(<AnalyticsRecoverySection blocks={[mkBlock()]} weeks={WEEKS} notes={NOTES} {...props} />); });
  return c.root;
}

describe('summary: % plus one short caption', () => {
  test('prints the number and `{N} lifts · Week n` and no coverage, cohort, exclusion or routine prose', () => {
    const root = mount();
    const summary = host(root, 'recovery-strength-summary')[0];
    expect(summary.findAllByType('Text').map(t => t.props.children)).toEqual(['85%', '2 lifts · Week 3']);
    const all = texts(root).join(' | ');
    for (const gone of ['scored every week', 'In the average', 'baseline strength', 'Bars run 0', 'Not in the average', 'Left the average']) {
      expect(all).not.toContain(gone);
    }
    // The full wording is the label.
    const label = summary.props.accessibilityLabel;
    expect(label).toMatch(/^Week 3: 85% of Push Pull Legs baseline strength\./);
    expect(label).toContain('Average of 2 lifts scored every week');
    expect(label).toContain('In the average: Bench, Squat');
  });

  test('an unavailable or empty state keeps a short honest message and never a 0%', () => {
    const root = mount({ notes: [NOTES[0], note('w1', '-Sled Push\n- 100 5'), ...NOTES.slice(2)], weeks: [wk(1)] });
    expect(texts(root).some(t => /^\d+%$/.test(t))).toBe(false);
    expect(texts(root)).toContain('No lift has a strength score in every readable week yet, so there is no average.');
  });
});

describe('one consistent disclosure rule', () => {
  test('lifts, movement groups, not retested and not scored are all collapsed with counted headers', () => {
    const root = mount();
    for (const id of ['recovery-strength-lifts', 'recovery-movement-groups', 'recovery-strength-not-retested', 'recovery-strength-not-scored']) {
      const header = host(root, `${id}-header`)[0];
      expect(header).toBeDefined();
      expect(header.props.accessibilityRole).toBe('button');
      expect(header.props.accessibilityState).toEqual({ expanded: false });
    }
    expect(texts(root)).toContain('2 not retested');
    expect(texts(root)).toContain('1 not scored for strength');
    // Nothing per-exercise is on screen until asked.
    expect(host(root, 'recovery-strength-ladder')).toHaveLength(0);
    expect(host(root, 'recovery-exercise-row')).toHaveLength(0);
    expect(texts(root).join(' ')).not.toContain('Deadlift: not logged');
  });

  test('expanding shows the complete named lists with their reasons', () => {
    const root = mount();
    tap(root, 'Expand 2 not retested lifts');
    expect(texts(root)).toEqual(expect.arrayContaining(['Deadlift: not logged in any week yet', 'Curl: not logged in any week yet']));
    tap(root, 'Expand 1 lifts not scored for strength');
    expect(texts(root)).toContain('Plank: Timed work has no load and reps to score');
  });

  test('every disclosure resets to collapsed when the selected week changes', () => {
    const root = mount();
    tap(root, 'Expand 2 not retested lifts');
    act(() => { root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-strength-week-1' && n.props.onPress)[0].props.onPress(); });
    expect(byLabel(root, 'Expand 2 not retested lifts').props.accessibilityState).toEqual({ expanded: false });
  });

  test('one per-lift list: each lift appears once, with its strength % and raw evidence on demand', () => {
    const root = mount();
    expect(byLabel(root, 'Expand exercise details')).toBeUndefined();
    tap(root, 'Expand lifts');
    expect(host(root, 'recovery-strength-ladder')).toHaveLength(0);
    const rows = host(root, 'recovery-exercise-row');
    const names = rows.map(r => texts(r)[0]);
    expect(names.filter(n => n === 'Bench')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
    const bench = rows.find(r => texts(r)[0] === 'Bench');
    // Strength half is on the row; the raw load/work evidence is behind its tap.
    expect(host(bench, 'recovery-strength-lift-bench')).toHaveLength(1);
    expect(host(bench, 'recovery-exercise-detail')).toHaveLength(0);
    act(() => { root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-exercise-row' && n.props.onPress && texts(n)[0] === 'Bench')[0].props.onPress(); });
    const opened = host(root, 'recovery-exercise-row').find(r => texts(r)[0] === 'Bench');
    expect(host(opened, 'recovery-exercise-detail')).toHaveLength(1);
    expect(opened.props.accessibilityLabel).toMatch(/Load .* of baseline.*\. \d+% of baseline strength\. Best set/);
  });
});

describe('compact per-lift rows', () => {
  test('name, %, bar, one best/baseline line and a compact pace; full pace in the label', () => {
    const root = mount();
    tap(root, 'Expand lifts');
    const row = host(root, 'recovery-exercise-row').find(r => texts(r)[0] === 'Squat');
    expect(row.props.accessibilityLabel).toContain('Best set 90×5 lb vs baseline 100×5 lb');
    expect(row.props.accessibilityLabel).toContain('Best case, if your recent rate continues');
    const sets = host(root, 'recovery-strength-sets-squat')[0];
    expect([].concat(sets.props.children).join('')).toBe('90×5 / 100×5 lb');
    const pace = host(root, 'recovery-strength-pace-squat')[0];
    expect([].concat(pace.props.children).join('')).toMatch(/^90% reached · 100% ~\d+ wk$|^90% ~\d+ wk · 100% ~\d+ wk$/);
    // No verbose reason or cohort paragraph in the row.
    expect(texts(host(row, 'recovery-strength-lift-squat')[0]).join(' ')).not.toMatch(/Best case|Not in the average|Best set/);
  });

  test('every pace status has a compact form and a full explanation', () => {
    const t = (target, reached, weeks) => ({ target, reached, weeks });
    const cases = [
      [{ status: PACE_STATUS.ESTIMATE, gain: 5, from_week: 1, to_week: 3, targets: [t(90, true, null), t(100, false, 2)] }, '90% reached · 100% ~2 wk', /Best case.*Weeks 1–3/],
      [{ status: PACE_STATUS.ESTIMATE, gain: 5, from_week: 1, to_week: 3, targets: [t(90, false, 2), t(100, false, 4)] }, '90% ~2 wk · 100% ~4 wk', /90% in 2 weeks/],
      [{ status: PACE_STATUS.INSUFFICIENT, targets: [t(90, false, null), t(100, false, null)] }, 'need 3 wks', /Not enough weeks/],
      [{ status: PACE_STATUS.INSUFFICIENT, targets: [t(90, true, null), t(100, false, null)] }, '90% reached · need 3 wks', /90% reached\. Not enough weeks/],
      [{ status: PACE_STATUS.NO_GAIN, from_week: 1, to_week: 3, targets: [t(90, false, null), t(100, false, null)] }, 'no gain', /No forecast: no gain over Weeks 1–3/],
      [{ status: PACE_STATUS.REACHED, from_week: 1, to_week: 3, gain: 1, targets: [t(90, true, null), t(100, true, null)] }, 'reached', /Baseline reached/],
      [{ status: PACE_STATUS.SUPPRESSED }, 'pace hidden', /hidden until Recovery data is current/],
    ];
    for (const [pace, compact, full] of cases) {
      expect(paceCompact(pace)).toBe(compact);
      expect(paceText(pace)).toMatch(full);
    }
    expect(paceCompact({ status: PACE_STATUS.NO_CURRENT })).toBeNull();
  });
});

describe('not-scored identities are never hidden or double counted', () => {
  test('selected-week unscoreable lifts and baseline-level not_scored merge by key', () => {
    const strength = {
      lifts: [{ key: 'bench', name: 'Bench', state: 'unscoreable', reason: 'assisted' }, { key: 'squat', name: 'Squat', state: 'scored' }],
      not_scored: [{ key: 'plank', name: 'Plank', reason: 'time_based' }, { key: 'bench', name: 'Bench', reason: 'no_baseline_set' }],
    };
    const entries = notScoredEntries(strength);
    expect(entries.map(e => e.key)).toEqual(['bench', 'plank']);
    expect(entries[0].reason).toBe('Assisted sets are not scored as load');
  });
});

describe('movement groups and the explainer', () => {
  test('group rows print compact counts; the full wording is the row label', () => {
    const root = mount();
    tap(root, 'Expand movement groups');
    const row = host(root, 'movement-group-row-push')[0];
    expect(texts(row)).toContain('1/1 scored · 1 baseline');
    expect(row.props.accessibilityLabel).toContain('1 of 1 lift in the average scored · 1 lift in the baseline');
  });

  test('About these numbers carries the relocated dynamic context and the non-medical note', () => {
    const root = mount();
    tap(root, 'About these numbers');
    const all = texts(root);
    for (const line of [
      'Baseline routine: Push Pull Legs.',
      'Average of 2 lifts scored every week · 2 of 5 baseline lifts.',
      'In the average: Bench, Squat.',
      'Bars run 0–100%. The dark mark is your baseline (100%).',
      'Training numbers only. Not a medical judgment. Only you end a Recovery block.',
    ]) expect(all).toContain(line);
    expect(all.some(t => t.startsWith('Pace is a best-case estimate'))).toBe(true);
    expect(all.some(t => t.startsWith('Squat: '))).toBe(true);
  });

  test('exclusions and dropped lifts are in the explainer and the label, not the default view', () => {
    const notes = [NOTES[0], NOTES[1], note('w2', 'x'.repeat(2_000_000)), NOTES[3]];
    const snap = getRecoverySnapshot({ block: mkBlock(), weeks: WEEKS, notes });
    const lines = numbersInfoLines({ snapshot: snap, routineTitle: 'Push Pull Legs' });
    expect(lines.some(l => /Week 2 couldn’t be read and is left out of the comparison\./.test(l))).toBe(true);
    expect(snap.display.a11y).toContain('Week 2 couldn’t be read');
  });
});
