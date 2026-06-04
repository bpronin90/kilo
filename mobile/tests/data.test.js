import { computeWeightTrends, computeWeightPaceLevel, computeWeightTrendSummary, computeKiloMax, makeWorkoutNoteItem, normalizeLiftName, listTrackedLifts, getDefaultTrackedNames, computeWeeksIn, classifyExerciseSessions, deriveSkipData, computeRepDropOff, deriveRepDropOffFlags, getLatestRepDropOff, rollingWindowStart, computeWeeklySummary, WEIGHT_PACE_NOTABLE_THRESHOLD, WEIGHT_PACE_SPIKE_THRESHOLD, resolveGoalCurrentWeight, REPEATED_WEEKDAY_SKIP_SESSION_WINDOW, deriveWorkoutNoteAnalytics, deriveSignals, deriveWeightGoalAnalytics, computeBMR, computeTDEE, ageFromDateOfBirth, isProfileComplete, ACTIVITY_MULTIPLIERS, computeCalorieEstimate, computeWeightGoal, computeWeightRollingAverageSeries, deriveNonWeightedTrackedExerciseMetrics, derive1kTotal, derive1kTotalSeries, deriveSessionCheckIn, deriveCheckInHistory } from '../lib/data';


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

  test('progressing — same weight, total reps at top weight increased', () => {
    // prior [5,5,5]=15, latest [5,5,6]=16 → total increased → progressing
    const sections = [classifSection('Squat', [
      [w(225, 5), w(225, 5), w(225, 5)],
      [w(225, 5), w(225, 5), w(225, 6)],
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('progressing');
  });

  test('NOT progressing — same weight, same total reps (even if distribution shifts)', () => {
    // prior [5,5]=10, latest [6,4]=10 → same total → not progressing
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

  test('regressing — same weight, total reps at top weight decreased', () => {
    // prior [8,8]=16, latest [4,4]=8 → total decreased → regressing
    const sections = [classifSection('Squat', [
      [w(225, 8), w(225, 8)],
      [w(225, 4), w(225, 4)],
    ])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('regressing');
  });

  test('NOT regressing — same weight, same total reps', () => {
    // prior [5,5]=10, latest [6,4]=10 → same total → not regressing
    const sections = [classifSection('Squat', [
      [w(225, 5), w(225, 5)],
      [w(225, 6), w(225, 4)],
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

  test('inconsistent — 2+ skips in window leave only 1 logged session', () => {
    // [skip, skip, w(225,6)] → logged.length=1, window has skips → inconsistent
    const sections = [classifSection('Squat', ['skip', 'skip', w(225, 6)])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('inconsistent');
  });

  test('skip with 2 logged sessions — compares normally, does not fall through to inconsistent', () => {
    // prior: 225×7, skip, latest: 225×6 → logged.length=2, top same, total 7→6 → regressing
    const sections = [classifSection('Squat', [w(225, 7), 'skip', w(225, 6)])];
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('regressing');
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

  test('plain rows after session_entries treated as current session (newest entry)', () => {
    // Simulates: "- 225 5,5,5,5" (history) + "-" (skip) + "235 5,5,5,5" (current plain row)
    // rows[0] = history row matching session_entries[0]; rows[1] = plain current session
    const histRow = { raw: '225 5,5,5,5', sets: [w(225, 5), w(225, 5), w(225, 5), w(225, 5)] };
    const plainRow = { raw: '235 5,5,5,5', sets: [w(235, 5), w(235, 5), w(235, 5), w(235, 5)] };
    const sections = [{ heading: null, subheading: null, kind: 'general', exercises: [{
      name: 'Squat',
      rows: [histRow, plainRow],
      sets: [],
      unparsed_rows: [],
      session_entries: [
        { skipped: false, raw: '225 5,5,5,5', sets: [w(225, 5), w(225, 5), w(225, 5), w(225, 5)] },
        { skipped: true, raw: '-', sets: [] },
      ],
    }]}];
    // window: [logged(225), skip, plain(235)] → logged=[225,235] → top 235>225 → progressing
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('progressing');
  });

  test('skip as last session_entry with plain current row: not inconsistent', () => {
    // Without the plain row fix, [logged(225), skip] → logged.length=1 → inconsistent
    // With fix, plain row is appended → [logged(225), skip, plain(235)] → progressing
    const histRow = { raw: '225 5,5,5,5', sets: [w(225, 5)] };
    const plainRow = { raw: '225 5,5,5,5', sets: [w(225, 5)] };
    const sections = [{ heading: null, subheading: null, kind: 'general', exercises: [{
      name: 'Squat',
      rows: [histRow, plainRow],
      sets: [],
      unparsed_rows: [],
      session_entries: [
        { skipped: false, raw: '225 5,5,5,5', sets: [w(225, 5)] },
        { skipped: true, raw: '-', sets: [] },
      ],
    }]}];
    // Window: [logged(225), skip, plain(225)] → logged=[225,225] → same top, same total → stalled
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).toBe('stalled');
    expect(classifyExerciseSessions(sections, ['Squat'])['squat']).not.toBe('inconsistent');
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

  test('routine with no session_entries but with plain rows returns rows.length', () => {
    const sections = [makeSection([{ name: 'Squat', rows: [{ raw: '225x5', sets: [] }], session_entries: [], unparsed_rows: [] }])];
    expect(computeWeeksIn(sections)).toBe(1);
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

  test('all exercises with session_entries are eligible for skip tracking (no asterisk exclusion)', () => {
    const section = skipSection(null, [
      skipExercise('Squat', ['skip', 'skip'], { raw_header: '-Squat*' }),
    ]);
    const { exercise_skips } = deriveSkipData([section]);
    expect(exercise_skips).toHaveLength(2);
  });

  test('exercise with * in name is eligible for skip tracking', () => {
    const section = skipSection(null, [
      skipExercise('*Squat', ['skip', 'skip']),
    ]);
    expect(deriveSkipData([section]).exercise_skips).toHaveLength(2);
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

  test('repeated weekday skip (2+) with dated headings → flag (session-depth, no date required)', () => {
    // Two Monday sections, each with one fully-skipped session at index 0.
    // Session-depth window covers both → flag generated without calendar check.
    const sections = [
      skipSection('2026-05-11', [skipExercise('Squat', ['skip']), skipExercise('Deadlift', ['skip'])]),
      skipSection('2026-05-18', [skipExercise('Squat', ['skip']), skipExercise('Deadlift', ['skip'])]),
    ];
    const { day_skips, attendance_flags } = deriveSkipData(sections);
    expect(day_skips).toHaveLength(2);
    const weekdayFlag = attendance_flags.find(f => f.type === 'repeated_weekday_skip');
    expect(weekdayFlag).toBeDefined();
    expect(weekdayFlag.skip_count).toBe(2);
  });

  test('single fully-skipped weekday → no repeated_weekday_skip flag', () => {
    const section = skipSection('2026-05-18', [
      skipExercise('Squat', ['skip']),
      skipExercise('Deadlift', ['skip']),
    ]);
    const { attendance_flags } = deriveSkipData([section]);
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(false);
  });

  test('day skips outside session-depth window do not count toward weekday flag', () => {
    // Monday slot has been trained 10+ times. Skips at positions 0 and 1.
    // The last REPEATED_WEEKDAY_SKIP_SESSION_WINDOW sessions have no skips → no flag.
    const depth = REPEATED_WEEKDAY_SKIP_SESSION_WINDOW + 2; // 10 entries
    const entries = Array.from({ length: depth }, (_, i) => (i < 2 ? 'skip' : 'log'));
    const section = skipSection('Monday', [
      skipExercise('Squat', entries),
      skipExercise('Deadlift', entries),
    ]);
    const { attendance_flags } = deriveSkipData([section]);
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(false);
  });

  test('day skip with weekday-named heading (no date) counts toward weekday flag', () => {
    // Session-depth detection uses weekday from heading name; no ISO date required.
    const sections = [
      skipSection('Monday', [skipExercise('Squat', ['skip'])]),
      skipSection('Monday', [skipExercise('Squat', ['skip'])]),
    ];
    const { attendance_flags } = deriveSkipData(sections);
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(true);
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

  test('new note item has session_checkins and dismissed_nudges initialised to null', () => {
    const item = makeWorkoutNoteItem({ title: 'Test', raw_text: '' });
    expect(item).toHaveProperty('session_checkins', null);
    expect(item).toHaveProperty('dismissed_nudges', null);
  });

  test('new note item no longer carries rep_drop_off_flags', () => {
    const item = makeWorkoutNoteItem({ title: 'Test', raw_text: '' });
    expect(item).not.toHaveProperty('rep_drop_off_flags');
  });

  test('new note item has exercise_classifications initialised to null', () => {
    const item = makeWorkoutNoteItem({ title: 'Test', raw_text: '' });
    expect(item).toHaveProperty('exercise_classifications', null);
  });
});

// ── exercise_classifications producer completeness ────────────────────────────
// These tests document the two input paths to the LogScreen save-path producer:
// (1) user has explicitly tracked exercises → use those names
// (2) user has never tracked anything (trackedLifts empty) → fall back to catalog defaults
// The fix prevents exercise_classifications from always being {} for new users.

function makeSessionSection(name, sets) {
  return {
    heading: null, subheading: null, kind: 'general',
    exercises: [{
      name,
      rows: [],
      sets: [],
      session_entries: [{ skipped: false, raw: 'x', sets }],
      unparsed_rows: [],
    }],
  };
}

describe('exercise_classifications producer completeness', () => {
  test('empty trackedNames → classifyExerciseSessions returns {} (old broken path: no exercises classified)', () => {
    const sections = [makeSessionSection('Squat', [{ weight_value: 225, rep_count: 5 }])];
    expect(classifyExerciseSessions(sections, [])).toEqual({});
  });

  test('getDefaultTrackedNames returns a non-empty list (fallback has content)', () => {
    expect(getDefaultTrackedNames().length).toBeGreaterThan(0);
  });

  test('classifyExerciseSessions with defaultTrackedNames classifies catalog exercises present in note', () => {
    const defaults = getDefaultTrackedNames();
    const sections = [makeSessionSection('Squat', [{ weight_value: 225, rep_count: 5 }])];
    const result = classifyExerciseSessions(sections, defaults);
    // At least the 'squat' normalized key should be present since Squat is a catalog default
    expect(Object.keys(result)).toContain('squat');
  });

  test('classifyExerciseSessions with defaultTrackedNames does not error for exercises absent from note', () => {
    // Exercises in the default list that are not in the note produce null, not an error.
    const defaults = getDefaultTrackedNames();
    const sections = [makeSessionSection('Squat', [{ weight_value: 225, rep_count: 5 }])];
    const result = classifyExerciseSessions(sections, defaults);
    const values = Object.values(result);
    // All values must be a valid classification or null — no thrown errors, no undefined
    for (const v of values) {
      expect(['progressing', 'stalled', 'regressing', 'inconsistent', 'initial', null]).toContain(v);
    }
  });

  test('union: default names always included even when explicit tracked names are non-empty', () => {
    // Simulates the real save-path: user has 1 explicitly tracked exercise.
    // The producer must still classify ALL defaults, not just the 1 explicit entry.
    const defaults = getDefaultTrackedNames();
    const normalizedDefaults = new Set(defaults.map(n => normalizeLiftName(n)));
    const explicitOne = ['Squat']; // only one tracked
    const extra = explicitOne.filter(n => !normalizedDefaults.has(normalizeLiftName(n)));
    const trackedNames = [...defaults, ...extra];

    const sections = [makeSessionSection('Squat', [{ weight_value: 225, rep_count: 5 }])];
    const result = classifyExerciseSessions(sections, trackedNames);

    // All default exercises must be present as keys in the result
    for (const name of defaults) {
      expect(Object.keys(result)).toContain(normalizeLiftName(name));
    }
  });

  test('union: exercise explicitly tracked but not in defaults is included alongside defaults', () => {
    const defaults = getDefaultTrackedNames();
    const normalizedDefaults = new Set(defaults.map(n => normalizeLiftName(n)));
    const extraExercise = 'Bulgarian Split Squat'; // not in catalog defaults
    const explicitTracked = [extraExercise];
    const extra = explicitTracked.filter(n => !normalizedDefaults.has(normalizeLiftName(n)));
    const trackedNames = [...defaults, ...extra];

    const sections = [
      makeSessionSection('Squat', [{ weight_value: 225, rep_count: 5 }]),
      makeSessionSection('Bulgarian Split Squat', [{ weight_value: 95, rep_count: 8 }]),
    ];
    const result = classifyExerciseSessions(sections, trackedNames);

    // Both the default 'squat' key and the extra exercise key must be present
    expect(Object.keys(result)).toContain('squat');
    expect(Object.keys(result)).toContain('bulgarian split squat');
  });

  test('union: default exercise already in explicit tracked list is not duplicated', () => {
    // Squat is in both defaults and explicit tracked — must appear exactly once in result.
    const defaults = getDefaultTrackedNames();
    const normalizedDefaults = new Set(defaults.map(n => normalizeLiftName(n)));
    const explicitTracked = ['Squat']; // already a default
    const extra = explicitTracked.filter(n => !normalizedDefaults.has(normalizeLiftName(n)));
    const trackedNames = [...defaults, ...extra];

    const sections = [makeSessionSection('Squat', [{ weight_value: 225, rep_count: 5 }])];
    const result = classifyExerciseSessions(sections, trackedNames);

    // 'squat' key should appear once — classifyExerciseSessions keys by normalizeLiftName
    const squatKeys = Object.keys(result).filter(k => k === 'squat');
    expect(squatKeys).toHaveLength(1);
  });
});

// ── computeWeeklySummary ──────────────────────────────────────────────────────

describe('computeWeeklySummary', () => {
  // Degraded / empty-state behavior

  test('null workoutNote → sessionStatusRows null (fully degraded)', () => {
    expect(computeWeeklySummary([], null)).toEqual({ hasActivity: false, sessionStatusRows: null });
  });

  test('note with all persisted fields null → sessionStatusRows null (no producer yet)', () => {
    const note = makeWorkoutNoteItem({ title: 'Test' });
    expect(computeWeeklySummary([], note)).toEqual({ hasActivity: false, sessionStatusRows: null });
  });

  test('exercise_classifications absent → sessionStatusRows null (section hidden)', () => {
    const note = makeWorkoutNoteItem({ title: 'Test' });
    expect(computeWeeklySummary([], note).sessionStatusRows).toBeNull();
  });

  test('exercise_classifications empty object → sessionStatusRows null (section hidden, not empty card)', () => {
    const note = { ...makeWorkoutNoteItem({ title: 'Test' }), exercise_classifications: {} };
    expect(computeWeeklySummary([], note).sessionStatusRows).toBeNull();
  });

  test('exercise_classifications with only initial/inconsistent → sessionStatusRows null (all filtered)', () => {
    const note = {
      ...makeWorkoutNoteItem({ title: 'Test' }),
      exercise_classifications: { squat: 'initial', deadlift: 'inconsistent' },
    };
    expect(computeWeeklySummary([], note).sessionStatusRows).toBeNull();
  });

  // exercise_classifications → sessionStatusRows display change

  test('progressing/stalled/regressing present → sessionStatusRows non-null (section rendered)', () => {
    const note = {
      ...makeWorkoutNoteItem({ title: 'Test' }),
      exercise_classifications: { squat: 'progressing', 'db bench press': 'stalled' },
    };
    const { sessionStatusRows } = computeWeeklySummary([], note);
    expect(sessionStatusRows).not.toBeNull();
    expect(sessionStatusRows).toHaveLength(2);
  });

  test('sessionStatusRow carries name and classification only (no latestRepDropOff)', () => {
    const note = {
      ...makeWorkoutNoteItem({ title: 'Test' }),
      exercise_classifications: { squat: 'progressing' },
    };
    const [row] = computeWeeklySummary([], note).sessionStatusRows;
    expect(row.name).toBe('squat');
    expect(row.classification).toBe('progressing');
    expect(row).not.toHaveProperty('latestRepDropOff');
  });

  test('initial and inconsistent filtered out; displayable entries still included', () => {
    const note = {
      ...makeWorkoutNoteItem({ title: 'Test' }),
      exercise_classifications: {
        squat: 'progressing',
        deadlift: 'initial',
        'db bench press': 'inconsistent',
        rdl: 'regressing',
      },
    };
    const { sessionStatusRows } = computeWeeklySummary([], note);
    expect(sessionStatusRows).toHaveLength(2);
    expect(sessionStatusRows.map(r => r.name).sort()).toEqual(['rdl', 'squat']);
  });

  test('each of the three displayable classifications appears correctly', () => {
    const note = {
      ...makeWorkoutNoteItem({ title: 'Test' }),
      exercise_classifications: { squat: 'progressing', bench: 'stalled', deadlift: 'regressing' },
    };
    const rows = computeWeeklySummary([], note).sessionStatusRows;
    expect(rows.find(r => r.name === 'squat').classification).toBe('progressing');
    expect(rows.find(r => r.name === 'bench').classification).toBe('stalled');
    expect(rows.find(r => r.name === 'deadlift').classification).toBe('regressing');
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

  test('drop_off ≤ 1 → null (in_reserve removed)', () => {
    const sets = [
      { weight_value: 225, rep_count: 8 },
      { weight_value: 225, rep_count: 8 },
    ];
    expect(computeRepDropOff(sets)).toBeNull();
  });

  test('drop_off exactly 1 → null (boundary)', () => {
    const sets = [
      { weight_value: 225, rep_count: 8 },
      { weight_value: 225, rep_count: 7 },
    ];
    expect(computeRepDropOff(sets)).toBeNull();
  });

  test('negative drop_off (reps increased) → null', () => {
    const sets = [
      { weight_value: 225, rep_count: 6 },
      { weight_value: 225, rep_count: 8 },
    ];
    expect(computeRepDropOff(sets)).toBeNull();
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
    // session 0: logged (hit_wall), session 1: skip (excluded), session 2: logged (null, drop≤1)
    const sections = [dropOffSection('Squat', [
      [ws(225, 8), ws(225, 4)],
      'skip',
      [ws(225, 8), ws(225, 8)],
    ])];
    const result = deriveRepDropOffFlags(sections, ['Squat']);
    expect(result['squat']).toEqual({ '0': 'hit_wall', '2': null });
  });

  test('multiple logged sessions stored per-session', () => {
    const sections = [dropOffSection('Squat', [
      [ws(225, 8), ws(225, 4)],  // idx 0 → hit_wall (drop=4)
      [ws(225, 8), ws(225, 6)],  // idx 1 → null (drop=2)
      [ws(225, 8), ws(225, 8)],  // idx 2 → null (drop=0, in_reserve removed)
    ])];
    const result = deriveRepDropOffFlags(sections, ['Squat']);
    expect(result['squat']).toEqual({ '0': 'hit_wall', '1': null, '2': null });
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
    expect(result['deadlift']).toEqual({ '0': null });
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
    expect(getLatestRepDropOff({ '0': 'hit_wall', '1': null, '2': null })).toBeNull();
  });

  test('most recent session null (drop=2) → null', () => {
    expect(getLatestRepDropOff({ '0': 'hit_wall', '1': null })).toBeNull();
  });

  test('skipped sessions (absent keys) do not affect result', () => {
    // session 0 logged (hit_wall), session 1 skipped (absent), session 2 logged (null)
    expect(getLatestRepDropOff({ '0': 'hit_wall', '2': null })).toBeNull();
  });
});

// ── deriveSessionCheckIn ──────────────────────────────────────────────────────

// A within-row skipped set: weight preserved, rep_count 0, skipped flag.
function skset(weight) { return { weight_value: weight, rep_count: 0, skipped: true }; }

// Build one section holding multiple exercises (so day-skip = every exercise in
// the section skipped at a column). entries: (sets[] | 'skip')[] per exercise.
function checkinSection(exerciseSpecs) {
  return {
    heading: null, subheading: null, kind: 'general',
    exercises: exerciseSpecs.map(({ name, entries }) => ({
      name, rows: [], sets: [], unparsed_rows: [],
      session_entries: entries.map(e =>
        e === 'skip' ? { skipped: true, raw: '-', sets: [] } : { skipped: false, raw: 'x', sets: e }),
    })),
  };
}

describe('deriveSessionCheckIn', () => {
  test('guards: null sections / empty tracked names → empty result', () => {
    expect(deriveSessionCheckIn(null, ['Squat']).isRough).toBe(false);
    expect(deriveSessionCheckIn([dropOffSection('Squat', [[ws(225, 5)]])], []).isRough).toBe(false);
  });

  test('not rough when latest is within range of baseline (8,8 → 6,6)', () => {
    const sections = [dropOffSection('Skullcrusher', [
      [ws(80, 8), ws(80, 8)],
      [ws(80, 6), ws(80, 6)],
    ])];
    const r = deriveSessionCheckIn(sections, ['Skullcrusher']);
    expect(r.isRough).toBe(false);
    expect(r.detectors).toEqual([]);
    expect(r.flagged).toEqual([]);
    expect(r.metrics).toEqual({ exercises_skipped: 0, volume_decline_pct: null });
  });

  test('brand-new exercise (no history) never flags, even with an intra-session drop', () => {
    const sections = [dropOffSection('New Lift', [[ws(50, 8), ws(50, 4)]])];
    const r = deriveSessionCheckIn(sections, ['New Lift']);
    expect(r.isRough).toBe(false);
  });

  test('volume_drop: 80 8,8 → 80 4,- flags the exercise and reports decline %', () => {
    const sections = [dropOffSection('Skullcrusher', [
      [ws(80, 8), ws(80, 8)],
      [ws(80, 4), skset(80)],
    ])];
    const r = deriveSessionCheckIn(sections, ['Skullcrusher']);
    expect(r.isRough).toBe(true);
    expect(r.detectors).toEqual(['volume_drop']);
    expect(r.flagged).toHaveLength(1);
    expect(r.flagged[0]).toMatchObject({ normName: 'skullcrusher', reasons: ['volume_drop'] });
    // base tonnage 1280, latest 320 → 75% decline
    expect(r.metrics.volume_decline_pct).toBe(75);
    expect(r.metrics.exercises_skipped).toBe(0);
    expect(r.sessionIndex).toBe(1);
  });

  test('volume_drop does NOT fire for a small in-range drop (8,8 → 6,6)', () => {
    const sections = [dropOffSection('Skullcrusher', [
      [ws(80, 8), ws(80, 8)],
      [ws(80, 6), ws(80, 6)],
    ])];
    const r = deriveSessionCheckIn(sections, ['Skullcrusher']);
    expect(r.detectors).not.toContain('volume_drop');
  });

  test('collapse: reps fall apart within the latest session (80 5,5 → 80 8,4)', () => {
    const sections = [dropOffSection('Bench Press', [
      [ws(80, 5), ws(80, 5)],
      [ws(80, 8), ws(80, 4)],
    ])];
    const r = deriveSessionCheckIn(sections, ['Bench Press']);
    expect(r.detectors).toEqual(['collapse']);
    expect(r.flagged[0].reasons).toEqual(['collapse']);
    expect(r.metrics.volume_decline_pct).toBeNull();
  });

  test('skipped: more skips than usual flags the skipped exercises (2 of 3)', () => {
    const sections = [checkinSection([
      { name: 'Bench Press', entries: [[ws(80, 8), ws(80, 8)], [ws(80, 8), ws(80, 8)], 'skip'] },
      { name: 'Row', entries: [[ws(100, 8), ws(100, 8)], [ws(100, 8), ws(100, 8)], 'skip'] },
      { name: 'Squat', entries: [[ws(200, 5), ws(200, 5)], [ws(200, 5), ws(200, 5)], [ws(200, 5), ws(200, 5)]] },
    ])];
    const r = deriveSessionCheckIn(sections, ['Bench Press', 'Row', 'Squat']);
    expect(r.isRough).toBe(true);
    expect(r.detectors).toEqual(['skipped']);
    expect(r.sessionIndex).toBe(2);
    expect(r.metrics.exercises_skipped).toBe(2);
    expect(r.flagged.map(f => f.normName).sort()).toEqual(['bench press', 'row']);
    expect(r.flagged.every(f => f.reasons.includes('skip'))).toBe(true);
  });

  test('skipped does NOT fire below the floor (only one exercise skipped)', () => {
    const sections = [checkinSection([
      { name: 'Bench Press', entries: [[ws(80, 8), ws(80, 8)], [ws(80, 8), ws(80, 8)], 'skip'] },
      { name: 'Row', entries: [[ws(100, 8), ws(100, 8)], [ws(100, 8), ws(100, 8)], [ws(100, 8), ws(100, 8)]] },
    ])];
    const r = deriveSessionCheckIn(sections, ['Bench Press', 'Row']);
    expect(r.detectors).not.toContain('skipped');
    expect(r.isRough).toBe(false);
  });

  test('skipped does NOT fire when skips are the usual rate (avg + margin)', () => {
    // A and B skip every session; the latest 2 skips are not above average + margin.
    const sections = [checkinSection([
      { name: 'A', entries: ['skip', 'skip', 'skip'] },
      { name: 'B', entries: ['skip', 'skip', 'skip'] },
      { name: 'C', entries: [[ws(50, 8), ws(50, 8)], [ws(50, 8), ws(50, 8)], [ws(50, 8), ws(50, 8)]] },
    ])];
    const r = deriveSessionCheckIn(sections, ['A', 'B', 'C']);
    expect(r.detectors).not.toContain('skipped');
  });

  test('skipped does NOT fire at the avg + margin boundary (strict >)', () => {
    // Per-column skip counts [1, 1, 2]: avg(1,1) = 1, + margin 1 = 2, latest 2 →
    // exactly at the threshold, must not fire (needs to exceed it).
    const sections = [checkinSection([
      { name: 'A', entries: ['skip', [ws(80, 8), ws(80, 8)], 'skip'] },
      { name: 'B', entries: [[ws(100, 8), ws(100, 8)], 'skip', 'skip'] },
      { name: 'C', entries: [[ws(50, 8), ws(50, 8)], [ws(50, 8), ws(50, 8)], [ws(50, 8), ws(50, 8)]] },
    ])];
    const r = deriveSessionCheckIn(sections, ['A', 'B', 'C']);
    expect(r.detectors).not.toContain('skipped');
    expect(r.isRough).toBe(false);
  });

  test('day_skip: a whole day skipped at the latest session', () => {
    const sections = [checkinSection([
      { name: 'Bench Press', entries: [[ws(80, 8), ws(80, 8)], 'skip'] },
      { name: 'Row', entries: [[ws(100, 8), ws(100, 8)], 'skip'] },
    ])];
    const r = deriveSessionCheckIn(sections, ['Bench Press', 'Row']);
    expect(r.isRough).toBe(true);
    expect(r.detectors).toEqual(['skipped', 'day_skip']);
    expect(r.flagged.every(f => f.reasons.includes('day_skip'))).toBe(true);
  });

  test('day_skip fires independently of the skip trigger', () => {
    // Whole day skipped at the latest column, but skips are within the usual rate
    // (skipped is not raised) — day_skip must still fire on its own.
    const sections = [checkinSection([
      { name: 'Bench Press', entries: ['skip', [ws(80, 8), ws(80, 8)], 'skip'] },
      { name: 'Row', entries: ['skip', 'skip', 'skip'] },
    ])];
    const r = deriveSessionCheckIn(sections, ['Bench Press', 'Row']);
    expect(r.detectors).toContain('day_skip');
    expect(r.detectors).not.toContain('skipped');
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

// ── rollingWindowStart ────────────────────────────────────────────────────────
describe('rollingWindowStart', () => {
  test('returns correct start date for 30-day window', () => {
    // ref = 2026-05-24, 30-day window starts 2026-04-25
    expect(rollingWindowStart(new Date('2026-05-24T12:00:00'), 30)).toBe('2026-04-25');
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
// computeWeeksIn uses max(session_entries.length, rows.length + skippedCount) per
// exercise so plain-row history, session-entry history, and skipped sessions in
// mixed-format notes are all counted toward depth.

describe('computeWeeksIn plain-row vs session-entry distinction', () => {
  test('exercise with bare rows only and no session_entries contributes rows.length to depth', () => {
    // Plain rows represent sessions too — even without the '- ' history format they count.
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name: 'Squat', rows: [{ raw: '225x5', sets: [] }], session_entries: [], unparsed_rows: [] }],
    }];
    expect(computeWeeksIn(sections)).toBe(1);
  });

  test('mixed: session_entries and bare-row exercises — depth is max across both', () => {
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [
        { name: 'Squat', rows: [], session_entries: [{ skipped: false, raw: '225x5', sets: [{ weight_value: 225, rep_count: 5 }] }, { skipped: false, raw: '235x5', sets: [{ weight_value: 235, rep_count: 5 }] }], unparsed_rows: [] },
        { name: 'Deadlift', rows: [{ raw: '315x5', sets: [] }], session_entries: [], unparsed_rows: [] },
      ],
    }];
    // Squat has session_entries depth 2; Deadlift has rows depth 1 — max is 2
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

  test('mixed-format with skipped session: 7 plain rows + 2 non-skipped + 1 skipped entry → depth 10', () => {
    // Regression: skipped session_entries do not appear in rows, so
    // max(session_entries.length, rows.length) = max(3, 9) = 9 is wrong.
    // Correct: rows.length + skipped_count = 9 + 1 = 10.
    const plainRows = Array.from({ length: 7 }, (_, i) => ({
      raw: `${225 + i * 5}x5`,
      sets: [{ weight_value: 225 + i * 5, rep_count: 5 }],
    }));
    const nonSkippedEntryRows = [
      { raw: '260x5', sets: [{ weight_value: 260, rep_count: 5 }] },
      { raw: '265x5', sets: [{ weight_value: 265, rep_count: 5 }] },
    ];
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{
        name: 'Squat',
        rows: [...plainRows, ...nonSkippedEntryRows],
        sets: [],
        unparsed_rows: [],
        session_entries: [
          ...nonSkippedEntryRows.map(r => ({ skipped: false, raw: r.raw, sets: r.sets })),
          { skipped: true, raw: '-', sets: [] },
        ],
      }],
    }];
    expect(computeWeeksIn(sections)).toBe(10);
  });
});

// ── deriveSkipData session-depth window ───────────────────────────────────────
// Regression coverage confirming the session-depth window for repeated_weekday_skip.
// Calendar dates are not required; detection is purely positional.

describe('deriveSkipData session-depth window', () => {
  test('two skips within session window both count toward weekday flag', () => {
    // Two fully-skipped Saturday sessions at indices 0 and 1 (both within window).
    const sections = [
      { heading: '2026-04-25', subheading: null, kind: 'lifting', exercises: [
        { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
        { name: 'Deadlift', raw_header: '-Deadlift', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
      ]},
      { heading: '2026-05-02', subheading: null, kind: 'lifting', exercises: [
        { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
        { name: 'Deadlift', raw_header: '-Deadlift', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
      ]},
    ];
    const { attendance_flags } = deriveSkipData(sections);
    const weekdayFlag = attendance_flags.find(f => f.type === 'repeated_weekday_skip');
    expect(weekdayFlag).toBeDefined();
    expect(weekdayFlag.skip_count).toBe(2);
  });

  test('skips outside session-depth window are excluded from weekday flag', () => {
    // Friday slot has WINDOW+2 sessions. Skips at positions 0 and 1 only.
    // The last WINDOW sessions are all logged → no flag.
    const depth = REPEATED_WEEKDAY_SKIP_SESSION_WINDOW + 2;
    const entries = Array.from({ length: depth }, (_, i) => (i < 2 ? 'skip' : 'log'));
    const section = { heading: 'Friday', subheading: null, kind: 'lifting', exercises: [
      { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: entries.map(e =>
        e === 'skip' ? { skipped: true, raw: '-', sets: [] } : { skipped: false, raw: '225x5', sets: [] }
      ), unparsed_rows: [] },
    ]};
    const { attendance_flags } = deriveSkipData([section]);
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(false);
  });

  test('session-depth detection works from weekday name alone (no ISO date needed)', () => {
    // Two Monday sections with undated headings — weekday detected from name.
    const sections = [
      { heading: 'Monday', subheading: null, kind: 'lifting', exercises: [
        { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
      ]},
      { heading: 'Monday', subheading: null, kind: 'lifting', exercises: [
        { name: 'Squat', raw_header: '-Squat', rows: [], session_entries: [{ skipped: true, raw: '-', sets: [] }], unparsed_rows: [] },
      ]},
    ];
    const { attendance_flags } = deriveSkipData(sections);
    expect(attendance_flags.some(f => f.type === 'repeated_weekday_skip')).toBe(true);
  });
});

// ── computeWeeklySummary ──────────────────────────────────────────────────────

describe('computeWeeklySummary', () => {
  test('returns hasActivity: false when no sessions logged', () => {
    const sections = [{
      heading: 'Monday',
      subheading: null,
      kind: 'general',
      exercises: [{
        name: 'Squat',
        sets: [],
        rows: [],
        session_entries: [{ skipped: true, raw: '-', sets: [] }],
        unparsed_rows: []
      }]
    }];
    const result = computeWeeklySummary(sections, {});
    expect(result.hasActivity).toBe(false);
    expect(result.sessionStatusRows).toBeNull();
  });

  test('returns hasActivity: true when session exists (with session_entries)', () => {
    const sections = [asymSection('2026-05-24', [{ name: 'Squat', sets: [{ weight_value: 225, rep_count: 5 }] }])];
    const result = computeWeeklySummary(sections, {});
    expect(result.hasActivity).toBe(true);
  });

  test('returns hasActivity: true for plain inline set rows (no session_entries)', () => {
    const sections = [{
      heading: 'Monday',
      subheading: null,
      kind: 'general',
      exercises: [{
        name: 'Squat',
        sets: [{ weight_value: 225, rep_count: 5 }],
        rows: [],
        session_entries: [],
        unparsed_rows: []
      }]
    }];
    const result = computeWeeklySummary(sections, {});
    expect(result.hasActivity).toBe(true);
  });

  test('aggregates classification counts from workoutNote', () => {
    const sections = [asymSection('2026-05-24', [{ name: 'Squat', sets: [{ weight_value: 225, rep_count: 5 }] }])];
    const workoutNote = {
      exercise_classifications: {
        squat: 'progressing',
        bench: 'stalled',
        deadlift: 'progressing',
        curls: 'regressing',
        press: 'inconsistent',
        other: 'initial'
      }
    };
    const result = computeWeeklySummary(sections, workoutNote);
    expect(result.classifications).toEqual({
      progressing: 2,
      stalled: 1,
      regressing: 1,
      inconsistent: 1,
      initial: 1
    });
  });

  test('returns classifications: null if exercise_classifications is missing from note', () => {
    const sections = [asymSection('2026-05-24', [{ name: 'Squat', sets: [{ weight_value: 225, rep_count: 5 }] }])];
    const result = computeWeeklySummary(sections, {});
    expect(result.classifications).toBe(null);
  });
});

describe('classifyExerciseSessions normalization and alias tests', () => {
  test('matches exercises with slightly different naming in note vs tracked map', () => {
    const sections = [{
      heading: 'Monday',
      exercises: [{
        name: 'Bench Press ', // Extra space
        sets: [{ weight_value: 135, rep_count: 5 }],
        rows: [], session_entries: [], unparsed_rows: []
      }]
    }];
    const trackedNames = ['bench press'];
    const result = classifyExerciseSessions(sections, trackedNames);
    expect(result['bench press']).toBe('initial');
  });

  test('matches DB Bench in note with DB Bench Press in tracked map via canonical name', () => {
    const sections = [{
      heading: 'Monday',
      exercises: [{
        name: 'DB Bench', // Alias
        sets: [{ weight_value: 50, rep_count: 10 }],
        rows: [], session_entries: [], unparsed_rows: []
      }]
    }];
    const trackedNames = ['DB Bench Press'];
    const result = classifyExerciseSessions(sections, trackedNames);
    expect(result['db bench press']).toBe('initial');
  });

  test('matches lowercase tracked name with Title Case note entry', () => {
    const sections = [{
      heading: 'Monday',
      exercises: [{
        name: 'Squat',
        sets: [{ weight_value: 225, rep_count: 5 }],
        rows: [], session_entries: [], unparsed_rows: []
      }]
    }];
    const trackedNames = ['squat'];
    const result = classifyExerciseSessions(sections, trackedNames);
    expect(result['squat']).toBe('initial');
  });
});

// ── WEIGHT_PACE thresholds ────────────────────────────────────────────────────

describe('WEIGHT_PACE thresholds', () => {
  test('WEIGHT_PACE_NOTABLE_THRESHOLD is 1.5', () => {
    expect(WEIGHT_PACE_NOTABLE_THRESHOLD).toBe(1.5);
  });

  test('WEIGHT_PACE_SPIKE_THRESHOLD is 2.3', () => {
    expect(WEIGHT_PACE_SPIKE_THRESHOLD).toBe(2.3);
  });

  test('delta exactly at notable threshold triggers paceFlag', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 185.0 + WEIGHT_PACE_NOTABLE_THRESHOLD },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('gain');
    expect(computeWeightPaceLevel(entries)).toBe('notable');
  });

  test('delta just below notable threshold returns null', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 185.0 + WEIGHT_PACE_NOTABLE_THRESHOLD - 0.1 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBeNull();
    expect(computeWeightPaceLevel(entries)).toBeNull();
  });

  test('delta exactly at spike threshold triggers spike level', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 185.0 + WEIGHT_PACE_SPIKE_THRESHOLD },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightPaceLevel(entries)).toBe('spike');
  });

  test('delta between notable and spike thresholds is notable', () => {
    const mid = (WEIGHT_PACE_NOTABLE_THRESHOLD + WEIGHT_PACE_SPIKE_THRESHOLD) / 2;
    const entries = [
      { date: '2026-05-20', weight_value: 185.0 + mid },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightPaceLevel(entries)).toBe('notable');
  });
});

// ── resolveGoalCurrentWeight ──────────────────────────────────────────────────

describe('resolveGoalCurrentWeight', () => {
  test('returns latest entry weight when entries are present', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 186.0 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(resolveGoalCurrentWeight(entries, null)).toBe(186.0);
  });

  test('prefers entry weight over saved start_weight when entries exist', () => {
    const entries = [{ date: '2026-05-20', weight_value: 186.0 }];
    const goal = { start_weight: 190.0 };
    expect(resolveGoalCurrentWeight(entries, goal)).toBe(186.0);
  });

  test('falls back to saved start_weight when no entries and not editing', () => {
    const goal = { start_weight: 190.0 };
    expect(resolveGoalCurrentWeight([], goal, { goalEditing: false })).toBe(190.0);
  });

  test('ignores saved start_weight when goal is being edited, uses goalStartWeight string', () => {
    const goal = { start_weight: 190.0 };
    expect(resolveGoalCurrentWeight([], goal, { goalEditing: true, goalStartWeight: '188.5' })).toBe(188.5);
  });

  test('returns null when no entries, no goal, and no valid goalStartWeight', () => {
    expect(resolveGoalCurrentWeight([], null)).toBeNull();
    expect(resolveGoalCurrentWeight([], null, { goalStartWeight: '' })).toBeNull();
    expect(resolveGoalCurrentWeight([], null, { goalStartWeight: 'abc' })).toBeNull();
    expect(resolveGoalCurrentWeight([], null, { goalStartWeight: '0' })).toBeNull();
  });

  test('returns null when entries array is null or undefined', () => {
    expect(resolveGoalCurrentWeight(null, null)).toBeNull();
    expect(resolveGoalCurrentWeight(undefined, null)).toBeNull();
  });

  test('returns the most recent entry by date when entries are unsorted', () => {
    const entries = [
      { date: '2026-05-19', weight_value: 185.0 },
      { date: '2026-05-20', weight_value: 186.0 },
    ];
    expect(resolveGoalCurrentWeight(entries, null)).toBe(186.0);
  });
});

// ── computeWeightTrendSummary ─────────────────────────────────────────────────

describe('computeWeightTrendSummary', () => {
  const REF = new Date('2026-05-20T12:00:00');

  test('includes all base fields from computeWeightTrends', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 186.0 },
      { date: '2026-05-18', weight_value: 185.0 },
    ];
    const summary = computeWeightTrendSummary(entries, REF);
    expect(summary).toHaveProperty('avg7');
    expect(summary).toHaveProperty('avg30');
    expect(summary).toHaveProperty('paceFlag');
  });

  test('currentWeight is the most recent entry by date', () => {
    const entries = [
      { date: '2026-05-18', weight_value: 185.0 },
      { date: '2026-05-20', weight_value: 186.0 },
    ];
    const { currentWeight } = computeWeightTrendSummary(entries, REF);
    expect(currentWeight).toBe(186.0);
  });

  test('priorDayWeight is the second most recent entry by date', () => {
    const entries = [
      { date: '2026-05-18', weight_value: 183.0 },
      { date: '2026-05-19', weight_value: 185.0 },
      { date: '2026-05-20', weight_value: 186.0 },
    ];
    const { priorDayWeight } = computeWeightTrendSummary(entries, REF);
    expect(priorDayWeight).toBe(185.0);
  });

  test('priorAvg7 averages entries in the prior 7-day window (days 7–13 before ref)', () => {
    // prior 7-day window: 2026-05-07 to 2026-05-13
    const entries = [
      { date: '2026-05-20', weight_value: 190.0 },
      { date: '2026-05-08', weight_value: 182.0 },
      { date: '2026-05-09', weight_value: 184.0 },
    ];
    const { priorAvg7 } = computeWeightTrendSummary(entries, REF);
    expect(priorAvg7).toBeCloseTo(183.0);
  });

  test('priorAvg7 is null when no entries fall in the prior 7-day window', () => {
    const entries = [{ date: '2026-05-20', weight_value: 190.0 }];
    const { priorAvg7 } = computeWeightTrendSummary(entries, REF);
    expect(priorAvg7).toBeNull();
  });

  test('currentWeight and priorDayWeight are null when fewer than 2 entries', () => {
    const { currentWeight, priorDayWeight } = computeWeightTrendSummary([], REF);
    expect(currentWeight).toBeNull();
    expect(priorDayWeight).toBeNull();
  });
});

// ── REPEATED_WEEKDAY_SKIP_SESSION_WINDOW ──────────────────────────────────────

describe('REPEATED_WEEKDAY_SKIP_SESSION_WINDOW', () => {
  test('is a positive integer', () => {
    expect(Number.isInteger(REPEATED_WEEKDAY_SKIP_SESSION_WINDOW)).toBe(true);
    expect(REPEATED_WEEKDAY_SKIP_SESSION_WINDOW).toBeGreaterThan(0);
  });
});

// ── deriveWorkoutNoteAnalytics ────────────────────────────────────────────────

function analyticsSection(name, entries) {
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

function aw(weight, reps) { return { weight_value: weight, rep_count: reps }; }

describe('deriveWorkoutNoteAnalytics', () => {
  test('returns core output fields', () => {
    const sections = [analyticsSection('Squat', [aw(225, 5)])];
    const result = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(result).toHaveProperty('weeksIn');
    expect(result).toHaveProperty('classifications');
    expect(result).toHaveProperty('skipData');
  });

  test('no longer surfaces repDropOffFlags (chip flags stopped)', () => {
    const sections = [analyticsSection('Squat', [aw(225, 5)])];
    const result = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(result).not.toHaveProperty('repDropOffFlags');
  });

  test('weeksIn reflects session depth from sections', () => {
    const sections = [analyticsSection('Squat', [aw(225, 5), aw(235, 5), aw(245, 5)])];
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(weeksIn).toBe(3);
  });

  test('classifications keyed by normalized name', () => {
    const sections = [analyticsSection('Squat', [aw(225, 5), aw(235, 5)])];
    const { classifications } = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(classifications['squat']).toBe('progressing');
  });

  test('skipData contains exercise_skips, day_skips, attendance_flags', () => {
    const sections = [analyticsSection('Squat', ['skip'])];
    const { skipData } = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(skipData).toHaveProperty('exercise_skips');
    expect(skipData).toHaveProperty('day_skips');
    expect(skipData).toHaveProperty('attendance_flags');
    expect(skipData.exercise_skips).toHaveLength(1);
  });

  test('empty sections → weeksIn 0, empty analytics', () => {
    const { weeksIn, classifications, skipData } =
      deriveWorkoutNoteAnalytics([], ['Squat']);
    expect(weeksIn).toBe(0);
    expect(classifications['squat']).toBeNull();
    expect(skipData.exercise_skips).toHaveLength(0);
  });

  test('tracked exercise absent from note → null classification', () => {
    const sections = [analyticsSection('Bench Press', [aw(135, 5)])];
    const { classifications } = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(classifications['squat']).toBeNull();
  });

  test('output is deterministic — same sections produce same result regardless of call order', () => {
    const sections = [analyticsSection('Squat', [aw(225, 5), aw(235, 5)])];
    const r1 = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    const r2 = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(r1.weeksIn).toBe(r2.weeksIn);
    expect(r1.classifications['squat']).toBe(r2.classifications['squat']);
  });

  test('returns signals array for tracked names', () => {
    const sections = [analyticsSection('Squat', [aw(225, 5), aw(235, 5)])];
    const { signals } = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(Array.isArray(signals)).toBe(true);
    expect(signals).toHaveLength(1);
    expect(signals[0].name).toBe('Squat');
  });

  test('returns nameDisplayMap with user-typed casing', () => {
    const sections = [analyticsSection('Bench Press', [aw(135, 5)])];
    const { nameDisplayMap } = deriveWorkoutNoteAnalytics(sections, ['Bench Press']);
    expect(nameDisplayMap instanceof Map).toBe(true);
    expect(nameDisplayMap.get('bench press')).toBe('Bench Press');
  });

  test('null sections → signals empty array, nameDisplayMap empty', () => {
    const { signals, nameDisplayMap } = deriveWorkoutNoteAnalytics(null, ['Squat']);
    expect(signals).toEqual([]);
    expect(nameDisplayMap instanceof Map).toBe(true);
    expect(nameDisplayMap.size).toBe(0);
  });

  test('returns perDaySignals keyed by canonical name', () => {
    const sections = [analyticsSection('Squat', [aw(225, 5)])];
    const { perDaySignals } = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    expect(typeof perDaySignals).toBe('object');
    expect(perDaySignals).toHaveProperty('squat');
  });

  test('null sections → perDaySignals is empty object', () => {
    const { perDaySignals } = deriveWorkoutNoteAnalytics(null, ['Squat']);
    expect(perDaySignals).toEqual({});
  });

  test('perDaySignals for bodyweight exercise carries is_bodyweight true', () => {
    const bwSection = {
      heading: 'Monday', subheading: null, kind: 'general',
      exercises: [{
        name: 'Pull-ups', rows: [], sets: [], unparsed_rows: [],
        session_entries: [{ skipped: false, raw: '10', sets: [{ weight_value: null, rep_count: 10 }] }],
      }],
    };
    const { perDaySignals } = deriveWorkoutNoteAnalytics([bwSection], ['Pull-ups']);
    expect(perDaySignals['pull-ups']['Monday'].is_bodyweight).toBe(true);
    expect(perDaySignals['pull-ups']['Monday'].latest_top_weight).toBe(10);
  });
});

// ── Cross-consumer contract: deriveWorkoutNoteAnalytics signals match deriveSignals ──
//
// Pins that Analytics consumers routed through deriveWorkoutNoteAnalytics receive
// the same signal outputs as calling deriveSignals directly with the same inputs.
// Regression guard: prevents divergence when consumers are migrated to the canonical path.

describe('deriveWorkoutNoteAnalytics signals — cross-consumer contract', () => {
  function signalSection(name, entries) {
    const session_entries = entries.map(e => ({
      skipped: false, raw: 'x', sets: Array.isArray(e) ? e : [e],
    }));
    return {
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name, rows: [], sets: [], unparsed_rows: [], session_entries }],
    };
  }

  function sw(weight, reps) { return { weight_value: weight, rep_count: reps }; }

  test('signals from canonical path match deriveSignals for same inputs', () => {
    const sections = [signalSection('Squat', [sw(225, 5), sw(235, 5), sw(245, 5)])];
    const trackedNames = ['Squat'];
    const multiplier = 1;

    const { signals } = deriveWorkoutNoteAnalytics(sections, trackedNames, multiplier);
    const { exercises: directSignals } = deriveSignals(sections, trackedNames, multiplier);

    expect(signals).toHaveLength(directSignals.length);
    signals.forEach((sig, i) => {
      expect(sig.name).toBe(directSignals[i].name);
      expect(sig.progression_status).toBe(directSignals[i].progression_status);
      expect(sig.latest_top_weight).toBe(directSignals[i].latest_top_weight);
    });
  });

  test('absent exercise yields consistent null signal across both paths', () => {
    const sections = [signalSection('Bench Press', [sw(135, 5)])];
    const trackedNames = ['Squat'];
    const multiplier = 1;

    const { signals } = deriveWorkoutNoteAnalytics(sections, trackedNames, multiplier);
    const { exercises: directSignals } = deriveSignals(sections, trackedNames, multiplier);

    expect(signals[0].progression_status).toBe(directSignals[0].progression_status);
    expect(signals[0].progression_status).toBeNull();
  });

  test('empty sections → consistent empty/null signals across both paths', () => {
    const trackedNames = ['Squat'];
    const multiplier = 1;

    const { signals } = deriveWorkoutNoteAnalytics([], trackedNames, multiplier);
    const { exercises: directSignals } = deriveSignals([], trackedNames, multiplier);

    expect(signals).toHaveLength(directSignals.length);
    expect(signals[0].progression_status).toBe(directSignals[0].progression_status);
  });
});

// ── deriveWorkoutNoteAnalytics weeksIn — progression-depth contract (HomeScreen path) ──
//
// HomeScreen consumes weeksIn via deriveWorkoutNoteAnalytics(sections, []).
// These cases pin the session-depth semantics at the canonical entry point.

describe('deriveWorkoutNoteAnalytics weeksIn — HomeScreen progression-depth contract', () => {
  function depthSection(name, sessionCount) {
    const session_entries = Array.from({ length: sessionCount }, () => ({
      skipped: false, raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }],
    }));
    return {
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name, rows: [], sets: [], unparsed_rows: [], session_entries }],
    };
  }

  test('null sections → null (no routine loaded)', () => {
    const { weeksIn } = deriveWorkoutNoteAnalytics(null, []);
    expect(weeksIn).toBeNull();
  });

  test('empty sections → 0 (routine loaded, nothing logged)', () => {
    const { weeksIn } = deriveWorkoutNoteAnalytics([], []);
    expect(weeksIn).toBe(0);
  });

  test('single exercise, 1 session → depth 1', () => {
    const { weeksIn } = deriveWorkoutNoteAnalytics([depthSection('Squat', 1)], []);
    expect(weeksIn).toBe(1);
  });

  test('single exercise, 8 sessions → depth 8', () => {
    const { weeksIn } = deriveWorkoutNoteAnalytics([depthSection('Squat', 8)], []);
    expect(weeksIn).toBe(8);
  });

  test('multiple exercises — weeksIn is the max session depth across all', () => {
    const sections = [
      { heading: null, subheading: null, kind: 'general', exercises: [
        { name: 'Squat', rows: [], sets: [], unparsed_rows: [], session_entries: Array(5).fill({ skipped: false, raw: 'x', sets: [] }) },
        { name: 'Bench Press', rows: [], sets: [], unparsed_rows: [], session_entries: Array(9).fill({ skipped: false, raw: 'x', sets: [] }) },
        { name: 'Deadlift', rows: [], sets: [], unparsed_rows: [], session_entries: Array(3).fill({ skipped: false, raw: 'x', sets: [] }) },
      ]},
    ];
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, []);
    expect(weeksIn).toBe(9);
  });

  test('skipped sessions count toward depth', () => {
    const session_entries = [
      { skipped: true, raw: '-', sets: [] },
      { skipped: false, raw: '135x5', sets: [] },
      { skipped: true, raw: '-', sets: [] },
    ];
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name: 'Squat', rows: [], sets: [], unparsed_rows: [], session_entries }],
    }];
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, []);
    expect(weeksIn).toBe(3);
  });

  test('exercise with only bare rows (no session_entries) contributes rows.length', () => {
    // Plain-row format represents real sessions and must not be invisible to weeksIn.
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name: 'Squat', rows: [{ raw: '135x5' }], sets: [], unparsed_rows: [], session_entries: [] }],
    }];
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, []);
    expect(weeksIn).toBe(1);
  });

  test('mixed-format history: exercise with plain-row history plus session-entry history (no skips)', () => {
    // Regression: user migrated partway through — 7 older sessions as plain rows,
    // 6 newer sessions as '- entry' format. rows.length = 13, session_entries.length = 6.
    // Before fix: computeWeeksIn returned 6 (only session_entries). After fix: 13.
    const plainRows = Array.from({ length: 7 }, (_, i) => ({
      raw: `${225 + i * 5}x5,5,5`,
      sets: [{ weight_value: 225 + i * 5, rep_count: 5 }],
    }));
    const sessionEntryRows = Array.from({ length: 6 }, (_, i) => ({
      raw: `${260 + i * 5}x5,5,5`,
      sets: [{ weight_value: 260 + i * 5, rep_count: 5 }],
    }));
    const sessionEntries = sessionEntryRows.map(r => ({
      skipped: false, raw: r.raw, sets: r.sets,
    }));
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{
        name: 'Squat',
        rows: [...plainRows, ...sessionEntryRows],
        sets: [],
        unparsed_rows: [],
        session_entries: sessionEntries,
      }],
    }];
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, []);
    expect(weeksIn).toBe(13);
  });
});

