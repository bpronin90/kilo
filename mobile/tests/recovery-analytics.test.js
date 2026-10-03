// Return-to-baseline analytics for recovery blocks (#697).
//
// Fixtures are written the way a lifter actually logs a recovery week: a frozen
// baseline captured from the pre-layoff routine, then ordinary weekly notes with
// reduced load, reduced volume, mobility additions, substitutions, skips, and
// the occasional unparsable row.

import { parseWorkoutNote } from '../lib/parser';
import {
  RECOVERY_BASELINE_VERSION,
  captureRecoveryBaseline,
  captureRecoveryBaselineFromText,
} from '../lib/data/recoveryBlocks';
import {
  RECOVERY_ANALYTICS_VERSION,
  RECOVERY_COMPARISON_STATES,
  RECOVERY_COMPARISON_STATUS,
  RECOVERY_UNAVAILABLE_REASONS,
  RECOVERY_WEEK_STATUS,
  aggregateRecoveryWeekWork,
  compareWeekWorkToBaseline,
  deriveRecoveryComparison,
  deriveRecoveryWeekComparison,
} from '../lib/data/recoveryAnalytics';
import { MAX_RAW_TEXT_LENGTH } from '../lib/parser/workoutNote';
import { __resetWeightUnitForTests, setWeightUnitPreference } from '../lib/unitPreference';

// ── fixture helpers ───────────────────────────────────────────────────────────

// Synthetic sections for the exercise classes the text parser cannot yet
// express (durations), mirroring the helper style in recovery-blocks.test.js.
function synthSection(name, sessions, { kind = 'general', heading = null } = {}) {
  return {
    heading,
    subheading: null,
    kind,
    exercises: [{
      name,
      rows: [],
      sets: [],
      unparsed_rows: [],
      session_entries: sessions.map(sets =>
        sets === 'skip' ? { skipped: true, raw: '-', sets: [] } : { skipped: false, raw: 'x', sets }
      ),
    }],
  };
}
function durSet(duration_seconds) { return { weight_value: null, rep_count: null, duration_seconds, assistance_value: null }; }
function assistedSet(assistance_value, rep_count) {
  return { weight_value: null, rep_count, duration_seconds: null, assistance_value };
}

function work(text) {
  return aggregateRecoveryWeekWork(parseWorkoutNote(text).sections);
}

function blockWith(baseline, id = 'rb1') {
  return { id, baseline, completed_at: null, deleted_at: null };
}
function weekLink(week_number, note_id, extra = {}) {
  return {
    id: `rw${week_number}`,
    block_id: 'rb1',
    note_id,
    week_number,
    completed_at: null,
    deleted_at: null,
    ...extra,
  };
}
function noteWith(id, raw_text, title = null) {
  return { id, title: title ?? `Note ${id}`, raw_text };
}

function rowFor(weekResult, key) {
  return weekResult.exercises.find(e => e.key === key);
}
function metricOf(row, metric) {
  return row.metrics.find(m => m.metric === metric);
}

// A one-week comparison against a baseline captured from `baselineText`.
function compareOneWeek(baselineText, weekText) {
  const baseline = captureRecoveryBaselineFromText(baselineText);
  return deriveRecoveryWeekComparison({ baseline, rawText: weekText });
}

// ── work aggregation ──────────────────────────────────────────────────────────

describe('aggregateRecoveryWeekWork — inclusion and exclusion', () => {
  test('empty or absent sections aggregate to nothing', () => {
    expect(aggregateRecoveryWeekWork([]).size).toBe(0);
    expect(aggregateRecoveryWeekWork(null).size).toBe(0);
    expect(work('').size).toBe(0);
  });

  test('weighted work reports top load, volume, and completed set count', () => {
    const bench = work('-Bench\n- 135 5,5 155 3').get('bench');
    expect(bench.exercise_class).toBe('weighted');
    expect(bench.values.top_load).toBe(155);
    expect(bench.values.volume).toBe(135 * 5 + 135 * 5 + 155 * 3);
    expect(bench.sets_completed).toBe(3);
  });

  test('warmup sections never contribute work', () => {
    const w = work('+WARMUP EXERCISE\n-Bench\n- 45 10\n+LIFTING\n-Squat\n- 135 5');
    expect(w.has('bench')).toBe(false);
    expect(w.get('squat').values.volume).toBe(135 * 5);
  });

  test('a warmup-only exercise is absent entirely rather than counted light', () => {
    expect(work('+WARMUP EXERCISE\n-Bike\n- 45 10').has('bike')).toBe(false);
  });

  test('a skipped session entry contributes nothing', () => {
    // Second row is a whole-exercise skip for that session.
    const bench = work('-Bench\n- 135 5\n-').get('bench');
    expect(bench.values.volume).toBe(135 * 5);
    expect(bench.sets_completed).toBe(1);
  });

  test('an exercise whose only entry is a skip is absent', () => {
    expect(work('-Bench\n-').has('bench')).toBe(false);
  });

  test('within-row skipped sets contribute no reps or volume', () => {
    // "80 4,-" → one completed set of 4 and one skipped set, both at 80.
    const bench = work('-Bench\n- 80 4,-').get('bench');
    expect(bench.values.volume).toBe(80 * 4);
    expect(bench.sets_completed).toBe(1);
  });

  test('unparsed rows contribute nothing', () => {
    const w = work('-Bench\n- 135 5\n- garbage nonsense');
    expect(w.get('bench').values.volume).toBe(135 * 5);
  });

  test('an exercise with only unparsed rows is absent', () => {
    expect(work('-Bench\n- garbage nonsense\n- also bad').has('bench')).toBe(false);
  });

  test('reps-only work totals completed reps', () => {
    const pull = work('-Pull-ups\n- 10,10,8').get('pull-ups');
    expect(pull.exercise_class).toBe('reps_only');
    expect(pull.values.total_reps).toBe(28);
    expect(pull.sets_completed).toBe(3);
    expect(pull.values.top_load).toBeUndefined();
  });

  test('timed work totals held duration', () => {
    const plank = aggregateRecoveryWeekWork([
      synthSection('Plank', [[durSet(45), durSet(40)]]),
    ]).get('plank');
    expect(plank.exercise_class).toBe('time_based');
    expect(plank.values.total_seconds).toBe(85);
    expect(plank.sets_completed).toBe(2);
  });

  test('assisted-only work classifies as weighted but yields no weighted metric', () => {
    const chin = aggregateRecoveryWeekWork([
      synthSection('Chin-up', [[assistedSet(60, 8), assistedSet(60, 8)]]),
    ]).get('chin-up');
    expect(chin.exercise_class).toBe('weighted');
    expect(chin.values).toEqual({});
    expect(chin.sets_completed).toBe(0);
  });
});

