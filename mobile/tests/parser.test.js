import { parseWeightEntry, parseWorkoutRow, parseWorkoutEntry, parseWorkoutNote, epleyPR, deriveWorkoutAnalytics, deriveTrackedPRs } from '../lib/parser';
import { getDefaultTrackedNames } from '../lib/data';

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

  test('skip marker (-) within exercise context is ignored', () => {
    const r = parseWorkoutNote('-Bench\n80 8,8,8\n-\n85 8,8,8');
    expect(r.sections[0].exercises[0].rows).toHaveLength(2);
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
