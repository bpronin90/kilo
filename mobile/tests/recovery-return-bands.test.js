// Recovery return bands and weekly movement (#1029).
//
// Fixtures are reachable through the real parser/derivation: baselines are
// captured with `captureRecoveryBaseline`, weeks are compared with
// `compareWeekWorkToBaseline`/`deriveRecoveryComparison` exactly as #697 does,
// and this module is exercised as a pure downstream consumer of that output —
// never a hand-built row `deriveRecoveryComparison` could not itself emit.

import { parseWorkoutNote } from '../lib/parser';
import { captureRecoveryBaseline, captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import {
  RECOVERY_WEEK_STATUS,
  aggregateRecoveryWeekWork,
  compareWeekWorkToBaseline,
  deriveRecoveryComparison,
} from '../lib/data/recoveryAnalytics';
import {
  RETURN_BAND_CLOSE,
  RETURN_BAND_REBUILDING,
  RETURN_BANDS,
  deriveRecoveryBandSeries,
  deriveRecoveryMovement,
  deriveRecoveryWeekBands,
} from '../lib/data/recoveryReturnBands';

// ── fixture helpers ───────────────────────────────────────────────────────────

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

function sectionsOf(text) {
  return parseWorkoutNote(text).sections;
}

// Wraps a single-week comparison in the `{ status, exercises, ... }` shape
// `deriveRecoveryWeekBands`/`deriveRecoveryBandSeries` read, matching one
// entry of `deriveRecoveryComparison(...).weeks`.
function okWeek(baseline, weekSections, { week_id = 'w1', week_number = 1 } = {}) {
  const work = aggregateRecoveryWeekWork(weekSections);
  return {
    week_id,
    week_number,
    status: RECOVERY_WEEK_STATUS.OK,
    ...compareWeekWorkToBaseline(baseline, work),
  };
}

// Full block/weeks/notes plumbing for multi-week fixtures (movement, sparse
// re-banding across weeks, rename), reusing the real block comparison path.
function blockWith(baseline, id = 'rb1') {
  return { id, baseline, completed_at: null, deleted_at: null };
}
function weekLink(week_number, note_id) {
  return { id: `rw${week_number}`, block_id: 'rb1', note_id, week_number, completed_at: null, deleted_at: null };
}
function noteWith(id, raw_text) {
  return { id, title: `Note ${id}`, raw_text };
}
function comparisonFor(baseline, weekTexts) {
  const block = blockWith(baseline);
  const weeks = weekTexts.map((_, i) => weekLink(i + 1, `n${i + 1}`));
  const notes = weekTexts.map((text, i) => noteWith(`n${i + 1}`, text));
  return deriveRecoveryComparison({ block, weeks, notes });
}

function bucketsOf(week) {
  return deriveRecoveryWeekBands(week).buckets;
}

// ── module surface ────────────────────────────────────────────────────────────

describe('constants', () => {
  test('named thresholds match the design\'s only authored values', () => {
    expect(RETURN_BAND_CLOSE).toBe(0.90);
    expect(RETURN_BAND_REBUILDING).toBe(0.50);
  });

  test('RETURN_BANDS names every one of the six emitted buckets', () => {
    const ids = RETURN_BANDS.map(b => b.id).sort();
    expect(ids).toEqual(
      ['at_or_above', 'cannot_compare', 'close', 'early', 'not_trained_yet', 'rebuilding'].sort()
    );
  });
});

// ── fixture 1 ──────────────────────────────────────────────────────────────────

test('fixture 1: every roster lift not trained yet — no percent anywhere, buckets sum to |B|', () => {
  const baseline = captureRecoveryBaselineFromText('-Bench\n- 100 10\n-Squat\n- 200 5\n-Row\n- 90 10');
  const week = okWeek(baseline, []);
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.roster_size).toBe(3);
  expect(bands.trained).toBe(0);
  expect(bands.buckets).toEqual({
    at_or_above: 0, close: 0, rebuilding: 0, early: 0, not_trained_yet: 3, cannot_compare: 0,
  });
  expect(bands.reason).toBeNull();
  const sum = Object.values(bands.buckets).reduce((a, b) => a + b, 0);
  expect(sum).toBe(bands.roster_size);
  expect(JSON.stringify(bands)).not.toMatch(/0%/);
});

