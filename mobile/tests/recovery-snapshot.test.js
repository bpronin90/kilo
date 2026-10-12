// One golden-sourced Recovery snapshot (#1315): Home's panel, the Analytics
// Overview `Recovery` row and the Analytics Recovery section all read the same
// snapshot. The derivation runs once per distinct input, and every surface prints
// identical headline values, including stale, legacy-baseline and empty-cohort.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { ACTIVE_TRAINING_STATUS } from '../lib/data/activeTrainingContext';
import {
  _resetRecoverySnapshotStore, _snapshotDerivationCount, getRecoverySnapshot, SNAPSHOT_STATE,
} from '../lib/data/recoverySnapshot';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

// Count the real derivations: strength and comparison are each wrapped, not replaced.
jest.mock('../lib/data/recoveryStrength', () => {
  const actual = jest.requireActual('../lib/data/recoveryStrength');
  return { ...actual, deriveRecoveryStrength: jest.fn(actual.deriveRecoveryStrength) };
});
jest.mock('../lib/data/recoveryAnalytics', () => {
  const actual = jest.requireActual('../lib/data/recoveryAnalytics');
  return { ...actual, deriveRecoveryComparison: jest.fn(actual.deriveRecoveryComparison) };
});

let mockStoreState;
jest.mock('../hooks/entries/recoveryBlockHooks', () => ({
  ...jest.requireActual('../hooks/entries/recoveryBlockHooks'),
  useRecoveryBlockState: () => mockStoreState,
}));

jest.mock('../lib/data/recoveryReturnBands', () => {
  const actual = jest.requireActual('../lib/data/recoveryReturnBands');
  return { ...actual, deriveRecoveryWeekBands: jest.fn(actual.deriveRecoveryWeekBands) };
});
const { deriveRecoveryWeekBands } = require('../lib/data/recoveryReturnBands');
const { deriveRecoveryStrength } = require('../lib/data/recoveryStrength');
const { deriveRecoveryComparison } = require('../lib/data/recoveryAnalytics');
const { AnalyticsRecoverySection } = require('../components/AnalyticsRecoverySection');
const { HomeRecoverySummary } = require('../screens/home/HomeRecoverySummary');
const { useHomeRecoverySummary } = require('../screens/home/homeDashboardData');
const { deriveOverviewRows } = require('../screens/analytics/analyticsDerivations');
const { useRecoverySnapshotFromState } = require('../hooks/entries/useRecoveryStrengthSnapshot');

const BASE = '-Bench\n- 100 5\n-Squat\n- 100 5';
const clone = (v) => JSON.parse(JSON.stringify(v));
const mkBlock = (baseline = captureRecoveryBaselineFromText(BASE)) => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'Push Pull Legs', baseline,
  started_at: '2026-05-01T00:00:00Z', completed_at: null, include_in_normal_analytics: false,
  saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', deleted_at: null,
});
const mkWeek = (n, note_id) => ({
  id: `rw${n}`, block_id: 'rb1', note_id, week_number: n, completed_at: null,
  saved_at: '2026-05-08T00:00:00Z', updated_at: '2026-05-08T00:00:00Z', deleted_at: null,
});
const note = (id, raw_text) => ({ id, title: `Note ${id}`, raw_text });

const SCORED = {
  block: mkBlock(), weeks: [mkWeek(1, 'w1'), mkWeek(2, 'w2')],
  notes: [note('nb', BASE), note('w1', '-Bench\n- 60 5\n-Squat\n- 60 5'), note('w2', '-Bench\n- 80 5\n-Squat\n- 80 5')],
};
const LEGACY = (() => {
  const snap = captureRecoveryBaselineFromText(BASE);
  const legacy = { ...snap, exercises: snap.exercises.map(({ best_e1rm_weight, best_e1rm_reps, ...r }) => r) };
  return { block: mkBlock(legacy), weeks: [mkWeek(1, 'w1')], notes: [note('nb', BASE), note('w1', '-Bench\n- 60 5')] };
})();
const EMPTY_COHORT = {
  block: mkBlock(), weeks: [mkWeek(1, 'w1')], notes: [note('nb', BASE), note('w1', '-Sled Push\n- 100 5,5')],
};

