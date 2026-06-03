import { parseWeightEntry, parseWorkoutRow, parseWorkoutEntry, parseWorkoutNote, buildSessionsFromNote, countWorkoutSessions, countWorkoutSessionsFromSections, epleyPR, deriveWorkoutAnalytics, deriveTrackedPRs, deriveProgressionSignals, derivePerDaySignals, parseExerciseHeader, generateDeloadNote } from '../lib/parser';
import { getDefaultTrackedNames, derive1kTotal, derive1kTotalSeries, DEFAULT_1K_EXERCISES } from '../lib/data';

// ── getDefaultTrackedNames ────────────────────────────────────────────────────

describe('getDefaultTrackedNames', () => {
  test('returns an array of strings', () => {
    const names = getDefaultTrackedNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.every(n => typeof n === 'string')).toBe(true);
  });

  test('contains no duplicate names', () => {
    const names = getDefaultTrackedNames();
    expect(new Set(names).size).toBe(names.length);
  });

  test('does not include Hammer Curl twice despite appearing on two days', () => {
    const names = getDefaultTrackedNames();
    expect(names.filter(n => n === 'Hammer Curl')).toHaveLength(1);
  });
});

// ── epleyPR ───────────────────────────────────────────────────────────────────

describe('epleyPR', () => {
  test('computes Epley formula: weight * (1 + reps/30)', () => {
    expect(epleyPR(100, 10)).toBeCloseTo(100 * (1 + 10 / 30));
  });

  test('returns null when weight is null', () => {
    expect(epleyPR(null, 8)).toBeNull();
  });

  test('returns null when reps is null', () => {
    expect(epleyPR(135, null)).toBeNull();
  });

  test('returns null when weight is zero', () => {
    expect(epleyPR(0, 8)).toBeNull();
  });

  test('returns null when reps is zero', () => {
    expect(epleyPR(135, 0)).toBeNull();
  });

  test('single-rep set returns weight (1 + 1/30)', () => {
    const pr = epleyPR(305, 1);
    expect(pr).toBeCloseTo(305 * (1 + 1 / 30));
  });
});

// ── deriveWorkoutAnalytics ────────────────────────────────────────────────────

describe('deriveWorkoutAnalytics — output shape', () => {
  test('returns exercises array', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8,8,8');
    const result = deriveWorkoutAnalytics(sections);
    expect(Array.isArray(result.exercises)).toBe(true);
  });

  test('derived exercise has required fields', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8,8,8');
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex).toHaveProperty('name');
    expect(ex).toHaveProperty('occurrences');
    expect(ex).toHaveProperty('sets');
    expect(ex).toHaveProperty('rows');
    expect(ex).toHaveProperty('set_prs');
    expect(ex).toHaveProperty('estimated_pr');
  });

  test('occurrence has heading, subheading, kind, rows, sets', () => {
    const { sections } = parseWorkoutNote('Monday\n+LIFTING\n-Bench\n80 8,8,8');
    const occ = deriveWorkoutAnalytics(sections).exercises[0].occurrences[0];
    expect(occ).toHaveProperty('heading', 'Monday');
    expect(occ).toHaveProperty('subheading', 'LIFTING');
    expect(occ).toHaveProperty('kind');
    expect(Array.isArray(occ.rows)).toBe(true);
    expect(Array.isArray(occ.sets)).toBe(true);
  });

  test('set_prs entries have set, epley_pr, and occurrence_index fields', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8');
    const sp = deriveWorkoutAnalytics(sections).exercises[0].set_prs[0];
    expect(sp).toHaveProperty('set');
    expect(sp).toHaveProperty('epley_pr');
    expect(sp).toHaveProperty('occurrence_index');
  });

  test('derived exercise has unparsed_rows field', () => {
    const { sections } = parseWorkoutNote('-Bike\n5 min 9');
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex).toHaveProperty('unparsed_rows');
    expect(Array.isArray(ex.unparsed_rows)).toBe(true);
  });

  test('occurrence has unparsed_rows field', () => {
    const { sections } = parseWorkoutNote('-Bike\n5 min 9');
    const occ = deriveWorkoutAnalytics(sections).exercises[0].occurrences[0];
    expect(occ).toHaveProperty('unparsed_rows');
    expect(Array.isArray(occ.unparsed_rows)).toBe(true);
  });

  test('empty sections produces empty exercises array', () => {
    const result = deriveWorkoutAnalytics([]);
    expect(result.exercises).toHaveLength(0);
  });
});

describe('deriveWorkoutAnalytics — sets and PRs', () => {
  test('sets are flattened across all rows', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8,8,8\n85 8,8');
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.sets).toHaveLength(5);
  });

  test('rows array preserves line-level grouping', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8,8,8\n85 8,8');
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.rows).toHaveLength(2);
  });

  test('estimated_pr is the highest epley across all sets', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8\n90 5');
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    const pr80x8 = epleyPR(80, 8);
    const pr90x5 = epleyPR(90, 5);
    expect(ex.estimated_pr).toBeCloseTo(Math.max(pr80x8, pr90x5));
  });

  test('estimated_pr is null for bodyweight/core exercises with no weight', () => {
    const { sections } = parseWorkoutNote('Core: Plank\n30,30');
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.estimated_pr).toBeNull();
  });

  test('set_prs count matches sets count', () => {
    const { sections } = parseWorkoutNote('-Squat\n205 8,8,8');
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.set_prs).toHaveLength(ex.sets.length);
  });

  test('set_pr.epley_pr is null for sets with no weight', () => {
    const { sections } = parseWorkoutNote('Core: Plank\n30,30');
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.set_prs.every(sp => sp.epley_pr === null)).toBe(true);
  });
});

describe('deriveWorkoutAnalytics — multi-day and repeatability context', () => {
  test('same exercise across multiple days is merged into one entry', () => {
    const note = 'Monday\n-Bench\n80 8,8\nTuesday\n-Bench\n85 6,6';
    const { sections } = parseWorkoutNote(note);
    const result = deriveWorkoutAnalytics(sections);
    const benches = result.exercises.filter(e => e.name === 'Bench');
    expect(benches).toHaveLength(1);
    expect(benches[0].sets).toHaveLength(4);
    expect(benches[0].occurrences).toHaveLength(2);
  });

  test('each occurrence preserves its day heading', () => {
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n85 6';
    const { sections } = parseWorkoutNote(note);
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    const headings = ex.occurrences.map(o => o.heading);
    expect(headings).toContain('Monday');
    expect(headings).toContain('Wednesday');
  });

  test('rows from a single occurrence keep sets grouped for repeatability', () => {
    // "305 6,6,4" is one row with 3 sets — stronger signal than three separate rows
    const note = '-Bench\n305 6,6,4\n295 6';
    const { sections } = parseWorkoutNote(note);
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.rows[0].sets).toHaveLength(3); // 6,6,4
    expect(ex.rows[1].sets).toHaveLength(1); // 6
  });

  test('multiple exercises in same note produce separate derived entries', () => {
    const note = '-Bench\n80 8,8,8\n-Squat\n205 8,8,8';
    const { sections } = parseWorkoutNote(note);
    const result = deriveWorkoutAnalytics(sections);
    const names = result.exercises.map(e => e.name);
    expect(names).toContain('Bench');
    expect(names).toContain('Squat');
  });

  test('non-weight exercise unparsed_rows flow through to occurrence and exercise', () => {
    const note = '-Bike\n5 min 9\n10\n6';
    const { sections } = parseWorkoutNote(note);
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.occurrences[0].sets).toHaveLength(0);
    expect(ex.occurrences[0].unparsed_rows).toContain('5 min 9');
    expect(ex.unparsed_rows).toContain('5 min 9');
  });

  test('occurrence_index links set_pr back to the correct occurrence', () => {
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n90 5';
    const { sections } = parseWorkoutNote(note);
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    // occurrence 0 = Monday (80lb set), occurrence 1 = Wednesday (90lb set)
    const pr0 = ex.set_prs.find(sp => sp.set.weight_value === 80);
    const pr1 = ex.set_prs.find(sp => sp.set.weight_value === 90);
    expect(pr0.occurrence_index).toBe(0);
    expect(pr1.occurrence_index).toBe(1);
    expect(ex.occurrences[pr0.occurrence_index].heading).toBe('Monday');
    expect(ex.occurrences[pr1.occurrence_index].heading).toBe('Wednesday');
  });
});

describe('deriveWorkoutAnalytics — sample workout shapes', () => {
  test('deload-format note produces correct PR estimates', () => {
    const note = 'Monday — Push\nDB Bench: 80 lbs 3x8';
    const { sections } = parseWorkoutNote(note);
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.estimated_pr).toBeCloseTo(epleyPR(80, 8));
  });

  test('multi-weight row: best set wins for estimated_pr', () => {
    // 85 8 80 8,8,8 — 85x8 should yield the highest PR
    const note = '-Bench\n85 8 80 8,8,8';
    const { sections } = parseWorkoutNote(note);
    const ex = deriveWorkoutAnalytics(sections).exercises[0];
    expect(ex.estimated_pr).toBeCloseTo(epleyPR(85, 8));
  });

  test('1k-relevant exercises each surface an estimated_pr', () => {
    const note = [
      '-Bench\n225 5',
      '-Squat\n315 3',
      '-Deadlift\n405 1',
    ].join('\n');
    const { sections } = parseWorkoutNote(note);
    const result = deriveWorkoutAnalytics(sections);
    for (const name of ['Bench', 'Squat', 'Deadlift']) {
      const ex = result.exercises.find(e => e.name === name);
      expect(ex.estimated_pr).not.toBeNull();
    }
  });
});

// ── deriveTrackedPRs ──────────────────────────────────────────────────────────

describe('deriveTrackedPRs', () => {
  test('returns one entry per tracked name in order', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8,8\n-Squat\n205 5,5');
    const result = deriveTrackedPRs(sections, ['Bench', 'Squat']);
    expect(result.exercises.map(e => e.name)).toEqual(['Bench', 'Squat']);
  });

  test('single-weight exercise surfaces correct estimated_pr', () => {
    const { sections } = parseWorkoutNote('-Bench\n100 5');
    const result = deriveTrackedPRs(sections, ['Bench']);
    expect(result.exercises[0].estimated_pr).toBeCloseTo(epleyPR(100, 5));
  });

  test('mixed-weight exercise: heavier low-rep set wins when it yields higher PR', () => {
    // 90x5 vs 80x8 — determine which is higher
    const { sections } = parseWorkoutNote('-Bench\n80 8 90 5');
    const result = deriveTrackedPRs(sections, ['Bench']);
    const expected = Math.max(epleyPR(80, 8), epleyPR(90, 5));
    expect(result.exercises[0].estimated_pr).toBeCloseTo(expected);
  });

  test('mixed-weight exercise: high-rep moderate-weight set wins when it yields higher PR', () => {
    // 225x10 vs 275x1 — 225x10 Epley = 300, 275x1 = ~284
    const { sections } = parseWorkoutNote('-Bench\n225 10 275 1');
    const result = deriveTrackedPRs(sections, ['Bench']);
    const expected = Math.max(epleyPR(225, 10), epleyPR(275, 1));
    expect(result.exercises[0].estimated_pr).toBeCloseTo(expected);
  });

  test('tracked exercise absent from note returns null estimated_pr', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8');
    const result = deriveTrackedPRs(sections, ['Bench', 'Squat']);
    const squat = result.exercises.find(e => e.name === 'Squat');
    expect(squat.estimated_pr).toBeNull();
  });

  test('exercise in note but not in trackedNames is excluded', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8\n-Squat\n205 5');
    const result = deriveTrackedPRs(sections, ['Bench']);
    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0].name).toBe('Bench');
  });

  test('empty trackedNames returns empty exercises array', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8');
    const result = deriveTrackedPRs(sections, []);
    expect(result.exercises).toHaveLength(0);
  });

  test('empty sections returns null PR for all tracked names', () => {
    const result = deriveTrackedPRs([], ['Bench', 'Squat', 'Deadlift']);
    expect(result.exercises.every(e => e.estimated_pr === null)).toBe(true);
  });

  test('changing trackedNames immediately changes output', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8\n-Squat\n205 5');
    const r1 = deriveTrackedPRs(sections, ['Bench']);
    const r2 = deriveTrackedPRs(sections, ['Squat']);
    expect(r1.exercises[0].name).toBe('Bench');
    expect(r2.exercises[0].name).toBe('Squat');
    expect(r1.exercises[0].estimated_pr).not.toBeCloseTo(r2.exercises[0].estimated_pr);
  });

  test('multi-day note: exercise PR reflects best set across all days', () => {
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n90 5';
    const { sections } = parseWorkoutNote(note);
    const result = deriveTrackedPRs(sections, ['Bench']);
    const expected = Math.max(epleyPR(80, 8), epleyPR(90, 5));
    expect(result.exercises[0].estimated_pr).toBeCloseTo(expected);
  });

  test('duplicate names in trackedNames produce one row per unique name', () => {
    const { sections } = parseWorkoutNote('-Hammer Curl\n30 10');
    const result = deriveTrackedPRs(sections, ['Hammer Curl', 'Hammer Curl']);
    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0].name).toBe('Hammer Curl');
  });

  test('duplicate names do not double the estimated_pr value', () => {
    const { sections } = parseWorkoutNote('-Hammer Curl\n30 10');
    const result = deriveTrackedPRs(sections, ['Hammer Curl', 'Hammer Curl']);
    expect(result.exercises[0].estimated_pr).toBeCloseTo(epleyPR(30, 10));
  });
});