describe('aggregateRecoveryWeekWork — deterministic aggregation', () => {
  test('the same lift on two days of an A/B week aggregates into one row', () => {
    const w = work([
      'Monday', '+LIFTING', '-Bench', '- 135 5,5',
      'Thursday', '+LIFTING', '-Bench', '- 115 8',
    ].join('\n'));
    expect(w.size).toBe(1);
    const bench = w.get('bench');
    expect(bench.values.top_load).toBe(135);
    expect(bench.values.volume).toBe(135 * 5 + 135 * 5 + 115 * 8);
    expect(bench.sets_completed).toBe(3);
  });

  test('repeated sessions of one exercise in a single note all count', () => {
    const bench = work('-Bench\n- 95 8\n- 105 8\n- 115 8').get('bench');
    expect(bench.values.top_load).toBe(115);
    expect(bench.values.volume).toBe(95 * 8 + 105 * 8 + 115 * 8);
    expect(bench.sets_completed).toBe(3);
  });

  test('name casing and spacing variants merge under one normalized identity', () => {
    const w = work([
      'Monday', '-Bench Press', '- 135 5',
      'Thursday', '-bench  press', '- 135 5',
    ].join('\n'));
    expect(w.size).toBe(1);
    expect([...w.values()][0].values.volume).toBe(135 * 5 * 2);
  });

  test('aggregation is repeatable for identical input', () => {
    const text = 'Monday\n-Bench\n- 135 5,5\nThursday\n-Bench\n- 115 8';
    expect([...work(text).entries()]).toEqual([...work(text).entries()]);
  });
});

// ── weighted comparison ───────────────────────────────────────────────────────

// Baseline: Bench tops out at 100 for 10 → top load 100, volume 1000.
const WEIGHTED_BASELINE = '-Bench\n- 100 10';

describe('weighted comparison — baseline met requires both dimensions', () => {
  test('load and volume both at baseline is Baseline met', () => {
    const row = rowFor(compareOneWeek(WEIGHTED_BASELINE, '-Bench\n- 100 10'), 'bench');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
    expect(row.unmet).toEqual([]);
    expect(metricOf(row, 'top_load')).toMatchObject({ current: 100, baseline: 100, ratio: 1, percent: 100, met: true });
    expect(metricOf(row, 'volume')).toMatchObject({ current: 1000, baseline: 1000, ratio: 1, percent: 100, met: true });
  });

  test('load met but volume short stays Rebuilding and names volume', () => {
    const row = rowFor(compareOneWeek(WEIGHTED_BASELINE, '-Bench\n- 100 9'), 'bench');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.REBUILDING);
    expect(row.unmet).toEqual(['volume']);
    expect(metricOf(row, 'top_load').met).toBe(true);
    expect(metricOf(row, 'volume')).toMatchObject({ current: 900, ratio: 0.9, percent: 90, met: false });
  });

  test('volume met but load short stays Rebuilding and names top load', () => {
    const row = rowFor(compareOneWeek(WEIGHTED_BASELINE, '-Bench\n- 90 12'), 'bench');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.REBUILDING);
    expect(row.unmet).toEqual(['top_load']);
    expect(metricOf(row, 'top_load')).toMatchObject({ current: 90, ratio: 0.9, met: false });
    expect(metricOf(row, 'volume').met).toBe(true);
  });

  test('both dimensions short reports both as unmet', () => {
    const row = rowFor(compareOneWeek(WEIGHTED_BASELINE, '-Bench\n- 65 8'), 'bench');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.REBUILDING);
    expect(row.unmet).toEqual(['top_load', 'volume']);
    expect(metricOf(row, 'volume').ratio).toBeCloseTo(0.52, 10);
  });

  test('ratios above baseline keep their factual value and are never capped', () => {
    const row = rowFor(compareOneWeek(WEIGHTED_BASELINE, '-Bench\n- 110 12'), 'bench');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
    expect(metricOf(row, 'top_load')).toMatchObject({ ratio: 1.1, percent: 110 });
    expect(metricOf(row, 'volume')).toMatchObject({ current: 1320, ratio: 1.32, percent: 132 });
  });

  test('a fractional shortfall floors to a percent that never reads as 100', () => {
    // 996 of 1000 lb of volume: 99.6% must display as 99%, not as a "100%"
    // beside a Rebuilding state.
    const row = rowFor(compareOneWeek('-Bench\n- 100 10', '-Bench\n- 100 9 96 1'), 'bench');
    const volume = metricOf(row, 'volume');
    expect(volume.current).toBe(996);
    expect(volume.ratio).toBeCloseTo(0.996, 10);
    expect(volume.percent).toBe(99);
    expect(volume.met).toBe(false);
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.REBUILDING);
  });

  test('float sums that repeat the baseline exactly still count as met', () => {
    const row = rowFor(compareOneWeek('-Bench\n- 132.5 8', '-Bench\n- 132.5 4,4'), 'bench');
    expect(metricOf(row, 'volume').met).toBe(true);
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
  });

  test('the whole week aggregates before comparing, so split sessions can meet baseline', () => {
    const row = rowFor(compareOneWeek(
      WEIGHTED_BASELINE,
      'Monday\n-Bench\n- 100 5\nThursday\n-Bench\n- 100 5'
    ), 'bench');
    expect(metricOf(row, 'volume').current).toBe(1000);
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
  });
});

