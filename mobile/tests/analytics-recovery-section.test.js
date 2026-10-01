// Analytics Recovery section (#698): renders the #697 return-to-baseline
// contract for active/completed recovery blocks. Verifies hero count,
// weighted Load/Total work rows, reps-only rows, added-during-recovery
// separation, week selection, >100% visibility, unavailable/error states,
// history collapse, and accessible labels.
//
// #758: exercise details are collapsed by default behind an "Exercise details"
// disclosure, so most row-level assertions expand the panel first via
// `expandDetails`.
//
// #793 (R5b): Recovery moved above Fatigue on the Analytics tab (covered in
// analytics-screen.test.js), the "Baseline routine" label/title pair and the
// `blockMeta` line were replaced by a one-line identity caption and a
// provenance-only last line, the status-filter chip row was removed in favor
// of counted, `accessibilityRole="header"` state groups that always show every
// row, and no-week/note-missing/note-unreadable copy now matches Home's R3a
// wording exactly.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { MAX_RAW_TEXT_LENGTH } from '../lib/parser/workoutNote';
import {
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
  RECOVERY_COMPARISON_STATES,
  RECOVERY_UNAVAILABLE_REASONS,
  deriveRecoveryComparison,
} from '../lib/data/recoveryAnalytics';
import { DarkColors, HardCourtLightColors, LightColors } from '../theme/colors';
import { ThemeContext } from '../theme/ThemeContext';

// Controllable window metrics for the week picker's width/font-scale sizing
// (#1219). RN's jest default reports fontScale 2, which would force every
// picker into its large-font fallback.
let mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
});

// The synthetic-fixture states (timed exercises, Rebuilding, Not comparable,
// and an empty-but-supported baseline) are not reachable through the real
// note-text grammar today — mobile/lib/parser has no duration syntax, and
// `deriveRecoveryComparison` derives every other state from real work, not a
// hand-picked shortfall. Mocking the derivation layer (kept real by default,
// via `jest.fn(actual)`) lets these component-level tests supply the exact
// comparison shape #697 already guarantees, without re-testing #697's own
// calculation contract.
jest.mock('../lib/data/recoveryAnalytics', () => {
  const actual = jest.requireActual('../lib/data/recoveryAnalytics');
  return { ...actual, deriveRecoveryComparison: jest.fn(actual.deriveRecoveryComparison) };
});

// Baseline: Bench (weighted) top load 135 / volume 2025, Pull-up (reps-only)
// total reps 24.
const BASELINE_TEXT = '-Bench\n- 135 5,5,5\n-Pull-up\n- 8,8,8';

function block(overrides = {}) {
  return {
    id: 'rb1',
    baseline_note_id: 'note-baseline',
    baseline_note_title: 'Push Pull Legs',
    baseline: captureRecoveryBaselineFromText(BASELINE_TEXT),
    started_at: '2026-05-01T00:00:00Z',
    completed_at: null,
    saved_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function week(week_number, note_id, overrides = {}) {
  return {
    id: `rw${week_number}`,
    block_id: 'rb1',
    note_id,
    week_number,
    completed_at: null,
    saved_at: '2026-05-08T00:00:00Z',
    updated_at: '2026-05-08T00:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function note(id, raw_text, title = null) {
  return { id, title: title ?? `Note ${id}`, raw_text };
}

function metricRow(metric, current, baseline, percent, met) {
  return { metric, current, baseline, ratio: baseline ? current / baseline : null, percent, met };
}

function mockRow({ key, name, state, exercise_class, metrics = [], unmet = [], unavailable_reason = null }) {
  return {
    key, name, week_name: name, week_exercise_class: exercise_class, exercise_class,
    baseline_sets_completed: 3, state, metrics, unmet, sets_completed: 3, unavailable_reason,
  };
}

function mockWeek({ week_id = 'rw1', week_number = 1, note_id = 'note-1', completed_at = null, status = RECOVERY_WEEK_STATUS.OK, exercises = [], added = [] }) {
  return {
    week_id, week_number, note_id, note_title: 'Mock Note', completed_at,
    status, note_error: null, exercises, added,
    summary: {
      baseline_met: exercises.filter(e => e.state === RECOVERY_COMPARISON_STATES.BASELINE_MET).length,
      rebuilding: exercises.filter(e => e.state === RECOVERY_COMPARISON_STATES.REBUILDING).length,
      not_reintroduced: exercises.filter(e => e.state === RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED).length,
      not_comparable: exercises.filter(e => e.state === RECOVERY_COMPARISON_STATES.NOT_COMPARABLE).length,
      added_during_recovery: added.length,
    },
  };
}

function mockComparison({ status = RECOVERY_COMPARISON_STATUS.OK, weeks = [] } = {}) {
  return { version: 1, status, baseline_version: 1, block_id: 'rb1', weeks };
}

function setup({ blocks = [], weeks = [], notes = [] }) {
  let component;
  act(() => {
    component = render.create(
      <AnalyticsRecoverySection blocks={blocks} weeks={weeks} notes={notes} />
    );
  });
  return component;
}

function findAllText(root) {
  return root.findAllByType('Text').map(t => {
    const children = t.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
  });
}

function hasText(root, needle) {
  return findAllText(root).some(s => s.includes(needle));
}

function byLabel(root, label) {
  return root.findAll(inst => inst.props.accessibilityLabel === label)[0];
}

// Details are collapsed by default (#758); every row-level assertion opens them.
function expandDetails(root) {
  const toggle = byLabel(root, 'Expand exercise details');
  expect(toggle).toBeDefined();
  act(() => { toggle.props.onPress(); });
}

// Accessible labels of the collapsed exercise rows — scoped so a state-group
// header (which carries `accessibilityRole="header"`) cannot satisfy a
// row-level assertion.
function rowLabels(root) {
  return root
    .findAll(inst =>
      typeof inst.props.accessibilityLabel === 'string'
      && inst.props.accessible === true
      // Chips are pressable and role-tagged; an exercise row is neither.
      && !inst.props.accessibilityRole
      && !inst.props.onPress)
    .map(inst => inst.props.accessibilityLabel);
}

// Host-node lookups (the test renderer otherwise reports both the composite and
// its underlying host node for the same element).
function hostRows(root) {
  return root.findAll(inst => typeof inst.type === 'string' && inst.props.testID === 'recovery-exercise-row');
}
function hostTextsIn(inst) {
  return inst.findAll(n => typeof n.type === 'string' && n.type === 'Text')
    .map(n => [].concat(n.props.children).join(''));
}
// The plain-word status each exercise row shows beside its band mark (#1219),
// in on-screen order. Row text order is: name, status, [percent], [numbers…].
function statusWords(root) {
  return hostRows(root).map(r => hostTextsIn(r)[1]);
}
// The roster summary at the head of the details (#1219): a thin bar plus a
// compact stat row; its full sentence is the accessible label only.
function rosterNode(root) {
  return root.findAll(n => typeof n.type === 'string' && n.props.testID === 'recovery-roster-summary')[0];
}
function rosterLabel(root) {
  const n = rosterNode(root);
  return n ? n.props.accessibilityLabel : null;
}
// Counted state-group headings were removed in #1219 (each row carries its own
// status); the details panel must contain no header-role node.
function groupHeaders(root) {
  return root.findAll(inst => typeof inst.type === 'string' && inst.props.accessibilityRole === 'header');
}

// Completed-block history is collapsed by default (#758).
function expandHistory(root) {
  const toggle = byLabel(root, 'Expand recovery history');
  expect(toggle).toBeDefined();
  act(() => { toggle.props.onPress(); });
}

describe('AnalyticsRecoverySection — visibility', () => {
  test('renders nothing when there is no active or completed recovery block', () => {
    const component = setup({ blocks: [], weeks: [], notes: [] });
    expect(component.toJSON()).toBeNull();
  });
});

describe('AnalyticsRecoverySection — active block evidence', () => {
  // #1029: the met-count headline is gone from the first screenful. With
  // only two baseline exercises, this fixture is below the four-trained
  // sparse floor — one plain sentence names each lift and its state, with
  // the roster denominator, and the survives-only-in-details count is
  // "X of Y at or above baseline" inside the collapsed Exercise details
  // header (covered separately below).
  test('below the sparse floor, one sentence names each trained lift, its state, and the roster denominator — never a percentage', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    // #1209: the sentence moved into the drill-down; the overview shows the
    // labeled segmented bar instead.
    expect(hasText(root, 'roster exercises trained.')).toBe(false);
    expect(hasText(root, '%')).toBe(false);
    expandDetails(root);
    // #1219: the sentence is gone for good — each row carries its own mark and
    // status word, and the roster denominator is one short caption.
    expect(rosterLabel(root)).toBe('Trained this week: 2 of 2 roster exercises.');
    expect(hasText(root, 'Trained this week')).toBe(false);
    expect(hasText(root, 'roster exercises trained.')).toBe(false);
    expect(statusWords(root)).toEqual(['At or above baseline', 'At or above baseline']);
    expect(hasText(root, 'baseline exercises met')).toBe(false);
  });

  // #1029 review finding 1: the sparse sentence's candidate population must be
  // the SAME roster/trained set `deriveRecoveryWeekBands` derives, never a
  // parallel filter over `week.exercises`. A `baseline_value_unusable` row is
  // excluded from the roster entirely (fixture 6 in
  // recovery-return-bands.test.js) and an `added_during_recovery` row is never
  // part of `week.exercises` to begin with — neither may be named here, and
  // the "X of Y" denominator must stay consistent with what the sentence says.
  test('the sparse sentence never names a baseline_value_unusable or added_during_recovery row, and its denominator matches', () => {
    const benchRow = mockRow({
      key: 'bench', name: 'Bench', state: RECOVERY_COMPARISON_STATES.BASELINE_MET, exercise_class: 'weighted',
      metrics: [metricRow('top_load', 135, 135, 100, true), metricRow('volume', 2025, 2025, 100, true)],
    });
    const unusableRow = mockRow({
      key: 'ghost lift', name: 'Ghost Lift', state: RECOVERY_COMPARISON_STATES.NOT_COMPARABLE, exercise_class: 'weighted',
      unavailable_reason: RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE,
    });
    const addedRow = mockRow({
      key: 'sled push', name: 'Sled Push', state: RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY, exercise_class: 'weighted',
      metrics: [metricRow('top_load', 100, null, null, null)],
    });
    deriveRecoveryComparison.mockReturnValueOnce(
      mockComparison({ weeks: [mockWeek({ exercises: [benchRow, unusableRow], added: [addedRow] })] })
    );

    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;

    expandDetails(root);
    // The denominator caption stays consistent with the roster (the unusable
    // row is outside it, the added row never was in it) and names no exercise.
    expect(rosterLabel(root)).toBe('Trained this week: 1 of 1 roster exercises.');
    expect(rosterLabel(root)).not.toMatch(/Ghost Lift|Sled Push|Bench/);
  });

  test('weighted rows show independent Load and Total work; reps-only rows show only their applicable metric', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;
    expandDetails(root);

    expect(hasText(root, 'Load')).toBe(true);
    expect(hasText(root, 'Total work')).toBe(true);
    expect(hasText(root, 'Reps')).toBe(true);
    // "Volume" was never explained on this surface and is gone (#758).
    expect(hasText(root, 'Volume')).toBe(false);
  });

  test('values above 100% baseline remain numerically visible even though the meter fill is capped', () => {
    const b = block();
    const w = week(1, 'note-w1');
    // Bench comes back well above baseline load and total work (200/135 = 148%).
    const n = note('note-w1', '-Bench\n- 200 5,5,5\n-Pull-up\n- 8,8,8');
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;
    expandDetails(root);

    expect(hasText(root, '148%')).toBe(true);
  });

  test('a not-reintroduced baseline exercise shows its state without a fabricated percentage', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', '-Bench\n- 135 5,5,5');
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;
    expandDetails(root);

    expect(rowLabels(root).some(l => l.startsWith('Pull-up, Not trained yet'))).toBe(true);
    // Concise baseline numbers only: no percent, no bar (missing is not zero),
    // and none of the old "Not in Week N · trained in …" prose on screen.
    expect(statusWords(root)).toContain('Not trained yet');
    expect(hasText(root, 'Baseline Reps 24 reps')).toBe(true);
    expect(hasText(root, 'Not in Week')).toBe(false);
    expect(hasText(root, 'Not trained in any')).toBe(false);
    expect(root.findAll(i => typeof i.type === 'string' && i.props.testID === 'recovery-exercise-bar')).toHaveLength(1);
  });

  test('an exercise added during recovery renders separately with no baseline ratio', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', `${BASELINE_TEXT}\n-Foam Roll\n- 10,10`);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;
    expandDetails(root);

    expect(rowLabels(root).some(l => l.startsWith('Foam Roll, Added during recovery'))).toBe(true);
    expect(hasText(root, 'Foam Roll')).toBe(true);
  });

  test('week selection follows membership order and updates every displayed value consistently', () => {
    const b = block();
    const w1 = week(1, 'note-w1');
    const w2 = week(2, 'note-w2');
    const n1 = note('note-w1', BASELINE_TEXT);
    const n2 = note('note-w2', '-Bench\n- 200 5,5,5\n-Pull-up\n- 8,8,8');
    const component = setup({ blocks: [b], weeks: [w1, w2], notes: [n1, n2] });
    const root = component.root;
    expandDetails(root);

    // Defaults to the latest (current) week, which is the >100% week.
    expect(hasText(root, '148%')).toBe(true);

    const week1Chip = byLabel(root, 'Week 1');
    act(() => {
      week1Chip.props.onPress();
    });

    expect(hasText(root, '148%')).toBe(false);
    expect(hasText(root, '100%')).toBe(true);
  });
});

describe('AnalyticsRecoverySection — unavailable and error states', () => {
  test('a missing linked note is a visible unavailable row, not a hidden one', () => {
    const b = block();
    const w = week(1, 'ghost-note-id');
    const component = setup({ blocks: [b], weeks: [w], notes: [] });
    const root = component.root;

    expect(hasText(root, "Week 1 — This week's note is no longer available.")).toBe(true);
  });

  test('a parser-rejected note surfaces the rejection, not zero work, using the R3a-worded notice', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1));
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, "Week 1 — This week's note couldn't be read.")).toBe(true);
    // Never silently presented as a clean, empty week.
    expect(hasText(root, 'No exercise evidence for this week.')).toBe(false);
  });

  test('an unsupported baseline snapshot version is reported rather than silently ignored', () => {
    const b = block({ baseline: { version: 999, exercises: [] } });
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, "can't read")).toBe(true);
  });
});