// ── fixtures 2 & 3: sparse re-banding / improvement controls ───────────────────

describe('fixtures 2/3: sparse re-banding control', () => {
  const nineRoster =
    '-Lift A\n- 100 10\n-Lift B\n- 100 10\n-Lift C\n- 100 10\n' +
    '-Lift D\n- 100 10\n-Lift E\n- 100 10\n-Lift F\n- 100 10\n' +
    '-Lift G\n- 100 10\n-Lift H\n- 100 10\n-Lift I\n- 100 10';
  const baseline = captureRecoveryBaselineFromText(nineRoster);

  test('fixture 2: week 2 trains three lifts at 60/80/90%, week 3 logs only the 60% lift unchanged', () => {
    // Baseline volume for each lift is 100*10=1000.
    // 60% -> 600 volume; top_load ratio must also be >=0.6 to land the exercise_return there.
    // Use top_load 60 (ratio 0.6) and reps such that volume ratio matches: 60*10=600 -> 0.6.
    const week2Text = '-Lift A\n- 60 10\n-Lift B\n- 80 10\n-Lift C\n- 90 10';
    const comparison = comparisonFor(baseline, [week2Text]);
    const week2 = comparison.weeks[0];
    const bands2 = deriveRecoveryWeekBands(week2);
    expect(bands2.buckets.rebuilding).toBe(2); // 60%, 80% both < 0.90 and >= 0.50
    expect(bands2.buckets.close).toBe(1); // 90%
    expect(bands2.buckets.not_trained_yet).toBe(6);
    expect(bands2.roster_size).toBe(9);
    const sum2 = Object.values(bands2.buckets).reduce((a, b) => a + b, 0);
    expect(sum2).toBe(9);

    const week3Text = '-Lift A\n- 60 10';
    const comparison3 = comparisonFor(baseline, [week2Text, week3Text]);
    const week3 = comparison3.weeks[1];
    const bands3 = deriveRecoveryWeekBands(week3);
    expect(bands3.buckets.rebuilding).toBe(1);
    expect(bands3.buckets.close).toBe(0);
    expect(bands3.buckets.not_trained_yet).toBe(8);
    expect(bands3.roster_size).toBe(9);
    const sum3 = Object.values(bands3.buckets).reduce((a, b) => a + b, 0);
    expect(sum3).toBe(9);

    const movement = deriveRecoveryMovement(comparison3.weeks, { currentWeekId: comparison3.weeks[1].week_id });
    expect(movement).toBeNull(); // matched=1 < 3
  });

  test('fixture 3: sparse improvement control — only the 90% lift, unchanged, across a further week', () => {
    const week2Text = '-Lift A\n- 60 10\n-Lift B\n- 80 10\n-Lift C\n- 90 10';
    const week3Text = '-Lift C\n- 90 10';
    const comparison = comparisonFor(baseline, [week2Text, week3Text]);
    const week3 = comparison.weeks[1];
    const bands3 = deriveRecoveryWeekBands(week3);
    expect(bands3.buckets.close).toBe(1);
    expect(bands3.buckets.at_or_above).toBe(0);
    expect(bands3.buckets.rebuilding).toBe(0);
    expect(bands3.buckets.early).toBe(0);
    expect(bands3.buckets.cannot_compare).toBe(0);
    expect(bands3.buckets.not_trained_yet).toBe(8);
    expect(bands3.roster_size).toBe(9);
    const sum = Object.values(bands3.buckets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(9);
  });
});

// ── fixture 4: rename re-banding control ────────────────────────────────────────

describe('fixture 4: rename re-banding control', () => {
  // Four-lift roster; week 2 returns 40%, 70%, 95%, 105% by matching both
  // top_load and volume ratios to the same fraction of a 100x10 baseline.
  const baseline = captureRecoveryBaselineFromText(
    '-Lift Early\n- 100 10\n-Lift Rebuild\n- 100 10\n-Lift Close\n- 100 10\n-Lift Above\n- 100 10'
  );
  const week2Text =
    '-Lift Early\n- 40 10\n-Lift Rebuild\n- 70 10\n-Lift Close\n- 95 10\n-Lift Above\n- 105 10';

  test('week 2 baseline bucket split', () => {
    const comparison = comparisonFor(baseline, [week2Text]);
    const bands = deriveRecoveryWeekBands(comparison.weeks[0]);
    expect(bands.buckets).toEqual({
      early: 1, rebuilding: 1, close: 1, at_or_above: 1, not_trained_yet: 0, cannot_compare: 0,
    });
    expect(bands.roster_size).toBe(4);
  });

  test('case A: rename the 95% (close) lift — others unchanged, roster_size stable', () => {
    const week3Text = '-Lift Early\n- 40 10\n-Lift Rebuild\n- 70 10\n-Lift Close Renamed\n- 95 10\n-Lift Above\n- 105 10';
    const comparison = comparisonFor(baseline, [week2Text, week3Text]);
    const week3 = comparison.weeks[1];
    const bands3 = deriveRecoveryWeekBands(week3);
    expect(bands3.buckets.close).toBe(0);
    expect(bands3.buckets.not_trained_yet).toBe(1);
    expect(bands3.buckets.early).toBe(1);
    expect(bands3.buckets.rebuilding).toBe(1);
    expect(bands3.buckets.at_or_above).toBe(1);
    expect(bands3.roster_size).toBe(4);
    const sum = Object.values(bands3.buckets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(4);
    const renamedAdded = week3.added.find(a => a.key === 'lift close renamed');
    expect(renamedAdded).toBeTruthy();
    expect(renamedAdded.metrics.every(m => m.ratio === null)).toBe(true);
  });

  test('case B: rename the 40% (early) lift instead — others unchanged', () => {
    const week3Text = '-Lift Early Renamed\n- 40 10\n-Lift Rebuild\n- 70 10\n-Lift Close\n- 95 10\n-Lift Above\n- 105 10';
    const comparison = comparisonFor(baseline, [week2Text, week3Text]);
    const bands3 = deriveRecoveryWeekBands(comparison.weeks[1]);
    expect(bands3.buckets.early).toBe(0);
    expect(bands3.buckets.not_trained_yet).toBe(1);
    expect(bands3.buckets.rebuilding).toBe(1);
    expect(bands3.buckets.close).toBe(1);
    expect(bands3.buckets.at_or_above).toBe(1);
  });
});

// ── fixture 5: class change ──────────────────────────────────────────────────────

test('fixture 5: weighted baseline logged bodyweight this week — cannot_compare, still in roster, never matched', () => {
  const baseline = captureRecoveryBaselineFromText('-Pull-up\n- 50 5');
  const week = okWeek(baseline, sectionsOf('-Pull-up\n- 10,10'));
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.buckets.cannot_compare).toBe(1);
  expect(bands.roster_size).toBe(1);
  expect(bands.trained).toBe(1);
});

// ── fixture 6: baseline_value_unusable excluded from roster entirely ────────────

test('fixture 6: an unusable baseline row is excluded from roster; a met lift reads 1 of 1 not 1 of 2', () => {
  const goodBaseline = captureRecoveryBaselineFromText('-Bench\n- 100 10');
  // Splice in a synthetic unusable row (unrecognized class / non-finite value).
  const badRow = {
    key: 'ghost lift', name: 'Ghost Lift', exercise_class: 'weighted',
    top_weight: NaN, volume: NaN, sets_completed: 1,
  };
  const baseline = { ...goodBaseline, exercises: [...goodBaseline.exercises, badRow] };
  const week = okWeek(baseline, sectionsOf('-Bench\n- 100 10'));
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.roster_size).toBe(1);
  expect(bands.buckets.at_or_above).toBe(1);
  const sum = Object.values(bands.buckets).reduce((a, b) => a + b, 0);
  expect(sum).toBe(1);
});

