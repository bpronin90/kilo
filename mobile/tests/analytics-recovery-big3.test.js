// #1351: during active Recovery the Analytics primary summary shows the total,
// the week and the Big 3 without opening `Lifts`, read through Home's own
// derivation (`deriveHomeRecoveryBig3` over the shared snapshot) and Home's
// effective 1K selection — never an Analytics-local one.

import React from 'react';
import render, { act } from 'react-test-renderer';
import fs from 'fs';
import path from 'path';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { getRecoverySnapshot, _resetRecoverySnapshotStore } from '../lib/data/recoverySnapshot';
import { resolveOneKSelections } from '../lib/data';
import { deriveHomeRecoveryBig3 } from '../screens/home/homeDashboardData';
import { liftValue } from '../screens/home/HomeRecoverySummary';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const BASE = '-Squat\n- 200 5\n-DB Bench Press\n- 150 5\n-Deadlift\n- 300 5\n-Pull-up\n- 8,8,8';
const WEEK = '-Squat\n- 180 5\n-DB Bench Press\n- 150 5\n-Pull-up\n- 8,8,8';

const block = (overrides = {}) => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'PPL',
  baseline: captureRecoveryBaselineFromText(BASE),
  started_at: '2026-05-01T00:00:00Z', completed_at: null, deleted_at: null,
  saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
  ...overrides,
});
const weeks = [{ id: 'rw1', block_id: 'rb1', note_id: 'n1', week_number: 1, completed_at: null, deleted_at: null, saved_at: '2026-05-08T00:00:00Z', updated_at: '2026-05-08T00:00:00Z' }];
const notes = [{ id: 'n1', title: 'Week 1', raw_text: WEEK }];
const SEL = resolveOneKSelections(null);

function mount(props) {
  _resetRecoverySnapshotStore();
  let c;
  act(() => { c = render.create(<AnalyticsRecoverySection weeks={weeks} notes={notes} {...props} />); });
  return c.root;
}
const host = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
const textOf = (root, id) => root.findAll(n => n.type === 'Text' && n.props.testID === id)
  .map(n => [].concat(n.props.children).join(''));

describe('Analytics Recovery primary summary — Big 3 (#1351)', () => {
  test('active block: total, week and the canonical Big 3 values sit in the primary summary', () => {
    const root = mount({ blocks: [block()], oneKSelections: SEL });
    expect(textOf(root, 'recovery-strength-number')).toHaveLength(1);
    expect(textOf(root, 'recovery-strength-caption').join('')).toContain('Week 1');

    // Exactly what Home's derivation produces for the same snapshot + selection.
    const expected = deriveHomeRecoveryBig3(getRecoverySnapshot({ block: block(), weeks, notes }), SEL).big3;
    expect(expected.map(l => l.slot)).toEqual(['squat', 'bench', 'deadlift']);
    for (const lift of expected) {
      expect(textOf(root, `recovery-big3-lift-${lift.slot}-value`)).toEqual([liftValue(lift)]);
    }
    expect(textOf(root, 'recovery-big3-lift-squat-value')).toEqual(['90%']);
    expect(textOf(root, 'recovery-big3-lift-bench-value')).toEqual(['100%']);
    expect(textOf(root, 'recovery-big3-lift-deadlift-value')).toEqual(['Not retested']);

    // Inside the summary, not behind the collapsed Lifts disclosure.
    const summaryBlock = host(root, 'recovery-big3')[0];
    expect(summaryBlock).toBeDefined();
    expect(root.findAll(n => n.props.accessibilityLabel === 'Expand lifts').length).toBeGreaterThan(0);
  });

  test('the full Lifts disclosure and its per-exercise detail still exist', () => {
    const root = mount({ blocks: [block()], oneKSelections: SEL });
    const toggle = root.findAll(n => n.props.accessibilityLabel === 'Expand lifts')[0];
    act(() => { toggle.props.onPress(); });
    expect(host(root, 'recovery-exercise-details')).toHaveLength(1);
  });

  test('the Big 3 follow the effective 1K selection, like Home', () => {
    const sel = { ...SEL, squat: 'Pull-up' };
    const root = mount({ blocks: [block()], oneKSelections: sel });
    const [squat] = deriveHomeRecoveryBig3(getRecoverySnapshot({ block: block(), weeks, notes }), sel).big3;
    expect(textOf(root, 'recovery-big3-lift-squat-value')).toEqual([liftValue(squat)]);
  });

  test('a completed block, or no selection supplied, shows no Big 3', () => {
    expect(host(mount({ blocks: [block({ completed_at: '2026-06-01T00:00:00Z' })], oneKSelections: SEL }), 'recovery-big3')).toHaveLength(0);
    expect(host(mount({ blocks: [block()] }), 'recovery-big3')).toHaveLength(0);
  });

  test('no duplicate Recovery/Big 3 derivation: Analytics reuses Home\'s path', () => {
    const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const evidence = read('components/recovery/RecoveryEvidence.js');
    expect(evidence).toMatch(/import \{ deriveHomeRecoveryBig3 \} from '..\/..\/screens\/home\/homeDashboardData'/);
    expect(evidence).toMatch(/deriveHomeRecoveryBig3\(snapshot, oneKSelections\)/);
    expect(evidence).not.toMatch(/BIG3_SLOTS|normalizeExerciseKey|liftStatus/);
    expect(read('screens/AnalyticsScreen.js')).toMatch(/oneKSelections=\{oneKSelections\}/);
    expect(read('screens/AnalyticsScreen.js')).toMatch(/resolveOneKSelections\(currentNote\)/);
  });
});
