import { computeWeightTrends } from '../lib/data';

// ── computeWeightTrends — paceFlag ────────────────────────────────────────────
// entries are sorted newest-first by caller convention, but computeWeightTrends
// tolerates any order because it sorts by date internally.

describe('computeWeightTrends — paceFlag', () => {
  test('returns null paceFlag with fewer than 2 entries', () => {
    const { paceFlag } = computeWeightTrends([{ date: '2026-05-20', weight_value: 185 }]);
    expect(paceFlag).toBeNull();
  });

  test('returns null paceFlag when delta is 0.2 lb (below 1.5 lb threshold)', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 185.2 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBeNull();
  });

  test('returns null paceFlag when delta is 1.4 lb (just below threshold)', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 186.4 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBeNull();
  });

  test('returns gain for 1.6 lb increase (>= 1.5 lb threshold)', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 186.6 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('gain');
  });

  test('returns loss for 1.6 lb decrease (>= 1.5 lb threshold)', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 183.4 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('loss');
  });

  test('returns gain for 2.4 lb increase (>= 2.3 lb threshold)', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 187.4 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('gain');
  });

  test('returns loss for 2.4 lb decrease (>= 2.3 lb threshold)', () => {
    const entries = [
      { date: '2026-05-20', weight_value: 182.6 },
      { date: '2026-05-19', weight_value: 185.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('loss');
  });

  test('paceFlag based on two most recent by date, ignoring older history', () => {
    // Entries 3 and 4 show large historic change; two most recent are stable
    const entries = [
      { date: '2026-05-20', weight_value: 185.1 },
      { date: '2026-05-19', weight_value: 185.0 },
      { date: '2026-05-10', weight_value: 175.0 },
      { date: '2026-05-01', weight_value: 170.0 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBeNull();
  });

  test('handles entries supplied oldest-first (backdated-entry order)', () => {
    const entries = [
      { date: '2026-05-19', weight_value: 185.0 },
      { date: '2026-05-20', weight_value: 186.8 },
    ];
    expect(computeWeightTrends(entries).paceFlag).toBe('gain');
  });
});
