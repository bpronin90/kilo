// #1353: one Recovery Big 3 mapping (lib/data/recoveryBig3) and one shared
// presenter (components/Big3Bars) behind Home's Recovery card and the Analytics
// Recovery summary. Covers every per-lift state without fabricated values, proves
// both surfaces print identical rows for the same snapshot + selection (also
// after a selection change on the same mount), and pins the single source.

import React from 'react';
import render, { act } from 'react-test-renderer';
import fs from 'fs';
import path from 'path';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { getRecoverySnapshot, _resetRecoverySnapshotStore } from '../lib/data/recoverySnapshot';
import {
  RECOVERY_BIG3_STATE, deriveRecoveryBig3, recoveryBig3Rows, recoveryBig3Value,
} from '../lib/data/recoveryBig3';
import * as homeData from '../screens/home/homeDashboardData';
import { HomeRecoverySummary } from '../screens/home/HomeRecoverySummary';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const BASE = '-Squat\n- 100 5\n-Bench\n- 100 5\n-Deadlift\n- 100 5\n-Plank: 2x45s\n- 45,45';
const SEL = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };
const block = () => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'R', baseline: captureRecoveryBaselineFromText(BASE),
  started_at: '2026-05-01T00:00:00Z', completed_at: null, deleted_at: null,
  saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
});
const wk = (n, note_id) => ({ id: `rw${n}`, block_id: 'rb1', note_id, week_number: n, completed_at: null, deleted_at: null });
function fixture(weekTexts) {
  const weeks = weekTexts.map((_, i) => wk(i + 1, `w${i + 1}`));
  const notes = [{ id: 'nb', raw_text: BASE }, ...weekTexts.map((t, i) => ({ id: `w${i + 1}`, title: `W${i + 1}`, raw_text: t }))];
  return { weeks, notes };
}
const snap = ({ weeks, notes }) => { _resetRecoverySnapshotStore(); return getRecoverySnapshot({ block: block(), weeks, notes }); };

describe('lib/data/recoveryBig3 (#1353)', () => {
  test('scored, not retested and not scored: a number only for a real score', () => {
    const s = snap(fixture(['-Squat\n- 65 5\n-Bench\n- 100 5']));
    const { big3 } = deriveRecoveryBig3(s, { ...SEL, deadlift: 'Plank' });
    expect(big3.map(l => [l.slot, l.state, l.percent])).toEqual([
      ['squat', RECOVERY_BIG3_STATE.SCORED, 65],
      ['bench', RECOVERY_BIG3_STATE.SCORED, 100],
      ['deadlift', RECOVERY_BIG3_STATE.NOT_SCORED, null],
    ]);
    expect(deriveRecoveryBig3(s, SEL).big3[2]).toMatchObject({ state: RECOVERY_BIG3_STATE.NOT_RETESTED, percent: null });
    expect(recoveryBig3Rows(big3).map(r => [r.value, r.fill, r.strong, r.done])).toEqual([
      ['65%', 65, true, false], ['100%', 100, true, true], ['Not scored', 0, false, false],
    ]);
  });

  test('a selected lift outside the baseline is Not in baseline, named by the selection', () => {
    const s = snap(fixture(['-Squat\n- 65 5']));
    const [squat] = deriveRecoveryBig3(s, { ...SEL, squat: 'Front Squat' }).big3;
    expect(squat).toMatchObject({ label: 'Front Squat', state: RECOVERY_BIG3_STATE.NOT_IN_BASELINE, percent: null });
    expect(recoveryBig3Value(squat)).toBe('Not in baseline');
  });

  test('an unreadable selected week yields Unknown, never a score', () => {
    _resetRecoverySnapshotStore();
    const s = getRecoverySnapshot({ block: block(), weeks: [wk(1, 'ghost')], notes: [] });
    const { big3 } = deriveRecoveryBig3(s, SEL);
    expect(big3.every(l => l.percent == null)).toBe(true);
    expect(big3.some(l => recoveryBig3Value(l) === 'Unknown')).toBe(true);
  });

  test('a score carried from an earlier week names that week', () => {
    const s = snap(fixture(['-Squat\n- 80 5', '-Bench\n- 90 5']));
    const squat = deriveRecoveryBig3(s, SEL).big3[0];
    expect(squat.lastTestedWeek).toBe(1);
    expect(recoveryBig3Rows([squat])[0].age).toBe('Week 1');
  });

  test('no selected week, or no strength model: no rows at all', () => {
    expect(deriveRecoveryBig3(null, SEL).big3).toEqual([]);
    _resetRecoverySnapshotStore();
    expect(deriveRecoveryBig3(getRecoverySnapshot({ block: block(), weeks: [], notes: [] }), SEL).big3).toEqual([]);
    expect(deriveRecoveryBig3({ selectedWeek: {}, strength: null }, SEL).big3).toEqual([]);
  });

  test('Home\'s historical names are aliases of the shared helper, not copies', () => {
    expect(homeData.deriveHomeRecoveryBig3).toBe(deriveRecoveryBig3);
    expect(homeData.HOME_BIG3_SCORED).toBe(RECOVERY_BIG3_STATE.SCORED);
    expect(homeData.HOME_BIG3_NOT_IN_BASELINE).toBe(RECOVERY_BIG3_STATE.NOT_IN_BASELINE);
  });
});

