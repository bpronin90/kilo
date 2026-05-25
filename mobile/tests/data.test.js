import { computeWeightTrends, computeWeightPaceLevel, computeKiloMax, makeWorkoutNoteItem, normalizeLiftName, listTrackedLifts, computeWeeksIn, classifyExerciseSessions, deriveSkipData, computeRepDropOff, deriveRepDropOffFlags, getLatestRepDropOff, detectBig3Asymmetry, currentWeekStart, rollingWindowStart } from '../lib/data';


// ── computeKiloMax ────────────────────────────────────────────────────────────

describe('computeKiloMax', () => {
  // Worked example: 245x5,5 / 240x8,8 (4 sets across one or more occurrences)
  // Epley per set: 245*(1+5/30)=285.83, 285.83, 240*(1+8/30)=304.0, 304.0
  // avgEpley = 294.917  rawRounded = 295  adjusted = Math.round(294.917*1.07) = 316
  test('worked example 245x5,5 / 240x8,8 => kilo_max_adjusted 316, raw 295', () => {
    const occurrences = [{
      kind: 'lifting',
      sets: [
        { weight_value: 245, rep_count: 5 },
        { weight_value: 245, rep_count: 5 },
        { weight_value: 240, rep_count: 8 },
        { weight_value: 240, rep_count: 8 },
      ],
    }];
    const { kilo_max_adjusted } = computeKiloMax(occurrences);
    expect(kilo_max_adjusted).toBe(316);
  });

  test('kilo_max diverges from 1RM max for multi-set sessions', () => {
    // Best single-set Epley: 240*(1+8/30)=304; kilo_max_adjusted=316 > 304
    const occurrences = [{
      kind: 'lifting',
      sets: [
        { weight_value: 245, rep_count: 5 },
        { weight_value: 245, rep_count: 5 },
        { weight_value: 240, rep_count: 8 },
        { weight_value: 240, rep_count: 8 },
      ],
    }];
    const { kilo_max_adjusted } = computeKiloMax(occurrences);
    const best1rm = Math.round(240 * (1 + 8 / 30));
    expect(kilo_max_adjusted).not.toBe(best1rm);
  });

  test('single set => adjusted correctly', () => {
    // 300*(1+1/30)=310; adjusted=Math.round(310*1.07)=332
    const occurrences = [{ kind: 'lifting', sets: [{ weight_value: 300, rep_count: 1 }] }];
    const { kilo_max_adjusted } = computeKiloMax(occurrences);
    expect(kilo_max_adjusted).toBe(332);
  });

  test('all-warmup occurrences => null', () => {
    const occurrences = [{ kind: 'warmup', sets: [{ weight_value: 135, rep_count: 10 }] }];
    const { kilo_max_adjusted } = computeKiloMax(occurrences);
    expect(kilo_max_adjusted).toBeNull();
  });

  test('all-skipped (empty sets) => null', () => {
    const occurrences = [{ kind: 'lifting', sets: [] }];
    const { kilo_max_adjusted } = computeKiloMax(occurrences);
    expect(kilo_max_adjusted).toBeNull();
  });

  test('mixed warmup and lifting occurrences => warmup excluded', () => {
    const occurrences = [
      { kind: 'warmup', sets: [{ weight_value: 135, rep_count: 10 }] },
      { kind: 'lifting', sets: [{ weight_value: 245, rep_count: 5 }] },
    ];
    const liftOnly = [{ kind: 'lifting', sets: [{ weight_value: 245, rep_count: 5 }] }];
    const { kilo_max_adjusted } = computeKiloMax(occurrences);
    const { kilo_max_adjusted: expected } = computeKiloMax(liftOnly);
    expect(kilo_max_adjusted).toBe(expected);
  });
});

// ── computeWeightTrends — paceFlag ────────────────────────────────────────────

describe('computeWeightTrends — paceFlag', () => {
  test('returns null paceFlag with fewer than 2 entries', () => {
    expect(computeWeightTrends([{ date: '2026-05-20', weight_value: 185 }]).paceFlag).toBeNull();
  });

  test('returns null when delta is 0.2 lb (below 1.5 lb threshold)', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 185.2 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBeNull();
  });

  test('returns gain for 1.6 lb increase', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 186.6 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('gain');
  });

  test('returns loss for 1.6 lb decrease', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 183.4 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('loss');
  });

  test('paceFlag based on two most recent by date, ignoring older history', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 185.1 },
      { date: '2026-05-19', weight_value: 185.0 },
      { date: '2026-05-10', weight_value: 175.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBeNull();
  });

  test('handles entries supplied oldest-first', () => {
    const entries = [
      { date: '2026-05-19', weight_value: 185.0 },
      { date: '2026-05-20', weight_value: 186.8 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('gain');
  });
});

// ── computeWeightPaceLevel ────────────────────────────────────────────────────

