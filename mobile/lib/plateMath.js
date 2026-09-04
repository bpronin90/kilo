// Plate-loading math for a barbell, lb or kg (#577). Storage and analytics
// remain untouched — this is pure display math over a canonical-lb input
// (kg is a presentation/equipment choice made at the call site, see
// PlateCalculatorModal.js) plus an explicit bar weight and finite per-side
// plate inventory.

export const BAR_WEIGHT_LB = 45;
export const PLATE_SIZES_LB = [45, 25, 10, 5, 2.5];
export const BAR_WEIGHT_KG = 20;
export const PLATE_SIZES_KG = [20, 15, 10, 5, 2.5, 1.25];

// Default finite per-side inventory (#577 review: an optimizer over an
// "infinite" plate set is not a real gym — and an unbounded stored count is
// both a false-precision and a runtime-bound risk). Counts are per side.
export const DEFAULT_PLATES_LB = [
  { size: 45, count: 4 },
  { size: 25, count: 4 },
  { size: 10, count: 4 },
  { size: 5, count: 4 },
  { size: 2.5, count: 2 },
];
export const DEFAULT_PLATES_KG = [
  { size: 20, count: 4 },
  { size: 15, count: 2 },
  { size: 10, count: 4 },
  { size: 5, count: 4 },
  { size: 2.5, count: 4 },
  { size: 1.25, count: 2 },
];

// Hard bounds (#577 review finding: adversarial/overflow risk). These keep
// the optimizer's search space and the integer-hundredths math bounded
// regardless of what a corrupted stored profile or a pathological caller
// supplies.
export const MAX_WEIGHT = 20000; // lb or kg — far past any real total
export const MAX_PLATE_SIZE = 500; // lb or kg
export const MAX_COUNT_PER_SIZE = 50; // per side, per plate size
export const MAX_DISTINCT_SIZES = 12;
// Sizes must be exact to the nearest hundredth (matches the hundredths-of-a-
// unit integer math below); anything finer (e.g. 1.126) is rejected rather
// than silently rounded, since a silently-rounded plate size is a wrong plate.
const MINOR_UNIT_SCALE = 100;

function toMinorUnits(value) {
  return Math.round(value * MINOR_UNIT_SCALE);
}

function isExactMinorUnit(value) {
  return Math.abs(value * MINOR_UNIT_SCALE - Math.round(value * MINOR_UNIT_SCALE)) < 1e-6;
}

function isPositiveFiniteWithinBound(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;
}

// Validate + normalize a raw plates-per-side list for computePlateLoad
// itself. Unlike normalizePlatesProfile (plateCalculatorProfile.js), this is
// STRICT: any malformed entry rejects the whole list rather than silently
// dropping or rounding it, because by the time math runs the caller is
// expected to have already passed a normalized, persisted profile — a
// mismatch here means the caller has a bug, not stale user data to recover
// from.
function validatePlatesPerSide(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_DISTINCT_SIZES) return null;
  const bySize = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') return null;
    const { size, count } = entry;
    if (!isPositiveFiniteWithinBound(size, MAX_PLATE_SIZE) || !isExactMinorUnit(size)) return null;
    if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT_PER_SIZE) return null;
    const key = toMinorUnits(size);
    bySize.set(key, (bySize.get(key) || 0) + count);
  }
  if (bySize.size === 0) return [];
  return [...bySize.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([minor, count]) => ({ size: minor / MINOR_UNIT_SCALE, count }));
}