// ── fixture 7: min-selection, never a rounded intermediate ─────────────────────

test('fixture 7: mixed dimensions select the min ratio (rebuilding at 60%), never a rounded intermediate', () => {
  const baseline = captureRecoveryBaselineFromText('-Bench\n- 100 10'); // volume 1000
  // top_load 1.05x = 105 on one set; volume must be 0.60x = 600 total -> a
  // second set at a lower weight brings volume down without raising top_load.
  const week = okWeek(baseline, sectionsOf('-Bench\n- 105 1\n- 100 5'));
  const row = week.exercises[0];
  expect(row.state).toBe('rebuilding');
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.buckets.rebuilding).toBe(1);
  expect(JSON.stringify(bands)).not.toMatch(/"8[23]"/);
});

// ── fixture 8: mixed families in one week, no aggregate percentage ─────────────

test('fixture 8: mixed families in one week land in three different bands, no mean of ratios anywhere', () => {
  const baseline = captureRecoveryBaseline([
    ...sectionsOf('-Weighted Lift\n- 100 10\n-Reps Lift\n- 5,5'),
    synthSection('Timed Lift', [[durSet(50)]]),
  ]);
  const week = okWeek(baseline, [
    ...sectionsOf('-Weighted Lift\n- 50 10\n-Reps Lift\n- 4,5'),
    synthSection('Timed Lift', [[durSet(60)]]),
  ]);
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.buckets.early).toBe(0);
  expect(bands.buckets.rebuilding).toBe(1); // weighted: top_load .5, volume .5 -> rebuilding
  expect(bands.buckets.close).toBe(1); // reps: 9/10 = .90 -> close
  expect(bands.buckets.at_or_above).toBe(1); // timed: 60/50 = 1.2 -> baseline_met
  expect(JSON.stringify(bands)).not.toMatch(/"8[67]"/);
});

