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
    expect(rosterLabel(root)).toBe("Trained this week: 2 of 2 roster exercises. By status: At or above 2, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 0, Added during recovery 0.");
    expect(hasText(root, 'Trained this week')).toBe(false);
    expect(hasText(root, 'roster exercises trained.')).toBe(false);
    expect(statusWords(root)).toEqual(['At or above', 'At or above']);
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
    expect(rosterLabel(root)).toBe("Trained this week: 1 of 1 roster exercises. By status: At or above 1, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 1, Added during recovery 1.");
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
    const ctxText = texts.find(t => t === '05-01-2026');
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
    expect(sizeOf(hostText(root, 'Push Pull Legs baseline')[0]).fontSize).toBe(13);
    expect(sizeOf(hostText(root, 'torn hamstring')[0]).fontSize).toBeGreaterThanOrEqual(13);
  });

  test('the reason and routine sit at the bottom: hero first, then Baseline context, then Reason', () => {
    const b = block({ reason: 'torn hamstring', started_at: '2026-05-01T00:00:00Z' });
    const root = setup({ blocks: [b], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    const texts = findAllText(root);
    const hero = texts.indexOf('2 of 2');
    const ctx = texts.indexOf('05-01-2026');
    const reason = texts.indexOf('torn hamstring');
    expect(hero).toBeGreaterThan(-1);
    expect(ctx).toBeGreaterThan(hero);
    expect(reason).toBeGreaterThan(ctx);
    // The routine is named once, by the hero label (#1219) — never again in the
    // bottom provenance line.
    expect(texts.filter(t => t.includes('Push Pull Legs'))).toEqual(['Push Pull Legs baseline']);
    expect(texts.includes('Baseline')).toBe(false);
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

    expect(hasText(root, 'Push Pull Legs baseline')).toBe(true);
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

    expect(findAllText(root).filter(t => t.includes('Push Pull Legs'))).toEqual(['Push Pull Legs']);
    expect(findAllText(root)).toContain('Baseline');
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

    expect(hasText(root, '05-01-2026')).toBe(true);
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

    expect(hasText(root, '04-01-2026 –')).toBe(true);
    expect(hasText(root, '04-29-2026')).toBe(true);
  });

  // Scoped to host nodes only, matching the `groupHeaders` dedup pattern —
  // the test renderer otherwise reports the composite and host node separately
  // for the same element.
  function liveRegions(root) {
    return root.findAll(
      // The "About these numbers" note has its own live region (#1219); this
      // helper is about the week-status region only.
      inst => typeof inst.type === 'string' && inst.props.accessibilityLiveRegion === 'polite' && inst.props.testID !== 'recovery-about-note'
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

    expect(byLabel(root, "Week 2 return bands across 2 trained exercises: At or above 2, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 0, Added during recovery 0")).toBeDefined();
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
      ['close', R.REBUILDING, [metricRow('top_load', 128, 135, 95, false)], 'Rebuilding'],
      ['mid', R.REBUILDING, [metricRow('top_load', 95, 135, 70, false)], 'Rebuilding'],
      ['low', R.REBUILDING, [metricRow('top_load', 40, 135, 29, false)], 'Early'],
      ['met', R.BASELINE_MET, [metricRow('top_load', 135, 135, 100, true)], 'At or above'],
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
      inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.startsWith('Bench, At or above')
    )[0];
    expect(benchRow).toBeDefined();
    expect(benchRow.props.accessibilityLabel).toContain('Load 100%');
    expect(benchRow.props.accessibilityLabel).toContain('Load 100% of baseline, 135 lb this week against 135 lb pre-recovery baseline');
    expect(benchRow.props.accessibilityLabel).toContain('Total work 100% of baseline, 2025 lb this week against 2025 lb pre-recovery baseline');
  });

  test('#1264: the selected week compares against the frozen pre-recovery baseline, never an earlier recovery week', () => {
    // Frozen Bench 135 / 2025; earlier recovery Week 1 = 60 (900); selected Week 2 = 100 (1500).
    const component = setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1'), week(2, 'note-w2')],
      notes: [note('note-w1', '-Bench\n- 60 5,5,5'), note('note-w2', '-Bench\n- 100 5,5,5')],
    });
    const root = component.root;
    expandDetails(root);
    const benchRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.startsWith('Bench,')
    )[0];
    expect(benchRow.props.accessibilityLabel).toContain('Load 74% of baseline, 100 lb this week against 135 lb pre-recovery baseline');
    expect(benchRow.props.accessibilityLabel).not.toContain('60 lb');
    expect(hasText(root, 'Load 100 lb vs baseline 135 lb')).toBe(true);
    expect(hasText(root, 'Total work 1500 lb vs baseline 2025 lb')).toBe(true);
    expect(hasText(root, 'Load 100 lb vs baseline 60 lb')).toBe(false);
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
    expect(hasText(root, 'Push Pull Legs baseline')).toBe(true);
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
    expect(rosterLabel(darkComponent.root)).toBe("Trained this week: 4 of 4 roster exercises. By status: At or above 4, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 0, Added during recovery 0.");
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
    expect(rendered.some(t => t.includes('Push Pull Legs baseline'))).toBe(true);
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
    expect(findAllText(root).filter(t => t === 'at baseline').length).toBe(1);
    expect(hasText(root, 'of 2 at or above baseline')).toBe(false);
    // #1219: collapsed shows the one shared bar + "N trained" stat, not a count sentence.
    expect(hasText(root, '3 exercises')).toBe(false);
    expect(hasText(root, 'trained')).toBe(true);

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
    expect(rosterLabel(root)).toBe("Trained this week: 2 of 2 roster exercises. By status: At or above 1, Rebuilding 1, Early 0, Not trained yet 0, Can't compare 0, Added during recovery 1. Most common gap: Total work.");
    // The visible Gap stat was removed (#1219); the gap rides on the label only.
    expect(hasText(root, 'Gap: Total work')).toBe(false);
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
    expect(byLabel(root, "Week 1 return bands across 2 trained exercises: At or above 1, Rebuilding 1, Early 0, Not trained yet 0, Can't compare 0, Added during recovery 1")).toBeDefined();

    expandDetails(root);
    // #1219: the clause line is gone everywhere; the rows carry the states.
    expect(hasText(root, 'Week 1 · 1 rebuilding · 1 added during recovery')).toBe(false);
    expect(statusWords(root)).toEqual(['Rebuilding', 'At or above', 'Added during recovery']);
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

  test('rows follow the baseline routine order then added (#1219), each with its own status word and no counted group headings (#1219)', () => {
    const root = setupMixed();
    expandDetails(root);

    expect(statusWords(root)).toEqual(['Rebuilding', 'At or above', 'Added during recovery']);
    expect(hostRows(root).map(r => hostTextsIn(r)[0])).toEqual(['Bench', 'Pull-up', 'Foam Roll']);
    const headers = groupHeaders(root).map(h => h.props.children);
    expect(headers.some(h => /\(\d+\)$/.test(String(h)))).toBe(false);
  });

  test('every row is always visible — there is no filter that can hide one', () => {
    const root = setupMixed();
    expandDetails(root);

    const labels = rowLabels(root);
    expect(labels.some(l => l.startsWith('Bench, Rebuilding'))).toBe(true);
    expect(labels.some(l => l.startsWith('Pull-up, At or above'))).toBe(true);
    expect(labels.some(l => l.startsWith('Foam Roll, Added during recovery'))).toBe(true);
  });

  test('the not-reintroduced row holds exactly the baseline work that never came back', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', '-Bench\n- 135 5,5,5')],
    }).root;
    expandDetails(root);

    expect(statusWords(root)).toEqual(['At or above', 'Not trained yet']);
    const labels = rowLabels(root);
    expect(labels.some(l => l.startsWith('Pull-up, Not trained yet'))).toBe(true);
    expect(labels.some(l => l.startsWith('Bench, At or above'))).toBe(true);
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
    expect(hasText(root, 'Load 135 lb vs baseline 135 lb')).toBe(true);
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
    expect(rowLabels(root).some(l => l.startsWith('Bench, At or above'))).toBe(true);
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
    expect(hasText(component.root, 'Started')).toBe(true);
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
    // Distinct per-court band tokens (#1219), never shared status colors.
    expect(dotColors).toContain(HardCourtLightColors.recoveryBandRebuilding);
    expect(dotColors).toContain(HardCourtLightColors.recoveryBandEarly);
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
      inst => typeof inst.type === 'string' && flattenStyle(inst).backgroundColor === HardCourtLightColors.recoveryBandRebuilding
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
    expect(hero.props.accessibilityLabel).toMatch(/^Week 2: \d+ of \d+ exercises trained this week at or above [A-Za-z ]+ baseline\. The count covers only exercises trained this week\.$/);
    expect(hasText(root, 'Push Pull Legs baseline')).toBe(true);
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
    expect(bar.props.accessibilityLabel).toMatch(/^Week 2 return bands across \d+ trained exercises: At or above \d+, Rebuilding \d+, Early \d+, Not trained yet \d+, Can't compare \d+, Added during recovery \d+$/);
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
    for (const gone of ['roster exercises trained', 'not yet', 'Most common gap']) expect(hasText(root, gone)).toBe(false);
    // #1215: removed captions and the prose they restated no longer render.
    for (const gone of ['Across weeks', 'both weeks', 'Since Week', 'linked weeks', 'pick a week']) {
      expect(hasText(root, gone)).toBe(false);
    }
    expect(findAllText(root).filter(t => /^\d+ trained exercises?$/.test(t))).toEqual([]);
    // The bar is one thin band and the strip rows are thin horizontal bars.
    expect(flattenStyleOf(bar.findAll(n => typeof n.type === 'string' && n.props.style && n.props.style.height === 10)[0]).height).toBe(10);
    const weekBars = root.findAll(n => typeof n.type === 'string' && n.props.style && n.props.style.height === 6 && n.props.style.flexDirection === 'row');
    expect(weekBars.length).toBeGreaterThan(0);
    // #1264: Steady uses the Progressive Overload flat glyph, not trending-flat.
    expect(root.findAll(n => n.props.name === 'trending-flat').length).toBe(0);
    expect(findAllText(root)).toContain('↔');
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
    expect(hasText(root, 'Total work 2025 lb vs baseline 2025 lb')).toBe(true);
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
    expect(hasText(root, 'Push Pull Legs baseline')).toBe(true);
    expect(heroNode(root).props.accessibilityLabel).toBe('Week 1: 2 of 2 exercises trained this week at or above Push Pull Legs baseline. The count covers only exercises trained this week.');
    expect(findAllText(root).some(t => t.startsWith('Baseline:'))).toBe(false);
    expect(hasText(root, '05-01-2026')).toBe(true);
  });

  test('a long routine name ellipsizes on screen while the accessible label keeps the whole name', () => {
    const full = 'Upper Lower Push Pull Legs Hypertrophy Block';
    const root = oneWeek(full);
    const visible = findAllText(root).find(t => t.endsWith(' baseline') && t.includes('…'));
    expect(visible).toContain('…');
    expect(visible).not.toContain(full);
    expect(visible.length).toBeLessThanOrEqual(' baseline'.length + 24);
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
      const visible = findAllText(root).find(t => t.endsWith(' baseline') && t.includes('…'));
      expect(hasLoneSurrogate(visible)).toBe(false);
      expect(visible).toContain('…');
      expect(heroNode(root).props.accessibilityLabel).toContain(`at or above ${title} baseline`);
    });
  });

  test('an untitled routine falls back to "Untitled Routine" visibly and accessibly', () => {
    for (const title of ['', '   ', null]) {
      const root = oneWeek(title);
      expect(hasText(root, 'Untitled Routine baseline')).toBe(true);
      expect(heroNode(root).props.accessibilityLabel).toContain('Untitled Routine baseline');
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
    expect(heroNode(root).props.accessibilityLabel).toBe('Week 1: no roster exercises trained yet this week against Push Pull Legs baseline');
    expect(findAllText(root).some(t => t.startsWith('Baseline:'))).toBe(false);
    expect(hasText(root, '05-01-2026')).toBe(true);
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
      expect(findAllText(root).filter(t => t.includes('Push Pull Legs'))).toEqual(['Push Pull Legs']);
    }
  });

  test('with no hero (no week logged) the routine is still named once, in the bottom line', () => {
    const root = setup({ blocks: [block()], weeks: [], notes: [] }).root;
    expect(findAllText(root).filter(t => t.includes('Push Pull Legs'))).toEqual(['Push Pull Legs']);
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
      expect(root.findAll(n => n.props.accessibilityLiveRegion === 'polite' && n.props.testID !== 'recovery-about-note' && typeof n.type === 'string').length).toBe(1);
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
    expect(rows.map(r => r[0])).toEqual(['Bench', 'Pull-up', 'Curl', 'Foam Roll']);
    expect(rows.map(r => r[1])).toEqual(['Rebuilding', 'At or above', 'Not trained yet', 'Added during recovery']);
    const bench = rows[0];
    expect(bench).toContain('Total work 66%');
    expect(bench).toContain('Load 135 lb vs baseline 135 lb');
    expect(bench.some(t => t.startsWith('Total work '))).toBe(true);
    // Rows stay short: only tokens, never sentences.
    for (const r of rows) for (const t of r) expect(t.length).toBeLessThanOrEqual(40);
    expect(rows.every(r => r.length <= 5)).toBe(true);
  });

  test('one bar per compared row, filled to its Total work measure; absent and added rows get no bar', () => {
    const root = mount();
    const bars = hostById(root, 'recovery-exercise-bar');
    expect(bars).toHaveLength(2);
    const fills = bars.map(b => StyleSheet.flatten(b.children[0].props.style).width);
    expect(fills).toEqual(['66%', '100%']);
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
    expect(rosterLabel(root)).toBe("Trained this week: 2 of 3 roster exercises, 1 not trained yet. By status: At or above 1, Rebuilding 1, Early 0, Not trained yet 1, Can't compare 0, Added during recovery 1. Most common gap: Total work.");
    const texts = hostTextsIn(rosterNode(root));
    expect(texts).toEqual(['2', 'trained', '1', 'not yet', '1', 'added']);
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
    expect(labels.find(l => l.startsWith('Pull-up, At or above'))).toContain('Reps 100%');
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

describe('AnalyticsRecoverySection — collapsed details summary and footer (#1219)', () => {
  const { StyleSheet } = require('react-native');
  const BASE = '-Bench\n- 135 5,5,5\n-Pull-up\n- 8,8,8\n-Curl\n- 20 10,10';
  const WEEK = '-Bench\n- 135 5,5\n-Pull-up\n- 8,8,8\n-Foam Roll\n- 10,10';
  const mountWith = (blockOver = {}, extra = {}, base = BASE, weekText = WEEK) => {
    let component;
    act(() => {
      component = render.create(
        <AnalyticsRecoverySection
          blocks={[block({ baseline: captureRecoveryBaselineFromText(base), ...blockOver })]}
          weeks={[week(1, 'note-w1')]}
          notes={[note('note-w1', weekText)]}
          {...extra}
        />
      );
    });
    return component.root;
  };
  const hostById = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
  const segsOf = (node) => node.findAll(n => typeof n.type === 'string' && /^recovery-segment-/.test(n.props.testID || ''));
  const NOTE = 'Training numbers only. Not a medical judgment — only you end a Recovery block.';
  const saveReason = async () => ({ ok: true });

  test('collapsed and expanded render the SAME text-led count line; expanding does not change it', () => {
    const root = mountWith();
    const collapsedTexts = hostTextsIn(rosterNode(root));
    expect(collapsedTexts).toEqual(['2', 'trained', '1', 'not yet', '1', 'added']);
    // No second progress bar: the hero's bar is the only one (#1219 owner review).
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    expect(segsOf(rosterNode(root))).toHaveLength(0);
    // No count sentence or Gap stat while collapsed.
    expect(hasText(root, '3 exercises')).toBe(false);
    expect(hasText(root, 'Gap: Total work')).toBe(false);
    expandDetails(root);
    expect(hostById(root, 'recovery-roster-summary')).toHaveLength(1);
    expect(hostTextsIn(rosterNode(root))).toEqual(collapsedTexts);
    expect(segsOf(rosterNode(root))).toHaveLength(0);
    // The full sentence (including the gap) stays on the accessible label.
    expect(rosterLabel(root)).toContain('Most common gap');
  });

  test('"not yet" is omitted when nothing is untrained, and "0 trained" shows when nothing is trained', () => {
    const one = '-Bench\n- 135 5,5,5';
    expect(hostTextsIn(rosterNode(mountWith({}, {}, one, '-Bench\n- 135 5,5,5\n-Foam Roll\n- 10,10')))).toEqual(['1', 'trained', '1', 'added']);
    expect(hostTextsIn(rosterNode(mountWith({}, {}, one, '-Foam Roll\n- 10,10')))).toEqual(['0', 'trained', '1', 'not yet', '1', 'added']);
  });

  const tokenParity = (root) => {
    const collapsed = hostTextsIn(rosterNode(root));
    expandDetails(root);
    expect(hostById(root, 'recovery-roster-summary')).toHaveLength(1);
    expect(hostTextsIn(rosterNode(root))).toEqual(collapsed);
    return collapsed;
  };

  test('the summary covers ALL week rows: baseline-only, mixed baseline + added, added-only, nothing trained', () => {
    const one = '-Bench\n- 135 5,5,5';
    // baseline-only: no "added" token.
    expect(tokenParity(mountWith({}, {}, one, one))).toEqual(['1', 'trained']);
    // mixed: trained / not yet / added in one row, bar present.
    const mixed = mountWith();
    expect(hostById(mixed, 'recovery-roster-bar')).toHaveLength(0);
    expect(tokenParity(mixed)).toEqual(['2', 'trained', '1', 'not yet', '1', 'added']);
    expect(rosterLabel(mixed)).toBe("Trained this week: 2 of 3 roster exercises, 1 not trained yet. By status: At or above 1, Rebuilding 1, Early 0, Not trained yet 1, Can't compare 0, Added during recovery 1. Most common gap: Total work.");
    // nothing trained (only added work): "0 trained", "1 not yet", "1 added".
    expect(tokenParity(mountWith({}, {}, one, '-Foam Roll\n- 10,10'))).toEqual(['0', 'trained', '1', 'not yet', '1', 'added']);
  });

  test('a baseline-empty week with only added work shows "K added" (no bar) in both states', () => {
    const addedRow = mockRow({
      key: 'foam-roll', name: 'Foam Roll', state: RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY, exercise_class: 'reps_based',
      metrics: [metricRow('total_reps', 20, null, null, null)],
    });
    deriveRecoveryComparison.mockReturnValueOnce(
      mockComparison({ status: RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY, weeks: [mockWeek({ exercises: [], added: [addedRow] })] })
    );
    const root = mountWith();
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    expect(tokenParity(root)).toEqual(['1', 'added']);
    expect(rosterLabel(root)).toBe("By status: At or above 0, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 0, Added during recovery 1.");
  });

  // Table-driven (#1219): one single-kind week per status kind in the SHARED
  // row mapping, derived from ROW_STATUS_KINDS so a newly added kind fails here
  // until the summary handles it.
  const KIND_ROWS = {
    at_or_above: () => mockRow({ key: 'k1', name: 'Bench', state: RECOVERY_COMPARISON_STATES.BASELINE_MET, exercise_class: 'weighted', metrics: [metricRow('top_load', 135, 135, 100, true)] }),
    close: () => mockRow({ key: 'k1', name: 'Bench', state: RECOVERY_COMPARISON_STATES.REBUILDING, exercise_class: 'weighted', metrics: [metricRow('top_load', 125, 135, 93, false)] }),
    rebuilding: () => mockRow({ key: 'k1', name: 'Bench', state: RECOVERY_COMPARISON_STATES.REBUILDING, exercise_class: 'weighted', metrics: [metricRow('top_load', 95, 135, 70, false)] }),
    early: () => mockRow({ key: 'k1', name: 'Bench', state: RECOVERY_COMPARISON_STATES.REBUILDING, exercise_class: 'weighted', metrics: [metricRow('top_load', 40, 135, 30, false)] }),
    not_trained_yet: () => mockRow({ key: 'k1', name: 'Bench', state: RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED, exercise_class: 'weighted', metrics: [metricRow('top_load', null, 135, null, false)] }),
    cannot_compare: () => mockRow({ key: 'k1', name: 'Bench', state: RECOVERY_COMPARISON_STATES.NOT_COMPARABLE, exercise_class: 'weighted', unavailable_reason: RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE }),
    added: () => mockRow({ key: 'k1', name: 'Foam Roll', state: RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY, exercise_class: 'reps_based', metrics: [metricRow('total_reps', 20, null, null, null)] }),
  };
  const VISIBLE_TOKENS = {
    at_or_above: ['1', 'trained'], close: ['1', 'trained'], rebuilding: ['1', 'trained'], early: ['1', 'trained'],
    not_trained_yet: ['0', 'trained', '1', 'not yet'],
    cannot_compare: ['1', "can't compare"],
    added: ['1', 'added'],
  };
  const LABEL_COUNT = {
    at_or_above: 'At or above 1', close: 'Rebuilding 1', rebuilding: 'Rebuilding 1', early: 'Early 1',
    not_trained_yet: 'Not trained yet 1', cannot_compare: "Can't compare 1", added: 'Added during recovery 1',
  };
  const mountRows = (exercises, added) => {
    deriveRecoveryComparison.mockReturnValueOnce(
      mockComparison({ weeks: [mockWeek({ exercises, added })] })
    );
    return mountWith();
  };
  const { ROW_STATUS_KINDS } = require('../components/recovery/RecoveryStateGroups');

  test('every status kind in the shared mapping has a table entry (new kinds must be handled)', () => {
    // `close` is a derived-input fixture only: it is folded into Rebuilding, so it
    // is never a visible status kind.
    expect([...ROW_STATUS_KINDS].sort()).toEqual(Object.keys(KIND_ROWS).filter(k => k !== 'close').sort());
    expect(ROW_STATUS_KINDS).not.toContain('close');
  });

  test.each(Object.keys(KIND_ROWS))('single-kind week "%s": summary renders, tokens match collapsed vs expanded, label has the count', (kind) => {
    const row = KIND_ROWS[kind]();
    const root = kind === 'added' ? mountRows([], [row]) : mountRows([row], []);
    expect(rosterNode(root)).toBeDefined();
    expect(tokenParity(root)).toEqual(VISIBLE_TOKENS[kind]);
    expect(rosterLabel(root)).toContain(LABEL_COUNT[kind]);
  });

  test('a mixed week with every kind counts each one in the tokens and the label', () => {
    const exercises = ['at_or_above', 'close', 'rebuilding', 'early', 'not_trained_yet', 'cannot_compare']
      .map((k, i) => ({ ...KIND_ROWS[k](), key: `m${i}`, name: `Lift ${i}` }));
    const root = mountRows(exercises, [{ ...KIND_ROWS.added(), key: 'ma' }]);
    expect(tokenParity(root)).toEqual(['4', 'trained', '1', 'not yet', '1', "can't compare", '1', 'added']);
    const label = rosterLabel(root);
    // Close (derived) + Rebuilding are ONE visible count, never two.
    expect(label).toContain("By status: At or above 1, Rebuilding 2, Early 1, Not trained yet 1, Can't compare 1, Added during recovery 1.");
    expect(label).not.toContain('Close');
    for (const k of ['at_or_above', 'early', 'not_trained_yet', 'cannot_compare', 'added']) expect(label).toContain(LABEL_COUNT[k]);
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
  });

  test('hero and summary agree on trained / roster; can\'t-compare and added rows never change them', () => {
    const met = { ...KIND_ROWS.at_or_above(), key: 'c1', name: 'Bench' };
    const reb = { ...KIND_ROWS.rebuilding(), key: 'c2', name: 'Squat' };
    const bad = { ...KIND_ROWS.cannot_compare(), key: 'c3', name: 'Row' };
    const add = { ...KIND_ROWS.added(), key: 'c4' };
    const readings = [
      mountRows([met, reb], []),
      mountRows([met, reb, bad], []),
      mountRows([met, reb, bad], [add]),
    ].map(root => ({
      hero: hostTextsIn(root.findAll(n => typeof n.type === 'string' && n.props.testID === 'recovery-hero')[0]),
      tokens: hostTextsIn(rosterNode(root)),
      label: rosterLabel(root),
    }));
    for (const r of readings) {
      // Hero "1/2" = at-or-above of trained; summary says the same trained and roster.
      expect(r.hero).toContain('1 of 2');
      expect(r.tokens.slice(0, 2)).toEqual(['2', 'trained']);
      expect(r.label).toContain('Trained this week: 2 of 2 roster exercises');
      expect(r.label).not.toMatch(/of 3 roster/);
    }
    expect(readings[1].tokens).toEqual(['2', 'trained', '1', "can't compare"]);
    expect(readings[2].tokens).toEqual(['2', 'trained', '1', "can't compare", '1', 'added']);
  });

  test('each kind is announced exactly once in the label (non-unusable, unusable and mixed weeks)', () => {
    const count = (label, needle) => label.toLowerCase().split(needle).length - 1;
    const notComparable = { ...mockRow({ key: 'n1', name: 'Dip', state: RECOVERY_COMPARISON_STATES.NOT_COMPARABLE, exercise_class: 'weighted', unavailable_reason: RECOVERY_UNAVAILABLE_REASONS.EXERCISE_CLASS_CHANGED }) };
    const unusable = { ...KIND_ROWS.cannot_compare(), key: 'n2', name: 'Row' };
    const met = { ...KIND_ROWS.at_or_above(), key: 'n3', name: 'Bench' };
    const add = { ...KIND_ROWS.added(), key: 'n4' };
    const cases = [
      { root: mountRows([met, notComparable], [add]), roster: 2, trained: 2 },
      { root: mountRows([met, unusable], [add]), roster: 1, trained: 1 },
      { root: mountRows([met, notComparable, unusable], [add]), roster: 2, trained: 2 },
    ];
    for (const { root, roster, trained } of cases) {
      const label = rosterLabel(root);
      expect(count(label, "can't compare")).toBe(1);
      expect(count(label, 'added during recovery')).toBe(1);
      expect(label).toContain(`Trained this week: ${trained} of ${roster} roster exercises`);
      expect(hostTextsIn(root.findAll(n => typeof n.type === 'string' && n.props.testID === 'recovery-hero')[0])).toContain(`1 of ${trained}`);
    }
  });

  test('a week with only a can\'t-compare row still shows the summary and no bar', () => {
    const root = mountRows([KIND_ROWS.cannot_compare()], []);
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    expect(hostTextsIn(rosterNode(root))).toEqual(['1', "can't compare"]);
  });

  test('the header keeps its >=44dp target and accessibilityState.expanded', () => {
    const header = byLabel(mountWith(), 'Expand exercise details');
    expect(StyleSheet.flatten(header.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(header.props.accessibilityState).toEqual({ expanded: false });
  });

  test('the context block is a labelled list (Started / Reason) with the info button beside the date and the note hidden by default', () => {
    const root = mountWith({ reason: 'torn hamstring' }, { onSaveReason: saveReason });
    expect(hasText(root, 'Not a medical judgment')).toBe(false);
    const block = hostById(root, 'recovery-footer-row')[0];
    expect(StyleSheet.flatten(block.props.style)).toMatchObject({ borderTopWidth: 1 });
    // Row order: date (with info), then the note slot, then the reason row.
    expect(findAllText(block)).toEqual(['Started', '05-01-2026', 'Reason', 'torn hamstring']);
    const dateRow = hostById(root, 'recovery-context-date')[0];
    // The info control is INSIDE the date row, right after its text — not margin-pushed to the edge.
    expect(dateRow.findAll(m => m.props.accessibilityLabel === 'About these numbers').length).toBeGreaterThan(0);
    const info = byLabel(root, 'About these numbers');
    // #1245: anchored beside the "Started" label, before the date value.
    const order = dateRow.findAll(n => n.type === 'Text' || n.props.accessibilityLabel === 'About these numbers', { deep: true })
      .map(n => (n.type === 'Text' ? [].concat(n.props.children).join('') : 'INFO'));
    expect(order.indexOf('INFO')).toBe(order.indexOf('Started') + 1);
    expect(StyleSheet.flatten(info.props.style).marginLeft).not.toBe('auto');
    expect(StyleSheet.flatten(info.props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
    // Reason row: labelled, one tappable >=44dp row with a visible edit glyph.
    const reasonRow = hostById(root, 'recovery-reason-row')[0];
    expect(reasonRow.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(reasonRow.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(reasonRow.props.accessibilityLabel).toBe('Edit reason for this recovery block: torn hamstring');
  });

  test('no reason: the Reason row invites "Add a reason" with an add glyph; a read-only block shows the reason without a control', () => {
    const empty = mountWith({ reason: null }, { onSaveReason: saveReason });
    const row = hostById(empty, 'recovery-reason-row')[0];
    expect(findAllText(row)).toEqual(['Reason', 'Add a reason']);
    expect(row.props.accessibilityLabel).toBe('Add a reason for this recovery block');
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    // BlockEvidence without an `onSaveReason` (read-only): no reason and nothing to
    // edit means no Reason row; a reason shows as a plain labelled row, not a button.
    const { BlockEvidence } = require('../components/recovery/RecoveryEvidence');
    const evidence = (reason) => {
      let c;
      act(() => { c = render.create(<BlockEvidence block={block({ reason })} weeks={[]} notes={[]} unit="lb" />); });
      return c.root;
    };
    expect(hostById(evidence(null), 'recovery-reason-row')).toHaveLength(0);
    const readOnly = hostById(evidence('torn hamstring'), 'recovery-reason-row')[0];
    expect(readOnly.props.accessibilityRole).toBeUndefined();
    expect(findAllText(readOnly)).toEqual(['Reason', 'torn hamstring']);
  });

  test('locked or busy reason keeps the row visible but disabled', () => {
    const root = mountWith({ reason: 'torn hamstring' }, { onSaveReason: saveReason });
    // (mutations are allowed in this harness; the disabled path is covered in recovery-reason.test.js)
    expect(hostById(root, 'recovery-reason-row')[0].props.accessibilityState).toEqual({ disabled: false });
  });

  test('a long reason gets two ellipsized lines with the full text on its label', () => {
    const long = 'x'.repeat(200);
    const root = mountWith({ reason: long }, { onSaveReason: saveReason });
    const t = root.findAll(n => n.type === 'Text' && [].concat(n.props.children).join('') === long)[0];
    expect(t.props.numberOfLines).toBe(2);
    expect(byLabel(root, `Edit reason for this recovery block: ${long}`)).toBeDefined();
  });

  test('the info button reveals the exact note inline in a live region and toggles it closed', () => {
    const root = mountWith();
    const info = byLabel(root, 'About these numbers');
    expect(info.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(info.props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
    expect(hostById(root, 'recovery-about-note')[0].props.accessibilityLiveRegion).toBe('polite');
    act(() => { byLabel(root, 'About these numbers').props.onPress(); });
    expect(hasText(root, NOTE)).toBe(true);
    expect(byLabel(root, 'About these numbers').props.accessibilityState).toEqual({ expanded: true });
    act(() => { byLabel(root, 'About these numbers').props.onPress(); });
    expect(hasText(root, NOTE)).toBe(false);
  });

  test('no-hero context: a long routine title ellipsizes with its full name on the label; a completed range is never truncated; reason and info stay reachable at fontScale 2', () => {
    const longTitle = 'Hypertrophy Block With An Extremely Long Routine Name '.repeat(3).trim();
    const longReason = 'returning after a long layoff and a slow ramp-up '.repeat(4).trim();
    for (const fontScale of [1, 2]) {
      mockWindow = { ...mockWindow, fontScale, width: 320 };
      const root = (() => {
        let c;
        act(() => {
          c = render.create(
            <AnalyticsRecoverySection
              blocks={[block({ baseline_note_title: longTitle, reason: longReason, completed_at: '2026-06-01T00:00:00Z' })]}
              weeks={[]}
              notes={[]}
              onSaveReason={saveReason}
            />
          );
        });
        return c.root;
      })();
      const routine = hostById(root, 'recovery-context-routine')[0];
      const title = routine.findAll(n => n.type === 'Text' && n.props.accessibilityLabel === `Baseline: ${longTitle}`)[0];
      expect(title).toBeDefined();
      expect(title.props.numberOfLines).toBe(1);
      expect(StyleSheet.flatten(title.props.style)).toMatchObject({ flexShrink: 1 });
      // The completed range is a plain, untruncated value (wraps instead).
      const date = hostById(root, 'recovery-context-date')[0]
        .findAll(n => typeof n.type === 'string' && n.props.accessibilityLabel === 'Dates 05-01-2026 – 06-01-2026')[0];
      expect(date).toBeDefined();
      expect(date.findAll(n => n.type === 'Text' && n.props.numberOfLines !== undefined)).toHaveLength(0);
      expect(StyleSheet.flatten(date.props.style).flexWrap).toBe('wrap');
      const reason = byLabel(root, `Edit reason for this recovery block: ${longReason}`);
      expect(reason).toBeDefined();
      expect(StyleSheet.flatten(reason.props.style).minHeight).toBeGreaterThanOrEqual(44);
      const info = byLabel(root, 'About these numbers');
      expect(StyleSheet.flatten(info.props.style)).toMatchObject({ minWidth: 44, minHeight: 44, flexShrink: 0 });
    }
    mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
  });
});

// ---------------------------------------------------------------------------
// #1219 D / F / H: routine order, the Total work bar, court-themed band marks.
// ---------------------------------------------------------------------------
describe('AnalyticsRecoverySection — routine order, Total work bar, band tokens (#1219 D/F/H)', () => {
  const { StyleSheet } = require('react-native');
  const { orderDetailRows } = require('../components/recovery/RecoveryStateGroups');
  const { bandColor } = require('../components/recovery/RecoveryVisuals');
  const { KUA_PALETTES, RECOVERY_BAND_TOKENS } = require('../theme/colors');
  const S = RECOVERY_COMPARISON_STATES;
  const hostById = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
  const rowNames = (root) => hostRows(root).map(r => hostTextsIn(r)[0]);
  const flat = (n) => StyleSheet.flatten(n.props.style || {});

  // --- helpers -------------------------------------------------------------
  const W = (top, vol) => [
    metricRow('top_load', top[0], top[1], Math.floor((top[0] / top[1]) * 100), top[0] >= top[1]),
    metricRow('volume', vol[0], vol[1], Math.floor((vol[0] / vol[1]) * 100), vol[0] >= vol[1]),
  ];
  const mocked = (rows, added = []) => {
    deriveRecoveryComparison.mockReturnValueOnce(
      mockComparison({ weeks: [mockWeek({ exercises: rows, added })] })
    );
    const root = setup({
      blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)],
    }).root;
    expandDetails(root);
    return root;
  };
  const met = (name) => mockRow({ key: name, name, state: S.BASELINE_MET, exercise_class: 'weighted', metrics: W([100, 100], [100, 100]) });
  const rebuilding = (name) => mockRow({ key: name, name, state: S.REBUILDING, exercise_class: 'weighted', metrics: W([100, 100], [50, 100]), unmet: ['volume'] });
  // A rebuilding row whose limiting (and only unmet) dimension is `pct` percent.
  const at = (name, pct) => mockRow({ key: name, name, state: S.REBUILDING, exercise_class: 'weighted', metrics: W([100, 100], [pct, 100]), unmet: ['volume'] });
  const classChanged = (name) => mockRow({ key: name, name, state: S.NOT_COMPARABLE, exercise_class: 'weighted', unavailable_reason: RECOVERY_UNAVAILABLE_REASONS.EXERCISE_CLASS_CHANGED });
  // A baseline row whose frozen value is unusable AND that the week never logged.
  const unusableUntrained = (name) => ({ ...mockRow({ key: name, name, state: S.NOT_COMPARABLE, exercise_class: 'weighted', unavailable_reason: RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE }), week_name: null, week_exercise_class: null });
  const untrained = (name) => ({ ...mockRow({ key: name, name, state: S.NOT_REINTRODUCED, exercise_class: 'weighted', metrics: W([0, 100], [0, 100]), unmet: ['top_load', 'volume'] }), week_name: null, week_exercise_class: null });
  const addedRow = (name) => mockRow({ key: name, name, state: S.ADDED_DURING_RECOVERY, exercise_class: 'reps_only', metrics: [metricRow('total_reps', 10, null, null, null)] });

  // --- D: order ------------------------------------------------------------
  // Every row state x activity case: [label, row, has week activity].
  const ORDER_TABLE = [
    ['baseline_met', met('R'), true],
    ['rebuilding', rebuilding('R'), true],
    ['not_comparable the week logged', classChanged('R'), true],
    ['not_comparable, week never logged it', unusableUntrained('R'), false],
    ['not_reintroduced', untrained('R'), false],
  ];

  test.each(ORDER_TABLE)('orderDetailRows places a %s row by week activity (active=%s)', (_label, row, active) => {
    const a = { ...row, key: 'a', name: 'A' };
    const b = { ...row, key: 'b', name: 'B' };
    // Opposite-class sentinel so the group split is observable either way.
    const other = active ? untrained('Z') : met('Z');
    const ordered = orderDetailRows([a, other, b]).map(r => r.name);
    expect(ordered).toEqual(active ? ['A', 'B', 'Z'] : ['Z', 'A', 'B']);
  });

  test('orderDetailRows keeps added rows last, in the order supplied, and never sorts any group', () => {
    const rows = [untrained('Squat'), met('Bench'), classChanged('Row'), unusableUntrained('Dip'), rebuilding('Deadlift'), untrained('Curl'),
      addedRow('Zebra Stretch'), addedRow('Aaa Mobility')];
    expect(orderDetailRows(rows).map(r => r.name)).toEqual([
      'Bench', 'Row', 'Deadlift', // activity, snapshot order
      'Squat', 'Dip', 'Curl',     // not trained this week, snapshot order
      'Zebra Stretch', 'Aaa Mobility', // added, as supplied
    ]);
  });

  test('every state interleaved in the rendered details: activity group, idle group, then added', () => {
    const root = mocked([untrained('Squat'), met('Bench'), classChanged('Row'), unusableUntrained('Dip'), rebuilding('Deadlift'), untrained('Curl')],
      [addedRow('Zebra Stretch'), addedRow('Aaa Mobility')]);
    expect(rowNames(root)).toEqual(['Bench', 'Row', 'Deadlift', 'Squat', 'Dip', 'Curl', 'Zebra Stretch', 'Aaa Mobility']);
    expect(statusWords(root)).toEqual([
      'At or above', "Can't compare", 'Rebuilding', 'Not trained yet', "Can't compare", 'Not trained yet',
      'Added during recovery', 'Added during recovery',
    ]);
  });

  // A routine deliberately NOT alphabetical, 8 exercises.
  const ROUTINE = [
    ['Squat', '- 225 5,5'], ['Bench', '- 135 5,5'], ['Deadlift', '- 315 3'], ['Row', '- 100 8,8'],
    ['Curl', '- 20 10'], ['Ab Wheel', '- 10,10'], ['Pull-up', '- 8,8'], ['Overhead Press', '- 95 5,5'],
  ];
  const noteOf = (pairs) => pairs.map(([n, s]) => `-${n}\n${s}`).join('\n');
  const TRAINED = ['Bench', 'Row', 'Ab Wheel', 'Overhead Press'];
  // Trained exercises alternate between "still rebuilding" and "met" so a
  // state-ranked order (met first) cannot coincide with routine order.
  const WEEK_NOTE = noteOf([
    ['Bench', '- 135 5'], ['Row', '- 100 8,8'], ['Ab Wheel', '- 10,-'], ['Overhead Press', '- 95 5,5'],
    ['Foam Roll', '- 10,10'],
  ]);
  const mountReal = (baseline) => {
    const root = setup({
      blocks: [block({ baseline })], weeks: [week(1, 'note-w1')], notes: [note('note-w1', WEEK_NOTE)],
    }).root;
    expandDetails(root);
    return root;
  };

  test('v2 baseline: rows follow the saved routine_order (not alphabetical) within the trained and not-yet groups', () => {
    const baseline = captureRecoveryBaselineFromText(noteOf(ROUTINE));
    expect(baseline.version).toBe(2);
    // The order comes from the baseline's own routine_order, which equals the array index.
    expect(baseline.exercises.map(e => e.routine_order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const byRoutine = [...baseline.exercises].sort((a, b) => a.routine_order - b.routine_order).map(e => e.name);
    expect(byRoutine).toEqual(ROUTINE.map(([n]) => n));
    const expected = [
      ...byRoutine.filter(n => TRAINED.includes(n)),
      ...byRoutine.filter(n => !TRAINED.includes(n)),
      'Foam Roll',
    ];
    expect(expected).toEqual(['Bench', 'Row', 'Ab Wheel', 'Overhead Press', 'Squat', 'Deadlift', 'Curl', 'Pull-up', 'Foam Roll']);
    expect(rowNames(mountReal(baseline))).toEqual(expected);
  });

  test('v1 baseline keeps its stored alphabetical order and gains no invented routine order', () => {
    const v2 = captureRecoveryBaselineFromText(noteOf(ROUTINE));
    const v1 = {
      version: 1,
      exercises: v2.exercises
        .map(({ routine_order, basis, ...row }) => row)
        .sort((a, b) => (a.key < b.key ? -1 : 1)),
    };
    expect(v1.exercises.every(e => e.routine_order === undefined)).toBe(true);
    expect(rowNames(mountReal(v1))).toEqual([
      'Ab Wheel', 'Bench', 'Overhead Press', 'Row', // trained, alphabetical as stored
      'Curl', 'Deadlift', 'Pull-up', 'Squat',       // not yet, alphabetical as stored
      'Foam Roll',
    ]);
  });

  // --- F: bar measure ------------------------------------------------------
  const barOf = (root, i = 0) => hostById(root, 'recovery-exercise-bar')[i];
  const fillOf = (bar) => flat(bar.children[0]).width;
  const percentTextOf = (root, i = 0) => hostTextsIn(hostRows(root)[i]).find(t => /\d+%$/.test(t));
  const lastWeek = () => deriveRecoveryComparison.mock.results[deriveRecoveryComparison.mock.results.length - 1].value.weeks[0];

  // [label, exercise_class, metrics, expected measure label, expected percent, expected fill]
  const BAR_TABLE = [
    ['weighted: load back, work not (deadlift-style)', 'weighted', W([335, 325], [670, 5850]), 'Total work', 11, '11%'],
    ['weighted: work back, load short', 'weighted', W([200, 300], [4000, 4500]), 'Total work', 88, '88%'],
    ['weighted above baseline caps the fill, not the text', 'weighted', W([300, 300], [6750, 4500]), 'Total work', 150, '100%'],
    ['reps-only', 'reps_only', [metricRow('total_reps', 16, 24, 66, false)], 'Reps', 66, '66%'],
    ['time-based', 'time_based', [metricRow('total_seconds', 45, 100, 45, false)], 'Time', 45, '45%'],
    ['reps-only above baseline', 'reps_only', [metricRow('total_reps', 36, 24, 150, true)], 'Reps', 150, '100%'],
  ];

  test.each(BAR_TABLE)('bar measure — %s', (_l, cls, metrics, label, percent, fill) => {
    const state = metrics.every(m => m.met) ? S.BASELINE_MET : S.REBUILDING;
    const root = mocked([mockRow({ key: 'x', name: 'X', state, exercise_class: cls, metrics, unmet: metrics.filter(m => !m.met).map(m => m.metric) })]);
    expect(hostById(root, 'recovery-exercise-bar')).toHaveLength(1);
    expect(fillOf(barOf(root))).toBe(fill);
    // The visible percent names the same measure the bar shows ...
    expect(percentTextOf(root)).toBe(`${label} ${percent}%`);
    // ... and so does the first evidence sentence of the spoken label.
    const spoken = hostRows(root)[0].props.accessibilityLabel;
    expect(spoken.split('. ')[1].startsWith(`${label} ${percent}% of baseline,`)).toBe(true);
  });

  test('deadlift 325 6,6,6 vs 335 2: the bar is Total work 11% while the band/state stay derived unchanged', () => {
    const root = setup({
      blocks: [block({ baseline: captureRecoveryBaselineFromText('-Deadlift\n- 325 6,6,6') })],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', '-Deadlift\n- 335 2,-,-')],
    }).root;
    expandDetails(root);
    // Load is ABOVE baseline (103%) but Total work is not: not "at or above".
    expect(fillOf(barOf(root))).toBe('11%');
    expect(percentTextOf(root)).toBe('Total work 11%');
    expect(statusWords(root)).toEqual(['Early']);
    const spoken = hostRows(root)[0].props.accessibilityLabel;
    expect(spoken).toContain('Total work 11% of baseline, 670 lb this week against 5850 lb pre-recovery baseline');
    expect(spoken).toContain('Load 103% of baseline, 335 lb this week against 325 lb pre-recovery baseline');
    expect(spoken.indexOf('Total work')).toBeLessThan(spoken.indexOf('Load 103%'));
    expect(lastWeek().exercises[0].state).toBe(S.REBUILDING);
  });

  test('load short but work back: bar follows Total work (full) yet baseline_met still needs BOTH dimensions', () => {
    const root = setup({
      blocks: [block({ baseline: captureRecoveryBaselineFromText('-Squat\n- 300 5,5,5') })],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', '-Squat\n- 200 10,10,10')],
    }).root;
    expandDetails(root);
    const row = lastWeek().exercises[0];
    expect(row.metrics.find(m => m.metric === 'volume').met).toBe(true);
    expect(row.metrics.find(m => m.metric === 'top_load').met).toBe(false);
    expect(row.state).toBe(S.REBUILDING);
    expect(fillOf(barOf(root))).toBe('100%');
    expect(percentTextOf(root)).toBe('Total work 133%');
    expect(statusWords(root)).not.toContain('At or above');
  });

  test('the bar is never the lowest-ratio metric: load 40%, work 90% fills to 90', () => {
    const root = mocked([mockRow({ key: 'x', name: 'X', state: S.REBUILDING, exercise_class: 'weighted', metrics: W([40, 100], [90, 100]), unmet: ['top_load', 'volume'] })]);
    expect(fillOf(barOf(root))).toBe('90%');
    expect(percentTextOf(root)).toBe('Total work 90%');
  });

  test('absent, not-comparable and added rows still draw no bar', () => {
    const root = mocked([untrained('A'), classChanged('B')], [addedRow('C')]);
    expect(hostById(root, 'recovery-exercise-bar')).toHaveLength(0);
  });

  // --- D: added rows follow the week note, end to end -------------------------
  test('added rows render last, in week-note order even when reverse-alphabetical by normalized identity', () => {
    const root = setup({
      blocks: [block({ baseline: captureRecoveryBaselineFromText('-Bench\n- 135 5,5,5\n-Pull-up\n- 8,8,8') })],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', '-Zercher Hold\n- 10,10\n-Pull-up\n- 8,8,8\n-Mobility Flow\n- 8,8\n-Ankle Circles\n- 12,12')],
    }).root;
    expandDetails(root);
    // Baseline first (activity, then not yet), then added exactly as the note lists them.
    expect(rowNames(root)).toEqual(['Pull-up', 'Bench', 'Zercher Hold', 'Mobility Flow', 'Ankle Circles']);
    expect(statusWords(root).slice(2)).toEqual(['Added during recovery', 'Added during recovery', 'Added during recovery']);
  });

  // --- H: three graded states + quiet statuses ---------------------------------
  const GRADED_TOKEN = {
    at_or_above: 'recoveryBandAtOrAbove', close: 'recoveryBandRebuilding',
    rebuilding: 'recoveryBandRebuilding', early: 'recoveryBandEarly',
  };
  const QUIET_IDS = ['cannot_compare', 'not_trained_yet', 'added'];
  const PALETTE_ROWS = Object.entries(KUA_PALETTES).flatMap(([court, modes]) =>
    Object.entries(modes).map(([mode, kua]) => [`${court}/${mode}`, kua, mode]));

  test('the visible graded bands are exactly At or above, Rebuilding, Early', () => {
    const { GRADED_BANDS, displayBandId, gradedCounts } = require('../components/recovery/RecoveryVisuals');
    expect(GRADED_BANDS.map(b => b.label)).toEqual(['At or above', 'Rebuilding', 'Early']);
    expect(displayBandId('close')).toBe('rebuilding');
    // Presentation-only merge: the derived buckets are untouched; only the render sums.
    expect(gradedCounts({ at_or_above: 1, close: 2, rebuilding: 3, early: 4, cannot_compare: 9, not_trained_yet: 9 }))
      .toEqual({ at_or_above: 1, rebuilding: 5, early: 4 });
  });

  test.each(PALETTE_ROWS)('%s: graded bands use their token (Close shares Rebuilding); every quiet status uses onSurfaceVariant', (_n, kua) => {
    for (const [band, token] of Object.entries(GRADED_TOKEN)) {
      expect(RECOVERY_BAND_TOKENS).toContain(token);
      expect(bandColor(band, LightColors, kua)).toBe(kua[token]);
    }
    for (const id of QUIET_IDS) {
      expect(bandColor(id, LightColors, kua)).toBe(kua.onSurfaceVariant);
      for (const token of RECOVERY_BAND_TOKENS) expect(kua.onSurfaceVariant).not.toBe(kua[token]);
    }
  });

  // Rendered check: the row marks, bar fill, hero segments and summary segments in
  // the live component take the SELECTED court's tokens.
  const renderIn = (kua, mode, props) => {
    let c;
    act(() => {
      c = render.create(
        <ThemeContext.Provider value={{ colors: mode === 'dark' ? DarkColors : LightColors, kuaPalette: kua, mode, preference: mode, setPreference: () => {} }}>
          <AnalyticsRecoverySection {...props} />
        </ThemeContext.Provider>
      );
    });
    return c.root;
  };
  const segsIn = (node) => node.findAll(n => typeof n.type === 'string' && /^recovery-segment-/.test(n.props.testID || ''));
  // One row per state: at or above (A), old CLOSE range 95% (B), old REBUILDING
  // range 60% (C), early 20% (D), not trained (E), can't compare (F), added (G).
  const allStates = () => mockComparison({ weeks: [mockWeek({
    exercises: [met('A'), at('B', 95), at('C', 60), at('D', 20), untrained('E'), classChanged('F')],
    added: [addedRow('G')],
  })] });
  const mountAllStates = (kua, mode) => {
    deriveRecoveryComparison.mockReturnValueOnce(allStates());
    const root = renderIn(kua, mode, { blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    expandDetails(root);
    return root;
  };

  test.each(PALETTE_ROWS)("%s: all seven states paint three graded tokens plus one shared neutral", (_n, kua, mode) => {
    const root = mountAllStates(kua, mode);
    const marks = hostById(root, 'recovery-exercise-mark').map(m => flat(m).backgroundColor);
    expect(marks).toEqual([
      kua.recoveryBandAtOrAbove, kua.recoveryBandRebuilding, kua.recoveryBandRebuilding, kua.recoveryBandEarly,
      kua.onSurfaceVariant, kua.onSurfaceVariant, kua.onSurfaceVariant,
    ]);
    expect(statusWords(root)).toEqual([
      'At or above', 'Rebuilding', 'Rebuilding', 'Early', "Can't compare", 'Not trained yet', 'Added during recovery',
    ]);
    // Three graded colors + exactly one neutral across all seven rows; every mark
    // is a real color (a dropped palette token paints nothing).
    expect(marks.every(c => /^#[0-9A-Fa-f]{6}$/.test(c))).toBe(true);
    expect(new Set(marks).size).toBe(4);
    // Bar fill of a graded row is its band token.
    expect(flat(barOf(root, 0).children[0]).backgroundColor).toBe(kua.recoveryBandAtOrAbove);
    expect(flat(barOf(root, 1).children[0]).backgroundColor).toBe(kua.recoveryBandRebuilding);
    // Hero bar and summary mini-bar: only the three graded segments, Close merged
    // into Rebuilding (1 + 1 = 2), and never a quiet status.
    const hero = segsIn(hostById(root, 'recovery-bands-rows')[0]);
    expect(hero.map(s => s.props.testID)).toEqual(['recovery-segment-at_or_above', 'recovery-segment-rebuilding', 'recovery-segment-early']);
    expect(hero.map(s => flat(s).flex)).toEqual([1, 2, 1]);
    expect(hero.map(s => flat(s).backgroundColor)).toEqual([kua.recoveryBandAtOrAbove, kua.recoveryBandRebuilding, kua.recoveryBandEarly]);
    // The collapsed/expanded summary no longer repeats the bar.
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    expect(segsIn(hostById(root, 'recovery-roster-summary')[0])).toHaveLength(0);
  });

  test('all surfaces use the same three names, the merged count and complete labels; Close is never named', () => {
    const root = mountAllStates(KUA_PALETTES.hardCourt.light, 'light');
    const heroBar = hostById(root, 'recovery-bands-rows')[0];
    // trained = roster 6 minus not-trained 1 (hero/summary values from deriveRecoveryWeekBands).
    expect(heroBar.props.accessibilityLabel).toBe(
      "Week 1 return bands across 5 trained exercises: At or above 1, Rebuilding 2, Early 1, Not trained yet 1, Can't compare 1, Added during recovery 1"
    );
    expect(rosterLabel(root)).toContain("Trained this week: 5 of 6 roster exercises, 1 not trained yet. By status: At or above 1, Rebuilding 2, Early 1, Not trained yet 1, Can't compare 1, Added during recovery 1.");
    expect(rosterLabel(root)).toContain('Added during recovery 1');
    // Legend names the present graded states and the quiet Can't compare, same words.
    const legend = hostTextsIn(heroBar);
    expect(legend).toEqual(['At or above', 'Rebuilding', 'Early', "Can't compare"]);
    // Can't compare has a neutral dot but never a segment.
    const dots = heroBar.findAll(n => typeof n.type === 'string' && flat(n).width === 10).map(n => flat(n).backgroundColor);
    expect(dots[3]).toBe(KUA_PALETTES.hardCourt.light.onSurfaceVariant);
    // Nothing anywhere says Close, visibly or spoken.
    expect(hasText(root, 'Close')).toBe(false);
    expect(root.findAll(n => typeof n.props.accessibilityLabel === 'string' && /\bClose\b/.test(n.props.accessibilityLabel))).toHaveLength(0);
    // Every row label starts with the same word it shows.
    const labels = rowLabels(root);
    ['At or above', 'Rebuilding', 'Early', "Can't compare", 'Not trained yet', 'Added during recovery']
      .forEach(w => expect(labels.some(l => l.includes(`, ${w}.`) || l.endsWith(`, ${w}`))).toBe(true));
  });

  test('across-weeks strip: merged Rebuilding count, quiet Can\'t compare never a segment, shared legend', () => {
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [
      mockWeek({ week_id: 'rw1', week_number: 1, note_id: 'note-1', exercises: [met('A'), at('B', 95), at('C', 60), classChanged('F')] }),
      mockWeek({ week_id: 'rw2', week_number: 2, note_id: 'note-2', exercises: [classChanged('F')] }),
    ] }));
    const kua = KUA_PALETTES.clayCourt.dark;
    const root = renderIn(kua, 'dark', {
      blocks: [block()], weeks: [week(1, 'note-1'), week(2, 'note-2')], notes: [note('note-1', BASELINE_TEXT), note('note-2', BASELINE_TEXT)],
    });
    const cell = (n) => hostById(root, `recovery-band-strip-week-${n}`)[0];
    expect(cell(1).props.accessibilityLabel).toBe("Week 1: At or above 1, Rebuilding 2, Early 0, Not trained yet 0, Can't compare 1");
    expect(segsIn(cell(1)).map(s => [s.props.testID, flat(s).flex, flat(s).backgroundColor])).toEqual([
      ['recovery-segment-at_or_above', 1, kua.recoveryBandAtOrAbove],
      ['recovery-segment-rebuilding', 2, kua.recoveryBandRebuilding],
    ]);
    // A week with only a not-graded row has no colored segment at all.
    expect(cell(2).props.accessibilityLabel).toBe("Week 2: At or above 0, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 1");
    expect(segsIn(cell(2))).toHaveLength(0);
    expect(hostTextsIn(cell(2))).toContain("1 can't compare");
    // The shared legend: graded present + the quiet one with the neutral dot.
    const strip = hostById(root, 'recovery-band-strip')[0];
    // (The legend is the strip's last child; week 2's own neutral dot is a row mark.)
    const legend = strip.children[strip.children.length - 1];
    const legendItems = legend.findAll(n => typeof n.type === 'string' && flat(n).width === 10);
    expect(hostTextsIn(legend)).toEqual(['At or above', 'Rebuilding', "Can't compare"]);
    expect(legendItems.map(n => flat(n).backgroundColor)).toEqual([kua.recoveryBandAtOrAbove, kua.recoveryBandRebuilding, kua.onSurfaceVariant]);
    expect(hasText(root, 'Close')).toBe(false);
  });

  // The bar shows Total work; the band is graded on the LIMITING measure. When they
  // disagree the row must say which measure the bar is, in the visible text and the
  // spoken label, while the band (merged Rebuilding) stays derived unchanged.
  const DISAGREE = [
    // [label, baseline, week, band/limit%, bar%]
    ['load short (66%), work back (133%) — old rebuilding range', '-Squat\n- 300 5,5,5', '-Squat\n- 200 10,10,10', 66, 133],
    ['load 93% (old close range), work back (112%)', '-Squat\n- 300 5,5,5', '-Squat\n- 280 6,6,6', 93, 112],
  ];
  test.each(DISAGREE)('bar vs band measure — %s: visible Rebuilding, bar names Total work', (_l, base, weekText, loadPct, workPct) => {
    const root = setup({
      blocks: [block({ baseline: captureRecoveryBaselineFromText(base) })],
      weeks: [week(1, 'note-w1')], notes: [note('note-w1', weekText)],
    }).root;
    expandDetails(root);
    const row = lastWeek().exercises[0];
    expect(row.state).toBe(S.REBUILDING);
    expect(row.metrics.find(m => m.metric === 'top_load').percent).toBe(loadPct);
    expect(statusWords(root)).toEqual(['Rebuilding']);
    expect(fillOf(barOf(root))).toBe('100%');
    expect(percentTextOf(root)).toBe(`Total work ${workPct}%`);
    const spoken = hostRows(root)[0].props.accessibilityLabel;
    expect(spoken).toContain(`Total work ${workPct}% of baseline`);
    expect(spoken).toContain(`Load ${loadPct}% of baseline`);
    expect(spoken.startsWith('Squat, Rebuilding. Total work')).toBe(true);
  });

  // --- accessible labels name every state, zeros included ---------------------
  test('hero and summary labels enumerate the SAME six states with zeros; hero added is the selected week\'s count', () => {
    const states = (label) => label.match(/At or above \d+, Rebuilding \d+, Early \d+, Not trained yet \d+, Can't compare \d+, Added during recovery \d+/)[0];
    // A week with nothing but at-or-above work and no added row: every other state is a spoken zero.
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({ exercises: [met('A'), met('B')] })] }));
    const quiet = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    expandDetails(quiet);
    const zero = "At or above 2, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 0, Added during recovery 0";
    expect(states(hostById(quiet, 'recovery-bands-rows')[0].props.accessibilityLabel)).toBe(zero);
    expect(states(rosterLabel(quiet))).toBe(zero);
    // Every state non-zero, two added rows.
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({
      exercises: [met('A'), at('B', 95), at('C', 60), at('D', 20), untrained('E'), classChanged('F')],
      added: [addedRow('G'), addedRow('H')],
    })] }));
    const full = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    expandDetails(full);
    const all = "At or above 1, Rebuilding 2, Early 1, Not trained yet 1, Can't compare 1, Added during recovery 2";
    expect(states(hostById(full, 'recovery-bands-rows')[0].props.accessibilityLabel)).toBe(all);
    expect(states(rosterLabel(full))).toBe(all);
  });

  test('strip per-week labels name graded, Not trained yet and Can\'t compare with zeros, and need no Added', () => {
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [
      mockWeek({ week_id: 'rw1', week_number: 1, note_id: 'note-1', exercises: [met('A'), untrained('E')], added: [addedRow('G')] }),
      mockWeek({ week_id: 'rw2', week_number: 2, note_id: 'note-2', exercises: [met('A')] }),
    ] }));
    const root = setup({
      blocks: [block()], weeks: [week(1, 'note-1'), week(2, 'note-2')], notes: [note('note-1', BASELINE_TEXT), note('note-2', BASELINE_TEXT)],
    }).root;
    const label = (n) => hostById(root, `recovery-band-strip-week-${n}`)[0].props.accessibilityLabel;
    expect(label(1)).toBe("Week 1: At or above 1, Rebuilding 0, Early 0, Not trained yet 1, Can't compare 0");
    expect(label(2)).toBe("Week 2: At or above 1, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 0");
    expect(label(1)).not.toContain('Added');
  });

  // --- no graded state => no segmented track on any surface --------------------
  // [label, exercises, added, hero bar rendered?, strip text]
  const NO_GRADED = [
    ["only can't-compare rows", [classChanged('F')], [], true, "1 can't compare"],
    ['only not-trained rows', [untrained('E')], [], false, '0 trained'],
    ['only added work', [], [addedRow('G')], false, '0 trained'],
  ];
  test.each(NO_GRADED)('%s: the hero bar, summary mini-bar and strip row draw no empty track', (_l, exercises, added, heroBarShown, stripText) => {
    const wk = (n) => mockWeek({ week_id: `rw${n}`, week_number: n, note_id: `note-${n}`, exercises, added });
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [wk(1), wk(2)] }));
    const root = setup({
      blocks: [block()], weeks: [week(1, 'note-1'), week(2, 'note-2')], notes: [note('note-1', BASELINE_TEXT), note('note-2', BASELINE_TEXT)],
    }).root;
    expandDetails(root);
    const isTrack = (n) => typeof n.type === 'string' && flat(n).flexDirection === 'row' && flat(n).overflow === 'hidden' && [6, 10].includes(flat(n).height);
    // Hero bar: absent entirely, or present with its legend/label but no track.
    const hero = hostById(root, 'recovery-bands-rows');
    expect(hero.length > 0).toBe(heroBarShown);
    hero.forEach(h => expect(h.findAll(isTrack)).toHaveLength(0));
    expect(segsIn(root)).toHaveLength(0);
    // Summary mini-bar.
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    // Strip rows: no track, the quiet text instead.
    const cell = hostById(root, 'recovery-band-strip-week-2')[0];
    expect(cell.findAll(isTrack)).toHaveLength(0);
    expect(hostTextsIn(cell)).toContain(stripText);
    if (heroBarShown) expect(hostTextsIn(hero[0])).toEqual(["Can't compare"]);
  });

  // --- the bar line cannot overflow at large text / narrow cards ---------------
  test('a 4-digit measure label never clips and the bar line wraps at fontScale 2 on a 252dp card', () => {
    mockWindow = { width: 252, height: 844, scale: 3, fontScale: 2 };
    const root = mocked([mockRow({
      key: 'x', name: 'X', state: S.REBUILDING, exercise_class: 'weighted',
      metrics: [metricRow('top_load', 50, 100, 50, false), metricRow('volume', 11330, 1000, 1133, true)], unmet: ['top_load'],
    })]);
    mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
    const row = hostRows(root)[0];
    const label = row.findAll(n => typeof n.type === 'string' && n.type === 'Text' && /1133%$/.test([].concat(n.props.children).join('')))[0];
    expect([].concat(label.props.children).join('')).toBe('Total work 1133%');
    // Never truncated; may wrap inside the card; never forced past the card width.
    expect(label.props.numberOfLines).toBeUndefined();
    expect(flat(label)).toMatchObject({ maxWidth: '100%', flexShrink: 0 });
    // The bar line wraps so the label drops under the bar, and the track keeps a sane floor.
    let barRow = hostById(root, 'recovery-exercise-bar')[0].parent;
    while (typeof barRow.type !== 'string') barRow = barRow.parent;
    expect(flat(barRow).flexWrap).toBe('wrap');
    expect(flat(barRow).flexDirection).toBe('row');
    expect(flat(barRow).rowGap).toBeGreaterThan(0);
    const track = flat(hostById(root, 'recovery-exercise-bar')[0]);
    expect(track).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: 96 });
    expect(track.minWidth).toBeGreaterThanOrEqual(96);
    // Fill still caps; the factual number is the label's.
    expect(fillOf(barOf(root))).toBe('100%');
  });

  // Regression: the merge is presentation-only. The shared derivation still emits
  // its six buckets with Close separate, thresholds unchanged, and the buckets
  // still sum to the roster.
  test('deriveRecoveryWeekBands, RETURN_BANDS and the thresholds are unchanged by the visual merge', () => {
    const { RETURN_BANDS, RETURN_BAND_CLOSE, RETURN_BAND_REBUILDING, deriveRecoveryWeekBands } = require('../lib/data/recoveryReturnBands');
    expect(RETURN_BANDS.map(b => b.id)).toEqual(['at_or_above', 'close', 'rebuilding', 'early', 'cannot_compare', 'not_trained_yet']);
    expect(RETURN_BAND_CLOSE).toBe(0.9);
    expect(RETURN_BAND_REBUILDING).toBe(0.5);
    const week1 = allStates().weeks[0];
    const bands = deriveRecoveryWeekBands(week1);
    expect(bands.buckets).toEqual({ at_or_above: 1, close: 1, rebuilding: 1, early: 1, cannot_compare: 1, not_trained_yet: 1 });
    expect(Object.values(bands.buckets).reduce((a, b) => a + b, 0)).toBe(bands.roster_size);
    expect(bands.trained).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// #1219 owner phone review: text-led collapsed evidence, one-line counts, the
// hero's stated scope, and a considered Reason / date context block.
// ---------------------------------------------------------------------------
describe('AnalyticsRecoverySection — owner phone review: counts, hero scope, context (#1219)', () => {
  const { StyleSheet } = require('react-native');
  const S = RECOVERY_COMPARISON_STATES;
  const hostById = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
  const flat = (n) => StyleSheet.flatten(n.props.style || {});
  const rebuilding = (name) => mockRow({
    key: name, name, state: S.REBUILDING, exercise_class: 'weighted',
    metrics: [metricRow('top_load', 100, 100, 100, true), metricRow('volume', 66, 100, 66, false)], unmet: ['volume'],
  });
  const untrained = (name) => ({
    ...mockRow({ key: name, name, state: S.NOT_REINTRODUCED, exercise_class: 'weighted', metrics: [metricRow('top_load', 0, 100, 0, false), metricRow('volume', 0, 100, 0, false)], unmet: ['top_load', 'volume'] }),
    week_name: null, week_exercise_class: null,
  });
  const added = (name) => mockRow({ key: name, name, state: S.ADDED_DURING_RECOVERY, exercise_class: 'reps_only', metrics: [metricRow('total_reps', 10, null, null, null)] });
  // The owner's Week 6: 7 trained rows all Rebuilding, 20 not trained yet, 5 added.
  const ownerWeek = () => mockComparison({ weeks: [mockWeek({
    week_number: 6,
    exercises: [
      ...Array.from({ length: 7 }, (_, i) => rebuilding(`T${i}`)),
      ...Array.from({ length: 20 }, (_, i) => untrained(`U${i}`)),
    ],
    added: Array.from({ length: 5 }, (_, i) => added(`A${i}`)),
  })] });
  const mountOwner = (blockOver = {}, extra = {}) => {
    deriveRecoveryComparison.mockReturnValueOnce(ownerWeek());
    let c;
    act(() => {
      c = render.create(
        <AnalyticsRecoverySection
          blocks={[block({ baseline_note_title: 'Summer 2026 Routine', reason: 'Back injury', started_at: '2026-08-08T12:00:00Z', ...blockOver })]}
          weeks={[week(6, 'note-w6')]}
          notes={[note('note-w6', BASELINE_TEXT)]}
          {...extra}
        />
      );
    });
    return c.root;
  };
  const tokensOf = (root) => hostById(root, 'recovery-count-tokens')[0];
  const tokenViews = (root) => hostById(root, 'recovery-count-token');

  // --- 1. no duplicate bar ----------------------------------------------------
  test('the collapsed Exercise details row has no bar: only the hero draws the graded segments', () => {
    const root = mountOwner();
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    const summary = hostById(root, 'recovery-roster-summary')[0];
    expect(summary.findAll(n => typeof n.type === 'string' && /^recovery-segment-/.test(n.props.testID || ''))).toHaveLength(0);
    // Nothing in the summary is a filled strip: no row-direction view with a hidden-overflow height of 6 or 10.
    expect(summary.findAll(n => typeof n.type === 'string' && flat(n).overflow === 'hidden' && [6, 10].includes(flat(n).height))).toHaveLength(0);
    // The hero bar is still there, once.
    expect(hostById(root, 'recovery-bands-rows')).toHaveLength(1);
  });

  // --- 2. counts: intrinsic whole-token flow ---------------------------------
  // The layout guarantee is STRUCTURAL (no estimate, no per-row logic): a plain
  // `flexWrap: 'wrap'` row of unsplittable tokens. Real wrapping depends on the
  // platform's layout engine, so the tests pin the structure that guarantees it.
  const assertIntrinsicTokens = (root, expected) => {
    const container = tokensOf(root);
    expect(flat(container)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
    expect(flat(container).columnGap).toBeGreaterThan(0);
    expect(flat(container).rowGap).toBeGreaterThanOrEqual(0);
    const tokens = tokenViews(root);
    expect(tokens.map(t => hostTextsIn(t))).toEqual(expected);
    for (const t of tokens) {
      // A whole token: it keeps its text intact whenever it fits (the container
      // wraps whole tokens to the next line BEFORE any shrink applies). Only a
      // token wider than the card itself may shrink — `maxWidth: 100%` bounds it
      // and ONLY its label may wrap, as a last resort. Nothing truncates.
      expect(flat(t)).toMatchObject({ flexDirection: 'row', flexShrink: 1, maxWidth: '100%' });
      const [num, label] = t.findAll(n => typeof n.type === 'string' && n.type === 'Text');
      expect(flat(num).flexShrink).toBe(0);
      expect(flat(label).flexShrink).toBe(1);
      for (const text of [num, label]) expect(text.props.numberOfLines).toBeUndefined();
    }
    // The tokens are direct children of the one wrapping row: nothing else (no
    // separator glyph or view that could start or end a wrapped row).
    expect(container.children.map(c => c.props.testID)).toEqual(expected.map(() => 'recovery-count-token'));
    expect(hostById(root, 'recovery-count-sep')).toHaveLength(0);
    expect(hostTextsIn(container).includes('·')).toBe(false);
  };

  test('owner Week 6: "7 trained · 20 not yet · 5 added" are three whole tokens in one wrapping row; the full wording stays on the label', () => {
    for (const width of [390, 252]) {
      mockWindow = { width, height: 844, scale: 3, fontScale: 1 };
      const root = mountOwner();
      assertIntrinsicTokens(root, [['7', 'trained'], ['20', 'not yet'], ['5', 'added']]);
      const label = rosterLabel(root);
      expect(label).toContain('Trained this week: 7 of 27 roster exercises, 20 not trained yet.');
      expect(label).toContain('Not trained yet 20');
      expect(label).toContain('Added during recovery 5');
      expandDetails(root);
      assertIntrinsicTokens(root, [['7', 'trained'], ['20', 'not yet'], ['5', 'added']]);
    }
    mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
  });

  test('the same structure holds at fontScale 2 on a 252dp card (tokens flow whole; nothing is measured or estimated)', () => {
    mockWindow = { width: 252, height: 844, scale: 3, fontScale: 2 };
    const root = mountOwner();
    mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
    assertIntrinsicTokens(root, [['7', 'trained'], ['20', 'not yet'], ['5', 'added']]);
  });

  test('an individually oversized token is bounded by the card and wraps ITS OWN label as a last resort (fontScale 2, ~252dp, long wording)', () => {
    mockWindow = { width: 252, height: 844, scale: 3, fontScale: 2 };
    // 20 "can't compare" rows: the widest quiet token the summary can show.
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({
      week_number: 6,
      exercises: Array.from({ length: 20 }, (_, i) => mockRow({
        key: `C${i}`, name: `C${i}`, state: S.NOT_COMPARABLE, exercise_class: 'weighted',
        unavailable_reason: RECOVERY_UNAVAILABLE_REASONS.EXERCISE_CLASS_CHANGED,
      })),
    })] }));
    const root = (() => {
      let c;
      act(() => { c = render.create(<AnalyticsRecoverySection blocks={[block()]} weeks={[week(6, 'note-w6')]} notes={[note('note-w6', BASELINE_TEXT)]} />); });
      return c.root;
    })();
    mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
    const token = tokenViews(root).find(t => hostTextsIn(t)[1] === "can't compare");
    expect(hostTextsIn(token)).toEqual(['20', "can't compare"]);
    // Bounded by the row: cannot be wider than the card; shrinks only if it alone must.
    expect(flat(token)).toMatchObject({ maxWidth: '100%', flexShrink: 1 });
    const [num, label] = token.findAll(n => typeof n.type === 'string' && n.type === 'Text');
    expect(flat(num).flexShrink).toBe(0); // the count itself never shrinks or wraps
    expect(flat(label).flexShrink).toBe(1); // only the label may wrap, never truncate
    expect(label.props.numberOfLines).toBeUndefined();
    // The full wording is unaffected.
    expect(rosterLabel(root)).toContain("Can't compare 20");
  });

  test('no width-estimate balancing helper remains and the count layout has no row bookkeeping', () => {
    const visuals = require('../components/recovery/RecoveryVisuals');
    expect(visuals.balancedTokenRows).toBeUndefined();
    expect(visuals.estimateTokenWidth).toBeUndefined();
    expect(hostById(mountOwner(), 'recovery-count-row-0')).toHaveLength(0);
  });

  // --- 3. hero scope ------------------------------------------------------------
  test('the hero states its scope, names the routine once, and the label carries the full scope and name', () => {
    const root = mountOwner();
    const hero = hostById(root, 'recovery-hero')[0];
    expect(hostTextsIn(hero)).toEqual(['Week 6', '0 of 7', 'at baseline', 'Summer 2026 Routine baseline']);
    expect(findAllText(root).filter(t => t.includes('Summer 2026 Routine'))).toEqual(['Summer 2026 Routine baseline']);
    expect(hero.props.accessibilityLabel).toBe(
      'Week 6: 0 of 7 exercises trained this week at or above Summer 2026 Routine baseline. The count covers only exercises trained this week.'
    );
    // Long names ellipsize on their own single line; the label keeps the whole name.
    const long = 'A Very Long Routine Name That Cannot Fit On One Phone Line';
    const longRoot = mountOwner({ baseline_note_title: long });
    const routineLine = hostById(longRoot, 'recovery-hero')[0].findAll(n => typeof n.type === 'string' && n.type === 'Text' && n.props.numberOfLines === 1)[0];
    expect(routineLine.props.ellipsizeMode).toBe('tail');
    expect([].concat(routineLine.props.children).join('')).toContain('…');
    expect(hostById(longRoot, 'recovery-hero')[0].props.accessibilityLabel).toContain(`at or above ${long} baseline`);
  });

  // --- 4. context block -----------------------------------------------------------
  test('owner context: Started + date + info on one row, Reason + value + edit glyph on the next, no far-edge floating control', () => {
    const root = mountOwner({}, { onSaveReason: async () => ({ ok: true }) });
    const ctx = hostById(root, 'recovery-footer-row')[0];
    expect(findAllText(ctx)).toEqual(['Started', '08-08-2026', 'Reason', 'Back injury']);
    const dateRow = hostById(root, 'recovery-context-date')[0];
    expect(flat(dateRow)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', minHeight: 44 });
    const info = byLabel(root, 'About these numbers');
    expect(dateRow.findAll(n => n === info || n.props.accessibilityLabel === 'About these numbers').length).toBeGreaterThan(0);
    // Adjacent by ordinary row gap — never margin-pushed to the edge, and NO
    // negative margin: the 44x44 box is fully reserved (cannot overlap the date or
    // start outside the row), and wraps whole to the next line when it cannot fit.
    const infoStyle = flat(info);
    expect(infoStyle.marginLeft).not.toBe('auto');
    for (const side of ['margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'marginHorizontal', 'marginVertical']) {
      expect(infoStyle[side] === undefined || infoStyle[side] >= 0).toBe(true);
    }
    expect(infoStyle).toMatchObject({ minWidth: 44, minHeight: 44, flexShrink: 0 });
    expect(flat(dateRow).columnGap).toBeGreaterThan(0);
    // No row in the block uses space-between / auto margins to float a control away from its text.
    const floaters = ctx.findAll(n => typeof n.type === 'string' && (flat(n).justifyContent === 'space-between' || flat(n).marginLeft === 'auto'));
    expect(floaters).toHaveLength(0);
  });

  test('opening the editor swaps the Reason row for the editor, Cancel restores it, and the disclosure stays a polite live region', () => {
    const root = mountOwner({}, { onSaveReason: async () => ({ ok: true }) });
    act(() => { byLabel(root, 'Edit reason for this recovery block: Back injury').props.onPress(); });
    expect(hostById(root, 'recovery-reason-row')).toHaveLength(0);
    expect(byLabel(root, 'Reason for this recovery block')).toBeDefined();
    act(() => { byLabel(root, 'Cancel editing the reason').props.onPress(); });
    expect(hostById(root, 'recovery-reason-row')).toHaveLength(1);
    // The note appears directly under the date row, inside the same polite live region.
    const note = hostById(root, 'recovery-about-note')[0];
    expect(note.props.accessibilityLiveRegion).toBe('polite');
    act(() => { byLabel(root, 'About these numbers').props.onPress(); });
    expect(hasText(root, 'Not a medical judgment')).toBe(true);
    expect(findAllText(hostById(root, 'recovery-about-note')[0])).toEqual(['Training numbers only. Not a medical judgment — only you end a Recovery block.']);
  });

  // One announcement per context row: the visible label is hidden from assistive
  // tech and the adjacent value's own label carries it, so "Started" etc. is
  // never spoken twice.
  test.each([
    ['Started', () => mountOwner(), 'Started 08-08-2026'],
    ['Dates', () => mountOwner({ completed_at: '2026-09-20T12:00:00Z' }), 'Dates 08-08-2026 – 09-20-2026'],
    ['Baseline', () => {
      let c;
      act(() => { c = render.create(<AnalyticsRecoverySection blocks={[block({ baseline_note_title: 'Summer 2026 Routine' })]} weeks={[]} notes={[]} />); });
      return c.root;
    }, 'Baseline: Summer 2026 Routine'],
  ])('the %s context row is announced once', (label, mount, spoken) => {
    const root = mount();
    // Every visible bare label is hidden from accessibility (both platforms).
    const labels = root.findAll(n => typeof n.type === 'string' && n.type === 'Text' && [].concat(n.props.children).join('') === label);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(l.props.accessibilityElementsHidden).toBe(true);
      expect(l.props.importantForAccessibility).toBe('no');
    }
    // Exactly one element speaks the row, and it carries label + value together.
    const speakers = root.findAll(n => typeof n.type === 'string' && n.props.accessibilityLabel === spoken);
    expect(speakers).toHaveLength(1);
    // No second element in the row repeats the label text on its own.
    const stray = root.findAll(n => typeof n.type === 'string' && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith(label) && n.props.accessibilityLabel !== spoken);
    expect(stray).toHaveLength(0);
  });

  test('a read-only Reason row is one grouped announcement', () => {
    const { BlockEvidence } = require('../components/recovery/RecoveryEvidence');
    let c;
    act(() => { c = render.create(<BlockEvidence block={block({ reason: 'torn hamstring' })} weeks={[]} notes={[]} unit="lb" />); });
    const row = hostById(c.root, 'recovery-reason-row')[0];
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toBe('Reason: torn hamstring');
  });

  test('completed block: "Dates" row with the range, Reason row, and the Reopen control stay above the context block', () => {
    const root = mountOwner({ completed_at: '2026-09-20T12:00:00Z' }, { onSaveReason: async () => ({ ok: true }) });
    const ctx = hostById(root, 'recovery-footer-row')[0];
    expect(findAllText(ctx)).toEqual(['Dates', '08-08-2026 –', '09-20-2026', 'Reason', 'Back injury']);
  });
});

