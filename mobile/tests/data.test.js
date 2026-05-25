import { computeWeightTrends, computeWeightPaceLevel, computeKiloMax, makeWorkoutNoteItem, normalizeLiftName, listTrackedLifts, getDefaultTrackedNames, computeWeeksIn, classifyExerciseSessions, deriveSkipData, computeRepDropOff, deriveRepDropOffFlags, getLatestRepDropOff, detectBig3Asymmetry, currentWeekStart, rollingWindowStart, computeWeeklySummary } from '../lib/data';


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

  test('null workoutNote → empty banners, sessionStatusRows null (fully degraded)', () => {
    expect(computeWeeklySummary([], null)).toEqual({ hasActivity: false, attendanceBanners: [], sessionStatusRows: null, flags: { hit_wall: false, attendance: false, asymmetry: false } });
  });

  test('note with all persisted fields null → empty banners, sessionStatusRows null (no producer yet)', () => {
    const note = makeWorkoutNoteItem({ title: 'Test' });
    expect(computeWeeklySummary([], note)).toEqual({ hasActivity: false, attendanceBanners: [], sessionStatusRows: null, flags: { hit_wall: false, attendance: false, asymmetry: false } });
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

  test('empty attendance_flags array → empty banners', () => {
    const note = { ...makeWorkoutNoteItem({ title: 'Test' }), attendance_flags: [] };
    expect(computeWeeklySummary([], note).attendanceBanners).toEqual([]);
  });

  // attendance_flags → attendanceBanners display change

  test('consecutive_exercise_skips flag → banner copy included', () => {
    const note = {
      ...makeWorkoutNoteItem({ title: 'Test' }),
      attendance_flags: [{ type: 'consecutive_exercise_skips', exercise_name: 'Squat', exercise_id: 'squat', consecutive_count: 2 }],
    };
    const { attendanceBanners } = computeWeeklySummary([], note);
    expect(attendanceBanners).toHaveLength(1);
    expect(attendanceBanners[0]).toContain('Squat');
    expect(attendanceBanners[0]).toContain('2');
  });

  test('repeated_weekday_skip flag → banner copy included', () => {
    const note = {
      ...makeWorkoutNoteItem({ title: 'Test' }),
      attendance_flags: [{ type: 'repeated_weekday_skip', weekday: 'monday', skip_count: 3 }],
    };
    const { attendanceBanners } = computeWeeklySummary([], note);
    expect(attendanceBanners).toHaveLength(1);
    expect(attendanceBanners[0]).toContain('Monday');
  });

  test('multiple flags → multiple banners', () => {
    const note = {
      ...makeWorkoutNoteItem({ title: 'Test' }),
      attendance_flags: [
        { type: 'consecutive_exercise_skips', exercise_name: 'Squat', exercise_id: 'squat', consecutive_count: 2 },
        { type: 'repeated_weekday_skip', weekday: 'friday', skip_count: 2 },
      ],
    };
    expect(computeWeeklySummary([], note).attendanceBanners).toHaveLength(2);
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
    expect(notes[0].copy).toContain('steady');
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

  test('note re-fires after relationship breaks and re-emerges (new runStart index)', () => {
    // Session order: baseline(0) → run A sessions(1,2) → break(3) → run B sessions(4,5)
    // The dismiss key from run A encodes run A's start index (1).
    // When run B is active, its start index (4) differs → note re-fires.
    const sections = [
      // Index 0: baseline
      asymSection('2023-12-18', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Index 1: squat progresses, bench stalls → run A starts (runStart=1)
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Index 2: squat progresses, bench stalls → run A count=2, triggers
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(245, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Index 3: both stalled → shared concrete classification → break
      asymSection('2024-01-08', [
        { name: 'Squat', sets: [s(245, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Index 4: squat progresses, bench stalls → run B starts (runStart=4)
      asymSection('2024-01-15', [
        { name: 'Squat', sets: [s(255, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Index 5: squat progresses, bench stalls → run B count=2, triggers
      asymSection('2024-01-22', [
        { name: 'Squat', sets: [s(265, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];

    // Simulate dismiss during run A (runStart index = 1)
    const runADismissKey = 'asymmetry:squat_bench:1';
    const dismissed = { [runADismissKey]: true };

    // After run B emerges, the note should re-fire because runStart index changed to 4.
    const notes = detectBig3Asymmetry(sections, dismissed);
    expect(notes.length).toBe(1);
    expect(notes[0].dismissKey).not.toBe(runADismissKey);
    expect(notes[0].dismissKey).toBe('asymmetry:squat_bench:4');
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
    expect(note.copy).toBe('Deadlift progressing, bench steady — worth reviewing.');
  });

  test('null-classification index does not break the run or reset dismissKey', () => {
    // Asymmetric run with a null-classification index in the middle (bench absent at index 2).
    // The null index must NOT reset runStart. runStart should remain index 1.
    const sections = [
      // Index 0: baseline
      asymSection('2023-12-18', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Index 1: squat progresses, bench stalls → asymmetric, runStart=1
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      // Index 2: only squat logged — bench is null at this index → ignored, does not reset run
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(245, 5)] },
      ]),
      // Index 3: squat progresses, bench stalls → asymmetric, runCount reaches 2
      asymSection('2024-01-08', [
        { name: 'Squat', sets: [s(255, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];
    const notes = detectBig3Asymmetry(sections);
    expect(notes.length).toBe(1);
    // runStart index = 1 (null index 2 did not reset it)
    expect(notes[0].dismissKey).toBe('asymmetry:squat_bench:1');

    // Dismissing with the original runStart key must suppress the note.
    const dismissed = { [notes[0].dismissKey]: true };
    expect(detectBig3Asymmetry(sections, dismissed)).toEqual([]);
  });
});

// ── currentWeekStart ──────────────────────────────────────────────────────────

describe('currentWeekStart', () => {
  test('returns Sunday of the same week for a Wednesday', () => {
    // 2026-05-20 is a Wednesday
    expect(currentWeekStart(new Date('2026-05-20T12:00:00'))).toBe('2026-05-17');
  });

  test('returns the same day if it is already Sunday', () => {
    // 2026-05-24 is a Sunday
    expect(currentWeekStart(new Date('2026-05-24T12:00:00'))).toBe('2026-05-24');
  });

  test('returns Sunday of the same week for a Saturday', () => {
    // 2026-05-30 is a Saturday
    expect(currentWeekStart(new Date('2026-05-30T12:00:00'))).toBe('2026-05-24');
  });

  test('handles month boundary correctly', () => {
    // 2026-06-01 is a Monday
    expect(currentWeekStart(new Date('2026-06-01T12:00:00'))).toBe('2026-05-31');
  });
});

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

  test('consumes Big 3 deltas opportunistically', () => {
    const sections = [asymSection('2026-05-24', [{ name: 'Squat', sets: [{ weight_value: 225, rep_count: 5 }] }])];
    const deltas = { squat: 5, bench: -2.5, deadlift: 0 };
    const workoutNote = { big_3_deltas: deltas };
    const result = computeWeeklySummary(sections, workoutNote);
    expect(result.deltas).toEqual(deltas);
  });

  test('detects hit-wall flag', () => {
    const sections = [asymSection('2026-05-24', [{ name: 'Squat', sets: [{ weight_value: 225, rep_count: 5 }] }])];
    const workoutNote = {
      rep_drop_off_flags: {
        squat: { '0': 'hit_wall' }
      }
    };
    const result = computeWeeklySummary(sections, workoutNote);
    expect(result.flags.hit_wall).toBe(true);
  });

  test('detects attendance flags', () => {
    const sections = [asymSection('2026-05-24', [{ name: 'Squat', sets: [{ weight_value: 225, rep_count: 5 }] }])];
    const workoutNote = {
      attendance_flags: [{ type: 'repeated_weekday_skip', weekday: 'Monday', skip_count: 2 }]
    };
    const result = computeWeeklySummary(sections, workoutNote);
    expect(result.flags.attendance).toBe(true);
  });

  test('detects asymmetry notes (respecting dismissals)', () => {
    const sections = [
      asymSection('2023-12-18', [
        { name: 'Squat', sets: [s(225, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      asymSection('2023-12-25', [
        { name: 'Squat', sets: [s(235, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
      asymSection('2024-01-01', [
        { name: 'Squat', sets: [s(245, 5)] },
        { name: 'DB Bench Press', sets: [s(100, 8)] },
      ]),
    ];
    
    // Without dismissal
    const result = computeWeeklySummary(sections, {});
    expect(result.flags.asymmetry).toBe(true);
    
    // The runStart will be '2023-12-25' (Monday of the 12-25 week)
    const dismissed = { 'asymmetry:squat_bench:1': true };
    const resultDismissed = computeWeeklySummary(sections, {}, { dismissedAsymmetries: dismissed });
    expect(resultDismissed.flags.asymmetry).toBe(false);
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

describe('computeWeeklySummary classification counts tests', () => {
  test('includes initial count and uses provided classifications', () => {
    const sections = [asymSection('2026-05-24', [{ name: 'Squat', sets: [{ weight_value: 225, rep_count: 5 }] }])];
    const classifications = { squat: 'initial', bench: 'progressing' };
    const result = computeWeeklySummary(sections, {}, { classifications });
    expect(result.classifications.initial).toBe(1);
    expect(result.classifications.progressing).toBe(1);
  });
});