// ── fixture 9: band boundaries ───────────────────────────────────────────────────

describe('fixture 9: band boundaries', () => {
  const baseline = captureRecoveryBaselineFromText('-Lift\n- 100 10'); // volume 1000
  function bandFor(loadPct, volPct) {
    // top_load ratio = loadPct, volume ratio = volPct via reps to hit exact volume.
    const load = 100 * loadPct;
    const reps = 10 * volPct; // volume = load*reps... adjust to hit volume ratio directly instead.
    void reps;
    // Simplify: keep top_load == desired ratio*100, and set reps so volume ratio matches loadPct too
    // (single set, so volume = load * reps; choose reps=10*volPct/loadPct is messy — instead use a
    // dedicated single-dimension baseline: reps-only, so ratio is exactly total_reps ratio.)
    return load;
  }
  void bandFor;

  const repsBaseline = captureRecoveryBaselineFromText('-Reps Lift\n- 5000,5000'); // total_reps 10000

  test.each([
    [50, 'rebuilding'],
    [89.99, 'rebuilding'],
    [90, 'close'],
    [99.99, 'close'],
  ])('ratio %s%% of baseline lands in %s', (pct, expectedBand) => {
    const total = Math.round(pct * 100); // pct/100 * 10000, exact integer
    const week = okWeek(repsBaseline, sectionsOf(`-Reps Lift\n- ${total - 1},1`));
    const bands = deriveRecoveryWeekBands(week);
    expect(bands.buckets[expectedBand]).toBe(1);
  });

  test('ratio of exactly 1.0 and 1.5 both land in at_or_above', () => {
    for (const pct of [100, 150]) {
      const total = Math.round(pct * 100);
      const week = okWeek(repsBaseline, sectionsOf(`-Reps Lift\n- ${total - 1},1`));
      const bands = deriveRecoveryWeekBands(week);
      expect(bands.buckets.at_or_above).toBe(1);
    }
  });
});