describe('AnalyticsRecoverySection — rebuild a v1 baseline (#1227)', () => {
  const ROUTINE = '-Squat 3x5\n- 225 5,5,5\n-Bench 3x5\n- 135 5,5,4';
  const V1 = { version: 1, exercises: [{ key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, volume: 300, sets_completed: 3 }] };
  let mockRebuild;

  const mount = ({ blk = block({ baseline: V1 }), notes = [{ ...note('note-baseline', ROUTINE), updated_at: '2026-04-01T00:00:00Z' }], ...props } = {}) => {
    let component;
    act(() => {
      component = render.create(
        <AnalyticsRecoverySection blocks={[blk]} weeks={[]} notes={notes} {...props} />
      );
    });
    return component;
  };
  const press = (root, label) => act(() => { byLabel(root, label).props.onPress(); });

  beforeEach(() => {
    mockRebuild = jest.fn().mockResolvedValue({ ok: true });
    jest.spyOn(require('../hooks/entries/recoveryBlockHooks'), 'useRecoveryBlockLifecycle')
      .mockReturnValue({ rebuildBaseline: mockRebuild });
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('offers the action for an eligible v1 block, active or completed', () => {
    expect(byLabel(mount().root, 'Rebuild baseline')).toBeDefined();
    expect(byLabel(mount({ blk: block({ baseline: V1, completed_at: '2026-06-01T00:00:00Z' }) }).root, 'Rebuild baseline')).toBeDefined();
  });

  test.each([
    ['v2 block', { blk: block() }],
    ['missing note', { notes: [] }],
    ['oversized note', { notes: [note('note-baseline', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1))] }],
    ['deleted note', { notes: [{ ...note('note-baseline', ROUTINE), deleted_at: '2026-06-01T00:00:00Z' }] }],
  ])('no action for %s', (_n, props) => {
    expect(byLabel(mount(props).root, 'Rebuild baseline')).toBeUndefined();
  });

  test('preview shows old → new per exercise with order, makes no write, and cancel closes it', () => {
    const { root } = mount();
    press(root, 'Rebuild baseline');
    expect(hasText(root, '1. Squat: not in the old baseline → 225 lb top, 3,375 lb volume')).toBe(true);
    expect(hasText(root, '2. Bench: 100 lb top, 300 lb volume → 135 lb top, 1,890 lb volume (latest session (target never completed))')).toBe(true);
    expect(hasText(root, 'edited after Recovery began')).toBe(false);
    press(root, 'Cancel rebuilding the baseline');
    expect(mockRebuild).not.toHaveBeenCalled();
    expect(byLabel(root, 'Rebuild baseline')).toBeDefined();
  });

  test('preview weights follow the selected display unit', () => {
    jest.spyOn(require('../lib/unitPreference'), 'useWeightUnit').mockReturnValue('kg');
    const { root } = mount();
    press(root, 'Rebuild baseline');
    expect(hasText(root, '1. Squat: not in the old baseline → 102.1 kg top, 1,531 kg volume')).toBe(true);
  });

  test('warns when the routine was edited after Recovery began; confirm stays explicit', () => {
    const { root } = mount({ notes: [{ ...note('note-baseline', ROUTINE), updated_at: '2026-06-01T00:00:00Z' }] });
    press(root, 'Rebuild baseline');
    expect(hasText(root, 'edited after Recovery began')).toBe(true);
    expect(mockRebuild).not.toHaveBeenCalled();
  });

  test('confirm calls the rebuild once and announces success; no second action offered', async () => {
    const { root } = mount();
    press(root, 'Rebuild baseline');
    await act(async () => { await byLabel(root, 'Confirm rebuilding the baseline').props.onPress(); });
    expect(mockRebuild).toHaveBeenCalledTimes(1);
    expect(mockRebuild).toHaveBeenCalledWith({ blockId: 'rb1', expectedBaseline: captureRecoveryBaselineFromText(ROUTINE) });
    expect(hasText(root, 'Baseline rebuilt from the routine.')).toBe(true);
    expect(byLabel(root, 'Confirm rebuilding the baseline')).toBeUndefined();
  });

  test('a failed write shows the error and keeps the preview open', async () => {
    mockRebuild.mockResolvedValue({ ok: false, error: 'disk full' });
    const { root } = mount();
    press(root, 'Rebuild baseline');
    await act(async () => { await byLabel(root, 'Confirm rebuilding the baseline').props.onPress(); });
    expect(hasText(root, 'disk full')).toBe(true);
    expect(hasText(root, 'Baseline rebuilt')).toBe(false);
    expect(byLabel(root, 'Confirm rebuilding the baseline')).toBeDefined();
  });

  test('the action is disabled while Recovery state is pending', () => {
    const { root } = mount({ pendingRecovery: [{ id: 'op' }] });
    expect(byLabel(root, 'Rebuild baseline').props.disabled).toBe(true);
  });
});
