import { computePlateLoad, formatPlateWeight, BAR_WEIGHT_LB, PLATE_SIZES_LB } from '../lib/plateMath';

describe('computePlateLoad', () => {
  test('225 loads 2×45 per side with no remainder', () => {
    const load = computePlateLoad(225);
    expect(load.valid).toBe(true);
    expect(load.belowBar).toBe(false);
    expect(load.perSideTarget).toBe(90);
    expect(load.plates).toEqual([{ size: 45, count: 2 }]);
    expect(load.remainder).toBe(0);
  });

  test('185 loads 45+25 per side', () => {
    const load = computePlateLoad(185);
    expect(load.plates).toEqual([
      { size: 45, count: 1 },
      { size: 25, count: 1 },
    ]);
    expect(load.remainder).toBe(0);
  });

  test('135 loads a single 45 per side', () => {
    expect(computePlateLoad(135).plates).toEqual([{ size: 45, count: 1 }]);
  });

  test('uses every plate size when needed (220 → 45+25+10+5+2.5 per side)', () => {
    const load = computePlateLoad(220);
    expect(load.plates).toEqual([
      { size: 45, count: 1 },
      { size: 25, count: 1 },
      { size: 10, count: 1 },
      { size: 5, count: 1 },
      { size: 2.5, count: 1 },
    ]);
    expect(load.remainder).toBe(0);
  });

  test('exact bar weight is an empty bar', () => {
    const load = computePlateLoad(45);
    expect(load.valid).toBe(true);
    expect(load.belowBar).toBe(false);
    expect(load.plates).toEqual([]);
    expect(load.remainder).toBe(0);
  });

  test('unloadable remainder is reported per side and never negative', () => {
    const load = computePlateLoad(227);
    expect(load.plates).toEqual([{ size: 45, count: 2 }]);
    expect(load.remainder).toBe(1);
  });

  test('sub-bar weight flags belowBar with no plates', () => {
    const load = computePlateLoad(40);
    expect(load.valid).toBe(true);
    expect(load.belowBar).toBe(true);
    expect(load.plates).toEqual([]);
    expect(load.remainder).toBe(0);
  });

  test('decimal weights avoid floating-point drift (192.5)', () => {
    const load = computePlateLoad(192.5);
    expect(load.perSideTarget).toBe(73.75);
    expect(load.plates).toEqual([
      { size: 45, count: 1 },
      { size: 25, count: 1 },
      { size: 2.5, count: 1 },
    ]);
    expect(load.remainder).toBe(1.25);
  });

  test('loadable decimal weight has zero remainder (100 → 25+2.5 per side)', () => {
    const load = computePlateLoad(100);
    expect(load.plates).toEqual([
      { size: 25, count: 1 },
      { size: 2.5, count: 1 },
    ]);
    expect(load.remainder).toBe(0);
  });

  test('custom bar weight is respected', () => {
    const load = computePlateLoad(95, 35);
    expect(load.barWeight).toBe(35);
    expect(load.plates).toEqual([
      { size: 25, count: 1 },
      { size: 5, count: 1 },
    ]);
  });

  test('invalid inputs are flagged without crashing', () => {
    for (const input of [null, undefined, NaN, Infinity, -135, 0, '135']) {
      const load = computePlateLoad(input);
      expect(load.valid).toBe(false);
      expect(load.plates).toEqual([]);
    }
  });

  test('exports the standard bar and plate constants', () => {
    expect(BAR_WEIGHT_LB).toBe(45);
    expect(PLATE_SIZES_LB).toEqual([45, 25, 10, 5, 2.5]);
  });
});

describe('formatPlateWeight', () => {
  test('drops trailing .0 on whole numbers', () => {
    expect(formatPlateWeight(45)).toBe('45');
    expect(formatPlateWeight(45.0)).toBe('45');
  });

  test('keeps one decimal for fractional plates', () => {
    expect(formatPlateWeight(2.5)).toBe('2.5');
    expect(formatPlateWeight(1.25)).toBe('1.3');
  });

  test('returns empty string for non-numeric input', () => {
    expect(formatPlateWeight(null)).toBe('');
    expect(formatPlateWeight(NaN)).toBe('');
  });
});