// #1217: the outer SectionTitle is the sole Recovery header, the routine name is
// secondary context, and the top summary uses three readable text tiers.
describe('AnalyticsRecoverySection — card header and type hierarchy (#1217)', () => {
  const { StyleSheet } = require('react-native');
  const sizeOf = (inst) => StyleSheet.flatten(inst.props.style) || {};
  const hostText = (root, text) => root.findAll(inst => (
    typeof inst.type === 'string' && inst.type === 'Text'
    && (Array.isArray(inst.props.children) ? inst.props.children.join('') : inst.props.children) === text
  ));
  test('the section has exactly one Recovery title (the outer SectionTitle) and none inside the card', () => {
    const root = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    expect(findAllText(root).filter(t => t === 'Recovery').length).toBe(1);
    const title = hostText(root, 'Recovery')[0];
    expect(sizeOf(title)).toMatchObject({ fontSize: 18, fontWeight: '700' });
    // #1219: the hero is the first in-card content; the routine is quiet 13sp
    // context at the bottom, never a title-like caption above the hero.
    const texts = findAllText(root);
    expect(texts.indexOf('Recovery')).toBeLessThan(texts.indexOf('Week 1'));
    expect(texts.indexOf('Week 1')).toBeLessThan(texts.indexOf('2 of 2'));
    // The hero label names the routine, so the bottom line is dates only.
    const ctxText = texts.find(t => t.startsWith('Started'));
    expect(texts.indexOf('2 of 2')).toBeLessThan(texts.indexOf(ctxText));
    const routine = hostText(root, ctxText)[0];
    expect(sizeOf(routine).fontSize).toBeGreaterThanOrEqual(13);
    expect(sizeOf(routine).fontSize).toBeLessThan(sizeOf(title).fontSize);
  });

  test('the top summary uses only sibling sizes: 18sp header, 32sp hero (Weight Trends KUA), 13sp captions', () => {
    const b = block({ reason: 'torn hamstring' });
    const root = setup({ blocks: [b], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    const hero = sizeOf(hostText(root, '2 of 2')[0]);
    // Same KUA hero as Weight Trends `weightValueLarge`: metric-display 32/36.
    expect(hero).toMatchObject({ fontSize: 32, lineHeight: 36 });
    expect(hero.fontSize).not.toBe(28);
    expect(sizeOf(hostText(root, 'Week 1')[0]).fontSize).toBe(13);
    expect(sizeOf(hostText(root, 'at or above Push Pull Legs baseline')[0]).fontSize).toBe(13);
    expect(sizeOf(hostText(root, 'Reason: torn hamstring')[0]).fontSize).toBeGreaterThanOrEqual(13);
  });

  test('the reason and routine sit at the bottom: hero first, then Baseline context, then Reason', () => {
    const b = block({ reason: 'torn hamstring', started_at: '2026-05-01T00:00:00Z' });
    const root = setup({ blocks: [b], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    const texts = findAllText(root);
    const hero = texts.indexOf('2 of 2');
    const ctx = texts.indexOf('Started 05-01-2026');
    const reason = texts.indexOf('Reason: torn hamstring');
    expect(hero).toBeGreaterThan(-1);
    expect(ctx).toBeGreaterThan(hero);
    expect(reason).toBeGreaterThan(ctx);
    // The routine is named once, by the hero label (#1219) — never again in the
    // bottom provenance line.
    expect(texts.filter(t => t.includes('Push Pull Legs'))).toEqual(['at or above Push Pull Legs baseline']);
    expect(texts.some(t => t.startsWith('Baseline:'))).toBe(false);
  });

  test('the bottom reason keeps its edit behavior and a >=44dp target', () => {
    const onSaveReason = jest.fn(async () => ({ ok: true }));
    const b = block({ reason: 'torn hamstring' });
    let component;
    act(() => {
      component = render.create(
        <AnalyticsRecoverySection blocks={[b]} weeks={[]} notes={[]} onSaveReason={onSaveReason} />
      );
    });
    const root = component.root;
    const open = byLabel(root, 'Edit reason for this recovery block: torn hamstring');
    expect(open).toBeDefined();
    expect(sizeOf(open).minHeight).toBeGreaterThanOrEqual(44);
    act(() => { open.props.onPress(); });
    expect(byLabel(root, 'Reason for this recovery block')).toBeDefined();
    expect(byLabel(root, 'Cancel editing the reason')).toBeDefined();
    expect(byLabel(root, 'Save the reason')).toBeDefined();
  });

  test('the reason affordance is at least 13sp and keeps its accessible label', () => {
    const root = setup({ blocks: [block()], weeks: [], notes: [] }).root;
    expect(sizeOf(hostText(root, 'Add a reason')[0]).fontSize).toBeGreaterThanOrEqual(13);
    expect(byLabel(root, 'Add a reason for this recovery block')).toBeDefined();
  });
});

describe('AnalyticsRecoverySection — identity caption and provenance (#793/R5b)', () => {
  test('an active block with a logged week shows a one-line "Week N · routine" identity caption', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, 'at or above Push Pull Legs baseline')).toBe(true);
    // The week is named once, by the hero — not repeated in the caption.
    expect(hasText(root, 'Week 1 · Push Pull Legs')).toBe(false);
    expect(findAllText(root).filter(t => t === 'Week 1').length).toBe(1);
    // The old two-line "Baseline routine" label + title pair is gone.
    expect(hasText(root, 'Baseline routine')).toBe(false);
  });

  test('an active block with no week logged yet shows "Baseline: routine" and the R3a row-1 copy, with no controls', () => {
    const b = block();
    const component = setup({ blocks: [b], weeks: [], notes: [] });
    const root = component.root;

    expect(hasText(root, 'Baseline: Push Pull Legs')).toBe(true);
    expect(hasText(root, 'Baseline captured. No week logged yet.')).toBe(true);
    expect(hasText(root, 'baseline exercises met')).toBe(false);
    expect(byLabel(root, 'Expand exercise details')).toBeUndefined();
  });

  test('the card\'s last line is provenance only: "Started {date}" for an active block', () => {
    const b = block({ started_at: '2026-05-01T00:00:00Z' });
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, 'Started 05-01-2026')).toBe(true);
    // The old combined "Active · Week N · N weeks logged · Started ..." line is gone.
    expect(hasText(root, 'weeks logged')).toBe(false);
  });

  test('the card\'s last line is provenance only: "{start} – {end}" for a completed block', () => {
    const b = block({
      started_at: '2026-04-01T00:00:00Z',
      completed_at: '2026-04-29T00:00:00Z',
    });
    const component = setup({ blocks: [b], weeks: [], notes: [] });
    const root = component.root;

    expect(hasText(root, '04-01-2026 – 04-29-2026')).toBe(true);
  });

  // Scoped to host nodes only, matching the `groupHeaders` dedup pattern —
  // the test renderer otherwise reports the composite and host node separately
  // for the same element.
  function liveRegions(root) {
    return root.findAll(
      inst => typeof inst.type === 'string' && inst.props.accessibilityLiveRegion === 'polite'
    );
  }

  test('the week-status region carries a stable accessibilityLiveRegion="polite" wrapper so a week change is announced', () => {
    const b = block();
    const w1 = week(1, 'note-w1');
    const w2 = week(2, 'note-w2');
    const n1 = note('note-w1', BASELINE_TEXT);
    const n2 = note('note-w2', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w1, w2], notes: [n1, n2] });
    const root = component.root;

    expect(byLabel(root, "Week 2 return bands across 2 trained exercises: At or above 2, Close 0, Rebuilding 0, Early 0, Can't compare 0")).toBeDefined();
    expect(liveRegions(root).length).toBe(1);
  });

  // #794 review: gating the live region on the hero alone (present only when
  // `totalBaselineExercises > 0`) meant selecting a week that resolves to a
  // missing/unreadable note, or one with zero evidence, unmounted the only
  // live region on screen — so that switch was never announced. The wrapper
  // must persist regardless of which of those mutually exclusive outcomes the
  // selected week lands on.
  test('the live-region wrapper survives switching between a hero week and a missing-note week — it is never unmounted', () => {
    const b = block();
    const w1 = week(1, 'note-w1');
    const w2 = week(2, 'ghost-note-id'); // no matching note supplied below
    const n1 = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w1, w2], notes: [n1] });
    const root = component.root;

    // Defaults to the latest week (2), whose note is missing — no hero
    // renders, but the live-region wrapper still does, around the notice.
    expect(liveRegions(root).length).toBe(1);
    expect(hasText(root, "Week 2 — This week's note is no longer available.")).toBe(true);

    act(() => { byLabel(root, 'Week 1').props.onPress(); });

    // Week 1 has a hero. Still exactly one live-region wrapper — it was
    // never unmounted and remounted across the branch switch.
    expect(liveRegions(root).length).toBe(1);
    expect(hasText(root, '2 of 2')).toBe(true);
    expect(hasText(root, "note is no longer available")).toBe(false);
  });
});

describe('AnalyticsRecoverySection — completed-block history', () => {
  function completedBlock(id, completedAt, title) {
    return block({
      id,
      baseline_note_title: title,
      completed_at: completedAt,
    });
  }

  test('history defaults collapsed with a meaningful summary, and expands on demand', () => {
    const completed = completedBlock('rb-old', '2026-04-01T00:00:00Z', 'Old Routine');
    const component = setup({ blocks: [completed], weeks: [], notes: [] });
    const root = component.root;

    // Collapsed by default (#758), but never silent: the count and the latest
    // block are stated without a tap.
    expect(hasText(root, '1 completed block')).toBe(true);
    expect(hasText(root, 'Latest:')).toBe(true);
    expect(hasText(root, 'Old Routine')).toBe(true);

    expandHistory(root);

    expect(byLabel(root, 'Collapse recovery history')).toBeDefined();
    expect(hasText(root, 'Latest:')).toBe(false);
  });

  test('selecting a completed block from history switches the focused evidence', () => {
    const active = block({ id: 'rb-active', baseline_note_title: 'Current Routine' });
    const completed = completedBlock('rb-old', '2026-04-01T00:00:00Z', 'Old Routine');
    const component = setup({
      blocks: [active, completed],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', BASELINE_TEXT)],
    });
    const root = component.root;

    expect(hasText(root, 'Current Routine')).toBe(true);
    expandHistory(root);

    const historyRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' &&
        inst.props.accessibilityLabel.startsWith('View recovery evidence for Old Routine')
    )[0];
    act(() => {
      historyRow.props.onPress();
    });

    expect(hasText(root, 'Old Routine')).toBe(true);
    expect(hasText(root, 'Back to active block')).toBe(true);
  });
});

describe('AnalyticsRecoverySection — every exercise class/state (mocked comparison)', () => {
  test('a timed exercise row shows only its Time metric, formatted as a duration', () => {
    const row = mockRow({
      key: 'plank', name: 'Plank', state: RECOVERY_COMPARISON_STATES.BASELINE_MET, exercise_class: 'time_based',
      metrics: [metricRow('total_seconds', 90, 60, 150, true)],
    });
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({ exercises: [row] })] }));

    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;
    expandDetails(root);

    expect(hasText(root, 'Plank')).toBe(true);
    expect(hasText(root, 'Time')).toBe(true);
    expect(hasText(root, 'Load')).toBe(false);
    expect(hasText(root, 'Total work')).toBe(false);
    expect(hasText(root, 'Reps')).toBe(false);
    expect(hasText(root, '1:30')).toBe(true); // formatDuration(90)
  });

  test('a rebuilding row identifies the unmet dimension and never reports Baseline met', () => {
    const row = mockRow({
      key: 'bench', name: 'Bench', state: RECOVERY_COMPARISON_STATES.REBUILDING, exercise_class: 'weighted',
      metrics: [metricRow('top_load', 135, 135, 100, true), metricRow('volume', 1000, 2025, 49, false)],
      unmet: ['volume'],
    });
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({ exercises: [row] })] }));

    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;
    expandDetails(root);

    // Scoped to the row: the status-filter chips name every state, so a
    // whole-tree text search can no longer tell them apart.
    const labels = rowLabels(root);
    expect(labels.some(l => l.startsWith('Bench, Early'))).toBe(true);
    expect(labels.filter(l => l.startsWith('Bench,')).some(l => l.includes('Baseline met') || l.includes('At or above'))).toBe(false);
    expect(hasText(root, '49%')).toBe(true);
  });

  // #1219 review: the row is ONE accessible element, so its label must carry the
  // exact status word a sighted user sees, for every source-state/band case.
  test('every row\'s spoken label starts with the same status word it shows, for each source-state vs derived-band case', () => {
    const R = RECOVERY_COMPARISON_STATES;
    const cases = [
      ['close', R.REBUILDING, [metricRow('top_load', 128, 135, 95, false)], 'Close to baseline'],
      ['mid', R.REBUILDING, [metricRow('top_load', 95, 135, 70, false)], 'Rebuilding'],
      ['low', R.REBUILDING, [metricRow('top_load', 40, 135, 29, false)], 'Early'],
      ['met', R.BASELINE_MET, [metricRow('top_load', 135, 135, 100, true)], 'At or above baseline'],
      ['absent', R.NOT_REINTRODUCED, [metricRow('top_load', null, 135, null, null)], 'Not trained yet'],
      ['added', R.ADDED_DURING_RECOVERY, [metricRow('top_load', 50, null, null, null)], 'Added during recovery'],
      ['nocomp', R.NOT_COMPARABLE, [metricRow('top_load', null, 135, null, null)], "Can't compare"],
    ];
    const rows = cases.map(([key, state, metrics]) => mockRow({
      key, name: `Lift ${key}`, state, exercise_class: 'weighted', metrics,
      unavailable_reason: state === R.NOT_COMPARABLE ? 'exercise_class_changed' : null,
    }));
    const exercises = rows.filter(r => r.state !== R.ADDED_DURING_RECOVERY);
    const added = rows.filter(r => r.state === R.ADDED_DURING_RECOVERY);
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({ exercises, added })] }));
    const root = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    expandDetails(root);
    const shown = Object.fromEntries(hostRows(root).map(r => [hostTextsIn(r)[0], hostTextsIn(r)[1]]));
    const labels = rowLabels(root);
    for (const [key, , , word] of cases) {
      expect(shown[`Lift ${key}`]).toBe(word);
      const label = labels.find(l => l.startsWith(`Lift ${key},`));
      expect(label).toBeDefined();
      // Exactly the visible word, right after the name, never a divergent source-state word.
      expect(label.startsWith(`Lift ${key}, ${word}`)).toBe(true);
      expect(label).not.toMatch(/Baseline met|Not reintroduced|Not comparable/);
    }
  });

  test('a not-comparable row surfaces its unavailable reason instead of a fabricated ratio', () => {
    const row = mockRow({
      key: 'chinup', name: 'Chin-up', state: RECOVERY_COMPARISON_STATES.NOT_COMPARABLE, exercise_class: 'weighted',
      metrics: [
        { metric: 'top_load', current: null, baseline: 135, ratio: null, percent: null, met: false },
        { metric: 'volume', current: null, baseline: 2025, ratio: null, percent: null, met: false },
      ],
      unavailable_reason: 'exercise_class_changed',
    });
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({ exercises: [row] })] }));

    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;
    expandDetails(root);

    expect(statusWords(root)).toEqual(["Can't compare"]);
    // The reason is now short on screen and full in the spoken label (#821):
    // the visible panel was carrying a sentence per un-comparable row. Both
    // halves are asserted, because dropping the long form would silently cost
    // screen-reader users the only explanation they get.
    expect(hasText(root, 'Different exercise type')).toBe(true);
    expect(
      rowLabels(root).some(l => l.includes('Logged as a different kind of exercise than the baseline.'))
    ).toBe(true);
    // No fabricated ratio on screen: no bar, no percent.
    expect(hasText(root, '%')).toBe(false);
    expect(root.findAll(i => typeof i.type === 'string' && i.props.testID === 'recovery-exercise-bar')).toHaveLength(0);
    // #1219: no clause-count line or counted group heading; the row states it.
    expect(hasText(root, '1 not comparable')).toBe(false);
    expect(groupHeaders(root).map(h => h.props.children)).not.toContain('Not comparable (1)');
  });

  test('an empty-but-supported baseline snapshot is reported without a hero or exercise rows', () => {
    deriveRecoveryComparison.mockReturnValueOnce(
      mockComparison({ status: RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY, weeks: [mockWeek({ exercises: [], added: [] })] })
    );

    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;

    expect(hasText(root, 'No baseline exercises were captured for this block.')).toBe(true);
    expect(hasText(root, 'baseline exercises met')).toBe(false);
  });

  test('a baseline-empty week that still carries added work: the added row is reachable in Exercise details, with no clause-count prose', () => {
    const addedRow = mockRow({
      key: 'foam-roll', name: 'Foam Roll', state: RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY, exercise_class: 'reps_based',
      metrics: [metricRow('total_reps', 20, null, null, null)],
    });
    deriveRecoveryComparison.mockReturnValueOnce(
      mockComparison({ status: RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY, weeks: [mockWeek({ exercises: [], added: [addedRow] })] })
    );

    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;

    // No hero (there is no baseline denominator), and the #1029 bucket
    // rows are absent too (zero roster) — but the added work is still
    // reachable via Exercise details as its own status row.
    expect(hasText(root, 'baseline exercises met')).toBe(false);
    expandDetails(root);
    expect(hasText(root, 'Week 1 · 1 added during recovery')).toBe(false);
    expect(statusWords(root)).toEqual(['Added during recovery']);
    expect(hasText(root, 'Reps 20 reps')).toBe(true);
    expect(rowLabels(root).some(l => l.startsWith('Foam Roll, Added during recovery'))).toBe(true);
  });
});

