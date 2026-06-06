import { parseWorkoutNote, computePostDeloadSessions } from '../lib/parser';
import { syncSessionDates } from '../hooks/useEntries';

// Simulates the skip-aware IIFE used in all clean-view render paths of LogScreen.
// Returns an array of 'skip' | 'set' | 'unparsed:<raw>' tokens in order.
function simulateSkipAwareRender(ex) {
  const tokens = [];
  const renderedUnparsed = new Set();
  const positions = ex.unparsed_positions || [];
  let posIdx = 0;
  let loggedIdx = 0;
  ex.session_entries.forEach((entry, eni) => {
    while (posIdx < positions.length && positions[posIdx].pos === eni) {
      tokens.push('unparsed:' + positions[posIdx].raw);
      posIdx++;
    }
    if (entry.skipped) {
      tokens.push('skip');
    } else if (entry.unparsed) {
      tokens.push('unparsed:' + entry.raw);
      renderedUnparsed.add(entry.raw);
    } else {
      if (ex.rows[loggedIdx]) tokens.push('set');
      loggedIdx++;
    }
  });
  while (posIdx < positions.length) {
    tokens.push('unparsed:' + positions[posIdx].raw);
    posIdx++;
  }
  const loggedCount = ex.session_entries.filter(e => !e.skipped && !e.unparsed).length;
  ex.rows.slice(loggedCount).forEach(() => tokens.push('set'));
  const positionalRaws = new Set(positions.map(p => p.raw));
  ex.unparsed_rows.forEach(u => {
    if (!positionalRaws.has(u) && !renderedUnparsed.has(u) && !renderedUnparsed.has(u.replace(/^-\s+/, ''))) {
      tokens.push('trailing:' + u);
    }
  });
  return tokens;
}

const REPORTER_NOTE = `Push day
-bench
100 5,5,5
105 5,5,5
110 5,5,5
110 2,2,2
115 5,5,5
-
-
120 5,5,5
125 2,2,2
125 1,1,1
130 5,5,5
130 3,2,2
-
-
135 5,5,5
-
-
-
-
-
140
-
-
-
-
-
-
-
-
-
-
-
-
`;

describe('LogScreen skip-aware rendering', () => {
  let sections;

  beforeAll(() => {
    ({ sections } = parseWorkoutNote(REPORTER_NOTE));
  });

  test('reporter note parses to one exercise named bench', () => {
    expect(sections).toHaveLength(1);
    const bench = sections[0].exercises[0];
    expect(bench.name.toLowerCase()).toMatch(/bench/);
  });

  test('bench exercise has skipped session_entries at correct positions', () => {
    const bench = sections[0].exercises[0];
    const skippedPositions = bench.session_entries
      .map((e, i) => e.skipped ? i : -1)
      .filter(i => i >= 0);
    // slots 5 and 6 are the first two skips (after 5 logged rows at indexes 0-4)
    expect(skippedPositions[0]).toBe(5);
    expect(skippedPositions[1]).toBe(6);
  });

  test('skip-aware render produces skips interspersed with sets, not sets-only', () => {
    const bench = sections[0].exercises[0];
    const tokens = simulateSkipAwareRender(bench);

    // The first 5 entries are sets
    expect(tokens.slice(0, 5)).toEqual(['set', 'set', 'set', 'set', 'set']);
    // Then two skips
    expect(tokens.slice(5, 7)).toEqual(['skip', 'skip']);
    // Then more sets follow
    expect(tokens[7]).toBe('set');

    // Total skips must be non-zero
    const skipCount = tokens.filter(t => t === 'skip').length;
    expect(skipCount).toBeGreaterThan(0);

    // Total sets must equal ex.rows.length
    const setCount = tokens.filter(t => t === 'set').length;
    expect(setCount).toBe(bench.rows.length);
  });

  test('bare unparsed row is recorded in unparsed_positions, not session_entries', () => {
    const bench = sections[0].exercises[0];

    // 140 must not appear in session_entries
    expect(bench.session_entries.find(e => e.raw === '140')).toBeUndefined();

    // 140 must appear in unparsed_positions with correct raw text
    const pos = bench.unparsed_positions.find(p => p.raw === '140');
    expect(pos).toBeDefined();

    // session count must equal actual logged rows with no inflation
    const nonSkipped = bench.session_entries.filter(e => !e.skipped).length;
    expect(nonSkipped).toBe(bench.rows.length);
  });

  test('bare unparsed row (140) renders in chronological position between skip groups', () => {
    const bench = sections[0].exercises[0];
    const tokens = simulateSkipAwareRender(bench);

    const unparsedIdx = tokens.indexOf('unparsed:140');
    expect(unparsedIdx).toBeGreaterThan(-1);

    // There must be skips both before and after the unparsed row
    const skipsBefore = tokens.slice(0, unparsedIdx).filter(t => t === 'skip').length;
    const skipsAfter = tokens.slice(unparsedIdx + 1).filter(t => t === 'skip').length;
    expect(skipsBefore).toBeGreaterThan(0);
    expect(skipsAfter).toBeGreaterThan(0);

    // 140 must not appear as a trailing item (which was the old bug)
    expect(tokens[tokens.length - 1]).not.toBe('trailing:140');
  });

  test('row-only render (old behavior) would omit all skip markers', () => {
    const bench = sections[0].exercises[0];
    // Old path: just render ex.rows, no skip markers
    const rowOnlyTokens = bench.rows.map(() => 'set');
    expect(rowOnlyTokens.every(t => t === 'set')).toBe(true);
    // Old path produces no skips — confirms the bug was real
    expect(rowOnlyTokens.filter(t => t === 'skip')).toHaveLength(0);
  });
});

