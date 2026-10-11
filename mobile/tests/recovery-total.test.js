// Total recovery (#1318): total(W) = (1/M) * sum_i min(100, latest_i(W)) over every
// strength-scoreable baseline lift, untested = 0, equal weights, no decay.

import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { deriveRecoveryTotal, totalCaption } from '../lib/data/recoveryTotal';
import { displayPercent, PACE_STATUS, STRENGTH_STATUS } from '../lib/data/recoveryStrength';
import { getRecoverySnapshot, SNAPSHOT_STATE } from '../lib/data/recoverySnapshot';

// --- pure fixtures over the strength model's per-week evidence ----------------
const lifts = (n) => Array.from({ length: n }, (_, i) => ({ key: `l${i}`, name: `Lift ${i}` }));
// weekSpecs: [{ n, scores: {key: pct} | null (unreadable) }]
const strengthOf = (n, weekSpecs) => ({
  status: STRENGTH_STATUS.OK,
  evidence: {
    lifts: lifts(n),
    weeks: weekSpecs.map(w => ({
      week_id: `w${w.n}`, week_number: w.n, readable: w.scores !== null,
      scores: new Map(Object.entries(w.scores || {})),
    })),
  },
});
const total = (n, specs, opts) => deriveRecoveryTotal(strengthOf(n, specs), opts);

describe('formula', () => {
  test('owner-shaped dry run: 23 lifts, 9 latest at 74%, 14 untested = 666/23, floored 28, never rounded to 29', () => {
    const scores = Object.fromEntries(lifts(9).map(l => [l.key, 74]));
    const t = total(23, [{ n: 1, scores }]);
    expect(t.percent).toBe(666 / 23);
    expect(t.percent).toBeCloseTo(28.9565, 4);
    expect(displayPercent(t.percent)).toBe(28);
    expect([t.back, t.scoreable, t.avgOfBack]).toEqual([9, 23, 74]);
    expect(totalCaption(t)).toBe('9 of 23 lifts back · avg 74% · Week 1');
    expect(t.percent).toBeCloseTo((t.back / t.scoreable) * t.avgOfBack, 10);
  });

  test('a first score for a not-yet-back lift cannot lower the total', () => {
    const before = total(4, [{ n: 1, scores: { l0: 80, l1: 60 } }, { n: 2, scores: { l0: 80, l1: 60 } }]);
    const after = total(4, [{ n: 1, scores: { l0: 80, l1: 60 } }, { n: 2, scores: { l0: 80, l1: 60, l2: 5 } }]);
    expect(after.percent).toBeGreaterThan(before.percent);
  });

  test('100% only when every scoreable lift is at or above 100', () => {
    expect(total(3, [{ n: 1, scores: { l0: 100, l1: 130, l2: 100 } }]).percent).toBe(100);
    expect(total(3, [{ n: 1, scores: { l0: 100, l1: 400, l2: 99.9 } }]).percent).toBeLessThan(100);
    expect(total(3, [{ n: 1, scores: { l0: 100, l1: 400 } }]).percent).toBeLessThan(100);
  });

  test('one lift above 100 cannot exceed its capped share; factual display keeps the uncapped value', () => {
    const t = total(2, [{ n: 1, scores: { l0: 250, l1: 50 } }]);
    expect(t.percent).toBe(75);
    expect(t.perLiftLatest[0]).toMatchObject({ key: 'l0', percent: 250, week: 1 });
  });

  test('99.6 floors to 99', () => {
    expect(displayPercent(total(1, [{ n: 1, scores: { l0: 99.6 } }]).percent)).toBe(99);
  });

  test('a later lower score replaces an earlier higher one (latest, not best)', () => {
    const t = total(1, [{ n: 1, scores: { l0: 90 } }, { n: 2, scores: { l0: 60 } }]);
    expect(t.percent).toBe(60);
    expect(t.trend.map(p => p.percent)).toEqual([90, 60]);
  });

  test('selecting a past week excludes every later score, age and pace input', () => {
    const specs = [{ n: 1, scores: { l0: 50 } }, { n: 2, scores: { l0: 60 } }, { n: 3, scores: { l0: 100 } }];
    const past = total(1, specs.slice(0, 2));
    expect(past.percent).toBe(60);
    expect(past.trend).toHaveLength(2);
    expect(past.perLiftLatest[0].week).toBe(2);
  });

  test('N=0 with a readable week: 0 total and 0 caption average', () => {
    const t = total(3, [{ n: 1, scores: {} }]);
    expect([t.percent, t.back, t.avgOfBack]).toEqual([0, 0, 0]);
    expect(totalCaption(t)).toBe('0 of 3 lifts back · avg 0% · Week 1');
  });
});