// ── derive1kTotal ─────────────────────────────────────────────────────────────

describe('derive1kTotal', () => {
  const SEL = { bench: 'Bench', squat: 'Squat', deadlift: 'Deadlift' };

  test('returns total as sum of the three estimated PRs when all lifts present', () => {
    const note = '-Bench\n225 5\n-Squat\n315 3\n-Deadlift\n405 1';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    const expected = epleyPR(225, 5) + epleyPR(315, 3) + epleyPR(405, 1);
    expect(result.total).toBeCloseTo(expected);
  });

  test('returns individual PRs for each slot', () => {
    const note = '-Bench\n225 5\n-Squat\n315 3\n-Deadlift\n405 1';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    expect(result.bench).toBeCloseTo(epleyPR(225, 5));
    expect(result.squat).toBeCloseTo(epleyPR(315, 3));
    expect(result.deadlift).toBeCloseTo(epleyPR(405, 1));
  });

  test('total is null when one lift is absent from the note', () => {
    const note = '-Bench\n225 5\n-Squat\n315 3';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    expect(result.total).toBeNull();
    expect(result.deadlift).toBeNull();
    expect(result.bench).not.toBeNull();
    expect(result.squat).not.toBeNull();
  });

  test('total is null when all three lifts are absent', () => {
    const { sections } = parseWorkoutNote('-Bike\n5 min');
    const result = derive1kTotal(sections, SEL);
    expect(result.total).toBeNull();
    expect(result.bench).toBeNull();
    expect(result.squat).toBeNull();
    expect(result.deadlift).toBeNull();
  });

  test('total is null for empty sections', () => {
    const result = derive1kTotal([], SEL);
    expect(result.total).toBeNull();
  });

  test('mixed-weight row: best Epley PR is used for each lift', () => {
    // 80x8 vs 90x5 — whichever yields higher Epley wins
    const note = '-Bench\n80 8 90 5\n-Squat\n205 8\n-Deadlift\n315 5';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    const expectedBench = Math.max(epleyPR(80, 8), epleyPR(90, 5));
    expect(result.bench).toBeCloseTo(expectedBench);
    expect(result.total).toBeCloseTo(expectedBench + epleyPR(205, 8) + epleyPR(315, 5));
  });

  test('deload-format note produces correct total', () => {
    const note = 'Bench: 225 lbs 3x5\nSquat: 315 lbs 3x3\nDeadlift: 405 lbs 1x1';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    const expected = epleyPR(225, 5) + epleyPR(315, 3) + epleyPR(405, 1);
    expect(result.total).toBeCloseTo(expected);
  });

  test('changing selections immediately reflects the new exercises', () => {
    const note = '-Bench\n225 5\n-Incline DB Press\n185 8\n-Squat\n315 3\n-Deadlift\n405 1';
    const { sections } = parseWorkoutNote(note);
    const r1 = derive1kTotal(sections, SEL);
    const r2 = derive1kTotal(sections, { bench: 'Incline DB Press', squat: 'Squat', deadlift: 'Deadlift' });
    expect(r1.bench).toBeCloseTo(epleyPR(225, 5));
    expect(r2.bench).toBeCloseTo(epleyPR(185, 8));
    expect(r1.total).not.toBeCloseTo(r2.total);
  });

  test('multi-day note: the latest aligned cycle is used per lift (current performance)', () => {
    const note = 'Monday\n-Bench\n80 8\n-Squat\n315 3\n-Deadlift\n405 1\n'
               + 'Wednesday\n-Bench\n90 5\n-Squat\n320 3\n-Deadlift\n410 1';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    // Wednesday is the most recent complete Big-3 cycle, so its PRs are used.
    expect(result.bench).toBeCloseTo(epleyPR(90, 5));
    expect(result.total).toBeCloseTo(epleyPR(90, 5) + epleyPR(320, 3) + epleyPR(410, 1));
  });

  // ── current-performance semantics (issue #250) ──
  // The 1K total tracks the latest COMPLETE Big-3 cycle and must fall after
  // lighter work, never stick at an earlier higher value, regardless of how
  // sessions are separated in the note. It must also stay aligned with
  // derive1kTotalSeries (never sum PRs from different cycles).

  test('multi-day note: a lighter later cycle lowers the total (not sticky)', () => {
    const note = 'Monday\n-Bench\n225 5\n-Squat\n315 3\n-Deadlift\n405 1\n'
               + 'Friday\n-Bench\n185 5\n-Squat\n300 3\n-Deadlift\n395 1';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    expect(result.bench).toBeCloseTo(epleyPR(185, 5));
    expect(result.bench).toBeLessThan(epleyPR(225, 5));
    expect(result.total).toBeCloseTo(epleyPR(185, 5) + epleyPR(300, 3) + epleyPR(395, 1));
  });

  test('dash-entry sessions in one block: lighter latest cycle lowers the total', () => {
    // No weekday separators — each lift collapses into a single parsed occurrence.
    // The latest `- entry` cycle is lighter and must win.
    const note = '-Bench\n- 225 5\n- 235 5\n- 200 5\n'
               + '-Squat\n- 315 3\n- 320 3\n- 310 3\n'
               + '-Deadlift\n- 405 1\n- 415 1\n- 400 1';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    expect(result.bench).toBeCloseTo(epleyPR(200, 5));
    expect(result.bench).toBeLessThan(epleyPR(235, 5));
    expect(result.total).toBeCloseTo(epleyPR(200, 5) + epleyPR(310, 3) + epleyPR(400, 1));
  });

  test('blank-line separated sessions: lighter latest cycle lowers the total', () => {
    // Blank lines collapse into one occurrence (parser skips empties); each data
    // row is still its own session, so the lighter last cycle must win.
    const note = '-Bench\n225 5\n\n235 5\n\n205 5\n'
               + '-Squat\n315 3\n320 3\n310 3\n'
               + '-Deadlift\n405 1\n415 1\n405 1';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    expect(result.bench).toBeCloseTo(epleyPR(205, 5));
    expect(result.bench).toBeLessThan(epleyPR(235, 5));
    expect(result.total).toBeCloseTo(epleyPR(205, 5) + epleyPR(310, 3) + epleyPR(405, 1));
  });

  test('skipped latest cycle falls back to the last complete cycle, not a mixed sum', () => {
    // Bench is skipped in the latest cycle while squat/deadlift log a 3rd session.
    // The total must drop to cycle 2 (where all three are present) rather than mix
    // bench cycle 2 with squat/deadlift cycle 3.
    const note = '-Bench\n- 225 5\n- 235 5\n-\n'
               + '-Squat\n- 315 3\n- 320 3\n- 322 3\n'
               + '-Deadlift\n- 405 1\n- 415 1\n- 417 1';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    expect(result.bench).toBeCloseTo(epleyPR(235, 5));
    expect(result.squat).toBeCloseTo(epleyPR(320, 3)); // cycle 2, NOT 322 (cycle 3)
    expect(result.total).toBeCloseTo(epleyPR(235, 5) + epleyPR(320, 3) + epleyPR(415, 1));
  });

  test('one lift with an extra newer cycle does not mix into the total', () => {
    // Bench is logged again on Wednesday with no matching squat/deadlift. The only
    // COMPLETE Big-3 cycle is Monday, so the total must use Monday's bench (225),
    // never pairing Wednesday's bench with Monday's squat/deadlift.
    const note = 'Monday\n-Bench\n225 5\n-Squat\n315 3\n-Deadlift\n405 1\n'
               + 'Wednesday\n-Bench\n235 5';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, SEL);
    const series = derive1kTotalSeries(sections, SEL);
    expect(result.bench).toBeCloseTo(epleyPR(225, 5)); // Monday, NOT 235 (Wednesday)
    expect(result.total).toBeCloseTo(epleyPR(225, 5) + epleyPR(315, 3) + epleyPR(405, 1));
    expect(result.total).toBeCloseTo(series[series.length - 1].total);
  });
});

// ── parseWeightEntry ──────────────────────────────────────────────────────────

describe('parseWeightEntry', () => {
  test('accepts plain integer', () => {
    const r = parseWeightEntry('180');
    expect(r.ok).toBe(true);
    expect(r.weight_value).toBe(180);
    expect(r.weight_unit).toBe('lb');
    expect(typeof r.logged_at).toBe('string');
  });

  test('accepts decimal', () => {
    const r = parseWeightEntry('180.4');
    expect(r.ok).toBe(true);
    expect(r.weight_value).toBe(180.4);
  });

  test('accepts surrounding whitespace', () => {
    const r = parseWeightEntry('  180  ');
    expect(r.ok).toBe(true);
    expect(r.weight_value).toBe(180);
  });

  test('rejects empty string', () => {
    const r = parseWeightEntry('');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('missing_required_field');
  });

  test('rejects null', () => {
    const r = parseWeightEntry(null);
    expect(r.ok).toBe(false);
    expect(r.category).toBe('missing_required_field');
  });

  test('rejects whitespace-only string', () => {
    const r = parseWeightEntry('   ');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('missing_required_field');
  });

  test('rejects unit suffix', () => {
    const r = parseWeightEntry('180lbs');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
    expect(r.error).toMatch(/number only/i);
  });

  test('rejects sign prefix', () => {
    const r = parseWeightEntry('+180');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
  });

  test('rejects negative', () => {
    const r = parseWeightEntry('-5');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
  });

  test('rejects zero', () => {
    const r = parseWeightEntry('0');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
  });

  test('rejects prose', () => {
    const r = parseWeightEntry('one eighty');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
  });

  test('rejects comma-formatted number', () => {
    const r = parseWeightEntry('1,80');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
  });
});

// ── parseWorkoutRow ───────────────────────────────────────────────────────────

describe('parseWorkoutRow', () => {
  test('blank input is ok+blank', () => {
    expect(parseWorkoutRow('')).toMatchObject({ ok: true, blank: true });
  });

  test('null input is ok+blank', () => {
    expect(parseWorkoutRow(null)).toMatchObject({ ok: true, blank: true });
  });

  test('dash is ok+skipped', () => {
    expect(parseWorkoutRow('-')).toMatchObject({ ok: true, skipped: true });
  });

  test('standalone rep-group with comma', () => {
    const r = parseWorkoutRow('8,8,8');
    expect(r.ok).toBe(true);
    expect(r.sets).toHaveLength(3);
    expect(r.sets.every(s => s.weight_value === null)).toBe(true);
    expect(r.sets[0].rep_count).toBe(8);
  });

  test('rejects single integer — ambiguous with load', () => {
    const r = parseWorkoutRow('8');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
  });

  test('weight + single-rep group', () => {
    const r = parseWorkoutRow('135 5');
    expect(r.ok).toBe(true);
    expect(r.sets).toHaveLength(1);
    expect(r.sets[0].weight_value).toBe(135);
    expect(r.sets[0].weight_unit).toBe('lb');
    expect(r.sets[0].rep_count).toBe(5);
  });

  test('weight + multi-rep group', () => {
    const r = parseWorkoutRow('135 8,8,8');
    expect(r.ok).toBe(true);
    expect(r.sets).toHaveLength(3);
    expect(r.sets.every(s => s.weight_value === 135)).toBe(true);
  });

  test('multiple weight/rep pairs', () => {
    const r = parseWorkoutRow('135 5,5 145 3,3');
    expect(r.ok).toBe(true);
    expect(r.sets).toHaveLength(4);
    expect(r.sets[0].weight_value).toBe(135);
    expect(r.sets[2].weight_value).toBe(145);
  });

  test('decimal load', () => {
    const r = parseWorkoutRow('67.5 6,6');
    expect(r.ok).toBe(true);
    expect(r.sets[0].weight_value).toBe(67.5);
  });

  test('normalizes spaces around commas', () => {
    const r = parseWorkoutRow('135 8, 8, 8');
    expect(r.ok).toBe(true);
    expect(r.sets).toHaveLength(3);
  });

  test('rejects weight with no following reps', () => {
    const r = parseWorkoutRow('135');
    expect(r.ok).toBe(false);
  });

  test('rejects zero weight', () => {
    const r = parseWorkoutRow('0 8,8');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
  });

  test('rejects zero reps', () => {
    const r = parseWorkoutRow('135 0,8');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('invalid_field_value');
  });

  test('set_index increments across pairs', () => {
    const r = parseWorkoutRow('100 3,3 110 2');
    expect(r.ok).toBe(true);
    expect(r.sets.map(s => s.set_index)).toEqual([1, 2, 3]);
  });
});

// ── parseWorkoutEntry ─────────────────────────────────────────────────────────

