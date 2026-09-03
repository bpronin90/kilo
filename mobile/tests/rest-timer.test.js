import {
  startTimerRecord,
  normalizeRestTimerRecord,
  remainingMs,
  isElapsed,
  elapsedRecently,
  generateTimerId,
} from '../lib/restTimer';

describe('startTimerRecord', () => {
  test('computes endsAtMs once from startedAtMs + durationSec', () => {
    const record = startTimerRecord({ durationSec: 90, nowMs: 1000 });
    expect(record.startedAtMs).toBe(1000);
    expect(record.endsAtMs).toBe(1000 + 90000);
    expect(record.durationSec).toBe(90);
    expect(typeof record.timerId).toBe('string');
    expect(record.timerId.length).toBeGreaterThan(0);
  });

  test('two starts get distinct timerIds', () => {
    const a = generateTimerId();
    const b = generateTimerId();
    expect(a).not.toBe(b);
  });
});

describe('normalizeRestTimerRecord', () => {
  const nowMs = 1_700_000_000_000;

  test('null/malformed input returns null', () => {
    expect(normalizeRestTimerRecord(null)).toBeNull();
    expect(normalizeRestTimerRecord({})).toBeNull();
    expect(normalizeRestTimerRecord({ version: 1, timerId: 'x' })).toBeNull();
  });

  test('wrong version rejects', () => {
    const record = { version: 2, timerId: 'x', startedAtMs: nowMs, durationSec: 60, endsAtMs: nowMs + 60000 };
    expect(normalizeRestTimerRecord(record, nowMs)).toBeNull();
  });

  test('endsAtMs not matching startedAtMs+durationSec rejects', () => {
    const record = { version: 1, timerId: 'x', startedAtMs: nowMs, durationSec: 60, endsAtMs: nowMs + 1000 };
    expect(normalizeRestTimerRecord(record, nowMs)).toBeNull();
  });

  test('a record whose endsAtMs is implausibly far in the past is rejected', () => {
    const record = { version: 1, timerId: 'x', startedAtMs: nowMs - 1000, durationSec: 1, endsAtMs: nowMs - 1000 + 1000 };
    // shift far into the past relative to nowMs passed in
    expect(normalizeRestTimerRecord(record, nowMs + 1000 * 60 * 60 * 48)).toBeNull();
  });

  test('a valid record round-trips', () => {
    const record = { version: 1, timerId: 'x', startedAtMs: nowMs, durationSec: 60, endsAtMs: nowMs + 60000, exerciseLabel: 'Bench', notificationId: 'n1' };
    expect(normalizeRestTimerRecord(record, nowMs)).toEqual(record);
  });

  test('missing exerciseLabel/notificationId normalize to null rather than throwing', () => {
    const record = { version: 1, timerId: 'x', startedAtMs: nowMs, durationSec: 60, endsAtMs: nowMs + 60000 };
    const normalized = normalizeRestTimerRecord(record, nowMs);
    expect(normalized.exerciseLabel).toBeNull();
    expect(normalized.notificationId).toBeNull();
  });
});

describe('remainingMs / isElapsed', () => {
  test('clamps at zero and never goes negative', () => {
    const record = startTimerRecord({ durationSec: 10, nowMs: 0 });
    expect(remainingMs(record, 5000)).toBe(5000);
    expect(remainingMs(record, 10000)).toBe(0);
    expect(remainingMs(record, 999999)).toBe(0); // far past — still clamped, never negative
    expect(isElapsed(record, 10000)).toBe(true);
    expect(isElapsed(record, 9999)).toBe(false);
  });

  test('a forward clock jump expires the timer immediately', () => {
    const record = startTimerRecord({ durationSec: 60, nowMs: 0 }); // endsAtMs = 60000
    expect(isElapsed(record, 30000)).toBe(false); // before the jump, still running
    expect(isElapsed(record, 5_000_000)).toBe(true); // device clock jumps far forward
  });

  test('a backward clock jump extends the displayed deadline (remaining recomputed from wall clock)', () => {
    const record = startTimerRecord({ durationSec: 60, nowMs: 100000 });
    // Device clock jumps backward to 50000 — remaining recomputes larger, never desyncs.
    expect(remainingMs(record, 50000)).toBe(record.endsAtMs - 50000);
    expect(remainingMs(record, 50000)).toBeGreaterThan(60000);
  });
});

describe('elapsedRecently', () => {
  test('true just after elapsing, false long after', () => {
    const record = startTimerRecord({ durationSec: 10, nowMs: 0 }); // endsAtMs = 10000
    expect(elapsedRecently(record, 10500)).toBe(true);
    expect(elapsedRecently(record, 10000 + 1000 * 60 * 10)).toBe(false); // 10 min later
  });

  test('false before it has elapsed at all', () => {
    const record = startTimerRecord({ durationSec: 10, nowMs: 0 });
    expect(elapsedRecently(record, 5000)).toBe(false);
  });
});