describe('carry-forward, gaps and unknown', () => {
  test('scores carry across an absent week and an unreadable week; the gap row is null, not zero', () => {
    const t = total(2, [{ n: 1, scores: { l0: 80 } }, { n: 2, scores: null }, { n: 3, scores: {} }]);
    expect(t.trend.map(p => p.percent)).toEqual([40, null, 40]);
    expect(t.perLiftLatest[0]).toMatchObject({ percent: 80, week: 1, unknown: false });
  });

  test('only unreadable evidence: 0 contribution plus an unknown flag, never a confident never-back', () => {
    const t = total(2, [{ n: 1, scores: { l0: 80 } }, { n: 2, scores: null }]);
    expect(t.perLiftLatest[1]).toMatchObject({ percent: 0, week: null, unknown: true });
    expect(t.unknown).toEqual(['Lift 1']);
  });

  test('unreadable selected week keeps earlier evidence as-of, claims no new score', () => {
    const t = total(1, [{ n: 1, scores: { l0: 70 } }, { n: 2, scores: null }]);
    expect(t.percent).toBe(70);
    expect(t.selectedReadable).toBe(false);
    expect(t.week).toBe(2);
    expect(t.trend[1].percent).toBeNull();
    expect(t.pace.status).toBe(PACE_STATUS.NO_CURRENT);
  });

  test('all weeks unreadable: no headline total, gap rows remain', () => {
    const t = total(2, [{ n: 1, scores: null }, { n: 2, scores: null }]);
    expect(t.percent).toBeNull();
    expect(t.reason).toBe('no_readable_weeks');
    expect(t.trend.map(p => p.percent)).toEqual([null, null]);
  });

  test('no weeks / M=0 / non-ok strength never divide by zero or fabricate 0%', () => {
    expect(total(2, []).percent).toBeNull();
    expect(total(0, [{ n: 1, scores: {} }])).toMatchObject({ percent: null, reason: 'no_scoreable_lifts' });
    expect(deriveRecoveryTotal({ status: STRENGTH_STATUS.PAIR_UNAVAILABLE }).percent).toBeNull();
  });
});

describe('pace on the total trend (#1305 rules)', () => {
  const one = (...ps) => total(1, ps.map((p, i) => ({ n: i + 1, scores: { l0: p } })));
  test('70/75/80 is +5 pts/week: 90% in 2, 100% in 4', () => {
    const { pace } = one(70, 75, 80);
    expect(pace.status).toBe(PACE_STATUS.ESTIMATE);
    expect(pace.gain).toBe(5);
    expect(pace.targets.map(t => t.weeks)).toEqual([2, 4]);
  });
  test('two points are insufficient', () => {
    expect(one(70, 75).pace.status).toBe(PACE_STATUS.INSUFFICIENT);
  });
  test('signed regressions are kept: 70/80/75 averages +2.5', () => {
    expect(one(70, 80, 75).pace.gain).toBe(2.5);
  });
  test('flat or negative gain gives no forecast', () => {
    expect(one(80, 80, 80).pace.status).toBe(PACE_STATUS.NO_GAIN);
    expect(one(90, 80, 70).pace.status).toBe(PACE_STATUS.NO_GAIN);
  });
  test('both targets reached', () => {
    expect(one(100, 120, 130).pace.status).toBe(PACE_STATUS.REACHED);
  });
  test('ordinal gaps divide the gain', () => {
    const t = total(1, [{ n: 1, scores: { l0: 60 } }, { n: 3, scores: { l0: 70 } }, { n: 5, scores: { l0: 80 } }]);
    expect(t.pace.gain).toBe(5);
  });
  test('stale suppresses the forecast', () => {
    const t = total(1, [{ n: 1, scores: { l0: 70 } }, { n: 2, scores: { l0: 75 } }, { n: 3, scores: { l0: 80 } }], { stale: true });
    expect(t.pace.status).toBe(PACE_STATUS.SUPPRESSED);
  });
});

// --- end-to-end through the snapshot (real parsing, identities, exclusions) ------
const BASE = '-Bench\n- 100 5\n-Squat\n- 100 5\n-Deadlift\n- 100 5\n-Plank: 2x45s\n- 45,45\n-Pull-up\n- 8,8';
const mkBlock = (baseline = captureRecoveryBaselineFromText(BASE)) => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'PPL', baseline,
  started_at: '2026-05-01T00:00:00Z', completed_at: null, include_in_normal_analytics: false,
  saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', deleted_at: null,
});
const mkWeek = (n, note_id) => ({
  id: `rw${n}`, block_id: 'rb1', note_id, week_number: n, completed_at: null,
  saved_at: '2026-05-08T00:00:00Z', updated_at: '2026-05-08T00:00:00Z', deleted_at: null,
});
const note = (id, raw_text) => ({ id, title: id, raw_text });
const snap = (extra) => getRecoverySnapshot({ block: mkBlock(), ...extra });