// ── deriveWorkoutNoteAnalytics — alias canonicalization ──────────────────────

describe('deriveWorkoutNoteAnalytics — alias canonicalization', () => {
  test('exercise with alias name in note matches canonical tracked name — signal returned', () => {
    // 'DB Bench' in the note is an alias for 'DB Bench Press'.
    // When tracked as 'DB Bench Press', deriveWorkoutNoteAnalytics must still
    // find and return a signal via deriveWorkoutAnalytics canonicalization.
    const sessionEntries = [
      { skipped: false, raw: '70x10', sets: [{ weight_value: 70, rep_count: 10 }] },
      { skipped: false, raw: '75x8',  sets: [{ weight_value: 75, rep_count: 8 }] },
    ];
    const rows = sessionEntries.map(se => ({ raw: se.raw, sets: se.sets }));
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{
        name: 'DB Bench',
        rows,
        sets: sessionEntries.flatMap(se => se.sets),
        unparsed_rows: [],
        session_entries: sessionEntries,
      }],
    }];
    const { signals } = deriveWorkoutNoteAnalytics(sections, ['DB Bench Press']);
    expect(signals).toHaveLength(1);
    // With 2 comparable sessions, overload_trend must be computed (not null and not 'first_session').
    expect(signals[0].overload_trend).not.toBeNull();
    expect(signals[0].overload_trend).not.toBe('first_session');
  });

  test('alias exercise absent from note → null signal, not a crash', () => {
    const sections = [{
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name: 'Squat', rows: [], sets: [], unparsed_rows: [], session_entries: [] }],
    }];
    const { signals } = deriveWorkoutNoteAnalytics(sections, ['DB Bench Press']);
    expect(signals).toHaveLength(1);
    expect(signals[0].overload_trend).toBeNull();
  });
});


