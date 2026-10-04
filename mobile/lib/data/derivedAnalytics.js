// The one derived-analytics layer for Recovery summary counts and goal-aware
// weight trend (#1242). Home, Analytics, Weight, and Log read these values from
// here and never recompute them locally, so one fixture always produces the
// same counts, words, direction, and tone on every surface.

import { deriveRecoveryWeekBands } from './recoveryReturnBands';

// ── Recovery ────────────────────────────────────────────────────────────────

// The single Recovery count vocabulary. "trained" / "not yet" over the whole
// baseline roster — the same words the Recovery detail already uses.
export const RECOVERY_COUNT_WORDS = Object.freeze({ trained: 'trained', notYet: 'not yet' });

// Roster counts for one compared week, from `deriveRecoveryWeekBands` (the
// roster already excludes unusable-baseline rows). Null when the week has no
// roster evidence (note missing/unreadable) — a gap, never a zero.
export function deriveRecoverySummary(week) {
  const bands = deriveRecoveryWeekBands(week);
  return summarizeRecoveryBands(bands);
}

// Same shape from an already-derived bands result, for callers that hold one.
export function summarizeRecoveryBands(bands) {
  if (!bands || !bands.buckets || !(bands.roster_size > 0)) return null;
  const rosterSize = bands.roster_size;
  const trained = bands.trained || 0;
  return {
    rosterSize,
    trained,
    notYet: Math.max(0, rosterSize - trained),
    atOrAbove: bands.buckets.at_or_above ?? 0,
  };
}

// `of 33 trained · 26 not yet` — the suffix printed after the trained count.
// Zero parts after the denominator are dropped.
export function formatRecoveryCountSuffix(summary) {
  if (!summary) return null;
  const notYet = summary.notYet > 0 ? ` · ${summary.notYet} ${RECOVERY_COUNT_WORDS.notYet}` : '';
  return `of ${summary.rosterSize} ${RECOVERY_COUNT_WORDS.trained}${notYet}`;
}

// The full line: `7 of 33 trained · 26 not yet`.
export function formatRecoveryCountLine(summary) {
  if (!summary) return null;
  return `${summary.trained} ${formatRecoveryCountSuffix(summary)}`;
}

// The single week-status wording. `open` is a week in progress; a closed week
// asks for the next one; no week yet asks for the first.
export function recoveryWeekStatusText({ weekNumber = null, open = false } = {}) {
  if (weekNumber == null) return 'No recovery week yet — add a week';
  return open
    ? `Week ${weekNumber} in progress`
    : `Week ${weekNumber} complete — add the next week`;
}

// ── Weight ──────────────────────────────────────────────────────────────────

export const WEIGHT_DIRECTION = Object.freeze({ UP: 'up', DOWN: 'down', FLAT: 'flat' });

// Direction of a change between two values. Null when either side is missing.
export function weightDirection(current, prior) {
  if (current == null || prior == null || Number.isNaN(current) || Number.isNaN(prior)) return null;
  if (current > prior) return WEIGHT_DIRECTION.UP;
  if (current < prior) return WEIGHT_DIRECTION.DOWN;
  return WEIGHT_DIRECTION.FLAT;
}

// Direction from a canonical pace flag ('gain' | 'loss' | null).
export function paceDirection(paceFlag) {
  if (paceFlag === 'gain') return WEIGHT_DIRECTION.UP;
  if (paceFlag === 'loss') return WEIGHT_DIRECTION.DOWN;
  return null;
}

// The shared cue text for a direction.
export function weightDirectionCue(direction) {
  if (direction === WEIGHT_DIRECTION.UP) return '↑ Gaining';
  if (direction === WEIGHT_DIRECTION.DOWN) return '↓ Losing';
  if (direction === WEIGHT_DIRECTION.FLAT) return '→ Stable';
  return '-';
}

// Pace-anomaly badge text ('↑ Gaining fast' / '↓ Losing fast').
export function weightPaceBadgeText(direction) {
  if (direction === WEIGHT_DIRECTION.UP) return '↑ Gaining fast';
  if (direction === WEIGHT_DIRECTION.DOWN) return '↓ Losing fast';
  return null;
}

export const WEIGHT_TONE = Object.freeze({
  SPIKE: 'spike',
  NOTABLE: 'notable',
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  GAINING: 'gaining',
  LOSING: 'losing',
});

// Goal-aware tone. Pace anomalies keep their fixed severity tone. Under a
// gain/loss goal, movement toward the goal is positive and away is negative;
// stable is neutral. Without a gain/loss goal (none, or maintain) a bare
// rise/fall keeps a directional tone (gaining/losing). Missing data and stable are null.
export function weightTrendTone({ direction, goalDirection = null, paceLevel = null }) {
  if (paceLevel === 'spike') return WEIGHT_TONE.SPIKE;
  if (paceLevel === 'notable') return WEIGHT_TONE.NOTABLE;
  if (direction !== WEIGHT_DIRECTION.UP && direction !== WEIGHT_DIRECTION.DOWN) return null;
  if (goalDirection === 'gain' || goalDirection === 'loss') {
    const toward = (direction === WEIGHT_DIRECTION.UP) === (goalDirection === 'gain');
    return toward ? WEIGHT_TONE.POSITIVE : WEIGHT_TONE.NEGATIVE;
  }
  return direction === WEIGHT_DIRECTION.UP ? WEIGHT_TONE.GAINING : WEIGHT_TONE.LOSING;
}

// One trend read: direction, cue text, and goal-aware tone together.
export function deriveWeightTrend({ current, prior, goalDirection = null, paceLevel = null }) {
  const direction = weightDirection(current, prior);
  return {
    direction,
    cue: weightDirectionCue(direction),
    tone: weightTrendTone({ direction, goalDirection, paceLevel }),
  };
}

// Tones read as good news; everything else that is non-null reads as a warning.
export function isGoodWeightTone(tone) {
  return tone === WEIGHT_TONE.POSITIVE || tone === WEIGHT_TONE.LOSING;
}
