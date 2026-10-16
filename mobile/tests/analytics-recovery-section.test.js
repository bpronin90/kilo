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

// The snapshot derives the comparison once per input (#1315), so a queued
// `mockReturnValueOnce` must never leak into the next test.
beforeEach(() => {
  deriveRecoveryComparison.mockReset();
  deriveRecoveryComparison.mockImplementation(jest.requireActual('../lib/data/recoveryAnalytics').deriveRecoveryComparison);
  // A newly queued mocked comparison must not be shadowed by a cached derivation
  // of the same fixture, so queuing one also empties the content-keyed store.
  const queue = deriveRecoveryComparison.mockReturnValueOnce.bind(deriveRecoveryComparison);
  deriveRecoveryComparison.mockReturnValueOnce = (value) => {
    require('../lib/data/recoverySnapshot')._resetRecoverySnapshotStore();
    return queue(value);
  };
  require('../lib/data/recoverySnapshot')._resetRecoverySnapshotStore();
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
  // The shared Recovery snapshot store is content-keyed; mocked derivations must
  // not be shadowed by an earlier test's identical fixture.
  require('../lib/data/recoverySnapshot')._resetRecoverySnapshotStore();
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

function summaryLabel(root) {
  const n = root.findAll(x => typeof x.type === 'string' && x.props.testID === 'recovery-strength-summary')[0];
  return n ? n.props.accessibilityLabel : null;
}
function hasText(root, needle) {
  return findAllText(root).some(s => s.includes(needle));
}

function byLabel(root, label) {
  if (label instanceof RegExp) {
    return root.findAll(n => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && label.test(n.props.accessibilityLabel))[0];
  }
  return root.findAll(inst => inst.props.accessibilityLabel === label)[0];
}

// Details are collapsed by default (#758); every row-level assertion opens them.
function expandDetails(root, { rows = true } = {}) {
  // #1315: the Lifts disclosure holds the strength rows and the raw evidence.
  const toggle = byLabel(root, 'Expand lifts');
  if (toggle) act(() => { toggle.props.onPress(); });
  else expect(byLabel(root, 'Collapse lifts')).toBeDefined();
  // #1300: rows default to one summary line; secondary evidence sits behind a
  // per-row tap. Row-evidence assertions open every row (`rows: false` keeps
  // the default collapsed view for the summary tests).
  if (rows) expandRows(root);
}
function hostById(root, id) {
  return root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
}
// The strength week rows are the sole week selector (#1307).
function weekRow(root, n) {
  return root.findAll(x => x.props && x.props.testID === `recovery-strength-week-${n}` && typeof x.props.onPress === 'function')[0];
}
function pickWeek(root, n) {
  const row = weekRow(root, n);
  expect(row).toBeDefined();
  act(() => { row.props.onPress(); });
}
// Maintenance controls live in the Manage block panel (#1307), collapsed by default.
function openManage(root) {
  const trigger = root.findAll(n => n.props && n.props.testID === 'recovery-manage-block-trigger' && n.props.onPress)[0];
  expect(trigger).toBeDefined();
  if (!trigger.props.accessibilityState.expanded) act(() => { trigger.props.onPress(); });
  return root;
}
function expandRows(root) {
  const pressables = root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-exercise-row' && n.props.onPress);
  act(() => { pressables.forEach(n => n.props.onPress()); });
}

// Accessible labels of the collapsed exercise rows — scoped so a state-group
// header (which carries `accessibilityRole="header"`) cannot satisfy a
// row-level assertion.
function rowLabels(root) {
  return root
    .findAll(inst => typeof inst.type === 'string' && inst.props.testID === 'recovery-exercise-row')
    .map(inst => inst.props.accessibilityLabel);
}

// Host-node lookups (the test renderer otherwise reports both the composite and
// its underlying host node for the same element).
function hostRows(root) {
  return root.findAll(inst => typeof inst.type === 'string' && inst.props.testID === 'recovery-exercise-row');
}
// The raw-evidence part of a row: texts outside the strength half (#1315).
function rawTextsIn(inst) {
  const inStrength = (n) => { for (let p = n.parent; p; p = p.parent) { if (typeof p.type === 'string' && /^recovery-strength-lift-/.test(p.props.testID || '')) return true; } return false; };
  return inst.findAll(n => typeof n.type === 'string' && n.type === 'Text' && !inStrength(n))
    .map(n => [].concat(n.props.children).join(''));
}
function hostTextsIn(inst) {
  return inst.findAll(n => typeof n.type === 'string' && n.type === 'Text')
    .map(n => [].concat(n.props.children).join(''));
}
// The plain-word status each exercise row shows beside its band mark (#1219),
// in on-screen order. Row text order is: name, status, [percent], [numbers…].
function statusWordOf(r) {
  const n = r.findAll(x => typeof x.type === 'string' && x.props.testID === 'recovery-exercise-status')[0];
  return [].concat(n.props.children).join('');
}
function statusWords(root) {
  return hostRows(root).map(statusWordOf);
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

// A focused completed block starts collapsed behind its ended header (#1425).
function expandEnded(root) {
  const toggle = byLabel(root, /^Expand ended recovery block/);
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

    // #1209: the sentence moved into the drill-down; #1305: the overview leads
    // with the strength-relative headline.
    expect(hasText(root, 'roster exercises trained.')).toBe(false);
    expect(hasText(root, '100%')).toBe(true);
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
    expect(hasText(root, 'Baseline 24 reps')).toBe(true);
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

    pickWeek(root, 1);

    // The switch remounts the list collapsed (#1300): expansion cannot leak.
    expect(hasText(root, '148%')).toBe(false);
    expect(hostRows(root).every(r => hostById(r, 'recovery-exercise-detail').length === 0)).toBe(true);
    expandRows(root);
    expect(hasText(root, '100%')).toBe(true);
  });
});