// ── deriveWeightGoalAnalytics ─────────────────────────────────────────────────

describe('deriveWeightGoalAnalytics', () => {
  const REF = new Date('2026-05-25T12:00:00');

  test('empty entries, no goal → safe empty outputs', () => {
    const result = deriveWeightGoalAnalytics([], null, {}, REF);
    expect(result.trendSummary.avg7).toBeNull();
    expect(result.trendSummary.avg30).toBeNull();
    expect(result.trendSummary.currentWeight).toBeNull();
    expect(result.paceLevel).toBeNull();
    expect(result.rollingSeries).toEqual([]);
    expect(result.goalInfo).toBeNull();
    expect(result.calorieEstimate).toBeNull();
  });

  test('null entries → same as empty', () => {
    const result = deriveWeightGoalAnalytics(null, null, {}, REF);
    expect(result.trendSummary.avg7).toBeNull();
    expect(result.rollingSeries).toEqual([]);
    expect(result.goalInfo).toBeNull();
  });

  test('entries, no goal → trendSummary populated, goalInfo null', () => {
    const entries = [
      { date: '2026-05-25', weight_value: 185 },
      { date: '2026-05-24', weight_value: 184 },
    ];
    const result = deriveWeightGoalAnalytics(entries, null, {}, REF);
    expect(result.trendSummary.currentWeight).toBe(185);
    expect(result.trendSummary.avg7).not.toBeNull();
    expect(result.goalInfo).toBeNull();
    expect(result.calorieEstimate).toBeNull();
  });

  test('entries + goal → goalInfo and calorieEstimate populated', () => {
    const entries = [{ date: '2026-05-25', weight_value: 185 }];
    const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 185 };
    const result = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    expect(result.goalInfo).not.toBeNull();
    expect(result.goalInfo.direction).toBe('loss');
    expect(result.goalInfo.required_weekly_pace).toBeLessThan(0);
    expect(result.calorieEstimate).not.toBeNull();
    expect(result.calorieEstimate.label).toBe('deficit');
  });

  test('goal editing state → uses edited target values', () => {
    const entries = [{ date: '2026-05-25', weight_value: 185 }];
    const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 185 };
    const editState = { goalEditing: true, goalTargetWeight: '180', goalTargetDate: '2026-12-01', goalStartWeight: '' };
    const result = deriveWeightGoalAnalytics(entries, goal, editState, REF);
    expect(result.goalInfo.direction).toBe('loss');
    // target 180 from edited value, not 175 from saved goal
    const delta = 180 - 185;
    expect(result.goalInfo.required_weekly_pace).toBeCloseTo(delta / result.goalInfo.weeks_remaining, 5);
  });

  test('no entries, goal with start_weight → uses start_weight for goal guidance', () => {
    const goal = { target_weight: 170, target_date: '2026-10-01', start_weight: 190 };
    const result = deriveWeightGoalAnalytics([], goal, { goalEditing: false }, REF);
    expect(result.goalInfo).not.toBeNull();
    expect(result.goalInfo.direction).toBe('loss');
  });

  test('no entries, no goal start_weight → goalInfo null', () => {
    const goal = { target_weight: 170, target_date: '2026-10-01', start_weight: null };
    const result = deriveWeightGoalAnalytics([], goal, {}, REF);
    expect(result.goalInfo).toBeNull();
  });

  test('rollingSeries has at most 7 points', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      weight_value: 180 + i * 0.1,
    }));
    const result = deriveWeightGoalAnalytics(entries, null, {}, REF);
    expect(result.rollingSeries.length).toBeLessThanOrEqual(7);
  });

  test('paceLevel is null with fewer than 2 entries', () => {
    const entries = [{ date: '2026-05-25', weight_value: 185 }];
    const result = deriveWeightGoalAnalytics(entries, null, {}, REF);
    expect(result.paceLevel).toBeNull();
  });

  test('maintain goal → calorieEstimate label is maintain', () => {
    const entries = [{ date: '2026-05-25', weight_value: 185 }];
    const goal = { target_weight: 185.1, target_date: '2026-09-01', start_weight: 185 };
    const result = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    expect(result.goalInfo?.direction).toBe('maintain');
    expect(result.calorieEstimate?.label).toBe('maintain');
  });

  test('complete profile → tdee_based calorie estimate', () => {
    const entries = [{ date: '2026-05-25', weight_value: 200 }];
    const goal = { target_weight: 185, target_date: '2026-10-01', start_weight: 200 };
    const profile = { height_cm: 178, date_of_birth: '1990-01-01', sex: 'male', activity_level: 'moderately_active' };
    const result = deriveWeightGoalAnalytics(entries, goal, {}, REF, profile);
    expect(result.calorieEstimate).not.toBeNull();
    expect(result.calorieEstimate.tdee_based).toBe(true);
    expect(result.calorieEstimate.label).toBe('deficit');
    expect(typeof result.calorieEstimate.calories_per_day).toBe('number');
  });

  test('incomplete profile → falls back to legacy estimate', () => {
    const entries = [{ date: '2026-05-25', weight_value: 200 }];
    const goal = { target_weight: 185, target_date: '2026-10-01', start_weight: 200 };
    const profile = { height_cm: 178 }; // missing fields
    const result = deriveWeightGoalAnalytics(entries, goal, {}, REF, profile);
    expect(result.calorieEstimate).not.toBeNull();
    expect(result.calorieEstimate.tdee_based).toBe(false);
  });
});