describe('parseWorkoutEntry', () => {
  test('returns ok with canonical fields for valid items', () => {
    const items = [
      { exerciseName: 'Squat', raw: '135 5,5,5' },
      { exerciseName: 'Deadlift', raw: '225 5' },
    ];
    const r = parseWorkoutEntry(items, '2026-05-09');
    expect(r.ok).toBe(true);
    expect(r.workout_date).toBe('2026-05-09');
    expect(r.items).toHaveLength(2);
  });

  test('item has canonical shape', () => {
    const r = parseWorkoutEntry([{ exerciseName: 'Squat', raw: '135 5,5,5' }], '2026-05-09');
    const item = r.items[0];
    expect(item).toMatchObject({
      exercise_name: 'Squat',
      result_kind: 'sets',
      note_text: null,
      position: 1,
    });
    expect(Array.isArray(item.sets)).toBe(true);
  });

  test('set has canonical shape', () => {
    const r = parseWorkoutEntry([{ exerciseName: 'Squat', raw: '135 5,5' }], '2026-05-09');
    const set = r.items[0].sets[0];
    expect(set).toMatchObject({
      rep_count: 5,
      weight_value: 135,
      weight_unit: 'lb',
      duration_seconds: null,
      assistance_value: null,
      assistance_unit: null,
      note_text: null,
    });
    expect(typeof set.set_index).toBe('number');
  });

  test('skips blank rows', () => {
    const items = [
      { exerciseName: 'Squat', raw: '135 5,5' },
      { exerciseName: 'Bench', raw: '' },
      { exerciseName: 'Deadlift', raw: '-' },
    ];
    const r = parseWorkoutEntry(items, '2026-05-09');
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(1);
  });

  test('fails structural_violation when all items are blank', () => {
    const r = parseWorkoutEntry(
      [{ exerciseName: 'Squat', raw: '' }, { exerciseName: 'Bench', raw: '-' }],
      '2026-05-09',
    );
    expect(r.ok).toBe(false);
    expect(r.category).toBe('structural_violation');
  });

  test('returns row errors for invalid input', () => {
    const items = [
      { exerciseName: 'Squat', raw: '135 5,5' },
      { exerciseName: 'Bench', raw: 'bad input' },
    ];
    const r = parseWorkoutEntry(items, '2026-05-09');
    expect(r.ok).toBe(false);
    expect(r.rowErrors).toHaveLength(1);
    expect(r.rowErrors[0].exerciseName).toBe('Bench');
  });

  test('position increments across included items', () => {
    const items = [
      { exerciseName: 'A', raw: '100 5' },
      { exerciseName: 'B', raw: '-' },
      { exerciseName: 'C', raw: '200 3' },
    ];
    const r = parseWorkoutEntry(items, '2026-05-09');
    expect(r.items[0].position).toBe(1);
    expect(r.items[1].position).toBe(2);
  });

  test('defaults workout_date to today when not supplied', () => {
    const r = parseWorkoutEntry([{ exerciseName: 'Squat', raw: '135 5' }]);
    expect(r.ok).toBe(true);
    expect(typeof r.workout_date).toBe('string');
    expect(r.workout_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── UI Error Message Verification ─────────────────────────────────────────────

describe('UI Error Message Verification', () => {
  test('WeightScreen: empty input error', () => {
    const r = parseWeightEntry('');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Weight is required');
  });

  test('WeightScreen: invalid number error', () => {
    const r = parseWeightEntry('abc');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Enter a number only/);
  });

  test('LogScreen: invalid workout row error', () => {
    const items = [{ exerciseName: 'Squat', raw: '135 x 5' }];
    const r = parseWorkoutEntry(items);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid reps "x"/);
  });

  test('LogScreen: missing reps error', () => {
    const items = [{ exerciseName: 'Squat', raw: '135' }];
    const r = parseWorkoutEntry(items);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Enter reps as reps,reps or weight reps,reps');
  });
});

// ── parseWorkoutNote ──────────────────────────────────────────────────────────

describe('parseWorkoutNote — basics', () => {
  test('empty string returns ok with no sections', () => {
    const r = parseWorkoutNote('');
    expect(r.ok).toBe(true);
    expect(r.sections).toHaveLength(0);
  });

  test('null returns ok with no sections', () => {
    const r = parseWorkoutNote(null);
    expect(r.ok).toBe(true);
    expect(r.sections).toHaveLength(0);
  });

  test('whitespace-only returns ok with no sections', () => {
    expect(parseWorkoutNote('   \n  \n')).toMatchObject({ ok: true, sections: [] });
  });

  test('always returns ok:true regardless of content', () => {
    const r = parseWorkoutNote('gibberish line\nmore garbage ???\n!@#$%');
    expect(r.ok).toBe(true);
  });
});

describe('parseWorkoutNote — day headings', () => {
  test('detects weekday heading', () => {
    const r = parseWorkoutNote('Monday\n-Squat 4x6-8\n135 5,5');
    expect(r.sections[0].heading).toBe('Monday');
  });

  test('detects weekday with description (em-dash)', () => {
    const r = parseWorkoutNote('Monday — Push\n-Bench 3x8\n135 8,8,8');
    expect(r.sections[0].heading).toBe('Monday — Push');
  });

  test('detects weekday with description (en-dash)', () => {
    const r = parseWorkoutNote('Tuesday – Lower Squat Focus\n-Squat 3x8\n205 8,8,8');
    expect(r.sections[0].heading).toBe('Tuesday – Lower Squat Focus');
  });

  test('all-caps weekday detected', () => {
    const r = parseWorkoutNote('WEDNESDAY — Pull / Back\n-Row 3x8\n80 8,8,8');
    expect(r.sections[0].heading).toMatch(/^WEDNESDAY/);
  });

  test('multiple day headings produce separate sections', () => {
    const note = 'Monday\n-Bench 3x8\n135 8,8,8\nTuesday\n-Squat 3x8\n205 8,8,8';
    const r = parseWorkoutNote(note);
    const headings = r.sections.map(s => s.heading);
    expect(headings).toContain('Monday');
    expect(headings).toContain('Tuesday');
  });
});

describe('parseWorkoutNote — section headings', () => {
  test('+ prefix creates subheading', () => {
    const r = parseWorkoutNote('+WARMUP EXERCISE\n-Bike\n5 min 9');
    expect(r.sections[0].subheading).toBe('WARMUP EXERCISE');
  });

  test('warmup section gets kind=warmup', () => {
    const r = parseWorkoutNote('+WARMUP EXERCISE\n-Bike');
    expect(r.sections[0].kind).toBe('warmup');
  });

  test('lifting section gets kind=lifting', () => {
    const r = parseWorkoutNote('+LIFTING (~30 min) EXERCISE\n-Bench 3x8\n135 8,8,8');
    expect(r.sections[0].kind).toBe('lifting');
  });

  test('unknown section heading gets kind=general', () => {
    const r = parseWorkoutNote('+COOLDOWN\n-Stretch');
    expect(r.sections[0].kind).toBe('general');
  });

  test('day + section heading combo', () => {
    const r = parseWorkoutNote('Monday\n+WARMUP EXERCISE\n-Bike\n5 min 9');
    expect(r.sections[0].heading).toBe('Monday');
    expect(r.sections[0].subheading).toBe('WARMUP EXERCISE');
    expect(r.sections[0].kind).toBe('warmup');
  });
});

describe('parseWorkoutNote — exercise declarations', () => {
  test('dash-prefix exercise is detected', () => {
    const r = parseWorkoutNote('-DB Bench Press 4x6-8\n80 8,8,8,8');
    expect(r.sections[0].exercises[0].name).toBe('DB Bench Press');
  });

  test('dash-prefix exercise raw_header preserved', () => {
    const r = parseWorkoutNote('-DB Bench Press 4x6-8\n80 8,8,8,8');
    expect(r.sections[0].exercises[0].raw_header).toBe('-DB Bench Press 4x6-8');
  });

  test('numbered exercise (integer) is detected', () => {
    const r = parseWorkoutNote('1. DB Bench Press: 3x6-8 @80 lb | Rest 90 sec\n80 8,8,8');
    expect(r.sections[0].exercises[0].name).toBe('DB Bench Press');
  });

  test('numbered exercise with letter suffix (e.g. 2a) is detected', () => {
    const r = parseWorkoutNote('2a. Angled Leg Press: 2x10-12 @200 lb | Controlled\n200 12,12');
    expect(r.sections[0].exercises[0].name).toBe('Angled Leg Press');
  });

  test('Core: prefix exercise is detected', () => {
    const r = parseWorkoutNote('Core: In-and-outs on bench * 2x10-12\n12,12,12');
    expect(r.sections[0].exercises[0].name).toBe('Core: In-and-outs on bench');
  });

  test('Core: exercise has correct raw_header', () => {
    const r = parseWorkoutNote('Core: Plank * 2x30-45 sec\n30,30');
    expect(r.sections[0].exercises[0].raw_header).toBe('Core: Plank * 2x30-45 sec');
  });

  test('exercise with * annotation stripped from name', () => {
    const r = parseWorkoutNote('-Low-to-High Cable Fly * no PO needed 2x12\n12.5 12,12');
    expect(r.sections[0].exercises[0].name).toBe('Low-to-High Cable Fly');
  });

  test('exercise with "N sets repRange" spec stripped', () => {
    const r = parseWorkoutNote('-Hammer Curl 2 8-10\n25 10,10');
    expect(r.sections[0].exercises[0].name).toBe('Hammer Curl');
  });

  test('exercise with @weight suffix stripped', () => {
    const r = parseWorkoutNote('1. Lateral Raise: 3x12-15 @15 lb | notes\n15 12,12,12');
    expect(r.sections[0].exercises[0].name).toBe('Lateral Raise');
  });

  test('multiple exercises within one section', () => {
    const note = '-Bench 3x8\n80 8,8,8\n-Fly 2x12\n12.5 12,12';
    const r = parseWorkoutNote(note);
    expect(r.sections[0].exercises).toHaveLength(2);
    expect(r.sections[0].exercises[0].name).toBe('Bench');
    expect(r.sections[0].exercises[1].name).toBe('Fly');
  });
});

describe('parseWorkoutNote — deload format', () => {
  test('deload exercise parsed into correct sets', () => {
    const r = parseWorkoutNote('DB Bench: 60 lbs 3x8');
    const ex = r.sections[0].exercises[0];
    expect(ex.name).toBe('DB Bench');
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]).toMatchObject({ weight_value: 60, weight_unit: 'lb', rep_count: 8 });
  });

  test('deload set_index increments', () => {
    const r = parseWorkoutNote('Squat: 155 lbs 3x8');
    const sets = r.sections[0].exercises[0].sets;
    expect(sets.map(s => s.set_index)).toEqual([1, 2, 3]);
  });

  test('deload exercise has one row entry', () => {
    const r = parseWorkoutNote('Deadlift: 205 lbs 3x4');
    expect(r.sections[0].exercises[0].rows).toHaveLength(1);
  });

  test('multiple deload exercises in sequence', () => {
    const note = 'Monday — Push\nDB Bench: 60 lbs 3x8\nCable Fly: 12.5 lbs 2x12\nLateral Raise: 15 lbs 2x12';
    const r = parseWorkoutNote(note);
    expect(r.sections[0].exercises).toHaveLength(3);
    expect(r.sections[0].exercises[1].name).toBe('Cable Fly');
  });

  test('deload sets have canonical shape', () => {
    const r = parseWorkoutNote('Squat: 155 lbs 3x8');
    const set = r.sections[0].exercises[0].sets[0];
    expect(set).toMatchObject({
      set_index: 1,
      rep_count: 8,
      weight_value: 155,
      weight_unit: 'lb',
      duration_seconds: null,
      assistance_value: null,
      assistance_unit: null,
      note_text: null,
    });
  });
});

describe('parseWorkoutNote — set row parsing', () => {
  test('standard weight+reps row parses into sets', () => {
    const r = parseWorkoutNote('-Bench\n80 8,8,8,8');
    expect(r.sections[0].exercises[0].sets).toHaveLength(4);
    expect(r.sections[0].exercises[0].sets[0]).toMatchObject({ weight_value: 80, rep_count: 8 });
  });

  test('multi-weight row (backoff sets) parses all sets', () => {
    const r = parseWorkoutNote('-Bench\n85 8 80 8,8,8');
    const sets = r.sections[0].exercises[0].sets;
    expect(sets).toHaveLength(4);
    expect(sets[0]).toMatchObject({ weight_value: 85, rep_count: 8 });
    expect(sets[1]).toMatchObject({ weight_value: 80, rep_count: 8 });
  });

  test('rep-only row (no weight) parses correctly', () => {
    const r = parseWorkoutNote('Core: Plank 2x30\n30,30,30');
    const sets = r.sections[0].exercises[0].sets;
    expect(sets).toHaveLength(3);
    expect(sets[0].weight_value).toBeNull();
    expect(sets[0].rep_count).toBe(30);
  });

  test('each row becomes a separate entry in rows[]', () => {
    const r = parseWorkoutNote('-Bench\n80 8,8,8\n85 8,8,8\n90 8,8,8');
    expect(r.sections[0].exercises[0].rows).toHaveLength(3);
  });

  test('set_index increments continuously across rows', () => {
    const r = parseWorkoutNote('-Bench\n80 8,8\n85 8,8');
    const sets = r.sections[0].exercises[0].sets;
    expect(sets.map(s => s.set_index)).toEqual([1, 2, 3, 4]);
  });

  test('sets flat array equals union of all row sets', () => {
    const r = parseWorkoutNote('-Squat\n205 8,8,8\n215 8,8,8');
    const ex = r.sections[0].exercises[0];
    const fromRows = ex.rows.flatMap(row => row.sets);
    expect(ex.sets).toEqual(fromRows);
  });

  test('blank lines within exercise context are ignored', () => {
    const r = parseWorkoutNote('-Bench\n80 8,8,8\n\n85 8,8,8');
    expect(r.sections[0].exercises[0].rows).toHaveLength(2);
  });

  test('bare dash within exercise context does not add to rows', () => {
    const r = parseWorkoutNote('-Bench\n80 8,8,8\n-\n85 8,8,8');
    expect(r.sections[0].exercises[0].rows).toHaveLength(2);
  });

  test('bare dash within exercise context adds a skip slot to session_entries', () => {
    const r = parseWorkoutNote('-Bench\n80 8,8,8\n-\n85 8,8,8');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries.some(e => e.skipped)).toBe(true);
  });

  test('decimal weight parses correctly', () => {
    const r = parseWorkoutNote('-Fly\n12.5 12,12');
    expect(r.sections[0].exercises[0].sets[0].weight_value).toBe(12.5);
  });
});