describe('AnalyticsRecoverySection — unavailable and error states', () => {
  test('a missing linked note is a visible unavailable row, not a hidden one', () => {
    const b = block();
    const w = week(1, 'ghost-note-id');
    const component = setup({ blocks: [b], weeks: [w], notes: [] });
    const root = component.root;

    expect(hasText(root, "Week 1: This week's note is no longer available.")).toBe(true);
  });

  test('a parser-rejected note surfaces the rejection, not zero work, using the R3a-worded notice', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1));
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, "Week 1: This week's note couldn't be read.")).toBe(true);
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
    // #1219/#1305: the strength summary is the first in-card content; the
    // routine is quiet 13sp context, never a title-like caption above it.
    const texts = findAllText(root);
    expect(texts.indexOf('Recovery')).toBeLessThan(texts.indexOf('100%'));
    expect(texts.indexOf('100%')).toBeLessThan(texts.indexOf('1 of 1 lift back · avg 100% · Week 1'));
    const ctxText = texts.find(t => t === '05-01-2026');
    expect(texts.indexOf('100%')).toBeLessThan(texts.indexOf(ctxText));
    const routine = hostText(root, ctxText)[0];
    expect(sizeOf(routine).fontSize).toBeGreaterThanOrEqual(13);
    expect(sizeOf(routine).fontSize).toBeLessThan(sizeOf(title).fontSize);
  });

  test('the top summary uses only sibling sizes: 18sp header, 32sp hero (Weight Trends KUA), 13sp captions', () => {
    const b = block({ reason: 'torn hamstring' });
    const root = setup({ blocks: [b], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    const hero = sizeOf(hostText(root, '100%')[0]);
    // Same KUA hero as Weight Trends `weightValueLarge`: metric-display-mobile role, 32/36 display exception (#1283).
    expect(hero).toMatchObject({ fontSize: 32, lineHeight: 36, fontFamily: 'JetBrainsMono-Bold' });
    // One short caption (#1315), no routine or coverage prose beside the number.
    expect(sizeOf(hostText(root, '1 of 1 lift back · avg 100% · Week 1')[0]).fontSize).toBe(13);
    expect(sizeOf(hostText(root, 'torn hamstring')[0]).fontSize).toBeGreaterThanOrEqual(13);
  });

  test('the reason and routine sit at the bottom: hero first, then Baseline context, then Reason', () => {
    const b = block({ reason: 'torn hamstring', started_at: '2026-05-01T00:00:00Z' });
    const root = setup({ blocks: [b], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    const texts = findAllText(root);
    const hero = texts.indexOf('100%');
    const ctx = texts.indexOf('05-01-2026');
    const reason = texts.indexOf('torn hamstring');
    expect(hero).toBeGreaterThan(-1);
    expect(ctx).toBeGreaterThan(hero);
    expect(reason).toBeGreaterThan(ctx);
    // The routine is named once visibly, in the quiet Baseline context row (#1315);
    // the summary's full wording is its accessibility label.
    expect(texts.filter(t => t.includes('Push Pull Legs'))).toEqual(['Push Pull Legs']);
    expect(texts.includes('Baseline')).toBe(true);
  });

});

describe('AnalyticsRecoverySection — identity caption and provenance (#793/R5b)', () => {
  test('an active block with a logged week shows a one-line "Week N · routine" identity caption', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(summaryLabel(root)).toContain('of Push Pull Legs baseline strength');
    expect(hasText(root, 'Week 1 · Push Pull Legs')).toBe(false);
    // The caption carries the week; the selectable week row is the only bare "Week 1".
    expect(hasText(root, '1 of 1 lift back · avg 100% · Week 1')).toBe(true);
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
    expect(byLabel(root, 'Expand lifts')).toBeUndefined();
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

  test('the card\'s last line is provenance only: "{start} to {end}" for a completed block', () => {
    const b = block({
      started_at: '2026-04-01T00:00:00Z',
      completed_at: '2026-04-29T00:00:00Z',
    });
    const component = setup({ blocks: [b], weeks: [], notes: [] });
    const root = component.root;

    expect(hasText(root, '04-01-2026 to')).toBe(true);
    expect(hasText(root, '04-29-2026')).toBe(true);
  });

  // Scoped to host nodes only, matching the `groupHeaders` dedup pattern —
  // the test renderer otherwise reports the composite and host node separately
  // for the same element.
  function liveRegions(root) {
    return root.findAll(
      // Each scoped info note has its own live region (#1219, #1358); this
      // helper is about the week-status region only.
      inst => typeof inst.type === 'string' && inst.props.accessibilityLiveRegion === 'polite' && !/^recovery-(percent|pace|scale)-note$/.test(inst.props.testID || '')
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

    expect(hostById(root, 'recovery-strength-summary')[0].props.accessibilityLabel).toMatch(/^Week 2: 100% total recovery of Push Pull Legs baseline strength\./);
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
    expect(hasText(root, "Week 2: This week's note is no longer available.")).toBe(true);

    pickWeek(root, 1);

    // Week 1 has a strength summary. Still exactly one live-region wrapper —
    // it was never unmounted and remounted across the branch switch.
    expect(liveRegions(root).length).toBe(1);
    expect(hasText(root, '100%')).toBe(true);
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
    const shown = Object.fromEntries(hostRows(root).map(r => [hostTextsIn(r)[0], statusWordOf(r)]));
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
    // No fabricated ratio on the row: no bar, no percent.
    expect(hostRows(root).flatMap(hostTextsIn).some(t => t.includes('%'))).toBe(false);
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
    expect(hasText(root, '20 reps')).toBe(true);
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
    expect(labels.find(l => l.startsWith('Pull-up, Not trained yet'))).toContain('Logged as "Pull-up (wide)" this week. Names differ, so no direct comparison was made.');
    expect(labels.find(l => l.startsWith('Pull-up (wide), Added during recovery'))).toContain('Baseline has "Pull-up". Names differ, so no direct comparison was made.');
    expect(labels.find(l => l.startsWith('Pull-up, Not trained yet'))).toContain('Names differ');
    expect(labels.find(l => l.startsWith('Pull-up (wide), Added during recovery'))).toContain('Names differ');
    expect(labels.find(l => l.startsWith('Foam Roll'))).not.toContain('Names differ');
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

    expect(weekRow(root, 1)).toBeDefined();
    expect(weekRow(root, 3)).toBeDefined();
    expect(weekRow(root, 2)).toBeUndefined();
    // Defaults to the latest live week, which is persisted week_number 3 — not
    // "week 2 of 2" from array position.
    expect(summaryLabel(root)).toContain('Week 3: ');
    expect(summaryLabel(root)).toContain('of Push Pull Legs baseline strength');
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
    expect(weekRow(root, 1)).toBeDefined();
    expect(weekRow(root, 3)).toBeDefined();
    expect(weekRow(root, 2)).toBeUndefined();
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
      inst => inst.props.accessibilityLabel === 'View note in Log: Push Pull Legs, Recovery Week 1, Week One Note'
    )[0];
    expect(row).toBeDefined();
    expect(typeof row.props.onPress).toBe('function');

    // Focusing the week is a SEPARATE target from the Log link: it never navigates
    // and the link is not nested inside it.
    const focus = root.findAll(n => n.props.testID === 'recovery-history-week-rb-c-1' && typeof n.props.onPress === 'function')[0];
    expect(focus.props.accessibilityLabel).toMatch(/^Show evidence for Push Pull Legs, Recovery Week 1, /);
    expect(focus.findAll(n => n === row)).toHaveLength(0);
    act(() => { focus.props.onPress(); });
    expect(onNavigate).not.toHaveBeenCalled();

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
    const row = root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Push Pull Legs, Recovery Week 2, Week Two Note')[0];
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

    const row = root.findAll(inst => inst.props.accessibilityLabel === 'Show evidence for Push Pull Legs, Recovery Week 1, Note unavailable')[0];
    expect(row).toBeDefined();
    // The week can still be focused, but there is no Log navigation for it.
    expect(typeof row.props.onPress).toBe('function');
    expect(hostById(root, 'recovery-history-week-log-rb-c-1')).toHaveLength(0);
    act(() => { row.props.onPress(); });
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
    const row = root.findAll(inst => inst.props.accessibilityLabel === 'Show evidence for Push Pull Legs, Recovery Week 1, Note unavailable')[0];
    expect(row).toBeDefined();
    expect(hostById(root, 'recovery-history-week-log-rb-c-1')).toHaveLength(0);
    expect(hasText(root, 'Huge Note')).toBe(true);
    expect(hasText(root, 'Note unavailable')).toBe(true);
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
    const row = root.findAll(inst => inst.props.accessibilityLabel === 'Show evidence for Push Pull Legs, Recovery Week 1, Note unavailable')[0];
    expect(row).toBeDefined();
    expect(hostById(root, 'recovery-history-week-log-rb-c-1')).toHaveLength(0);
    expect(hasText(root, 'Orphan Sets')).toBe(true);
    expect(hasText(root, 'Note unavailable')).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('an unavailable note on a completed week shows Unavailable, not the completion date', () => {
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(1, 'ghost-note', { block_id: 'rb-c', id: 'rw-c-1', completed_at: '2026-03-15T00:00:00Z' });
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [] }, jest.fn());
    const root = component.root;

    expect(hasText(root, 'Note unavailable')).toBe(true);
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

    expect(root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Push Pull Legs, Recovery Week 1, Note One').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Push Pull Legs, Recovery Week 5, Note Five').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Push Pull Legs, Recovery Week 2, Note One').length).toBe(0);
  });

  test('accessible identity includes block title, persisted week ordinal, and note title', () => {
    const b = completedBlock('rb-c', '2026-04-01T00:00:00Z', 'Push Pull Legs');
    const w = week(7, 'note-w7', { block_id: 'rb-c', id: 'rw-c-7', completed_at: '2026-03-29T00:00:00Z' });
    const n = note('note-w7', BASELINE_TEXT, 'Seventh Session');
    const component = setupWithNavigate({ blocks: [b], weeks: [w], notes: [n] }, jest.fn());
    const root = component.root;

    const row = root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Push Pull Legs, Recovery Week 7, Seventh Session')[0];
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
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Block One, Recovery Week 1, Block One Note').length).toBeGreaterThan(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Block Two, Recovery Week 1, Block Two Note').length).toBeGreaterThan(0);
    // Block One's note title must not appear under Block Two's label, and vice versa.
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Block One, Recovery Week 1, Block Two Note').length).toBe(0);
    expect(root.findAll(inst => inst.props.accessibilityLabel === 'View note in Log: Block Two, Recovery Week 1, Block One Note').length).toBe(0);
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

  test('strength bars render in the theme accent with an ink 100% mark for both light and dark palettes (#1305)', () => {
    const b = block({ baseline: captureRecoveryBaselineFromText(FOUR_LIFT_BASELINE_TEXT) });
    const w = week(1, 'note-w1');
    const n = note('note-w1', FOUR_LIFT_BASELINE_TEXT);
    const { StyleSheet } = require('react-native');
    const styleOf = (comp, id) => comp.root.findAll(inst => inst.props.testID === id && typeof inst.type === 'string')
      .map(inst => StyleSheet.flatten(inst.props.style).backgroundColor);

    const lightComponent = setupWithColors(LightColors, { blocks: [b], weeks: [w], notes: [n] });
    expandDetails(lightComponent.root, { rows: false });
    expect(lightComponent.root.findAllByProps({ testID: 'recovery-bands-rows' })).toHaveLength(0);
    expect(styleOf(lightComponent, 'recovery-strength-lift-a-bar-fill')).toEqual([LightColors.accent]);
    expect(styleOf(lightComponent, 'recovery-strength-lift-a-bar-reference')).toEqual([LightColors.text]);

    const darkComponent = setupWithColors(DarkColors, { blocks: [b], weeks: [w], notes: [n] });
    expandDetails(darkComponent.root, { rows: false });
    expect(styleOf(darkComponent, 'recovery-strength-lift-a-bar-fill')).toEqual([DarkColors.accent]);
    expect(styleOf(darkComponent, 'recovery-strength-lift-a-bar-reference')).toEqual([DarkColors.text]);
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
    expect(summaryLabel(component.root)).toContain('of Push Pull Legs baseline strength');
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

    expect(hasText(component.root, '100%')).toBe(true);
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
    expect(hasText(root, 'Lifts')).toBe(true);
    // The summary is the % and one caption; the routine wording is its label only.
    expect(summaryLabel(root)).toContain('of Push Pull Legs baseline strength');
    expect(hasText(root, 'of Push Pull Legs baseline strength')).toBe(false);
    expect(hasText(root, 'of 2 at or above baseline')).toBe(false);
    // #1315: the roster stat row lives inside the collapsed Lifts disclosure.
    expect(hasText(root, '3 exercises')).toBe(false);
    expect(hasText(root, 'trained')).toBe(false);

    // The diagnostic panel this issue is about is not on screen yet — no
    // per-row Load metric cell (the "Most common gap: Total work" summary
    // line is a legitimate first-screenful fact and may itself say "Total
    // work", so that word alone is not asserted absent).
    expect(rowLabels(root).some(l => l.startsWith('Bench,'))).toBe(false);
    expect(hasText(root, 'Load')).toBe(false);
    expect(hasText(root, 'Most common gap')).toBe(false);
    expect(byLabel(root, 'Expand lifts')).toBeDefined();
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

    const collapse = byLabel(root, 'Collapse lifts');
    expect(collapse.props.accessibilityState).toEqual({ expanded: true });
    act(() => { collapse.props.onPress(); });

    expect(rowLabels(root).some(l => l.startsWith('Bench,'))).toBe(false);
    expect(byLabel(root, 'Expand lifts').props.accessibilityState).toEqual({ expanded: false });
  });

  test('the summary is week-aware, names only the states that occurred, and never invents a score', () => {
    const root = setupMixed();

    // The old merged clause line ("Week 1 · 1 rebuilding · 1 added during
    // recovery") is folded into Exercise details, not shown on the first
    // screenful (#1029 §10c) — it is reachable there instead.
    expect(hasText(root, 'Week 1 · 1 rebuilding · 1 added during recovery')).toBe(false);
    // #1305 (owner direction): the first screenful leads with strength relative
    // to the frozen best set; the band bar and per-row diagnostics are gone from it.
    expect(hasText(root, '100%')).toBe(true);
    expect(hostById(root, 'recovery-bands-rows')).toHaveLength(0);
    expect(rowLabels(root)).toHaveLength(0);

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
    const summaryLabel = () => hostById(root, 'recovery-strength-summary')[0].props.accessibilityLabel;
    expect(summaryLabel()).toMatch(/^Week 2: /);
    expandDetails(root, { rows: false });
    expect(rosterLabel(root)).toContain('Rebuilding 1');

    pickWeek(root, 1);

    expect(summaryLabel()).toMatch(/^Week 1: /);
    // Lifts reset to collapsed for the newly selected week (#1315).
    expect(rosterNode(root)).toBeUndefined();
    expandDetails(root, { rows: false });
    expect(rosterLabel(root)).toContain('Rebuilding 0');
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
    expect(byLabel(root, 'Expand lifts')).toBeDefined();
    expect(byLabel(root, 'Collapse lifts')).toBeUndefined();
    expect(summaryLabel(root)).toContain('of Old Routine baseline strength');

    expandDetails(root);
    expect(rowLabels(root).some(l => l.startsWith('Bench, At or above'))).toBe(true);
  });

  test('a week whose note is unreadable states the R3a-worded notice above the disclosure, with no details to expand', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'ghost-note-id')],
      notes: [],
    }).root;

    expect(hasText(root, "Week 1: This week's note is no longer available.")).toBe(true);
    expect(byLabel(root, 'Expand exercise details')).toBeUndefined();
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
describe('AnalyticsRecoverySection — strength trend by recovery week (#1305)', () => {
  // Week 1: Bench 100x5 vs the frozen 135x5 best set. Week 2's note is
  // unreadable (over the parser's size limit) — a real gap. Week 3: Bench 120x5.
  function setupTrend() {
    const notes = [
      note('note-w1', '-Bench\n- 100 5,5,5\n-Pull-up\n- 6,6,5'),
      note('note-w2-bad', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1)),
      note('note-w3', '-Bench\n- 120 5,5,5'),
    ];
    return setup({ blocks: [block()], weeks: [week(1, 'note-w1'), week(2, 'note-w2-bad'), week(3, 'note-w3')], notes }).root;
  }
  const widthOf = (root, id) => {
    const { StyleSheet } = require('react-native');
    return StyleSheet.flatten(hostById(root, id)[0].props.style).width;
  };

  test('one row per live week through the selection, labelled by ordinal; an unreadable week is a No data gap, never a zero', () => {
    const root = setupTrend();
    const rows = root.findAll(n => typeof n.type === 'string' && /^recovery-strength-week-\d+$/.test(n.props.testID || ''));
    expect(rows.map(r => r.props.accessibilityLabel)).toEqual([
      'Week 1: 74% total recovery',
      'Week 2: no readable evidence',
      'Week 3: 88% total recovery',
    ]);
    expect(hostTextsIn(rows[1])).toContain('No data');
    expect(hostById(root, 'recovery-strength-week-2-bar')).toHaveLength(0);
    // The excluded week is disclosed beside the headline, not averaged as zero.
    expect(summaryLabel(root)).toContain('Week 2 couldn’t be read and is left out of the comparison.');
    expect(hasText(root, '88%')).toBe(true);
  });

  test('weeks with the same lifts trained but different strength draw visibly different bars', () => {
    const root = setupTrend();
    expect(widthOf(root, 'recovery-strength-week-1-bar-fill')).not.toEqual(widthOf(root, 'recovery-strength-week-3-bar-fill'));
  });

  test('selecting an earlier week excludes later evidence from the trend and headline', () => {
    const root = setupTrend();
    pickWeek(root, 1);
    // Headline from Week 1 only; later weeks stay selectable but show no score.
    expect(hostById(root, 'recovery-strength-weeks')).toHaveLength(1);
    expect(hostTextsIn(weekRow(root, 3))).toContain('Select to view');
    expect(hostById(root, 'recovery-strength-week-3-bar')).toHaveLength(0);
    expect(hostById(root, 'recovery-strength-summary')[0].props.accessibilityLabel).toMatch(/^Week 1: 74% /);
    expect(hasText(root, '88%')).toBe(false);
  });

  test('a legacy baseline says best-set data is unavailable and still lists what was not retested', () => {
    const snap = captureRecoveryBaselineFromText(BASELINE_TEXT);
    const legacy = { ...snap, exercises: snap.exercises.map(({ best_e1rm_weight, best_e1rm_reps, ...r }) => r) };
    const root = setup({ blocks: [block({ baseline: legacy })], weeks: [week(1, 'note-w1')], notes: [note('note-w1', '-Bench\n- 135 5')] }).root;
    expect(hasText(root, 'Baseline best-set data unavailable. Rebuild the baseline in Manage block (Log tab) to score strength.')).toBe(true);
    // Not retested is a counted, collapsed disclosure (#1315).
    expect(hasText(root, 'Pull-up: not logged in any week yet')).toBe(false);
    expect(hasText(root, '1 not retested')).toBe(true);
    act(() => { byLabel(root, 'Expand 1 not retested lifts').props.onPress(); });
    expect(hasText(root, 'Pull-up: not logged in any week yet')).toBe(true);
    // The single live week still gets its row, with an explicit unscored state.
    expect(hostTextsIn(weekRow(root, 1))).toContain('Not scored');
    expect(hostById(root, 'recovery-strength-scale')).toHaveLength(0);
  });

  test('a missing selected week keeps the earlier history, shows its own gap, and withholds only its average (PR #1308 review)', () => {
    const root = setup({
      blocks: [block()], weeks: [week(1, 'note-w1'), week(2, 'ghost')], notes: [note('note-w1', '-Bench\n- 100 5')],
    }).root;
    const rows = root.findAll(n => typeof n.type === 'string' && /^recovery-strength-week-\d+$/.test(n.props.testID || ''));
    expect(rows.map(r => r.props.accessibilityLabel)).toEqual(['Week 1: 74% total recovery', 'Week 2: no readable evidence']);
    // The visible gap notice stays; the headline still carries the earlier score (#1318).
    expect(hasText(root, 'Week 2: This week\'s note is no longer available.')).toBe(true);
    // The exclusion sentence moved to the summary label and the explainer (#1315).
    expect(summaryLabel(root)).toContain('Week 2 couldn’t be read and is left out of the comparison.');
    expect(hasText(root, 'Week 2 couldn’t be read')).toBe(false);
  });

  test('an unreadable selected week keeps the plotted average\'s coverage and cohort names visible (PR #1308 review)', () => {
    const root = setup({
      blocks: [block()], weeks: [week(1, 'note-w1'), week(2, 'ghost')], notes: [note('note-w1', '-Bench\n- 100 5')],
    }).root;
    const summary = hostById(root, 'recovery-strength-summary')[0];
    // #1318: the total carries the earlier readable score; the gap is stated, not scored.
    expect(hostTextsIn(summary)).toEqual(['74%', 'total recovery', '1 of 1 lift back · avg 74% · Week 2']);
    expect(summary.props.accessibilityLabel).toContain('This week’s note can’t be read, so this total adds no score for it.');
    expect(summary.props.accessibilityLabel).toContain('1 lift scored every week · 1 of 2 baseline lifts');
    expect(summary.props.accessibilityLabel).toContain('In the consistent cohort: Bench');
  });

  test('with no common lift, week rows still show the total (carried forward); a missing week is a gap', () => {
    const root = setup({
      blocks: [block()], weeks: [week(1, 'note-w1'), week(2, 'ghost'), week(3, 'note-w3')],
      notes: [note('note-w1', '-Bench\n- 100 5'), note('note-w3', '-Pull-up\n- 8,8')],
    }).root;
    const rows = root.findAll(n => typeof n.type === 'string' && /^recovery-strength-week-\d+$/.test(n.props.testID || ''));
    expect(rows.map(r => r.props.accessibilityLabel)).toEqual(['Week 1: 74% total recovery', 'Week 2: no readable evidence', 'Week 3: 74% total recovery']);
    expect(rows.map(r => hostTextsIn(r).pop())).toEqual(['74%', 'No data', '74%']);
  });

  test('cohort names are spoken in the summary label, never printed, not even in the total-recovery explainer (#1315, #1360)', () => {
    const root = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    expect(hasText(root, 'In the consistent cohort: Bench')).toBe(false);
    expect(summaryLabel(root)).toContain('In the consistent cohort: Bench');
    act(() => { byLabel(root, 'About total recovery').props.onPress(); });
    expect(hasText(root, 'In the consistent cohort: Bench.')).toBe(false);
  });

  test('ladder bars sit in a row line so the shared track grows horizontally, never in height (PR #1308 review)', () => {
    const { StyleSheet } = require('react-native');
    const root = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', '-Bench\n- 100 5')] }).root;
    expandDetails(root, { rows: false });
    const bar = hostById(root, 'recovery-strength-lift-bench-bar')[0];
    let host = bar.parent;
    while (host && !(typeof host.type === 'string' && host.props.style)) host = host.parent;
    expect(StyleSheet.flatten(host.props.style)).toMatchObject({ flexDirection: 'row' });
    expect(StyleSheet.flatten(bar.props.style)).toMatchObject({ height: 8 });
  });

  test('values above 100% stay factual on one labelled common scale', () => {
    const root = setup({
      blocks: [block()],
      weeks: [week(1, 'note-w1'), week(2, 'note-w2')],
      notes: [note('note-w1', '-Bench\n- 135 5'), note('note-w2', '-Bench\n- 160 5')],
    }).root;
    // Total recovery caps at 100%; the factual per-lift 118% stays in the ladder.
    expect(hasText(root, '100%')).toBe(true);
    expandDetails(root, { rows: false });
    expect(hasText(root, '118%')).toBe(true);
    // The scale legend is not printed; the week bars' explainer covers only them (#1315, #1358, #1360).
    expect(hostById(root, 'recovery-strength-scale')).toHaveLength(0);
    act(() => { byLabel(root, 'About the bar scale').props.onPress(); });
    expect(hasText(root, 'Week bars run 0–100%. 100% is your baseline: a full return to baseline strength.')).toBe(true);
    expect(hasText(root, 'Lift bars run 0–120%.')).toBe(false);
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

  test('the strength summary states the selected week first, above the trend and the ladder', () => {
    const root = twoWeeks();
    expandDetails(root, { rows: false });
    expect(hostById(root, 'recovery-strength-summary')[0].props.accessibilityLabel).toMatch(/^Week 2: 100% total recovery of Push Pull Legs baseline strength\./);
    const order = root.findAll(n => typeof n.type === 'string'
      && ['recovery-strength-summary', 'recovery-strength-weeks', 'recovery-exercise-list'].includes(n.props.testID))
      .map(n => n.props.testID);
    expect(order).toEqual(['recovery-strength-summary', 'recovery-strength-weeks', 'recovery-exercise-list']);
  });

  test('#1305: the band bar, movement row and band strip are gone from Analytics, so no warning-amber Steady remains', () => {
    const root = twoWeeks();
    for (const id of ['recovery-hero', 'recovery-bands-rows', 'recovery-movement', 'recovery-band-strip']) {
      expect(root.findAll(n => n.props.testID === id)).toHaveLength(0);
    }
    expect(hasText(root, 'Steady')).toBe(false);
    expect(findAllText(root)).not.toContain('↔');
    // The trend sits above the drill-down header.
    const order = root.findAll(n => typeof n.type === 'string' && (n.props.testID === 'recovery-strength-weeks' || n.props.accessibilityLabel === 'Expand lifts'));
    expect(order[0].props.testID).toBe('recovery-strength-weeks');
  });

  test('the week rows are the only week selector: pressable rows with role, selected state and a full name', () => {
    const root = twoWeeks();
    const row = weekRow(root, 1);
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toMatch(/^Week 1: /);
    expect(require('react-native').StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    // No second selector: no WeekPicker chips or caption.
    expect(root.findAll(n => /^recovery-week-(chip|picker)/.test(n.props.testID || ''))).toHaveLength(0);
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

  test('the selected week is named by the summary and the picker state, with no selection sentence', () => {
    const root = setupTwoWeeks();
    expect(hasText(root, 'linked weeks')).toBe(false);
    expect(hasText(root, 'pick a week')).toBe(false);
    expect(weekRow(root, 2).props.accessibilityState.selected).toBe(true);
    expect(weekRow(root, 1).props.accessibilityState.selected).toBe(false);
    pickWeek(root, 1);
    expect(weekRow(root, 1).props.accessibilityState.selected).toBe(true);
    expect(hostById(root, 'recovery-strength-summary')[0].props.accessibilityLabel).toMatch(/^Week 1:/);
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
    expect(hasText(root, 'Baseline 24 reps')).toBe(true);
    // Added-during-recovery work stays its own row.
    expect(rowLabels(root).some(l => l.startsWith('Curl, Added during recovery'))).toBe(true);

    pickWeek(root, 1);
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

describe('AnalyticsRecoverySection — routine-anchored summary label (#1219, #1305)', () => {
  const heroNode = (root) => root.findAll(n => n.props.testID === 'recovery-strength-summary' && typeof n.type === 'string')[0];
  const oneWeek = (title) => setup({
    blocks: [block({ baseline_note_title: title })],
    weeks: [week(1, 'note-w1')],
    notes: [note('note-w1', BASELINE_TEXT)],
  }).root;

  test('the summary label names the routine and the bottom line no longer repeats it', () => {
    const root = oneWeek('Push Pull Legs');
    expect(hasText(root, 'of Push Pull Legs baseline strength')).toBe(false);
    expect(heroNode(root).props.accessibilityLabel).toMatch(/^Week 1: 100% total recovery of Push Pull Legs baseline strength\. 1 of 1 lift back, avg 100%, Week 1\..*Consistent-cohort average \(secondary\): 100% across 1 lift scored every week · 1 of 2 baseline lifts\. In the consistent cohort: Bench\. Consistent-cohort average by week: Week 1 100%\.$/);
    expect(findAllText(root).some(t => t.startsWith('Baseline:'))).toBe(false);
    expect(hasText(root, '05-01-2026')).toBe(true);
  });

  test('a long routine name is one ellipsized Baseline line on screen while the labels keep the whole name', () => {
    const full = 'Upper Lower Push Pull Legs Hypertrophy Block';
    const root = oneWeek(full);
    const line = hostById(root, 'recovery-context-routine')[0];
    const value = line.findAll(n => typeof n.type === 'string' && n.type === 'Text' && n.props.numberOfLines === 1)[0];
    expect(value.props.accessibilityLabel).toBe(`Baseline: ${full}`);
    expect(heroNode(root).props.accessibilityLabel).toContain(`of ${full} baseline strength`);
    // No summary prose repeats the name (#1315).
    expect(findAllText(root).filter(t => t.includes(full))).toEqual([full]);
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

  });

  test('an untitled routine falls back to "Untitled Routine" visibly and accessibly', () => {
    for (const title of ['', '   ', null]) {
      const root = oneWeek(title);
      expect(heroNode(root).props.accessibilityLabel).toContain('Untitled Routine baseline strength');
    }
  });

  test('no scored lift: the summary says why with no number, and the routine is named once, in the bottom line', () => {
    for (const title of ['Push Pull Legs', 'Upper Lower Push Pull Legs Hypertrophy Block']) {
      const root = setup({
        blocks: [block({ baseline_note_title: title })],
        weeks: [week(1, 'note-w1')],
        notes: [note('note-w1', '-Sled Push\n- 100 5,5')],
      }).root;
      // #1318: nothing back is a real 0% total; the cohort reason moved to the explainer.
      // The headline and the single week row both read 0%.
      expect(findAllText(root).filter(t => /^\d+%$/.test(t))).toEqual(['0%', '0%']);
      expect(findAllText(root).some(t => /^0 of \d+ lifts? back · avg 0% · Week 1$/.test(t))).toBe(true);
      expect(findAllText(root).filter(t => t.includes(title))).toEqual([title]);
      expect(hasText(root, '2 not retested')).toBe(true);
      act(() => { byLabel(root, 'Expand 2 not retested lifts').props.onPress(); });
      expect(hasText(root, 'Bench: not logged in any week yet')).toBe(true);
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
  const rowTexts = (root) => hostRows(root).map(r => rawTextsIn(r));
  const hostById = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);

  test('each row is name + status word, and compared rows add one thin bar with its percent and concise numbers', () => {
    const rows = rowTexts(mount());
    expect(rows.map(r => r[0])).toEqual(['Bench', 'Pull-up', 'Curl', 'Foam Roll']);
    expect(rows.map(r => r[2])).toEqual(['Rebuilding', 'At or above', 'Not trained yet', 'Added during recovery']);
    const bench = rows[0];
    expect(bench).toContain('Total work 66%');
    expect(bench).toContain('Load 135 lb vs baseline 135 lb');
    expect(bench.some(t => t.startsWith('Total work '))).toBe(true);
    // Rows stay short: only tokens, never sentences.
    for (const r of rows) for (const t of r) expect(t.length).toBeLessThanOrEqual(40);
    expect(rows.every(r => r.length <= 6)).toBe(true);
  });

  test('#1300: default rows are one scannable line (name, status, this-week / baseline); detail and toggle state sit behind a tap', () => {
    const root = setup(props()).root;
    expandDetails(root, { rows: false });
    const rows = rowTexts(root);
    expect(rows[0]).toEqual(['Bench', '1350 lb / 2025 lb', 'Rebuilding']);
    expect(rows[1]).toEqual(['Pull-up', '24 reps / 24 reps', 'At or above']);
    // Not-trained and added rows show only their one baseline / current value.
    expect(rows[2]).toEqual(['Curl', 'Baseline 400 lb', 'Not trained yet']);
    expect(rows[3]).toEqual(['Foam Roll', '20 reps', 'Added during recovery']);
    expect(hostById(root, 'recovery-exercise-bar')).toHaveLength(0);
    // One line: name, value and status share the header view (no second row).
    for (const r of hostRows(root)) {
      const value = hostById(r, 'recovery-exercise-value')[0];
      const status = hostById(r, 'recovery-exercise-status')[0];
      // Name, value and status are siblings in ONE wrapping header view.
      const headers = r.findAll(x => typeof x.type === 'string' && StyleSheet.flatten(x.props.style)?.flexWrap === 'wrap'
        && x.findAll(y => y === value).length > 0 && x.findAll(y => y === status).length > 0);
      expect(headers.length).toBeGreaterThan(0);
      // The name is in that same header: the summary adds no second line.
      expect(headers[headers.length - 1].findAll(y => typeof y.type === 'string' && [].concat(y.props.children).join('') === hostTextsIn(r)[0]).length).toBe(1);
    }
    // Single-metric added / not-reintroduced rows have no toggle to repeat it.
    expect(hostRows(root)[2].props.accessibilityRole).toBe('button'); // Curl has load + work: a genuine second metric
    expect(hostRows(root)[3].props.accessibilityRole).toBeUndefined();
    // The baseline reference is explained once, not per row.
    expect(findAllText(root).filter(t => t.includes('pre-recovery baseline'))).toHaveLength(1);
    expect(hostRows(root).flatMap(hostTextsIn).some(t => t.includes('vs baseline'))).toBe(false);

    const bench = hostRows(root)[0];
    expect(bench.props.accessibilityRole).toBe('button');
    expect(bench.props.accessibilityState).toEqual({ expanded: false });
    const press = () => act(() => {
      root.findAll(n => typeof n.type !== 'string' && n.props.testID === 'recovery-exercise-row' && n.props.onPress)[0].props.onPress();
    });
    press();
    expect(hostRows(root)[0].props.accessibilityState).toEqual({ expanded: true });
    expect(hasText(root, 'Load 135 lb vs baseline 135 lb')).toBe(true);
    expect(hostById(root, 'recovery-exercise-bar')).toHaveLength(1);
    press();
    expect(hasText(root, 'Load 135 lb vs baseline 135 lb')).toBe(false);
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
    // Counts are quantitative (label-md 12); their word labels stay body-sm 13.
    expect(new Set(sizes)).toEqual(new Set([12, 13]));
    const rowSize = StyleSheet.flatten(hostRows(root)[0].findAll(n => typeof n.type === 'string' && n.props.testID === 'recovery-exercise-status')[0].props.style).fontSize;
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
    // #1315: the per-exercise summary and rows live in the (collapsed-by-default) Lifts disclosure.
    const toggle = byLabel(component.root, 'Expand lifts');
    if (toggle) act(() => { toggle.props.onPress(); });
    return component.root;
  };
  const hostById = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
  const segsOf = (node) => node.findAll(n => typeof n.type === 'string' && /^recovery-segment-/.test(n.props.testID || ''));
  const NOTE = 'Training numbers only. Not a medical judgment. Only you end a Recovery block.';
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

  test('the summary keeps trained / roster; can\'t-compare and added rows never change them', () => {
    const met = { ...KIND_ROWS.at_or_above(), key: 'c1', name: 'Bench' };
    const reb = { ...KIND_ROWS.rebuilding(), key: 'c2', name: 'Squat' };
    const bad = { ...KIND_ROWS.cannot_compare(), key: 'c3', name: 'Row' };
    const add = { ...KIND_ROWS.added(), key: 'c4' };
    const readings = [
      mountRows([met, reb], []),
      mountRows([met, reb, bad], []),
      mountRows([met, reb, bad], [add]),
    ].map(root => ({
      tokens: hostTextsIn(rosterNode(root)),
      label: rosterLabel(root),
    }));
    for (const r of readings) {
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
    }
  });

  test('a week with only a can\'t-compare row still shows the summary and no bar', () => {
    const root = mountRows([KIND_ROWS.cannot_compare()], []);
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    expect(hostTextsIn(rosterNode(root))).toEqual(['1', "can't compare"]);
  });

  test('the header keeps its >=44dp target and accessibilityState.expanded', () => {
    const root = mountWith();
    const header = byLabel(root, 'Collapse lifts');
    expect(StyleSheet.flatten(header.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(header.props.accessibilityState).toEqual({ expanded: true });
    act(() => { header.props.onPress(); });
    expect(byLabel(root, 'Expand lifts').props.accessibilityState).toEqual({ expanded: false });
  });

  test('the context block is a plain labelled list (Started / Reason) with no info button (#1358)', () => {
    const root = mountWith({ reason: 'torn hamstring' }, { onSaveReason: saveReason });
    expect(hasText(root, 'Not a medical judgment')).toBe(false);
    const block = hostById(root, 'recovery-footer-row')[0];
    expect(StyleSheet.flatten(block.props.style)).toMatchObject({ borderTopWidth: 1 });
    expect(findAllText(block)).toEqual(['Baseline', 'Push Pull Legs', 'Started', '05-01-2026', 'Reason', 'torn hamstring']);
    // Metadata carries no methodology explainer.
    expect(block.findAll(n => n.props.accessibilityRole === 'button' && n.props.testID !== 'recovery-manage-in-log')).toHaveLength(0);
    expect(byLabel(root, 'About these numbers')).toBeUndefined();
    // Evidence keeps the reason as quiet read-only context (#1307) ...
    const context = hostById(root, 'recovery-reason-context')[0];
    expect(context.props.accessibilityRole).toBeUndefined();
    expect(hostById(root, 'recovery-reason-row')).toHaveLength(0);
    // ... and there is no editable reason row in Analytics (Log owns it, #1315).
    expect(byLabel(root, 'Edit reason for this recovery block: torn hamstring')).toBeUndefined();
  });

  test('a long reason gets two ellipsized lines with the full text on its label', () => {
    const long = 'x'.repeat(200);
    const root = mountWith({ reason: long });
    const t = root.findAll(n => n.type === 'Text' && [].concat(n.props.children).join('') === long)[0];
    expect(t.props.numberOfLines).toBe(2);
    expect(hostById(root, 'recovery-reason-context')[0].props.accessibilityLabel).toBe(`Reason: ${long}`);
  });

  test('the total-recovery info button sits beside the percentage and reveals its note inline in a live region', () => {
    const root = mountWith();
    const info = byLabel(root, 'About total recovery');
    expect(info.props.accessibilityRole).toBe('button');
    expect(StyleSheet.flatten(info.props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
    // Beside the number, but outside the summary's single accessible node.
    const summaryRow = hostById(root, 'recovery-strength-summary-row')[0];
    expect(summaryRow.findAll(n => n.props.accessibilityLabel === 'About total recovery').length).toBeGreaterThan(0);
    expect(hostById(root, 'recovery-strength-summary')[0].findAll(n => n.props.accessibilityLabel === 'About total recovery')).toHaveLength(0);
    expect(hostById(root, 'recovery-percent-note')[0].props.accessibilityLiveRegion).toBe('polite');
    act(() => { byLabel(root, 'About total recovery').props.onPress(); });
    expect(hasText(root, NOTE)).toBe(true);
    expect(byLabel(root, 'About total recovery').props.accessibilityState).toEqual({ expanded: true });
    act(() => { byLabel(root, 'About total recovery').props.onPress(); });
    expect(hasText(root, NOTE)).toBe(false);
  });

  test('no-hero context: a long routine title ellipsizes with its full name on the label; a completed range is never truncated; reason stays reachable at fontScale 2', () => {
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
      expandEnded(root);
      const routine = hostById(root, 'recovery-context-routine')[0];
      const title = routine.findAll(n => n.type === 'Text' && n.props.accessibilityLabel === `Baseline: ${longTitle}`)[0];
      expect(title).toBeDefined();
      expect(title.props.numberOfLines).toBe(1);
      expect(StyleSheet.flatten(title.props.style)).toMatchObject({ flexShrink: 1 });
      // The completed range is a plain, untruncated value (wraps instead).
      const date = hostById(root, 'recovery-context-date')[0]
        .findAll(n => typeof n.type === 'string' && n.props.accessibilityLabel === 'Dates 05-01-2026 to 06-01-2026')[0];
      expect(date).toBeDefined();
      expect(date.findAll(n => n.type === 'Text' && n.props.numberOfLines !== undefined)).toHaveLength(0);
      expect(StyleSheet.flatten(date.props.style).flexWrap).toBe('wrap');
      const reason = hostById(root, 'recovery-reason-context')[0];
      expect(reason.props.accessibilityLabel).toBe(`Reason: ${longReason}`);
      // No score, so no percentage explainer; metadata never has one (#1358).
      expect(byLabel(root, 'About these numbers')).toBeUndefined();
      expect(byLabel(root, 'About total recovery')).toBeUndefined();
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
  const percentTextOf = (root, i = 0) => rawTextsIn(hostRows(root)[i]).find(t => /\d+%$/.test(t));
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
    // #1305: no band bar or segments remain on Analytics.
    expect(hostById(root, 'recovery-bands-rows')).toHaveLength(0);
    expect(segsIn(root)).toHaveLength(0);
    // The collapsed/expanded summary no longer repeats the bar.
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    expect(segsIn(hostById(root, 'recovery-roster-summary')[0])).toHaveLength(0);
  });

  test('the summary and rows use the same three names, the merged count and complete labels; Close is never named', () => {
    const root = mountAllStates(KUA_PALETTES.hardCourt.light, 'light');
    // trained = roster 6 minus not-trained 1 (summary values from deriveRecoveryWeekBands).
    expect(rosterLabel(root)).toContain("Trained this week: 5 of 6 roster exercises, 1 not trained yet. By status: At or above 1, Rebuilding 2, Early 1, Not trained yet 1, Can't compare 1, Added during recovery 1.");
    expect(rosterLabel(root)).toContain('Added during recovery 1');
    // Nothing anywhere says Close, visibly or spoken.
    expect(hasText(root, 'Close')).toBe(false);
    expect(root.findAll(n => typeof n.props.accessibilityLabel === 'string' && /\bClose\b/.test(n.props.accessibilityLabel))).toHaveLength(0);
    // Every row label starts with the same word it shows.
    const labels = rowLabels(root);
    ['At or above', 'Rebuilding', 'Early', "Can't compare", 'Not trained yet', 'Added during recovery']
      .forEach(w => expect(labels.some(l => l.includes(`, ${w}.`) || l.endsWith(`, ${w}`))).toBe(true));
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
  test('the summary label enumerates all six states with zeros; added is the selected week\'s count', () => {
    const states = (label) => label.match(/At or above \d+, Rebuilding \d+, Early \d+, Not trained yet \d+, Can't compare \d+, Added during recovery \d+/)[0];
    // A week with nothing but at-or-above work and no added row: every other state is a spoken zero.
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({ exercises: [met('A'), met('B')] })] }));
    const quiet = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    expandDetails(quiet);
    const zero = "At or above 2, Rebuilding 0, Early 0, Not trained yet 0, Can't compare 0, Added during recovery 0";
    expect(states(rosterLabel(quiet))).toBe(zero);
    // Every state non-zero, two added rows.
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [mockWeek({
      exercises: [met('A'), at('B', 95), at('C', 60), at('D', 20), untrained('E'), classChanged('F')],
      added: [addedRow('G'), addedRow('H')],
    })] }));
    const full = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] }).root;
    expandDetails(full);
    const all = "At or above 1, Rebuilding 2, Early 1, Not trained yet 1, Can't compare 1, Added during recovery 2";
    expect(states(rosterLabel(full))).toBe(all);
  });

  // --- no graded state => no segmented track on any surface --------------------
  // [label, exercises, added, hero bar rendered?, strip text]
  const NO_GRADED = [
    ["only can't-compare rows", [classChanged('F')], [], true, "1 can't compare"],
    ['only not-trained rows', [untrained('E')], [], false, '0 trained'],
    ['only added work', [], [addedRow('G')], false, '0 trained'],
  ];
  test.each(NO_GRADED)('%s: no band bar, band strip, segment or summary mini-bar is drawn (#1305)', (_l, exercises, added) => {
    const wk = (n) => mockWeek({ week_id: `rw${n}`, week_number: n, note_id: `note-${n}`, exercises, added });
    deriveRecoveryComparison.mockReturnValueOnce(mockComparison({ weeks: [wk(1), wk(2)] }));
    const root = setup({
      blocks: [block()], weeks: [week(1, 'note-1'), week(2, 'note-2')], notes: [note('note-1', BASELINE_TEXT), note('note-2', BASELINE_TEXT)],
    }).root;
    expandDetails(root);
    for (const id of ['recovery-bands-rows', 'recovery-band-strip', 'recovery-roster-bar']) expect(hostById(root, id)).toHaveLength(0);
    expect(segsIn(root)).toHaveLength(0);
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
    if (blockOver.completed_at) expandEnded(c.root);
    // The roster summary sits in the collapsed-by-default Lifts disclosure (#1315).
    const toggle = byLabel(c.root, 'Expand lifts');
    if (toggle) act(() => { toggle.props.onPress(); });
    return c.root;
  };
  const tokensOf = (root) => hostById(root, 'recovery-count-tokens')[0];
  const tokenViews = (root) => hostById(root, 'recovery-count-token');

  // --- 1. no duplicate bar ----------------------------------------------------
  test('the collapsed Exercise details row has no bar, and no band bar remains above it (#1305)', () => {
    const root = mountOwner();
    expect(hostById(root, 'recovery-roster-bar')).toHaveLength(0);
    const summary = hostById(root, 'recovery-roster-summary')[0];
    expect(summary.findAll(n => typeof n.type === 'string' && /^recovery-segment-/.test(n.props.testID || ''))).toHaveLength(0);
    // Nothing in the summary is a filled strip: no row-direction view with a hidden-overflow height of 6 or 10.
    expect(summary.findAll(n => typeof n.type === 'string' && flat(n).overflow === 'hidden' && [6, 10].includes(flat(n).height))).toHaveLength(0);
    expect(hostById(root, 'recovery-bands-rows')).toHaveLength(0);
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
      const toggle = byLabel(c.root, 'Expand lifts');
      if (toggle) act(() => { toggle.props.onPress(); });
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
  test('#1305: 3 lifts trained of a 27-lift roster never reads "3 of 3"; coverage uses the full roster', () => {
    const lifts = Array.from({ length: 27 }, (_, i) => `L${i}`);
    const baselineText = lifts.map(n => `-${n}\n- 100 5,5,5`).join('\n');
    const weekText = lifts.slice(0, 3).map(n => `-${n}\n- 100 5,5,5`).join('\n');
    const root = setup({
      blocks: [block({ baseline: captureRecoveryBaselineFromText(baselineText), baseline_note_title: 'Summer 2026 Routine' })],
      weeks: [week(1, 'note-w1')], notes: [note('note-w1', weekText)],
    }).root;
    const summary = hostById(root, 'recovery-strength-summary')[0];
    expect(hostTextsIn(summary)).toEqual(['11%', 'total recovery', '3 of 27 lifts back · avg 100% · Week 1']);
    expect(summary.props.accessibilityLabel).toContain('Consistent-cohort average (secondary): 100% across 3 lifts scored every week · 3 of 27 baseline lifts');
    expect(findAllText(root).some(t => t.includes('3 of 3'))).toBe(false);
    expect(findAllText(root).filter(t => t.includes('Summer 2026 Routine'))).toEqual(['Summer 2026 Routine']);
    expandDetails(root, { rows: false });
    expect(rosterLabel(root)).toContain('Trained this week: 3 of 27 roster exercises');
  });

  // --- 4. context block -----------------------------------------------------------
  test('owner context: Started + date on one row, Reason + value on the next, no info button and no far-edge floating control', () => {
    const root = mountOwner({}, { onSaveReason: async () => ({ ok: true }) });
    const ctx = hostById(root, 'recovery-footer-row')[0];
    expect(findAllText(ctx)).toEqual(['Baseline', 'Summer 2026 Routine', 'Started', '08-08-2026', 'Reason', 'Back injury']);
    const dateRow = hostById(root, 'recovery-context-date')[0];
    expect(flat(dateRow)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', minHeight: 44 });
    // #1358: the date is plain metadata — no info button in the row.
    expect(dateRow.findAll(n => n.props.accessibilityRole === 'button')).toHaveLength(0);
    expect(byLabel(root, 'About these numbers')).toBeUndefined();
    // No row in the block uses space-between / auto margins to float a control away from its text.
    const floaters = ctx.findAll(n => typeof n.type === 'string' && (flat(n).justifyContent === 'space-between' || flat(n).marginLeft === 'auto'));
    expect(floaters).toHaveLength(0);
  });

  // One announcement per context row: the visible label is hidden from assistive
  // tech and the adjacent value's own label carries it, so "Started" etc. is
  // never spoken twice.
  test.each([
    ['Started', () => mountOwner(), 'Started 08-08-2026'],
    ['Dates', () => mountOwner({ completed_at: '2026-09-20T12:00:00Z' }), 'Dates 08-08-2026 to 09-20-2026'],
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
    const row = hostById(c.root, 'recovery-reason-context')[0];
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toBe('Reason: torn hamstring');
  });

  test('completed block: "Dates" row with the range, Reason row, and and no Reopen control (Log owns it)', () => {
    const root = mountOwner({ completed_at: '2026-09-20T12:00:00Z' }, { onSaveReason: async () => ({ ok: true }) });
    const ctx = hostById(root, 'recovery-footer-row')[0];
    expect(findAllText(ctx)).toEqual(['Baseline', 'Summer 2026 Routine', 'Dates', '08-08-2026 to', '09-20-2026', 'Reason', 'Back injury']);
  });
});

// ── Match exercise names (#1298) ──────────────────────────────────────────────

describe('exercise disclosure row target (#1300 review)', () => {
  it('gives every exercise row a 44dp minimum height', () => {
    const { createVisualStyles } = require('../components/recovery/recoveryVisualStyles');
    const anyColor = new Proxy({}, { get: () => '#000000' });
    const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s) : s);
    expect(flat(createVisualStyles(anyColor).exRow).minHeight).toBeGreaterThanOrEqual(44);
    expect(flat(createVisualStyles(anyColor, anyColor).exRow).minHeight).toBeGreaterThanOrEqual(44);
  });
});

describe('AnalyticsRecoverySection — week rows without a scoreable denominator (PR #1319 review)', () => {
  test('a baseline with no scoreable lift says "No total" on readable rows, never "Select to view", and is not a 0%', () => {
    const only = '-Plank: 2x45s\n- 45,45';
    const root = setup({
      blocks: [block({ baseline: captureRecoveryBaselineFromText(only) })],
      weeks: [week(1, 'note-w1'), week(2, 'note-w2')],
      notes: [note('note-w1', only), note('note-w2', only)],
    }).root;
    const rows = root.findAll(n => typeof n.type === 'string' && /^recovery-strength-week-\d+$/.test(n.props.testID || ''));
    expect(rows.map(r => r.props.accessibilityLabel)).toEqual([
      'Week 1: no total, no baseline lift can be scored', 'Week 2: no total, no baseline lift can be scored',
    ]);
    expect(rows.map(r => hostTextsIn(r).pop())).toEqual(['No total', 'No total']);
    expect(hasText(root, 'Select to view')).toBe(false);
  });

  test('the week-bar explainer covers only the week bars, even when lift bars exceed 100%', () => {
    const root = setup({ blocks: [block()], weeks: [week(1, 'note-w1'), week(2, 'note-w2')], notes: [note('note-w1', '-Bench\n- 135 5'), note('note-w2', '-Bench\n- 160 5')] }).root;
    act(() => { byLabel(root, 'About the bar scale').props.onPress(); });
    const lines = hostTextsIn(hostById(root, 'recovery-scale-note')[0]);
    expect(lines).toEqual(['Week bars run 0–100%. 100% is your baseline: a full return to baseline strength.']);
    expect(lines.join(' ')).not.toMatch(/lift|120%/i);
  });
});

// ── #1425: completed mode collapsed, no maintenance navigation ────────────────

describe('AnalyticsRecoverySection — ended block starts collapsed (#1425)', () => {
  const done = () => block({ id: 'rb-done', baseline_note_title: 'Old Routine', completed_at: '2026-09-01T00:00:00Z' });
  const mount = (props) => {
    require('../lib/data/recoverySnapshot')._resetRecoverySnapshotStore();
    let c;
    act(() => {
      c = render.create(<AnalyticsRecoverySection blocks={[done()]} weeks={[week(1, 'note-w1', { block_id: 'rb-done' })]} notes={[note('note-w1', BASELINE_TEXT)]} {...props} />);
    });
    return c;
  };

  test('initial visit: header states ended status, canonical total, week count; no evidence or Manage/Open affordance', () => {
    const { root } = mount();
    const header = byLabel(root, /^Expand ended recovery block/);
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    expect(hasText(root, 'Ended · 100% total recovery · Week 1')).toBe(true);
    expect(hasText(root, '1 week · 05-01-2026 to 09-01-2026 · Old Routine')).toBe(true);
    expect(hostById(root, 'recovery-footer-row')).toHaveLength(0);
    expect(byLabel(root, /Manage|Open Recovery/i)).toBeUndefined();
    expandEnded(root);
    expect(hostById(root, 'recovery-footer-row').length).toBeGreaterThan(0);
    expect(byLabel(root, /Manage this recovery block|Open Recovery/i)).toBeUndefined();
    expect(hostById(root, 'recovery-manage-in-log')).toHaveLength(0);
  });

  test('a collapsed header with no logged week is truthful, never a 0%', () => {
    require('../lib/data/recoverySnapshot')._resetRecoverySnapshotStore();
    let c;
    act(() => { c = render.create(<AnalyticsRecoverySection blocks={[done()]} weeks={[]} notes={[]} />); });
    expect(hasText(c.root, '0%')).toBe(false);
    expect(hasText(c.root, '0 weeks')).toBe(true);
  });

  test('failed notes read with no notes says there is no total; stale stays qualified', () => {
    const failed = mount({ notes: [], notesError: new Error('x') }).root;
    expect(hasText(failed, 'Workout notes couldn’t be loaded, so there is no total to show.')).toBe(true);
    expect(hasText(failed, '%')).toBe(false);
    const stale = mount({ stateStale: true }).root;
    expect(hasText(stale, 'From last saved data')).toBe(true);
  });

  test('active -> completed without remount collapses; reopen and complete again collapses again', () => {
    require('../lib/data/recoverySnapshot')._resetRecoverySnapshotStore();
    const weeks = [week(1, 'note-w1', { block_id: 'rb-done' })];
    const notes = [note('note-w1', BASELINE_TEXT)];
    const mk = (b) => <AnalyticsRecoverySection blocks={[b]} weeks={weeks} notes={notes} />;
    let c;
    act(() => { c = render.create(mk({ ...done(), completed_at: null })); });
    expect(hostById(c.root, 'recovery-footer-row').length).toBeGreaterThan(0);
    expect(byLabel(c.root, /ended recovery block/)).toBeUndefined();
    act(() => { c.update(mk(done())); });
    expect(hostById(c.root, 'recovery-footer-row')).toHaveLength(0);
    expandEnded(c.root);
    act(() => { c.update(mk({ ...done(), completed_at: null })); });
    act(() => { c.update(mk({ ...done(), completed_at: '2026-09-09T00:00:00Z' })); });
    expect(byLabel(c.root, /^Expand ended recovery block/)).toBeDefined();
    expect(hostById(c.root, 'recovery-footer-row')).toHaveLength(0);
  });

  test('an unverified read between two verified ones does not restore an open disclosure', () => {
    require('../lib/data/recoverySnapshot')._resetRecoverySnapshotStore();
    const weeks = [week(1, 'note-w1', { block_id: 'rb-done' })];
    const notes = [note('note-w1', BASELINE_TEXT)];
    const mk = (ready) => <AnalyticsRecoverySection blocks={[done()]} weeks={weeks} notes={notes} stateReady={ready} stateLoading={!ready} />;
    let c;
    act(() => { c = render.create(mk(true)); });
    expandEnded(c.root);
    act(() => { c.update(mk(false)); });
    act(() => { c.update(mk(true)); });
    expect(byLabel(c.root, /^Expand ended recovery block/)).toBeDefined();
    expect(hostById(c.root, 'recovery-footer-row')).toHaveLength(0);
  });

  test('picking a history row opens that block only; the previous block returns collapsed', () => {
    require('../lib/data/recoverySnapshot')._resetRecoverySnapshotStore();
    const a = done();
    const b = block({ id: 'rb-b', baseline_note_title: 'Other Routine', completed_at: '2026-05-01T00:00:00Z' });
    let c;
    act(() => {
      c = render.create(<AnalyticsRecoverySection blocks={[a, b]} weeks={[week(1, 'note-w1', { block_id: 'rb-done' }), week(1, 'note-w2', { id: 'rw-b', block_id: 'rb-b' })]} notes={[note('note-w1', BASELINE_TEXT), note('note-w2', BASELINE_TEXT)]} />);
    });
    expect(hostById(c.root, 'recovery-footer-row')).toHaveLength(0);
    expandHistory(c.root);
    act(() => { byLabel(c.root, /^View recovery evidence for Other Routine/).props.onPress(); });
    expect(hostById(c.root, 'recovery-footer-row').length).toBeGreaterThan(0);
    act(() => { byLabel(c.root, /^View recovery evidence for Old Routine/).props.onPress(); });
    act(() => { byLabel(c.root, /^Collapse ended recovery block/).props.onPress(); });
    act(() => { byLabel(c.root, /^View recovery evidence for Other Routine/).props.onPress(); });
    act(() => { byLabel(c.root, /^Collapse ended recovery block/).props.onPress(); });
    act(() => { byLabel(c.root, /^View recovery evidence for Old Routine/).props.onPress(); });
    expect(hostById(c.root, 'recovery-footer-row').length).toBeGreaterThan(0);
  });
});
