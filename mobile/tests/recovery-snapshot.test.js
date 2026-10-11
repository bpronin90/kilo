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
const homeHeadline = (root) => {
  const v = byId(root, 'home-recovery-headline-value')[0];
  const cap = byId(root, 'home-recovery-headline-caption')[0];
  return v ? `${v.props.children} | ${cap.props.children}` : null;
};
const overviewRow = (root) => byId(root, 'overview-probe')[0].props.row;
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
    expect(homeHeadline(root)).toBe('80% | 2 lifts · Week 2');
    expect(analyticsHeadline(root)).toBe('80% | 2 lifts · Week 2');
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

describe('identical values on every surface', () => {
  test('scored: the same % and caption on Home, the Overview row and the Analytics section', () => {
    const root = mount({ fixture: SCORED, stale: false }).root;
    expect(analyticsHeadline(root)).toBe('80% | 2 lifts · Week 2');
    expect(homeHeadline(root)).toBe('80% | 2 lifts · Week 2');
    const row = overviewRow(root);
    expect(`${row.value} | ${row.infoCaption}`).toBe('80% | 2 lifts · Week 2');
    expect(row.accessibilityText).toBe(analyticsSummary(root).props.accessibilityLabel);
  });

  test('stale: the numbers are unchanged and every surface still prints them', () => {
    const root = mount({ fixture: SCORED, stale: true }).root;
    expect(analyticsHeadline(root)).toBe('80% | 2 lifts · Week 2');
    expect(homeHeadline(root)).toBe('80% | 2 lifts · Week 2');
    expect(overviewRow(root).value).toBe('80%');
    expect(overviewRow(root).accessibilityText).toMatch(/may be out of date\.$/);
  });

  test.each([
    ['legacy baseline', LEGACY, SNAPSHOT_STATE.UNAVAILABLE],
    ['empty cohort', EMPTY_COHORT, SNAPSHOT_STATE.EMPTY],
  ])('%s: no surface fabricates a number, and the reason is the snapshot\'s own words', (_l, fixture, state) => {
    const snap = getRecoverySnapshot({ block: fixture.block, weeks: fixture.weeks, notes: fixture.notes });
    expect(snap.display.state).toBe(state);
    const root = mount({ fixture, stale: false }).root;
    expect(homeHeadline(root)).toBeNull();
    expect(analyticsHeadline(root)).toBeNull();
    const row = overviewRow(root);
    expect(row.value).toBeNull();
    expect(row.emptyCaption).toBe(snap.display.message);
    expect(analyticsSummary(root).props.accessibilityLabel).toContain(snap.display.message);
  });
});