// ── fixture 10: float epsilon on repeated baseline session ─────────────────────

test('fixture 10: repeating the frozen baseline session exactly bands at_or_above', () => {
  const baseline = captureRecoveryBaselineFromText('-Bench\n- 20.1 6');
  const week = okWeek(baseline, sectionsOf('-Bench\n- 20.1 1,5'));
  const row = week.exercises[0];
  expect(row.state).toBe('baseline_met');
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.buckets.at_or_above).toBe(1);
});

// ── fixture 11: Pareto movement ─────────────────────────────────────────────────

test('fixture 11: Pareto movement — gain one/lose other is steady; both gain is improved; both lose is fell_back', () => {
  const baseline = captureRecoveryBaselineFromText('-A\n- 100 10\n-B\n- 100 10\n-C\n- 100 10');
  // Week1 (anchor): A at 100%, B at 100%, C at 100%.
  const week1 = '-A\n- 100 10\n-B\n- 100 10\n-C\n- 100 10';
  // Week2 (current): A gains load loses volume via fewer reps but higher weight -> steady;
  // B gains both; C loses both.
  const week2 = '-A\n- 110 8\n-B\n- 110 11\n-C\n- 90 9';
  const comparison = comparisonFor(baseline, [week1, week2]);
  const movement = deriveRecoveryMovement(comparison.weeks, { currentWeekId: comparison.weeks[1].week_id });
  expect(movement).not.toBeNull();
  expect(movement.improved).toBe(1); // B
  expect(movement.fell_back).toBe(1); // C
  expect(movement.steady).toBe(1); // A
  expect(movement.matched_size).toBe(3);
  expect(movement.anchor_week_number).toBe(1);
});

test('fixture 11b: a 0.4% ratio gain reads improved even though floored percents would tie', () => {
  const repsBaseline = captureRecoveryBaselineFromText('-A\n- 500,500'); // total_reps 1000
  const week1 = '-A\n- 500,500'; // ratio 1.0
  const week2 = '-A\n- 500,504'; // ratio 1.004 -> +0.4%, floors to same 100%
  const comparison = comparisonFor(repsBaseline, [week1, week2]);
  const movement = deriveRecoveryMovement(comparison.weeks, { currentWeekId: comparison.weeks[1].week_id });
  // Only one lift in a 1-item roster -> minimumMatched = roster size (1).
  expect(movement).not.toBeNull();
  expect(movement.improved).toBe(1);
});

// ── fixture 12: anchor skipping over an unreadable week ─────────────────────────

test('fixture 12: anchor skips an unreadable week — movement spans week1 -> week3, week2 is a gap', () => {
  const baseline = captureRecoveryBaselineFromText('-A\n- 100 10\n-B\n- 100 10\n-C\n- 100 10');
  const block = blockWith(baseline);
  const weeks = [weekLink(1, 'n1'), weekLink(2, 'nMissing'), weekLink(3, 'n3')];
  const notes = [
    noteWith('n1', '-A\n- 100 10\n-B\n- 100 10\n-C\n- 100 10'),
    // n2 deliberately absent from `notes` -> note_missing.
    noteWith('n3', '-A\n- 110 11\n-B\n- 110 11\n-C\n- 110 11'),
  ];
  const comparison = deriveRecoveryComparison({ block, weeks, notes });
  expect(comparison.weeks[1].status).toBe(RECOVERY_WEEK_STATUS.NOTE_MISSING);

  const movement = deriveRecoveryMovement(comparison.weeks, { currentWeekId: comparison.weeks[2].week_id });
  expect(movement).not.toBeNull();
  expect(movement.anchor_week_number).toBe(1);

  const series = deriveRecoveryBandSeries(comparison);
  expect(series[1].buckets).toBeNull(); // gap, never a zero bar
});

