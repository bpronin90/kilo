// Refactor contract for the #1052 split of AnalyticsRecoverySection.js into
// components/recovery/* (evidence, state grouping, week-index navigation, and
// styles). This suite is deliberately structural: it pins the PUBLIC boundary
// (only `AnalyticsRecoverySection` is exported from the section file), pins the
// named exports the section now composes from the recovery/* modules, proves
// the section actually renders those extracted components (mock-seam identity
// via findByType), and spot-checks that each preserved Recovery state still
// reaches the screen through the boundary. It is not a re-test of #697/#698
// meaning — the exhaustive behavior lives in analytics-recovery-section.test.js
// — only that the move changed no surface.

import React from 'react';
import render, { act } from 'react-test-renderer';
import * as SectionModule from '../components/AnalyticsRecoverySection';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { BlockEvidence } from '../components/recovery/RecoveryEvidence';
import { WeekIndexRow } from '../components/recovery/RecoveryWeekIndex';
import {
  MetricLegend,
  WeekEvidence,
  WeekUnavailableNotice,
} from '../components/recovery/RecoveryStateGroups';
import { createStyles } from '../components/recovery/analyticsRecoveryStyles';
import { RecoveryInclusionToggle } from '../components/RecoveryInclusionToggle';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import {
  RECOVERY_COMPARISON_STATUS,
  deriveRecoveryComparison,
} from '../lib/data/recoveryAnalytics';
import {
  RECOVERY_LOADING_MESSAGE,
  RECOVERY_STALE_MESSAGE,
  RECOVERY_UNVERIFIED_MESSAGE,
} from '../hooks/entries/recoveryBlockHooks';
import { LightColors } from '../theme/colors';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => ({
  __esModule: true,
  default: () => null,
}));

// Keep the real derivation by default (so real-note spot checks exercise #697),
// but leave the seam mockable for synthetic statuses the note grammar can't
// reach — the same seam analytics-recovery-section.test.js relies on.
jest.mock('../lib/data/recoveryAnalytics', () => {
  const actual = jest.requireActual('../lib/data/recoveryAnalytics');
  return { ...actual, deriveRecoveryComparison: jest.fn(actual.deriveRecoveryComparison) };
});

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

function completedBlock(overrides = {}) {
  return block({ completed_at: '2026-06-01T00:00:00Z', ...overrides });
}

function setup(props) {
  let component;
  act(() => {
    component = render.create(<AnalyticsRecoverySection {...props} />);
  });
  return component;
}

function allText(root) {
  return root.findAllByType('Text').map(t => {
    const c = t.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });
}
const hasText = (root, needle) => allText(root).some(s => s.includes(needle));
const byLabel = (root, label) => root.findAll(i => i.props.accessibilityLabel === label)[0];

beforeEach(() => {
  deriveRecoveryComparison.mockClear();
});

// ── Export / boundary parity ────────────────────────────────────────────────
describe('#1052 refactor — export and boundary parity', () => {
  test('the section file exposes exactly the public boundary and nothing else', () => {
    expect(typeof AnalyticsRecoverySection).toBe('function');
    // The section file re-exports no internal presentation piece; the ONLY
    // public name is the boundary component every consumer already imports.
    expect(Object.keys(SectionModule)).toEqual(['AnalyticsRecoverySection']);
  });

  test('each recovery/* module exports the named presentation piece the section composes', () => {
    expect(typeof BlockEvidence).toBe('function');
    expect(typeof WeekIndexRow).toBe('function');
    expect(typeof WeekEvidence).toBe('function');
    expect(typeof MetricLegend).toBe('function');
    expect(typeof WeekUnavailableNotice).toBe('function');
    expect(typeof createStyles).toBe('function');
  });

  test('the extracted stylesheet still carries the keys every state depends on', () => {
    const styles = createStyles(LightColors);
    for (const key of [
      'container', 'card', 'stateBanner', 'identityCaption', 'summaryLine',
      'bandStrip', 'bandRow', 'chip', 'detailsPanel', 'exerciseRow', 'metricCell',
      'historyPanel', 'weekIndexRow', 'nonMedicalText', 'provenanceText',
    ]) {
      expect(styles).toHaveProperty(key);
    }
  });
});