describe('parseWorkoutNote — graceful degradation', () => {
  test('unparseable row goes to unparsed_rows, not sets', () => {
    const r = parseWorkoutNote('-Bike\n5 min 9');
    const ex = r.sections[0].exercises[0];
    expect(ex.sets).toHaveLength(0);
    expect(ex.unparsed_rows).toContain('5 min 9');
  });

  test('assisted pull-up notation goes to unparsed_rows', () => {
    const r = parseWorkoutNote('-Pull-Up\nas55 8,8,8');
    expect(r.sections[0].exercises[0].unparsed_rows).toContain('as55 8,8,8');
  });

  test('double-dash lines go to unparsed_rows', () => {
    const r = parseWorkoutNote('-Core: Plank\n30,30\n-- crunch machine 50 12');
    expect(r.sections[0].exercises[0].unparsed_rows).toContain('-- crunch machine 50 12');
  });

  test('prose note in exercise context goes to unparsed_rows', () => {
    const r = parseWorkoutNote('-Leg Press\n260 12,12\nCalf raises at end of each set');
    // "Calf raises at end of each set" has no dash prefix - it's ambient text in exercise context
    // Actually it would hit unparsed_rows since parseWorkoutRow fails on it
    const ex = r.sections[0].exercises[0];
    expect(ex.unparsed_rows.some(l => l.includes('Calf raises'))).toBe(true);
  });

  test('mixed parseable and unparseable rows accumulate correctly', () => {
    const r = parseWorkoutNote('-Bench\n80 8,8,8\nas90 8,8,8\n90 8,8,8');
    const ex = r.sections[0].exercises[0];
    expect(ex.sets).toHaveLength(6); // two parseable rows × 3 sets each
    expect(ex.unparsed_rows).toContain('as90 8,8,8');
  });

  test('ambient text before any exercise is silently dropped', () => {
    const r = parseWorkoutNote('Some preamble text\nAnother line\n-Bench\n80 8,8,8');
    expect(r.sections[0].exercises[0].name).toBe('Bench');
    expect(r.sections[0].exercises[0].sets).toHaveLength(3);
  });

  test('exercise with only unparseable rows still appears in exercises list', () => {
    const r = parseWorkoutNote('-Bike\n5 min 9\n10\n6\n7');
    expect(r.sections[0].exercises).toHaveLength(1);
    expect(r.sections[0].exercises[0].sets).toHaveLength(0);
    expect(r.sections[0].exercises[0].unparsed_rows.length).toBeGreaterThan(0);
  });
});

describe('parseWorkoutNote — sample file patterns', () => {
  test('current_workout style: day + section + dash exercises', () => {
    const note = [
      'Monday',
      '+WARMUP EXERCISE',
      '-Bike',
      '5 min 9',
      '10',
      '+LIFTING  (~30 min) EXERCISE',
      '-DB Bench Press 4x6-8',
      '80 8,8,8,8',
      '85 8 80 8,8,8',
      '-Low-to-High Cable Fly * no PO needed 2x12',
      '12.5 12,12',
      '12.5 12,12',
    ].join('\n');

    const r = parseWorkoutNote(note);
    expect(r.ok).toBe(true);

    const headings = r.sections.map(s => s.heading);
    expect(headings.every(h => h === 'Monday')).toBe(true);

    const warmup = r.sections.find(s => s.kind === 'warmup');
    expect(warmup.exercises[0].name).toBe('Bike');

    const lifting = r.sections.find(s => s.kind === 'lifting');
    expect(lifting.exercises[0].name).toBe('DB Bench Press');
    expect(lifting.exercises[0].sets).toHaveLength(8); // 4 sets + (1+3) sets from two rows
    expect(lifting.exercises[1].name).toBe('Low-to-High Cable Fly');
  });

  test('previous_workout style: numbered exercises', () => {
    const note = [
      'Monday – Upper Push',
      '1. DB Bench Press: 3x6-8 @80 lb | Controlled descent | Rest 90 sec',
      '80 8,8,8',
      '85 8,8,7',
      '2. Low-to-High Cable Fly: 3x10-12 @20 lb | TUT focus | Rest 60 sec',
      '12.5 10,10,10',
    ].join('\n');

    const r = parseWorkoutNote(note);
    expect(r.ok).toBe(true);
    expect(r.sections[0].heading).toBe('Monday – Upper Push');
    expect(r.sections[0].exercises[0].name).toBe('DB Bench Press');
    expect(r.sections[0].exercises[0].rows).toHaveLength(2);
    expect(r.sections[0].exercises[0].sets).toHaveLength(6);
    expect(r.sections[0].exercises[1].name).toBe('Low-to-High Cable Fly');
  });

  test('latest_deload style: single-line exercise summaries', () => {
    const note = [
      'Monday — Push',
      'DB Bench: 60 lbs 3x8',
      'Cable Fly: 12.5 lbs 2x12',
      'Lateral Raise: 15 lbs 2x12',
      'Hammer Curl: 25 lbs 2x10',
      'Single-Arm Pushdown: 15.5 lbs 2x10',
    ].join('\n');

    const r = parseWorkoutNote(note);
    expect(r.ok).toBe(true);
    expect(r.sections[0].heading).toBe('Monday — Push');
    expect(r.sections[0].exercises).toHaveLength(5);
    expect(r.sections[0].exercises[0].name).toBe('DB Bench');
    expect(r.sections[0].exercises[0].sets).toHaveLength(3);
    expect(r.sections[0].exercises[2].name).toBe('Lateral Raise');
    expect(r.sections[0].exercises[2].sets).toHaveLength(2);
  });

  test('multi-day note splits into per-day sections', () => {
    const note = [
      'Monday — Push',
      'DB Bench: 60 lbs 3x8',
      'Tuesday — Squat',
      'Squat: 155 lbs 3x8',
      'Wednesday — Pull',
      'Hammer Strength Row: 70 lbs 3x8',
    ].join('\n');

    const r = parseWorkoutNote(note);
    const days = [...new Set(r.sections.map(s => s.heading))];
    expect(days).toContain('Monday — Push');
    expect(days).toContain('Tuesday — Squat');
    expect(days).toContain('Wednesday — Pull');
  });

  test('treadmill rows do not produce weighted sets', () => {
    const r = parseWorkoutNote('0. Treadmill\n7.2 5');
    const ex = r.sections[0].exercises[0];
    expect(ex.name).toBe('Treadmill');
    expect(ex.sets).toHaveLength(0);
    expect(ex.unparsed_rows).toContain('7.2 5');
  });

  test('previous_workout treadmill block degrades fully to unparsed_rows', () => {
    const note = [
      'Monday – Upper Push',
      '0. Treadmill',
      '7.1 for 5',
      '7.2 5',
      '7.3 5',
      '7.4 5',
      '7.5 5',
      '7.6 3, 7.5 2',
      '7.7 3, 7.6 2',
      '77 5',
      '7.8 3, 7.7 2',
      '7.8 5',
      '1. DB Bench Press: 3x6-8 @80 lb | Controlled descent | Rest 90 sec',
      '80 8,8,8',
      '85 8,8,6',
    ].join('\n');

    const r = parseWorkoutNote(note);
    expect(r.ok).toBe(true);

    const treadmill = r.sections[0].exercises.find(e => e.name === 'Treadmill');
    expect(treadmill).toBeDefined();
    expect(treadmill.sets).toHaveLength(0);
    expect(treadmill.unparsed_rows.length).toBeGreaterThan(0);
    // no treadmill speed should appear as a weight_value on any set across the note
    const allSets = r.sections.flatMap(s => s.exercises.flatMap(e => e.sets));
    const treadmillSpeeds = allSets.filter(s => s.weight_value !== null && s.weight_value < 10);
    expect(treadmillSpeeds).toHaveLength(0);

    const bench = r.sections[0].exercises.find(e => e.name === 'DB Bench Press');
    expect(bench).toBeDefined();
    expect(bench.sets).toHaveLength(6);
  });

  test('Core: exercise with rep-only rows', () => {
    const note = [
      '-Squat 4x6-8',
      '205 8,8,8,8',
      'Core: Plank * 2x30-45 sec',
      '30,30',
      '32,32',
    ].join('\n');

    const r = parseWorkoutNote(note);
    const plank = r.sections[0].exercises.find(e => e.name === 'Core: Plank');
    expect(plank).toBeDefined();
    expect(plank.sets).toHaveLength(4);
    expect(plank.sets[0].weight_value).toBeNull();
    expect(plank.sets[0].rep_count).toBe(30);
  });
});

// ── deriveProgressionSignals ──────────────────────────────────────────────────

describe('deriveProgressionSignals — output shape', () => {
  test('returns exercises array', () => {
    const { sections } = parseWorkoutNote('Monday\n-Bench\n80 8');
    const result = deriveProgressionSignals(sections, ['Bench']);
    expect(Array.isArray(result.exercises)).toBe(true);
  });

  test('each entry has required fields', () => {
    const { sections } = parseWorkoutNote('Monday\n-Bench\n80 8');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig).toHaveProperty('name', 'Bench');
    expect(sig).toHaveProperty('progression_status');
    expect(sig).toHaveProperty('latest_pr');
    expect(sig).toHaveProperty('prior_pr');
    expect(sig).toHaveProperty('repeatability_score');
  });

  test('returns one entry per unique tracked name in order', () => {
    const { sections } = parseWorkoutNote('Monday\n-Bench\n80 8\n-Squat\n205 5');
    const result = deriveProgressionSignals(sections, ['Bench', 'Squat']);
    expect(result.exercises.map(e => e.name)).toEqual(['Bench', 'Squat']);
  });

  test('absent exercise returns null status and nulls', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8');
    const sig = deriveProgressionSignals(sections, ['Squat']).exercises[0];
    expect(sig.progression_status).toBeNull();
    expect(sig.latest_pr).toBeNull();
    expect(sig.prior_pr).toBeNull();
    expect(sig.repeatability_score).toBeNull();
  });

  test('empty trackedNames returns empty exercises array', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8');
    expect(deriveProgressionSignals(sections, []).exercises).toHaveLength(0);
  });

  test('empty sections returns null status for all names', () => {
    const result = deriveProgressionSignals([], ['Bench', 'Squat']);
    expect(result.exercises.every(e => e.progression_status === null)).toBe(true);
  });
});

describe('deriveProgressionSignals — progression status', () => {
  test('first_session when exercise has only one occurrence', () => {
    const { sections } = parseWorkoutNote('Monday\n-Bench\n80 8');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.progression_status).toBe('first_session');
    expect(sig.latest_pr).toBeCloseTo(epleyPR(80, 8));
    expect(sig.prior_pr).toBeNull();
  });

  test('improved when latest occurrence PR exceeds prior', () => {
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n90 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.progression_status).toBe('improved');
    expect(sig.latest_pr).toBeCloseTo(epleyPR(90, 8));
    expect(sig.prior_pr).toBeCloseTo(epleyPR(80, 8));
  });

  test('regressed when latest occurrence PR is below prior', () => {
    const note = 'Monday\n-Bench\n90 8\nWednesday\n-Bench\n80 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.progression_status).toBe('regressed');
    expect(sig.latest_pr).toBeCloseTo(epleyPR(80, 8));
    expect(sig.prior_pr).toBeCloseTo(epleyPR(90, 8));
  });

  test('held when latest and prior PRs are equal', () => {
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n80 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.progression_status).toBe('held');
    expect(sig.latest_pr).toBeCloseTo(sig.prior_pr);
  });

  test('compares latest two occurrences, not total best', () => {
    // PR peaked on Wednesday, then regressed Friday — status should be regressed
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n100 8\nFriday\n-Bench\n90 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.progression_status).toBe('regressed');
    expect(sig.prior_pr).toBeCloseTo(epleyPR(100, 8));
  });

  test('rep-based fallback for bodyweight exercise with no weight_value', () => {
    const { sections } = parseWorkoutNote('Core: Plank\n30,30');
    const sig = deriveProgressionSignals(sections, ['Core: Plank']).exercises[0];
    // Single session → first_session status, no PR, best set reps surfaced as latest_top_weight
    expect(sig.progression_status).toBe('first_session');
    expect(sig.latest_pr).toBeNull();
    expect(sig.latest_top_weight).toBe(30);
    expect(sig.is_bodyweight).toBe(true);
  });

  test('non-comparable latest occurrence — walks back to most recent comparable', () => {
    // Monday has a weighted set; Wednesday has only rep-only rows (no weight → PR null).
    // latest comparable = Monday → first_session, not null.
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n8,8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.progression_status).toBe('first_session');
    expect(sig.latest_pr).toBeCloseTo(epleyPR(80, 8));
    expect(sig.prior_pr).toBeNull();
  });

  test('non-comparable latest with two prior weighted occurrences returns correct status', () => {
    // Monday 80 8, Wednesday 90 8, Friday 8,8 (rep-only) → latest comparable = Wednesday → improved
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n90 8\nFriday\n-Bench\n8,8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.progression_status).toBe('improved');
    expect(sig.latest_pr).toBeCloseTo(epleyPR(90, 8));
    expect(sig.prior_pr).toBeCloseTo(epleyPR(80, 8));
  });
});