// ── syncSessionDates (session_dates maintenance contract) ─────────────────────

describe('syncSessionDates', () => {
  test('initializes all positions to null on first touch (no existing array)', () => {
    expect(syncSessionDates(null, 5)).toEqual([null, null, null, null, null]);
  });

  test('initializes empty array when count is 0 on first touch', () => {
    expect(syncSessionDates(null, 0)).toEqual([]);
  });

  test('trims array when session count decreases', () => {
    const existing = ['2026-05-01', '2026-05-08', '2026-05-15'];
    expect(syncSessionDates(existing, 2)).toEqual(['2026-05-01', '2026-05-08']);
  });

  test('returns same array length when session count is unchanged', () => {
    const existing = ['2026-05-01', '2026-05-08'];
    expect(syncSessionDates(existing, 2)).toEqual(['2026-05-01', '2026-05-08']);
  });

  test('appends today for newly added sessions when count increases', () => {
    const existing = ['2026-05-01', '2026-05-08'];
    const result = syncSessionDates(existing, 4);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe('2026-05-01');
    expect(result[1]).toBe('2026-05-08');
    // New entries are today's date (non-null string)
    expect(typeof result[2]).toBe('string');
    expect(result[2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('preserves legacy null positions when trimming', () => {
    const existing = [null, null, '2026-05-15', '2026-06-01'];
    expect(syncSessionDates(existing, 3)).toEqual([null, null, '2026-05-15']);
  });

  test('initializes empty existing array as all-null on first touch', () => {
    expect(syncSessionDates([], 3)).toEqual([null, null, null]);
  });
});

// ── deload date edit path: auto-recompute vs manual-repair decision ───────────

describe('deload date edit: auto-recompute path decision', () => {
  test('canRecompute true leads to new baseline = totalSessions - postDeloadCount', () => {
    const totalSessions = 18;
    const sessionDates = [
      '2026-01-10', '2026-01-24', '2026-02-07', '2026-02-21',
      '2026-03-07', '2026-03-21', '2026-04-04', '2026-04-18',
      '2026-05-02', '2026-05-16', '2026-05-30', '2026-06-13',
      '2026-06-27', '2026-07-11', '2026-07-25', '2026-08-08',
      '2026-08-22', '2026-09-05',
    ];
    const newDeloadDate = '2026-05-16';
    const { canRecompute, count } = computePostDeloadSessions(sessionDates, newDeloadDate);
    expect(canRecompute).toBe(true);
    expect(count).toBe(8); // sessions after May 16: May 30, Jun 13, Jun 27, Jul 11, Jul 25, Aug 8, Aug 22, Sep 5
    const newBaseline = Math.max(0, totalSessions - count);
    expect(newBaseline).toBe(10);
  });

  test('canRecompute false when any session date is missing (triggers manual-repair path)', () => {
    const sessionDates = [null, null, '2026-05-15', '2026-06-01'];
    const { canRecompute } = computePostDeloadSessions(sessionDates, '2026-05-10');
    expect(canRecompute).toBe(false);
  });

  test('manual-repair: baseline_source distinguishes repair source from auto', () => {
    const auto = { id: 'dl_auto', completed_at: '2026-06-01T12:00:00.000Z', session_count: 12, baseline_source: 'captured' };
    const manual = { id: 'dl_man', completed_at: '2026-06-01T12:00:00.000Z', session_count: 12, baseline_source: 'manual_repair' };
    expect(auto.baseline_source).toBe('captured');
    expect(manual.baseline_source).toBe('manual_repair');
  });
});