describe('AnalyticsRecoverySection — accessible labels expose the underlying evidence', () => {
  test('a Baseline met row announces its metric percentages and current/baseline values, not just the state', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;
    expandDetails(root);

    const benchRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.startsWith('Bench, At or above baseline')
    )[0];
    expect(benchRow).toBeDefined();
    expect(benchRow.props.accessibilityLabel).toContain('Load 100%');
    expect(benchRow.props.accessibilityLabel).toContain('135 lb of 135 lb baseline');
    expect(benchRow.props.accessibilityLabel).toContain('Total work 100%');
  });

  test('a not-reintroduced row announces its baseline reference values', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', '-Bench\n- 135 5,5,5');
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;
    expandDetails(root);

    const pullUpRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.startsWith('Pull-up, Not trained yet')
    )[0];
    expect(pullUpRow).toBeDefined();
    expect(pullUpRow.props.accessibilityLabel).toContain('Baseline Reps 24 reps');
  });

  test('an added-during-recovery row announces its real numbers', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', `${BASELINE_TEXT}\n-Foam Roll\n- 10,10`);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;
    expandDetails(root);

    const addedRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.startsWith('Foam Roll, Added during recovery')
    )[0];
    expect(addedRow).toBeDefined();
    expect(addedRow.props.accessibilityLabel).toContain('Reps 20 reps');
  });
});

describe('AnalyticsRecoverySection — likely name mismatch explanation (#1202)', () => {
  const mismatchWeek = () => {
    const base = mockRow({
      key: 'pull-up', name: 'Pull-up', state: RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED, exercise_class: 'weighted',
      metrics: [metricRow('total_reps', null, 24, null, null)],
    });
    base.likely_logged_name = 'Pull-up (wide)';
    const added = mockRow({
      key: 'pull-up (wide)', name: 'Pull-up (wide)', state: RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY, exercise_class: 'weighted',
      metrics: [metricRow('total_reps', 20, null, null, null)],
    });
    added.likely_baseline_name = 'Pull-up';
    const plain = mockRow({
      key: 'foam roll', name: 'Foam Roll', state: RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY, exercise_class: 'weighted',
      metrics: [metricRow('total_reps', 20, null, null, null)],
    });
    return mockWeek({ exercises: [base], added: [added, plain] });
  };

  test('both rows explain the mismatch visibly and accessibly; ordinary rows do not', () => {
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mismatchWeek()] }));
    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;
    expandDetails(root);
    // Visible form is just the names (#1219); the full sentence stays spoken.
    expect(hasText(root, 'Logged as “Pull-up (wide)”')).toBe(true);
    expect(hasText(root, 'Baseline has “Pull-up”')).toBe(true);
    expect(hasText(root, 'names differ')).toBe(false);
    const labels = rowLabels(root);
    expect(labels.find(l => l.startsWith('Pull-up, Not trained yet'))).toContain('Logged as "Pull-up (wide)" this week — names differ, so no direct comparison was made.');
    expect(labels.find(l => l.startsWith('Pull-up (wide), Added during recovery'))).toContain('Baseline has "Pull-up" — names differ, so no direct comparison was made.');
    expect(labels.find(l => l.startsWith('Pull-up, Not trained yet'))).toContain('names differ');
    expect(labels.find(l => l.startsWith('Pull-up (wide), Added during recovery'))).toContain('names differ');
    expect(labels.find(l => l.startsWith('Foam Roll'))).not.toContain('names differ');
  });
});

describe('AnalyticsRecoverySection — persisted week identity survives gaps', () => {
  test('week chips and metadata use the persisted week_number, not array position, after an earlier week was unlinked', () => {
    const b = block();
    // Week 2 was unlinked (tombstoned) elsewhere; the live weeks are 1 and 3.
    const w1 = week(1, 'note-w1');
    const w3 = week(3, 'note-w3');
    const n1 = note('note-w1', BASELINE_TEXT);
    const n3 = note('note-w3', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w1, w3], notes: [n1, n3] });
    const root = component.root;

    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Week 1').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Week 3').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Week 2').length).toBe(0);
    // Defaults to the latest live week, which is persisted week_number 3 — not
    // "week 2 of 2" from array position.
    expect(hasText(root, 'at or above Push Pull Legs baseline')).toBe(true);
    expect(hasText(root, 'Week 3 · Push Pull Legs')).toBe(false);
  });
});

describe('AnalyticsRecoverySection — completed-block evidence uses that block\'s own weeks', () => {
  test('switching focus to a completed block never mixes in the active block\'s weeks', () => {
    const active = block({ id: 'rb-active', baseline_note_title: 'Current Routine' });
    const completed = block({
      id: 'rb-old',
      baseline_note_title: 'Old Routine',
      completed_at: '2026-04-01T00:00:00Z',
    });
    const activeWeek = week(1, 'note-active-w1', { block_id: 'rb-active' });
    const completedWeek1 = week(1, 'note-old-w1', { id: 'rw-old-1', block_id: 'rb-old' });
    const completedWeek3 = week(3, 'note-old-w3', { id: 'rw-old-3', block_id: 'rb-old' });

    const component = setup({
      blocks: [active, completed],
      weeks: [activeWeek, completedWeek1, completedWeek3],
      notes: [
        note('note-active-w1', BASELINE_TEXT),
        note('note-old-w1', BASELINE_TEXT),
        note('note-old-w3', BASELINE_TEXT),
      ],
    });
    const root = component.root;
    expandHistory(root);

    const historyRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' &&
        inst.props.accessibilityLabel.startsWith('View recovery evidence for Old Routine')
    )[0];
    act(() => {
      historyRow.props.onPress();
    });

    // The completed block's own weeks (1 and 3) render; the active block's
    // week (also numbered 1, on a different note) is not pulled in.
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Week 1').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Week 3').length).toBeGreaterThan(0);
    expect(hasText(root, 'Old Routine')).toBe(true);
    expect(hasText(root, 'Week 3 · Old Routine')).toBe(false);
  });
});

// ── #727: completed Recovery block week index with note navigation ─────────────

describe('AnalyticsRecoverySection — completed-block week index (#727)', () => {
  function completedBlock(id, completedAt, title) {
    return block({ id, baseline_note_title: title, completed_at: completedAt });
  }

  // Every assertion in this block reads the completed-block week index, which
  // lives inside the history panel — collapsed by default since #758.
  function setupWithNavigate(props, onNavigate) {
    let component;
    act(() => {
      component = render.create(
        <AnalyticsRecoverySection onNavigate={onNavigate} {...props} />
      );
    });
    expandHistory(component.root);
    return component;
  }

  test('a completed block with one live week shows the persisted week ordinal and note title', () => {
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(3, 'note-w3', { block_id: 'rb-c', id: 'rw-c-3', completed_at: '2026-03-25T00:00:00Z' });
    const n = note('note-w3', BASELINE_TEXT, 'PPL Week Three');
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [n] }, jest.fn());
    const root = component.root;

    expect(hasText(root, 'Week 3')).toBe(true);
    expect(hasText(root, 'PPL Week Three')).toBe(true);
  });

  test('an available completed week is pressable and fires onNavigate with the exact note_id', () => {
    const onNavigate = jest.fn();
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(1, 'note-w1', { block_id: 'rb-c', id: 'rw-c-1', completed_at: '2026-03-15T00:00:00Z' });
    const n = note('note-w1', BASELINE_TEXT, 'Week One Note');
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [n] }, onNavigate);
    const root = component.root;

    const row = root.findAll(
      inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 1, Week One Note'
    )[0];
    expect(row).toBeDefined();
    expect(typeof row.props.onPress).toBe('function');

    act(() => { row.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Log', { kind: 'note', noteId: 'note-w1' });

    act(() => { row.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'Log', { kind: 'note', noteId: 'note-w1' });
  });

  test('an in-progress available week shows "In progress" and is navigable', () => {
    const onNavigate = jest.fn();
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(2, 'note-w2', { block_id: 'rb-c', id: 'rw-c-2', completed_at: null });
    const n = note('note-w2', BASELINE_TEXT, 'Week Two Note');
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [n] }, onNavigate);
    const root = component.root;

    expect(hasText(root, 'In progress')).toBe(true);
    const row = root.findAll(inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 2, Week Two Note')[0];
    expect(typeof row.props.onPress).toBe('function');
    act(() => { row.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Log', { kind: 'note', noteId: 'note-w2' });
  });

  test('a missing note week shows Unavailable and has no onPress', () => {
    const onNavigate = jest.fn();
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(1, 'ghost-note', { block_id: 'rb-c', id: 'rw-c-1' });
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [] }, onNavigate);
    const root = component.root;

    const row = root.findAll(inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 1, Unavailable')[0];
    expect(row).toBeDefined();
    expect(row.props.onPress).toBeUndefined();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('a parser-unavailable note week (size limit) shows its title and Unavailable state, and has no onPress', () => {
    const onNavigate = jest.fn();
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(1, 'note-huge', { block_id: 'rb-c', id: 'rw-c-1' });
    const n = note('note-huge', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1), 'Huge Note');
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [n] }, onNavigate);
    const root = component.root;

    // Title is known and must appear; accessible identity uses the note title, not "Unavailable".
    const row = root.findAll(inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 1, Huge Note')[0];
    expect(row).toBeDefined();
    expect(row.props.onPress).toBeUndefined();
    expect(hasText(root, 'Huge Note')).toBe(true);
    expect(hasText(root, 'Unavailable')).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('a parser-unavailable note week (set row with no exercise) shows its title and Unavailable state, and has no onPress', () => {
    // A set row with no preceding exercise header causes parseWorkoutNote to return ok:false
    // even though the note is well under the size limit.
    const onNavigate = jest.fn();
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(1, 'note-bad', { block_id: 'rb-c', id: 'rw-c-1' });
    const n = note('note-bad', '-135 5,5,5', 'Orphan Sets');
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [n] }, onNavigate);
    const root = component.root;

    // The note's title is still known and must appear in the row and accessible identity.
    const row = root.findAll(inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 1, Orphan Sets')[0];
    expect(row).toBeDefined();
    expect(row.props.onPress).toBeUndefined();
    expect(hasText(root, 'Orphan Sets')).toBe(true);
    expect(hasText(root, 'Unavailable')).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('an unavailable note on a completed week shows Unavailable, not the completion date', () => {
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(1, 'ghost-note', { block_id: 'rb-c', id: 'rw-c-1', completed_at: '2026-03-15T00:00:00Z' });
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [] }, jest.fn());
    const root = component.root;

    expect(hasText(root, 'Unavailable')).toBe(true);
    // The completion date must not appear as the state text when the note is unavailable.
    expect(hasText(root, 'Mar 15, 2026')).toBe(false);
  });

  test('non-contiguous persisted week numbers render in ordinal order, not array position', () => {
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w1 = week(1, 'note-w1', { block_id: 'rb-c', id: 'rw-c-1', completed_at: '2026-03-08T00:00:00Z' });
    const w5 = week(5, 'note-w5', { block_id: 'rb-c', id: 'rw-c-5', completed_at: '2026-03-29T00:00:00Z' });
    const n1 = note('note-w1', BASELINE_TEXT, 'Note One');
    const n5 = note('note-w5', BASELINE_TEXT, 'Note Five');
    const component = setupWithNavigate({ blocks: [b], weeks: [w5, w1], notes: [n1, n5] }, jest.fn());
    const root = component.root;

    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 1, Note One').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 5, Note Five').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 2, Note One').length).toBe(0);
  });

  test('accessible identity includes block title, persisted week ordinal, and note title', () => {
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(7, 'note-w7', { block_id: 'rb-c', id: 'rw-c-7', completed_at: '2026-03-29T00:00:00Z' });
    const n = note('note-w7', BASELINE_TEXT, 'Seventh Session');
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [n] }, jest.fn());
    const root = component.root;

    const row = root.findAll(inst => inst.props.accessibilityLabel === 'Push Pull Legs, Recovery Week 7, Seventh Session')[0];
    expect(row).toBeDefined();
  });

  test('a completed block with no weeks shows no week rows under it', () => {
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const component = setupWithNavigate({ blocks: [b], weeks: [], notes: [] }, jest.fn());
    const root = component.root;

    expect(hasText(root, '1 completed block')).toBe(true);
    expect(root.findAll(inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.includes('Recovery Week')).length).toBe(0);
  });

  test('weeks from one block do not appear under another block in the index', () => {
    const b1 = completedBlock('rb-1', '2026-03-01T00:00:00Z', 'Block One');
    const b2 = completedBlock('rb-2', '2026-04-01T00:00:00Z', 'Block Two');
    const w1 = week(1, 'note-b1-w1', { block_id: 'rb-1', id: 'rw-1-1' });
    const w2 = week(1, 'note-b2-w1', { block_id: 'rb-2', id: 'rw-2-1' });
    const n1 = note('note-b1-w1', BASELINE_TEXT, 'Block One Note');
    const n2 = note('note-b2-w1', BASELINE_TEXT, 'Block Two Note');
    const component = setupWithNavigate({ blocks: [b1, b2], weeks: [w1, w2], notes: [n1, n2] }, jest.fn());
    const root = component.root;

    // Each block's week appears with its own block title in the label.
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Block One, Recovery Week 1, Block One Note').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Block Two, Recovery Week 1, Block Two Note').length).toBeGreaterThan(0);
    // Block One's note title must not appear under Block Two's label, and vice versa.
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Block One, Recovery Week 1, Block Two Note').length).toBe(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'Block Two, Recovery Week 1, Block One Note').length).toBe(0);
  });
});

