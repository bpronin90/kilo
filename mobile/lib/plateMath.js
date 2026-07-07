// Plate-loading math for a standard barbell. lb-only per the #435 decision
// record; storage and analytics are untouched — this is pure display math.

export const BAR_WEIGHT_LB = 45;
export const PLATE_SIZES_LB = [45, 25, 10, 5, 2.5];

// Computes the per-side plate loading for a total bar weight.
//
// Returns:
// {
//   valid:        false when the input is not a positive finite number
//   belowBar:     true when 0 < total < barWeight (nothing loadable)
//   barWeight:    the bar weight used
//   perSideTarget: (total - barWeight) / 2, never negative
//   plates:       [{ size, count }] per side, largest first, counts > 0 only
//   remainder:    per-side weight that cannot be loaded with standard plates
// }
//
// Math runs in hundredths-of-a-pound integers so decimal inputs (e.g. 192.5)
// avoid floating-point drift against the 2.5 lb plate step and quarter-pound
// remainders stay exact.
export function computePlateLoad(totalWeight, barWeight = BAR_WEIGHT_LB) {
  const base = {
    valid: true,
    belowBar: false,
    barWeight,
    perSideTarget: 0,
    plates: [],
    remainder: 0,
  };

  if (typeof totalWeight !== 'number' || !Number.isFinite(totalWeight) || totalWeight <= 0) {
    return { ...base, valid: false };
  }

  if (totalWeight < barWeight) {
    return { ...base, belowBar: true };
  }

  const perSideTarget = (totalWeight - barWeight) / 2;
  let remainingHundredths = Math.round(perSideTarget * 100);

  const plates = [];
  for (const size of PLATE_SIZES_LB) {
    const sizeHundredths = Math.round(size * 100);
    const count = Math.floor(remainingHundredths / sizeHundredths);
    if (count > 0) {
      plates.push({ size, count });
      remainingHundredths -= count * sizeHundredths;
    }
  }

  return {
    ...base,
    perSideTarget,
    plates,
    remainder: remainingHundredths / 100,
  };
}

// Formats a plate weight for display, dropping trailing ".0".
export function formatPlateWeight(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(Math.round(value * 10) / 10);
}