// Computes the per-side plate loading for a total bar weight against a
// finite plates-per-side inventory.
//
// Two call shapes are supported:
//   computePlateLoad(totalWeight, barWeight?, platesPerSide?)   — legacy/simple
//   computePlateLoad({ totalWeight, barWeight, platesPerSide }) — #577 contract shape
// `platesPerSide` defaults to the lb standard set with unlimited count per
// size (pre-#577 behavior) so existing callers that never pass an inventory
// keep their exact prior output.
//
// Returns:
// {
//   valid:         false when input is malformed or out of bounds
//   belowBar:      true when 0 < total < barWeight (nothing loadable)
//   barWeight:     the bar weight used
//   perSideTarget: (total - barWeight) / 2, never negative
//   plates:        [{ size, count }] per side, largest first, counts > 0 only
//   remainder:     per-side weight that cannot be loaded with the given inventory
// }
//
// Math runs in hundredths-of-a-unit integers so decimal inputs (e.g. 192.5)
// avoid floating-point drift against a 2.5-size plate step and quarter-unit
// remainders stay exact.
export function computePlateLoad(totalWeightOrOptions, barWeightArg = BAR_WEIGHT_LB, platesPerSideArg = null) {
  let totalWeight;
  let barWeight;
  let platesPerSide;
  if (totalWeightOrOptions && typeof totalWeightOrOptions === 'object') {
    ({ totalWeight, barWeight = BAR_WEIGHT_LB, platesPerSide = null } = totalWeightOrOptions);
  } else {
    totalWeight = totalWeightOrOptions;
    barWeight = barWeightArg;
    platesPerSide = platesPerSideArg;
  }
  if (platesPerSide == null) {
    platesPerSide = PLATE_SIZES_LB.map((size) => ({ size, count: MAX_COUNT_PER_SIZE }));
  }

  const base = {
    valid: true,
    belowBar: false,
    barWeight,
    perSideTarget: 0,
    plates: [],
    remainder: 0,
  };

  if (!isPositiveFiniteWithinBound(totalWeight, MAX_WEIGHT)) {
    return { ...base, valid: false };
  }
  if (!isPositiveFiniteWithinBound(barWeight, MAX_WEIGHT)) {
    return { ...base, valid: false };
  }
  const normalizedPlates = validatePlatesPerSide(platesPerSide);
  if (normalizedPlates === null) {
    return { ...base, valid: false };
  }

  if (totalWeight < barWeight) {
    return { ...base, belowBar: true };
  }

  const perSideTarget = (totalWeight - barWeight) / 2;
  const targetMinor = toMinorUnits(perSideTarget);

  const { plates, usedMinor } = bestPlateCombination(targetMinor, normalizedPlates);

  return {
    ...base,
    perSideTarget,
    plates,
    remainder: (targetMinor - usedMinor) / MINOR_UNIT_SCALE,
  };
}

// #950 review (P2): greedy descending selection does not minimize the
// remainder for a finite/editable inventory — e.g. a 145 lb target against a
// 45 lb bar with a per-side inventory of {45:1, 25:2} has an EXACT two-25
// loading, but greedy picks the 45 first and reports 5 lb unloadable.
// Finds the combination that minimizes the remainder first (maximizes the
// loaded sum), then minimizes total plate count, with a stable larger-
// plate-first tie-break — via a bounded 0/1-knapsack-style DP (each plate
// unit is its own relaxation pass, so the per-size `count` cap is respected
// exactly; see the `k` loop below).
//
// Bounded for adversarial input: REMAINDER_SEARCH_CAP_MINOR caps the DP
// array size regardless of how large a validated (but still huge) target
// is, so runtime/memory never scale unboundedly. A target beyond that cap —
// far past any real per-side loading — degrades to the previous greedy
// selection rather than hanging; this is a documented, deliberately rare
// fallback, not the common path.
const REMAINDER_SEARCH_CAP_MINOR = 200000; // 2,000 lb/kg per side — covers any real loading, including extreme edge cases within MAX_WEIGHT

function greedyPlateSelection(targetMinor, normalizedPlates) {
  let remaining = targetMinor;
  const plates = [];
  for (const { size, count } of normalizedPlates) {
    const sizeMinor = toMinorUnits(size);
    const use = Math.min(count, Math.floor(remaining / sizeMinor));
    if (use > 0) {
      plates.push({ size, count: use });
      remaining -= use * sizeMinor;
    }
  }
  return { plates, usedMinor: targetMinor - remaining };
}