describe('AnalyticsRecoverySection — light/dark appearance', () => {
  function setupWithColors(colors, { blocks, weeks, notes }) {
    let component;
    act(() => {
      component = render.create(
        <ThemeContext.Provider value={{ colors, mode: 'light', preference: 'light', setPreference: () => {} }}>
          <AnalyticsRecoverySection blocks={blocks} weeks={weeks} notes={notes} />
        </ThemeContext.Provider>
      );
    });
    return component;
  }

  // #1029 replaced the single met-count hero with per-bucket band rows; a
  // four-lift fixture (above the sparse floor) exercises the bucket-row
  // fill, which keeps the accent mark color both palettes always used for
  // the hero it replaced.
  const FOUR_LIFT_BASELINE_TEXT = '-A\n- 100 10\n-B\n- 100 10\n-C\n- 100 10\n-D\n- 100 10';

  test('segment fills render in the named band token for both light and dark palettes', () => {
    const b = block({ baseline: captureRecoveryBaselineFromText(FOUR_LIFT_BASELINE_TEXT) });
    const w = week(1, 'note-w1');
    const n = note('note-w1', FOUR_LIFT_BASELINE_TEXT);

    const lightComponent = setupWithColors(LightColors, { blocks: [b], weeks: [w], notes: [n] });
    expect(lightComponent.root.findAllByProps({ testID: 'recovery-bands-rows' }).length).toBeGreaterThan(0);
    // #1209: segments use the named band tokens (At or above = success).
    const segColor = comp => comp.root.findAll(inst => inst.props.testID === 'recovery-segment-at_or_above' && typeof inst.type === 'string')
      .map(inst => inst.props.style.backgroundColor);
    expect(segColor(lightComponent)).toContain(LightColors.success);

    const darkComponent = setupWithColors(DarkColors, { blocks: [b], weeks: [w], notes: [n] });
    expect(segColor(darkComponent)).toContain(DarkColors.success);
    expect(hasText(darkComponent.root, 'At or above')).toBe(true);
    expect(hasText(darkComponent.root, 'At or above 4')).toBe(false);
    expect(hasText(darkComponent.root, 'Trained this week')).toBe(false);
    expandDetails(darkComponent.root);
    expect(rosterLabel(darkComponent.root)).toBe('Trained this week: 4 of 4 roster exercises.');
  });
});

// ── #716: unverified Recovery state is never rendered as an empty result ─────

describe('AnalyticsRecoverySection — authoritative Recovery state (#716)', () => {
  const {
    RECOVERY_LOADING_MESSAGE,
    RECOVERY_STALE_MESSAGE,
    RECOVERY_UNVERIFIED_MESSAGE,
  } = require('../hooks/entries/recoveryBlockHooks');

  function setupState(props) {
    let component;
    act(() => {
      component = render.create(
        <ThemeContext.Provider value={{ colors: LightColors, mode: 'light', preference: 'light', setPreference: () => {} }}>
          <AnalyticsRecoverySection blocks={[]} weeks={[]} notes={[]} {...props} />
        </ThemeContext.Provider>
      );
    });
    return component;
  }

  const texts = (component) =>
    component.root.findAll(n => typeof n.type === 'string' && n.props.children)
      .map(n => n.props.children)
      .filter(c => typeof c === 'string');

  const retryButton = (component) =>
    component.root.findAll(n => n.props && n.props.accessibilityLabel === 'Retry recovery' && n.props.onPress)[0];

  test('a cold load renders explicit progress instead of nothing', () => {
    const component = setupState({ stateReady: false, stateLoading: true });
    expect(texts(component)).toContain(RECOVERY_LOADING_MESSAGE);
    // Progress is not an error: there is nothing to retry yet.
    expect(retryButton(component)).toBeUndefined();
  });

  test('a terminal first-load failure renders the unknown state and a retry path, not an empty section', () => {
    const onRetry = jest.fn();
    const component = setupState({
      stateReady: false,
      stateLoading: false,
      stateError: new Error('unreadable'),
      onRetry,
    });

    // Without this the failed read would be indistinguishable from "this user
    // has never recovered" — the section would simply not render at all.
    expect(texts(component)).toContain(RECOVERY_UNVERIFIED_MESSAGE);
    const button = retryButton(component);
    expect(button).toBeTruthy();
    act(() => { button.props.onPress(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('a terminal failure wins over in-flight progress', () => {
    const component = setupState({
      stateReady: false,
      stateLoading: true,
      stateRefreshing: true,
      stateError: new Error('unreadable'),
      onRetry: jest.fn(),
    });
    expect(texts(component)).toContain(RECOVERY_UNVERIFIED_MESSAGE);
    expect(texts(component)).not.toContain(RECOVERY_LOADING_MESSAGE);
  });

  test('a stale snapshot keeps last-known-good evidence on screen and says it is stale', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const component = setupState({
      blocks: [b],
      weeks: [w],
      notes: [{ id: 'note-w1', title: 'Week 1', raw_text: BASELINE_TEXT }],
      stateStale: true,
      onRetry: jest.fn(),
    });

    const rendered = texts(component);
    expect(rendered).toContain(RECOVERY_STALE_MESSAGE);
    // The block's own evidence is still rendered, not replaced by the notice.
    expect(rendered.some(t => t.includes('at or above Push Pull Legs baseline'))).toBe(true);
    expect(retryButton(component)).toBeTruthy();
  });

  test('a stale snapshot with no blocks still offers the retry path', () => {
    const component = setupState({ stateStale: true, onRetry: jest.fn() });
    expect(texts(component)).toContain(RECOVERY_STALE_MESSAGE);
    expect(retryButton(component)).toBeTruthy();
  });

  // #1029 review finding 2: movement is deliberately never computed while
  // stale, but the fallback must not claim the wrong reason for its absence.
  // Cached weeks here meet the full movement evidence bar (>=2 qualifying
  // weeks, matched === roster since roster < 3, a qualifying anchor) — if not
  // for staleness this would print a real movement figure, so the "not enough
  // matched lifts" copy would be false, not merely conservative.
  test('stale state suppresses movement without falsely claiming insufficient evidence', () => {
    const b = block();
    const w1 = week(1, 'note-w1');
    const w2 = week(2, 'note-w2');
    const component = setupState({
      blocks: [b],
      weeks: [w1, w2],
      notes: [note('note-w1', BASELINE_TEXT), note('note-w2', BASELINE_TEXT)],
      stateStale: true,
      onRetry: jest.fn(),
    });

    const rendered = texts(component);
    expect(rendered).toContain(RECOVERY_STALE_MESSAGE);
    expect(rendered.some(t => t.includes('Not enough matched lifts to compare weeks yet'))).toBe(false);
  });

  test('a verified empty snapshot still renders nothing at all', () => {
    const component = setupState({ stateReady: true });
    expect(component.toJSON()).toBeNull();
  });

  // Corrected §6 lifecycle gate (issue #790 review): `stateReady` alone gates
  // the banner-instead-of-content branch. `stateReady && stateRefreshing` is a
  // normal, silent background read over already-verified data and must keep
  // rendering the full evidence card, never a banner in its place.
  test('ready:true, refreshing:true keeps the full evidence card with no lifecycle banner', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setupState({
      blocks: [b], weeks: [w], notes: [n],
      stateReady: true, stateRefreshing: true,
    });

    expect(hasText(component.root, '2 of 2')).toBe(true);
    expect(texts(component)).not.toContain(RECOVERY_LOADING_MESSAGE);
    expect(texts(component)).not.toContain(RECOVERY_UNVERIFIED_MESSAGE);
    expect(texts(component)).not.toContain(RECOVERY_STALE_MESSAGE);
  });

  test('ready:false shows the lifecycle banner with no evidence card, even with blocks present', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setupState({
      blocks: [b], weeks: [w], notes: [n],
      stateReady: false, stateLoading: true,
    });

    expect(texts(component)).toContain(RECOVERY_LOADING_MESSAGE);
    expect(hasText(component.root, '2 of 2')).toBe(false);
    expect(hasText(component.root, 'Push Pull Legs')).toBe(false);
  });
});

// ── #758: collapsed-by-default details, week/status filters, metric wording ──

describe('AnalyticsRecoverySection — progressive disclosure and filters (#758)', () => {
  // Bench comes back at baseline load but two thirds of the baseline total work
  // (rebuilding), Pull-up is fully back (baseline met), Foam Roll is new work.
  const MIXED_TEXT = '-Bench\n- 135 5,5\n-Pull-up\n- 8,8,8\n-Foam Roll\n- 10,10';

  function setupMixed() {
    return setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', MIXED_TEXT)],
    }).root;
  }

  test('the section opens on the summary alone — no exercise rows until details are expanded', () => {
    const root = setupMixed();

    expect(hasText(root, 'roster exercises trained.')).toBe(false);
    expect(hasText(root, 'baseline exercises met')).toBe(false);
    expect(hasText(root, 'Exercise details')).toBe(true);
    // The header no longer restates the hero's status.
    expect(findAllText(root).filter(t => t.startsWith('at or above') && t.endsWith('baseline')).length).toBe(1);
    expect(hasText(root, 'of 2 at or above baseline')).toBe(false);
    expect(hasText(root, '3 exercises')).toBe(true);

    // The diagnostic panel this issue is about is not on screen yet — no
    // per-row Load metric cell (the "Most common gap: Total work" summary
    // line is a legitimate first-screenful fact and may itself say "Total
    // work", so that word alone is not asserted absent).
    expect(rowLabels(root).some(l => l.startsWith('Bench,'))).toBe(false);
    expect(hasText(root, 'Load')).toBe(false);
    expect(hasText(root, 'Most common gap')).toBe(false);
    expect(byLabel(root, 'Expand exercise details')).toBeDefined();
    // The roster/gap facts live in the drill-down now (#1209).
    expandDetails(root);
    // #1219: a compact stat row (visible) with the full sentence spoken only.
    expect(rosterLabel(root)).toBe('Trained this week: 2 of 2 roster exercises. Most common gap: Total work.');
    expect(hasText(root, 'Gap: Total work')).toBe(true);
    expect(hasText(root, 'Most common gap')).toBe(false);
    expect(hasText(root, 'Trained this week')).toBe(false);
    expect(hasText(root, 'roster exercises')).toBe(false);
  });

  test('details expand and collapse again on demand', () => {
    const root = setupMixed();

    expandDetails(root);
    expect(rowLabels(root).some(l => l.startsWith('Bench, Rebuilding'))).toBe(true);

    const collapse = byLabel(root, 'Collapse exercise details');
    expect(collapse.props.accessibilityState).toEqual({ expanded: true });
    act(() => { collapse.props.onPress(); });

    expect(rowLabels(root).some(l => l.startsWith('Bench,'))).toBe(false);
    expect(byLabel(root, 'Expand exercise details').props.accessibilityState).toEqual({ expanded: false });
  });

  test('the summary is week-aware, names only the states that occurred, and never invents a score', () => {
    const root = setupMixed();

    // The old merged clause line ("Week 1 · 1 rebuilding · 1 added during
    // recovery") is folded into Exercise details, not shown on the first
    // screenful (#1029 §10c) — it is reachable there instead.
    expect(hasText(root, 'Week 1 · 1 rebuilding · 1 added during recovery')).toBe(false);
    // No composite recovery percentage, and no per-row diagnostic detail,
    // exists on the first screenful.
    expect(findAllText(root).some(s => s.includes('%'))).toBe(false);
    expect(byLabel(root, "Week 1 return bands across 2 trained exercises: At or above 1, Close 0, Rebuilding 1, Early 0, Can't compare 0")).toBeDefined();

    expandDetails(root);
    // #1219: the clause line is gone everywhere; the rows carry the states.
    expect(hasText(root, 'Week 1 · 1 rebuilding · 1 added during recovery')).toBe(false);
    expect(statusWords(root)).toEqual(['At or above baseline', 'Rebuilding', 'Added during recovery']);
    // States with nothing in them are not listed as zeroes.
    expect(hasText(root, '0 not reintroduced')).toBe(false);
    expect(hasText(root, '0 not comparable')).toBe(false);
  });

  test('the week filter re-derives the summary, not just the rows', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1'), week(2, 'note-w2')],
      notes: [note('note-w1', BASELINE_TEXT), note('note-w2', MIXED_TEXT)],
    }).root;

    // Latest week first.
    expect(hasText(root, 'Rebuilding')).toBe(true);
    const barLabel = () => root.findAll(n => n.props.testID === 'recovery-bands-rows' && typeof n.type === 'string')[0].props.accessibilityLabel;
    expect(barLabel()).toContain('Week 2 return bands');
    expect(barLabel()).toContain('Rebuilding 1');

    act(() => { byLabel(root, 'Week 1').props.onPress(); });

    expect(barLabel()).toContain('Week 1 return bands');
    expect(barLabel()).toContain('Rebuilding 0');
    expect(hasText(root, 'At or above')).toBe(true);
    expect(hasText(root, 'Week 1')).toBe(true);
  });

  test('rows keep the Baseline met / R3a clause / Added order, each with its own status word and no counted group headings (#1219)', () => {
    const root = setupMixed();
    expandDetails(root);

    expect(statusWords(root)).toEqual(['At or above baseline', 'Rebuilding', 'Added during recovery']);
    expect(hostRows(root).map(r => hostTextsIn(r)[0])).toEqual(['Pull-up', 'Bench', 'Foam Roll']);
    const headers = groupHeaders(root).map(h => h.props.children);
    expect(headers.some(h => /\(\d+\)$/.test(String(h)))).toBe(false);
  });

  test('every row is always visible — there is no filter that can hide one', () => {
    const root = setupMixed();
    expandDetails(root);

    const labels = rowLabels(root);
    expect(labels.some(l => l.startsWith('Bench, Rebuilding'))).toBe(true);
    expect(labels.some(l => l.startsWith('Pull-up, At or above baseline'))).toBe(true);
    expect(labels.some(l => l.startsWith('Foam Roll, Added during recovery'))).toBe(true);
  });

  test('the not-reintroduced row holds exactly the baseline work that never came back', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', '-Bench\n- 135 5,5,5')],
    }).root;
    expandDetails(root);

    expect(statusWords(root)).toEqual(['At or above baseline', 'Not trained yet']);
    const labels = rowLabels(root);
    expect(labels.some(l => l.startsWith('Pull-up, Not trained yet'))).toBe(true);
    expect(labels.some(l => l.startsWith('Bench, At or above baseline'))).toBe(true);
  });

  // The explanations moved behind a disclosure (#821) — permanent prose at the
  // head of the data panel was the bulk of the section's text weight. They are
  // still offered wherever the dimensions they define are shown, which is what
  // this test has always been about; only the number of taps changed.
  test('the weighted dimensions are explained where they are shown, on request', () => {
    const root = setupMixed();
    expandDetails(root);

    // #1219: the legend sentences and their disclosure are gone entirely; the
    // rows carry short metric names with numbers instead.
    expect(root.findAllByProps({ accessibilityLabel: 'What do these measurements mean?' })).toHaveLength(0);
    expect(hasText(root, 'What do these mean?')).toBe(false);
    expect(hasText(root, 'Load — the heaviest completed working set that week.')).toBe(false);
    expect(hasText(root, 'Not an all-time max or an estimated 1RM.')).toBe(false);
    expect(hasText(root, 'Per exercise, per week')).toBe(false);
    expect(hasText(root, 'Total work is per exercise')).toBe(false);
    expect(hasText(root, 'Load 135 lb / 135 lb')).toBe(true);
    expect(hasText(root, 'Total work')).toBe(true);
  });

  test('a week with no weighted work carries no weighted explanation', () => {
    const repsOnly = block({ baseline: captureRecoveryBaselineFromText('-Pull-up\n- 8,8,8') });
    const root = setup({
      blocks: [repsOnly],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', '-Pull-up\n- 8,8,8')],
    }).root;
    expandDetails(root);

    expect(hasText(root, 'Reps')).toBe(true);
    expect(hasText(root, 'heaviest completed working set')).toBe(false);
    expect(hasText(root, 'Total work')).toBe(false);
  });

  test('switching to another block opens on its own summary, with its own disclosure collapsed again', () => {
    const active = block({ id: 'rb-active', baseline_note_title: 'Current Routine' });
    const completed = block({
      id: 'rb-old',
      baseline_note_title: 'Old Routine',
      completed_at: '2026-04-01T00:00:00Z',
    });
    const root = setup({
      blocks: [active, completed],
      weeks: [
        week(1, 'note-active-w1', { id: 'rw-active-1', block_id: 'rb-active' }),
        week(1, 'note-old-w1', { id: 'rw-old-1', block_id: 'rb-old' }),
      ],
      notes: [note('note-active-w1', MIXED_TEXT), note('note-old-w1', BASELINE_TEXT)],
    }).root;

    expandDetails(root);
    expect(rowLabels(root).some(l => l.startsWith('Bench, Rebuilding'))).toBe(true);

    expandHistory(root);
    const historyRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' &&
        inst.props.accessibilityLabel.startsWith('View recovery evidence for Old Routine')
    )[0];
    act(() => { historyRow.props.onPress(); });

    // Collapsed again, on the new block's own summary.
    expect(byLabel(root, 'Expand exercise details')).toBeDefined();
    expect(byLabel(root, 'Collapse exercise details')).toBeUndefined();
    expect(hasText(root, '2 of 2')).toBe(true);

    expandDetails(root);
    expect(rowLabels(root).some(l => l.startsWith('Bench, At or above baseline'))).toBe(true);
  });

  test('a week whose note is unreadable states the R3a-worded notice above the disclosure, with no details to expand', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'ghost-note-id')],
      notes: [],
    }).root;

    expect(hasText(root, "Week 1 — This week's note is no longer available.")).toBe(true);
    expect(byLabel(root, 'Expand exercise details')).toBeUndefined();
  });
});