beforeEach(() => {
  _resetRecoverySnapshotStore();
  deriveRecoveryStrength.mockClear();
  deriveRecoveryComparison.mockClear();
  deriveRecoveryWeekBands.mockClear();
});

// Mounts Home + Overview + Analytics together, each fed its own copy of the data.
function Surfaces({ fixture, stale, fresh, notesError = null }) {
  const own = fresh ? { block: clone(fixture.block), weeks: clone(fixture.weeks), notes: clone(fixture.notes) } : fixture;
  mockStoreState = { blocks: [own.block], weeks: own.weeks, ready: true, loading: false, stale, activeBlock: own.block, retryRecovery: null };
  const home = useHomeRecoverySummary(own.notes);
  const overview = useRecoverySnapshotFromState(mockStoreState, own.notes, { notesError });
  const row = deriveOverviewRows({
    activeTraining: { status: ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK, recoveryWeekNumber: 2 },
    recoverySnapshot: overview.snapshot,
  }).find(r => r.key === 'recovery');
  // The Analytics section is handed ITS OWN equal-but-distinct arrays.
  const analytics = { block: clone(fixture.block), weeks: clone(fixture.weeks), notes: clone(fixture.notes) };
  return (
    <>
      <HomeRecoverySummary summary={home} onNavigate={() => {}} />
      {React.createElement('probe', { testID: 'home-summary-probe', summary: home })}
      <Probe row={row} />
      <AnalyticsRecoverySection blocks={[analytics.block]} weeks={analytics.weeks} notes={analytics.notes} stateStale={stale} notesError={notesError} />
    </>
  );
}
function Probe({ row }) { return React.createElement('probe', { testID: 'overview-probe', row }); }

const mount = (props) => {
  let c;
  act(() => { c = render.create(<Surfaces {...props} />); });
  return c;
};
const byId = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
// #1335: Home prints the shared total as one secondary line, without the caption.
const homeHeadline = (root) => {
  const v = byId(root, 'home-recovery-headline-value')[0];
  return v ? v.props.children : null;
};
const overviewRow = (root) => byId(root, 'overview-probe')[0].props.row;
// #1335: Home renders the Big 3 rows again — label, the carried-score week when
// older than the selected one, then the value — straight from the summary data.
const homeLift = (root, slot) => byId(root, 'home-summary-probe')[0].props.summary.big3.find(l => l.slot === slot);
const STATE_WORD = { not_in_baseline: 'Not in baseline', not_retested: 'Not retested', not_scored: 'Not scored', unknown: 'Unknown' };
const homeLiftTexts = (root, slot) => byId(root, `home-recovery-lift-${slot}`)[0]
  .findAll(n => n.type === 'Text').map(n => [].concat(n.props.children).join(''));
const homeLiftSpoken = (root, slot) => {
  const l = homeLift(root, slot);
  return l.spoken || `${l.label} ${STATE_WORD[l.state].toLowerCase()}`;
};
const analyticsSummary = (root) => byId(root, 'recovery-strength-summary')[0];
const analyticsHeadline = (root) => {
  const cap = byId(root, 'recovery-strength-caption')[0];
  if (!cap) return null;
  const pct = analyticsSummary(root).findAll(n => n.type === 'Text')[0].props.children;
  return `${pct} | ${cap.props.children}`;
};

