import { classifyWeightPace, formatPaceElapsed, getWeightDeltaSeverity, formatDelta, formatDate } from '../lib/format';

// ── formatDate ────────────────────────────────────────────────────────────────

describe('formatDate', () => {
  test('formats ISO date string as MM-DD-YYYY', () => {
    expect(formatDate('2024-05-21')).toBe('05-21-2024');
  });

  test('formats ISO datetime string using only the date portion', () => {
    expect(formatDate('2024-01-09T10:30:00Z')).toBe('01-09-2024');
  });

  test('returns empty string for null', () => {
    expect(formatDate(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(formatDate(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(formatDate('')).toBe('');
  });

  test('handles single-digit month and day with zero-padding preserved', () => {
    expect(formatDate('2024-03-07')).toBe('03-07-2024');
  });
});

// ── classifyWeightPace ────────────────────────────────────────────────────────

describe('classifyWeightPace', () => {
  test('returns null for null or undefined delta', () => {
    expect(classifyWeightPace(null)).toBeNull();
    expect(classifyWeightPace(undefined)).toBeNull();
  });

  test('returns null for delta below 1.5 lb (e.g. 0.2)', () => {
    expect(classifyWeightPace(0.2)).toBeNull();
    expect(classifyWeightPace(-0.2)).toBeNull();
  });

  test('returns null for delta of exactly 0', () => {
    expect(classifyWeightPace(0)).toBeNull();
  });

  test('returns null for delta just under threshold (1.4)', () => {
    expect(classifyWeightPace(1.4)).toBeNull();
    expect(classifyWeightPace(-1.4)).toBeNull();
  });

  test('returns notable gain for 1.6 lb increase', () => {
    expect(classifyWeightPace(1.6)).toEqual({ direction: 'gain', level: 'notable', elapsedDays: null });
  });

  test('returns notable loss for 1.6 lb decrease', () => {
    expect(classifyWeightPace(-1.6)).toEqual({ direction: 'loss', level: 'notable', elapsedDays: null });
  });

  test('returns notable for delta between 1.5 and 2.3 (e.g. 2.2)', () => {
    expect(classifyWeightPace(2.2)).toEqual({ direction: 'gain', level: 'notable', elapsedDays: null });
    expect(classifyWeightPace(-2.2)).toEqual({ direction: 'loss', level: 'notable', elapsedDays: null });
  });

  test('returns spike gain for 2.4 lb increase', () => {
    expect(classifyWeightPace(2.4)).toEqual({ direction: 'gain', level: 'spike', elapsedDays: null });
  });

  test('returns spike loss for 2.4 lb decrease', () => {
    expect(classifyWeightPace(-2.4)).toEqual({ direction: 'loss', level: 'spike', elapsedDays: null });
  });

  test('returns spike for large deltas (e.g. 5 lb)', () => {
    expect(classifyWeightPace(5)).toEqual({ direction: 'gain', level: 'spike', elapsedDays: null });
    expect(classifyWeightPace(-5)).toEqual({ direction: 'loss', level: 'spike', elapsedDays: null });
  });

  // boundary at exactly 1.5
  test('returns notable for delta exactly at 1.5 lb boundary', () => {
    expect(classifyWeightPace(1.5)).toEqual({ direction: 'gain', level: 'notable', elapsedDays: null });
    expect(classifyWeightPace(-1.5)).toEqual({ direction: 'loss', level: 'notable', elapsedDays: null });
  });

  // boundary at exactly 2.3
  test('returns spike for delta exactly at 2.3 lb boundary', () => {
    expect(classifyWeightPace(2.3)).toEqual({ direction: 'gain', level: 'spike', elapsedDays: null });
    expect(classifyWeightPace(-2.3)).toEqual({ direction: 'loss', level: 'spike', elapsedDays: null });
  });

  // ── elapsed calendar-day awareness (#941) ─────────────────────────────────

  test('normal thresholds hold through 3 elapsed days', () => {
    expect(classifyWeightPace(2.5, 1)).toEqual({ direction: 'gain', level: 'spike', elapsedDays: 1 });
    expect(classifyWeightPace(2.5, 3)).toEqual({ direction: 'gain', level: 'spike', elapsedDays: 3 });
    expect(classifyWeightPace(1.8, 3)).toEqual({ direction: 'gain', level: 'notable', elapsedDays: 3 });
  });

  test('spike downgrades to notable after 3 elapsed days (through day 7)', () => {
    expect(classifyWeightPace(3.0, 4)).toEqual({ direction: 'gain', level: 'notable', elapsedDays: 4 });
    expect(classifyWeightPace(-3.0, 7)).toEqual({ direction: 'loss', level: 'notable', elapsedDays: 7 });
  });

  test('notable stays notable after 3 elapsed days', () => {
    expect(classifyWeightPace(1.8, 6)).toEqual({ direction: 'gain', level: 'notable', elapsedDays: 6 });
  });

  test('returns no pace flag after 7 elapsed days regardless of magnitude', () => {
    expect(classifyWeightPace(8.0, 8)).toBeNull();
    expect(classifyWeightPace(-8.0, 30)).toBeNull();
    expect(classifyWeightPace(1.6, 8)).toBeNull();
  });
});

// ── formatPaceElapsed ────────────────────────────────────────────────────────

describe('formatPaceElapsed', () => {
  test('reads as day-over-day for null, 0, or 1 day', () => {
    expect(formatPaceElapsed(null)).toBe('day-over-day');
    expect(formatPaceElapsed(0)).toBe('day-over-day');
    expect(formatPaceElapsed(1)).toBe('day-over-day');
  });

  test('names the span for multi-day gaps', () => {
    expect(formatPaceElapsed(2)).toBe('over 2 days');
    expect(formatPaceElapsed(5)).toBe('over 5 days');
  });
});

// ── getWeightDeltaSeverity ────────────────────────────────────────────────────

describe('getWeightDeltaSeverity', () => {
  test('returns normal for null or undefined', () => {
    expect(getWeightDeltaSeverity(null)).toBe('normal');
    expect(getWeightDeltaSeverity(undefined)).toBe('normal');
  });

  test('returns normal for 0', () => {
    expect(getWeightDeltaSeverity(0)).toBe('normal');
  });

  test('returns notable for delta exactly at 1.5 lb boundary', () => {
    expect(getWeightDeltaSeverity(1.5)).toBe('notable');
    expect(getWeightDeltaSeverity(-1.5)).toBe('notable');
  });

  test('returns notable for delta slightly above 1.5', () => {
    expect(getWeightDeltaSeverity(1.6)).toBe('notable');
    expect(getWeightDeltaSeverity(-1.6)).toBe('notable');
  });

  test('returns spike for delta exactly at 2.3 lb boundary', () => {
    expect(getWeightDeltaSeverity(2.3)).toBe('spike');
    expect(getWeightDeltaSeverity(-2.3)).toBe('spike');
  });

  test('returns spike for delta slightly above 2.3', () => {
    expect(getWeightDeltaSeverity(2.4)).toBe('spike');
    expect(getWeightDeltaSeverity(-2.4)).toBe('spike');
  });

  test('returns outlier for delta above 3.5', () => {
    expect(getWeightDeltaSeverity(4)).toBe('outlier');
    expect(getWeightDeltaSeverity(-4)).toBe('outlier');
  });
});

// ── formatDelta ───────────────────────────────────────────────────────────────

describe('formatDelta', () => {
  test('returns empty string for null or undefined', () => {
    expect(formatDelta(null)).toBe('');
    expect(formatDelta(undefined)).toBe('');
  });

  test('formats positive delta with + sign', () => {
    expect(formatDelta(1.5)).toBe('+1.5');
  });

  test('formats negative delta without extra sign', () => {
    expect(formatDelta(-1.5)).toBe('-1.5');
  });
});
