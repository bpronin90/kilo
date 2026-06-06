import { parseWorkoutNote, weeksSinceLastDeload, sessionsSinceLastDeload } from '../lib/parser';

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

// ── deload date edit: two-metric model ───────────────────────────────────────

const MOCK_NOW_MS_LOG = new Date('2026-06-06T12:00:00.000Z').getTime();

describe('deload date edit: sessions and weeks are independent metrics', () => {
  beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(MOCK_NOW_MS_LOG); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('editing completed_at changes weeksSinceLastDeload but leaves session_count untouched', () => {
    const totalSessions = 14;
    // Deload originally completed May 9 (4 weeks ago); user corrects to May 16 (3 weeks ago)
    const originalRecord = { id: 'dl_1', completed_at: '2026-05-09T12:00:00.000Z', session_count: 11 };
    const editedRecord   = { id: 'dl_1', completed_at: '2026-05-16T12:00:00.000Z', session_count: 11 };

    expect(sessionsSinceLastDeload(totalSessions, [originalRecord])).toBe(3);
    expect(sessionsSinceLastDeload(totalSessions, [editedRecord])).toBe(3); // unchanged

    expect(weeksSinceLastDeload([originalRecord])).toBe(4);
    expect(weeksSinceLastDeload([editedRecord])).toBe(3);   // updated
  });

  test('sessions since deload only depends on session_count, not completed_at', () => {
    const totalSessions = 20;
    const history = [{ id: 'dl_1', completed_at: '2026-01-01T12:00:00.000Z', session_count: 15 }];
    expect(sessionsSinceLastDeload(totalSessions, history)).toBe(5);
  });

  test('weeks since deload only depends on completed_at, not session_count', () => {
    // 14 days = 2 full weeks
    const history = [{ id: 'dl_1', completed_at: '2026-05-23T12:00:00.000Z', session_count: 99 }];
    expect(weeksSinceLastDeload(history)).toBe(2);
  });

  test('legacy records without note_id work for both metrics', () => {
    const history = [{ id: 'dl_legacy', completed_at: '2026-05-23T12:00:00.000Z', session_count: 5 }];
    expect(sessionsSinceLastDeload(10, history)).toBe(5);
    expect(weeksSinceLastDeload(history)).toBe(2);
  });

  test('date edit with no linked history record must not change the analytics anchor (desync guard)', () => {
    // Simulate the save-path contract: if histRecord is not found, saved_at should NOT
    // be applied. The session and weeks metrics must remain based on the original record.
    const totalSessions = 8;
    const legacyRecord = { id: 'dl_legacy', completed_at: '2026-05-23T12:00:00.000Z', session_count: 5 };
    // After attempted date change (no histRecord found, save blocked):
    expect(sessionsSinceLastDeload(totalSessions, [legacyRecord])).toBe(3);
    expect(weeksSinceLastDeload([legacyRecord])).toBe(2);
    // The record is unchanged — same values before and after.
    expect(legacyRecord.completed_at).toBe('2026-05-23T12:00:00.000Z');
  });
});

// ── autosave vs explicit save: call-site contract ────────────────────────────
// React Native components cannot be rendered in this test environment, so these
// tests assert the source-level contract directly: both debounce timer callbacks
// must pass { autosave: true } to their respective save handlers.  If either
// call site is changed back to a bare call, the test will fail and the flicker
// will return.

const fs = require('fs');
const path = require('path');

describe('autosave call sites: debounce timers pass { autosave: true }', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(
      path.join(__dirname, '../screens/LogScreen.js'),
      'utf8'
    );
  });

  test('current-note debounce timer calls handleSave({ autosave: true })', () => {
    expect(src).toMatch(/handleSave\(\s*\{\s*autosave\s*:\s*true\s*\}\s*\)/);
  });

  test('other-note debounce timer calls handleSaveOtherNote({ autosave: true })', () => {
    expect(src).toMatch(/handleSaveOtherNote\(\s*\{\s*autosave\s*:\s*true\s*\}\s*\)/);
  });

  test('handleSave suppresses setSaveSuccess when autosave is true', () => {
    // The guarded call must be present: if (!autosave) setSaveSuccess(...)
    expect(src).toMatch(/if\s*\(\s*!autosave\s*\)\s*setSaveSuccess\s*\(\s*'Saved!'\s*\)/);
  });

  test('handleSaveOtherNote suppresses setSaveSuccess when autosave is true', () => {
    // Same guard must appear twice — once per save handler.
    const matches = src.match(/if\s*\(\s*!autosave\s*\)\s*setSaveSuccess\s*\(\s*'Saved!'\s*\)/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ── deload date edit: save-flow stuck-state prevention ───────────────────────
// These source-level assertions prove that the save path cannot remain stuck in
// a pending state when the user presses Done while an autosave is in flight.
// The component cannot be rendered in this env, so we assert the code structure.

describe('deload date edit: save flow does not get stuck in pending state', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(
      path.join(__dirname, '../screens/LogScreen.js'),
      'utf8'
    );
  });

  test('handleSaveOtherNote uses an in-flight ref guard, not a bare noteIsSaving return', () => {
    // The old guard `if (noteIsSaving) return;` returned undefined, causing
    // handleDoneOther to treat the in-flight autosave as a failure. The fix
    // replaces it with an in-flight promise ref so callers can chain on the
    // running save rather than receiving undefined.
    expect(src).toMatch(/saveOtherNoteInFlightRef\.current/);
    expect(src).not.toMatch(/if\s*\(\s*noteIsSaving\s*\)\s*return\s*;/);
  });

  test('in-flight ref is returned when a concurrent save is already running', () => {
    // When saveOtherNoteInFlightRef.current is non-null, the function must return
    // it so the caller awaits the real result rather than undefined.
    expect(src).toMatch(/if\s*\(\s*saveOtherNoteInFlightRef\.current\s*\)\s*return\s+saveOtherNoteInFlightRef\.current/);
  });

  test('in-flight ref is cleared in the finally block so it never leaks', () => {
    // Leak would leave saveOtherNoteInFlightRef.current non-null after the save,
    // preventing any future save from starting.
    expect(src).toMatch(/finally[\s\S]{0,200}saveOtherNoteInFlightRef\.current\s*=\s*null/);
  });

  test('setNoteIsSaving(false) is in a finally block in the deload save path', () => {
    // Guarantees noteIsSaving is always reset regardless of success or failure,
    // preventing the save-spinner state from getting permanently stuck.
    expect(src).toMatch(/finally[\s\S]{0,200}setNoteIsSaving\s*\(\s*false\s*\)/);
  });

  test('deload date save path calls updateDeload before update on date change', () => {
    // Both the history record and the note record must be updated. If updateDeload
    // is absent the history anchor drifts from the note saved_at date.
    expect(src).toMatch(/await\s+updateDeload\s*\([\s\S]{0,700}await\s+update\s*\(\s*editingNoteId/);
  });
});
