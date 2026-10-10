// Strength relative to the frozen baseline (#1305): per-lift score, consistent
// cohort, coverage, not-retested states, and best-case pace in recovery weeks.

import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import {
  LIFT_STATE, NOT_RETESTED, PACE_STATUS, STRENGTH_STATUS, deriveLiftPace, deriveRecoveryStrength, displayPercent,
} from '../lib/data/recoveryStrength';
import { MAX_RAW_TEXT_LENGTH } from '../lib/parser/workoutNote';
import { paceText } from '../components/recovery/RecoveryStrengthLadder';

// Bench/Squat/Row frozen at 100x5 (so a same-reps week reads as a plain weight
// ratio), plus an untimed reps-only Pull-up and a timed Plank.
const BASELINE = '-Bench\n- 100 5\n-Squat\n- 100 5\n-Row\n- 100 5\n-Pull-up\n- 8,8\n-Plank: 2x45s\n- 45,45';

function derive(weekTexts, { baseline = captureRecoveryBaselineFromText(BASELINE), select = null, stale = false, numbers = null } = {}) {
  const block = { id: 'b', baseline };
  const notes = weekTexts.map((t, i) => (t === null ? null : { id: `n${i}`, raw_text: t })).filter(Boolean);
  const weeks = weekTexts.map((_, i) => ({
    id: `w${i}`, block_id: 'b', note_id: `n${i}`, week_number: numbers ? numbers[i] : i + 1, deleted_at: null,
  }));
  return deriveRecoveryStrength({ block, weeks, notes, selectedWeekId: select, stale });
}
const lift = (r, key) => r.lifts.find(l => l.key === key);
const lifts = (pairs) => pairs.map(([name, w, reps = 5]) => `-${name}\n- ${w} ${reps}`).join('\n');

describe('per-lift score', () => {
  test('score is best weekly Epley over the frozen best-set Epley, across every session in the week (never summed)', () => {
    const r = derive(['-Bench\n- 70 5\n-Bench\n- 80 5,5']);
    expect(lift(r, 'bench')).toMatchObject({ state: LIFT_STATE.SCORED, best: { weight: 80, reps: 5 } });
    expect(lift(r, 'bench').percent).toBeCloseTo(80, 9);
  });

  test('a lighter load for more reps scores by Epley, not by top weight', () => {
    const r = derive(['-Bench\n- 90 10']);
    expect(lift(r, 'bench').percent).toBeCloseTo((100 * 90 * (1 + 10 / 30)) / (100 * (1 + 5 / 30)), 9);
  });

  test('kg logs compare in canonical pounds', () => {
    const r = derive(['-Bench\n- 45.359237kg 5']);
    expect(lift(r, 'bench').percent).toBeCloseTo(100, 6);
  });

  test('>100 stays factual; 99.6 never displays as 100', () => {
    expect(lift(derive(['-Bench\n- 120 5']), 'bench').percent).toBeCloseTo(120, 9);
    expect(displayPercent(99.6)).toBe(99);
    expect(displayPercent(100)).toBe(100);
    expect(displayPercent(118.9)).toBe(118);
  });

  // The parser emits no assistance values today; the assisted guard is covered
  // directly in recovery-strength-baseline.test.js (bestEpleySet).
  test('bodyweight reps and warmup-only work are never a score, and never zero', () => {
    const r = derive(['-Bench\n- 10,10\n+WARMUP\n-Row\n- 100 5']);
    expect(lift(r, 'bench')).toMatchObject({ state: LIFT_STATE.UNSCOREABLE, reason: 'class_changed', percent: null });
    expect(lift(r, 'row')).toMatchObject({ state: LIFT_STATE.NOT_LOGGED });
  });

  test('timed and reps-only baseline lifts are never scored, and say why', () => {
    const r = derive(['-Bench\n- 100 5']);
    expect(r.lifts.map(l => l.key)).toEqual(['bench', 'squat', 'row']);
    expect(r.not_scored).toEqual([
      { key: 'pull-up', name: 'Pull-up', reason: 'reps_only' },
      { key: 'plank', name: 'Plank', reason: 'time_based' },
    ]);
  });

  test('an unmatched name is not a score for the baseline lift and has no baseline percent', () => {
    const r = derive(['-DB Bench\n- 100 5']);
    expect(lift(r, 'bench').state).toBe(LIFT_STATE.NOT_LOGGED);
    expect(r.lifts.some(l => l.key === 'db bench')).toBe(false);
  });
});