describe('single derivation', () => {
  test.each([
    ['scored', SCORED, false],
    ['stale', SCORED, true],
    ['legacy baseline', LEGACY, false],
    ['empty cohort', EMPTY_COHORT, false],
  ])('%s: Home + Overview + Analytics derive strength and comparison exactly once', (_l, fixture, stale) => {
    mount({ fixture, stale });
    expect(deriveRecoveryStrength).toHaveBeenCalledTimes(1);
    expect(deriveRecoveryComparison).toHaveBeenCalledTimes(1);
    expect(_snapshotDerivationCount()).toBe(1);
  });

  test('re-rendering with new-but-equal arrays derives nothing again', () => {
    const c = mount({ fixture: SCORED, stale: false });
    act(() => { c.update(<Surfaces fixture={SCORED} stale={false} fresh />); });
    act(() => { c.update(<Surfaces fixture={SCORED} stale={false} fresh />); });
    expect(deriveRecoveryStrength).toHaveBeenCalledTimes(1);
    expect(deriveRecoveryComparison).toHaveBeenCalledTimes(1);
  });

  test('a notes-read error (carried by Overview/Analytics, not Home) never re-derives strength or the comparison', () => {
    const root = mount({ fixture: SCORED, stale: false, notesError: new Error('x') }).root;
    expect(deriveRecoveryStrength).toHaveBeenCalledTimes(1);
    expect(deriveRecoveryComparison).toHaveBeenCalledTimes(1);
    expect(_snapshotDerivationCount()).toBe(1);
    expect(homeHeadline(root)).toBe('80% total recovery');
    expect(analyticsHeadline(root)).toBe('80% | 2 of 2 lifts back · avg 80% · Week 2');
    expect(overviewRow(root).value).toBe('80%');
  });

  test('a real input change derives again, once', () => {
    const c = mount({ fixture: SCORED, stale: false });
    const changed = { ...SCORED, notes: SCORED.notes.map(n => (n.id === 'w2' ? note('w2', '-Bench\n- 90 5\n-Squat\n- 90 5') : n)) };
    act(() => { c.update(<Surfaces fixture={changed} stale={false} />); });
    expect(deriveRecoveryStrength).toHaveBeenCalledTimes(2);
  });

  test('the same input returns the very same frozen snapshot object', () => {
    const a = getRecoverySnapshot({ block: SCORED.block, weeks: SCORED.weeks, notes: SCORED.notes });
    const b = getRecoverySnapshot({ block: clone(SCORED.block), weeks: clone(SCORED.weeks), notes: clone(SCORED.notes) });
    expect(b).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    // "latest" and an explicit latest week id are one derivation.
    expect(getRecoverySnapshot({ block: SCORED.block, weeks: SCORED.weeks, notes: SCORED.notes, selectedWeekId: 'rw2' })).toBe(a);
  });
});

describe('cache key is collision-proof (#1315 review)', () => {
  // Two distinct valid workout texts whose 32-bit djb2 digest and length collide.
  const A = '-Bench\n- 405 12\n-Squat\n- 929 18';
  const B = '-Bench\n- 509 28\n-Squat\n- 807 20';
  test('replacing a week note with distinct same-length text returns that text\'s numbers', () => {
    expect(A).not.toBe(B);
    expect(A.length).toBe(B.length);
    const base = '-Bench\n- 100 5\n-Squat\n- 100 5';
    const block = mkBlock(captureRecoveryBaselineFromText(base));
    const weeks = [mkWeek(1, 'w1')];
    const at = (text) => getRecoverySnapshot({ block, weeks, notes: [note('nb', base), note('w1', text)] });
    const first = at(A);
    const second = at(B);
    expect(second).not.toBe(first);
    // The capped headline can coincide (both >100%); the factual per-lift scores cannot.
    expect(second.total.perLiftLatest.map(l => l.percent)).not.toEqual(first.total.perLiftLatest.map(l => l.percent));
    // And the first is still served for its own text.
    expect(at(A)).toBe(first);
  });

  test('every note field the derivation reads is part of the key (title, deletion, groups)', () => {
    const base = '-Bench\n- 100 5';
    const block = mkBlock(captureRecoveryBaselineFromText(base));
    const weeks = [mkWeek(1, 'w1')];
    const snap = (extra) => getRecoverySnapshot({ block, weeks, notes: [note('nb', base), { ...note('w1', '-Bench\n- 60 5'), ...extra }] });
    const plain = snap({});
    expect(snap({ title: 'Renamed' })).not.toBe(plain);
    expect(snap({ deleted_at: '2026-06-01T00:00:00Z' })).not.toBe(plain);
    const bn = { ...note('nb', base), exercise_movement_groups: { version: 1, overrides: { bench: 'legs' } } };
    expect(getRecoverySnapshot({ block, weeks, notes: [bn, note('w1', '-Bench\n- 60 5')] })).not.toBe(plain);
  });
});