describe('AnalyticsRecoverySection — inclusion preference (#728)', () => {
  const { RECOVERY_INCLUSION_LABEL } = require('../components/RecoveryInclusionToggle');
  let mockSetInclude;

  function completedBlock(id, include = false) {
    return block({ id, completed_at: '2026-06-01T00:00:00Z', include_in_normal_analytics: include });
  }

  // The inclusion switches live on the completed-block rows inside the history
  // panel, which is collapsed by default since #758.
  function setupInclusion(props = {}) {
    let component;
    act(() => {
      component = render.create(
        <AnalyticsRecoverySection blocks={[]} weeks={[]} notes={[]} {...props} />
      );
    });
    const toggle = byLabel(component.root, 'Expand recovery history');
    if (toggle) act(() => { toggle.props.onPress(); });
    return component;
  }

  function switchesFor(root) {
    return root.findAll(
      n => n.props && typeof n.props.accessibilityLabel === 'string'
        && n.props.accessibilityLabel.startsWith(RECOVERY_INCLUSION_LABEL)
        && n.props.onValueChange
    );
  }

  beforeEach(() => {
    mockSetInclude = jest.fn().mockResolvedValue({ ok: true });
    jest.spyOn(require('../hooks/entries/recoveryBlockHooks'), 'useRecoveryBlockLifecycle')
      .mockReturnValue({ setIncludeInNormalAnalytics: mockSetInclude });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('completed blocks each expose an inclusion switch reflecting their stored preference', () => {
    const b1 = completedBlock('rb-a', false);
    const b2 = completedBlock('rb-b', true);
    const component = setupInclusion({ blocks: [b1, b2] });
    const controls = switchesFor(component.root);

    expect(controls.length).toBe(2);
    const byId = Object.fromEntries(
      controls.map(c => [c.props.testID.replace('recovery-inclusion-switch-', ''), c])
    );
    expect(byId['rb-a'].props.value).toBe(false);
    expect(byId['rb-b'].props.value).toBe(true);
  });

  test('each inclusion switch carries its own block identity in the spoken label', () => {
    const b1 = { ...completedBlock('rb-a'), baseline_note_title: 'Push Pull Legs' };
    const b2 = { ...completedBlock('rb-b'), baseline_note_title: 'Upper Lower' };
    const component = setupInclusion({ blocks: [b1, b2] });
    const controls = switchesFor(component.root);
    const byId = Object.fromEntries(
      controls.map(c => [c.props.testID.replace('recovery-inclusion-switch-', ''), c])
    );

    expect(byId['rb-a'].props.accessibilityLabel).toContain('Push Pull Legs');
    expect(byId['rb-b'].props.accessibilityLabel).toContain('Upper Lower');
    expect(byId['rb-a'].props.accessibilityLabel).not.toBe(byId['rb-b'].props.accessibilityLabel);
  });

  test('the active block has no inclusion switch in Analytics', () => {
    const active = block({ id: 'rbActive', completed_at: null });
    const component = setupInclusion({ blocks: [active] });
    expect(switchesFor(component.root).length).toBe(0);
  });

  test('a successful write calls setIncludeInNormalAnalytics with the correct args', async () => {
    const b = completedBlock('rb1', false);
    const component = setupInclusion({ blocks: [b] });
    const [control] = switchesFor(component.root);

    await act(async () => { await control.props.onValueChange(true); });
    expect(mockSetInclude).toHaveBeenCalledWith({ blockId: 'rb1', include: true });
  });

  test('a rejected write surfaces an error banner and leaves the switch at the stored value', async () => {
    const b = completedBlock('rb1', false);
    mockSetInclude.mockResolvedValue({ ok: false, error: 'Network error.' });
    const component = setupInclusion({ blocks: [b] });
    const [control] = switchesFor(component.root);

    await act(async () => { await control.props.onValueChange(true); });

    const allTexts = component.root.findAllByType('Text').map(t => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
    expect(allTexts).toContain('Network error.');
    expect(switchesFor(component.root)[0].props.value).toBe(false);
  });

  test('an in-flight write disables ALL completed-block switches, not just the one being written', async () => {
    const b1 = completedBlock('rb-a', false);
    const b2 = completedBlock('rb-b', true);
    let resolveWrite;
    mockSetInclude.mockImplementation(() => new Promise(resolve => { resolveWrite = resolve; }));
    const component = setupInclusion({ blocks: [b1, b2] });

    const byId = () => Object.fromEntries(
      switchesFor(component.root).map(c => [c.props.testID.replace('recovery-inclusion-switch-', ''), c])
    );
    expect(Object.values(byId()).every(c => !c.props.disabled)).toBe(true);

    await act(async () => { byId()['rb-a'].props.onValueChange(true); });
    expect(Object.values(byId()).every(c => c.props.disabled)).toBe(true);

    await act(async () => { resolveWrite({ ok: true }); });
    expect(Object.values(byId()).every(c => !c.props.disabled)).toBe(true);
  });

  test('mutationsAllowed=false disables every inclusion switch before any write', () => {
    const b = completedBlock('rb1', false);
    const component = setupInclusion({ blocks: [b], mutationsAllowed: false });
    const [control] = switchesFor(component.root);

    expect(control.props.disabled).toBe(true);
    expect(control.props.accessibilityState.disabled).toBe(true);
  });

  test('a pending recovery operation disables inclusion switches rather than letting them race', () => {
    const b = completedBlock('rb1', false);
    const component = setupInclusion({
      blocks: [b],
      pendingRecovery: [{ operation_id: 1, block_id: 'rb1', error: null }],
    });
    const [control] = switchesFor(component.root);

    expect(control.props.disabled).toBe(true);
    expect(control.props.accessibilityState.disabled).toBe(true);
  });
});

describe('AnalyticsRecoverySection — reopen the newest completed block (#839)', () => {
  let mockReopen;
  let alertSpy;

  function completedBlock(id, completedAt, title = 'Push Pull Legs') {
    return block({ id, completed_at: completedAt, baseline_note_title: title });
  }

  function setupReopen(props = {}) {
    let component;
    act(() => {
      component = render.create(
        <AnalyticsRecoverySection blocks={[]} weeks={[]} notes={[]} {...props} />
      );
    });
    return component;
  }

  function reopenButton(root) {
    return root.findAll(
      n => n.props && n.props.accessibilityLabel && n.props.accessibilityLabel.startsWith('Reopen recovery block:')
        && typeof n.props.onPress === 'function'
    )[0];
  }

  beforeEach(() => {
    mockReopen = jest.fn().mockResolvedValue({ ok: true });
    jest.spyOn(require('../hooks/entries/recoveryBlockHooks'), 'useRecoveryBlockLifecycle')
      .mockReturnValue({ setIncludeInNormalAnalytics: jest.fn(), reopenBlock: mockReopen });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Reopen appears on the newest completed block\'s own evidence card', () => {
    const newest = completedBlock('rb-newest', '2026-06-01T00:00:00.000Z');
    const older = completedBlock('rb-older', '2026-05-01T00:00:00.000Z');
    const component = setupReopen({ blocks: [newest, older] });

    expect(reopenButton(component.root)).toBeTruthy();
  });

  test('Reopen does not appear on an older completed block, even when focused', () => {
    const newest = completedBlock('rb-newest', '2026-06-01T00:00:00.000Z');
    const older = completedBlock('rb-older', '2026-05-01T00:00:00.000Z');
    const component = setupReopen({ blocks: [newest, older] });

    const toggle = byLabel(component.root, 'Expand recovery history');
    act(() => { toggle.props.onPress(); });
    const olderRow = byLabel(
      component.root,
      `View recovery evidence for ${older.baseline_note_title}, completed ${require('../lib/format').formatDate(older.completed_at)}`
    );
    act(() => { olderRow.props.onPress(); });

    expect(reopenButton(component.root)).toBeUndefined();
  });

  test('Reopen is absent while a block is active, even though a completed block exists', () => {
    const active = block({ id: 'rb-active', completed_at: null });
    const completed = completedBlock('rb-newest', '2026-06-01T00:00:00.000Z');
    const component = setupReopen({ blocks: [active, completed] });

    expect(reopenButton(component.root)).toBeUndefined();
  });

  test('tapping Reopen shows the #839 confirmation copy naming the baseline', () => {
    const newest = completedBlock('rb-newest', '2026-06-01T00:00:00.000Z', 'Push Pull Legs');
    const component = setupReopen({ blocks: [newest] });

    act(() => { reopenButton(component.root).props.onPress(); });

    expect(alertSpy).toHaveBeenCalledWith(
      'Reopen this recovery block?',
      expect.stringContaining('Push Pull Legs'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Reopen block' }),
      ])
    );
  });

  test('confirming calls reopenBlock with the block id', async () => {
    const newest = completedBlock('rb-newest', '2026-06-01T00:00:00.000Z');
    const component = setupReopen({ blocks: [newest] });

    act(() => { reopenButton(component.root).props.onPress(); });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => { await buttons.find(b => b.text === 'Reopen block').onPress(); });

    expect(mockReopen).toHaveBeenCalledWith({ blockId: 'rb-newest' });
  });

  test('a rejected reopen surfaces an error under the button and leaves the block completed', async () => {
    mockReopen.mockResolvedValue({ ok: false, error: 'Only the most recently completed recovery block can be reopened.' });
    const newest = completedBlock('rb-newest', '2026-06-01T00:00:00.000Z');
    const component = setupReopen({ blocks: [newest] });

    act(() => { reopenButton(component.root).props.onPress(); });
    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => { await buttons.find(b => b.text === 'Reopen block').onPress(); });

    expect(hasText(component.root, 'Only the most recently completed recovery block can be reopened.')).toBe(true);
    expect(reopenButton(component.root)).toBeTruthy();
  });

  test('an in-flight reopen disables the button and shows busy copy', async () => {
    let releaseReopen;
    mockReopen.mockImplementation(() => new Promise(resolve => { releaseReopen = resolve; }));
    const newest = completedBlock('rb-newest', '2026-06-01T00:00:00.000Z');
    const component = setupReopen({ blocks: [newest] });

    act(() => { reopenButton(component.root).props.onPress(); });
    const buttons = alertSpy.mock.calls[0][2];
    let confirmPromise;
    act(() => { confirmPromise = buttons.find(b => b.text === 'Reopen block').onPress(); });

    const busyBtn = reopenButton(component.root);
    expect(busyBtn.props.disabled).toBe(true);
    expect(hasText(component.root, 'Reopening…')).toBe(true);

    await act(async () => {
      releaseReopen({ ok: true });
      await confirmPromise;
    });
  });

  test('after a successful reopen, the block presents as active rather than completed history', () => {
    // Presentational component: the parent screen re-reads shared Recovery
    // state after `reopenBlock` resolves and passes updated props down — this
    // simulates that update directly, since AnalyticsRecoverySection itself
    // holds no block-lifecycle state of its own. `completed_at: null` is
    // exactly what a successful reopen persists.
    const reopened = block({ id: 'rb-newest', completed_at: null, baseline_note_title: 'Push Pull Legs' });
    const component = setupReopen({ blocks: [reopened] });

    // No completed-block history panel — the block is active, not history.
    expect(byLabel(component.root, 'Expand recovery history')).toBeUndefined();
    // Reopen never offers itself on an already-active block.
    expect(reopenButton(component.root)).toBeUndefined();
    // Provenance reads as an open-ended active block ("Started …"), not a
    // completed date range.
    expect(hasText(component.root, 'Started ')).toBe(true);
  });
});

// ── #1029 amendment: across-weeks band strip design-system pass ─────────────
//
// Required test 22: the strip must be a finished design-system surface (token
// color/spacing/type), legible at large accessibility text scale, must make an
// unreadable-week gap visually distinguishable from a readable zero-count
// week, must carry one accessible label per week, and must keep `Rebuilding`
// and `Early` distinguishable without legend lookup at the strip's actual
// rendered width.
describe('AnalyticsRecoverySection — across-weeks band strip (#1029 amendment)', () => {
  function flattenStyle(node) {
    return [].concat(node.props.style ?? []).reduce((acc, s) => Object.assign(acc, s || {}), {});
  }

  function weekCells(root) {
    // Host nodes only (`typeof inst.type === 'string'`) — the test renderer
    // otherwise reports both the composite `View` and its underlying host
    // node for the same element, doubling every match.
    return root.findAll(inst =>
      typeof inst.type === 'string'
      && typeof inst.props.testID === 'string'
      && inst.props.testID.startsWith('recovery-band-strip-week-'));
  }

  // Week 1: Bench returns 60/135 = 0.444 (early), Pull-up returns 17/24 = 0.708
  // (rebuilding) — both bands populated in the SAME week, at the strip's own
  // rendered width, exercising the adjacent-warm-hue requirement directly.
  // Week 2's note is unreadable (over the parser's size limit) — a real gap.
  // Week 3 trains neither baseline lift — a real, readable zero-count week.
  function setupStrip() {
    const b = block();
    const w1 = week(1, 'note-w1');
    const w2 = week(2, 'note-w2-bad');
    const w3 = week(3, 'note-w3');
    const notes = [
      note('note-w1', '-Bench\n- 60 5,5,5\n-Pull-up\n- 6,6,5'),
      note('note-w2-bad', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1)),
      note('note-w3', '-Overhead Press\n- 95 5,5,5'),
    ];
    return setup({ blocks: [b], weeks: [w1, w2, w3], notes });
  }

  test('renders one column per live week, each with its own accessible label', () => {
    const root = setupStrip().root;
    const cells = weekCells(root);
    expect(cells.length).toBe(3);
    for (const cell of cells) {
      expect(cell.props.accessible).toBe(true);
      expect(typeof cell.props.accessibilityLabel).toBe('string');
      expect(cell.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
    expect(cells.find(c => c.props.testID === 'recovery-band-strip-week-1').props.accessibilityLabel).toContain('Week 1');
    expect(cells.find(c => c.props.testID === 'recovery-band-strip-week-2').props.accessibilityLabel).toBe('Week 2: no readable evidence');
    expect(cells.find(c => c.props.testID === 'recovery-band-strip-week-3').props.accessibilityLabel).toContain('Week 3');
  });

  test('Rebuilding and Early are named in full (no letter codes) in labels and legend, with distinct token-colored dots', () => {
    const root = setupStrip().root;
    const week1Cell = weekCells(root).find(c => c.props.testID === 'recovery-band-strip-week-1');

    // Every band is named in full in the cell's accessible label.
    expect(week1Cell.props.accessibilityLabel).toContain('Rebuilding 1');
    expect(week1Cell.props.accessibilityLabel).toContain('Early 1');
    expect(week1Cell.props.accessibilityLabel).toContain("Can't compare 0");

    // The shared legend beneath the strip names each colored band in full.
    const texts = root.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
    expect(texts).toContain('Rebuilding');
    expect(texts).toContain('Early');
    expect(texts).not.toContain('R');
    expect(texts).not.toContain('E');

    const dotColors = root
      .findAll(inst => typeof inst.type === 'string' && flattenStyle(inst).width === 10)
      .map(inst => flattenStyle(inst).backgroundColor);
    // Distinct tokens (cautionText vs error), never the raw mark colors.
    expect(dotColors).toContain(LightColors.cautionText);
    expect(dotColors).toContain(HardCourtLightColors.error);
  });

  test('an unreadable-week gap is visually distinct from a readable zero-count week — different structure, different copy, never a bare empty box', () => {
    const root = setupStrip().root;
    const gapCell = weekCells(root).find(c => c.props.testID === 'recovery-band-strip-week-2');
    const zeroCell = weekCells(root).find(c => c.props.testID === 'recovery-band-strip-week-3');

    const gapTexts = gapCell.findAllByType('Text').map(t => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });
    const zeroTexts = zeroCell.findAllByType('Text').map(t => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join('') : String(c ?? '');
    });

    expect(gapTexts).toContain('No data');
    expect(zeroTexts).toContain('0 trained');
    expect(gapTexts).not.toContain('0 trained');
    expect(zeroTexts).not.toContain('No data');

    // Different visual treatment: the gap uses a dashed border, the zero-count
    // cell does not carry one of its own (only the shared outer cell border).
    const gapInner = gapCell.findAll(
      inst => typeof inst.type === 'string' && flattenStyle(inst).borderStyle === 'dashed'
    );
    expect(gapInner.length).toBeGreaterThan(0);
  });

  test('token-backed color, spacing, and type: dot colors resolve to theme tokens, and text is never clipped by numberOfLines', () => {
    const root = setupStrip().root;
    const week1Cell = weekCells(root).find(c => c.props.testID === 'recovery-band-strip-week-1');

    const allTexts = week1Cell.findAllByType('Text');
    for (const t of allTexts) {
      expect(t.props.numberOfLines).toBeUndefined();
    }

    const rChipBox = week1Cell.findAll(
      inst => typeof inst.type === 'string' && flattenStyle(inst).backgroundColor === LightColors.cautionText
    );
    expect(rChipBox.length).toBeGreaterThan(0);
  });
});