describe('loaded-duration work (PR #1308 review)', () => {
  test('a duration-declared loaded carry is never frozen as reps nor scored, and says why', () => {
    const baseline = captureRecoveryBaselineFromText('-Bench\n- 100 5\n-Farmer Carry: 2x30s\n- 50 30,30');
    const carry = baseline.exercises.find(r => r.key === 'farmer carry');
    expect(carry.exercise_class).toBe('weighted');
    expect(carry.best_e1rm_weight).toBeUndefined();
    const r = derive(['-Bench\n- 100 5\n-Farmer Carry: 2x30s\n- 50 30,30'], { baseline });
    expect(r.cohort.map(c => c.key)).toEqual(['bench']);
    expect(r.lifts.some(l => l.key === 'farmer carry')).toBe(false);
    expect(r.not_scored).toEqual([{ key: 'farmer carry', name: 'Farmer Carry', reason: 'no_baseline_set' }]);
  });

  test('a week that logs a scored lift under a timed header is unscoreable, not a strength gain', () => {
    const baseline = captureRecoveryBaselineFromText('-Carry\n- 50 5');
    const r = derive(['-Carry: 2x30s\n- 50 30,30'], { baseline });
    expect(lift(r, 'carry')).toMatchObject({ state: LIFT_STATE.UNSCOREABLE, reason: 'loaded_duration', percent: null });
  });
});

describe('baseline states', () => {
  test('a v1 snapshot or a pair-less v2 says best-set data is unavailable, never scores against the source routine', () => {
    expect(derive(['-Bench\n- 100 5'], { baseline: { version: 1, exercises: [{ key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, volume: 500, sets_completed: 1 }] } }).status)
      .toBe(STRENGTH_STATUS.PAIR_UNAVAILABLE);
    const snap = captureRecoveryBaselineFromText(BASELINE);
    const legacy = { ...snap, exercises: snap.exercises.map(({ best_e1rm_weight, best_e1rm_reps, ...r }) => r) };
    expect(derive(['-Bench\n- 100 5'], { baseline: legacy }).status).toBe(STRENGTH_STATUS.PAIR_UNAVAILABLE);
  });

  test('unknown versions are unsupported; no weeks yields no score', () => {
    expect(derive(['-Bench\n- 100 5'], { baseline: { version: 3, exercises: [] } }).status).toBe(STRENGTH_STATUS.BASELINE_UNSUPPORTED);
    expect(derive([]).status).toBe(STRENGTH_STATUS.NO_WEEKS);
  });
});

