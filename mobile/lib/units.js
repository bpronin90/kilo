// lb/kg display-unit helpers (#441).
//
// Canonical storage is ALWAYS lb. These helpers convert at the display layer
// (render) and at the entry layer (typed value → canonical lb). Analytics math,
// thresholds, and stored values stay lb-defined; nothing here mutates data.
//
// Every helper is an identity/no-op passthrough when unit is 'lb' (or anything
// other than 'kg') so lb rendering stays bit-identical to the pre-#441 output.

export const KG_PER_LB = 0.45359237;

export function lbToKg(lb) {
  return lb * KG_PER_LB;
}

export function kgToLb(kg) {
  return kg / KG_PER_LB;
}

// Map the reserved user_profile.unit_system field ('imperial'/'metric') to a
// display unit. Unset/unknown defaults to lb (US-centric launch default).
export function unitFromUnitSystem(unitSystem) {
  return unitSystem === 'metric' ? 'kg' : 'lb';
}

export function unitSystemFromUnit(unit) {
  return unit === 'kg' ? 'metric' : 'imperial';
}

// Unrounded numeric conversion into display space. Callers keep their own
// existing rounding (toFixed(0)/(1)/(2)) so the lb path is untouched.
export function displayWeight(lbValue, unit) {
  if (lbValue === null || lbValue === undefined) return lbValue;
  return unit === 'kg' ? lbToKg(lbValue) : lbValue;
}

// Bodyweight display value: raw in lb (matches today's `${value}` interpolation
// exactly), one decimal in kg per the #441 spec.
export function formatBodyweightValue(lbValue, unit) {
  if (lbValue === null || lbValue === undefined) return '';
  return unit === 'kg' ? lbToKg(lbValue).toFixed(1) : String(lbValue);
}

// Lift-weight display value: raw in lb; kg rounded to one decimal with a
// trailing .0 trimmed (225 → 102.1, 220.5 → 100), which reads naturally in
// dense set rows.
export function formatLiftWeightValue(lbValue, unit) {
  if (lbValue === null || lbValue === undefined) return '';
  if (unit !== 'kg') return String(lbValue);
  return String(Math.round(lbToKg(lbValue) * 10) / 10);
}

// Entry-path conversion: a numeric value typed in the selected unit → canonical
// lb. kg input rounds to one decimal lb so values re-display cleanly in either
// unit. lb input is stored exactly as typed (identity).
export function inputWeightToLb(value, unit) {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  return unit === 'kg' ? Math.round(kgToLb(value) * 10) / 10 : value;
}

// Convert a LineChart series ({ value, label, unit, ... }[]) into display
// space. Returns the same array reference for lb so memoized lb renders are
// untouched. `decimals` controls kg rounding (1 for bodyweight series, 0 for
// lift totals).
export function displayChartSeries(points, unit, decimals = 1) {
  if (unit !== 'kg' || !Array.isArray(points)) return points;
  const factor = Math.pow(10, decimals);
  return points.map((p) => {
    if (!p || p.value === null || p.value === undefined) return p;
    return {
      ...p,
      value: Math.round(lbToKg(p.value) * factor) / factor,
      unit: p.unit === 'lb' ? 'kg' : p.unit,
    };
  });
}