// ── computeBMR ────────────────────────────────────────────────────────────────

describe('computeBMR', () => {
  test('male BMR calculation', () => {
    // weight 200 lb = 90.718 kg; height 178 cm; age 35
    // 10*90.718 + 6.25*178 - 5*35 + 5 = 907.18 + 1112.5 - 175 + 5 = 1849.68
    const bmr = computeBMR({ weight_lb: 200, height_cm: 178, age: 35, sex: 'male' });
    expect(bmr).toBeCloseTo(1849.68, 0);
  });

  test('female BMR calculation', () => {
    // weight 140 lb = 63.503 kg; height 165 cm; age 30
    // 10*63.503 + 6.25*165 - 5*30 - 161 = 635.03 + 1031.25 - 150 - 161 = 1355.28
    const bmr = computeBMR({ weight_lb: 140, height_cm: 165, age: 30, sex: 'female' });
    expect(bmr).toBeCloseTo(1355.28, 0);
  });

  test('returns null when weight_lb is null', () => {
    expect(computeBMR({ weight_lb: null, height_cm: 178, age: 35, sex: 'male' })).toBeNull();
  });

  test('returns null when height_cm is null', () => {
    expect(computeBMR({ weight_lb: 200, height_cm: null, age: 35, sex: 'male' })).toBeNull();
  });

  test('returns null when age is null', () => {
    expect(computeBMR({ weight_lb: 200, height_cm: 178, age: null, sex: 'male' })).toBeNull();
  });

  test('returns null when sex is missing', () => {
    expect(computeBMR({ weight_lb: 200, height_cm: 178, age: 35, sex: null })).toBeNull();
  });
});