// ── The boundary actually renders the extracted components (wiring) ──────────
describe('#1052 refactor — the boundary renders the extracted components', () => {
  test('an active block renders the extracted BlockEvidence card', () => {
    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const evidence = component.root.findAllByType(BlockEvidence);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].props.block.id).toBe('rb1');
  });

  test('expanding details mounts the extracted WeekEvidence + MetricLegend', () => {
    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;
    act(() => { byLabel(root, 'Expand exercise details').props.onPress(); });
    expect(root.findAllByType(WeekEvidence)).toHaveLength(1);
    expect(root.findAllByType(MetricLegend)).toHaveLength(1);
  });

  test('completed history renders one extracted WeekIndexRow per live week, in ascending week order', () => {
    const b = completedBlock();
    // Supplied out of order to prove the section, not the fixture, sorts them.
    const w2 = week(2, 'note-w2');
    const w1 = week(1, 'note-w1');
    const component = setup({
      blocks: [b],
      weeks: [w2, w1],
      notes: [note('note-w1', BASELINE_TEXT), note('note-w2', BASELINE_TEXT)],
    });
    const root = component.root;
    act(() => { byLabel(root, 'Expand recovery history').props.onPress(); });
    const rows = root.findAllByType(WeekIndexRow);
    expect(rows.map(r => r.props.week.week_number)).toEqual([1, 2]);
  });
});

// ── Note-navigation identity is preserved ───────────────────────────────────
describe('#1052 refactor — note navigation identity', () => {
  test('a readable week-index row navigates to its own note id', () => {
    const onNavigate = jest.fn();
    const b = completedBlock();
    const component = setup({
      blocks: [b],
      weeks: [week(1, 'note-w1')],
      notes: [note('note-w1', BASELINE_TEXT)],
      onNavigate,
    });
    const root = component.root;
    act(() => { byLabel(root, 'Expand recovery history').props.onPress(); });
    const pressable = root.findAll(
      i => typeof i.props.accessibilityLabel === 'string'
        && i.props.accessibilityLabel.includes('Recovery Week 1')
        && typeof i.props.onPress === 'function'
    )[0];
    expect(pressable).toBeDefined();
    act(() => { pressable.props.onPress(); });
    expect(onNavigate).toHaveBeenCalledWith('Log', { kind: 'note', noteId: 'note-w1' });
  });
});

// ── State spot checks through the boundary ──────────────────────────────────
describe('#1052 refactor — preserved states reach the screen', () => {
  test('loading: an initial unverified read shows the loading message', () => {
    const component = setup({ blocks: [], weeks: [], notes: [], stateReady: false, stateLoading: true });
    expect(hasText(component.root, RECOVERY_LOADING_MESSAGE)).toBe(true);
  });

  test('unavailable: a failed read shows the unverified message and a retry action', () => {
    const onRetry = jest.fn();
    const component = setup({ blocks: [], weeks: [], notes: [], stateReady: false, stateError: 'boom', onRetry });
    const root = component.root;
    expect(hasText(root, RECOVERY_UNVERIFIED_MESSAGE)).toBe(true);
    const retry = byLabel(root, 'Retry recovery');
    expect(retry).toBeDefined();
    act(() => { retry.props.onPress(); });
    expect(onRetry).toHaveBeenCalled();
  });

  test('stale: a stale snapshot with no blocks still shows the stale banner', () => {
    const component = setup({ blocks: [], weeks: [], notes: [], stateStale: true });
    expect(hasText(component.root, RECOVERY_STALE_MESSAGE)).toBe(true);
  });

  test('empty: no active or completed block renders nothing', () => {
    const component = setup({ blocks: [], weeks: [], notes: [] });
    expect(component.toJSON()).toBeNull();
  });

  test('malformed/partial: a missing linked note surfaces the unavailable notice', () => {
    const component = setup({ blocks: [block()], weeks: [week(1, 'ghost-note')], notes: [] });
    expect(hasText(component.root, 'no longer available')).toBe(true);
  });

  test('baseline unavailable: the frozen-baseline error renders through the boundary', () => {
    deriveRecoveryComparison.mockReturnValueOnce({
      version: 1,
      status: RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE,
      baseline_version: 1,
      block_id: 'rb1',
      weeks: [],
    });
    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    expect(hasText(component.root, 'The frozen baseline for this recovery block is unavailable.')).toBe(true);
  });

  test('complete/active: an active block shows its identity caption and the non-medical line', () => {
    const component = setup({ blocks: [block()], weeks: [week(1, 'note-w1')], notes: [note('note-w1', BASELINE_TEXT)] });
    const root = component.root;
    expect(hasText(root, 'Push Pull Legs')).toBe(true);
    expect(hasText(root, 'Not a medical judgment')).toBe(true);
  });

  test('included/excluded: a completed block exposes its inclusion toggle in history', () => {
    const component = setup({ blocks: [completedBlock()], weeks: [], notes: [] });
    const root = component.root;
    act(() => { byLabel(root, 'Expand recovery history').props.onPress(); });
    expect(root.findAllByType(RecoveryInclusionToggle).length).toBeGreaterThan(0);
  });
});