describe('computeWeightPaceLevel', () => {
  test('returns null with fewer than 2 entries', () => {
    expect(computeWeightPaceLevel([{ date: '2026-05-20', weight_value: 185 }])).toBeNull();
    expect(computeWeightPaceLevel([])).toBeNull();
    expect(computeWeightPaceLevel(null)).toBeNull();
  });

  test('returns null when delta is 0.2 lb (below threshold)', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 185.2 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightPaceLevel(entries)).toBeNull();
  });

  test('1.6 lb in either direction => notable (yellow band)', () => {
    const gain = [
      { date: '2026-05-20', weight_value: 186.6 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    const loss = [
      { date: '2026-05-20', weight_value: 183.4 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightPaceLevel(gain)).toBe('notable');
    expect(computeWeightPaceLevel(loss)).toBe('notable');
  });

  test('2.4 lb in either direction => spike (red band)', () => {
    const gain = [
      { date: '2026-05-20', weight_value: 187.4 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    const loss = [
      { date: '2026-05-20', weight_value: 182.6 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightPaceLevel(gain)).toBe('spike');
    expect(computeWeightPaceLevel(loss)).toBe('spike');
  });

  test('level based on two most recent by date, ignoring older history', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 185.1 },
      { date: '2026-05-19', weight_value: 185.0 },
      { date: '2026-05-10', weight_value: 170.0 },
    ];
    expect(computeWeightPaceLevel(entries)).toBeNull();
  });

  test('handles oldest-first entry order', () => {
    const entries = [
      { date: '2026-05-19', weight_value: 185.0 },
      { date: '2026-05-20', weight_value: 187.4 },
    ];
    expect(computeWeightPaceLevel(entries)).toBe('spike');
  });
});

// ── makeWorkoutNoteItem ───────────────────────────────────────────────────────

describe('makeWorkoutNoteItem', () => {
  test('returns an object with id, title, raw_text, timestamps, tracked_exercises, one_k_exercises', () => {
    const item = makeWorkoutNoteItem({ title: 'Push Day' });
    expect(typeof item.id).toBe('string');
    expect(item.title).toBe('Push Day');
    expect(typeof item.raw_text).toBe('string');
    expect(item.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(item.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(item.tracked_exercises)).toBe(true);
    expect(item.one_k_exercises).toBeNull();
  });

  test('defaults isCurrent to false', () => {
    const item = makeWorkoutNoteItem({ title: 'Push Day' });
    expect(item.isCurrent).toBe(false);
  });

  test('accepts isCurrent: true', () => {
    const item = makeWorkoutNoteItem({ title: 'Push Day', isCurrent: true });
    expect(item.isCurrent).toBe(true);
  });

  test('defaults raw_text to empty string', () => {
    const item = makeWorkoutNoteItem({ title: 'Push Day' });
    expect(item.raw_text).toBe('');
  });

  test('uses provided raw_text', () => {
    const item = makeWorkoutNoteItem({ title: 'Push Day', raw_text: '-Squat\n225 5,5,5' });
    expect(item.raw_text).toBe('-Squat\n225 5,5,5');
  });

  test('id follows wn_YYYY-MM-DD_timestamp format', () => {
    const item = makeWorkoutNoteItem({ title: 'Test' });
    expect(item.id).toMatch(/^wn_\d{4}-\d{2}-\d{2}_\d+$/);
  });
});

// ── normalizeLiftName ─────────────────────────────────────────────────────────

describe('normalizeLiftName', () => {
  test('lowercases', () => {
    expect(normalizeLiftName('Bench Press')).toBe('bench press');
  });

  test('trims leading and trailing whitespace', () => {
    expect(normalizeLiftName('  bench press  ')).toBe('bench press');
  });

  test('collapses internal whitespace', () => {
    expect(normalizeLiftName('Bench  Press')).toBe('bench press');
  });

  test('Bench Press, bench press, and " Bench  Press " all normalize identically', () => {
    const a = normalizeLiftName('Bench Press');
    const b = normalizeLiftName('bench press');
    const c = normalizeLiftName(' Bench  Press ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test('returns empty string for empty input', () => {
    expect(normalizeLiftName('')).toBe('');
  });

  test('returns empty string for null', () => {
    expect(normalizeLiftName(null)).toBe('');
  });
});

// ── listTrackedLifts ──────────────────────────────────────────────────────────

describe('listTrackedLifts', () => {
  test('returns keys with truthy values', () => {
    const map = { 'bench press': true, 'squat': true };
    expect(listTrackedLifts(map).sort()).toEqual(['bench press', 'squat']);
  });

  test('excludes keys with falsy values', () => {
    const map = { 'bench press': true, 'squat': false };
    expect(listTrackedLifts(map)).toEqual(['bench press']);
  });

  test('returns empty array for null', () => {
    expect(listTrackedLifts(null)).toEqual([]);
  });

  test('returns empty array for empty map', () => {
    expect(listTrackedLifts({})).toEqual([]);
  });
});

// ── tracked-lift toggle merge (race-safety) ───────────────────────────────────
// These tests verify the in-memory merge pattern used by LogScreen.handleToggleTrack.
// The pattern reads prev state (not storage) to build the next map, so consecutive
// toggles on different exercises cannot overwrite each other.

function toggleInMap(map, normalizedKey) {
  const next = { ...map };
  if (next[normalizedKey]) { delete next[normalizedKey]; } else { next[normalizedKey] = true; }
  return next;
}

describe('tracked-lift toggle merge', () => {
  test('two consecutive toggles on different lifts both survive', () => {
    let state = {};
    state = toggleInMap(state, normalizeLiftName('Bench Press'));
    state = toggleInMap(state, normalizeLiftName('Squat'));
    expect(state['bench press']).toBe(true);
    expect(state['squat']).toBe(true);
  });

  test('toggling the same lift twice removes it', () => {
    let state = {};
    const key = normalizeLiftName('Bench Press');
    state = toggleInMap(state, key);
    state = toggleInMap(state, key);
    expect(state[key]).toBeUndefined();
  });

  test('stale-read race drops a key but chained state updates do not', () => {
    // Race: both calls read the same empty map from storage, each writes back
    // only their own key. The second setItem overwrites the first entirely.
    const base = {};
    const write1 = toggleInMap(base, 'bench press'); // { 'bench press': true }
    const write2 = toggleInMap(base, 'squat');        // { 'squat': true }
    const finalAfterRace = write2; // second setItem overwrites first
    expect(finalAfterRace['bench press']).toBeUndefined(); // bench press lost
    expect(finalAfterRace['squat']).toBe(true);

    // Correct pattern: chain from prev state — both keys survive.
    let state = {};
    state = toggleInMap(state, 'bench press');
    state = toggleInMap(state, 'squat');
    expect(state['bench press']).toBe(true);
    expect(state['squat']).toBe(true);
  });
});

// ── classifyExerciseSessions ──────────────────────────────────────────────────

function classifSection(name, entries) {
  const session_entries = entries.map(e =>
    e === 'skip'
      ? { skipped: true, raw: '-', sets: [] }
      : { skipped: false, raw: 'x', sets: Array.isArray(e) ? e : [e] }
  );
  return {
    heading: null, subheading: null, kind: 'general',
    exercises: [{ name, rows: [], sets: [], unparsed_rows: [], session_entries }],
  };
}

function w(weight, rep_count) { return { weight_value: weight, rep_count }; }

describe('classifyExerciseSessions', () => {
  test('no logged sessions → null', () => {
    const sections = [classifSection('Squat', ['skip', 'skip'])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBeNull();
  });

  test('exactly 1 logged session → initial', () => {
    const sections = [classifSection('Squat', [w(225, 5)])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('initial');
  });

  test('exercise absent from note → null', () => {
    const sections = [classifSection('Bench Press', [w(135, 5), w(145, 5)])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBeNull();
  });

  test('progressing — top-set weight increased', () => {
    const sections = [classifSection('Squat', [w(225, 5), w(235, 5)])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('progressing');
  });

  test('progressing — same weight, majority of sets have higher reps (all improved)', () => {
    const sections = [classifSection('Squat', [
      [w(225, 5), w(225, 5)],
      [w(225, 6), w(225, 6)],
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('progressing');
  });

  test('progressing — same weight, majority of sets improved even with one regressed set', () => {
    // prior [5,5,5], latest [6,6,3] → 2 of 3 improved → majority → progressing
    const sections = [classifSection('Squat', [
      [w(225, 5), w(225, 5), w(225, 5)],
      [w(225, 6), w(225, 6), w(225, 3)],
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('progressing');
  });

  test('NOT progressing — same weight, exactly half sets improved (not majority)', () => {
    // prior [5,5], latest [6,4] → 1 of 2 improved = 50%, not majority
    const sections = [classifSection('Squat', [
      [w(225, 5), w(225, 5)],
      [w(225, 6), w(225, 4)],
    ])];
    const result = classifyExerciseSessions(sections, ['Squat'])['squat'];
    expect(result).not.toBe('progressing');
  });

  test('regressing — top-set weight dropped', () => {
    const sections = [classifSection('Squat', [w(235, 5), w(225, 5)])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('regressing');
  });

  test('regressing — same weight, avg reps dropped > 2', () => {
    // prior avg reps: 8, latest avg reps: 4 → delta = 4 > 2
    const sections = [classifSection('Squat', [
      [w(225, 8), w(225, 8)],
      [w(225, 4), w(225, 4)],
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('regressing');
  });

  test('NOT regressing — same weight, avg reps dropped exactly 2 (threshold is > 2)', () => {
    // prior avg: 7, latest avg: 5 → delta = 2, not > 2
    const sections = [classifSection('Squat', [
      [w(225, 7), w(225, 7)],
      [w(225, 5), w(225, 5)],
    ])];
    const result = classifyExerciseSessions(sections, ['Squat'])['squat'];
    expect(result).not.toBe('regressing');
  });

  test('stalled — same weight and same rep counts', () => {
    const sections = [classifSection('Squat', [
      [w(225, 5), w(225, 5)],
      [w(225, 5), w(225, 5)],
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('stalled');
  });

  test('inconsistent — skip mixed with logged sessions, reps within range (not regressing, not progressing, not stalled)', () => {
    // prior: 225×7, skip, latest: 225×6 → 1-rep drop (≤2 so not regressing), reps fell (not progressing), different (not stalled), has skip → inconsistent
    const sections = [classifSection('Squat', [w(225, 7), 'skip', w(225, 6)])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('inconsistent');
  });

  test('precedence: regressing beats inconsistent', () => {
    const sections = [classifSection('Squat', [
      [w(235, 5)],
      'skip',
      [w(225, 5)],
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('regressing');
  });

  test('precedence: progressing beats inconsistent', () => {
    const sections = [classifSection('Squat', [
      [w(225, 5)],
      'skip',
      [w(235, 5)],
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('progressing');
  });

  test('window uses only last 3 entries: skip outside window does not trigger inconsistent', () => {
    // skip is 4 positions from the end; last 3 = [w(225,5), w(225,5), w(225,5)] — no skip → stalled
    const sections = [classifSection('Squat', [
      'skip',
      w(225, 5),
      w(225, 5),
      w(225, 5),
      w(225, 5),
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('stalled');
  });

  test('alias variant tracked name resolves to canonical analytics entry', () => {
    // "lat pd" is an alias for "Lat Pulldown" — classifyExerciseSessions must resolve it
    const sections = [
      { heading: null, subheading: null, kind: 'general', exercises: [
        { name: 'Lat Pulldown', rows: [], sets: [w(100, 10), w(100, 10)], unparsed_rows: [], session_entries: [] },
      ]},
      { heading: null, subheading: null, kind: 'general', exercises: [
        { name: 'Lat Pulldown', rows: [], sets: [w(110, 10), w(110, 10)], unparsed_rows: [], session_entries: [] },
      ]},
    ];
    expect(classifyExerciseSessions(sections, ['lat pd'])['lat pd']).toBe('progressing');
  });

  test('plain-row occurrences (no session_entries) each count as one session', () => {
    // Two separate section occurrences with bare rows (no "- " prefix), newest last
    const sections = [
      { heading: 'monday', subheading: null, kind: 'general', exercises: [
        { name: 'Squat', rows: [], sets: [w(225, 5), w(225, 5), w(225, 5)], unparsed_rows: [], session_entries: [] },
      ]},
      { heading: 'friday', subheading: null, kind: 'general', exercises: [
        { name: 'Squat', rows: [], sets: [w(235, 5), w(235, 5), w(235, 5)], unparsed_rows: [], session_entries: [] },
      ]},
    ];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('progressing');
  });

  test('returns map for multiple tracked exercises', () => {
    const sections = [
      classifSection('Squat', [w(225, 5), w(235, 5)]),
      classifSection('Deadlift', [w(315, 5), w(315, 5)]),
    ];
    const result = classifyExerciseSessions(sections, ['Squat', 'Deadlift']);
    expect(result['squat']).toBe('progressing');
    expect(result['deadlift']).toBeDefined();
  });
});

// ── computeWeeksIn ────────────────────────────────────────────────────────────

function makeSection(exercises) {
  return { heading: null, subheading: null, kind: 'general', exercises };
}

function makeExercise(sessionEntryCount, { skippedIndices = [] } = {}) {
  const session_entries = Array.from({ length: sessionEntryCount }, (_, i) =>
    skippedIndices.includes(i)
      ? { skipped: true, raw: '-', sets: [] }
      : { skipped: false, raw: '100x5', sets: [{ weight_value: 100, rep_count: 5 }] }
  );
  return { name: 'Exercise', rows: [], session_entries, unparsed_rows: [] };
}

describe('computeWeeksIn', () => {
  test('null sections returns null', () => {
    expect(computeWeeksIn(null)).toBeNull();
  });

  test('undefined sections returns null', () => {
    expect(computeWeeksIn(undefined)).toBeNull();
  });

  test('empty sections array returns 0', () => {
    expect(computeWeeksIn([])).toBe(0);
  });

  test('routine with no session_entries returns 0', () => {
    const sections = [makeSection([{ name: 'Squat', rows: [{ raw: '225x5', sets: [] }], session_entries: [], unparsed_rows: [] }])];
    expect(computeWeeksIn(sections)).toBe(0);
  });

  test('single exercise with 1 session entry returns 1', () => {
    const sections = [makeSection([makeExercise(1)])];
    expect(computeWeeksIn(sections)).toBe(1);
  });

  test('single exercise with 12 session entries returns 12', () => {
    const sections = [makeSection([makeExercise(12)])];
    expect(computeWeeksIn(sections)).toBe(12);
  });

  test('uses deepest exercise chain across exercises in one section', () => {
    const sections = [makeSection([makeExercise(3), makeExercise(7), makeExercise(2)])];
    expect(computeWeeksIn(sections)).toBe(7);
  });

  test('uses deepest chain across multiple sections (days)', () => {
    const sections = [
      makeSection([makeExercise(4)]),
      makeSection([makeExercise(9)]),
      makeSection([makeExercise(1)]),
    ];
    expect(computeWeeksIn(sections)).toBe(9);
  });

  test('counts skipped entries toward chain depth', () => {
    const sections = [makeSection([makeExercise(5, { skippedIndices: [1, 3] })])];
    expect(computeWeeksIn(sections)).toBe(5);
  });

  test('mixed routine uses longest chain, not average', () => {
    const sections = [makeSection([makeExercise(2), makeExercise(12), makeExercise(1)])];
    expect(computeWeeksIn(sections)).toBe(12);
  });
});

// ── deriveSkipData ────────────────────────────────────────────────────────────

function skipSection(heading, exercises) {
  return { heading, subheading: null, kind: 'lifting', exercises };
}

function skipExercise(name, entries, { raw_header = `-${name}` } = {}) {
  const session_entries = entries.map(e =>
    e === 'skip'
      ? { skipped: true, raw: '-', sets: [] }
      : { skipped: false, raw: '100x5', sets: Array.isArray(e) ? e : [{ weight_value: 100, rep_count: 5 }] }
  );
  return { name, raw_header, rows: [], session_entries, unparsed_rows: [] };
}

describe('deriveSkipData', () => {
  test('empty sections returns empty result', () => {
    const result = deriveSkipData([]);
    expect(result).toEqual({ exercise_skips: [], day_skips: [], attendance_flags: [] });
  });

  test('no session_entries returns empty result', () => {
    const section = skipSection(null, [
      { name: 'Squat', raw_header: '-Squat', rows: [{ raw: '225x5', sets: [] }], session_entries: [], unparsed_rows: [] },
    ]);
    expect(deriveSkipData([section])).toEqual({ exercise_skips: [], day_skips: [], attendance_flags: [] });
  });

  test('single skip → exercise_skip marker, no attendance flag', () => {
    const section = skipSection(null, [skipExercise('Squat', ['log', 'skip', 'log'])]);
    const { exercise_skips, attendance_flags } = deriveSkipData([section]);
    expect(exercise_skips).toHaveLength(1);
    expect(exercise_skips[0]).toMatchObject({ exercise_name: 'Squat', session_index: 1 });
    expect(attendance_flags).toHaveLength(0);
  });

  test('two consecutive skips → attendance flag with consecutive_count 2', () => {
    const section = skipSection(null, [skipExercise('Squat', ['log', 'skip', 'skip', 'log'])]);
    const { exercise_skips, attendance_flags } = deriveSkipData([section]);
    expect(exercise_skips).toHaveLength(2);
    expect(attendance_flags).toHaveLength(1);
    expect(attendance_flags[0]).toMatchObject({
      type: 'consecutive_exercise_skips',
      exercise_name: 'Squat',
      consecutive_count: 2,
    });
  });

  test('three consecutive skips → consecutive_count 3', () => {
    const section = skipSection(null, [skipExercise('Squat', ['skip', 'skip', 'skip'])]);
    const { attendance_flags } = deriveSkipData([section]);
    expect(attendance_flags[0]).toMatchObject({ consecutive_count: 3 });
  });

  test('non-consecutive skips (skip, log, skip) → no attendance flag', () => {
    const section = skipSection(null, [skipExercise('Squat', ['skip', 'log', 'skip'])]);
    const { exercise_skips, attendance_flags } = deriveSkipData([section]);
    expect(exercise_skips).toHaveLength(2);
    expect(attendance_flags).toHaveLength(0);
  });

  test('asterisked exercise excluded from skip tracking', () => {
    const section = skipSection(null, [
      skipExercise('Squat', ['skip', 'skip'], { raw_header: '-Squat*' }),
    ]);
    const { exercise_skips, attendance_flags } = deriveSkipData([section]);
    expect(exercise_skips).toHaveLength(0);
    expect(attendance_flags).toHaveLength(0);
  });

  test('asterisked exercise with * in name excluded', () => {
    const section = skipSection(null, [
      skipExercise('*Squat', ['skip', 'skip']),
    ]);
    expect(deriveSkipData([section]).exercise_skips).toHaveLength(0);
  });

  test('exercise_skips and day_skips are distinct structures', () => {
    const section = skipSection('Monday', [
      skipExercise('Squat', ['skip']),
      skipExercise('Deadlift', ['skip']),
    ]);
    const { exercise_skips, day_skips } = deriveSkipData([section]);
    expect(exercise_skips).toHaveLength(2);
    expect(day_skips).toHaveLength(1);
    expect(day_skips[0]).toMatchObject({ session_index: 0, weekday: 'monday' });
  });

  test('partial section skip (only some exercises skipped) → no day_skip', () => {
    const section = skipSection('Monday', [
      skipExercise('Squat', ['skip']),
      skipExercise('Deadlift', ['log']),
    ]);
    const { day_skips } = deriveSkipData([section]);
    expect(day_skips).toHaveLength(0);
  });

  test('day_skip weekday inferred from section heading containing day name', () => {
    const section = skipSection('Wednesday, May 21', [
      skipExercise('Squat', ['skip']),
    ]);
    const { day_skips } = deriveSkipData([section]);
    expect(day_skips[0].weekday).toBe('wednesday');
  });

  test('day_skip weekday inferred from ISO date in section heading', () => {
    // 2026-05-25 is a Monday
    const section = skipSection('2026-05-25', [
      skipExercise('Squat', ['skip']),
    ]);
    const { day_skips } = deriveSkipData([section]);
    expect(day_skips[0].weekday).toBe('monday');
  });

  test('day_skip weekday null when heading has no date or day name', () => {
    const section = skipSection('Leg Day', [
      skipExercise('Squat', ['skip']),
    ]);
    const { day_skips } = deriveSkipData([section]);
    expect(day_skips[0].weekday).toBeNull();
  });

  test('repeated weekday skip (2+) with dated headings within 30-day window → flag', () => {
    // 2026-05-11 and 2026-05-18 are both Mondays, both within 30 days of 2026-05-24
    const refDate = new Date('2026-05-24T12:00:00');
    const sections = [
      skipSection('2026-05-11', [skipExercise('Squat', ['skip']), skipExercise('Deadlift', ['skip'])]),
      skipSection('2026-05-18', [skipExercise('Squat', ['skip']), skipExercise('Deadlift', ['skip'])]),
    ];
    const { day_skips, attendance_flags } = deriveSkipData(sections, { referenceDate: refDate });
    expect(day_skips).toHaveLength(2);
    const weekdayFlag = attendance_flags.find(f => f.type === 'repeated_weekday_skip');
    expect(weekdayFlag).toBeDefined();
    expect(weekdayFlag.skip_count).toBe(2);
  });

  test('single fully-skipped weekday → no repeated_weekday_skip flag', () => {
    const refDate = new Date('2026-05-24T12:00:00');
    const section = skipSection('2026-05-18', [
      skipExercise('Squat', ['skip']),
      skipExercise('Deadlift', ['skip']),
    ]);
    const { attendance_flags } = deriveSkipData([section], { referenceDate: refDate });
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(false);
  });

  test('day skips outside 30-day window do not count toward weekday flag', () => {
    const refDate = new Date('2026-05-24T12:00:00');
    // 2026-03-20 and 2026-03-27 are both Fridays, but outside the 30-day window
    const sections = [
      skipSection('2026-03-20', [skipExercise('Squat', ['skip'])]),
      skipSection('2026-03-27', [skipExercise('Squat', ['skip'])]),
    ];
    const { attendance_flags } = deriveSkipData(sections, { referenceDate: refDate });
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(false);
  });

  test('day skip with undated heading does not count toward weekday flag', () => {
    // 'Monday' has no ISO date → can't apply rolling window → not counted
    const sections = [
      skipSection('Monday', [skipExercise('Squat', ['skip'])]),
      skipSection('Monday', [skipExercise('Squat', ['skip'])]),
    ];
    const { attendance_flags } = deriveSkipData(sections);
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(false);
  });

  test('missing history at a session index is not treated as a skip', () => {
    // Exercise A has 3 entries; exercise B has only 1. Position 1 and 2 have
    // no entry for B — that must not make position 1 or 2 a day_skip.
    const section = skipSection('2026-05-18', [
      skipExercise('Squat',    ['skip', 'skip', 'skip']),
      skipExercise('Deadlift', ['log']),
    ]);
    const { day_skips } = deriveSkipData([section]);
    // Only position 0 could be a day_skip, but Deadlift logged there → not a skip
    expect(day_skips).toHaveLength(0);
  });

  test('exercise_id populated for catalog exercises', () => {
    const section = skipSection(null, [skipExercise('Squat', ['skip'])]);
    const { exercise_skips } = deriveSkipData([section]);
    expect(exercise_skips[0].exercise_id).toBe('squat');
  });

  test('exercise_id null for non-catalog exercise', () => {
    const section = skipSection(null, [skipExercise('Bulgarian Split Squat', ['skip'])]);
    const { exercise_skips } = deriveSkipData([section]);
    expect(exercise_skips[0].exercise_id).toBeNull();
  });

  test('different exercises across sections produce independent flags', () => {
    const sections = [
      skipSection('Monday', [skipExercise('Squat', ['skip', 'skip'])]),
      skipSection('Wednesday', [skipExercise('Deadlift', ['log', 'log'])]),
    ];
    const { exercise_skips, attendance_flags } = deriveSkipData(sections);
    expect(exercise_skips).toHaveLength(2);
    const sqFlag = attendance_flags.find(f => f.exercise_name === 'Squat');
    expect(sqFlag).toBeDefined();
    expect(attendance_flags.find(f => f.exercise_name === 'Deadlift')).toBeUndefined();
  });

  test('cross-section consecutive skips for same exercise → flag', () => {
    // Squat has 1 skip in Monday section, 1 skip in Wednesday section.
    // Consecutive streak spans sections → should flag.
    const sections = [
      skipSection('Monday',    [skipExercise('Squat', ['skip'])]),
      skipSection('Wednesday', [skipExercise('Squat', ['skip'])]),
    ];
    const { attendance_flags } = deriveSkipData(sections);
    const flag = attendance_flags.find(f => f.type === 'consecutive_exercise_skips' && f.exercise_name === 'Squat');
    expect(flag).toBeDefined();
    expect(flag.consecutive_count).toBe(2);
  });

  test('cross-section skip–log–skip (non-consecutive) → no flag', () => {
    const sections = [
      skipSection('Monday',    [skipExercise('Squat', ['skip'])]),
      skipSection('Wednesday', [skipExercise('Squat', ['log'])]),
      skipSection('Friday',    [skipExercise('Squat', ['skip'])]),
    ];
    const { attendance_flags } = deriveSkipData(sections);
    expect(attendance_flags.some(f => f.type === 'consecutive_exercise_skips')).toBe(false);
  });

  test('rename continuity: catalog alias in different sections merges under same id', () => {
    // 'Back Squat' canonicalizes to 'Squat' (same exercise_id 'squat').
    // One skip as 'Squat', one skip as 'Back Squat' → consecutive → flag.
    const sections = [
      skipSection('Monday',    [skipExercise('Squat',      ['skip'])]),
      skipSection('Wednesday', [skipExercise('Back Squat', ['skip'])]),
    ];
    const { attendance_flags } = deriveSkipData(sections);
    const flag = attendance_flags.find(f => f.type === 'consecutive_exercise_skips');
    expect(flag).toBeDefined();
    expect(flag.consecutive_count).toBe(2);
  });

  test('all-logged exercise → no exercise_skips and no flags', () => {
    const section = skipSection(null, [skipExercise('Squat', ['log', 'log', 'log'])]);
    const { exercise_skips, attendance_flags } = deriveSkipData([section]);
    expect(exercise_skips).toHaveLength(0);
    expect(attendance_flags).toHaveLength(0);
  });

  test('day_skips carry date field from ISO heading', () => {
    const section = skipSection('2026-05-18', [skipExercise('Squat', ['skip'])]);
    const { day_skips } = deriveSkipData([section]);
    expect(day_skips[0].date).toBe('2026-05-18');
  });

  test('day_skips date null when heading has no ISO date', () => {
    const section = skipSection('Monday', [skipExercise('Squat', ['skip'])]);
    const { day_skips } = deriveSkipData([section]);
    expect(day_skips[0].date).toBeNull();
  });
});

// ── makeWorkoutNoteItem skip fields ───────────────────────────────────────────

describe('makeWorkoutNoteItem skip fields', () => {
  test('new note item has skip_markers and attendance_flags initialised to null', () => {
    const item = makeWorkoutNoteItem({ title: 'Test', raw_text: '' });
    expect(item).toHaveProperty('skip_markers', null);
    expect(item).toHaveProperty('attendance_flags', null);
  });

  test('new note item has rep_drop_off_flags and dismissed_nudges initialised to null', () => {
    const item = makeWorkoutNoteItem({ title: 'Test', raw_text: '' });
    expect(item).toHaveProperty('rep_drop_off_flags', null);
    expect(item).toHaveProperty('dismissed_nudges', null);
  });
});

// ── computeRepDropOff ─────────────────────────────────────────────────────────

describe('computeRepDropOff', () => {
  test('null sets → null', () => {
    expect(computeRepDropOff(null)).toBeNull();
  });

  test('empty sets → null', () => {
    expect(computeRepDropOff([])).toBeNull();
  });

  test('single working set → null (single-set rule)', () => {
    expect(computeRepDropOff([{ weight_value: 225, rep_count: 8 }])).toBeNull();
  });

  test('drop_off ≥ 3 → hit_wall (first 8, last 4, drop=4)', () => {
    const sets = [
      { weight_value: 225, rep_count: 8 },
      { weight_value: 225, rep_count: 6 },
      { weight_value: 225, rep_count: 4 },
    ];
    expect(computeRepDropOff(sets)).toBe('hit_wall');
  });

  test('drop_off exactly 3 → hit_wall (boundary)', () => {
    const sets = [
      { weight_value: 225, rep_count: 8 },
      { weight_value: 225, rep_count: 5 },
    ];
    expect(computeRepDropOff(sets)).toBe('hit_wall');
  });

  test('drop_off = 2 → null (no flag)', () => {
    const sets = [
      { weight_value: 225, rep_count: 8 },
      { weight_value: 225, rep_count: 6 },
    ];
    expect(computeRepDropOff(sets)).toBeNull();
  });

  test('drop_off ≤ 1 → in_reserve (first 8, last 8, drop=0)', () => {
    const sets = [
      { weight_value: 225, rep_count: 8 },
      { weight_value: 225, rep_count: 8 },
    ];
    expect(computeRepDropOff(sets)).toBe('in_reserve');
  });

  test('drop_off exactly 1 → in_reserve (boundary)', () => {
    const sets = [
      { weight_value: 225, rep_count: 8 },
      { weight_value: 225, rep_count: 7 },
    ];
    expect(computeRepDropOff(sets)).toBe('in_reserve');
  });

  test('negative drop_off (reps increased) → in_reserve', () => {
    const sets = [
      { weight_value: 225, rep_count: 6 },
      { weight_value: 225, rep_count: 8 },
    ];
    expect(computeRepDropOff(sets)).toBe('in_reserve');
  });

  test('mixed weight: only 1 set at heaviest → null (ambiguous)', () => {
    const sets = [
      { weight_value: 200, rep_count: 8 },
      { weight_value: 200, rep_count: 8 },
      { weight_value: 225, rep_count: 6 },
    ];
    expect(computeRepDropOff(sets)).toBeNull();
  });

  test('mixed weight: multiple sets at heaviest used for computation', () => {
    // Lighter sets: 200×8,8 — ignored
    // Heaviest sets: 225×8, 225×4 → drop=4 → hit_wall
    const sets = [
      { weight_value: 200, rep_count: 8 },
      { weight_value: 200, rep_count: 8 },
      { weight_value: 225, rep_count: 8 },
      { weight_value: 225, rep_count: 4 },
    ];
    expect(computeRepDropOff(sets)).toBe('hit_wall');
  });

  test('sets with weight_value=0 excluded (bodyweight/unweighted excluded)', () => {
    const sets = [
      { weight_value: 0, rep_count: 10 },
      { weight_value: 0, rep_count: 10 },
    ];
    expect(computeRepDropOff(sets)).toBeNull();
  });

  test('sets with rep_count=0 excluded', () => {
    const sets = [
      { weight_value: 225, rep_count: 0 },
      { weight_value: 225, rep_count: 0 },
    ];
    expect(computeRepDropOff(sets)).toBeNull();
  });
});

// ── deriveRepDropOffFlags ─────────────────────────────────────────────────────

function dropOffSection(name, sessionEntries) {
  const session_entries = sessionEntries.map(e =>
    e === 'skip'
      ? { skipped: true, raw: '-', sets: [] }
      : { skipped: false, raw: 'x', sets: Array.isArray(e) ? e : [e] }
  );
  return {
    heading: null, subheading: null, kind: 'general',
    exercises: [{ name, rows: [], sets: [], unparsed_rows: [], session_entries }],
  };
}

function ws(weight, rep_count) { return { weight_value: weight, rep_count }; }

describe('deriveRepDropOffFlags', () => {
  test('exercise not in note → empty object', () => {
    const sections = [dropOffSection('Bench Press', [[ws(135, 8), ws(135, 8)]])];
    const result = deriveRepDropOffFlags(sections, ['Squat']);
    expect(result['squat']).toEqual({});
  });

  test('single logged session → keyed at index 0', () => {
    const sections = [dropOffSection('Squat', [
      [ws(225, 8), ws(225, 4)],
    ])];
    const result = deriveRepDropOffFlags(sections, ['Squat']);
    expect(result['squat']).toEqual({ '0': 'hit_wall' });
  });

  test('skipped sessions excluded from map; logged sessions keyed by position', () => {
    // session 0: logged (hit_wall), session 1: skip (excluded), session 2: logged (in_reserve)
    const sections = [dropOffSection('Squat', [
      [ws(225, 8), ws(225, 4)],
      'skip',
      [ws(225, 8), ws(225, 8)],
    ])];
    const result = deriveRepDropOffFlags(sections, ['Squat']);
    expect(result['squat']).toEqual({ '0': 'hit_wall', '2': 'in_reserve' });
  });

  test('multiple logged sessions stored per-session', () => {
    const sections = [dropOffSection('Squat', [
      [ws(225, 8), ws(225, 4)],  // idx 0 → hit_wall
      [ws(225, 8), ws(225, 6)],  // idx 1 → null (drop=2)
      [ws(225, 8), ws(225, 8)],  // idx 2 → in_reserve
    ])];
    const result = deriveRepDropOffFlags(sections, ['Squat']);
    expect(result['squat']).toEqual({ '0': 'hit_wall', '1': null, '2': 'in_reserve' });
  });

  test('all sessions skipped → empty object', () => {
    const sections = [dropOffSection('Squat', ['skip', 'skip'])];
    const result = deriveRepDropOffFlags(sections, ['Squat']);
    expect(result['squat']).toEqual({});
  });

  test('returns per-session map for multiple tracked exercises', () => {
    const sections = [
      dropOffSection('Squat', [[ws(225, 8), ws(225, 4)]]),
      dropOffSection('Deadlift', [[ws(315, 8), ws(315, 8)]]),
    ];
    const result = deriveRepDropOffFlags(sections, ['Squat', 'Deadlift']);
    expect(result['squat']).toEqual({ '0': 'hit_wall' });
    expect(result['deadlift']).toEqual({ '0': 'in_reserve' });
  });

  test('untracked exercise not in result', () => {
    const sections = [
      dropOffSection('Squat', [[ws(225, 8), ws(225, 4)]]),
      dropOffSection('Bench Press', [[ws(135, 8), ws(135, 4)]]),
    ];
    const result = deriveRepDropOffFlags(sections, ['Squat']);
    expect(result['squat']).toEqual({ '0': 'hit_wall' });
    expect(result['bench press']).toBeUndefined();
  });
});

// ── getLatestRepDropOff ───────────────────────────────────────────────────────

describe('getLatestRepDropOff', () => {
  test('null → null', () => {
    expect(getLatestRepDropOff(null)).toBeNull();
  });

  test('undefined → null', () => {
    expect(getLatestRepDropOff(undefined)).toBeNull();
  });

  test('empty object → null', () => {
    expect(getLatestRepDropOff({})).toBeNull();
  });

  test('single session returns its flag', () => {
    expect(getLatestRepDropOff({ '0': 'hit_wall' })).toBe('hit_wall');
  });

  test('returns flag from highest-index session', () => {
    expect(getLatestRepDropOff({ '0': 'hit_wall', '1': null, '2': 'in_reserve' })).toBe('in_reserve');
  });

  test('most recent session null (drop=2) → null', () => {
    expect(getLatestRepDropOff({ '0': 'hit_wall', '1': null })).toBeNull();
  });

  test('skipped sessions (absent keys) do not affect result', () => {
    // session 0 logged, session 1 skipped (absent), session 2 logged
    expect(getLatestRepDropOff({ '0': 'hit_wall', '2': 'in_reserve' })).toBe('in_reserve');
  });
});

// ── detectBig3Asymmetry ───────────────────────────────────────────────────────

// Build a section with a dated heading and explicit session_entries per exercise.
// sets: { weight_value, rep_count }[]
function asymSection(dateStr, exerciseSets) {
  // exerciseSets: { name: string, sets: { weight_value, rep_count }[] }[]
  const exercises = exerciseSets.map(({ name, sets }) => ({
    name,
    rows: [],
    sets: [],
    session_entries: [{ skipped: false, raw: 'x', sets }],
    unparsed_rows: [],
  }));
  return { heading: `Tuesday ${dateStr}`, subheading: null, kind: 'general', exercises };
}

function s(weight, reps) { return { weight_value: weight, rep_count: reps }; }

describe('detectBig3Asymmetry', () => {
  test('empty sections → no notes', () => {
    expect(detectBig3Asymmetry([])).toEqual([]);
  });

  test('single week of data → no notes (< 2 consecutive weeks)', () => {
    // Only one week so the classification series has 1 row — can't sustain 2 weeks.
    const sections = [
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(225, 5), s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8), s(100, 8)] },
      ]),
    ];
    expect(detectBig3Asymmetry(sections)).toEqual([]);
  });

  test('asymmetry sustained 2 weeks → note fires', () => {
    // Week 0 baseline (gives each lift its first session), Week 1 and Week 2 create asymmetry.
    // Squat increases each week (progressing). Bench stays flat (stalled).
    const sections = [
      // Baseline session — gives each lift a starting point
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Week 1: squat up → progressing; bench flat → stalled
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Week 2: squat up again → progressing; bench still flat → stalled
      asymSection('2024-01-08', [
        { name: 'Squat', sets: [s(245, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];
    const notes = detectBig3Asymmetry(sections);
    expect(notes.length).toBe(1);
    expect(notes[0].copy).toContain('progressing');
    expect(notes[0].copy).toContain('stalled');
    expect(notes[0].copy).toContain('worth reviewing');
    expect(notes[0].dismissKey).toMatch(/asymmetry:squat_bench:/);
  });

  test('asymmetry only 1 consecutive week → no note', () => {
    // Week 1 asymmetric, week 2 not (both stalled).
    const sections = [
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Week 1: squat up (progressing), bench flat (stalled)
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Week 2: both flat (squat stalled, bench stalled) — asymmetry breaks
      asymSection('2024-01-08', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];
    const notes = detectBig3Asymmetry(sections);
    expect(notes).toEqual([]);
  });

  test('dismissed note is suppressed when dismissKey matches', () => {
    const sections = [
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      asymSection('2024-01-08', [
        { name: 'Squat', sets: [s(245, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];
    // First get the key from the active note.
    const [note] = detectBig3Asymmetry(sections);
    expect(note).toBeDefined();
    // Dismiss it.
    const dismissed = { [note.dismissKey]: true };
    expect(detectBig3Asymmetry(sections, dismissed)).toEqual([]);
  });

  test('note re-fires after relationship breaks and re-emerges (new runStart)', () => {
    // Session order: baseline → asymmetric run A → break → asymmetric run B
    // The dismiss key from run A encodes run A's start week.
    // When run B is active, its start week differs → note re-fires.
    const sections = [
      // Baseline
      asymSection('2023-12-18', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Run A week 1: squat progresses, bench stalls
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Run A week 2: squat progresses, bench stalls → trigger (runStart = 2023-12-25)
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(245, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Break: squat stalls, bench progresses → both could show asymmetry the OTHER way
      // Actually let's make both stalled → clean break
      asymSection('2024-01-08', [
        { name: 'Squat', sets: [s(245, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Run B week 1: squat progresses, bench stalls again
      asymSection('2024-01-15', [
        { name: 'Squat', sets: [s(255, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Run B week 2: squat progresses, bench stalls → new trigger (runStart = 2024-01-15)
      asymSection('2024-01-22', [
        { name: 'Squat', sets: [s(265, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];

    // Simulate dismiss during run A (runStart = 2023-12-25 = Monday)
    const runADismissKey = 'asymmetry:squat_bench:2023-12-25';
    const dismissed = { [runADismissKey]: true };

    // After run B emerges, the note should re-fire because runStart changed.
    const notes = detectBig3Asymmetry(sections, dismissed);
    expect(notes.length).toBe(1);
    expect(notes[0].dismissKey).not.toBe(runADismissKey);
    expect(notes[0].dismissKey).toContain('2024-01-15');
  });

  test('regressing lift triggers note', () => {
    const sections = [
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'Deadlift', sets: [s(315, 5)] },
      ]),
      // Week 1: squat up (progressing), deadlift drops (regressing)
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'Deadlift', sets: [s(305, 5)] },
      ]),
      // Week 2: squat up (progressing), deadlift drops again (regressing)
      asymSection('2024-01-08', [
        { name: 'Squat', sets: [s(245, 5)] },
        { name: 'Deadlift', sets: [s(295, 5)] },
      ]),
    ];
    const notes = detectBig3Asymmetry(sections);
    expect(notes.length).toBe(1);
    expect(notes[0].copy).toContain('regressing');
  });

  test('copy matches documented pattern', () => {
    const sections = [
      asymSection('2023-12-25', [
        { name: 'Deadlift', sets: [s(315, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      asymSection('2024-01-01', [
        { name: 'Deadlift', sets: [s(325, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      asymSection('2024-01-08', [
        { name: 'Deadlift', sets: [s(335, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];
    const [note] = detectBig3Asymmetry(sections);
    expect(note.copy).toBe('Deadlift progressing, bench stalled — worth reviewing.');
  });

  test('null/initial week does not break the run or reset dismissKey', () => {
    // 3 asymmetric weeks with a null-classification week in the middle.
    // The null week (only 1 session logged → initial) must NOT reset runStart.
    // The dismissed key from the first asymmetric week must still suppress the note.
    const sections = [
      // Baseline
      asymSection('2023-12-18', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Week 1: squat progresses, bench stalls → asymmetric, runStart=2023-12-25
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Week 2: only squat logged — bench classification will be null (no bench entry)
      // This should NOT reset the run.
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(245, 5)] },
      ]),
      // Week 3: squat progresses, bench stalls again → asymmetric, runCount reaches 2
      asymSection('2024-01-08', [
        { name: 'Squat', sets: [s(255, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];
    const notes = detectBig3Asymmetry(sections);
    expect(notes.length).toBe(1);
    // runStart should still be 2023-12-25 (null week did not reset it)
    expect(notes[0].dismissKey).toContain('2023-12-25');

    // Dismissing with the original runStart key must suppress the note.
    const dismissed = { [notes[0].dismissKey]: true };
    expect(detectBig3Asymmetry(sections, dismissed)).toEqual([]);
  });
});

// ── currentWeekStart ──────────────────────────────────────────────────────────

describe('currentWeekStart', () => {
  test('Sunday returns itself', () => {
    // 2026-05-24 is a Sunday
    expect(currentWeekStart(new Date('2026-05-24T12:00:00'))).toBe('2026-05-24');
  });

  test('Monday returns previous Sunday', () => {
    // 2026-05-25 is a Monday → week starts 2026-05-24
    expect(currentWeekStart(new Date('2026-05-25T12:00:00'))).toBe('2026-05-24');
  });

  test('Saturday returns 6 days prior Sunday', () => {
    // 2026-05-30 is a Saturday → week starts 2026-05-24
    expect(currentWeekStart(new Date('2026-05-30T12:00:00'))).toBe('2026-05-24');
  });

  test('Wednesday mid-week returns correct Sunday', () => {
    // 2026-05-27 is a Wednesday → week starts 2026-05-24
    expect(currentWeekStart(new Date('2026-05-27T12:00:00'))).toBe('2026-05-24');
  });

  test('returns YYYY-MM-DD string format', () => {
    const result = currentWeekStart(new Date('2026-01-01T12:00:00'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('early-morning timestamp the day after DST spring-forward returns correct Sunday', () => {
    // 2026-03-08 is US spring-forward Sunday; 2026-03-09 00:30 is Monday early morning.
    // Fixed-offset arithmetic (86400000ms) fails here in DST timezones; setDate() does not.
    const result = currentWeekStart(new Date('2026-03-09T00:30:00'));
    expect(result).toBe('2026-03-08');
  });
});

// ── rollingWindowStart ────────────────────────────────────────────────────────

describe('rollingWindowStart', () => {
  test('30-day window: start is 29 days before reference (inclusive both ends)', () => {
    // ref = 2026-05-24, window start = 2026-04-25
    expect(rollingWindowStart(new Date('2026-05-24T12:00:00'), 30)).toBe('2026-04-25');
  });

  test('1-day window: start equals reference date', () => {
    expect(rollingWindowStart(new Date('2026-05-24T12:00:00'), 1)).toBe('2026-05-24');
  });

  test('7-day window: start is 6 days before reference', () => {
    // ref = 2026-05-24, 7-day window starts 2026-05-18
    expect(rollingWindowStart(new Date('2026-05-24T12:00:00'), 7)).toBe('2026-05-18');
  });

  test('returns YYYY-MM-DD string format', () => {
    const result = rollingWindowStart(new Date('2026-03-01T12:00:00'), 30);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('window spanning month boundary returns correct date', () => {
    // ref = 2026-03-05, 30-day window starts 2026-02-04
    expect(rollingWindowStart(new Date('2026-03-05T12:00:00'), 30)).toBe('2026-02-04');
  });

  test('early-morning timestamp the day after DST spring-forward returns correct window start', () => {
    // ref = 2026-03-09T00:30 (Monday after spring-forward); 30-day window starts 2026-02-08.
    // Fixed-offset arithmetic (86400000ms) fails here in DST timezones; setDate() does not.
    expect(rollingWindowStart(new Date('2026-03-09T00:30:00'), 30)).toBe('2026-02-08');
  });
});

// ── computeWeeksIn session semantics ──────────────────────────────────────────
// Regression coverage for the session/routine-depth distinction.
// computeWeeksIn counts session_entries depth only; exercises with bare rows
// but no session_entries contribute 0. This differs from day-aware session
// counting (countWorkoutSessionsFromSections in parser.js) which uses rows too.

describe('computeWeeksIn plain-row vs session-entry distinction', () => {
  test('exercise with bare rows only and no session_entries contributes 0 depth', () => {
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name: 'Squat', rows: [{ raw: '225x5', sets: [] }], session_entries: [], unparsed_rows: [] }],
    }];
    expect(computeWeeksIn(sections)).toBe(0);
  });

  test('mixed: one exercise with session_entries, one with only bare rows — uses session_entries depth', () => {
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [
        { name: 'Squat', rows: [], session_entries: [{ skipped: false, raw: '225x5', sets: [{ weight_value: 225, rep_count: 5 }] }, { skipped: false, raw: '235x5', sets: [{ weight_value: 235, rep_count: 5 }] }], unparsed_rows: [] },
        { name: 'Deadlift', rows: [{ raw: '315x5', sets: [] }], session_entries: [], unparsed_rows: [] },
      ],
    }];
    // Squat has depth 2; Deadlift has depth 0 (bare rows only)
    expect(computeWeeksIn(sections)).toBe(2);
  });

  test('undated routine with session_entries counted correctly', () => {
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name: 'Bench Press', rows: [], session_entries: Array.from({ length: 5 }, () => ({ skipped: false, raw: '185x8', sets: [{ weight_value: 185, rep_count: 8 }] })), unparsed_rows: [] }],
    }];
    expect(computeWeeksIn(sections)).toBe(5);
  });

  test('dated-heading section (ISO date in heading) counted same as undated', () => {
    const sections = [{
      heading: '2026-05-19', subheading: null, kind: 'lifting',
      exercises: [{ name: 'Squat', rows: [], session_entries: [{ skipped: false, raw: '225x5', sets: [{ weight_value: 225, rep_count: 5 }] }, { skipped: false, raw: '225x5', sets: [{ weight_value: 225, rep_count: 5 }] }, { skipped: false, raw: '225x5', sets: [{ weight_value: 225, rep_count: 5 }] }], unparsed_rows: [] }],
    }];
    expect(computeWeeksIn(sections)).toBe(3);
  });
});

// ── deriveSkipData uses rollingWindowStart (attendance window) ────────────────
// Regression coverage confirming the 30-day attendance window boundary uses
// the canonical rollingWindowStart semantics.

describe('deriveSkipData attendance window boundary (rollingWindowStart regression)', () => {
  test('skip exactly on window start date is counted toward weekday flag', () => {
    // ref = 2026-05-24; 30-day window starts 2026-04-25
    const refDate = new Date('2026-05-24T12:00:00');
    const windowStart = rollingWindowStart(refDate, 30); // '2026-04-25' (a Saturday)
    // Two fully-skipped Saturdays: one on the boundary, one inside
    const sections = [
      { heading: windowStart, subheading: null, kind: 'lifting', exercises: [
        { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
        { name: 'Deadlift', raw_header: '-Deadlift', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
      ]},
      { heading: '2026-05-02', subheading: null, kind: 'lifting', exercises: [
        { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
        { name: 'Deadlift', raw_header: '-Deadlift', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
      ]},
    ];
    const { attendance_flags } = deriveSkipData(sections, { referenceDate: refDate });
    const weekdayFlag = attendance_flags.find(f => f.type === 'repeated_weekday_skip');
    expect(weekdayFlag).toBeDefined();
    expect(weekdayFlag.skip_count).toBe(2);
  });

  test('skip one day before window start is excluded from weekday flag', () => {
    // ref = 2026-05-24; 30-day window starts 2026-04-25
    // A skip on 2026-04-24 (one day before) should be excluded
    const refDate = new Date('2026-05-24T12:00:00');
    const sections = [
      { heading: '2026-04-24', subheading: null, kind: 'lifting', exercises: [
        { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
      ]},
      { heading: '2026-05-01', subheading: null, kind: 'lifting', exercises: [
        { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
      ]},
    ];
    const { attendance_flags } = deriveSkipData(sections, { referenceDate: refDate });
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(false);
  });
});
