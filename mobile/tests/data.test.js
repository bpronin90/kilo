import { computeWeightTrends, computeWeightPaceLevel, computeKiloMax, makeWorkoutNoteItem, normalizeLiftName, listTrackedLifts } from '../lib/data';

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

  test('defaults currentSince to null', () => {
    const item = makeWorkoutNoteItem({ title: 'Push Day' });
    expect(item.currentSince).toBeNull();
  });

  test('accepts isCurrent: true', () => {
    const item = makeWorkoutNoteItem({ title: 'Push Day', isCurrent: true });
    expect(item.isCurrent).toBe(true);
  });

  test('accepts a currentSince timestamp', () => {
    const ts = '2026-05-20T10:00:00.000Z';
    const item = makeWorkoutNoteItem({ title: 'Push Day', isCurrent: true, currentSince: ts });
    expect(item.currentSince).toBe(ts);
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