describe('identical values on every surface', () => {
  test('Home Big 3 values equal the Analytics ladder values for the same block and week (#1315)', () => {
    const root = mount({ fixture: SCORED, stale: false }).root;
    act(() => { root.findAll(n => n.props && n.props.accessibilityLabel === 'Expand lifts')[0].props.onPress(); });
    const ladder = byId(root, 'recovery-exercise-row').map(n => n.props.accessibilityLabel).find(l => /^Squat, /.test(l));
    const homeValue = homeLiftTexts(root, 'squat');
    expect(ladder).toMatch(/80% of baseline strength/);
    expect(homeValue).toContain('80%');
    // The band-model words are gone from Home.
    expect(homeValue.join(' ')).not.toMatch(/Recovered|In progress|Not started/);
  });

  test('scored: the same % and caption on Home, the Overview row and the Analytics section', () => {
    const root = mount({ fixture: SCORED, stale: false }).root;
    expect(analyticsHeadline(root)).toBe('80% | 2 of 2 lifts back · avg 80% · Week 2');
    expect(homeHeadline(root)).toBe('80% total recovery');
    const row = overviewRow(root);
    expect(`${row.value} | ${row.infoCaption}`).toBe('80% | 2 of 2 lifts back · avg 80% · Week 2');
    expect(row.label).toBe('Total recovery');
    expect(byId(root, 'recovery-strength-label')[0].props.children).toBe('total recovery');
    expect(row.accessibilityText).toBe(analyticsSummary(root).props.accessibilityLabel);
  });

  test('stale: the numbers are unchanged and every surface still prints them', () => {
    const root = mount({ fixture: SCORED, stale: true }).root;
    expect(analyticsHeadline(root)).toBe('80% | 2 of 2 lifts back · avg 80% · Week 2');
    expect(homeHeadline(root)).toBe('80% total recovery');
    expect(overviewRow(root).value).toBe('80%');
    expect(overviewRow(root).accessibilityText).toMatch(/may be out of date\.$/);
  });

  test.each([
    ['legacy baseline', LEGACY, SNAPSHOT_STATE.UNAVAILABLE],
  ])('%s: no surface fabricates a number, and the reason is the snapshot\'s own words', (_l, fixture, state) => {
    const snap = getRecoverySnapshot({ block: fixture.block, weeks: fixture.weeks, notes: fixture.notes });
    expect(snap.display.state).toBe(state);
    const root = mount({ fixture, stale: false }).root;
    expect(homeHeadline(root)).toBeNull();
    // Home states the snapshot's own reason instead of staying silent.
    expect(byId(root, 'home-recovery-headline-reason')[0].props.children).toBe(snap.display.message);
    expect(analyticsHeadline(root)).toBeNull();
    const row = overviewRow(root);
    expect(row.value).toBeNull();
    expect(row.emptyCaption).toBe(snap.display.message);
    expect(analyticsSummary(root).props.accessibilityLabel).toContain(snap.display.message);
  });
});