describe('consistent cohort and coverage', () => {
  test('3 trained of a 27-lift roster: coverage counts the full roster', () => {
    const names = Array.from({ length: 27 }, (_, i) => `L${i}`);
    const baseline = captureRecoveryBaselineFromText(lifts(names.map(n => [n, 100])));
    const r = derive([lifts(names.slice(0, 3).map(n => [n, 100]))], { baseline });
    expect(r.cohort).toHaveLength(3);
    expect(r.roster_size).toBe(27);
    expect(r.headline).toBeCloseTo(100, 9);
  });

  test('only lifts scored in EVERY readable week enter the mean; others are on the ladder but out of the average', () => {
    const r = derive([
      lifts([['Bench', 60], ['Squat', 50]]),
      lifts([['Bench', 70], ['Squat', 55], ['Row', 90]]),
    ]);
    expect(r.cohort.map(c => c.key)).toEqual(['bench', 'squat']);
    expect(r.weeks.map(w => w.mean)).toEqual([55, 62.5]);
    expect(lift(r, 'row')).toMatchObject({ state: LIFT_STATE.SCORED, in_cohort: false });
  });

  test('when a lift leaves, every plotted week is recomputed with the one new cohort and the change is disclosed', () => {
    const r = derive([
      lifts([['Bench', 60], ['Squat', 50]]),
      lifts([['Bench', 70], ['Squat', 60]]),
      lifts([['Bench', 80]]),
    ]);
    expect(r.cohort.map(c => c.key)).toEqual(['bench']);
    expect(r.weeks.map(w => w.mean)).toEqual([60, 70, 80]);
    expect(r.cohort_dropped).toEqual(['Squat']);
  });

  test('an empty intersection shows a reason and no aggregate', () => {
    const r = derive([lifts([['Bench', 60]]), lifts([['Squat', 60]])]);
    expect(r.headline).toBeNull();
    expect(r.empty_reason).toBe('no_common_lifts');
    expect(r.weeks.every(w => w.mean === null)).toBe(true);
  });

  test('equal trained counts with different strength give different means', () => {
    const r = derive([lifts([['Bench', 60], ['Squat', 60]]), lifts([['Bench', 90], ['Squat', 90]])]);
    expect(r.weeks[0].mean).not.toEqual(r.weeks[1].mean);
  });

  test('a missing or unreadable week is an excluded gap, never a zero, and blocks a confident "never"', () => {
    const r = derive([lifts([['Bench', 60]]), null, 'x'.repeat(MAX_RAW_TEXT_LENGTH + 1), lifts([['Bench', 80]])]);
    expect(r.weeks.map(w => [w.week_number, w.readable, w.mean])).toEqual([[1, true, 60], [2, false, null], [3, false, null], [4, true, 80]]);
    expect(r.excluded_weeks).toEqual([2, 3]);
    expect(r.not_retested.find(n => n.key === 'squat').kind).toBe(NOT_RETESTED.UNKNOWN);
  });

  test('a selected past week excludes all later evidence', () => {
    const texts = [lifts([['Bench', 60]]), lifts([['Bench', 70], ['Squat', 50]]), lifts([['Bench', 80], ['Squat', 60]])];
    const past = derive(texts, { select: 'w0' });
    expect(past.weeks).toHaveLength(1);
    expect(past.headline).toBe(60);
    expect(lift(past, 'squat').state).toBe(LIFT_STATE.NOT_LOGGED);
    expect(past.not_retested.find(n => n.key === 'squat').kind).toBe(NOT_RETESTED.NEVER_LOGGED);
  });

  test('not retested: absent this week vs never logged; logged-but-unscoreable is not "never"', () => {
    const r = derive([lifts([['Bench', 60], ['Squat', 60]]) + '\n-Row\n- 10,10', lifts([['Bench', 70]]) + '\n-Row\n- 10,10']);
    const kinds = Object.fromEntries(r.not_retested.map(n => [n.key, n.kind]));
    expect(kinds).toEqual({
      squat: NOT_RETESTED.ABSENT_THIS_WEEK, 'pull-up': NOT_RETESTED.NEVER_LOGGED, plank: NOT_RETESTED.NEVER_LOGGED,
    });
    expect(lift(r, 'row')).toMatchObject({ state: LIFT_STATE.UNSCOREABLE, reason: 'class_changed' });
  });
});

describe('not retested covers the whole roster (PR #1308 review)', () => {
  test('a never-logged timed or reps-only baseline exercise is listed; a logged one is not', () => {
    const r = derive([lifts([['Bench', 100], ['Squat', 100], ['Row', 100]]) + '\n-Pull-up\n- 8,8']);
    expect(r.not_retested).toEqual([{ key: 'plank', name: 'Plank', kind: NOT_RETESTED.NEVER_LOGGED }]);
    const later = derive([lifts([['Bench', 100]]) + '\n-Plank: 2x45s\n- 45,45', lifts([['Bench', 100]])]);
    expect(later.not_retested.find(n => n.key === 'plank').kind).toBe(NOT_RETESTED.ABSENT_THIS_WEEK);
  });
});

