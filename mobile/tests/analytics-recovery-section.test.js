// Analytics Recovery section (#698): renders the #697 return-to-baseline
// contract for active/completed recovery blocks. Verifies hero count,
// weighted Load/Volume rows, reps-only rows, added-during-recovery
// separation, week selection, >100% visibility, unavailable/error states,
// history collapse, and accessible labels.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { MAX_RAW_TEXT_LENGTH } from '../lib/parser/workoutNote';
import {
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_WEEK_STATUS,
  RECOVERY_COMPARISON_STATES,
  deriveRecoveryComparison,
} from '../lib/data/recoveryAnalytics';
import { DarkColors, LightColors } from '../theme/colors';
import { ThemeContext } from '../theme/ThemeContext';

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

describe('AnalyticsRecoverySection — visibility', () => {
  test('renders nothing when there is no active or completed recovery block', () => {
    const component = setup({ blocks: [], weeks: [], notes: [] });
    expect(component.toJSON()).toBeNull();
  });
});

describe('AnalyticsRecoverySection — active block evidence', () => {
  test('hero renders a factual "X of Y baseline exercises met" count, never a percentage', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, '2 of 2')).toBe(true);
    expect(hasText(root, 'baseline exercises met')).toBe(true);
  });

  test('weighted rows show independent Load and Volume; reps-only rows show only their applicable metric', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, 'Load')).toBe(true);
    expect(hasText(root, 'Volume')).toBe(true);
    expect(hasText(root, 'Reps')).toBe(true);
  });

  test('values above 100% baseline remain numerically visible even though the meter fill is capped', () => {
    const b = block();
    const w = week(1, 'note-w1');
    // Bench comes back well above baseline load and volume (200/135 = 148%).
    const n = note('note-w1', '-Bench\n- 200 5,5,5\n-Pull-up\n- 8,8,8');
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, '148%')).toBe(true);
  });

  test('a not-reintroduced baseline exercise shows its state without a fabricated percentage', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', '-Bench\n- 135 5,5,5');
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, 'Not reintroduced')).toBe(true);
    expect(hasText(root, 'Baseline:')).toBe(true);
  });

  test('an exercise added during recovery renders separately with no baseline ratio', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', `${BASELINE_TEXT}\n-Foam Roll\n- 10,10`);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, 'Added during recovery')).toBe(true);
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

    // Defaults to the latest (current) week, which is the >100% week.
    expect(hasText(root, '148%')).toBe(true);

    const week1Chip = root.findAll(
      inst => inst.props.accessibilityLabel === 'Week 1'
    )[0];
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

    expect(hasText(root, 'no longer available')).toBe(true);
  });

  test('a parser-rejected note surfaces the rejection, not zero work', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1));
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    expect(hasText(root, 'too large to parse')).toBe(true);
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

describe('AnalyticsRecoverySection — completed-block history', () => {
  function completedBlock(id, completedAt, title) {
    return block({
      id,
      baseline_note_title: title,
      completed_at: completedAt,
    });
  }

  test('history defaults expanded, is collapsible, and keeps a meaningful collapsed summary', () => {
    const completed = completedBlock('rb-old', '2026-04-01T00:00:00Z', 'Old Routine');
    const component = setup({ blocks: [completed], weeks: [], notes: [] });
    const root = component.root;

    expect(hasText(root, '1 completed block')).toBe(true);
    expect(hasText(root, 'Old Routine')).toBe(true);

    const collapseToggle = root.findAll(
      inst => inst.props.accessibilityLabel === 'Collapse recovery history'
    )[0];
    act(() => {
      collapseToggle.props.onPress();
    });

    expect(hasText(root, 'Latest:')).toBe(true);
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

    expect(hasText(root, 'Plank')).toBe(true);
    expect(hasText(root, 'Time')).toBe(true);
    expect(hasText(root, 'Load')).toBe(false);
    expect(hasText(root, 'Volume')).toBe(false);
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

    expect(hasText(root, 'Rebuilding')).toBe(true);
    expect(hasText(root, 'Baseline met')).toBe(false);
    expect(hasText(root, '49%')).toBe(true);
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

    expect(hasText(root, 'Not comparable')).toBe(true);
    expect(hasText(root, 'Logged as a different kind of exercise than the baseline.')).toBe(true);
  });

  test('an empty-but-supported baseline snapshot is reported without a hero or exercise rows', () => {
    deriveRecoveryComparison.mockReturnValueOnce(
      mockComparison({ status: RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY, weeks: [mockWeek({ exercises: [], added: [] })] })
    );

    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;

    expect(hasText(root, 'The frozen baseline recorded no comparable exercise.')).toBe(true);
    expect(hasText(root, 'baseline exercises met')).toBe(false);
  });
});

describe('AnalyticsRecoverySection — accessible labels expose the underlying evidence', () => {
  test('a Baseline met row announces its metric percentages and current/baseline values, not just the state', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    const benchRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.startsWith('Bench, Baseline met')
    )[0];
    expect(benchRow).toBeDefined();
    expect(benchRow.props.accessibilityLabel).toContain('Load 100%');
    expect(benchRow.props.accessibilityLabel).toContain('135 lb of 135 lb baseline');
    expect(benchRow.props.accessibilityLabel).toContain('Volume 100%');
  });

  test('a not-reintroduced row announces its baseline reference values', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', '-Bench\n- 135 5,5,5');
    const component = setup({ blocks: [b], weeks: [w], notes: [n] });
    const root = component.root;

    const pullUpRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.startsWith('Pull-up, Not reintroduced')
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

    const addedRow = root.findAll(
      inst => typeof inst.props.accessibilityLabel === 'string' && inst.props.accessibilityLabel.startsWith('Foam Roll, Added during recovery')
    )[0];
    expect(addedRow).toBeDefined();
    expect(addedRow.props.accessibilityLabel).toContain('Reps 20 reps');
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
    expect(hasText(root, 'Week 3')).toBe(true);
    expect(hasText(root, '2 weeks logged')).toBe(true);
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
    expect(hasText(root, '2 weeks logged')).toBe(true);
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

  test('the hero value renders in the accent token for both light and dark palettes', () => {
    const b = block();
    const w = week(1, 'note-w1');
    const n = note('note-w1', BASELINE_TEXT);

    const lightComponent = setupWithColors(LightColors, { blocks: [b], weeks: [w], notes: [n] });
    const lightHero = lightComponent.root.findAll(
      inst => Array.isArray(inst.props.style) && inst.props.style.some(s => s && s.color === LightColors.accent)
    );
    expect(lightHero.length).toBeGreaterThan(0);

    const darkComponent = setupWithColors(DarkColors, { blocks: [b], weeks: [w], notes: [n] });
    const darkHero = darkComponent.root.findAll(
      inst => Array.isArray(inst.props.style) && inst.props.style.some(s => s && s.color === DarkColors.accent)
    );
    expect(darkHero.length).toBeGreaterThan(0);
    expect(hasText(darkComponent.root, '2 of 2')).toBe(true);
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
    expect(rendered).toContain('Push Pull Legs');
    expect(retryButton(component)).toBeTruthy();
  });

  test('a stale snapshot with no blocks still offers the retry path', () => {
    const component = setupState({ stateStale: true, onRetry: jest.fn() });
    expect(texts(component)).toContain(RECOVERY_STALE_MESSAGE);
    expect(retryButton(component)).toBeTruthy();
  });

  test('a verified empty snapshot still renders nothing at all', () => {
    const component = setupState({ stateReady: true });
    expect(component.toJSON()).toBeNull();
  });
});