// ── computeTDEE ───────────────────────────────────────────────────────────────

describe('computeTDEE', () => {
  const bmr = 1850;

  test.each([
    ['sedentary',         1850 * 1.2],
    ['lightly_active',    1850 * 1.375],
    ['moderately_active', 1850 * 1.55],
    ['very_active',       1850 * 1.725],
    ['extra_active',      1850 * 1.9],
  ])('%s activity level', (level, expected) => {
    expect(computeTDEE(bmr, level)).toBeCloseTo(expected, 0);
  });

  test('returns null for unrecognized activity level', () => {
    expect(computeTDEE(bmr, 'unknown')).toBeNull();
  });

  test('returns null when bmr is null', () => {
    expect(computeTDEE(null, 'sedentary')).toBeNull();
  });
});

// ── computeCalorieEstimate (TDEE path) ────────────────────────────────────────

describe('computeCalorieEstimate', () => {
  const REF_DATE = new Date('2026-05-26');
  // Birthday in January — clearly already passed relative to REF_DATE regardless of timezone
  const profile = { height_cm: 178, date_of_birth: '1991-01-15', sex: 'male', activity_level: 'moderately_active' };

  test('loss scenario with complete profile → tdee_based deficit target', () => {
    // -1 lb/week → daily adjustment = -500
    const result = computeCalorieEstimate(-1, 'loss', profile, 200, REF_DATE);
    expect(result.tdee_based).toBe(true);
    expect(result.label).toBe('deficit');
    expect(result.calories_per_day).toBeGreaterThan(0);
    // age = 35; verify against directly computed TDEE
    const age = ageFromDateOfBirth(profile.date_of_birth, REF_DATE);
    const bmr = computeBMR({ weight_lb: 200, height_cm: 178, age, sex: 'male' });
    const tdee = computeTDEE(bmr, 'moderately_active');
    expect(result.calories_per_day).toBe(Math.round(tdee - 500));
  });

  test('gain scenario with complete profile → tdee_based surplus target', () => {
    const result = computeCalorieEstimate(0.5, 'gain', profile, 200, REF_DATE);
    expect(result.tdee_based).toBe(true);
    expect(result.label).toBe('surplus');
    expect(result.calories_per_day).toBeGreaterThan(0);
  });

  test('maintain direction + complete profile → tdee_based maintain target', () => {
    const result = computeCalorieEstimate(0, 'maintain', profile, 200, REF_DATE);
    expect(result.label).toBe('maintain');
    expect(result.tdee_based).toBe(true);
    // calories_per_day = TDEE (daily adjustment is 0 for maintain)
    const age = ageFromDateOfBirth(profile.date_of_birth, REF_DATE);
    const bmr = computeBMR({ weight_lb: 200, height_cm: 178, age, sex: 'male' });
    const tdee = computeTDEE(bmr, 'moderately_active');
    expect(result.calories_per_day).toBe(Math.round(tdee));
  });

  test('maintain direction + no profile → legacy maintain (0 cal)', () => {
    const result = computeCalorieEstimate(0, 'maintain', null, 200, REF_DATE);
    expect(result.label).toBe('maintain');
    expect(result.tdee_based).toBe(false);
    expect(result.calories_per_day).toBe(0);
  });

  test('null pace → null result', () => {
    const result = computeCalorieEstimate(null, 'loss', profile, 200, REF_DATE);
    expect(result.calories_per_day).toBeNull();
    expect(result.label).toBeNull();
  });

  test('incomplete profile → falls back to legacy deficit/surplus', () => {
    const result = computeCalorieEstimate(-1, 'loss', { height_cm: 178 }, 200, REF_DATE);
    expect(result.tdee_based).toBe(false);
    expect(result.calories_per_day).toBe(500);
    expect(result.label).toBe('deficit');
  });

  test('null profile → falls back to legacy deficit/surplus', () => {
    const result = computeCalorieEstimate(-1, 'loss', null, 200, REF_DATE);
    expect(result.tdee_based).toBe(false);
    expect(result.calories_per_day).toBe(500);
  });
});