describe('Home and Analytics print identical Recovery Big 3 rows (#1353)', () => {
  const data = fixture(['-Squat\n- 80 5', '-Bench\n- 90 5']);
  const rowsOf = (root, prefix) => root.findAll(n => typeof n.type === 'string' && new RegExp(`^${prefix}-[a-z]+$`).test(n.props.testID || ''))
    .map(n => {
      const texts = n.findAll(t => t.type === 'Text').map(t => [].concat(t.props.children).join(''));
      return [n.props.testID.slice(prefix.length + 1), ...texts];
    });
  const homeEl = sel => (
    <HomeRecoverySummary
      onNavigate={jest.fn()}
      summary={{ status: 'ready', stale: false, message: null, active: true, retry: null, comparisonStatus: 'ok', weekNumber: 2, weekNoteStatus: 'ok', headline: null, big3: deriveRecoveryBig3(snap(data), sel).big3 }}
    />
  );
  const analyticsEl = sel => <AnalyticsRecoverySection blocks={[block()]} weeks={data.weeks} notes={data.notes} oneKSelections={sel} />;

  test('same snapshot + selection, including a selection change on the same mount', () => {
    let home; let analytics;
    _resetRecoverySnapshotStore();
    act(() => { home = render.create(homeEl(SEL)); analytics = render.create(analyticsEl(SEL)); });
    const first = rowsOf(home.root, 'home-recovery-lift');
    expect(first.map(r => r[0])).toEqual(['squat', 'bench', 'deadlift']);
    expect(first).toEqual(rowsOf(analytics.root, 'recovery-big3-lift'));
    expect(first[0]).toEqual(['squat', 'Squat', 'Week 1', '80%']);

    const next = { ...SEL, squat: 'Front Squat' };
    act(() => { home.update(homeEl(next)); analytics.update(analyticsEl(next)); });
    const second = rowsOf(home.root, 'home-recovery-lift');
    expect(second[0]).toEqual(['squat', 'Front Squat', 'Not in baseline']);
    expect(second).toEqual(rowsOf(analytics.root, 'recovery-big3-lift'));
    act(() => { home.unmount(); analytics.unmount(); });
  });
});

describe('single source (#1353)', () => {
  const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const filesIn = dir => fs.readdirSync(path.join(__dirname, '..', dir)).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`);

  test('no Big 3 slot/state logic or local value/row mapping in screens/home or components/recovery', () => {
    for (const f of [...filesIn('screens/home'), ...filesIn('components/recovery')]) {
      const src = read(f);
      expect([f, /BIG3_SLOTS|liftStatus|'Not in baseline'|'Not retested'|lastTestedWeek \?/.test(src)]).toEqual([f, false]);
    }
  });

  test('RecoveryEvidence reads the shared helper and presenter, nothing from screens/home', () => {
    const src = read('components/recovery/RecoveryEvidence.js');
    expect(src).not.toMatch(/screens\/home/);
    expect(src).toMatch(/from '..\/..\/lib\/data\/recoveryBig3'/);
    expect(src).toMatch(/from '..\/Big3Bars'/);
  });

  test('HomeBig3Bars is gone; every Big 3 Recovery surface renders the shared Big3Bars', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'screens/home/HomeBig3Bars.js'))).toBe(false);
    for (const f of ['screens/home/HomeRecoverySummary.js', 'components/recovery/RecoveryEvidence.js']) {
      expect(read(f)).toMatch(/<Big3Bars /);
    }
  });
});