describe('best-case pace', () => {
  const pts = (pairs) => pairs.map(([week_number, percent]) => ({ week_number, percent }));

  test('70/75/80 at Weeks 1/2/3 -> 2 weeks to 90, 4 to 100', () => {
    const pace = deriveLiftPace(pts([[1, 70], [2, 75], [3, 80]]), 3);
    expect(pace).toMatchObject({ status: PACE_STATUS.ESTIMATE, gain: 5, from_week: 1, to_week: 3 });
    expect(pace.targets).toEqual([{ target: 90, reached: false, weeks: 2 }, { target: 100, reached: false, weeks: 4 }]);
  });

  test('two points are not enough', () => {
    expect(deriveLiftPace(pts([[5, 40], [6, 45]]), 6).status).toBe(PACE_STATUS.INSUFFICIENT);
  });

  test('ordinal gaps divide by the week distance', () => {
    const pace = deriveLiftPace(pts([[1, 60], [3, 70], [4, 76]]), 4);
    expect(pace.gain).toBeCloseTo((5 + 6) / 2, 9);
    expect(pace.targets[0].weeks).toBe(Math.ceil(14 / 5.5));
  });

  test('regressions stay in the average; flat or negative gain gives no forecast', () => {
    expect(deriveLiftPace(pts([[1, 80], [2, 70], [3, 80]]), 3)).toMatchObject({ status: PACE_STATUS.NO_GAIN, gain: 0 });
    expect(deriveLiftPace(pts([[1, 80], [2, 75], [3, 70]]), 3).status).toBe(PACE_STATUS.NO_GAIN);
    const mixed = deriveLiftPace(pts([[1, 60], [2, 70], [3, 66], [4, 76]]), 4);
    expect(mixed.gain).toBeCloseTo(16 / 3, 9);
  });

  test('uses only the most recent four points', () => {
    const pace = deriveLiftPace(pts([[1, 10], [2, 60], [3, 65], [4, 70], [5, 75]]), 5);
    expect(pace).toMatchObject({ from_week: 2, gain: 5 });
  });

  test('a reached target says reached; all reached is reached', () => {
    const part = deriveLiftPace(pts([[1, 80], [2, 88], [3, 95]]), 3);
    expect(part.targets[0]).toEqual({ target: 90, reached: true, weeks: null });
    expect(part.targets[1].weeks).toBe(1); // ceil(5 / 7.5)
    expect(deriveLiftPace(pts([[1, 90], [2, 100], [3, 104]]), 3).status).toBe(PACE_STATUS.REACHED);
  });

  test('a reached target is named even when there is no forecast or too few weeks (PR #1308 review)', () => {
    expect(paceText(deriveLiftPace(pts([[1, 95], [2, 95], [3, 95]]), 3))).toBe('90% reached. No forecast: no gain over Weeks 1–3');
    expect(paceText(deriveLiftPace(pts([[1, 99], [2, 96], [3, 93]]), 3))).toMatch(/^90% reached\. No forecast/);
    expect(paceText(deriveLiftPace(pts([[1, 91], [2, 95]]), 2))).toBe('90% reached. Not enough weeks yet: log a third scored recovery week');
    expect(paceText(deriveLiftPace(pts([[1, 40], [2, 45]]), 2))).toBe('Not enough weeks yet: log a third scored recovery week');
    expect(paceText(deriveLiftPace(pts([[1, 70], [2, 75], [3, 80]]), 3))).toMatch(/^Best case, if your recent rate continues: 90% in 2 weeks · 100% in 4 weeks/);
  });

  test('no forecast past a selected week with no current score', () => {
    expect(deriveLiftPace(pts([[1, 60], [2, 70], [3, 80]]), 4).status).toBe(PACE_STATUS.NO_CURRENT);
  });

  test('through the derivation: later weeks cannot influence a historical selection, and stale suppresses pace', () => {
    const texts = [70, 75, 80, 40].map(w => lifts([['Bench', w]]));
    const hist = derive(texts, { select: 'w2' });
    expect(lift(hist, 'bench').pace.targets.map(t => t.weeks)).toEqual([2, 4]);
    expect(lift(derive(texts, { stale: true }), 'bench').pace.status).toBe(PACE_STATUS.SUPPRESSED);
    expect(derive(texts.slice(0, 2)).lifts[0].pace.status).toBe(PACE_STATUS.INSUFFICIENT);
  });
});
