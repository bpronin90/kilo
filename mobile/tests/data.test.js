import { describe, it, expect } from 'vitest';
import { computeWeightRollingAverageSeries } from '../lib/data';

describe('computeWeightRollingAverageSeries', () => {
  it('returns empty array for no entries', () => {
    expect(computeWeightRollingAverageSeries([])).toEqual([]);
  });

  it('computes rolling averages for a series of entries', () => {
    const entries = [
      { date: '2026-05-19', weight_value: 180 },
      { date: '2026-05-18', weight_value: 182 },
      { date: '2026-05-17', weight_value: 181 },
      { date: '2026-05-16', weight_value: 183 },
      { date: '2026-05-15', weight_value: 180 },
      { date: '2026-05-14', weight_value: 182 },
      { date: '2026-05-13', weight_value: 181 },
      { date: '2026-05-12', weight_value: 185 },
    ];
    // sorted by date: 12, 13, 14, 15, 16, 17, 18, 19
    // 18th 7-day avg: (182+181+183+180+182+181+185)/7 = 1264/7 = 180.57...
    // 19th 7-day avg: (180+182+181+183+180+182+181)/7 = 1269/7 = 181.28...
    
    const result = computeWeightRollingAverageSeries(entries, 3);
    expect(result.length).toBe(3);
    expect(result[result.length - 1].value).toBeCloseTo(181.3, 1);
    expect(result[result.length - 2].value).toBe(182);
    expect(result[result.length - 3].value).toBe(182);
    expect(result[result.length - 1].label).toBe('05/19');
  });

  it('filters out null averages', () => {
     const entries = [
      { date: '2026-05-19', weight_value: 180 },
    ];
    const result = computeWeightRollingAverageSeries(entries, 7);
    // For 2026-05-19, computeWeightTrends will have only one entry in the 7-day window.
    // avg7 will be 180.
    expect(result.length).toBe(1);
    expect(result[0].value).toBe(180);
  });
});