describe('deriveProgressionSignals — kilo_max, latest_top_weight, overload_trend', () => {
  test('kilo_max equals all-time best Epley, not just latest session', () => {
    // Monday: 100 8 (best ever); Wednesday: 90 8 (regression)
    const note = 'Monday\n-Bench\n100 8\nWednesday\n-Bench\n90 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.kilo_max).toBeCloseTo(epleyPR(100, 8));
    expect(sig.latest_pr).toBeCloseTo(epleyPR(90, 8));
    // kilo_max exceeds latest_pr when the note contains a historical best
    expect(sig.kilo_max).toBeGreaterThan(sig.latest_pr);
  });

  test('kilo_max equals latest_pr on first session', () => {
    const { sections } = parseWorkoutNote('Monday\n-Bench\n80 8');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.kilo_max).toBeCloseTo(epleyPR(80, 8));
    expect(sig.kilo_max).toBeCloseTo(sig.latest_pr);
  });

  test('kilo_max is null for absent exercise', () => {
    const { sections } = parseWorkoutNote('-Bench\n80 8');
    const sig = deriveProgressionSignals(sections, ['Squat']).exercises[0];
    expect(sig.kilo_max).toBeNull();
  });

  test('latest_top_weight is highest weight_value in latest occurrence', () => {
    // Two sets at different weights — top should be 90
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n85 6 90 4';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.latest_top_weight).toBe(90);
  });

  test('latest_top_weight reflects latest occurrence only, not historical max', () => {
    // Peak weight was on Monday; Wednesday is lighter
    const note = 'Monday\n-Bench\n100 6\nWednesday\n-Bench\n80 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.latest_top_weight).toBe(80);
  });

  test('latest_top_weight is null for weighted exercise with no weight value (absent)', () => {
    // Plain-row bench with no weight parses as bodyweight → rep fallback → best set reps
    const { sections } = parseWorkoutNote('-Bench\n8,8,8');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.is_bodyweight).toBe(true);
    expect(sig.latest_top_weight).toBe(8);
  });

  test('overload_trend is first_session on single occurrence', () => {
    const { sections } = parseWorkoutNote('Monday\n-Bench\n80 8');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.overload_trend).toBe('first_session');
  });

  test('multi-row plain-row block treats each row as a separate session', () => {
    // Each plain row is one logged workout day. Two rows = two comparables; the
    // second row (90 lb) is heavier than the first (80 lb) → 'up' trend.
    const { sections } = parseWorkoutNote('-Bench\n80 8\n90 6');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.overload_trend).toBe('up');
    expect(sig.progression_status).toBe('improved');
  });

  test('overload_trend up when latest top weight exceeds prior', () => {
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n90 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.overload_trend).toBe('up');
  });

  test('overload_trend down when latest top weight is below prior', () => {
    const note = 'Monday\n-Bench\n90 8\nWednesday\n-Bench\n80 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.overload_trend).toBe('down');
  });

  test('overload_trend down when same weight but fewer total reps', () => {
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n80 6';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.overload_trend).toBe('down');
  });

  test('overload_trend flat when same weight and same total reps', () => {
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n80 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.overload_trend).toBe('flat');
  });

  test('overload_trend up when same weight but more total reps', () => {
    const note = 'Monday\n-Bench\n80 6\nWednesday\n-Bench\n80 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.overload_trend).toBe('up');
  });

  test('overload_trend is first_session when prior occurrence has no weighted sets', () => {
    // Monday is rep-only (no computable PR) → priorIdx stays -1 → treated as first_session
    const note = 'Monday\n-Bench\n8,8\nWednesday\n-Bench\n80 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.overload_trend).toBe('first_session');
  });

  test('output shape includes all new fields', () => {
    const { sections } = parseWorkoutNote('Monday\n-Bench\n80 8');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig).toHaveProperty('kilo_max');
    expect(sig).toHaveProperty('latest_top_weight');
    expect(sig).toHaveProperty('overload_trend');
  });
});

// ── deriveProgressionSignals — single-block multi-session ─────────────────────

describe('deriveProgressionSignals — single-block multi-session entries', () => {
  test('improved: multi-session single block produces improved, not first_session', () => {
    // Two session entries under one exercise header → comparable via session_entries
    const note = '-Bench Press\n- 225 5,5,5\n- 235 5,5,5';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench Press']).exercises[0];
    expect(sig.progression_status).toBe('improved');
    expect(sig.latest_pr).toBeCloseTo(epleyPR(235, 5));
    expect(sig.prior_pr).toBeCloseTo(epleyPR(225, 5));
  });

  test('regressed: later session with lower weight produces regressed', () => {
    const note = '-Bench Press\n- 235 5,5,5\n- 225 5,5,5';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench Press']).exercises[0];
    expect(sig.progression_status).toBe('regressed');
  });

  test('held: same weight across sessions produces held', () => {
    const note = '-Bench Press\n- 225 5,5,5\n- 225 5,5,5';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench Press']).exercises[0];
    expect(sig.progression_status).toBe('held');
  });

  test('first_session: single session entry still produces first_session', () => {
    const note = '-Bench Press\n- 225 5,5,5';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench Press']).exercises[0];
    expect(sig.progression_status).toBe('first_session');
    expect(sig.overload_trend).toBe('first_session');
  });

  test('overload_trend up: top weight increases across sessions', () => {
    const note = '-Bench Press\n- 225 5,5,5\n- 235 3';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench Press']).exercises[0];
    expect(sig.overload_trend).toBe('up');
    expect(sig.latest_top_weight).toBe(235);
  });

  test('overload_trend down: top weight decreases across sessions', () => {
    const note = '-Bench Press\n- 235 5,5,5\n- 225 5,5,5';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench Press']).exercises[0];
    expect(sig.overload_trend).toBe('down');
  });

  test('compares latest two sessions, not total best, across many entries', () => {
    // Three sessions: 225 → 235 → 230; status should be regressed (vs prior 235)
    const note = '-Bench Press\n- 225 5,5,5\n- 235 5,5,5\n- 230 5,5,5';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench Press']).exercises[0];
    expect(sig.progression_status).toBe('regressed');
    expect(sig.prior_pr).toBeCloseTo(epleyPR(235, 5));
    expect(sig.latest_pr).toBeCloseTo(epleyPR(230, 5));
  });

  test('tracked name in lowercase resolves to title-case analytics entry (non-aliased exercise)', () => {
    // trackedLifts stores names lowercase; analytics stores them with original note casing.
    // _findExercise must match case-insensitively so non-aliased exercises are not silently dropped.
    const note = '-Hammer Curl\n- 35 10,10,10\n- 40 10,10,10';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['hammer curl']).exercises[0];
    expect(sig.latest_pr).not.toBeNull();
    expect(sig.progression_status).toBe('improved');
  });

  test('mixed-history: inline occurrence + session-entry occurrence both participate', () => {
    // Monday uses inline sets; Wednesday uses a session-entry line.
    // Both must participate so the comparison yields improved, not first_session.
    const note = 'Monday\n-Bench\n80 8\nWednesday\n-Bench\n- 90 8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.progression_status).toBe('improved');
    expect(sig.prior_pr).toBeCloseTo(epleyPR(80, 8));
    expect(sig.latest_pr).toBeCloseTo(epleyPR(90, 8));
    expect(sig.overload_trend).toBe('up');
  });
});

// ── parseWorkoutNote — session_entries ────────────────────────────────────────

describe('parseWorkoutNote — session_entries', () => {
  test('exercise has session_entries field', () => {
    const r = parseWorkoutNote('-Bench\n125 4,4,4');
    expect(r.sections[0].exercises[0]).toHaveProperty('session_entries');
    expect(Array.isArray(r.sections[0].exercises[0].session_entries)).toBe(true);
  });

  test('plain data rows create session_entries to preserve chronological order with skips', () => {
    const r = parseWorkoutNote('-Bench\n125 4,4,4\n125 5,5,5');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries).toHaveLength(2);
    expect(ex.session_entries[0].skipped).toBe(false);
    expect(ex.session_entries[1].skipped).toBe(false);
  });

  test('dash-space entry creates a session_entry with correct sets', () => {
    const r = parseWorkoutNote('-Bench\n- 125 4,4,4');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries).toHaveLength(1);
    expect(ex.session_entries[0].skipped).toBe(false);
    expect(ex.session_entries[0].sets).toHaveLength(3);
    expect(ex.session_entries[0].sets[0].weight_value).toBe(125);
    expect(ex.session_entries[0].sets[0].rep_count).toBe(4);
  });

  test('dash-space entry also goes into rows for backwards compat', () => {
    const r = parseWorkoutNote('-Bench\n- 125 4,4,4');
    expect(r.sections[0].exercises[0].rows).toHaveLength(1);
  });

  test('multiple dash-space entries produce aligned session_entries', () => {
    const r = parseWorkoutNote('-Bench\n- 125 4,4,4\n- 125 5,5,5');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries).toHaveLength(2);
    expect(ex.session_entries[0].sets[0].rep_count).toBe(4);
    expect(ex.session_entries[1].sets[0].rep_count).toBe(5);
  });

  test('bare dash creates a skipped session_entry', () => {
    const r = parseWorkoutNote('-Bench\n- 125 4,4,4\n-\n- 125 6,6,6');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries).toHaveLength(3);
    expect(ex.session_entries[1].skipped).toBe(true);
    expect(ex.session_entries[1].raw).toBe('-');
  });

  test('bare rows interleaved with bare dashes preserve chronological slot order in session_entries', () => {
    // Regression: bare logged rows were not added to session_entries, causing skip markers
    // to cluster before all logged rows instead of staying in their original positions.
    const r = parseWorkoutNote('-Squat\n135 5,5,5\n-\n225 5,5,5\n-\n315 5,5,5');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries).toHaveLength(5);
    expect(ex.session_entries[0].skipped).toBe(false);
    expect(ex.session_entries[0].sets[0].weight_value).toBe(135);
    expect(ex.session_entries[1].skipped).toBe(true);
    expect(ex.session_entries[2].skipped).toBe(false);
    expect(ex.session_entries[2].sets[0].weight_value).toBe(225);
    expect(ex.session_entries[3].skipped).toBe(true);
    expect(ex.session_entries[4].skipped).toBe(false);
    expect(ex.session_entries[4].sets[0].weight_value).toBe(315);
    // rows should still contain only the logged entries
    expect(ex.rows).toHaveLength(3);
  });

  test('bare dash outside exercise context is silently dropped', () => {
    const r = parseWorkoutNote('-\n-Bench\n- 125 4,4,4');
    expect(r.sections[0].exercises[0].session_entries).toHaveLength(1);
  });

  test('deload exercise has session_entries field', () => {
    const r = parseWorkoutNote('Squat: 155 lbs 3x8');
    expect(r.sections[0].exercises[0]).toHaveProperty('session_entries');
    expect(r.sections[0].exercises[0].session_entries).toHaveLength(0);
  });

  test('bare dash in non-weight exercise context records a skip slot', () => {
    const r = parseWorkoutNote('-Bike\n-\n- 5 min');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries).toHaveLength(2);
    expect(ex.session_entries[0].skipped).toBe(true);
  });

  test('warmup section and lifting section exercises both get session_entries', () => {
    const note = '+WARMUP\n-Bike\n- 5 min\n+LIFTING\n-Bench\n- 125 4,4,4';
    const r = parseWorkoutNote(note);
    const allExercises = r.sections.flatMap(s => s.exercises);
    const bench = allExercises.find(e => e.name === 'Bench');
    expect(bench.session_entries).toHaveLength(1);
  });

  test('day label does not reset session_entries on subsequent exercises', () => {
    const note = 'Monday\n-Bench\n- 125 4,4,4\n- 125 5,5,5\nFriday\n-Deadlift\n- 225 3,3,3\n- 225 4,4,4';
    const r = parseWorkoutNote(note);
    const sections = r.sections;
    const bench = sections[0].exercises.find(e => e.name === 'Bench');
    const deadlift = sections[1].exercises.find(e => e.name === 'Deadlift');
    expect(bench.session_entries).toHaveLength(2);
    expect(deadlift.session_entries).toHaveLength(2);
  });

  test('session entry with trailing *annotation parses sets correctly (not unparsed)', () => {
    // Common real-world annotation: user marks a PR with "* PR"
    const r = parseWorkoutNote('-Squat\n- 225 5,5,5 *PR');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries).toHaveLength(1);
    expect(ex.session_entries[0].unparsed).toBeFalsy();
    expect(ex.session_entries[0].sets).toHaveLength(3);
    expect(ex.session_entries[0].sets[0].weight_value).toBe(225);
    expect(ex.session_entries[0].sets[0].rep_count).toBe(5);
  });

  test('session entry with *annotation in multi-weight row parses all sets', () => {
    // "215 5 225 5,5,5 *top set" — annotation should not corrupt the sets
    const r = parseWorkoutNote('-Squat\n- 215 5 225 5,5,5 *top set');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries[0].unparsed).toBeFalsy();
    expect(ex.session_entries[0].sets).toHaveLength(4);
    expect(ex.session_entries[0].sets[3].weight_value).toBe(225);
  });

  test('multiple session entries: annotated and plain both produce parseable sets', () => {
    const r = parseWorkoutNote('-Squat\n- 225 5,5,5\n- 235 5,5,5 *PR');
    const ex = r.sections[0].exercises[0];
    expect(ex.session_entries).toHaveLength(2);
    expect(ex.session_entries[0].sets).toHaveLength(3);
    expect(ex.session_entries[1].unparsed).toBeFalsy();
    expect(ex.session_entries[1].sets).toHaveLength(3);
    expect(ex.session_entries[1].sets[0].weight_value).toBe(235);
  });
});