describe('weighted comparison — missing and non-comparable work', () => {
  test('a baseline exercise absent from the week is Not reintroduced', () => {
    const result = compareOneWeek('-Bench\n- 100 10\n-Squat\n- 225 5', '-Bench\n- 100 10');
    const squat = rowFor(result, 'squat');
    expect(squat.state).toBe(RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED);
    expect(squat.sets_completed).toBe(0);
    expect(squat.week_name).toBeNull();
    expect(metricOf(squat, 'top_load')).toMatchObject({ current: 0, baseline: 225, ratio: 0, percent: 0, met: false });
    expect(squat.unmet).toEqual(['top_load', 'volume']);
  });

  test('an exercise present only as warmup or skips is Not reintroduced', () => {
    const result = compareOneWeek(WEIGHTED_BASELINE, '+WARMUP EXERCISE\n-Bench\n- 45 10');
    expect(rowFor(result, 'bench').state).toBe(RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED);
  });

  test('a weighted baseline logged as bodyweight this week is Not comparable', () => {
    const result = compareOneWeek('-Chin-up\n- 25 5', '-Chin-up\n- 8,8');
    const row = rowFor(result, 'chin-up');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
    expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.EXERCISE_CLASS_CHANGED);
    expect(row.exercise_class).toBe('weighted');
    expect(row.week_exercise_class).toBe('reps_only');
    expect(metricOf(row, 'top_load')).toMatchObject({ current: null, ratio: null, percent: null, met: false });
    expect(row.unmet).toEqual([]);
  });

  test('assisted-only work under a weighted baseline is Not comparable, not zero', () => {
    const baseline = captureRecoveryBaselineFromText('-Chin-up\n- 25 5');
    const weekWork = aggregateRecoveryWeekWork([
      synthSection('Chin-up', [[assistedSet(60, 8)]]),
    ]);
    const row = rowFor(compareWeekWorkToBaseline(baseline, weekWork), 'chin-up');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
    expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.NO_COMPARABLE_METRIC);
  });

  test('a non-positive frozen value is reported, never divided by', () => {
    const baseline = {
      version: RECOVERY_BASELINE_VERSION,
      exercises: [{ key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, volume: 0, sets_completed: 1 }],
    };
    const row = rowFor(deriveRecoveryWeekComparison({ baseline, rawText: '-Bench\n- 100 10' }), 'bench');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
    expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE);
    expect(row.metrics.every(m => m.ratio === null)).toBe(true);
  });
});

describe('baseline validity is a property of the snapshot alone', () => {
  // An unusable frozen row must report the same defect whether or not the lifter
  // happened to log that exercise. Reporting it as Not reintroduced when the week
  // is quiet would make baseline validity look like it depends on week activity.
  const unusable = (row) => ({ version: RECOVERY_BASELINE_VERSION, exercises: [row] });

  test('an unusable frozen value is reported even when the week logs nothing', () => {
    const baseline = unusable(
      { key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, volume: 0, sets_completed: 1 }
    );
    const row = rowFor(deriveRecoveryWeekComparison({ baseline, rawText: '' }), 'bench');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
    expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE);
    expect(row.sets_completed).toBe(0);
  });

  test('the same snapshot reports the same reason logged or not', () => {
    const baseline = unusable(
      { key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, sets_completed: 1 }
    );
    const quiet = rowFor(deriveRecoveryWeekComparison({ baseline, rawText: '' }), 'bench');
    const logged = rowFor(deriveRecoveryWeekComparison({ baseline, rawText: '-Bench\n- 100 10' }), 'bench');
    expect(quiet.state).toBe(logged.state);
    expect(quiet.unavailable_reason).toBe(logged.unavailable_reason);
    expect(logged.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE);
  });

  test('a non-finite frozen value is never divided by', () => {
    const baseline = unusable(
      { key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: Infinity, volume: 1000, sets_completed: 1 }
    );
    const row = rowFor(deriveRecoveryWeekComparison({ baseline, rawText: '-Bench\n- 100 10' }), 'bench');
    expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE);
    expect(row.metrics.every(m => m.ratio === null)).toBe(true);
  });

  test('an unrecognized frozen exercise family is reported, not silently empty', () => {
    const baseline = unusable({ key: 'bench', name: 'Bench', exercise_class: 'mystery', sets_completed: 1 });
    for (const rawText of ['', '-Bench\n- 100 10']) {
      const row = rowFor(deriveRecoveryWeekComparison({ baseline, rawText }), 'bench');
      expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
      expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.BASELINE_VALUE_UNUSABLE);
    }
  });
});

describe('non-finite work is never evidence', () => {
  // The parser's grammar rejects absurdly long digit strings outright, but it
  // does accept values near the float ceiling, and their SUM can overflow to
  // Infinity. An infinite volume must not read as a completed workout.
  const HUGE = `1${'0'.repeat(307)}`;

  test('an aggregate that overflows to Infinity is dropped, not reported as work', () => {
    const bench = work(`-Bench\n- ${HUGE} 5,5,5,5`).get('bench');
    expect(bench.exercise_class).toBe('weighted');
    expect(bench.values).toEqual({});
    expect(bench.sets_completed).toBe(0);
  });

  test('an overflowing week is Not comparable, never Baseline met', () => {
    const result = compareOneWeek(WEIGHTED_BASELINE, `-Bench\n- ${HUGE} 5,5,5,5`);
    const row = rowFor(result, 'bench');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
    expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.NO_COMPARABLE_METRIC);
    expect(row.metrics.every(m => m.ratio === null && m.met === false)).toBe(true);
  });

  test('an overflowing recovery-only exercise is dropped rather than listed empty', () => {
    const result = compareOneWeek(WEIGHTED_BASELINE, `-Sled Push\n- ${HUGE} 5,5,5,5`);
    expect(result.added).toEqual([]);
    expect(result.summary.added_during_recovery).toBe(0);
  });

  test('an added exercise with no usable dimension is dropped, unlike a baseline one', () => {
    // Assisted-only work yields no weighted metric. As an addition it is a
    // name with every field null, so it is dropped; as a baseline exercise the
    // missing comparison is itself the finding, so that row is kept.
    const baseline = captureRecoveryBaselineFromText('-Chin-up\n- 25 5');
    const weekWork = aggregateRecoveryWeekWork([
      synthSection('Chin-up', [[assistedSet(60, 8)]]),
      synthSection('Assisted Dip', [[assistedSet(60, 8)]]),
    ]);
    const result = compareWeekWorkToBaseline(baseline, weekWork);
    expect(result.added).toEqual([]);
    expect(rowFor(result, 'chin-up').state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
  });

  test('individual non-finite sets are excluded from completed work', () => {
    const w = aggregateRecoveryWeekWork([
      synthSection('Plank', [[durSet(Infinity), durSet(30)]]),
    ]).get('plank');
    expect(w.values.total_seconds).toBe(30);
    expect(w.sets_completed).toBe(1);
  });

  test('an exercise whose every set is non-finite is absent entirely', () => {
    const w = aggregateRecoveryWeekWork([
      synthSection('Plank', [[durSet(Infinity), durSet(NaN)]]),
    ]);
    expect(w.has('plank')).toBe(false);
  });

  test('a non-finite rep count cannot inflate reps-only work', () => {
    const w = aggregateRecoveryWeekWork([
      synthSection('Push-ups', [[{ weight_value: null, rep_count: Infinity, duration_seconds: null, assistance_value: null }]]),
    ]);
    expect(w.has('push-ups')).toBe(false);
  });
});