function flattenStyleOf(node) {
  return [].concat(node.props.style ?? []).reduce((acc, st) => Object.assign(acc, st || {}), {});
}

describe('AnalyticsRecoverySection — scannable hierarchy (#1209)', () => {
  const twoWeeks = () => setup({
    blocks: [block()],
    weeks: [week(1, 'note-w1'), week(2, 'note-w2')],
    notes: [
      note('note-w1', '-Bench\n- 135 5,5,5\n-Pull-up\n- 8,8,8'),
      note('note-w2', '-Bench\n- 135 5,5,5\n-Curl\n- 20 10,10'),
    ],
  }).root;

  test('hero states the current week first, above the comparison and bands', () => {
    const root = twoWeeks();
    const hero = root.findAll(n => n.props.testID === 'recovery-hero' && typeof n.type === 'string')[0];
    expect(hero.props.accessibilityLabel).toMatch(/^Week 2: \d+ of \d+ trained exercises at or above [A-Za-z ]+ baseline$/);
    expect(hasText(root, 'at or above Push Pull Legs baseline')).toBe(true);
    expect(hasText(root, 'trained exercises at or above baseline')).toBe(false);
    const order = root.findAll(n => ['recovery-hero', 'recovery-movement', 'recovery-bands-rows'].includes(n.props.testID) && typeof n.type === 'string')
      .map(n => n.props.testID);
    expect(order.indexOf('recovery-hero')).toBe(0);
  });

  test('the overview renders a named segmented bar, a three-part change visual, and across-weeks bars with no roster prose', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1'), week(2, 'note-w2')],
      notes: [
        note('note-w1', '-Bench\n- 135 5,5,5\n-Pull-up\n- 8,8,8'),
        note('note-w2', '-Bench\n- 135 5,5,5\n-Pull-up\n- 8,8,9'),
      ],
    }).root;
    const bar = root.findAll(n => n.props.testID === 'recovery-bands-rows' && typeof n.type === 'string')[0];
    expect(bar.props.accessibilityLabel).toMatch(/^Week 2 return bands across \d+ trained exercises: At or above \d+, Close \d+, Rebuilding \d+, Early \d+, Can't compare \d+$/);
    const segments = root.findAll(n => typeof n.type === 'string' && /^recovery-segment-/.test(n.props.testID || ''));
    expect(segments.length).toBeGreaterThan(0);
    const movement = root.findAll(n => n.props.testID === 'recovery-movement' && typeof n.type === 'string')[0];
    expect(movement.props.accessibilityLabel).toMatch(/improved, \d+ steady, \d+ fell back\.$/);
    // One improved, one steady, none fell back. Zero-count items are omitted
    // visually while the accessible label still reads every count.
    const movementTexts = movement.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
    expect(movementTexts).toContain('Steady');
    expect(movementTexts).toContain('Improved');
    expect(movementTexts).not.toContain('Fell back');
    expect(movement.props.accessibilityLabel).toContain('0 fell back');
    expect(root.findAll(n => n.props.testID === 'recovery-band-strip').length).toBeGreaterThan(0);
    for (const gone of ['roster exercises trained', 'not trained yet', 'Most common gap']) expect(hasText(root, gone)).toBe(false);
    // #1215: removed captions and the prose they restated no longer render.
    for (const gone of ['Across weeks', 'both weeks', 'Since Week', 'linked weeks', 'pick a week']) {
      expect(hasText(root, gone)).toBe(false);
    }
    expect(findAllText(root).filter(t => /^\d+ trained exercises?$/.test(t))).toEqual([]);
    // The bar is one thin band and the strip rows are thin horizontal bars.
    expect(flattenStyleOf(bar.findAll(n => typeof n.type === 'string' && n.props.style && n.props.style.height === 10)[0]).height).toBe(10);
    const weekBars = root.findAll(n => typeof n.type === 'string' && n.props.style && n.props.style.height === 6 && n.props.style.flexDirection === 'row');
    expect(weekBars.length).toBeGreaterThan(0);
    expect(root.findAll(n => n.props.name === 'trending-flat').length).toBeGreaterThan(0);
    // The strip sits above the drill-down header.
    const order = root.findAll(n => typeof n.type === 'string' && (n.props.testID === 'recovery-band-strip' || n.props.accessibilityLabel === 'Expand exercise details'));
    expect(order[0].props.testID).toBe('recovery-band-strip');
  });

  test('week picker is one compact labelled row with numeric chips and full accessible names', () => {
    const root = twoWeeks();
    const chip = byLabel(root, 'Week 1');
    expect(chip.props.accessibilityRole).toBe('button');
    expect(hasText(root, 'Week')).toBe(true);
    expect(hasText(root, '1')).toBe(true);
  });
});