// ── buildSessionsFromNote ─────────────────────────────────────────────────────

describe('buildSessionsFromNote — deload and non-weight exercises', () => {
  test('mixed deload + session entries does not throw', () => {
    const note = 'Squat: 155 lbs 3x8\n-Bench\n- 125 4,4,4';
    expect(() => buildSessionsFromNote(note)).not.toThrow();
  });

  test('deload exercise is excluded from session building (no session_entries)', () => {
    const note = 'Squat: 155 lbs 3x8\n-Bench\n- 125 4,4,4';
    const r = buildSessionsFromNote(note);
    const names = r.sessions[0].entries.map(e => e.exercise_name);
    expect(names).not.toContain('Squat');
    expect(names).toContain('Bench');
  });

  test('non-weight exercise bare dash preserves session slot for cross-exercise alignment', () => {
    const note = '-Bike\n-\n- 5 min\n-Bench\n- 125 4,4,4\n- 125 5,5,5';
    const r = buildSessionsFromNote(note);
    expect(r.sessions).toHaveLength(2);
    const bike1 = r.sessions[0].entries.find(e => e.exercise_name === 'Bike');
    expect(bike1.entry.skipped).toBe(true);
    const bike2 = r.sessions[1].entries.find(e => e.exercise_name === 'Bike');
    expect(bike2.entry.skipped).toBe(false);
  });

  test('non-weight exercise with correct slot count does not produce a false warning', () => {
    const note = '-Bike\n-\n- 5 min\n-Bench\n- 125 4,4,4\n- 125 5,5,5';
    const r = buildSessionsFromNote(note);
    expect(r.warnings).toHaveLength(0);
  });
});

