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
    expect(texts(root)).toEqual(expect.arrayContaining(['Not logged in any week yet · 2 lifts', 'Deadlift', 'Curl']));
    tap(root, 'Expand 1 lifts not scored for strength');
    expect(texts(root)).toEqual(expect.arrayContaining(['Timed work has no load and reps to score · 1 lift', 'Plank']));
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
    expect(texts(row)).toContain('1 of 1 scored · 1 in baseline');
    expect(row.props.accessibilityLabel).toContain('1 of 1 lift in the average scored · 1 lift in the baseline');
  });

  // #1358/#1360: each explainer is scoped to the one visible thing beside it.
  const noteTexts = (root, id) => texts(host(root, id)[0]);

  test('the total-recovery explainer says what the percentage means and nothing else', () => {
    const root = mount();
    tap(root, 'About total recovery');
    expect(noteTexts(root, 'recovery-percent-note')).toEqual([
      'Total recovery compares your current strength with this block’s frozen baseline.',
      'It averages every baseline lift that can be scored for strength: each lift’s latest best set as a share of its baseline best set. A lift with no score yet counts as zero.',
      'Lifts with no load-and-reps baseline set, like timed or bodyweight work, are left out.',
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

// ── #1537: nested groups, reason lists, large complete lists ─────────────────

const StyleSheetFlat = (n) => require('react-native').StyleSheet.flatten(n.props.style) || {};
const press = (root, id) => act(() => { root.findAll(n => typeof n.type !== 'string' && n.props.testID === id && n.props.onPress)[0].props.onPress(); });
const flat = (n) => [].concat(n.props.children).join('');

// 40 baseline lifts "Lift 01".."Lift 40" plus a bodyweight Pull-up and a timed Plank.
const LIFT_NAMES = Array.from({ length: 40 }, (_, i) => `Lift ${String(i + 1).padStart(2, '0')}`);
const BIG_BASE = `${LIFT_NAMES.map(n => `-${n}\n- 100 5`).join('\n')}\n-Pull-up\n- 8,8\n-Plank: 2x45s\n- 45,45`;
const wlog = (names2, w = 80) => names2.map(n => `-${n}\n- ${w} 5`).join('\n');
function mountBig(weekTexts, { numbers = null, extra = {} } = {}) {
  const block = { ...mkBlock(), baseline: captureRecoveryBaselineFromText(BIG_BASE) };
  const ns = [note('nb', BIG_BASE), ...weekTexts.map((t, i) => note(`bw${i + 1}`, t))].filter((n2, i) => i === 0 || n2.raw_text !== null);
  const ws = weekTexts.map((_, i) => ({ ...wk(i + 1), id: `bw${i + 1}`, note_id: `bw${i + 1}`, week_number: numbers ? numbers[i] : i + 1 }));
  return mount({ blocks: [block], weeks: ws, notes: ns, ...extra });
}
const itemNames = (root, reasonId) => host(root, `recovery-reason-${reasonId}`)[0]
  .findAll(n => typeof n.type === 'string' && /^recovery-reason-item-/.test(n.props.testID || '')).map(flat);

describe('reason-grouped exercise lists (#1537)', () => {
  test('a large complete never-logged list shows every exercise, in baseline order, one per line, with no truncation', () => {
    const root = mountBig([wlog(LIFT_NAMES.slice(0, 10))]);
    // 30 untouched scoreable lifts + 0 others (Pull-up / Plank are not retested too: 32).
    tap(root, 'Expand 32 not retested lifts');
    const heading = host(root, 'recovery-reason-heading-retest-never_logged')[0];
    expect(flat(heading)).toBe('Not logged in any week yet · 32 lifts');
    const listed = itemNames(root, 'retest-never_logged');
    expect(listed).toEqual([...LIFT_NAMES.slice(10), 'Pull-up', 'Plank']);
    expect(host(root, 'recovery-reason-retest-never_logged')[0].props.accessibilityLabel).toBe('Not logged in any week yet: 32 lifts');
    expect(host(root, 'recovery-reason-retest-never_logged')[0].props.accessibilityRole).toBe('list');
    // No ellipsis cap and no comma-joined paragraph anywhere in the list.
    for (const item of host(root, 'recovery-reason-item-lift 40')) expect(item.props.numberOfLines).toBeUndefined();
    expect(texts(root).some(t => t.includes('Lift 11, Lift 12'))).toBe(false);
    expect(itemNames(root, 'retest-never_logged')).toContain('Lift 40');
  });

  test('absent-this-week and never-logged are separate headings with their own counts and members', () => {
    const root = mountBig([wlog(LIFT_NAMES.slice(0, 10)), wlog(LIFT_NAMES.slice(0, 4))]);
    tap(root, 'Expand 38 not retested lifts');
    expect(flat(host(root, 'recovery-reason-heading-retest-absent_this_week')[0])).toBe('Not logged this week · 6 lifts');
    expect(itemNames(root, 'retest-absent_this_week')).toEqual(LIFT_NAMES.slice(4, 10));
    expect(flat(host(root, 'recovery-reason-heading-retest-never_logged')[0])).toBe('Not logged in any week yet · 32 lifts');
    expect(itemNames(root, 'retest-never_logged')).toEqual([...LIFT_NAMES.slice(10), 'Pull-up', 'Plank']);
  });

  test('an unreadable earlier week turns never-logged into "Not in any readable week"', () => {
    // Week 1 has no note, so a "never" claim cannot be made for lifts missing from week 2.
    const root = mountBig([null, wlog(LIFT_NAMES.slice(0, 3))]);
    tap(root, 'Expand 39 not retested lifts');
    expect(flat(host(root, 'recovery-reason-heading-retest-unknown')[0])).toBe('Not in any readable week · 39 lifts');
    expect(host(root, 'recovery-reason-heading-retest-never_logged')).toHaveLength(0);
    expect(itemNames(root, 'retest-unknown')).toHaveLength(39);
  });

  test('every unscoreable reason gets its own heading and its members', () => {
    const root = mountBig([`${wlog(LIFT_NAMES.slice(0, 3))}\n-Lift 04\n- 10,10`]);
    // Plank + Pull-up are baseline-level; Lift 04 changed class this week.
    tap(root, 'Expand 3 lifts not scored for strength');
    expect(flat(host(root, 'recovery-reason-heading-unscored-class_changed')[0])).toBe('Logged without load this week · 1 lift');
    expect(itemNames(root, 'unscored-class_changed')).toEqual(['Lift 04']);
    expect(itemNames(root, 'unscored-reps_only')).toEqual(['Pull-up']);
    expect(itemNames(root, 'unscored-time_based')).toEqual(['Plank']);
    expect(host(root, 'recovery-reason-unscored-time_based')[0].props.accessibilityLabel).toBe('Timed work has no load and reps to score: 1 lift');
  });

  test('the lists collapse again and the counts do not change when the week changes', () => {
    const root = mountBig([wlog(LIFT_NAMES.slice(0, 10)), wlog(LIFT_NAMES.slice(0, 4))]);
    tap(root, 'Expand 38 not retested lifts');
    act(() => { root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-strength-week-1' && n.props.onPress)[0].props.onPress(); });
    expect(byLabel(root, 'Expand 32 not retested lifts').props.accessibilityState).toEqual({ expanded: false });
    expect(host(root, 'recovery-reason-heading-retest-absent_this_week')).toHaveLength(0);
    tap(root, 'Expand 32 not retested lifts');
    expect(itemNames(root, 'retest-never_logged')).toEqual([...LIFT_NAMES.slice(10), 'Pull-up', 'Plank']);
  });

  test('stale state keeps the lists and their reasons (no claim is added or dropped)', () => {
    const root = mountBig([wlog(LIFT_NAMES.slice(0, 10))], { extra: { stateStale: true } });
    tap(root, 'Expand 32 not retested lifts');
    expect(itemNames(root, 'retest-never_logged')).toHaveLength(32);
  });
});

describe('Lifts caption (#1537)', () => {
  test('says what is scored for strength and how many lifts the details hold', () => {
    const root = mountBig([wlog(LIFT_NAMES.slice(0, 11))]);
    const caption = texts(host(root, 'recovery-strength-lifts-header')[0]);
    expect(caption).toContain('11 scored for strength · 42 lifts in details');
    expect(byLabel(root, 'Expand lifts')).toBeDefined();
  });
});

describe('nested movement groups (#1537)', () => {
  const MG_BASE = '-Bench\n- 100 5\n-Incline Bench Press\n- 100 5\n-Squat\n- 100 5\n-Curl\n- 30 10\n-Plank: 2x45s\n- 45,45';
  function mountMG(weekTexts, props = {}) {
    const block = { ...mkBlock(), baseline: captureRecoveryBaselineFromText(MG_BASE) };
    const ns = [note('nb', MG_BASE), ...weekTexts.map((t, i) => note(`mw${i + 1}`, t))];
    const ws = weekTexts.map((_, i) => ({ ...wk(i + 1), id: `mw${i + 1}`, note_id: `mw${i + 1}` }));
    return mount({ blocks: [block], weeks: ws, notes: ns, ...props });
  }

  test('groups are quieter than the top-level header, indented, and independently operable', () => {
    const root = mountMG(['-Bench\n- 80 5\n-Squat\n- 60 5']);
    tap(root, 'Expand movement groups');
    const group = host(root, 'movement-group-push')[0];
    const header = StyleSheetFlat(host(root, 'recovery-movement-groups-header')[0]);
    const titleStyle = StyleSheetFlat(host(root, 'recovery-movement-groups')[0].findAllByType('Text')[0]);
    const nameStyle = StyleSheetFlat(group.findAllByType('Text')[0]);
    expect(nameStyle.fontWeight).toBe('600');
    expect(titleStyle.fontWeight).toBe('700');
    expect(StyleSheetFlat(group).marginLeft).toBeGreaterThan(0);
    expect(StyleSheetFlat(group).borderLeftWidth).toBeGreaterThan(0);
    expect(header.minHeight).toBeGreaterThanOrEqual(44);
    expect(StyleSheetFlat(host(root, 'movement-group-row-push')[0]).minHeight).toBeGreaterThanOrEqual(44);
    // Opening one group does not open another; each is independently operable.
    press(root, 'movement-group-row-push');
    expect(host(root, 'movement-group-exercise-bench')).toHaveLength(1);
    expect(host(root, 'movement-group-exercise-squat')).toHaveLength(0);
    press(root, 'movement-group-row-legs');
    expect(host(root, 'movement-group-exercise-squat')).toHaveLength(1);
    press(root, 'movement-group-row-push');
    expect(host(root, 'movement-group-exercise-bench')).toHaveLength(0);
    expect(host(root, 'movement-group-exercise-squat')).toHaveLength(1);
  });

  test('mixed scored and unscored: values align, missing scores are "No score" never 0%, labels carry the counts', () => {
    const root = mountMG(['-Bench\n- 80 5\n-Squat\n- 60 5']);
    tap(root, 'Expand movement groups');
    expect(host(root, 'movement-group-value-push')[0].props.children).toBe('80%');
    expect(host(root, 'movement-group-value-legs')[0].props.children).toBe('60%');
    expect(host(root, 'movement-group-value-arms')[0].props.children).toBe('No score');
    expect(host(root, 'movement-group-value-core')[0].props.children).toBe('No score');
    expect(texts(host(root, 'movement-group-row-arms')[0])).toEqual(['Arms', 'None scored · 1 in baseline', 'No score']);
    expect(texts(host(root, 'movement-group-row-push')[0])).toEqual(['Push', '1 of 1 scored · 2 in baseline', '80%']);
    expect(host(root, 'movement-group-row-push')[0].props.accessibilityLabel).toBe('Push: 80% of baseline strength. 1 of 1 lift in the average scored · 2 lifts in the baseline.');
    expect(host(root, 'movement-group-row-arms')[0].props.accessibilityLabel).toMatch(/^Arms: no score\./);
    expect(texts(root).join('|')).not.toMatch(/\b0%/);
    // The group chevrons do not overlap the value: value box is fixed-width and right aligned.
    expect(StyleSheetFlat(host(root, 'movement-group-value-push')[0]).minWidth).toBeGreaterThan(0);
    expect(StyleSheetFlat(host(root, 'movement-group-value-arms')[0]).minWidth).toBeGreaterThan(0);
  });

  test('exercise rows: name, strength value, bar, status, in the snapshot order, with accessible labels', () => {
    const root = mountMG(['-Bench\n- 80 5\n-Squat\n- 60 5']);
    tap(root, 'Expand movement groups');
    press(root, 'movement-group-row-push');
    const ids = host(root, 'movement-group-push')[0].findAll(n => typeof n.type === 'string' && /^movement-group-exercise-(?!value)/.test(n.props.testID || '')).map(n => n.props.testID);
    expect(ids).toEqual(['movement-group-exercise-bench', 'movement-group-exercise-incline bench press']);
    const bench = host(root, 'movement-group-exercise-bench')[0];
    expect(texts(bench)).toEqual(['Bench', '80%', 'In the average · Automatic']);
    expect(bench.props.accessibilityLabel).toBe('Bench: 80% of baseline strength. In the average. Automatic.');
    expect(StyleSheetFlat(bench.findAll(n => n.props.style && StyleSheetFlat(n).width === '80%')[0]).width).toBe('80%');
    const ohp = host(root, 'movement-group-exercise-incline bench press')[0];
    expect(texts(ohp)).toEqual(['Incline Bench Press', 'No score', 'Not in the average · Automatic']);
    expect(ohp.props.accessibilityLabel).toBe('Incline Bench Press: no score. Not in the average. Automatic.');
    expect(ohp.findAll(n => n.props.style && StyleSheetFlat(n).height === 6)).toHaveLength(0);
  });

  test('block/week switch collapses nested groups', () => {
    const root = mountMG(['-Bench\n- 80 5', '-Bench\n- 90 5']);
    tap(root, 'Expand movement groups');
    press(root, 'movement-group-row-push');
    expect(host(root, 'movement-group-exercise-bench')).toHaveLength(1);
    act(() => { root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-strength-week-1' && n.props.onPress)[0].props.onPress(); });
    expect(host(root, 'recovery-movement-groups')[0]).toBeDefined();
    expect(host(root, 'movement-group-push')).toHaveLength(0);
    expect(host(root, 'movement-group-exercise-bench')).toHaveLength(0);
  });

  test('stale evidence keeps the group numbers and never shows a missing score as 0%', () => {
    const root = mountMG(['-Bench\n- 80 5'], { stateStale: true });
    tap(root, 'Expand movement groups');
    expect(host(root, 'movement-group-value-arms')[0].props.children).toBe('No score');
    expect(host(root, 'movement-group-value-push')[0].props.children).toBe('80%');
  });
});

describe('raw detail expansion keeps raw evidence (#1537)', () => {
  test('a lift row still opens its raw Load vs baseline and total work evidence', () => {
    const root = mount();
    tap(root, 'Expand lifts');
    act(() => { root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-exercise-row' && n.props.onPress && texts(n)[0] === 'Squat')[0].props.onPress(); });
    const opened = host(root, 'recovery-exercise-row').find(r => texts(r)[0] === 'Squat');
    expect(host(opened, 'recovery-exercise-detail')).toHaveLength(1);
    expect(opened.props.accessibilityLabel).toMatch(/Load .* of baseline/);
    expect(opened.props.accessibilityLabel).toMatch(/\d+% of baseline strength/);
  });
});
