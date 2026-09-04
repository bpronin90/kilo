import {
  computePlateLoad,
  formatPlateWeight,
  BAR_WEIGHT_LB,
  PLATE_SIZES_LB,
  BAR_WEIGHT_KG,
  DEFAULT_PLATES_LB,
  DEFAULT_PLATES_KG,
  MAX_COUNT_PER_SIZE,
  normalizePlateCalculatorProfile,
  defaultPlateCalculatorProfile,
} from '../lib/plateMath';

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

  test('220 loads exactly with the minimal plate count (#950 review: bounded optimizer, not greedy)', () => {
    // perSideTarget = 87.5. The old greedy-descending algorithm happened to
    // land on 45+25+10+5+2.5 (5 plates); the bounded-search optimizer finds
    // a DIFFERENT 5-plate exact combination (25×3+10+2.5) — both are valid,
    // exact, minimal-count loadings for an unlimited inventory. What matters
    // is optimality (remainder 0, no plate-count regression), not which of
    // several equally-optimal combinations is chosen.
    const load = computePlateLoad(220);
    expect(load.remainder).toBe(0);
    const totalPlates = load.plates.reduce((n, p) => n + p.count, 0);
    expect(totalPlates).toBe(5);
    const loaded = load.plates.reduce((sum, p) => sum + p.size * p.count, 0);
    expect(loaded).toBe(87.5);
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

  // ── #577: object call shape + finite kg inventory ──────────────────────
  test('object call shape with kg default profile: 100 kg → 20+20+2.5(remainder omitted since exact) per side', () => {
    const load = computePlateLoad({ totalWeight: 100, barWeight: BAR_WEIGHT_KG, platesPerSide: DEFAULT_PLATES_KG });
    expect(load.valid).toBe(true);
    expect(load.barWeight).toBe(20);
    // (100-20)/2 = 40 → 20+20 per side, exact
    expect(load.plates).toEqual([{ size: 20, count: 2 }]);
    expect(load.remainder).toBe(0);
  });

  test('finite inventory exhaustion reports an honest remainder instead of assuming more plates exist', () => {
    const load = computePlateLoad({
      totalWeight: 300,
      barWeight: 45,
      platesPerSide: [{ size: 45, count: 1 }], // only one 45 per side available
    });
    expect(load.valid).toBe(true);
    // perSideTarget = (300-45)/2 = 127.5; only one 45 available per side
    expect(load.plates).toEqual([{ size: 45, count: 1 }]);
    expect(load.remainder).toBe(82.5);
  });

  test('duplicate sizes in platesPerSide are merged by summing counts', () => {
    const load = computePlateLoad({
      totalWeight: 135,
      barWeight: 45,
      platesPerSide: [{ size: 45, count: 1 }, { size: 45, count: 1 }],
    });
    // merged to count 2, but perSideTarget=45 only needs one 45
    expect(load.plates).toEqual([{ size: 45, count: 1 }]);
    expect(load.remainder).toBe(0);
  });

  test('invalid platesPerSide (non-array, malformed entry, oversized) is rejected as invalid', () => {
    expect(computePlateLoad({ totalWeight: 135, barWeight: 45, platesPerSide: 'nope' }).valid).toBe(false);
    expect(computePlateLoad({ totalWeight: 135, barWeight: 45, platesPerSide: [{ size: -5, count: 1 }] }).valid).toBe(false);
    expect(computePlateLoad({ totalWeight: 135, barWeight: 45, platesPerSide: [{ size: 45, count: -1 }] }).valid).toBe(false);
    expect(computePlateLoad({ totalWeight: 135, barWeight: 45, platesPerSide: [{ size: 1.126, count: 1 }] }).valid).toBe(false);
  });

  test('adversarial/over-limit inputs (huge weight, huge count) are rejected rather than hanging', () => {
    expect(computePlateLoad({ totalWeight: 1e12, barWeight: 45, platesPerSide: DEFAULT_PLATES_LB }).valid).toBe(false);
    expect(computePlateLoad({
      totalWeight: 500,
      barWeight: 45,
      platesPerSide: [{ size: 45, count: 1e9 }],
    }).valid).toBe(false);
    expect(computePlateLoad({
      totalWeight: 500,
      barWeight: 45,
      platesPerSide: Array.from({ length: 20 }, (_, i) => ({ size: i + 1, count: 1 })),
    }).valid).toBe(false); // exceeds MAX_DISTINCT_SIZES
  });

  test('legacy positional call (no platesPerSide) still loads exactly with unlimited inventory', () => {
    // Same optimizer, same result as the object-shape call above — the
    // legacy call path is not a different code path, only a different
    // argument shape (see the "220 loads exactly" test for why an exact
    // plate-array match isn't asserted here).
    const load = computePlateLoad(220, 45);
    expect(load.remainder).toBe(0);
    const loaded = load.plates.reduce((sum, p) => sum + p.size * p.count, 0);
    expect(loaded).toBe(87.5);
  });

  // ── #950 review (P2): bounded optimizer over a finite inventory ────────
  test('145 lb / 45 lb bar / {45:1, 25:2} per side has an exact two-25 loading (the exact review-reported case)', () => {
    const load = computePlateLoad({
      totalWeight: 145,
      barWeight: 45,
      platesPerSide: [{ size: 45, count: 1 }, { size: 25, count: 2 }],
    });
    // perSideTarget = 50. Greedy picks the 45 first (leaving 5 unloadable);
    // the optimizer must find the exact 25+25 = 50 loading instead.
    expect(load.valid).toBe(true);
    expect(load.plates).toEqual([{ size: 25, count: 2 }]);
    expect(load.remainder).toBe(0);
  });

  test('a finite inventory with no exact loading still minimizes the remainder (not just greedy-first-fit)', () => {
    // perSideTarget = 52. {45:1} alone leaves 7. {25:2}=50 leaves 2 — a
    // smaller remainder than greedy's 45-first pick, even though neither is
    // exact.
    const load = computePlateLoad({
      totalWeight: 149,
      barWeight: 45,
      platesPerSide: [{ size: 45, count: 1 }, { size: 25, count: 2 }],
    });
    expect(load.remainder).toBe(2);
    expect(load.plates).toEqual([{ size: 25, count: 2 }]);
  });

  test('a target far beyond the bounded search cap degrades to greedy rather than hanging', () => {
    // Documented fallback: an implausibly large per-side target (well past
    // any real loading, but still under MAX_WEIGHT) skips the DP search and
    // falls back to greedy selection so runtime stays bounded regardless of
    // input. perSideTarget = 4977.5 units here, well past
    // REMAINDER_SEARCH_CAP_MINOR (2,000 units).
    const load = computePlateLoad({
      totalWeight: 10000,
      barWeight: 45,
      platesPerSide: [{ size: 45, count: 50 }],
    });
    expect(load.valid).toBe(true);
    expect(load.plates).toEqual([{ size: 45, count: 50 }]); // greedy still uses everything available
    expect(load.remainder).toBeCloseTo(2727.5, 6);
  });
});