describe('buildSessionsFromNote — basics', () => {
  test('empty note returns no sessions and no warnings', () => {
    const r = buildSessionsFromNote('');
    expect(r.sessions).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  test('null returns no sessions', () => {
    const r = buildSessionsFromNote(null);
    expect(r.sessions).toHaveLength(0);
  });

  test('note with only plain rows creates sessions (bare rows now populate session_entries)', () => {
    const r = buildSessionsFromNote('-Bench\n125 4,4,4\n125 5,5,5');
    expect(r.sessions).toHaveLength(2);
  });

  test('returns ok sessions array and warnings array', () => {
    const r = buildSessionsFromNote('-Bench\n- 125 4,4,4');
    expect(Array.isArray(r.sessions)).toBe(true);
    expect(Array.isArray(r.warnings)).toBe(true);
  });
});

describe('buildSessionsFromNote — session construction', () => {
  test('two exercises with two entries each produce two sessions', () => {
    const note = '-Bench\n- 125 4,4,4\n- 125 5,5,5\n-Deadlift\n- 225 3,3\n- 225 4,4';
    const r = buildSessionsFromNote(note);
    expect(r.sessions).toHaveLength(2);
  });

  test('session_index starts at 1', () => {
    const r = buildSessionsFromNote('-Bench\n- 125 4,4,4');
    expect(r.sessions[0].session_index).toBe(1);
  });

  test('each session entry includes exercise_name and entry', () => {
    const r = buildSessionsFromNote('-Bench\n- 125 4,4,4\n-Deadlift\n- 225 3,3');
    const entry = r.sessions[0].entries[0];
    expect(entry).toHaveProperty('exercise_name');
    expect(entry).toHaveProperty('entry');
  });

  test('first session maps to first dash-space entries across exercises', () => {
    const note = '-Bench\n- 125 4,4,4\n- 125 5,5,5\n-Deadlift\n- 225 3,3\n- 225 4,4';
    const r = buildSessionsFromNote(note);
    const s1 = r.sessions[0];
    const bench = s1.entries.find(e => e.exercise_name === 'Bench');
    expect(bench.entry.sets[0].rep_count).toBe(4);
    const dl = s1.entries.find(e => e.exercise_name === 'Deadlift');
    expect(dl.entry.sets[0].weight_value).toBe(225);
  });

  test('second session maps to second dash-space entries', () => {
    const note = '-Bench\n- 125 4,4,4\n- 125 5,5,5\n-Deadlift\n- 225 3,3\n- 225 4,4';
    const r = buildSessionsFromNote(note);
    const bench2 = r.sessions[1].entries.find(e => e.exercise_name === 'Bench');
    expect(bench2.entry.sets[0].rep_count).toBe(5);
  });

  test('bare dash preserves session slot as skipped', () => {
    const note = '-Bench\n- 125 4,4,4\n-\n- 125 6,6,6\n-Deadlift\n- 225 3,3\n- 225 4,4\n- 225 5,5';
    const r = buildSessionsFromNote(note);
    expect(r.sessions).toHaveLength(3);
    const bench2 = r.sessions[1].entries.find(e => e.exercise_name === 'Bench');
    expect(bench2.entry.skipped).toBe(true);
  });

  test('warmup exercises and lifting exercises are in the same sessions', () => {
    const note = '+WARMUP\n-Bike\n- 5 min\n+LIFTING\n-Bench\n- 125 4,4,4';
    const r = buildSessionsFromNote(note);
    expect(r.sessions).toHaveLength(1);
    const names = r.sessions[0].entries.map(e => e.exercise_name);
    expect(names).toContain('Bench');
  });

  test('day labels do not split sessions', () => {
    const note = 'Monday\n-Bench\n- 125 4,4,4\n- 125 5,5,5\nFriday\n-Deadlift\n- 225 3,3\n- 225 4,4';
    const r = buildSessionsFromNote(note);
    expect(r.sessions).toHaveLength(2);
    const s1Names = r.sessions[0].entries.map(e => e.exercise_name);
    expect(s1Names).toContain('Bench');
    expect(s1Names).toContain('Deadlift');
  });
});

describe('buildSessionsFromNote — uneven count warnings', () => {
  test('no warning when all exercises have equal entry counts', () => {
    const note = '-Bench\n- 125 4,4,4\n- 125 5,5,5\n-Deadlift\n- 225 3,3\n- 225 4,4';
    const r = buildSessionsFromNote(note);
    expect(r.warnings).toHaveLength(0);
  });

  test('warning when exercises have uneven entry counts', () => {
    const note = '-Bench\n- 125 4,4,4\n- 125 5,5,5\n-Deadlift\n- 225 3,3';
    const r = buildSessionsFromNote(note);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/uneven/i);
  });

  test('warning names all exercises with their counts', () => {
    const note = '-Bench\n- 125 4,4,4\n- 125 5,5,5\n-Deadlift\n- 225 3,3';
    const r = buildSessionsFromNote(note);
    expect(r.warnings[0]).toMatch(/Bench/);
    expect(r.warnings[0]).toMatch(/Deadlift/);
  });

  test('sessions still built from max count when uneven', () => {
    const note = '-Bench\n- 125 4,4,4\n- 125 5,5,5\n-Deadlift\n- 225 3,3';
    const r = buildSessionsFromNote(note);
    expect(r.sessions).toHaveLength(2);
  });

  test('missing exercise slot is filled with a skipped entry', () => {
    const note = '-Bench\n- 125 4,4,4\n- 125 5,5,5\n-Deadlift\n- 225 3,3';
    const r = buildSessionsFromNote(note);
    const dl2 = r.sessions[1].entries.find(e => e.exercise_name === 'Deadlift');
    expect(dl2.entry.skipped).toBe(true);
  });
});

// ── Exercise alias matching ───────────────────────────────────────────────────

describe('deriveTrackedPRs — alias matching', () => {
  test('exact name match still works', () => {
    const { sections } = parseWorkoutNote('-DB Bench Press\n80 8,8,8');
    const result = deriveTrackedPRs(sections, ['DB Bench Press']);
    expect(result.exercises[0].estimated_pr).not.toBeNull();
  });

  test('note "DB Bench" matches slot "DB Bench Press" via alias', () => {
    const { sections } = parseWorkoutNote('-DB Bench\n80 8,8,8');
    const result = deriveTrackedPRs(sections, ['DB Bench Press']);
    expect(result.exercises[0].estimated_pr).not.toBeNull();
  });

  test('note "Dumbbell Bench Press" matches slot "DB Bench Press" via alias', () => {
    const { sections } = parseWorkoutNote('-Dumbbell Bench Press\n80 8,8,8');
    const result = deriveTrackedPRs(sections, ['DB Bench Press']);
    expect(result.exercises[0].estimated_pr).not.toBeNull();
  });

  test('note "Back Squat" matches slot "Squat" via alias', () => {
    const { sections } = parseWorkoutNote('-Back Squat\n225 5,5,5');
    const result = deriveTrackedPRs(sections, ['Squat']);
    expect(result.exercises[0].estimated_pr).not.toBeNull();
  });

  test('note "Deadlifts" matches slot "Deadlift" via alias', () => {
    const { sections } = parseWorkoutNote('-Deadlifts\n315 5,5');
    const result = deriveTrackedPRs(sections, ['Deadlift']);
    expect(result.exercises[0].estimated_pr).not.toBeNull();
  });

  test('unrelated exercise does not alias match', () => {
    const { sections } = parseWorkoutNote('-RDL\n225 8,8');
    const result = deriveTrackedPRs(sections, ['Deadlift']);
    expect(result.exercises[0].estimated_pr).toBeNull();
  });

  test('alias match is case-insensitive', () => {
    const { sections } = parseWorkoutNote('-db bench\n80 8,8');
    const result = deriveTrackedPRs(sections, ['DB Bench Press']);
    expect(result.exercises[0].estimated_pr).not.toBeNull();
  });
});

describe('deriveProgressionSignals — alias matching', () => {
  test('tracks progression via alias — note "DB Bench" tracked as "DB Bench Press"', () => {
    const note = 'Monday\n-DB Bench\n80 8,8,8\nWednesday\n-DB Bench\n85 8,8,8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['DB Bench Press']).exercises[0];
    expect(sig.progression_status).toBe('improved');
    expect(sig.latest_pr).not.toBeNull();
  });

  test('absent exercise still returns null progression via alias', () => {
    const { sections } = parseWorkoutNote('-RDL\n225 8,8');
    const sig = deriveProgressionSignals(sections, ['DB Bench Press']).exercises[0];
    expect(sig.progression_status).toBeNull();
  });

  test('mixed canonical and alias name in same note merges into one history — reviewer repro', () => {
    // Monday uses canonical, Wednesday uses alias — both should count as the same lift
    const note = 'Monday\n-DB Bench Press\n80 8,8,8\nWednesday\n-DB Bench\n85 8,8,8';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['DB Bench Press']).exercises[0];
    expect(sig.progression_status).toBe('improved');
    expect(sig.latest_pr).toBeGreaterThan(sig.prior_pr);
  });

  test('1k total merges mixed-name occurrences into one lift history', () => {
    // Monday uses the canonical name, Wednesday uses the alias. The two must
    // merge into a single 2-cycle bench history; the 1K reflects the latest
    // complete cycle (Wednesday at 85).
    const note = 'Monday\n-DB Bench Press\n80 8,8,8\n-Squat\n220 5,5\n-Deadlift\n310 5,5\n'
               + 'Wednesday\n-DB Bench\n85 8,8,8\n-Squat\n225 5,5\n-Deadlift\n315 5,5';
    const { sections } = parseWorkoutNote(note);
    const result = derive1kTotal(sections, { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' });
    const expectedBenchPR = 85 * (1 + 8 / 30);
    expect(result.bench).toBeCloseTo(expectedBenchPR, 1);
    expect(result.total).not.toBeNull();
  });
});

describe('derive1kTotal — alias matching', () => {
  test('note "DB Bench" contributes to bench slot "DB Bench Press"', () => {
    const { sections } = parseWorkoutNote('-DB Bench\n80 8,8,8\n-Squat\n225 5,5\n-Deadlift\n315 5,5');
    const result = derive1kTotal(sections, { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' });
    expect(result.bench).not.toBeNull();
    expect(result.total).not.toBeNull();
  });

  test('DEFAULT_1K_EXERCISES bench slot is DB Bench Press', () => {
    expect(DEFAULT_1K_EXERCISES.bench).toBe('DB Bench Press');
  });

  test('DEFAULT_1K_EXERCISES squat slot is Squat', () => {
    expect(DEFAULT_1K_EXERCISES.squat).toBe('Squat');
  });

  test('DEFAULT_1K_EXERCISES deadlift slot is Deadlift', () => {
    expect(DEFAULT_1K_EXERCISES.deadlift).toBe('Deadlift');
  });
});

describe('deriveProgressionSignals — repeatability score', () => {
  test('305 6,6,4 295 6 scores higher than lone 305 6', () => {
    const multiSig = deriveProgressionSignals(
      parseWorkoutNote('-Bench\n305 6,6,4 295 6').sections, ['Bench']
    ).exercises[0];
    const singleSig = deriveProgressionSignals(
      parseWorkoutNote('-Bench\n305 6').sections, ['Bench']
    ).exercises[0];
    expect(multiSig.repeatability_score).toBeGreaterThan(singleSig.repeatability_score);
  });

  test('repeatability_score counts sets at max weight — 3 sets at 305', () => {
    const { sections } = parseWorkoutNote('-Bench\n305 6,6,4 295 6');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.repeatability_score).toBe(3);
  });

  test('lone heavy set has repeatability_score of 1', () => {
    const { sections } = parseWorkoutNote('-Bench\n305 6');
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.repeatability_score).toBe(1);
  });

  test('null repeatability_score for no-weight exercise', () => {
    const { sections } = parseWorkoutNote('Core: Plank\n30,30');
    const sig = deriveProgressionSignals(sections, ['Core: Plank']).exercises[0];
    expect(sig.repeatability_score).toBeNull();
  });

  test('repeatability_score reflects latest occurrence only', () => {
    // Monday: 305 6,6,4 (score 3), Wednesday: 315 5 (score 1) — latest score is 1
    const note = 'Monday\n-Bench\n305 6,6,4\nWednesday\n-Bench\n315 5';
    const { sections } = parseWorkoutNote(note);
    const sig = deriveProgressionSignals(sections, ['Bench']).exercises[0];
    expect(sig.repeatability_score).toBe(1);
  });
});

// ── countWorkoutSessions ──────────────────────────────────────────────────────

describe('countWorkoutSessions — basics', () => {
  test('returns 0 for empty string', () => {
    expect(countWorkoutSessions('')).toBe(0);
  });

  test('returns 0 for null', () => {
    expect(countWorkoutSessions(null)).toBe(0);
  });

  test('returns 0 for note with headers but no data rows', () => {
    expect(countWorkoutSessions('Monday\n+LIFTING\n-Bench 4x6-8')).toBe(0);
  });

  test('returns max rows across exercises', () => {
    const note = '-Bench\n80 8,8,8\n85 8\n-Squat\n205 8,8';
    expect(countWorkoutSessions(note)).toBe(2);
  });

  test('single exercise single row returns 1', () => {
    expect(countWorkoutSessions('-Bench\n80 8,8,8')).toBe(1);
  });

  test('bare dash skip does not count as a session row', () => {
    const note = '-Bench\n80 8,8,8\n-\n85 8,8';
    expect(countWorkoutSessions(note)).toBe(2);
  });

  test('deload-format row counts as a row', () => {
    expect(countWorkoutSessions('Bench: 225 lbs 3x5')).toBe(1);
  });
});

// ── real-format fixture tests (current_workout sample shape) ──────────────────

const REAL_FORMAT_FIXTURE = [
  'Monday',
  '+WARMUP EXERCISE',
  '-Bike',
  '5 min 9',
  '10',
  '+LIFTING  (~30 min) EXERCISE',
  '-DB Bench Press 4x6-8',
  '80 8,8,8,8',
  '85 8 80 8,8,8',
  '85 8,8 80 8,8',
  '-Low-to-High Cable Fly * no PO needed 2x12',
  '12.5 12,12',
  '12.5 12,12',
  '12.5 12,12',
  '-Squat 4x6-8',
  '205 8,8,8,8',
  '-',
  '215 8,8',
].join('\n');

describe('parseWorkoutNote — real-format fixture', () => {
  test('main lifts produce non-empty rows', () => {
    const { sections } = parseWorkoutNote(REAL_FORMAT_FIXTURE);
    const allExercises = sections.flatMap(s => s.exercises);
    const bench = allExercises.find(e => e.name === 'DB Bench Press');
    const squat = allExercises.find(e => e.name === 'Squat');
    expect(bench.rows.length).toBeGreaterThan(0);
    expect(squat.rows.length).toBeGreaterThan(0);
  });

  test('bare dash inside exercise does not hide real history rows', () => {
    const { sections } = parseWorkoutNote(REAL_FORMAT_FIXTURE);
    const allExercises = sections.flatMap(s => s.exercises);
    const squat = allExercises.find(e => e.name === 'Squat');
    expect(squat.rows).toHaveLength(2);
    expect(squat.session_entries.filter(e => e.skipped)).toHaveLength(1);
  });

  test('countWorkoutSessions on fixture is a positive integer', () => {
    expect(countWorkoutSessions(REAL_FORMAT_FIXTURE)).toBeGreaterThan(0);
  });

  test('countWorkoutSessions equals max-row exercise (DB Bench Press has 3 rows)', () => {
    expect(countWorkoutSessions(REAL_FORMAT_FIXTURE)).toBe(3);
  });

  test('note with exercises but no history rows yields count 0', () => {
    const noHistory = 'Monday\n+LIFTING  (~30 min) EXERCISE\n-DB Bench Press 4x6-8\n-Squat 4x6-8';
    expect(countWorkoutSessions(noHistory)).toBe(0);
  });
});

// ── countWorkoutSessions — same-day warmup+lifting regression ─────────────────

describe('countWorkoutSessions — combined warmup and lifting days', () => {
  test('warmup and lifting on the same day count as one session', () => {
    const note = 'Monday\n+Warmup\n-Bike\n- 5 min\n+Lifting\n-Bench\n- 125 4,4,4';
    expect(countWorkoutSessions(note)).toBe(1);
  });

  test('two weeks of combined warmup+lifting on same day count as 2 sessions', () => {
    const note = 'Monday\n+Warmup\n-Bike\n- 5 min\n- 5 min\n+Lifting\n-Bench\n- 125 4,4,4\n- 130 4,4,4';
    expect(countWorkoutSessions(note)).toBe(2);
  });

  test('non-weight warmup session entries count toward session total', () => {
    const note = '+Warmup\n-Bike\n- 5 min\n- 5 min\n+Lifting\n-Bench\n- 125 4,4\n- 130 4,4';
    expect(countWorkoutSessions(note)).toBe(2);
  });

  test('pure non-weight note session count is derived from session_entries not rows', () => {
    // Regression: switching to rows.length alone would return 0 here since non-weight
    // exercises never populate rows. Non-skipped session_entries must be the fallback.
    const note = '+Warmup\n-Bike\n- 5 min\n- 5 min';
    expect(countWorkoutSessions(note)).toBe(2);
  });

  test('session count is highest among days when days differ', () => {
    const note = 'Monday\n-Bench\n- 125 4,4\n- 130 4,4\nWednesday\n-Squat\n- 205 5,5';
    expect(countWorkoutSessions(note)).toBe(2);
  });

  test('countWorkoutSessionsFromSections matches countWorkoutSessions result', () => {
    const note = 'Monday\n+Warmup\n-Bike\n- 5 min\n- 5 min\n+Lifting\n-Bench\n- 125 4,4\n- 130 4,4';
    const { sections } = parseWorkoutNote(note);
    expect(countWorkoutSessionsFromSections(sections)).toBe(countWorkoutSessions(note));
  });
});

// ── parseWorkoutNote — warmup+lifting day-heading consistency ─────────────────
// These tests pin the contract that makes LogScreen's day-grouping correct:
// all sections under the same calendar day carry the same heading value.

describe('parseWorkoutNote — warmup+lifting heading consistency', () => {
  test('warmup and lifting on the same day both carry that heading', () => {
    const note = 'Monday\n+WARMUP EXERCISE\n-Bike\n5 min\n+LIFTING\n-Bench\n80 8,8,8';
    const { sections } = parseWorkoutNote(note);
    expect(sections.find(s => s.kind === 'warmup').heading).toBe('Monday');
    expect(sections.find(s => s.kind === 'lifting').heading).toBe('Monday');
  });

  test('warmup and lifting on the same day produce two separate sections', () => {
    const note = 'Monday\n+WARMUP EXERCISE\n-Bike\n5 min\n+LIFTING\n-Bench\n80 8,8,8';
    const { sections } = parseWorkoutNote(note);
    expect(sections).toHaveLength(2);
  });

  test('multi-day note: each day heading appears on exactly its own sections', () => {
    const note = [
      'Monday',
      '+Warmup',
      '-Bike',
      '5 min',
      '+Lifting',
      '-Bench',
      '80 8',
      'Wednesday',
      '+Warmup',
      '-Bike',
      '5 min',
      '+Lifting',
      '-Squat',
      '205 5',
    ].join('\n');
    const { sections } = parseWorkoutNote(note);
    expect(sections.filter(s => s.heading === 'Monday')).toHaveLength(2);
    expect(sections.filter(s => s.heading === 'Wednesday')).toHaveLength(2);
  });

  test('no-subheading sections under a day heading carry that heading', () => {
    const note = 'Monday\n-Bench\n80 8\n-Squat\n205 5';
    const { sections } = parseWorkoutNote(note);
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Monday');
    expect(sections[0].exercises).toHaveLength(2);
  });

  test('empty day with only a heading and no exercises produces no section', () => {
    const note = 'Monday\nWednesday\n-Bench\n80 8';
    const { sections } = parseWorkoutNote(note);
    const mondaySections = sections.filter(s => s.heading === 'Monday');
    expect(mondaySections).toHaveLength(0);
    expect(sections.find(s => s.heading === 'Wednesday')).toBeDefined();
  });
});

// ── derivePerDaySignals — per-day analytics for multi-day exercises ───────────

function makePerDaySection(heading, name, sessionEntries) {
  return {
    heading,
    subheading: null,
    kind: 'general',
    exercises: [{
      name,
      rows: [],
      sets: [],
      unparsed_rows: [],
      session_entries: sessionEntries.map(e =>
        e === 'skip'
          ? { skipped: true, raw: '-', sets: [] }
          : { skipped: false, raw: 'x', sets: Array.isArray(e) ? e : [e] }
      ),
    }],
  };
}

function pds(weight, reps) { return { weight_value: weight, rep_count: reps }; }

describe('derivePerDaySignals', () => {
  test('returns empty object for empty sections', () => {
    const result = derivePerDaySignals([], ['Squat']);
    expect(result).toEqual({});
  });

  test('returns empty object for exercise absent from sections', () => {
    const sections = [makePerDaySection('Monday', 'Bench Press', [pds(135, 5)])];
    const result = derivePerDaySignals(sections, ['Squat']);
    expect(result).toEqual({});
  });

  test('single-day exercise returns its heading as the only key', () => {
    const sections = [makePerDaySection('Monday', 'Squat', [pds(225, 5)])];
    const result = derivePerDaySignals(sections, ['Squat']);
    expect(result).toHaveProperty('squat');
    expect(Object.keys(result['squat'])).toEqual(['Monday']);
  });

  test('single day with one session: latest_top_weight present, overload_trend null (no prior)', () => {
    const sections = [makePerDaySection('Monday', 'Squat', [pds(225, 5)])];
    const { squat } = derivePerDaySignals(sections, ['Squat']);
    expect(squat['Monday'].latest_top_weight).toBe(225);
    expect(squat['Monday'].overload_trend).toBeNull();
  });

  test('single day two sessions: overload_trend reflects weight progression', () => {
    const sections = [
      makePerDaySection('Monday', 'Squat', [pds(225, 5), pds(235, 5)]),
    ];
    const { squat } = derivePerDaySignals(sections, ['Squat']);
    expect(squat['Monday'].latest_top_weight).toBe(235);
    expect(squat['Monday'].overload_trend).toBe('up');
  });

  test('multi-day exercise: each day gets independent metrics', () => {
    // Monday: two sessions at 35 then 40 → overload_trend up
    // Wednesday: two sessions at 30 then 30 (same reps) → overload_trend flat
    const sections = [
      makePerDaySection('Monday', 'Hammer Curl', [pds(35, 10), pds(40, 10)]),
      makePerDaySection('Wednesday', 'Hammer Curl', [pds(30, 10), pds(30, 10)]),
    ];
    const { 'hammer curl': hc } = derivePerDaySignals(sections, ['Hammer Curl']);
    expect(hc['Monday'].latest_top_weight).toBe(40);
    expect(hc['Monday'].overload_trend).toBe('up');
    expect(hc['Wednesday'].latest_top_weight).toBe(30);
    expect(hc['Wednesday'].overload_trend).toBe('flat');
  });

  test('multi-day exercise Monday vs Friday: different top weights produce distinct rows', () => {
    const sections = [
      makePerDaySection('Monday', 'Hammer Curl', [pds(35, 8), pds(35, 8)]),
      makePerDaySection('Friday', 'Hammer Curl', [pds(30, 8), pds(30, 8)]),
    ];
    const { 'hammer curl': hc } = derivePerDaySignals(sections, ['Hammer Curl']);
    expect(hc['Monday'].latest_top_weight).not.toBe(hc['Friday'].latest_top_weight);
    expect(hc['Monday'].latest_top_weight).toBe(35);
    expect(hc['Friday'].latest_top_weight).toBe(30);
  });

  test('global aggregate via deriveProgressionSignals is unchanged when adding per-day plumbing', () => {
    const sections = [
      makePerDaySection('Monday', 'Hammer Curl', [pds(35, 8), pds(40, 8)]),
      makePerDaySection('Wednesday', 'Hammer Curl', [pds(30, 8), pds(32, 8)]),
    ];
    const { exercises: signals } = deriveProgressionSignals(sections, ['Hammer Curl']);
    // Global signal should use the latest occurrence (Wednesday day 2 = 32lb)
    // or Monday day 2 = 40lb depending on order — the point is it computes globally
    expect(signals[0]).toHaveProperty('latest_top_weight');
    // Per-day signals are independent
    const perDay = derivePerDaySignals(sections, ['Hammer Curl']);
    expect(perDay['hammer curl']['Monday'].latest_top_weight).toBe(40);
    expect(perDay['hammer curl']['Wednesday'].latest_top_weight).toBe(32);
  });

  // ── bodyweight/rep-only regression ───────────────────────────────────────────

  test('weighted day: is_bodyweight false', () => {
    const sections = [makePerDaySection('Monday', 'Squat', [pds(225, 5)])];
    const { squat } = derivePerDaySignals(sections, ['Squat']);
    expect(squat['Monday'].is_bodyweight).toBe(false);
  });

  test('rep-only day (no weight_value): is_bodyweight true and latest_top_weight is best rep count', () => {
    const bwSet = { weight_value: null, rep_count: 10 };
    const sections = [{
      heading: 'Monday', subheading: null, kind: 'general',
      exercises: [{
        name: 'Pull-ups', rows: [], sets: [], unparsed_rows: [],
        session_entries: [{ skipped: false, raw: '10', sets: [bwSet] }],
      }],
    }];
    const result = derivePerDaySignals(sections, ['Pull-ups']);
    expect(result['pull-ups']['Monday'].is_bodyweight).toBe(true);
    expect(result['pull-ups']['Monday'].latest_top_weight).toBe(10);
  });

  test('multi-day bodyweight exercise: each day gets independent rep-based metrics', () => {
    // Monday: two sessions 8 reps then 10 reps → trend up, best set 10
    // Friday: two sessions 6 reps then 6 reps → trend flat, best set 6
    const bwEntry = (reps) => ({ skipped: false, raw: String(reps), sets: [{ weight_value: null, rep_count: reps }] });
    const makeBwSection = (heading, entries) => ({
      heading, subheading: null, kind: 'general',
      exercises: [{
        name: 'Pull-ups', rows: [], sets: [], unparsed_rows: [],
        session_entries: entries.map(bwEntry),
      }],
    });

    const sections = [makeBwSection('Monday', [8, 10]), makeBwSection('Friday', [6, 6])];
    const result = derivePerDaySignals(sections, ['Pull-ups']);
    const mon = result['pull-ups']['Monday'];
    const fri = result['pull-ups']['Friday'];

    expect(mon.is_bodyweight).toBe(true);
    expect(mon.latest_top_weight).toBe(10);
    expect(mon.overload_trend).toBe('up');

    expect(fri.is_bodyweight).toBe(true);
    expect(fri.latest_top_weight).toBe(6);
    expect(fri.overload_trend).toBe('flat');

    expect(mon.latest_top_weight).not.toBe(fri.latest_top_weight);
  });

  test('rep-only day with zero reps: latest_top_weight null, is_bodyweight false', () => {
    const sections = [{
      heading: 'Monday', subheading: null, kind: 'general',
      exercises: [{
        name: 'Pull-ups', rows: [], sets: [], unparsed_rows: [],
        session_entries: [{ skipped: false, raw: '-', sets: [{ weight_value: null, rep_count: 0 }] }],
      }],
    }];
    const result = derivePerDaySignals(sections, ['Pull-ups']);
    expect(result['pull-ups']['Monday'].latest_top_weight).toBeNull();
    expect(result['pull-ups']['Monday'].is_bodyweight).toBe(false);
  });
});


// ── parseExerciseHeader ───────────────────────────────────────────────────────

describe('parseExerciseHeader', () => {
  test('parses NxM-P: 4x6-8 → sets=4, repLo=6, repHi=8', () => {
    expect(parseExerciseHeader('-Squat 4x6-8')).toEqual({ sets: 4, repLo: 6, repHi: 8 });
  });

  test('parses NxM: 2x12 → sets=2, repLo=12, repHi=12', () => {
    expect(parseExerciseHeader('-Bench Press 2x12')).toEqual({ sets: 2, repLo: 12, repHi: 12 });
  });

  test('parses Core: ... * 2x10-12 → sets=2, repLo=10, repHi=12', () => {
    expect(parseExerciseHeader('-Core: In-and-outs on bench * 2x10-12')).toEqual({ sets: 2, repLo: 10, repHi: 12 });
  });

  test('parses space-separated "N M-P": 2 8-10 → sets=2, repLo=8, repHi=10', () => {
    expect(parseExerciseHeader('-Hammer Curl 2 8-10')).toEqual({ sets: 2, repLo: 8, repHi: 10 });
  });

  test('returns null when no NxM or N M-P pattern present', () => {
    expect(parseExerciseHeader('-Band pull-aparts')).toBeNull();
    expect(parseExerciseHeader('-Bike')).toBeNull();
  });

  test('returns null for empty or null input', () => {
    expect(parseExerciseHeader('')).toBeNull();
    expect(parseExerciseHeader(null)).toBeNull();
  });

  test('parses 3x8-10 → sets=3, repLo=8, repHi=10', () => {
    expect(parseExerciseHeader('-Lat Pulldown 3x8-10')).toEqual({ sets: 3, repLo: 8, repHi: 10 });
  });
});

// ── generateDeloadNote ────────────────────────────────────────────────────────

const DELOAD_FIXTURE = [
  'Monday',
  '+WARMUP EXERCISE',
  '-Bike',
  '5 min',
  '+LIFTING EXERCISE',
  '-DB Bench Press 4x6-8',
  '80 8,8,8,8',
  '90 8,8,8,5',
  '95 7,7,7,7',
  '-Low-to-High Cable Fly 2x12',
  '12.5 12,12',
  '17.5 12, 12.5 12',
  '-Single-Arm Pushdown 2x10-12',
  '15 12,12',
  '20.5 12,12',
  'Tuesday',
  '+WARMUP EXERCISE',
  '-Bike',
  '5 min',
  '+LIFTING EXERCISE',
  '-Squat 4x6-8',
  '225 8,8,8,8',
  '235 8,8,8,8',
  '245 4 235 8,8,8',
  'Core: Plank 2x30',
  '30,30',
].join('\n');

describe('generateDeloadNote', () => {
  test('PO lift reduced to 65% of working weight, sets-1, mid-rep', () => {
    const deload = generateDeloadNote(DELOAD_FIXTURE);
    // Squat: last row 245 4 235 8,8,8 → heaviest with ≥2 sets = 235
    // po:true → round(0.65 × 235, 5) = 155; sets max(2,3)=3; reps ceil((6+8)/2)=7
    expect(deload).toContain('Squat: 155 lbs 3x7');
  });

  test('PO lift: DB Bench Press uses 5-lb increment when all weights are multiples of 5', () => {
    const deload = generateDeloadNote(DELOAD_FIXTURE);
    // DB Bench: last row 95 7,7,7,7 → working weight 95; round(0.65×95, 5)=round(61.75,5)=60
    expect(deload).toContain('DB Bench Press: 60 lbs 3x7');
  });

  test('catalog po:false accessory: weight unchanged', () => {
    const deload = generateDeloadNote(DELOAD_FIXTURE);
    // Low-to-High Cable Fly: po:false → weight unchanged (17.5, heaviest from last row)
    expect(deload).toContain('Low-to-High Cable Fly: 17.5 lbs 2x12');
  });

  test('catalog po:false: sets-1 still applied', () => {
    const deload = generateDeloadNote(DELOAD_FIXTURE);
    // Single-Arm Pushdown: po:false; last row 20.5 12,12 → working weight 20.5; sets max(2,1)=2; reps ceil(11)=11
    expect(deload).toContain('Single-Arm Pushdown: 20.5 lbs 2x11');
  });

  test('warmup section exercises are omitted', () => {
    const deload = generateDeloadNote(DELOAD_FIXTURE);
    expect(deload).not.toContain('Bike');
  });

  test('Core: exercises emitted as "Core: <short>, easy" without weight', () => {
    const deload = generateDeloadNote(DELOAD_FIXTURE);
    expect(deload).toContain('Core: plank, easy');
    expect(deload).not.toMatch(/Core: plank.*lbs/);
  });

  test('output is grouped under the original day headings', () => {
    const deload = generateDeloadNote(DELOAD_FIXTURE);
    const lines = deload.split('\n');
    const mondayIdx = lines.indexOf('Monday');
    const tuesdayIdx = lines.indexOf('Tuesday');
    expect(mondayIdx).toBeGreaterThanOrEqual(0);
    expect(tuesdayIdx).toBeGreaterThan(mondayIdx);
    // DB Bench Press appears under Monday
    const benchIdx = lines.findIndex(l => l.includes('DB Bench Press'));
    expect(benchIdx).toBeGreaterThan(mondayIdx);
    expect(benchIdx).toBeLessThan(tuesdayIdx);
    // Squat appears under Tuesday
    const squatIdx = lines.findIndex(l => l.includes('Squat:'));
    expect(squatIdx).toBeGreaterThan(tuesdayIdx);
  });

  test('output round-trips through parseWorkoutNote with valid deload sections', () => {
    const deload = generateDeloadNote(DELOAD_FIXTURE);
    const { ok, sections } = parseWorkoutNote(deload);
    expect(ok).toBe(true);
    const allExercises = sections.flatMap(s => s.exercises);
    const benchEx = allExercises.find(e => e.name === 'DB Bench Press');
    expect(benchEx).toBeTruthy();
    expect(benchEx.sets.length).toBeGreaterThan(0);
    expect(benchEx.sets[0].weight_value).toBe(60);
    const squatEx = allExercises.find(e => e.name === 'Squat');
    expect(squatEx).toBeTruthy();
    expect(squatEx.sets[0].weight_value).toBe(155);
  });

  test('increment inference: 2.5 lb increment when exercise has non-5-multiple weights', () => {
    const routine = [
      'Friday',
      '+LIFTING',
      '-Goblet Calf Raise 3x12-15',
      '17.5 15,15',
      '25 15,15,15',
    ].join('\n');
    const deload = generateDeloadNote(routine);
    // Working weight = 25 (3 sets ≥2); po:true; 0.65×25=16.25; round(16.25,2.5)=17.5
    // deloadSets=max(2,2)=2; deloadReps=ceil((12+15)/2)=14
    expect(deload).toContain('Goblet Calf Raise: 17.5 lbs 2x14');
  });

  test('increment inference: 5 lb increment when all weights are multiples of 5', () => {
    const routine = [
      'Tuesday',
      '+LIFTING',
      '-Squat 4x6-8',
      '235 8,8,8,8',
    ].join('\n');
    const deload = generateDeloadNote(routine);
    // round(0.65×235, 5) = round(152.75, 5) = 155
    expect(deload).toContain('Squat: 155 lbs 3x7');
  });

  test('uncataloged exercise: weight unchanged', () => {
    const routine = [
      'Monday',
      '+LIFTING',
      '-UnknownLift 3x8',
      '100 8,8,8',
    ].join('\n');
    const deload = generateDeloadNote(routine);
    expect(deload).toContain('UnknownLift: 100 lbs 2x8');
  });

  test('fallback when header has no NxM: uses last row set count and rep range', () => {
    const routine = [
      'Monday',
      '+LIFTING',
      '-SomeExercise',
      '135 8,8,8',
    ].join('\n');
    const deload = generateDeloadNote(routine);
    // prescribedSets=3, repLo=8, repHi=8; deloadSets=max(2,2)=2; deloadReps=8; not in catalog
    expect(deload).toContain('SomeExercise: 135 lbs 2x8');
  });

  test('empty routine produces empty string', () => {
    expect(generateDeloadNote('')).toBe('');
    expect(generateDeloadNote(null)).toBe('');
  });

  test('routine with only warmup sections produces empty string', () => {
    const routine = ['Monday', '+WARMUP', '-Bike', '5 min'].join('\n');
    expect(generateDeloadNote(routine)).toBe('');
  });

  test('sets floor: prescribedSets=2 → deloadSets=2 (not 1)', () => {
    const routine = [
      'Monday',
      '+LIFTING',
      '-Low-to-High Cable Fly 2x12',
      '17.5 12,12',
    ].join('\n');
    const deload = generateDeloadNote(routine);
    // max(2, 2-1) = max(2,1) = 2
    expect(deload).toContain('2x12');
  });

  test('working weight: heaviest with ≥2 sets wins over heavier singleton', () => {
    const routine = [
      'Tuesday',
      '+LIFTING',
      '-Squat 4x6-8',
      '250 1 235 3,3,3',
    ].join('\n');
    const deload = generateDeloadNote(routine);
    // 250 has 1 set, 235 has 3 sets → working weight = 235 → deloadWeight = 155
    expect(deload).toContain('Squat: 155 lbs 3x7');
  });

  test('working weight fallback: uses heaviest when no weight has ≥2 sets', () => {
    const routine = [
      'Tuesday',
      '+LIFTING',
      '-Squat 4x6-8',
      '235 1 225 1 215 1 205 1',
    ].join('\n');
    const deload = generateDeloadNote(routine);
    // All weights have 1 set → fallback to heaviest = 235 → deloadWeight = 155
    expect(deload).toContain('Squat: 155 lbs 3x7');
  });
});