describe('AnalyticsRecoverySection — per-week vs block state (#1193)', () => {
  function setupTwoWeeks() {
    return setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1'), week(2, 'note-w2')],
      notes: [
        note('note-w1', '-Bench\n- 135 5,5,5\n-Pull-up\n- 8,8,8'),
        note('note-w2', '-Bench\n- 135 5,5,5\n-Curl\n- 20 10,10'),
      ],
    }).root;
  }

  test('the selected week is named by the hero and the picker state, with no selection sentence', () => {
    const root = setupTwoWeeks();
    expect(hasText(root, 'linked weeks')).toBe(false);
    expect(hasText(root, 'pick a week')).toBe(false);
    expect(byLabel(root, 'Week 2').props.accessibilityState.selected).toBe(true);
    expect(byLabel(root, 'Week 1').props.accessibilityState.selected).toBe(false);
    act(() => { byLabel(root, 'Week 1').props.onPress(); });
    expect(byLabel(root, 'Week 1').props.accessibilityState.selected).toBe(true);
    expect(root.findAll(n => n.props.testID === 'recovery-hero' && typeof n.type === 'string')[0].props.accessibilityLabel).toMatch(/^Week 1:/);
    expect(hasText(root, 'linked weeks')).toBe(false);
  });

  test('a single linked week has no selection caption', () => {
    const root = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', '-Bench\n- 135 5,5,5')] }).root;
    expect(hasText(root, 'linked weeks')).toBe(false);
  });

  test('an exercise present only in another week is told apart from one never trained', () => {
    const root = setupTwoWeeks();
    expandDetails(root);
    // Pull-up trained in Week 1 only; viewing Week 2 it is absent, not missing.
    expect(rowLabels(root).some(l => l.startsWith('Pull-up, Not trained yet. Not in Week 2 · trained in Week 1'))).toBe(true);
    // The cross-week prose is spoken only (#1219); the row shows the status
    // word and the baseline number.
    expect(hasText(root, 'Not in Week 2')).toBe(false);
    expect(hasText(root, 'trained in Week 1')).toBe(false);
    expect(hasText(root, 'Baseline Reps 24 reps')).toBe(true);
    // Added-during-recovery work stays its own row.
    expect(rowLabels(root).some(l => l.startsWith('Curl, Added during recovery'))).toBe(true);

    act(() => { byLabel(root, 'Week 1').props.onPress(); });
    expect(hasText(root, 'Not trained in any linked week')).toBe(false);
  });

  test('a baseline exercise never trained in any week says so', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1'), week(2, 'note-w2')],
      notes: [note('note-w1', '-Bench\n- 135 5,5,5'), note('note-w2', '-Bench\n- 135 5,5,5')],
    }).root;
    expandDetails(root);
    expect(rowLabels(root).some(l => l.startsWith('Pull-up, Not trained yet. Not trained in any linked week'))).toBe(true);
  });

  test('Total work stays per exercise and per week in each row\'s own numbers, with no scope paragraph', () => {
    const root = setupTwoWeeks();
    expandDetails(root);
    expect(hasText(root, 'Total work is per exercise')).toBe(false);
    expect(hasText(root, 'not a block total')).toBe(false);
    expect(hasText(root, 'frozen starting value')).toBe(false);
    // Each weighted row carries its own current / baseline Total work figures.
    expect(hasText(root, 'Total work 2025 lb / 2025 lb')).toBe(true);
  });

  test('logged but uncomparable work in another week still counts as trained there', () => {
    const notComparable = mockRow({ key: 'pull-up', name: 'Pull-up', state: RECOVERY_COMPARISON_STATES.NOT_COMPARABLE, exercise_class: 'reps', unavailable_reason: 'exercise_class_changed' });
    const absent = { ...mockRow({ key: 'pull-up', name: 'Pull-up', state: RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED, exercise_class: 'reps' }), week_name: null };
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [
      mockWeek({ week_id: 'rw1', week_number: 1, exercises: [{ ...notComparable, week_name: 'Pull-up' }] }),
      mockWeek({ week_id: 'rw2', week_number: 2, exercises: [absent] }),
    ] }));
    const root = setup({ blocks: [block()], weeks: [week(1, 'n1'), week(2, 'n2')], notes: [] }).root;
    expandDetails(root);
    expect(rowLabels(root).some(l => l.startsWith('Pull-up, Not trained yet. Not in Week 2 · trained in Week 1'))).toBe(true);
  });

  test('an unavailable selected week is not described as compared', () => {
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [
      mockWeek({ week_id: 'rw1', week_number: 1 }),
      mockWeek({ week_id: 'rw2', week_number: 2, status: RECOVERY_WEEK_STATUS.NOTE_MISSING }),
    ] }));
    const root = setup({ blocks: [block()], weeks: [week(1, 'n1'), week(2, 'n2')], notes: [] }).root;
    expect(hasText(root, 'linked weeks')).toBe(false);
    expect(hasText(root, 'compared with the baseline')).toBe(false);
    expect(root.findAll(n => n.props.testID === 'recovery-hero' && typeof n.type === 'string').length).toBe(0);
  });

  test('an unreadable other week blocks the "never trained" claim', () => {
    const absent = mockRow({ key: 'pull-up', name: 'Pull-up', state: RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED, exercise_class: 'reps' });
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [
      mockWeek({ week_id: 'rw1', week_number: 1, status: RECOVERY_WEEK_STATUS.NOTE_UNREADABLE }),
      mockWeek({ week_id: 'rw2', week_number: 2, exercises: [absent] }),
    ] }));
    const root = setup({ blocks: [block()], weeks: [week(1, 'n1'), week(2, 'n2')], notes: [] }).root;
    expandDetails(root);
    expect(rowLabels(root).some(l => l.startsWith('Pull-up, Not trained yet. Not trained in any readable linked week'))).toBe(true);
  });

  test('the Total work scope note is not shown when only baseline values are on screen', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', '-Chin-up\n- 8,8')],
    }).root;
    expandDetails(root);
    expect(hasText(root, 'Total work is per exercise')).toBe(false);
  });

  test('a stale snapshot never claims an exercise was trained in no linked week', () => {
    const root = (() => {
      let c;
      act(() => {
        c = render.create(
          <AnalyticsRecoverySection
            blocks={[block()]}
            weeks={[week(1, 'note-w1'), week(2, 'note-w2')]}
            notes={[note('note-w1', '-Bench\n- 135 5,5,5'), note('note-w2', '-Bench\n- 135 5,5,5')]}
            stateStale
          />
        );
      });
      return c.root;
    })();
    expandDetails(root);
    expect(hasText(root, 'Not trained in any')).toBe(false);
    expect(hasText(root, 'trained in Week')).toBe(false);
    expect(hasText(root, 'as last loaded. Showing')).toBe(false);
    expect(root.findAll(n => n.props.testID === 'recovery-movement' && typeof n.type === 'string').length).toBe(0);
    expect(rowLabels(root).some(l => l.startsWith('Pull-up, Not trained yet. Not in Week 2'))).toBe(true);
  });
});

// ── #1219 amendment: routine-anchored hero, phone-safe week picker, visual rows ──

describe('AnalyticsRecoverySection — routine-anchored hero label (#1219)', () => {
  const heroNode = (root) => root.findAll(n => n.props.testID === 'recovery-hero' && typeof n.type === 'string')[0];
  const oneWeek = (title) => setup({
    blocks: [block({ baseline_note_title: title })],
    weeks: [week(1, 'note-w1')],
    notes: [note('note-w1', BASELINE_TEXT)],
  }).root;

  test('the hero label names the routine and the bottom line no longer repeats it', () => {
    const root = oneWeek('Push Pull Legs');
    expect(hasText(root, 'at or above Push Pull Legs baseline')).toBe(true);
    expect(heroNode(root).props.accessibilityLabel).toBe('Week 1: 2 of 2 trained exercises at or above Push Pull Legs baseline');
    expect(findAllText(root).some(t => t.startsWith('Baseline:'))).toBe(false);
    expect(hasText(root, 'Started 05-01-2026')).toBe(true);
  });

  test('a long routine name ellipsizes on screen while the accessible label keeps the whole name', () => {
    const full = 'Upper Lower Push Pull Legs Hypertrophy Block';
    const root = oneWeek(full);
    const visible = findAllText(root).find(t => t.startsWith('at or above') && t.endsWith('baseline'));
    expect(visible).toContain('…');
    expect(visible).not.toContain(full);
    expect(visible.length).toBeLessThanOrEqual('at or above  baseline'.length + 24);
    expect(heroNode(root).props.accessibilityLabel).toContain(`at or above ${full} baseline`);
    // The full name appears nowhere visible.
    expect(findAllText(root).some(t => t.includes(full))).toBe(false);
  });

  describe('routine label truncation by code point', () => {
    const { routineLabel, ROUTINE_LABEL_MAX } = require('../components/recovery/RecoveryVisuals');
    const hasLoneSurrogate = (t) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t);
    const ascii = (n) => 'a'.repeat(n);

    test('exactly at the limit keeps the whole title with no ellipsis; one over is cut with one', () => {
      expect(routineLabel(ascii(ROUTINE_LABEL_MAX)).visible).toBe(ascii(ROUTINE_LABEL_MAX));
      const over = routineLabel(ascii(ROUTINE_LABEL_MAX + 1));
      expect(over.visible).toBe(`${ascii(ROUTINE_LABEL_MAX - 1)}…`);
      expect(over.full).toBe(ascii(ROUTINE_LABEL_MAX + 1));
    });

    test.each([21, 22, 23, 24])('an emoji straddling the cut after %i ASCII chars is never split', (n) => {
      const title = `${ascii(n)}💪${ascii(10)}`;
      const { visible, full } = routineLabel(title);
      expect(hasLoneSurrogate(visible)).toBe(false);
      expect(visible).not.toContain('\uFFFD');
      expect(full).toBe(title);
      expect(Array.from(visible).length).toBeLessThanOrEqual(ROUTINE_LABEL_MAX);
      expect(visible.endsWith('…')).toBe(true);
    });

    test('an astral emoji at exactly the limit is counted as one character, so it is not cut', () => {
      const title = `${ascii(ROUTINE_LABEL_MAX - 1)}💪`;
      expect(title.length).toBe(ROUTINE_LABEL_MAX + 1); // UTF-16 length would wrongly trip a slice
      expect(routineLabel(title).visible).toBe(title);
    });

    test('ZWJ emoji and accented text are cut only between code points, never inside a surrogate pair', () => {
      const family = '👨‍👩‍👧‍👦';
      for (const title of [`${ascii(20)}${family}${family}`, `${'é'.repeat(30)}`, `${ascii(22)}e\u0301${ascii(5)}`]) {
        const { visible, full } = routineLabel(title);
        expect(hasLoneSurrogate(visible)).toBe(false);
        expect(full).toBe(title);
      }
    });

    test('the rendered hero shows the safely cut name and the accessible label the full emoji title', () => {
      const title = `${ascii(22)}💪 Hypertrophy Block`;
      const root = setup({ blocks: [block({ baseline_note_title: title })], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
      const visible = findAllText(root).find(t => t.startsWith('at or above') && t.endsWith('baseline'));
      expect(hasLoneSurrogate(visible)).toBe(false);
      expect(visible).toContain('…');
      expect(heroNode(root).props.accessibilityLabel).toContain(`at or above ${title} baseline`);
    });
  });

  test('an untitled routine falls back to "Untitled Routine" visibly and accessibly', () => {
    for (const title of ['', '   ', null]) {
      const root = oneWeek(title);
      expect(hasText(root, 'at or above Untitled Routine baseline')).toBe(true);
      expect(heroNode(root).props.accessibilityLabel).toContain('at or above Untitled Routine baseline');
    }
  });

  test('zero-trained hero path names the routine once and the bottom line does not repeat it', () => {
    // Nothing from the baseline was trained: hero shows "Nothing trained yet".
    const root = setup({
      blocks: [block({ baseline_note_title: 'Push Pull Legs' })],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', '-Sled Push\n- 100 5,5')],
    }).root;
    expect(hasText(root, 'Nothing trained yet')).toBe(true);
    expect(findAllText(root).filter(t => t.includes('Push Pull Legs'))).toEqual(['against Push Pull Legs baseline']);
    expect(heroNode(root).props.accessibilityLabel).toBe('Week 1: no roster exercises trained yet against Push Pull Legs baseline');
    expect(findAllText(root).some(t => t.startsWith('Baseline:'))).toBe(false);
    expect(hasText(root, 'Started 05-01-2026')).toBe(true);
  });

  test('zero-trained hero with a long or untitled routine keeps the same single-naming rule', () => {
    for (const [title, visibleHas, full] of [['Upper Lower Push Pull Legs Hypertrophy Block', '…', 'Upper Lower Push Pull Legs Hypertrophy Block'], ['', 'Untitled Routine', 'Untitled Routine']]) {
      const root = setup({
        blocks: [block({ baseline_note_title: title })],
        weeks: [week(1, 'note-w1')],
        notes: [note('note-w1', '-Sled Push\n- 100 5,5')],
      }).root;
      const named = findAllText(root).filter(t => t.startsWith('against'));
      expect(named).toHaveLength(1);
      expect(named[0]).toContain(visibleHas);
      expect(heroNode(root).props.accessibilityLabel).toContain(full);
      expect(findAllText(root).some(t => t.startsWith('Baseline:'))).toBe(false);
    }
  });

  test('every no-hero path (missing note, unreadable note) names the routine exactly once, in the bottom line', () => {
    const missing = setup({ blocks: [block()], weeks: [week(1, 'ghost')], notes: [] }).root;
    const unreadable = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1))] }).root;
    for (const root of [missing, unreadable]) {
      expect(root.findAll(n => n.props.testID === 'recovery-hero' && typeof n.type === 'string')).toHaveLength(0);
      expect(findAllText(root).filter(t => t.includes('Push Pull Legs'))).toEqual(['Baseline: Push Pull Legs · Started 05-01-2026']);
    }
  });

  test('with no hero (no week logged) the routine is still named once, in the bottom line', () => {
    const root = setup({ blocks: [block()], weeks: [], notes: [] }).root;
    expect(findAllText(root).filter(t => t.includes('Push Pull Legs'))).toEqual(['Baseline: Push Pull Legs · Started 05-01-2026']);
  });
});