describe('normalizePlateCalculatorProfile', () => {
  test('null/missing record falls back to the full default (both units)', () => {
    expect(normalizePlateCalculatorProfile(null)).toEqual(defaultPlateCalculatorProfile());
  });

  test('a malformed kg profile falls back to kg defaults without discarding a valid lb profile', () => {
    const raw = {
      version: 1,
      activeUnit: 'lb',
      profiles: {
        lb: { barWeight: 50, platesPerSide: [{ size: 45, count: 6 }] },
        kg: { barWeight: -5, platesPerSide: 'garbage' },
      },
    };
    const normalized = normalizePlateCalculatorProfile(raw);
    expect(normalized.profiles.lb).toEqual({ barWeight: 50, platesPerSide: [{ size: 45, count: 6 }] });
    expect(normalized.profiles.kg).toEqual(defaultPlateCalculatorProfile().profiles.kg);
  });

  test('activeUnit normalizes to lb unless exactly kg', () => {
    expect(normalizePlateCalculatorProfile({ activeUnit: 'kg' }).activeUnit).toBe('kg');
    expect(normalizePlateCalculatorProfile({ activeUnit: 'bogus' }).activeUnit).toBe('lb');
  });

  test('defaults give finite per-side counts, never unlimited', () => {
    const defaults = defaultPlateCalculatorProfile();
    for (const p of defaults.profiles.lb.platesPerSide) {
      expect(p.count).toBeGreaterThan(0);
      expect(p.count).toBeLessThanOrEqual(MAX_COUNT_PER_SIZE);
    }
    for (const p of defaults.profiles.kg.platesPerSide) {
      expect(p.count).toBeGreaterThan(0);
      expect(p.count).toBeLessThanOrEqual(MAX_COUNT_PER_SIZE);
    }
  });
});

describe('formatPlateWeight', () => {
  test('drops trailing .0 on whole numbers', () => {
    expect(formatPlateWeight(45)).toBe('45');
    expect(formatPlateWeight(45.0)).toBe('45');
  });

  test('keeps one decimal for fractional plates', () => {
    expect(formatPlateWeight(2.5)).toBe('2.5');
  });

  // #950 review (P2): a 1.25 kg plate must read as "1.25", not round to
  // "1.3" and misidentify the denomination.
  test('preserves two decimals for a standard 1.25 kg plate instead of rounding to one', () => {
    expect(formatPlateWeight(1.25)).toBe('1.25');
  });

  test('drops a genuinely trailing zero at two decimals (e.g. 1.20 → 1.2)', () => {
    expect(formatPlateWeight(1.2)).toBe('1.2');
  });

  test('returns empty string for non-numeric input', () => {
    expect(formatPlateWeight(null)).toBe('');
    expect(formatPlateWeight(NaN)).toBe('');
  });
});