function bestPlateCombination(targetMinor, normalizedPlates) {
  if (targetMinor <= 0) return { plates: [], usedMinor: 0 };

  const totalAvailableMinor = normalizedPlates.reduce(
    (sum, p) => sum + toMinorUnits(p.size) * p.count,
    0
  );
  if (targetMinor > REMAINDER_SEARCH_CAP_MINOR) {
    return greedyPlateSelection(targetMinor, normalizedPlates);
  }
  const cap = Math.min(targetMinor, totalAvailableMinor);
  if (cap <= 0) return { plates: [], usedMinor: 0 };

  const items = normalizedPlates
    .map(({ size, count }) => ({ size, sizeMinor: toMinorUnits(size), count }))
    .filter((it) => it.sizeMinor <= cap && it.count > 0);

  // #950 review (Codex, post-freeze): the previous version kept a single
  // flat `lastSize` array shared across every plate type's relaxation
  // passes. A cell's predecessor recorded there could be silently
  // overwritten by an UNRELATED later pass improving that same cell for a
  // different reason, so backtracking through it could reuse a plate size
  // more times than its configured count — e.g. 265 lb / 45 lb bar /
  // {45:2, 25:4, 10:1} was reported as two 45s plus two 10s despite only
  // one 10 existing.
  //
  // Fix: one dp row PER DISTINCT SIZE, each derived exactly once from the
  // row before it and never mutated afterward (`prev` is read-only; `cur`
  // is `prev`'s own private copy). Since a row is only ever written while
  // it is being built and read-only forever after, no later size's
  // processing can retroactively corrupt an earlier size's row — the
  // "immutable predecessor" the fix requires. Reconstruction then walks
  // rows in reverse; for each size it tries every valid quantity from its
  // own count down to 0 (cheap — bounded by MAX_COUNT_PER_SIZE) and takes
  // the first that reconciles the row's value with the row before it, so
  // it can never claim more of a size than that row's own relaxation
  // (itself correctly bounded by `count` sequential passes) actually used.
  const rows = [new Float64Array(cap + 1).fill(Infinity)];
  rows[0][0] = 0;
  for (const { sizeMinor, count } of items) {
    const prev = rows[rows.length - 1];
    const cur = prev.slice();
    for (let k = 0; k < count; k++) {
      for (let s = cap; s >= sizeMinor; s--) {
        const candidate = cur[s - sizeMinor] + 1;
        if (candidate < cur[s]) cur[s] = candidate;
      }
    }
    rows.push(cur);
  }

  const finalRow = rows[rows.length - 1];
  let bestSum = 0;
  for (let s = cap; s >= 0; s--) {
    if (finalRow[s] < Infinity) {
      bestSum = s;
      break;
    }
  }

  const plates = [];
  let s = bestSum;
  for (let i = items.length - 1; i >= 0; i--) {
    const { size, sizeMinor, count } = items[i];
    const prev = rows[i];
    const cur = rows[i + 1];
    const maxQ = Math.min(count, Math.floor(s / sizeMinor));
    for (let q = maxQ; q >= 0; q--) {
      const remainder = s - q * sizeMinor;
      if (prev[remainder] + q === cur[s]) {
        if (q > 0) plates.push({ size, count: q });
        s = remainder;
        break;
      }
    }
  }
  plates.sort((a, b) => b.size - a.size);

  return { plates, usedMinor: bestSum };
}

// Formats a plate weight for display, dropping trailing ".0".
// #950 review (P2): a standard 1.25 kg plate was being rounded to one
// decimal ("1.3 kg"), misidentifying the denomination. Round to hundredths
// (matching the hundredths-of-a-unit precision the rest of this module
// already uses — MINOR_UNIT_SCALE) and drop only genuinely trailing zeros,
// so "45" stays "45", "2.5" stays "2.5", and "1.25" now stays "1.25".
export function formatPlateWeight(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const hundredths = Math.round(value * MINOR_UNIT_SCALE) / MINOR_UNIT_SCALE;
  return String(hundredths);
}

// ── Persisted equipment profile (#577) ──────────────────────────────────
//
// One device-local record holding BOTH unit profiles independently, so
// switching the active unit never discards the other unit's saved bar/
// inventory. Lenient normalization here (unlike computePlateLoad's strict
// validatePlatesPerSide): a corrupted/partial stored record falls back to
// the matching default piece rather than rejecting the whole profile,
// because this is recovering possibly-stale device storage, not catching a
// caller bug.

export function defaultPlateCalculatorProfile() {
  return {
    version: 1,
    activeUnit: 'lb',
    profiles: {
      lb: { barWeight: BAR_WEIGHT_LB, platesPerSide: DEFAULT_PLATES_LB.map((p) => ({ ...p })) },
      kg: { barWeight: BAR_WEIGHT_KG, platesPerSide: DEFAULT_PLATES_KG.map((p) => ({ ...p })) },
    },
  };
}

function normalizeUnitProfile(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback;
  const barWeight = isPositiveFiniteWithinBound(raw.barWeight, MAX_WEIGHT) && isExactMinorUnit(raw.barWeight)
    ? raw.barWeight
    : fallback.barWeight;
  const normalizedPlates = validatePlatesPerSide(raw.platesPerSide);
  const platesPerSide = normalizedPlates && normalizedPlates.length > 0 ? normalizedPlates : fallback.platesPerSide;
  return { barWeight, platesPerSide };
}

// Normalizes a raw parsed record (or null) into a complete, valid profile.
// A malformed `profiles.lb`/`profiles.kg` piece falls back to its own
// default independently — a corrupt kg profile never discards a valid lb
// one, and vice versa. A completely unparsable record falls back to the
// full default (both units).
export function normalizePlateCalculatorProfile(raw) {
  const defaults = defaultPlateCalculatorProfile();
  if (!raw || typeof raw !== 'object') return defaults;
  const activeUnit = raw.activeUnit === 'kg' ? 'kg' : 'lb';
  const rawProfiles = raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {};
  return {
    version: 1,
    activeUnit,
    profiles: {
      lb: normalizeUnitProfile(rawProfiles.lb, defaults.profiles.lb),
      kg: normalizeUnitProfile(rawProfiles.kg, defaults.profiles.kg),
    },
  };
}
