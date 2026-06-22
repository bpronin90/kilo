import { epleyPR } from '../parser.js';

// ── Kilo max ─────────────────────────────────────────────────────────────────

export function getKiloFatigueMultiplier() {
  return 1.07;
}

// Compute the Kilo max for one exercise given its occurrences.
// Excludes warmup occurrences (kind === 'warmup') and sets without valid weight/reps.
// Returns { kilo_max_adjusted: number|null }.
// kilo_max_adjusted = Math.round(avgEpley * multiplier)
export function computeKiloMax(occurrences, multiplier = getKiloFatigueMultiplier()) {
  const epleyValues = [];
  for (const occ of occurrences) {
    if (occ.kind === 'warmup') continue;
    for (const s of occ.sets) {
      const e = epleyPR(s.weight_value, s.rep_count);
      if (e !== null) epleyValues.push(e);
    }
  }
  if (epleyValues.length === 0) return { kilo_max_adjusted: null };
  const rawAvg = epleyValues.reduce((sum, v) => sum + v, 0) / epleyValues.length;
  return {
    kilo_max_adjusted: Math.round(rawAvg * multiplier),
  };
}