// ── Canonical workout contract ────────────────────────────────────────────────
//
// These tests assert that deriveWorkoutNoteAnalytics is the single shared
// derivation path: its outputs match the individual helpers when called with
// the same sections, guaranteeing there is one answer per input across
// all workout consumers (WorkoutScreen, HomeScreen, StatsScreen).

describe('deriveWorkoutNoteAnalytics — canonical contract: output consistent with individual helpers', () => {
  // Reusable fixture builder: two exercises with session_entries histories.
  function makeContractSections({ squatEntries, benchEntries }) {
    function toSessionEntry(sets) {
      return { skipped: false, raw: 'x', sets };
    }
    return [{
      heading: 'Monday 2026-05-26', subheading: null, kind: 'general',
      exercises: [
        {
          name: 'Squat',
          rows: squatEntries.map(sets => ({ raw: 'x', sets })),
          sets: squatEntries.flat(),
          unparsed_rows: [],
          session_entries: squatEntries.map(toSessionEntry),
        },
        {
          name: 'Bench Press',
          rows: benchEntries.map(sets => ({ raw: 'x', sets })),
          sets: benchEntries.flat(),
          unparsed_rows: [],
          session_entries: benchEntries.map(toSessionEntry),
        },
      ],
    }];
  }

  const squatEntries = [
    [{ weight_value: 225, rep_count: 5 }, { weight_value: 225, rep_count: 5 }],
    [{ weight_value: 235, rep_count: 5 }, { weight_value: 235, rep_count: 5 }],
    [{ weight_value: 245, rep_count: 5 }, { weight_value: 245, rep_count: 5 }],
  ];
  const benchEntries = [
    [{ weight_value: 70, rep_count: 8 }],
    [{ weight_value: 75, rep_count: 8 }],
  ];
  const trackedNames = ['Squat', 'Bench Press'];

  test('weeksIn matches computeWeeksIn(sections) directly', () => {
    const sections = makeContractSections({ squatEntries, benchEntries });
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, trackedNames);
    expect(weeksIn).toBe(computeWeeksIn(sections));
  });

  test('classifications match classifyExerciseSessions(sections, trackedNames) directly', () => {
    const sections = makeContractSections({ squatEntries, benchEntries });
    const { classifications } = deriveWorkoutNoteAnalytics(sections, trackedNames);
    const direct = classifyExerciseSessions(sections, trackedNames);
    expect(classifications).toEqual(direct);
  });

  test('skipData matches deriveSkipData(sections) directly', () => {
    const skipSquat = [
      [{ weight_value: 225, rep_count: 5 }],
      [], // skipped slot — represented as a skipped session_entry
    ];
    const sections = [{
      heading: 'Tuesday', subheading: null, kind: 'general',
      exercises: [{
        name: 'Squat',
        rows: [],
        sets: [],
        unparsed_rows: [],
        session_entries: [
          { skipped: false, raw: '225x5', sets: [{ weight_value: 225, rep_count: 5 }] },
          { skipped: true,  raw: '-',     sets: [] },
        ],
      }],
    }];
    const { skipData } = deriveWorkoutNoteAnalytics(sections, ['Squat']);
    const direct = deriveSkipData(sections);
    expect(skipData).toEqual(direct);
  });

  test('signals match deriveSignals(sections, trackedNames) directly', () => {
    const sections = makeContractSections({ squatEntries, benchEntries });
    const multiplier = 1.07;
    const { signals } = deriveWorkoutNoteAnalytics(sections, trackedNames, multiplier);
    const { exercises: direct } = deriveSignals(sections, trackedNames, multiplier);
    expect(signals).toHaveLength(direct.length);
    signals.forEach((sig, i) => {
      expect(sig.name).toBe(direct[i].name);
      expect(sig.progression_status).toBe(direct[i].progression_status);
      expect(sig.kilo_max).toBe(direct[i].kilo_max);
    });
  });

  test('representative fixture: squat 3 sessions progressing → weeksIn 3, classification progressing', () => {
    const sections = makeContractSections({ squatEntries, benchEntries });
    const { weeksIn, classifications } = deriveWorkoutNoteAnalytics(sections, trackedNames);
    expect(weeksIn).toBe(3);
    expect(classifications[normalizeLiftName('Squat')]).toBe('progressing');
  });

  test('representative fixture: bench 2 sessions progressing → classification progressing', () => {
    const sections = makeContractSections({ squatEntries, benchEntries });
    const { classifications } = deriveWorkoutNoteAnalytics(sections, trackedNames);
    expect(classifications[normalizeLiftName('Bench Press')]).toBe('progressing');
  });
});

// ── computeWeeksIn — pinned contract cases ────────────────────────────────────
//
// Trust-critical: Weeks In is the primary progression-depth display on HomeScreen.
// These cases pin known-correct answers for representative fixture patterns so
// that any regression in the depth semantics is caught immediately.

describe('computeWeeksIn — pinned contract cases', () => {
  function makeSection(exercises) {
    return {
      heading: null, subheading: null, kind: 'general',
      exercises,
    };
  }

  function makeExercise(name, sessionEntryCount, rowCount) {
    const session_entries = Array.from({ length: sessionEntryCount }, () => ({
      skipped: false, raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }],
    }));
    const rows = Array.from({ length: rowCount }, () => ({
      raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }],
    }));
    return { name, rows, sets: [], unparsed_rows: [], session_entries };
  }

  test('12 sessions in a single exercise → weeksIn 12', () => {
    const sections = [makeSection([makeExercise('Squat', 12, 12)])];
    expect(computeWeeksIn(sections)).toBe(12);
  });

  test('two exercises at depth 8 and 12 → weeksIn 12', () => {
    const sections = [makeSection([makeExercise('Squat', 12, 12), makeExercise('Bench Press', 8, 8)])];
    expect(computeWeeksIn(sections)).toBe(12);
  });

  test('exercises split across two sections (days) → weeksIn uses global max', () => {
    const sections = [
      makeSection([makeExercise('Squat', 5, 5)]),
      makeSection([makeExercise('Deadlift', 9, 9)]),
    ];
    expect(computeWeeksIn(sections)).toBe(9);
  });

  test('4 logged + 2 skipped → weeksIn 6 (skipped count toward depth)', () => {
    // rows contains only the 4 non-skipped entries (rows do not capture skips)
    const session_entries = [
      ...Array.from({ length: 4 }, () => ({ skipped: false, raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }] })),
      { skipped: true, raw: '-', sets: [] },
      { skipped: true, raw: '-', sets: [] },
    ];
    const rows = Array.from({ length: 4 }, () => ({ raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }] }));
    const sections = [makeSection([{ name: 'Squat', rows, sets: [], unparsed_rows: [], session_entries }])];
    expect(computeWeeksIn(sections)).toBe(6);
  });

  test('7 plain rows, no session_entries → weeksIn 7', () => {
    const rows = Array.from({ length: 7 }, () => ({ raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }] }));
    const sections = [makeSection([{ name: 'Squat', rows, sets: [], unparsed_rows: [], session_entries: [] }])];
    expect(computeWeeksIn(sections)).toBe(7);
  });

  test('session_entries=6, rows=13 (7 legacy + 6 new) → weeksIn 13', () => {
    const legacyRows = Array.from({ length: 7 }, () => ({ raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }] }));
    const newRows    = Array.from({ length: 6 }, () => ({ raw: '140x5', sets: [{ weight_value: 140, rep_count: 5 }] }));
    const sessionEntries = newRows.map(r => ({ skipped: false, raw: r.raw, sets: r.sets }));
    const sections = [makeSection([{
      name: 'Squat',
      rows: [...legacyRows, ...newRows],
      sets: [],
      unparsed_rows: [],
      session_entries: sessionEntries,
    }])];
    expect(computeWeeksIn(sections)).toBe(13);
  });

  test('null sections → null', () => {
    expect(computeWeeksIn(null)).toBeNull();
  });

  test('empty sections array → 0', () => {
    expect(computeWeeksIn([])).toBe(0);
  });

  test('sections with no session_entries and no rows → 0', () => {
    const sections = [makeSection([{ name: 'Squat', rows: [], sets: [], unparsed_rows: [], session_entries: [] }])];
    expect(computeWeeksIn(sections)).toBe(0);
  });
});

// ── Canonical weight/goal contract ────────────────────────────────────────────
//
// These tests assert that deriveWeightGoalAnalytics (the single canonical entry
// point for Weight, Home, and Stats consumers) produces each field using exactly
// the same derivation as the individual helpers — so that no consumer can
// diverge by calling a helper directly.