// ── reps-only and timed comparison ────────────────────────────────────────────

describe('reps-only comparison', () => {
  const baselineText = '-Push-ups\n- 20,20,15'; // 55 total reps

  test('uses total reps only and carries no load dimension', () => {
    const row = rowFor(compareOneWeek(baselineText, '-Push-ups\n- 10,10'), 'push-ups');
    expect(row.exercise_class).toBe('reps_only');
    expect(row.metrics.map(m => m.metric)).toEqual(['total_reps']);
    expect(metricOf(row, 'total_reps')).toMatchObject({ current: 20, baseline: 55, percent: 36, met: false });
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.REBUILDING);
    expect(row.unmet).toEqual(['total_reps']);
  });

  test('matching total reps is Baseline met even with a different set split', () => {
    const row = rowFor(compareOneWeek(baselineText, '-Push-ups\n- 11,11,11,11,11'), 'push-ups');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
    expect(metricOf(row, 'total_reps')).toMatchObject({ current: 55, ratio: 1, percent: 100 });
  });

  test('reps above baseline exceed 100% without a cap', () => {
    const row = rowFor(compareOneWeek(baselineText, '-Push-ups\n- 30,30,30'), 'push-ups');
    expect(metricOf(row, 'total_reps')).toMatchObject({ current: 90, percent: 163 });
    expect(metricOf(row, 'total_reps').ratio).toBeCloseTo(90 / 55, 10);
  });
});

describe('timed comparison', () => {
  const baseline = captureRecoveryBaseline([synthSection('Plank', [[durSet(60), durSet(60)]])]); // 120s

  test('uses total duration only', () => {
    const weekWork = aggregateRecoveryWeekWork([synthSection('Plank', [[durSet(30), durSet(30)]])]);
    const row = rowFor(compareWeekWorkToBaseline(baseline, weekWork), 'plank');
    expect(row.exercise_class).toBe('time_based');
    expect(row.metrics.map(m => m.metric)).toEqual(['total_seconds']);
    expect(metricOf(row, 'total_seconds')).toMatchObject({ current: 60, baseline: 120, ratio: 0.5, percent: 50, met: false });
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.REBUILDING);
  });

  test('reaching the frozen total is Baseline met', () => {
    const weekWork = aggregateRecoveryWeekWork([synthSection('Plank', [[durSet(75), durSet(45)]])]);
    const row = rowFor(compareWeekWorkToBaseline(baseline, weekWork), 'plank');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
  });

  test('a skipped timed session leaves the exercise Not reintroduced', () => {
    const weekWork = aggregateRecoveryWeekWork([synthSection('Plank', ['skip'])]);
    const row = rowFor(compareWeekWorkToBaseline(baseline, weekWork), 'plank');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED);
    expect(metricOf(row, 'total_seconds').current).toBe(0);
  });
});

// ── recovery-only work ────────────────────────────────────────────────────────

describe('recovery-only exercises', () => {
  test('mobility work added during recovery is listed separately with no ratio', () => {
    const result = compareOneWeek(WEIGHTED_BASELINE, '-Bench\n- 100 10\n-Band Pull-apart\n- 15,15');
    expect(result.exercises.map(e => e.key)).toEqual(['bench']);
    expect(result.added).toHaveLength(1);
    const added = result.added[0];
    expect(added.key).toBe('band pull-apart');
    expect(added.state).toBe(RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY);
    expect(added.exercise_class).toBe('reps_only');
    expect(added.metrics).toEqual([
      { metric: 'total_reps', current: 30, baseline: null, ratio: null, percent: null, met: null },
    ]);
    expect(added.baseline_sets_completed).toBeNull();
  });

  test('a substitution is never mapped onto the baseline lift', () => {
    // Leg press stands in for squat; the two stay independent facts.
    const result = compareOneWeek('-Squat\n- 225 5', '-Leg Press\n- 180 10');
    expect(rowFor(result, 'squat').state).toBe(RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED);
    expect(result.added.map(a => a.key)).toEqual(['leg press']);
    expect(result.added[0].metrics.every(m => m.ratio === null)).toBe(true);
  });

  test('added exercises keep the week note order, even when it is the reverse of normalized identity', () => {
    // Note order is Zercher, Mobility, Ankle; normalized identity order would be
    // ankle, mobility, zercher.
    const result = compareOneWeek(
      WEIGHTED_BASELINE,
      '-Zercher Hold\n- 10,10\n-Mobility Flow\n- 8,8\n-Ankle Circles\n- 12,12'
    );
    expect(result.added.map(a => a.key)).toEqual(['zercher hold', 'mobility flow', 'ankle circles']);
    // A repeated added exercise stays where it FIRST appeared.
    const repeated = compareOneWeek(
      WEIGHTED_BASELINE,
      '-Zercher Hold\n- 10,10\n-Ankle Circles\n- 12,12\n-Zercher Hold\n- 8,8'
    );
    expect(repeated.added.map(a => a.key)).toEqual(['zercher hold', 'ankle circles']);
  });

  test('summary counts every state without averaging them into a score', () => {
    const result = compareOneWeek(
      '-Bench\n- 100 10\n-Squat\n- 225 5\n-Row\n- 100 10',
      '-Bench\n- 100 10\n-Row\n- 60 5\n-Band Pull-apart\n- 15,15'
    );
    expect(result.summary).toEqual({
      baseline_met: 1,
      rebuilding: 1,
      not_reintroduced: 1,
      not_comparable: 0,
      added_during_recovery: 1,
    });
  });
});

// ── block-level derivation ────────────────────────────────────────────────────