describe('snapshot.total from real notes', () => {
  const notes = [
    note('nb', BASE), note('w1', '-Bench\n- 60 5\n-Squat\n- 80 5\n-Plank: 2x45s\n- 45,45'),
    note('w2', '-Bench\n- 70 5\n-Deadlift\n- 150 5'),
  ];
  const weeks = [mkWeek(1, 'w1'), mkWeek(2, 'w2')];

  test('timed and bodyweight baseline lifts are excluded from M; Squat carries from week 1', () => {
    const s = snap({ weeks, notes });
    expect(s.total.scoreable).toBe(3);
    expect(s.total.back).toBe(3);
    const by = Object.fromEntries(s.total.perLiftLatest.map(l => [l.key, l]));
    expect(by.squat).toMatchObject({ percent: 80, week: 1 });
    expect(by.bench).toMatchObject({ percent: 70, week: 2 });
    expect(by.deadlift).toMatchObject({ percent: 150, week: 2 });
    // (70 + 80 + min(100,150)) / 3
    expect(s.total.percent).toBeCloseTo(250 / 3, 10);
    expect(s.display.headline).toBe('83% total recovery');
    expect(s.display.caption).toBe('3 of 3 lifts back · avg 83% · Week 2');
  });

  test('a past-week selection excludes later scores', () => {
    const s = snap({ weeks, notes, selectedWeekId: 'rw1' });
    expect(s.total.percent).toBeCloseTo((60 + 80) / 3, 10);
    expect(s.total.back).toBe(2);
    expect(s.total.trend).toHaveLength(1);
  });

  test('an unreadable middle week is a gap; its row is null and evidence carries over', () => {
    const s = snap({
      weeks: [mkWeek(1, 'w1'), mkWeek(2, 'ghost'), mkWeek(3, 'w2')],
      notes,
    });
    expect(s.total.trend.map(p => p.percent === null ? null : displayPercent(p.percent))).toEqual([46, null, 83]);
    expect(s.total.perLiftLatest.find(l => l.key === 'squat').week).toBe(1);
  });

  test('legacy baseline (no pairs) has no total and keeps the pair-unavailable state', () => {
    const base = captureRecoveryBaselineFromText(BASE);
    const legacy = { ...base, exercises: base.exercises.map(({ best_e1rm_weight, best_e1rm_reps, ...r }) => r) };
    const s = getRecoverySnapshot({ block: mkBlock(legacy), weeks, notes });
    expect(s.total.percent).toBeNull();
    expect(s.display.state).toBe(SNAPSHOT_STATE.UNAVAILABLE);
    expect(s.legacy).toBe(true);
  });

  test('a baseline with no scoreable lift has M=0: no total, an honest message', () => {
    const only = '-Plank: 2x45s\n- 45,45';
    const s = getRecoverySnapshot({
      block: mkBlock(captureRecoveryBaselineFromText(only)), weeks: [mkWeek(1, 'w1')], notes: [note('nb', only), note('w1', only)],
    });
    expect(s.total.percent).toBeNull();
    expect(s.display.state).toBe(SNAPSHOT_STATE.EMPTY);
    expect(s.display.message).toMatch(/No baseline lift can be scored/);
  });

  test('added/substitute lifts never enter M', () => {
    const s = snap({ weeks: [mkWeek(1, 'w1')], notes: [note('nb', BASE), note('w1', '-Bench\n- 60 5\n-Hack Squat\n- 300 5')] });
    expect(s.total.scoreable).toBe(3);
    expect(s.total.perLiftLatest.some(l => l.key === 'hack squat')).toBe(false);
  });

  test('the strict cohort stays available as secondary detail, with its percent', () => {
    const s = snap({ weeks, notes });
    expect(s.strength.cohort.length).toBe(1);
    expect(s.display.detail.join(' ')).toMatch(/Consistent-cohort average \(secondary\): \d+% across 1 lift scored every week/);
  });

  test('stale suppresses the total pace', () => {
    expect(snap({ weeks, notes, stale: true }).total.pace.status).toBe(PACE_STATUS.SUPPRESSED);
  });
});

describe('caption plural and week rows without a denominator (PR #1319 review)', () => {
  test('caption pluralises on the denominator', () => {
    expect(totalCaption(total(1, [{ n: 1, scores: { l0: 100 } }]))).toBe('1 of 1 lift back · avg 100% · Week 1');
    expect(totalCaption(total(4, [{ n: 1, scores: { l0: 100, l1: 50 } }]))).toBe('2 of 4 lifts back · avg 75% · Week 1');
  });
});