describe('deriveWeightGoalAnalytics — canonical contract: output consistent with individual helpers', () => {
  const REF = new Date('2026-05-26T12:00:00');

  const entries = [
    { date: '2026-05-26', weight_value: 186.0 },
    { date: '2026-05-25', weight_value: 185.0 },
    { date: '2026-05-24', weight_value: 184.5 },
    { date: '2026-05-20', weight_value: 183.0 },
    { date: '2026-05-15', weight_value: 182.0 },
    { date: '2026-05-10', weight_value: 181.0 },
    { date: '2026-05-05', weight_value: 180.0 },
    { date: '2026-04-28', weight_value: 179.0 },
  ];

  const goal = { target_weight: 175, target_date: '2026-10-01', start_weight: 186 };

  test('trendSummary matches computeWeightTrendSummary(entries, ref) directly', () => {
    const { trendSummary } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    const direct = computeWeightTrendSummary(entries, REF);
    expect(trendSummary).toEqual(direct);
  });

  test('paceLevel matches computeWeightPaceLevel(entries) directly', () => {
    const { paceLevel } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    const direct = computeWeightPaceLevel(entries);
    expect(paceLevel).toBe(direct);
  });

  test('rollingSeries matches computeWeightRollingAverageSeries(entries, 7) directly', () => {
    const { rollingSeries } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    const direct = computeWeightRollingAverageSeries(entries, 7);
    expect(rollingSeries).toEqual(direct);
  });

  test('goalInfo matches computeWeightGoal called with resolved current weight directly', () => {
    const { goalInfo } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    const resolvedCurrent = resolveGoalCurrentWeight(entries, goal, { goalEditing: false });
    const direct = computeWeightGoal({
      currentWeight: resolvedCurrent,
      targetWeight: goal.target_weight,
      targetDate: goal.target_date,
      referenceDate: REF,
    });
    expect(goalInfo).toEqual(direct);
  });

  test('calorieEstimate matches computeCalorieEstimate called with goalInfo outputs directly', () => {
    const { goalInfo, calorieEstimate } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    const resolvedCurrent = resolveGoalCurrentWeight(entries, goal, { goalEditing: false });
    const direct = computeCalorieEstimate(goalInfo.required_weekly_pace, goalInfo.direction, null, resolvedCurrent, REF);
    expect(calorieEstimate).toEqual(direct);
  });

  test('TDEE-based calorieEstimate: full chain matches manual BMR → TDEE → calories_per_day', () => {
    const profile = { height_cm: 178, date_of_birth: '1991-01-15', sex: 'male', activity_level: 'moderately_active' };
    const { goalInfo, calorieEstimate } = deriveWeightGoalAnalytics(entries, goal, {}, REF, profile);

    // Manually compute expected value
    const age = ageFromDateOfBirth(profile.date_of_birth, REF);
    const resolvedCurrent = resolveGoalCurrentWeight(entries, goal, { goalEditing: false });
    const bmr = computeBMR({ weight_lb: resolvedCurrent, height_cm: profile.height_cm, age, sex: profile.sex });
    const tdee = computeTDEE(bmr, profile.activity_level);
    const dailyAdjustment = Math.round((goalInfo.required_weekly_pace * 3500) / 7);
    const expected = Math.round(tdee + dailyAdjustment);

    expect(calorieEstimate.tdee_based).toBe(true);
    expect(calorieEstimate.calories_per_day).toBe(expected);
  });
});

// ── Cross-consumer consistency ────────────────────────────────────────────────
//
// Same input must yield the same answer regardless of which consumer requests it.
// All weight/goal consumers (Weight tab, Home tab, Stats tab) share the canonical
// deriveWeightGoalAnalytics layer. These tests verify there is one answer per input
// by cross-checking that the canonical output fields are internally consistent.

describe('cross-consumer consistency — weight/goal', () => {
  const REF = new Date('2026-05-26T12:00:00');

  test('currentWeight from trendSummary equals resolveGoalCurrentWeight for same inputs', () => {
    const entries = [
      { date: '2026-05-26', weight_value: 185 },
      { date: '2026-05-24', weight_value: 184 },
    ];
    const goal = { target_weight: 175, target_date: '2026-10-01', start_weight: 185 };
    const { trendSummary } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    const resolved = resolveGoalCurrentWeight(entries, goal, { goalEditing: false });
    expect(trendSummary.currentWeight).toBe(resolved);
  });

  test('goalInfo.direction is consistent with calorieEstimate.label for loss goal', () => {
    const entries = [{ date: '2026-05-26', weight_value: 185 }];
    const goal = { target_weight: 175, target_date: '2026-10-01', start_weight: 185 };
    const { goalInfo, calorieEstimate } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    expect(goalInfo.direction).toBe('loss');
    expect(calorieEstimate.label).toBe('deficit');
  });

  test('goalInfo.direction is consistent with calorieEstimate.label for gain goal', () => {
    const entries = [{ date: '2026-05-26', weight_value: 150 }];
    const goal = { target_weight: 165, target_date: '2026-10-01', start_weight: 150 };
    const { goalInfo, calorieEstimate } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    expect(goalInfo.direction).toBe('gain');
    expect(calorieEstimate.label).toBe('surplus');
  });

  test('goalInfo.direction is consistent with calorieEstimate.label for maintain goal', () => {
    const entries = [{ date: '2026-05-26', weight_value: 175 }];
    const goal = { target_weight: 175.2, target_date: '2026-10-01', start_weight: 175 };
    const { goalInfo, calorieEstimate } = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    expect(goalInfo.direction).toBe('maintain');
    expect(calorieEstimate.label).toBe('maintain');
  });

  test('paceLevel is computed from the same entry set as trendSummary', () => {
    const entries = [
      { date: '2026-05-26', weight_value: 188 },
      { date: '2026-05-25', weight_value: 185 },
    ];
    const { trendSummary, paceLevel } = deriveWeightGoalAnalytics(entries, null, {}, REF);
    // delta = 3 lb → spike
    expect(paceLevel).toBe('spike');
    // trendSummary.paceFlag tracks direction; paceLevel tracks severity — both from same entries
    expect(trendSummary.paceFlag).toBe('gain');
  });

  test('two independent deriveWeightGoalAnalytics calls with same inputs yield identical results', () => {
    const entries = [
      { date: '2026-05-26', weight_value: 185 },
      { date: '2026-05-20', weight_value: 184 },
    ];
    const goal = { target_weight: 170, target_date: '2026-10-01', start_weight: 185 };
    const result1 = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    const result2 = deriveWeightGoalAnalytics(entries, goal, {}, REF);
    expect(result1.trendSummary).toEqual(result2.trendSummary);
    expect(result1.paceLevel).toBe(result2.paceLevel);
    expect(result1.goalInfo).toEqual(result2.goalInfo);
    expect(result1.calorieEstimate).toEqual(result2.calorieEstimate);
  });
});

// ── Cross-consumer consistency — workout ─────────────────────────────────────

describe('cross-consumer consistency — workout', () => {
  function makeWorkoutSections(sessionCounts) {
    return sessionCounts.map(({ name, count }) => ({
      heading: null, subheading: null, kind: 'general',
      exercises: [{
        name,
        rows: Array.from({ length: count }, () => ({ raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }] })),
        sets: [],
        unparsed_rows: [],
        session_entries: Array.from({ length: count }, () => ({
          skipped: false, raw: '135x5', sets: [{ weight_value: 135, rep_count: 5 }],
        })),
      }],
    }));
  }

  test('weeksIn is consistent: canonical path equals computeWeeksIn for same sections', () => {
    const sections = makeWorkoutSections([{ name: 'Squat', count: 5 }, { name: 'Deadlift', count: 8 }]);
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, ['Squat', 'Deadlift']);
    expect(weeksIn).toBe(computeWeeksIn(sections));
    expect(weeksIn).toBe(8);
  });

  test('two independent deriveWorkoutNoteAnalytics calls with same inputs yield identical weeksIn', () => {
    const sections = makeWorkoutSections([{ name: 'Squat', count: 6 }]);
    const trackedNames = ['Squat'];
    const a = deriveWorkoutNoteAnalytics(sections, trackedNames);
    const b = deriveWorkoutNoteAnalytics(sections, trackedNames);
    expect(a.weeksIn).toBe(b.weeksIn);
    expect(a.classifications).toEqual(b.classifications);
  });

  test('weeksIn from null sections is null regardless of trackedNames', () => {
    expect(deriveWorkoutNoteAnalytics(null, ['Squat', 'Deadlift']).weeksIn).toBeNull();
    expect(deriveWorkoutNoteAnalytics(null, []).weeksIn).toBeNull();
  });
});

// ── deriveNonWeightedTrackedExerciseMetrics ───────────────────────────────────

function nwSection(name, sessions) {
  const session_entries = sessions.map(sets =>
    sets === 'skip'
      ? { skipped: true, raw: '-', sets: [] }
      : { skipped: false, raw: 'x', sets }
  );
  return {
    heading: null, subheading: null, kind: 'general',
    exercises: [{ name, rows: [], sets: [], unparsed_rows: [], session_entries }],
  };
}

function repSet(rep_count) { return { weight_value: null, rep_count, duration_seconds: null, assistance_value: null }; }
function durSet(duration_seconds) { return { weight_value: null, rep_count: null, duration_seconds, assistance_value: null }; }
function wSet(weight_value, rep_count) { return { weight_value, rep_count, duration_seconds: null, assistance_value: null }; }