describe('deriveRecoveryComparison — block and baseline states', () => {
  test('a missing block or snapshot is an explicit unavailable state', () => {
    expect(deriveRecoveryComparison({}).status).toBe(RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE);
    expect(deriveRecoveryComparison().status).toBe(RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE);
    expect(deriveRecoveryComparison({ block: { id: 'rb1' } }).weeks).toEqual([]);
  });

  test('a snapshot from another baseline format is explicitly unsupported', () => {
    const block = blockWith({ version: RECOVERY_BASELINE_VERSION + 1, exercises: [] });
    const result = deriveRecoveryComparison({ block, weeks: [weekLink(1, 'n1')], notes: [noteWith('n1', '-Bench\n- 100 5')] });
    expect(result.status).toBe(RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED);
    expect(result.weeks).toEqual([]);
    expect(result.baseline_version).toBe(RECOVERY_BASELINE_VERSION + 1);
  });

  test('a future format that dropped the exercises array is unsupported, not missing', () => {
    // The version is the discriminator: a present snapshot this module cannot
    // read must not be reported as though the block never had one.
    const block = blockWith({ version: RECOVERY_BASELINE_VERSION + 1, lifts: {} });
    expect(deriveRecoveryComparison({ block }).status).toBe(RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED);
  });

  test('a supported-version snapshot with unreadable contents is unavailable', () => {
    const block = blockWith({ version: RECOVERY_BASELINE_VERSION, exercises: 'corrupt' });
    expect(deriveRecoveryComparison({ block }).status).toBe(RECOVERY_COMPARISON_STATUS.BASELINE_UNAVAILABLE);
  });

  test('an empty snapshot still derives weeks, with all work reported as added', () => {
    const block = blockWith(captureRecoveryBaselineFromText(''));
    const result = deriveRecoveryComparison({
      block,
      weeks: [weekLink(1, 'n1')],
      notes: [noteWith('n1', '-Bench\n- 100 5')],
    });
    expect(result.status).toBe(RECOVERY_COMPARISON_STATUS.BASELINE_EMPTY);
    expect(result.weeks[0].exercises).toEqual([]);
    expect(result.weeks[0].added.map(a => a.key)).toEqual(['bench']);
  });

  test('stamps the analytics version and the block identity', () => {
    const block = blockWith(captureRecoveryBaselineFromText(WEIGHTED_BASELINE));
    const result = deriveRecoveryComparison({ block, weeks: [], notes: [] });
    expect(result.version).toBe(RECOVERY_ANALYTICS_VERSION);
    expect(result.status).toBe(RECOVERY_COMPARISON_STATUS.OK);
    expect(result.block_id).toBe('rb1');
    expect(result.baseline_version).toBe(RECOVERY_BASELINE_VERSION);
  });
});

describe('deriveRecoveryComparison — week ordering and note states', () => {
  const baseline = captureRecoveryBaselineFromText(WEIGHTED_BASELINE);

  test('weeks follow membership order, not note titles or supplied order', () => {
    const result = deriveRecoveryComparison({
      block: blockWith(baseline),
      weeks: [weekLink(3, 'n3'), weekLink(1, 'n1'), weekLink(2, 'n2')],
      notes: [
        noteWith('n1', '-Bench\n- 60 8', 'Zeta week'),
        noteWith('n2', '-Bench\n- 70 8', 'Alpha week'),
        noteWith('n3', '-Bench\n- 80 8', 'Mid week'),
      ],
    });
    expect(result.weeks.map(w => w.week_number)).toEqual([1, 2, 3]);
    expect(result.weeks.map(w => w.note_id)).toEqual(['n1', 'n2', 'n3']);
    expect(result.weeks.map(w => metricOf(rowFor(w, 'bench'), 'top_load').current)).toEqual([60, 70, 80]);
  });

  test('tombstoned weeks and weeks of another block are excluded', () => {
    const result = deriveRecoveryComparison({
      block: blockWith(baseline),
      weeks: [
        weekLink(1, 'n1'),
        weekLink(2, 'n2', { deleted_at: '2026-01-01T00:00:00.000Z' }),
        weekLink(3, 'n3', { block_id: 'rb-other' }),
      ],
      notes: [noteWith('n1', '-Bench\n- 60 8'), noteWith('n2', '-Bench\n- 70 8'), noteWith('n3', '-Bench\n- 80 8')],
    });
    expect(result.weeks.map(w => w.note_id)).toEqual(['n1']);
  });

  test('a week whose note is not supplied reports note_missing without inventing rows', () => {
    const result = deriveRecoveryComparison({
      block: blockWith(baseline),
      weeks: [weekLink(1, 'gone')],
      notes: [],
    });
    expect(result.weeks[0].status).toBe(RECOVERY_WEEK_STATUS.NOTE_MISSING);
    expect(result.weeks[0].exercises).toEqual([]);
    expect(result.weeks[0].added).toEqual([]);
    expect(result.weeks[0].note_title).toBeNull();
  });

  test('a note that fails the parser contract reports note_unreadable with the error', () => {
    const result = deriveRecoveryComparison({
      block: blockWith(baseline),
      weeks: [weekLink(1, 'n1')],
      // A set row with no exercise to hang it on is a Tier-A parser rejection.
      notes: [noteWith('n1', '-135 5')],
    });
    expect(result.weeks[0].status).toBe(RECOVERY_WEEK_STATUS.NOTE_UNREADABLE);
    expect(result.weeks[0].note_error).toEqual(expect.stringContaining('Set row with no exercise'));
    expect(result.weeks[0].exercises).toEqual([]);
  });

  test('an oversized note is rejected rather than partially compared', () => {
    const oversized = '-Bench\n- 100 10\n'.padEnd(MAX_RAW_TEXT_LENGTH + 1, '\n');
    const result = deriveRecoveryComparison({
      block: blockWith(baseline),
      weeks: [weekLink(1, 'n1')],
      notes: [noteWith('n1', oversized)],
    });
    expect(result.weeks[0].status).toBe(RECOVERY_WEEK_STATUS.NOTE_UNREADABLE);
    expect(result.weeks[0].note_error).toEqual(expect.stringContaining('too large to parse'));
  });

  test('an empty but readable note leaves every baseline exercise Not reintroduced', () => {
    const result = deriveRecoveryComparison({
      block: blockWith(baseline),
      weeks: [weekLink(1, 'n1')],
      notes: [noteWith('n1', '')],
    });
    expect(result.weeks[0].status).toBe(RECOVERY_WEEK_STATUS.OK);
    expect(result.weeks[0].exercises.map(e => e.state)).toEqual([RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED]);
  });

  test('week metadata carries note title and completion without changing the math', () => {
    const result = deriveRecoveryComparison({
      block: blockWith(baseline),
      weeks: [weekLink(1, 'n1', { completed_at: '2026-02-02T00:00:00.000Z' })],
      notes: [noteWith('n1', '-Bench\n- 100 10', 'Recovery Week 1')],
    });
    expect(result.weeks[0]).toMatchObject({
      week_id: 'rw1',
      week_number: 1,
      note_id: 'n1',
      note_title: 'Recovery Week 1',
      completed_at: '2026-02-02T00:00:00.000Z',
    });
  });

  test('notes may be supplied as a Map or an id-keyed object', () => {
    const weeks = [weekLink(1, 'n1')];
    const block = blockWith(baseline);
    const asArray = deriveRecoveryComparison({ block, weeks, notes: [noteWith('n1', '-Bench\n- 100 10')] });
    const asMap = deriveRecoveryComparison({ block, weeks, notes: new Map([['n1', noteWith('n1', '-Bench\n- 100 10')]]) });
    const asObject = deriveRecoveryComparison({ block, weeks, notes: { n1: noteWith('n1', '-Bench\n- 100 10') } });
    expect(asMap).toEqual(asArray);
    expect(asObject).toEqual(asArray);
  });
});