describe('empty strict cohort no longer hides the total (#1318)', () => {
  test('0 of 2 lifts back is a real 0% total on every surface; the cohort reason is secondary detail', () => {
    const snap = getRecoverySnapshot({ block: EMPTY_COHORT.block, weeks: EMPTY_COHORT.weeks, notes: EMPTY_COHORT.notes });
    expect(snap.display.state).toBe(SNAPSHOT_STATE.SCORE);
    expect(snap.total.percent).toBe(0);
    expect(snap.display.detail.join(' ')).toMatch(/Consistent-cohort average \(secondary\): No lift has a strength score in every readable week/);
    const root = mount({ fixture: EMPTY_COHORT, stale: false }).root;
    const cap = '0 of 2 lifts back · avg 0% · Week 1';
    expect(homeHeadline(root)).toBe('0% total recovery');
    expect(analyticsHeadline(root)).toBe(`0% | ${cap}`);
    const row = overviewRow(root);
    expect(`${row.value} | ${row.infoCaption}`).toBe(`0% | ${cap}`);
  });
});

describe('Home Big 3 latest evidence and age (#1318)', () => {
  // Week 1 tested Squat at 100x3 (load ratio 100%, e1RM strength 94%); week 2 skipped it.
  const AGED = {
    block: mkBlock(), weeks: [mkWeek(1, 'w1'), mkWeek(2, 'w2')],
    notes: [note('nb', BASE), note('w1', '-Bench\n- 100 5\n-Squat\n- 100 3'), note('w2', '-Bench\n- 100 5')],
  };
  const texts = (n) => n.findAll(x => x.type === 'Text').map(x => [].concat(x.props.children).join(''));

  test('an absent lift keeps its earlier strength % with the week it was last tested', () => {
    const root = mount({ fixture: AGED, stale: false }).root;
    expect(homeLiftTexts(root, 'squat')).toEqual(['Squat', 'Week 1', '94%']);
    expect(homeLiftSpoken(root, 'squat')).toContain('Squat 94% of baseline, last tested Week 1');
  });

  test('Home displays the strength percent, which differs from its comparison/load ratio', () => {
    const snap = getRecoverySnapshot({ block: AGED.block, weeks: AGED.weeks, notes: AGED.notes, selectedWeekId: 'rw1' });
    const squat = snap.selectedWeek.exercises.find(e => e.key === 'squat');
    expect(squat.metrics.find(m => m.metric === 'top_load').percent).toBe(100);
    const root = mount({ fixture: { ...AGED, weeks: [AGED.weeks[0]] }, stale: false }).root;
    const value = homeLiftTexts(root, 'squat');
    expect(value).toContain('94%');
    expect(value).not.toContain('100%');
  });

  test('all three surfaces print the identical total and caption', () => {
    const root = mount({ fixture: AGED, stale: false }).root;
    const snap = getRecoverySnapshot({ block: AGED.block, weeks: AGED.weeks, notes: AGED.notes });
    expect(snap.total.perLiftLatest.map(l => [l.key, l.week])).toEqual([['bench', 2], ['squat', 1]]);
    const cap = snap.display.caption;
    expect(homeHeadline(root)).toBe(snap.display.headline);
    expect(analyticsHeadline(root)).toBe(`${snap.display.percent}% | ${cap}`);
    expect(overviewRow(root).infoCaption).toBe(cap);
    expect(overviewRow(root).value).toBe(`${snap.display.percent}%`);
    expect(deriveRecoveryStrength).toHaveBeenCalledTimes(1);
  });
});

describe('Home Big 3 under unreadable history (#1318 review)', () => {
  const texts = (n) => n.findAll(x => x.type === 'Text').map(x => [].concat(x.props.children).join(''));
  test('a missing selected note still shows the carried Big 3 score with its age', () => {
    const fixture = {
      block: mkBlock(), weeks: [mkWeek(1, 'w1'), mkWeek(2, 'ghost')],
      notes: [note('nb', BASE), note('w1', '-Squat\n- 60 5')],
    };
    const root = mount({ fixture, stale: false }).root;
    expect(homeLiftTexts(root, 'squat')).toEqual(['Squat', 'Week 1', '60%']);
    expect(homeLiftSpoken(root, 'squat')).toContain('Squat 60% of baseline, last tested Week 1');
  });

  test('a lift whose only possible score is in an unreadable week is Unknown, not Not retested', () => {
    const fixture = {
      block: mkBlock(), weeks: [mkWeek(1, 'ghost'), mkWeek(2, 'w2')],
      notes: [note('nb', BASE), note('w2', '-Bench\n- 100 5')],
    };
    const root = mount({ fixture, stale: false }).root;
    const row = homeLiftTexts(root, 'squat');
    expect(row).toContain('Unknown');
    expect(row).not.toContain('Not retested');
    expect(homeLiftSpoken(root, 'squat')).toContain('Squat unknown, a week that can’t be read may hold its score');
  });
});