describe('deriveNonWeightedTrackedExerciseMetrics', () => {
  test('null sections → empty result', () => {
    expect(deriveNonWeightedTrackedExerciseMetrics(null, ['Pull-up'])).toEqual({});
  });

  test('empty exerciseNames → empty result', () => {
    const sections = [nwSection('Pull-up', [[repSet(10)]])];
    expect(deriveNonWeightedTrackedExerciseMetrics(sections, [])).toEqual({});
  });

  test('exercise absent from sections → not in result', () => {
    const sections = [nwSection('Pull-up', [[repSet(10)]])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Dips']);
    expect(result['dips']).toBeUndefined();
  });

  test('weighted exercise (weight_value > 0) → skipped, not in result', () => {
    const sections = [nwSection('Squat', [[wSet(225, 5)]])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Squat']);
    expect(result['squat']).toBeUndefined();
  });

  test('reps-only: first session → avg_reps and best_set_reps set, arrow = dash', () => {
    const sections = [nwSection('Pull-up', [[repSet(8), repSet(8), repSet(7)]])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Pull-up']);
    expect(result['pull-up']).toEqual({
      exercise_class: 'reps_only',
      avg_reps: 8,
      best_set_reps: 8,
      reps_arrow: 'dash',
    });
  });

  test('reps-only: session 2 avg_reps increased → arrow = up', () => {
    const sections = [nwSection('Pull-up', [
      [repSet(8), repSet(8)],
      [repSet(10), repSet(9)],
    ])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Pull-up']);
    expect(result['pull-up'].avg_reps).toBe(10); // (10+9)/2 = 9.5 rounded up to 10
    expect(result['pull-up'].best_set_reps).toBe(10);
    expect(result['pull-up'].reps_arrow).toBe('up');
  });

  test('reps-only: session 2 avg_reps decreased → arrow = down', () => {
    const sections = [nwSection('Pull-up', [
      [repSet(10), repSet(10)],
      [repSet(7), repSet(7)],
    ])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Pull-up']);
    expect(result['pull-up'].reps_arrow).toBe('down');
  });

  test('reps-only: session 2 avg_reps unchanged → arrow = flat', () => {
    const sections = [nwSection('Pull-up', [
      [repSet(8), repSet(7)],
      [repSet(8), repSet(7)],
    ])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Pull-up']);
    expect(result['pull-up'].reps_arrow).toBe('flat');
  });

  test('reps-only: all sets have rep_count = 0 → exercise not in result (unclassifiable)', () => {
    const sections = [nwSection('Pull-up', [[repSet(0), repSet(0)]])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Pull-up']);
    expect(result['pull-up']).toBeUndefined();
  });

  test('time-based: first session → avg_hold and best_hold set, arrow = dash', () => {
    const sections = [nwSection('Plank', [[durSet(45), durSet(60)]])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Plank']);
    expect(result['plank']).toEqual({
      exercise_class: 'time_based',
      avg_hold: 52.5,
      best_hold: 60,
      hold_arrow: 'dash',
    });
  });

  test('time-based: avg_hold increased → arrow = up', () => {
    const sections = [nwSection('Plank', [
      [durSet(45)],
      [durSet(60)],
    ])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Plank']);
    expect(result['plank'].avg_hold).toBe(60);
    expect(result['plank'].best_hold).toBe(60);
    expect(result['plank'].hold_arrow).toBe('up');
  });

  test('time-based: avg_hold decreased → arrow = down', () => {
    const sections = [nwSection('Plank', [
      [durSet(60)],
      [durSet(45)],
    ])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Plank']);
    expect(result['plank'].hold_arrow).toBe('down');
  });

  test('time-based: avg_hold unchanged → arrow = flat', () => {
    const sections = [nwSection('Plank', [
      [durSet(60)],
      [durSet(60)],
    ])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Plank']);
    expect(result['plank'].hold_arrow).toBe('flat');
  });

  test('skipped sessions are excluded from session count; first valid session → dash', () => {
    const sections = [nwSection('Pull-up', ['skip', [repSet(8)]])];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Pull-up']);
    expect(result['pull-up'].reps_arrow).toBe('dash');
  });

  test('multiple exercises in one call', () => {
    const sections = [
      nwSection('Pull-up', [[repSet(10)], [repSet(12)]]),
      nwSection('Plank', [[durSet(30)], [durSet(45)]]),
    ];
    const result = deriveNonWeightedTrackedExerciseMetrics(sections, ['Pull-up', 'Plank']);
    expect(result['pull-up'].exercise_class).toBe('reps_only');
    expect(result['pull-up'].reps_arrow).toBe('up');
    expect(result['plank'].exercise_class).toBe('time_based');
    expect(result['plank'].hold_arrow).toBe('up');
  });
});

// ── derive1kTotalSeries (per-session Big-3 1RM total) ─────────────────────────

describe('derive1kTotalSeries', () => {
  const SEL = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };
  // Epley: weight * (1 + reps/30)
  const epley = (wt, reps) => wt * (1 + reps / 30);

  // Build a section whose exercise has both session_entries and the flattened
  // sets/rows the real parser produces (flushExercise: sets = rows.flatMap).
  function liftSection(name, sessions) {
    const session_entries = [];
    const rows = [];
    for (const e of sessions) {
      if (e === 'skip') { session_entries.push({ skipped: true, raw: '-', sets: [] }); continue; }
      const sets = Array.isArray(e) ? e : [e];
      session_entries.push({ skipped: false, raw: 'x', sets });
      rows.push({ raw: 'x', sets });
    }
    return {
      heading: null, subheading: null, kind: 'general',
      exercises: [{ name, rows, sets: rows.flatMap(r => r.sets), unparsed_rows: [], session_entries }],
    };
  }

  function lifts({ bench = [], squat = [], deadlift = [] }) {
    return [
      liftSection('DB Bench Press', bench),
      liftSection('Squat', squat),
      liftSection('Deadlift', deadlift),
    ];
  }

  test('zips three lifts by session index and totals best-Epley per session', () => {
    const sections = lifts({
      bench:    [w(100, 10), w(110, 10)],
      squat:    [w(200, 5),  w(210, 5)],
      deadlift: [w(300, 5),  w(315, 5)],
    });
    const series = derive1kTotalSeries(sections, SEL);
    expect(series).toHaveLength(2);
    expect(series[0].session).toBe(1);
    expect(series[1].session).toBe(2);
    expect(series[0].bench).toBeCloseTo(epley(100, 10), 5);
    expect(series[0].squat).toBeCloseTo(epley(200, 5), 5);
    expect(series[0].deadlift).toBeCloseTo(epley(300, 5), 5);
    expect(series[0].total).toBeCloseTo(epley(100, 10) + epley(200, 5) + epley(300, 5), 5);
    expect(series[1].total).toBeCloseTo(epley(110, 10) + epley(210, 5) + epley(315, 5), 5);
  });

  test('series length is the min session count across the three lifts', () => {
    const sections = lifts({
      bench:    [w(100, 10), w(110, 10), w(120, 10)],
      squat:    [w(200, 5),  w(210, 5)],
      deadlift: [w(300, 5),  w(315, 5),  w(325, 5)],
    });
    const series = derive1kTotalSeries(sections, SEL);
    expect(series).toHaveLength(2);
  });

  test('best Epley within a session uses the heaviest estimated set', () => {
    const sections = lifts({
      bench:    [[w(100, 10), w(120, 3)]],
      squat:    [w(200, 5)],
      deadlift: [w(300, 5)],
    });
    const series = derive1kTotalSeries(sections, SEL);
    // max(epley(100,10)=133.33, epley(120,3)=132) → 133.33
    expect(series[0].bench).toBeCloseTo(epley(100, 10), 5);
  });

  test('a skipped session is dropped without shifting later sessions out of alignment', () => {
    const sections = lifts({
      bench:    [w(100, 10), 'skip',     w(110, 10)],
      squat:    [w(200, 5),  w(210, 5),  w(220, 5)],
      deadlift: [w(300, 5),  w(315, 5),  w(325, 5)],
    });
    const series = derive1kTotalSeries(sections, SEL);
    // Ordinal 1 (bench skipped) is dropped entirely; ordinals 0 and 2 stay aligned
    // across all three lifts. Bench's 3rd session must pair with squat/deadlift's
    // 3rd session — never with their 2nd.
    expect(series).toHaveLength(2);
    expect(series[0].session).toBe(1);
    expect(series[1].session).toBe(3);
    expect(series[1].bench).toBeCloseTo(epley(110, 10), 5);
    expect(series[1].squat).toBeCloseTo(epley(220, 5), 5);
    expect(series[1].deadlift).toBeCloseTo(epley(325, 5), 5);
  });

  test('a session with no valid weighted set is a gap, not a shift', () => {
    const sections = lifts({
      // ordinal 1 bench has only an unweighted/zero set → null PR → that cycle drops
      bench:    [w(100, 10), w(0, 0),    w(110, 10)],
      squat:    [w(200, 5),  w(210, 5),  w(220, 5)],
      deadlift: [w(300, 5),  w(315, 5),  w(325, 5)],
    });
    const series = derive1kTotalSeries(sections, SEL);
    expect(series.map(p => p.session)).toEqual([1, 3]);
    expect(series[1].squat).toBeCloseTo(epley(220, 5), 5);
  });

  test('missing lift in note → empty series', () => {
    const sections = lifts({
      bench: [w(100, 10), w(110, 10)],
      squat: [w(200, 5),  w(210, 5)],
      // no deadlift
    });
    expect(derive1kTotalSeries(sections, SEL)).toEqual([]);
  });

  test('final series total matches derive1kTotal latest scope', () => {
    const sections = lifts({
      bench:    [w(100, 10), w(110, 10)],
      squat:    [w(200, 5),  w(210, 5)],
      deadlift: [w(300, 5),  w(315, 5)],
    });
    const series = derive1kTotalSeries(sections, SEL);
    const oneK = derive1kTotal(sections, SEL);
    expect(series[series.length - 1].total).toBeCloseTo(oneK.total, 5);
  });

  // Current-performance semantics (issue #250): the 1K total tracks the latest
  // complete Big-3 cycle and must follow it down after a lighter session.
  test('derive1kTotal tracks the latest cycle, not the max, after a lighter session', () => {
    const sections = lifts({
      bench:    [w(225, 5), w(235, 5), w(200, 5)], // latest cycle is lighter than the peak
      squat:    [w(315, 3), w(320, 3), w(310, 3)],
      deadlift: [w(405, 1), w(415, 1), w(400, 1)],
    });
    const oneK = derive1kTotal(sections, SEL);
    expect(oneK.bench).toBeCloseTo(epley(200, 5), 5);
    expect(oneK.bench).toBeLessThan(epley(235, 5));
    expect(oneK.total).toBeCloseTo(epley(200, 5) + epley(310, 3) + epley(400, 1), 5);
  });

  // Regression for issue #250 reviewer feedback: a skipped latest lift must drop
  // the total to the last complete cycle, never mix one lift's earlier cycle with
  // the others' newer cycle. derive1kTotal must equal the last series point.
  test('derive1kTotal never sums PRs from different cycles (alignment with series)', () => {
    const sections = lifts({
      bench:    [w(225, 5), 'skip'],      // latest cycle skips bench
      squat:    [w(315, 3), w(320, 3)],
      deadlift: [w(405, 1), w(415, 1)],
    });
    const series = derive1kTotalSeries(sections, SEL);
    const oneK = derive1kTotal(sections, SEL);
    // Series emits only cycle 1 (cycle 2 is not a complete Big-3 point).
    expect(series.map(p => p.session)).toEqual([1]);
    expect(oneK.total).toBeCloseTo(series[series.length - 1].total, 5);
    expect(oneK.bench).toBeCloseTo(epley(225, 5), 5);
    expect(oneK.squat).toBeCloseTo(epley(315, 3), 5); // cycle 1, NOT 320 (cycle 2)
    expect(oneK.deadlift).toBeCloseTo(epley(405, 1), 5);
  });

  test('derive1kTotal shows present lifts but null total when a lift is absent', () => {
    const sections = lifts({
      bench:  [w(225, 5), w(235, 5)],
      squat:  [w(315, 3), w(320, 3)],
      // no deadlift
    });
    const oneK = derive1kTotal(sections, SEL);
    expect(oneK.total).toBeNull();
    expect(oneK.bench).toBeCloseTo(epley(235, 5), 5);
    expect(oneK.squat).toBeCloseTo(epley(320, 3), 5);
    expect(oneK.deadlift).toBeNull();
  });
});

// ── computeWeightRollingAverageSeries — 30-day window ─────────────────────────

describe('computeWeightRollingAverageSeries — windowDays', () => {
  test('windowDays=30 reports 30-day rolling averages (wider window than 7-day)', () => {
    // 40 days of entries trending up; the 30-day average lags below the 7-day average.
    const entries = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      weight_value: 180 + i,
    })).filter(e => e.date <= '2026-04-30');
    const series7 = computeWeightRollingAverageSeries(entries, 30, 7);
    const series30 = computeWeightRollingAverageSeries(entries, 30, 30);
    const last7 = series7[series7.length - 1].value;
    const last30 = series30[series30.length - 1].value;
    expect(last30).toBeLessThan(last7);
  });

  test('defaults to 7-day window for backward compatibility', () => {
    const entries = [
      { date: '2026-05-25', weight_value: 185 },
      { date: '2026-05-24', weight_value: 184 },
    ];
    expect(computeWeightRollingAverageSeries(entries, 7))
      .toEqual(computeWeightRollingAverageSeries(entries, 7, 7));
  });
});

describe('deriveWeightGoalAnalytics — rollingSeries30', () => {
  const REF = new Date('2026-05-25T12:00:00');

  test('exposes a 30-day rolling series alongside the 7-day series', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      weight_value: 180 + i * 0.1,
    }));
    const result = deriveWeightGoalAnalytics(entries, null, {}, REF);
    expect(Array.isArray(result.rollingSeries30)).toBe(true);
    expect(result.rollingSeries30).toEqual(computeWeightRollingAverageSeries(entries, 30, 30));
  });

  test('empty entries → rollingSeries30 is empty', () => {
    const result = deriveWeightGoalAnalytics([], null, {}, REF);
    expect(result.rollingSeries30).toEqual([]);
  });
});

describe('deriveCheckInHistory', () => {
  const C1 = {
    status: 'rough',
    reasons: ['fatigued', 'short on sleep'],
    exercises_skipped: 1,
    volume_decline_pct: 12,
    flagged: ['bench press'],
    responded_at: '2026-05-01T08:00:00.000Z',
  };
  const C2 = {
    status: 'ok',
    reasons: [],
    exercises_skipped: 0,
    volume_decline_pct: null,
    flagged: [],
    responded_at: '2026-05-10T09:00:00.000Z',
  };
  const C3 = {
    status: 'rough',
    reasons: ['fatigued', 'sore'],
    exercises_skipped: 2,
    volume_decline_pct: 25,
    flagged: ['squat'],
    responded_at: '2026-05-20T10:00:00.000Z',
  };

  test('empty/null input returns empty shape', () => {
    expect(deriveCheckInHistory(null)).toEqual({ list: [], summary: { total: 0, top_reason: null } });
    expect(deriveCheckInHistory([])).toEqual({ list: [], summary: { total: 0, top_reason: null } });
  });

  test('notes with null session_checkins contribute nothing', () => {
    const notes = [{ session_checkins: null }, { session_checkins: null }];
    expect(deriveCheckInHistory(notes)).toEqual({ list: [], summary: { total: 0, top_reason: null } });
  });

  test('returns reverse-chronological order across notes', () => {
    const notes = [
      { session_checkins: { '0': C1 } },
      { session_checkins: { '0': C3, '1': C2 } },
    ];
    const { list } = deriveCheckInHistory(notes);
    expect(list).toHaveLength(3);
    expect(list[0].responded_at).toBe(C3.responded_at);
    expect(list[1].responded_at).toBe(C2.responded_at);
    expect(list[2].responded_at).toBe(C1.responded_at);
  });

  test('summary total counts only rough check-ins', () => {
    const notes = [{ session_checkins: { '0': C1, '1': C2, '2': C3 } }];
    const { summary } = deriveCheckInHistory(notes);
    expect(summary.total).toBe(2);
  });

  test('top_reason is most frequent reason across rough check-ins', () => {
    const notes = [{ session_checkins: { '0': C1, '1': C3 } }];
    const { summary } = deriveCheckInHistory(notes);
    expect(summary.top_reason).toBe('fatigued');
  });

  test('top_reason is null when no rough check-ins', () => {
    const notes = [{ session_checkins: { '0': C2 } }];
    const { summary } = deriveCheckInHistory(notes);
    expect(summary.total).toBe(0);
    expect(summary.top_reason).toBeNull();
  });

  test('list entries include expected fields only', () => {
    const notes = [{ session_checkins: { '0': C1 } }];
    const { list } = deriveCheckInHistory(notes);
    expect(list[0]).toEqual({
      responded_at: C1.responded_at,
      status: C1.status,
      reasons: C1.reasons,
      exercises_skipped: C1.exercises_skipped,
      volume_decline_pct: C1.volume_decline_pct,
      flagged: C1.flagged,
    });
  });
});