describe('deriveRecoveryComparison — multi-week progress', () => {
  // Pre-layoff: Bench 100x10 (1000 lb), Squat 200x5 (1000 lb), Plank not lifted.
  const baseline = captureRecoveryBaselineFromText('-Bench\n- 100 10\n-Squat\n- 200 5');

  const result = deriveRecoveryComparison({
    block: blockWith(baseline),
    weeks: [weekLink(1, 'n1'), weekLink(2, 'n2'), weekLink(3, 'n3')],
    notes: [
      // Week 1: light bench only, plus rehab mobility work.
      noteWith('n1', '-Bench\n- 65 8\n-Band Pull-apart\n- 15,15'),
      // Week 2: bench climbing, squat reintroduced light.
      noteWith('n2', '-Bench\n- 85 8,8\n-Squat\n- 135 5'),
      // Week 3: bench back to baseline on both dimensions, squat still short on load.
      noteWith('n3', '-Bench\n- 100 10\n-Squat\n- 185 8'),
    ],
  });

  test('each week is derived independently from its own note', () => {
    expect(result.weeks.map(w => rowFor(w, 'bench').state)).toEqual([
      RECOVERY_COMPARISON_STATES.REBUILDING,
      RECOVERY_COMPARISON_STATES.REBUILDING,
      RECOVERY_COMPARISON_STATES.BASELINE_MET,
    ]);
  });

  test('an exercise not yet reintroduced flips to rebuilding when it returns', () => {
    expect(result.weeks.map(w => rowFor(w, 'squat').state)).toEqual([
      RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED,
      RECOVERY_COMPARISON_STATES.REBUILDING,
      RECOVERY_COMPARISON_STATES.REBUILDING,
    ]);
    expect(rowFor(result.weeks[2], 'squat').unmet).toEqual(['top_load']);
    expect(metricOf(rowFor(result.weeks[2], 'squat'), 'volume')).toMatchObject({ current: 1480, met: true });
  });

  test('mobility additions stay attached to the week that logged them', () => {
    expect(result.weeks.map(w => w.added.map(a => a.key))).toEqual([['band pull-apart'], [], []]);
  });

  test('exercise rows keep frozen-snapshot order across every week', () => {
    for (const week of result.weeks) {
      expect(week.exercises.map(e => e.key)).toEqual(['bench', 'squat']);
    }
  });

  test('no week result completes a week, a block, or claims recovery', () => {
    const flat = JSON.stringify(result);
    expect(flat).not.toMatch(/recovered/i);
    expect(result.weeks.every(w => w.completed_at === null)).toBe(true);
  });
});

// ── purity and canonical units ────────────────────────────────────────────────

describe('derivation is pure and unit-independent', () => {
  const baselineText = '-Bench\n- 100 10';

  afterEach(() => {
    __resetWeightUnitForTests();
  });

  test('neither the notes nor the frozen snapshot are mutated', () => {
    const baseline = captureRecoveryBaselineFromText(baselineText);
    const block = blockWith(baseline);
    const notes = [noteWith('n1', '-Bench\n- 90 9')];
    const weeks = [weekLink(1, 'n1')];
    const noteSnapshot = JSON.parse(JSON.stringify(notes));
    const baselineSnapshot = JSON.parse(JSON.stringify(baseline));

    deriveRecoveryComparison({ block, weeks, notes });

    expect(notes).toEqual(noteSnapshot);
    expect(baseline).toEqual(baselineSnapshot);
    expect(Object.isFrozen(baseline)).toBe(true);
  });

  test('repeated derivation returns identical results', () => {
    const block = blockWith(captureRecoveryBaselineFromText(baselineText));
    const weeks = [weekLink(1, 'n1')];
    const notes = [noteWith('n1', '-Bench\n- 90 9')];
    expect(deriveRecoveryComparison({ block, weeks, notes }))
      .toEqual(deriveRecoveryComparison({ block, weeks, notes }));
  });

  test('the display unit preference cannot change a canonical comparison', () => {
    const block = blockWith(captureRecoveryBaselineFromText(baselineText));
    const weeks = [weekLink(1, 'n1')];
    const notes = [noteWith('n1', '-Bench\n- 90 9')];

    setWeightUnitPreference('lb');
    const inPounds = deriveRecoveryComparison({ block, weeks, notes });
    setWeightUnitPreference('kg');
    const inKilos = deriveRecoveryComparison({ block, weeks, notes });

    expect(inKilos).toEqual(inPounds);
    expect(metricOf(rowFor(inKilos.weeks[0], 'bench'), 'top_load').current).toBe(90);
  });
});