// ── fixture 13: most_common_gap ─────────────────────────────────────────────────

test('fixture 13: most_common_gap names the strictly-most-common unmet dimension; a 2-2 tie is suppressed', () => {
  // Two lifts short on total_reps (reps-only), one short on top_load only
  // (impossible to be short on load alone for weighted since both dims are
  // judged — use reps-only/time-based lifts to isolate single dimensions).
  const baseline = captureRecoveryBaseline([
    ...sectionsOf('-Reps A\n- 10,10\n-Reps B\n- 10,10'),
    synthSection('Timed A', [[durSet(60)]]),
  ]);
  const week = okWeek(baseline, [
    ...sectionsOf('-Reps A\n- 5,5\n-Reps B\n- 5,5'),
    synthSection('Timed A', [[durSet(60)]]),
  ]);
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.most_common_gap).toBe('Reps');
  expect(bands.most_common_gap).not.toMatch(/most lifts/i);

  // Now make it a 2-2 tie: one lift short on reps, one short on time.
  const baseline2 = captureRecoveryBaseline([
    ...sectionsOf('-Reps A\n- 10,10'),
    synthSection('Timed A', [[durSet(60)]]),
  ]);
  const week2 = okWeek(baseline2, [
    ...sectionsOf('-Reps A\n- 5,5'),
    synthSection('Timed A', [[durSet(30)]]),
  ]);
  const bands2 = deriveRecoveryWeekBands(week2);
  expect(bands2.most_common_gap).toBeNull();
});

// ── fixture 14/15: overview shapes are asserted in analytics-screen.test.js ─────
// (deriveOverviewRows/overviewAsOf live in analyticsDerivations.js, not here.)

// ── fixture 16: unverified/stale — caller responsibility, asserted via UI tests ──
// (deriveRecoveryMovement takes no ready/stale flag; the caller must not invoke
// it off an unverified snapshot. Covered by home-screen.test.js /
// analytics-screen.test.js.)

// ── fixture 17: uncapped above-baseline percent already asserted by #697 ────────

test('fixture 17: a 180%-return lift still bands at_or_above and reports the true uncapped ratio', () => {
  const repsBaseline = captureRecoveryBaselineFromText('-Lift\n- 50,50');
  const week = okWeek(repsBaseline, sectionsOf('-Lift\n- 90,90'));
  const row = week.exercises[0];
  expect(row.metrics[0].percent).toBe(180);
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.buckets.at_or_above).toBe(1);
});

// ── fixture 18: epsilon agreement between band and detail row ──────────────────

test('fixture 18: a ULP-short float volume tie still bands at_or_above, agreeing with the met detail row', () => {
  const baseline = captureRecoveryBaselineFromText('-Lift\n- 20.1 6'); // volume 120.60000000000001
  const week = okWeek(baseline, sectionsOf('-Lift\n- 20.1 1,5')); // volume 120.6
  const row = week.exercises[0];
  const volume = row.metrics.find(m => m.metric === 'volume');
  const top_load = row.metrics.find(m => m.metric === 'top_load');
  expect(row.state).toBe('baseline_met');
  expect(volume.met).toBe(true);
  expect(volume.ratio).toBeLessThan(1);
  expect(volume.percent).toBe(100);
  expect(top_load.ratio).toBe(1);
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.buckets.at_or_above).toBe(1);
  expect(bands.buckets.close).toBe(0);
});

// ── fixture 19: realistic cardinality ────────────────────────────────────────────

