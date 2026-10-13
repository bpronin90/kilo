// Compact default Recovery evidence with full context on demand (#1315): the %
// plus ONE caption, compact per-lift rows, one consistent collapsed counted
// disclosure for every per-exercise list, and every removed sentence preserved in
// an accessibility label, a scoped explainer (#1358) or a disclosure.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { PACE_STATUS } from '../lib/data/recoveryStrength';
import { _resetRecoverySnapshotStore } from '../lib/data/recoverySnapshot';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { paceCompact, paceText } from '../components/recovery/RecoveryStrengthLadder';
import { notScoredEntries } from '../components/recovery/RecoveryStrengthDisclosures';
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
  test('prints the number and `{N} of {M} lifts back · avg {avg}% · Week n` and no coverage, cohort, exclusion or routine prose', () => {
    const root = mount();
    const summary = host(root, 'recovery-strength-summary')[0];
    expect(summary.findAllByType('Text').map(t => t.props.children)).toEqual(['42%', 'total recovery', '2 of 4 lifts back · avg 85% · Week 3']);
    const all = texts(root).join(' | ');
    for (const gone of ['scored every week', 'In the average', 'baseline strength', 'Bars run 0', 'Not in the average', 'Left the average']) {
      expect(all).not.toContain(gone);
    }
    // The full wording is the label.
    const label = summary.props.accessibilityLabel;
    expect(label).toMatch(/^Week 3: 42% total recovery of Push Pull Legs baseline strength\. 2 of 4 lifts back, avg 85%, Week 3\./);
    expect(label).toContain('Consistent-cohort average (secondary): 85% across 2 lifts scored every week');
    expect(label).toContain('In the consistent cohort: Bench, Squat');
  });

  test('an empty strict cohort still shows the total (0% when nothing is back) and keeps the cohort reason in the label, not the explainer', () => {
    const root = mount({ notes: [NOTES[0], note('w1', '-Sled Push\n- 100 5'), ...NOTES.slice(2)], weeks: [wk(1)] });
    // #1318: nothing is back, so the total is a real 0% (not hidden by the empty strict cohort).
    expect(texts(root)).toContain('0 of 4 lifts back · avg 0% · Week 1');
    const reason = 'Consistent-cohort average (secondary): No lift has a strength score in every readable week yet, so there is no average.';
    expect(host(root, 'recovery-strength-summary')[0].props.accessibilityLabel).toContain(reason);
    tap(root, 'About total recovery');
    expect(texts(root).join(' ')).not.toContain(reason);
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

  // #1358/#1360: each explainer is scoped to the one visible thing beside it.
  const noteTexts = (root, id) => texts(host(root, id)[0]);

  test('the total-recovery explainer says what the percentage means and nothing else', () => {
    const root = mount();
    tap(root, 'About total recovery');
    expect(noteTexts(root, 'recovery-percent-note')).toEqual([
      'Total recovery compares your current strength with this block’s frozen baseline.',
      'It totals your eligible scored lifts: each lift’s best set as a share of its baseline best set.',
      'Lifts without comparable scored data may be left out.',
      'Training numbers only. Not a medical judgment. Only you end a Recovery block.',
    ]);
  });

  test('the total-recovery explainer carries no cohort-history dump, even with exclusions and drops', () => {
    const notes = [NOTES[0], NOTES[1], note('w2', 'x'.repeat(2_000_000)), NOTES[3]];
    const root = mount({ notes });
    tap(root, 'About total recovery');
    const joined = noteTexts(root, 'recovery-percent-note').join(' ');
    for (const off of [
      /cohort/i, /Bench|Squat|Deadlift|OHP/, /\d+ of \d+/, /Week \d/, /couldn’t be read/, /dropped|no longer/i,
      /Pace|~\d+ wk/, /Week bars|0–100/, /Baseline routine|Push Pull Legs|Started|05-01-2026/, /\d+%/,
    ]) expect(joined).not.toMatch(off);
    // The detail is still truthful where it always was: the summary's label.
    const snap = getRecoverySnapshot({ block: mkBlock(), weeks: WEEKS, notes });
    expect(snap.display.a11y).toContain('Week 2 couldn’t be read');
    for (const line of snap.display.detail) expect(joined).not.toContain(line.replace(/\.$/, ''));
  });

  test('the pace explainer sits in the Lifts list beside the visible pace and covers only pace', () => {
    const root = mount();
    expect(byLabel(root, 'About pace')).toBeUndefined();
    tap(root, 'Expand lifts');
    tap(root, 'About pace');
    const lines = noteTexts(root, 'recovery-pace-note');
    expect(lines).toEqual([
      'Pace is a best-case estimate if your recent weekly rate continues.',
      'It uses up to your last 4 scored weeks and needs at least 3 scored weeks.',
      '“~2 wk” means about two more Recovery weeks.',
    ]);
    const joined = lines.join(' ');
    expect(joined).not.toMatch(/Total recovery|Not a medical|Week bars|Baseline routine|\d+%/);
    const { total } = getRecoverySnapshot({ block: mkBlock(), weeks: WEEKS, notes: NOTES });
    if (total.pace && paceText(total.pace)) expect(joined).not.toContain(paceText(total.pace));
  });

  test('the week-by-week explainer is attached to the week bars and never mentions lift bars', () => {
    const root = mount();
    const titleRow = host(root, 'recovery-weeks-title-row')[0];
    expect(texts(titleRow)).toEqual(['Week by week']);
    expect(titleRow.findAll(n => n.props.accessibilityLabel === 'About the bar scale').length).toBeGreaterThan(0);
    tap(root, 'About the bar scale');
    const lines = noteTexts(root, 'recovery-scale-note');
    expect(lines).toEqual(['Week bars run 0–100%. 100% is your baseline: a full return to baseline strength.']);
    expect(lines.join(' ')).not.toMatch(/Lift bar|lift/i);
  });

  test('no info icon on block metadata or the lift bars; the old multi-topic note is gone', () => {
    const root = mount();
    for (const id of ['recovery-context-routine', 'recovery-context-date']) {
      expect(host(root, id)[0].findAll(n => n.props.accessibilityRole === 'button')).toHaveLength(0);
    }
    expect(byLabel(root, 'About these numbers')).toBeUndefined();
    expect(host(root, 'recovery-about-note')).toHaveLength(0);
    tap(root, 'Expand lifts');
    expect(root.findAll(n => /^About .*lift/i.test(n.props.accessibilityLabel || ''))).toHaveLength(0);
  });
});