describe('likely descriptor-suffixed name mismatch (#1202)', () => {
  const run = (baselineText, sections) =>
    compareWeekWorkToBaseline(captureRecoveryBaselineFromText(baselineText), aggregateRecoveryWeekWork(sections));

  test('unambiguous suffixed header is explained but state and counts stay exact-key', () => {
    const result = run('-Bench Press\n- 135 5,5', [synthSection('Bench Press (paused)', [[durSet(30)]])]);
    const base = rowFor(result, 'bench press');
    expect(base.state).toBe(RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED);
    expect(base.likely_logged_name).toBe('Bench Press (paused)');
    expect(result.added).toHaveLength(1);
    expect(result.added[0].state).toBe(RECOVERY_COMPARISON_STATES.ADDED_DURING_RECOVERY);
    expect(result.added[0].likely_baseline_name).toBe(base.name);
    expect(result.summary.not_reintroduced).toBe(1);
    expect(result.summary.added_during_recovery).toBe(1);
  });

  test('alias-canonicalized base portion still matches a suffixed header', () => {
    const result = run('-Barbell Bench Press\n- 135 5,5', [synthSection('Barbell Bench Press (paused)', [[durSet(30)]])]);
    const base = rowFor(result, 'bench press');
    expect(base.state).toBe(RECOVERY_COMPARISON_STATES.NOT_REINTRODUCED);
    expect(base.likely_logged_name).toBe('Barbell Bench Press (paused)');
    expect(result.added[0].likely_baseline_name).toBe(base.name);
    expect(result.summary.added_during_recovery).toBe(1);
  });

  test('unrelated added exercises and ambiguous candidates get no explanation', () => {
    const unrelated = run('-Bench Press\n- 135 5,5', [synthSection('Benchmark Row', [[durSet(30)]])]);
    expect(rowFor(unrelated, 'bench press').likely_logged_name).toBeUndefined();
    expect(unrelated.added[0].likely_baseline_name).toBeUndefined();
    const ambiguous = run('-Bench Press\n- 135 5,5', [
      synthSection('Bench Press (paused)', [[durSet(30)]]),
      synthSection('Bench Press (tempo)', [[durSet(30)]]),
    ]);
    expect(rowFor(ambiguous, 'bench press').likely_logged_name).toBeUndefined();
    expect(ambiguous.added.every(a => a.likely_baseline_name === undefined)).toBe(true);
  });
});

// ── #1225: v1 and v2 snapshots are both readable; v2 exposes routine order ────