describe('AnalyticsRecoverySection — phone-safe week picker (#1219)', () => {
  const { StyleSheet } = require('react-native');
  const {
    computeWeekPickerLayout, WEEK_CHIP_MIN,
  } = require('../components/recovery/RecoveryWeekPicker');

  const weekSet = (n) => Array.from({ length: n }, (_, i) => week(i + 1, `note-w${i + 1}`, i === 0 ? { completed_at: '2026-05-09T00:00:00Z' } : {}));
  const notesFor = (n) => Array.from({ length: n }, (_, i) => note(`note-w${i + 1}`, BASELINE_TEXT));
  const mountWeeks = (n) => setup({ blocks: [block()], weeks: weekSet(n), notes: notesFor(n) }).root;
  const host = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
  const chips = (root) => root.findAll(n => typeof n.type === 'string' && /^recovery-week-chip-\d+$/.test(n.props.testID || ''));
  const styleOf = (c) => StyleSheet.flatten(c.props.style);

  beforeEach(() => { mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 }; });

  describe('layout decision (weeks x width x font scale)', () => {
    // Expected mode per contract: forced scroll first (13+ weeks, fontScale >=
    // 1.3, width too narrow for 3 chips), then 1-6 weeks single-row when 44dp
    // chips fit else the strip, then 7-12 balanced rows. Width 252 is a
    // compact phone card, 322/390 are ordinary, 640 is a wide layout.
    const MODE = (count, width, fs) => {
      if (count > 12 || fs >= 1.3) return 'scroll';
      const perRowMax = Math.floor((width + 4) / 48);
      if (perRowMax < 3) return 'scroll';
      if (count <= perRowMax) return 'single';
      return count <= 6 ? 'scroll' : 'grid';
    };
    const cases = [];
    for (const count of [1, 2, 6, 7, 9, 12, 13]) {
      for (const width of [252, 322, 390, 640]) {
        for (const fs of [1, 1.5, 2]) cases.push([count, width, fs, MODE(count, width, fs)]);
      }
    }
    test.each(cases)('%i weeks @ %idp, %sx font -> %s, never a wrapped orphan', (count, width, fs, mode) => {
      const l = computeWeekPickerLayout({ count, width, fontScale: fs });
      expect(l.mode).toBe(mode);
      expect(l.chipWidth).toBeGreaterThanOrEqual(WEEK_CHIP_MIN);
      expect(l.rowSizes.reduce((n, x) => n + x, 0)).toBe(count);
      if (mode === 'single' || mode === 'scroll') expect(l.rows).toBe(1);
      if (mode === 'grid') {
        // Balanced: sizes differ by at most one and no row is a lone chip.
        expect(Math.max(...l.rowSizes) - Math.min(...l.rowSizes)).toBeLessThanOrEqual(1);
        expect(Math.min(...l.rowSizes)).toBeGreaterThanOrEqual(2);
        expect(l.rowSizes[0] * l.chipWidth + (l.rowSizes[0] - 1) * 4).toBeLessThanOrEqual(width);
      }
      if (mode === 'single') expect(l.chipWidth * count + (count - 1) * 4).toBeLessThanOrEqual(width);
      // Ordinary 1-6 week sets never become a wrapped grid.
      if (count <= 6) expect(l.mode).not.toBe('grid');
    });

    test('the spec examples: 6 @ 322 / 1.5x scrolls, 13 on a wide layout scrolls, 6 @ 252 scrolls', () => {
      expect(computeWeekPickerLayout({ count: 6, width: 322, fontScale: 1.5 }).mode).toBe('scroll');
      expect(computeWeekPickerLayout({ count: 13, width: 640 }).mode).toBe('scroll');
      expect(computeWeekPickerLayout({ count: 6, width: 252 }).mode).toBe('scroll');
      expect(computeWeekPickerLayout({ count: 6, width: 322 }).mode).toBe('single');
      expect(computeWeekPickerLayout({ count: 6, width: 292 }).mode).toBe('single');
    });
  });

  describe('rendered picker', () => {
    test('one week has no picker (nothing to choose)', () => {
      expect(host(mountWeeks(1), 'recovery-week-picker')).toHaveLength(0);
    });

    test('six weeks render on a single row with >= 44dp chips, labels, selection and completed state', () => {
      const root = mountWeeks(6);
      expect(host(root, 'recovery-week-picker-row-0')).toHaveLength(1);
      expect(host(root, 'recovery-week-picker-row-1')).toHaveLength(0);
      expect(chips(root)).toHaveLength(6);
      chips(root).forEach(c => {
        expect(styleOf(c).width).toBeGreaterThanOrEqual(44);
        expect(styleOf(c).minHeight).toBeGreaterThanOrEqual(44);
      });
      expect(byLabel(root, 'Week 1, completed')).toBeDefined();
      expect(byLabel(root, 'Week 2')).toBeDefined();
      expect(byLabel(root, 'Week 6').props.accessibilityState).toEqual({ selected: true });
      expect(byLabel(root, 'Week 5').props.accessibilityState).toEqual({ selected: false });
      act(() => { byLabel(root, 'Week 2').props.onPress(); });
      expect(byLabel(root, 'Week 2').props.accessibilityState).toEqual({ selected: true });
      expect(byLabel(root, 'Week 6').props.accessibilityState).toEqual({ selected: false });
      // The week change is announced through the existing live region.
      expect(root.findAll(n => n.props.accessibilityLiveRegion === 'polite' && typeof n.type === 'string').length).toBe(1);
      expect(host(root, 'recovery-hero')[0].props.accessibilityLabel).toMatch(/^Week 2:/);
    });

    test.each([7, 12])('%i weeks render as two balanced rows with every chip present', (count) => {
      const root = mountWeeks(count);
      const r0 = host(root, 'recovery-week-picker-row-0')[0];
      const r1 = host(root, 'recovery-week-picker-row-1')[0];
      expect(host(root, 'recovery-week-picker-row-2')).toHaveLength(0);
      const inRow = (r) => r.findAll(n => typeof n.type === 'string' && /^recovery-week-chip-/.test(n.props.testID || '')).length;
      expect(inRow(r0) + inRow(r1)).toBe(count);
      expect(inRow(r1)).toBeGreaterThanOrEqual(inRow(r0) - 1);
      for (let i = 1; i <= count; i++) expect(byLabel(root, i === 1 ? 'Week 1, completed' : `Week ${i}`)).toBeDefined();
    });

    test('13 weeks use a horizontally scrollable strip rather than compressed chips', () => {
      const root = mountWeeks(13);
      expect(host(root, 'recovery-week-picker-scroll').length).toBeGreaterThan(0);
      expect(host(root, 'recovery-week-picker-row-0')).toHaveLength(0);
      expect(chips(root)).toHaveLength(13);
      chips(root).forEach(c => expect(styleOf(c).width).toBeGreaterThanOrEqual(44));
    });

    test('in strip mode the selected chip is scrolled into view', () => {
      const { ScrollView } = require('react-native');
      const root = mountWeeks(13);
      const calls = () => root.findByType(ScrollView).instance.scrollTo.mock.calls;
      expect(host(root, 'recovery-week-picker-scroll').length).toBeGreaterThan(0);
      // Newest week (13) is selected by default, far from the origin.
      expect(calls().length).toBeGreaterThan(0);
      expect(calls()[calls().length - 1][0].x).toBeGreaterThan(300);
      act(() => { byLabel(root, 'Week 1, completed').props.onPress(); });
      expect(calls()[calls().length - 1][0].x).toBe(0);
    });

    test('a large font scale degrades a multi-row set to the scrollable strip', () => {
      mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1.6 };
      const root = mountWeeks(8);
      expect(host(root, 'recovery-week-picker-scroll').length).toBeGreaterThan(0);
      expect(chips(root)).toHaveLength(8);
    });

    test('a constrained measured width degrades to the strip and keeps the selected week', () => {
      const root = mountWeeks(8);
      expect(host(root, 'recovery-week-picker-row-1')).toHaveLength(1);
      act(() => { byLabel(root, 'Week 3').props.onPress(); });
      expect(byLabel(root, 'Week 3').props.accessibilityState).toEqual({ selected: true });
      act(() => { host(root, 'recovery-week-picker')[0].props.onLayout({ nativeEvent: { layout: { width: 100 } } }); });
      expect(host(root, 'recovery-week-picker-scroll').length).toBeGreaterThan(0);
      expect(byLabel(root, 'Week 3').props.accessibilityState).toEqual({ selected: true });
      act(() => { host(root, 'recovery-week-picker')[0].props.onLayout({ nativeEvent: { layout: { width: 322 } } }); });
      expect(host(root, 'recovery-week-picker-row-0')).toHaveLength(1);
      expect(byLabel(root, 'Week 3').props.accessibilityState).toEqual({ selected: true });
    });
  });
});

describe('AnalyticsRecoverySection — visual exercise details (#1219)', () => {
  const { StyleSheet } = require('react-native');
  // Bench: load back, total work two thirds, floored to 66% (rebuilding). Pull-up fully back.
  // Foam Roll is added work. Curl exists only in the baseline.
  const BASE = '-Bench\n- 135 5,5,5\n-Pull-up\n- 8,8,8\n-Curl\n- 20 10,10';
  const WEEK = '-Bench\n- 135 5,5\n-Pull-up\n- 8,8,8\n-Foam Roll\n- 10,10';
  const props = () => ({
    blocks: [block({ baseline: captureRecoveryBaselineFromText(BASE) })],
    weeks: [week(1, 'note-w1')],
    notes: [note('note-w1', WEEK)],
  });
  const mount = () => {
    const root = setup(props()).root;
    expandDetails(root);
    return root;
  };
  const rowTexts = (root) => hostRows(root).map(r => hostTextsIn(r));
  const hostById = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);

  test('each row is name + status word, and compared rows add one thin bar with its percent and concise numbers', () => {
    const rows = rowTexts(mount());
    expect(rows.map(r => r[0])).toEqual(['Pull-up', 'Bench', 'Curl', 'Foam Roll']);
    expect(rows.map(r => r[1])).toEqual(['At or above baseline', 'Rebuilding', 'Not trained yet', 'Added during recovery']);
    const bench = rows[1];
    expect(bench).toContain('66%');
    expect(bench).toContain('Load 135 lb / 135 lb');
    expect(bench.some(t => t.startsWith('Total work '))).toBe(true);
    // Rows stay short: only tokens, never sentences.
    for (const r of rows) for (const t of r) expect(t.length).toBeLessThanOrEqual(40);
    expect(rows.every(r => r.length <= 5)).toBe(true);
  });

  test('one bar per compared row, filled to the limiting metric; absent and added rows get no bar', () => {
    const root = mount();
    const bars = hostById(root, 'recovery-exercise-bar');
    expect(bars).toHaveLength(2);
    const fills = bars.map(b => StyleSheet.flatten(b.children[0].props.style).width);
    expect(fills).toEqual(['100%', '66%']);
    // Missing is not zero: the not-trained row shows baseline numbers only.
    const curl = rowTexts(root)[2];
    expect(curl.some(t => t.includes('%'))).toBe(false);
    expect(curl).toContain('Baseline Load 20 lb');
  });

  test('at fontScale 2 a long exercise name is never clipped and the header wraps so the status can stack under it', () => {
    mockWindow = { width: 390, height: 844, scale: 3, fontScale: 2 };
    const longName = 'Single-Arm Dumbbell Incline Neutral-Grip Press (paused)';
    const root = setup({
      blocks: [block({ baseline: captureRecoveryBaselineFromText(`-${longName}\n- 50 8,8,8\n-Pull-up\n- 8,8,8`) })],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', `-${longName}\n- 50 8,8,8\n-Foam Roll\n- 10,10`)],
    }).root;
    expandDetails(root);
    const rows = hostRows(root);
    const names = rows.map(r => r.findAll(n => typeof n.type === 'string' && n.type === 'Text')[0]);
    // No numberOfLines clipping on any exercise name.
    names.forEach(n => expect(n.props.numberOfLines).toBeUndefined());
    expect(hostTextsIn(rows[0])[0]).toBe(longName);
    // Header can wrap; name shrinks/grows rather than owning a fixed flex slot;
    // the dot and the status word stay one unit.
    const header = rows[0].findAll(n => typeof n.type === 'string' && StyleSheet.flatten(n.props.style || {}).flexWrap === 'wrap')[0];
    expect(header).toBeDefined();
    expect(StyleSheet.flatten(names[0].props.style)).toMatchObject({ flexShrink: 1, flexGrow: 1 });
    const status = rows[0].findAll(n => typeof n.type === 'string' && n.props.testID === 'recovery-exercise-mark')[0].parent.parent;
    expect(StyleSheet.flatten(status.props.style)).toMatchObject({ flexDirection: 'row', flexShrink: 0 });
    // Longest status words are present and unabbreviated.
    expect(statusWords(root)).toEqual(expect.arrayContaining(['Added during recovery']));
    expect(statusWords(root).every(w => !/\.\.\.|…/.test(w))).toBe(true);
    mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
  });

  test('the status mark pairs a band color with the word and differs between bands', () => {
    const root = mount();
    const marks = hostById(root, 'recovery-exercise-mark').map(m => StyleSheet.flatten(m.props.style).backgroundColor);
    expect(marks).toHaveLength(4);
    expect(marks.every(Boolean)).toBe(true);
    expect(new Set([marks[0], marks[1], marks[2]]).size).toBe(3);
    // Every mark has adjacent status text, so color is never alone.
    expect(statusWords(root).every(w => typeof w === 'string' && w.length > 3)).toBe(true);
  });

  test('the roster lines became one bar + stat row on the same 13sp tier as the rows', () => {
    const root = mount();
    // BASE has 3 roster exercises; Curl is not trained this week.
    expect(rosterLabel(root)).toBe('Trained this week: 2 of 3 roster exercises, 1 not trained yet. Most common gap: Total work.');
    const texts = hostTextsIn(rosterNode(root));
    expect(texts).toEqual(['2', 'trained', '1', 'not yet', 'Gap: Total work']);
    const sizes = rosterNode(root)
      .findAll(n => typeof n.type === 'string' && n.type === 'Text')
      .map(n => StyleSheet.flatten(n.props.style).fontSize);
    expect(new Set(sizes)).toEqual(new Set([13]));
    const rowSize = StyleSheet.flatten(hostRows(root)[0].findAll(n => n.type === 'Text')[1].props.style).fontSize;
    expect(rowSize).toBe(13);
    expect(hasText(root, 'Trained this week')).toBe(false);
    expect(hasText(root, 'Most common gap')).toBe(false);
  });

  test('paragraph copy is gone from the panel but full sentences stay in the row labels', () => {
    const root = mount();
    for (const prose of [
      'Total work is per exercise', 'not a block total', 'What do these mean?', 'frozen starting value',
      'heaviest completed working set', 'Not in Week', 'trained in Week', 'Not trained in any',
      'names differ', 'Week 1 · ',
    ]) {
      expect(hasText(root, prose)).toBe(false);
    }
    const labels = rowLabels(root);
    expect(labels.find(l => l.startsWith('Bench, Rebuilding'))).toContain('Total work 66%');
    expect(labels.find(l => l.startsWith('Curl, Not trained yet'))).toContain('Not trained in any linked week');
    expect(labels.find(l => l.startsWith('Pull-up, At or above baseline'))).toContain('Reps 100%');
  });

  test('a stale snapshot keeps the rows but makes no cross-week claim in the label', () => {
    let c;
    act(() => {
      c = render.create(<AnalyticsRecoverySection {...props()} stateStale />);
    });
    expandDetails(c.root);
    expect(statusWords(c.root)).toContain('Not trained yet');
    const label = rowLabels(c.root).find(l => l.startsWith('Curl, Not trained yet'));
    expect(label).toContain('Not in Week 1');
    expect(label).not.toContain('Not trained in any');
  });
});