describe('strict cohort history stays available (#1318 review)', () => {
  test('the cohort average of every readable week is in the explainer text and the label', () => {
    const snap = getRecoverySnapshot({
      block: mkBlock(), weeks: [mkWeek(1, 'w1'), mkWeek(2, 'w2')],
      notes: [note('nb', BASE), note('w1', '-Bench\n- 60 5\n-Squat\n- 100 5'), note('w2', '-Bench\n- 70 5')],
    });
    expect(snap.strength.cohort.map(c => c.name)).toEqual(['Bench']);
    const line = 'Consistent-cohort average by week: Week 1 60% · Week 2 70%';
    expect(snap.display.detail).toContain(line);
    expect(snap.display.a11y).toContain(line);
  });
});

// One precedence per Big 3 lift (#1318), computed in the snapshot and only rendered by Home:
//  1 score in any week <= selected -> latest %, "Week k" beside it when older, caveat if an
//    unreadable week AFTER it might hold a newer score
//  2 else an unreadable week in range -> Unknown (+ "logged this week without a scoreable set")
//  3 else logged but never scoreable -> Not scored (+ reason)   4 else -> Not retested
//  + Not in baseline when the slot's lift is not a baseline row.
describe('Home Big 3 status precedence, exhaustive (#1318)', () => {
  const SCORE = '-Bench\n- 100 5\n-Squat\n- 60 5';
  const OTHER = '-Bench\n- 100 5';
  const UNSC = '-Bench\n- 100 5\n-Squat\n- 5,5';
  const texts = (n) => n.findAll(x => x.type === 'Text').map(x => [].concat(x.props.children).join(''));
  const combos = [];
  for (const score of ['selected', 'earlier', 'none']) {
    for (const unreadable of ['none', 'earlier', 'selected']) {
      for (const unscoreable of [false, true]) {
        for (const inBaseline of [true, false]) {
          // One lift cannot both score and be unscoreable in the same week, and an
          // unreadable selected week has no readable work at all.
          if (score === 'selected' && unscoreable) continue;
          if (unreadable === 'selected' && (score === 'selected' || unscoreable)) continue;
          combos.push([score, unreadable, unscoreable, inBaseline]);
        }
      }
    }
  }

  const expected = (score, unreadable, unscoreable, inBaseline) => {
    if (!inBaseline) return { visible: ['Squat', 'Not in baseline'], spoken: 'Squat not in baseline' };
    if (score !== 'none') {
      const afterScore = (unreadable === 'selected') || (unreadable === 'earlier' && score === 'earlier');
      return {
        visible: score === 'earlier' ? ['Squat', 'Week 1', '60%'] : ['Squat', '60%'],
        spoken: `Squat 60% of baseline${score === 'earlier' ? ', last tested Week 1' : ''}${afterScore ? ', a week that can’t be read may hold a newer score' : ''}`,
      };
    }
    if (unreadable !== 'none') {
      return {
        visible: ['Squat', 'Unknown'],
        spoken: `Squat unknown, a week that can’t be read may hold its score${unscoreable ? ', and it logged this week without a scoreable set' : ''}`,
      };
    }
    if (unscoreable) return { visible: ['Squat', 'Not scored'], spoken: /^Squat not scored, .+/ };
    return { visible: ['Squat', 'Not retested'], spoken: 'Squat not retested' };
  };

  test.each(combos)('score:%s unreadable:%s unscoreable:%s inBaseline:%s', (score, unreadable, unscoreable, inBaseline) => {
    const base = inBaseline ? BASE : OTHER;
    const w1 = score === 'earlier' ? SCORE : OTHER;
    const w3 = unreadable === 'selected' ? null : score === 'selected' ? SCORE : unscoreable ? UNSC : OTHER;
    const fixture = {
      block: mkBlock(captureRecoveryBaselineFromText(base)),
      weeks: [mkWeek(1, 'w1'), mkWeek(2, unreadable === 'earlier' ? 'ghost' : 'w2'), mkWeek(3, w3 === null ? 'ghost' : 'w3')],
      notes: [note('nb', base), note('w1', w1), note('w2', OTHER), ...(w3 === null ? [] : [note('w3', w3)])],
    };
    // Squat must be in the baseline exactly when inBaseline (so the slot's lift is a baseline row).
    const root = mount({ fixture, stale: false }).root;
    const want = expected(score, unreadable, unscoreable, inBaseline);
    expect(homeLiftTexts(root, 'squat')).toEqual(want.visible);
    const clean = homeLiftSpoken(root, 'squat');
    if (want.spoken instanceof RegExp) expect(clean).toMatch(want.spoken); else expect(clean).toBe(want.spoken);
  });

  test('the table covers every possible combination', () => {
    expect(combos.length).toBe(24);
  });
});