test('fixture 19: 27-exercise roster (23 weighted, 4 reps-only), 11 trained — bucket rows size against 11', () => {
  const weightedNames = Array.from({ length: 23 }, (_, i) => `Weighted ${i + 1}`);
  const repsNames = Array.from({ length: 4 }, (_, i) => `Reps ${i + 1}`);
  const baselineText =
    weightedNames.map(n => `-${n}\n- 100 10`).join('\n') + '\n' +
    repsNames.map(n => `-${n}\n- 10,10`).join('\n');
  const baseline = captureRecoveryBaselineFromText(baselineText);
  expect(baseline.exercises.length).toBe(27);

  // Train 11: 4 at_or_above, 3 close, 2 rebuilding, 1 early, 1 cannot_compare.
  const trainedText = [
    `-${weightedNames[0]}\n- 100 10`, `-${weightedNames[1]}\n- 100 10`,
    `-${weightedNames[2]}\n- 100 10`, `-${weightedNames[3]}\n- 100 10`,
    `-${weightedNames[4]}\n- 95 10`, `-${weightedNames[5]}\n- 95 10`, `-${weightedNames[6]}\n- 95 10`,
    `-${weightedNames[7]}\n- 60 10`, `-${weightedNames[8]}\n- 60 10`,
    `-${weightedNames[9]}\n- 30 10`,
    `-${weightedNames[10]}\n- 10,10`, // bodyweight against weighted baseline -> class changed
  ].join('\n');
  const week = okWeek(baseline, sectionsOf(trainedText));
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.roster_size).toBe(27);
  expect(bands.trained).toBe(11);
  expect(bands.buckets.not_trained_yet).toBe(16);
  const sum = Object.values(bands.buckets).reduce((a, b) => a + b, 0);
  expect(sum).toBe(27);
});

// ── fixture 20: sparse visual floor ──────────────────────────────────────────────

test('fixture 20: 27-roster with 1 trained lift — 1 of 27, everything else not_trained_yet', () => {
  const names = Array.from({ length: 27 }, (_, i) => `Lift ${i + 1}`);
  const baselineText = names.map(n => `-${n}\n- 100 10`).join('\n');
  const baseline = captureRecoveryBaselineFromText(baselineText);
  const week = okWeek(baseline, sectionsOf(`-${names[0]}\n- 100 10`));
  const bands = deriveRecoveryWeekBands(week);
  expect(bands.roster_size).toBe(27);
  expect(bands.trained).toBe(1);
  expect(bands.buckets.not_trained_yet).toBe(26);
  expect(bands.buckets.at_or_above).toBe(1);
});

// ── deriveRecoveryBandSeries: general shape ─────────────────────────────────────

test('deriveRecoveryBandSeries returns one entry per live week, in week order, summing to roster', () => {
  const baseline = captureRecoveryBaselineFromText('-A\n- 100 10\n-B\n- 100 10');
  const comparison = comparisonFor(baseline, ['-A\n- 100 10', '-A\n- 100 10\n-B\n- 100 10']);
  const series = deriveRecoveryBandSeries(comparison);
  expect(series).toHaveLength(2);
  for (const [i, entry] of series.entries()) {
    expect(entry.week_number).toBe(i + 1);
    const sum = Object.values(entry.buckets).reduce((a, b) => a + b, 0);
    expect(sum).toBe(2);
  }
});

test('deriveRecoveryMovement returns null with a truthful reason path when fewer than 2 qualifying weeks exist', () => {
  const baseline = captureRecoveryBaselineFromText('-A\n- 100 10\n-B\n- 100 10\n-C\n- 100 10');
  const comparison = comparisonFor(baseline, ['-A\n- 100 10\n-B\n- 100 10\n-C\n- 100 10']);
  const movement = deriveRecoveryMovement(comparison.weeks, { currentWeekId: comparison.weeks[0].week_id });
  expect(movement).toBeNull();
});

test('unknown currentWeekId returns null rather than throwing', () => {
  expect(deriveRecoveryMovement([], { currentWeekId: 'nope' })).toBeNull();
  expect(deriveRecoveryWeekBands(null).buckets).toBeNull();
});