describe('deriveRecoveryComparison — baseline v1 and v2 (#1225)', () => {
  const V1 = {
    version: 1,
    exercises: [
      { key: 'bench', name: 'Bench', exercise_class: 'weighted', top_weight: 100, volume: 1000, sets_completed: 2 },
      { key: 'squat', name: 'Squat', exercise_class: 'weighted', top_weight: 225, volume: 1125, sets_completed: 1 },
    ],
  };
  const WEEK = '-Squat\n- 225 5\n-Bench\n- 100 5,5';
  const run = (baseline) => deriveRecoveryComparison({
    block: blockWith(baseline), weeks: [weekLink(1, 'n1')], notes: [noteWith('n1', WEEK)],
  });

  test('a valid legacy v1 fallback snapshot is compared, never reported as baseline_unsupported', () => {
    const result = run(V1);
    expect(result.status).toBe(RECOVERY_COMPARISON_STATUS.OK);
    expect(result.baseline_version).toBe(1);
    // Legacy alphabetical order is preserved exactly as stored.
    expect(result.weeks[0].exercises.map(e => e.key)).toEqual(['bench', 'squat']);
    expect(rowFor(result.weeks[0], 'bench').state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
  });

  test('a v2 snapshot is compared and its rows come out in routine order, not alphabetical', () => {
    const v2 = captureRecoveryBaselineFromText('-Squat\n- 225 5\n-Bench\n- 100 5,5');
    expect(v2.version).toBe(2);
    const result = run(v2);
    expect(result.status).toBe(RECOVERY_COMPARISON_STATUS.OK);
    expect(result.baseline_version).toBe(2);
    expect(result.weeks[0].exercises.map(e => e.key)).toEqual(['squat', 'bench']);
  });

  test('only versions 1 and 2 are read: 0, 3, and non-integer versions are unsupported', () => {
    for (const version of [0, 3, 99, '2', '1', null, 1.5]) {
      const result = run({ ...V1, version });
      expect(result.status).toBe(RECOVERY_COMPARISON_STATUS.BASELINE_UNSUPPORTED);
      expect(result.weeks).toEqual([]);
    }
  });

  test('baseline_met still needs BOTH top load and volume on a v2 snapshot (state derivation unchanged)', () => {
    const v2 = captureRecoveryBaselineFromText('-Deadlift: 3x6\n- 325 6,6,6');
    const derive = (text) => deriveRecoveryComparison({
      block: blockWith(v2), weeks: [weekLink(1, 'n1')], notes: [noteWith('n1', text)],
    }).weeks[0].exercises[0].state;
    expect(derive('-Deadlift\n- 325 6,6,6')).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
    expect(derive('-Deadlift\n- 335 6')).not.toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
    expect(derive('-Deadlift\n- 225 6,6,6,6,6,6,6,6,6')).not.toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
  });

  test('the corrected Deadlift baseline is what a week is measured against (5850, not the aborted 670)', () => {
    const v2 = captureRecoveryBaselineFromText('-Deadlift: 3x6\n- 325 6,6,6\n- 335 2,-,-');
    const row = deriveRecoveryComparison({
      block: blockWith(v2), weeks: [weekLink(1, 'n1')], notes: [noteWith('n1', '-Deadlift\n- 315 6,6,6')],
    }).weeks[0].exercises[0];
    expect(metricOf(row, 'volume').baseline).toBe(5850);
    expect(metricOf(row, 'top_load').baseline).toBe(325);
  });
});

// ── #1225: timed declarations end to end — real parser -> capture -> comparison ──
//
// Under a timed header the parser reads a comma row (`45,45,45`) as reps but a
// lone bare integer as duration_seconds. Capture and week aggregation both read
// the values as the declared seconds, so a baseline and a same-shaped week
// compare like for like (time_based total_seconds), whichever shape logged it.

describe('timed declarations: parser -> capture -> comparison (#1225)', () => {
  const run = (baselineText, weekText) => {
    const block = blockWith(captureRecoveryBaselineFromText(baselineText));
    const result = deriveRecoveryComparison({ block, weeks: [weekLink(1, 'n1')], notes: [noteWith('n1', weekText)] });
    return { block, week: result.weeks[0], row: result.weeks[0].exercises[0] };
  };
  const secondsOf = (row) => metricOf(row, 'total_seconds');

  test('`3x45s` with 45,45,45: baseline time_based 135 s, and the same week log compares 1.0 / baseline_met', () => {
    const { block, row } = run('-Plank: 3x45s\n- 45,45,45', '-Plank: 3x45s\n- 45,45,45');
    expect(block.baseline.exercises[0]).toMatchObject({ exercise_class: 'time_based', total_seconds: 135 });
    expect(row.exercise_class).toBe('time_based');
    expect(secondsOf(row)).toMatchObject({ baseline: 135, current: 135, ratio: 1, percent: 100, met: true });
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
  });

  test('a shorter week of the same shape reports the exact ratio and a non-met band, identical to bare-row logging', () => {
    const comma = run('-Plank: 3x45s\n- 45,45,45', '-Plank: 3x45s\n- 45,45').row;
    const bare = run('-Plank: 3x45s\n- 45,45,45', '-Plank: 3x45s\n45\n45').row;
    expect(secondsOf(comma)).toMatchObject({ baseline: 135, current: 90, percent: 66, met: false });
    expect(comma.state).not.toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
    // Real bare-row logging (duration_seconds from the parser) lands on the same numbers and state.
    expect(secondsOf(bare)).toEqual(secondsOf(comma));
    expect(bare.state).toBe(comma.state);
  });

  test('`3x1min` with 60,60,60: baseline 180 s; a 180 s week is met, a 120 s week is not', () => {
    const met = run('-Wall Sit: 3x1min\n- 60,60,60', '-Wall Sit: 3x1min\n- 60,60,60').row;
    expect(secondsOf(met)).toMatchObject({ baseline: 180, current: 180, ratio: 1, met: true });
    expect(met.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
    const short = run('-Wall Sit: 3x1min\n- 60,60,60', '-Wall Sit: 3x1min\n- 60,60').row;
    expect(secondsOf(short)).toMatchObject({ baseline: 180, current: 120, percent: 66, met: false });
  });

  test('a single held set: baseline 60 s (bare duration row) against a 45 s week is 75%', () => {
    const { block, row } = run('-Plank: 1x60s\n60', '-Plank: 1x60s\n45');
    expect(block.baseline.exercises[0]).toMatchObject({ exercise_class: 'time_based', total_seconds: 60, basis: 'complete' });
    expect(secondsOf(row)).toMatchObject({ baseline: 60, current: 45, ratio: 0.75, percent: 75, met: false });
  });

  test('a short/skipped hold in the newest baseline session is ignored: the earlier complete 150 s session is the baseline', () => {
    const { block, row } = run('-Plank: 3x45s\n- 50,50,50\n- 45,-,45', '-Plank: 3x45s\n- 50,50,50');
    expect(block.baseline.exercises[0]).toMatchObject({ exercise_class: 'time_based', total_seconds: 150, basis: 'complete' });
    expect(secondsOf(row)).toMatchObject({ baseline: 150, current: 150, met: true });
  });

  test('separate bare rows: baseline is the latest single 45 s hold (never_complete); a three-row week sums to 135 s', () => {
    const { block, row } = run('-Plank: 3x45s\n45\n45\n45', '-Plank: 3x45s\n45\n45\n45');
    expect(block.baseline.exercises[0]).toMatchObject({ exercise_class: 'time_based', total_seconds: 45, basis: 'never_complete' });
    expect(secondsOf(row)).toMatchObject({ baseline: 45, current: 135, ratio: 3, met: true });
    expect(row.exercise_class).toBe('time_based');
  });

  test('NEGATIVE: a reps-shaped week against a time_based baseline is a class change, never silently compared', () => {
    const { row } = run('-Plank: 3x45s\n- 45,45,45', '-Plank\n- 45,45,45');
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
    expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.EXERCISE_CLASS_CHANGED);
  });
});

// v1 parity: a legacy snapshot is compared AS STORED. The v1 row below is exactly
// what origin/main froze from `-Plank: 3x45s` / `- 45,45,45` (reps_only), so weeks
// keep the historical parse and metric family; only v2 baselines get declaration-
// aware week normalization.
describe('v1 baselines keep the historical week parse (#1225 parity)', () => {
  const V1_PLANK = {
    version: 1,
    exercises: [{ key: 'plank', name: 'Plank', exercise_class: 'reps_only', best_set_reps: 45, total_reps: 135, sets_completed: 3 }],
  };
  const against = (weekText) => deriveRecoveryComparison({
    block: blockWith(V1_PLANK), weeks: [weekLink(1, 'n1')], notes: [noteWith('n1', weekText)],
  });

  test('the identical comma-row week still compares as reps (135/135, baseline_met) — not a class change', () => {
    const result = against('-Plank: 3x45s\n- 45,45,45');
    expect(result.status).toBe(RECOVERY_COMPARISON_STATUS.OK);
    const row = result.weeks[0].exercises[0];
    expect(row.exercise_class).toBe('reps_only');
    expect(metricOf(row, 'total_reps')).toMatchObject({ baseline: 135, current: 135, ratio: 1, percent: 100, met: true });
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
  });

  test('a shorter comma-row week keeps its historical ratio and band', () => {
    const row = against('-Plank: 3x45s\n- 45,45').weeks[0].exercises[0];
    expect(metricOf(row, 'total_reps')).toMatchObject({ baseline: 135, current: 90, percent: 66, met: false });
    expect(row.state).not.toBe(RECOVERY_COMPARISON_STATES.BASELINE_MET);
  });

  test('a bare-row week (duration_seconds sets) against the v1 reps baseline is not_comparable, exactly as before', () => {
    const row = against('-Plank: 3x45s\n45\n45\n45').weeks[0].exercises[0];
    expect(row.state).toBe(RECOVERY_COMPARISON_STATES.NOT_COMPARABLE);
    expect(row.unavailable_reason).toBe(RECOVERY_UNAVAILABLE_REASONS.EXERCISE_CLASS_CHANGED);
  });

  test('aggregateRecoveryWeekWork defaults to the historical (non-declaration-aware) parse', () => {
    const sections = parseWorkoutNote('-Plank: 3x45s\n- 45,45,45').sections;
    expect(aggregateRecoveryWeekWork(sections).get('plank')).toMatchObject({ exercise_class: 'reps_only', values: { total_reps: 135 } });
    expect(aggregateRecoveryWeekWork(sections, { declarationAware: true }).get('plank')).toMatchObject({ exercise_class: 'time_based', values: { total_seconds: 135 } });
  });
});