describe('display components never derive (#1315 review)', () => {
  test('expanding Lifts, opening every row, collapsing and reopening derives no bands, strength or comparison', () => {
    const root = mount({ fixture: SCORED, stale: false }).root;
    const bands = deriveRecoveryWeekBands.mock.calls.length;
    const strength = deriveRecoveryStrength.mock.calls.length;
    const comparison = deriveRecoveryComparison.mock.calls.length;
    const press = (pred) => act(() => { root.findAll(pred)[0].props.onPress(); });
    press(n => n.props && n.props.accessibilityLabel === 'Expand lifts');
    root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-exercise-row' && n.props.onPress)
      .forEach(n => act(() => { n.props.onPress(); }));
    press(n => n.props && n.props.accessibilityLabel === 'Collapse lifts');
    press(n => n.props && n.props.accessibilityLabel === 'Expand lifts');
    expect(deriveRecoveryWeekBands.mock.calls.length).toBe(bands);
    expect(deriveRecoveryStrength.mock.calls.length).toBe(strength);
    expect(deriveRecoveryComparison.mock.calls.length).toBe(comparison);
    // The whole mounted tree (Home + Overview + Analytics) derived bands only
    // inside the snapshot's one build (selected week + one per detail row).
    expect(bands).toBeLessThanOrEqual(1 + 2);
  });

  test('no production component, screen or hook imports a Recovery derive/summarize function', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const FORBIDDEN = /\b(deriveRecoveryComparison|deriveRecoveryStrength|deriveRecoveryWeekBands|deriveRecoveryMovement|deriveRecoveryTrainedRows|deriveRecoveryBandSeries|deriveMovementGroupBreakdown|summarizeRecoveryBands)\b/;
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (
      e.isDirectory() ? walk(path.join(dir, e.name)) : /\.js$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const offenders = [];
    for (const dir of ['components', 'screens', 'hooks']) {
      for (const file of walk(path.join(root, dir))) {
        const src = fs.readFileSync(file, 'utf8');
        // Only real import/require statements count; prose comments may name them.
        const imports = src.match(/import[^;]*?from\s+['"][^'"]+['"];|require\([^)]*\)/g) || [];
        if (imports.some(i => FORBIDDEN.test(i))) offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the row status words cover exactly the snapshot\'s status kinds', () => {
    const { ROW_STATUS_KINDS } = require('../lib/data/recoverySnapshot');
    expect([...ROW_STATUS_KINDS]).toEqual(['at_or_above', 'rebuilding', 'early', 'cannot_compare', 'not_trained_yet', 'added']);
  });
});
