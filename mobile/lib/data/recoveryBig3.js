// Recovery Big 3 (#1171, #1192, #1318, #1353): the one mapping from the shared
// Recovery snapshot to Squat / Bench / Deadlift rows. Home's Recovery card and
// the Analytics Recovery summary both read it, so the two surfaces cannot
// disagree. Pure: nothing here derives a score — the snapshot's per-lift status
// (one precedence, computed in snapshot construction) is the only input besides
// the effective 1K selection (resolveOneKSelections).

import { normalizeExerciseKey } from '../parser.js';
import { STRENGTH_STATUS, displayPercent } from './recoveryStrength.js';

export const RECOVERY_BIG3_STATE = Object.freeze({
  SCORED: 'scored',
  NOT_RETESTED: 'not_retested',
  NOT_SCORED: 'not_scored',
  UNKNOWN: 'unknown',
  // The selected lift has no baseline row (#1192).
  NOT_IN_BASELINE: 'not_in_baseline',
});

const BIG3_SLOTS = Object.freeze([
  { slot: 'squat', label: 'Squat' },
  { slot: 'bench', label: 'Bench' },
  { slot: 'deadlift', label: 'Deadlift' },
]);

const STATE_BY_STATUS = Object.freeze({
  scored: RECOVERY_BIG3_STATE.SCORED,
  unknown: RECOVERY_BIG3_STATE.UNKNOWN,
  not_scored: RECOVERY_BIG3_STATE.NOT_SCORED,
  not_retested: RECOVERY_BIG3_STATE.NOT_RETESTED,
});

// A lift's number is its floored latest % of baseline best set through the
// selected week (#1318); a lift with no score carries a status instead.
export function deriveRecoveryBig3(snapshot, selections) {
  const week = snapshot && snapshot.selectedWeek;
  const counts = snapshot ? snapshot.counts : null;
  const { strength } = snapshot || {};
  // No selected week or no strength model (legacy baseline): no rows.
  if (!week || !strength || strength.status !== STRENGTH_STATUS.OK) return { big3: [], counts };
  const byKey = new Map((snapshot.liftStatus || []).map(l => [l.key, l]));
  const big3 = BIG3_SLOTS.map(({ slot, label }) => {
    const key = typeof selections?.[slot] === 'string' ? normalizeExerciseKey(selections[slot]) : null;
    const st = key ? byKey.get(key) : null;
    if (!st) return { slot, label: selections?.[slot] || label, state: RECOVERY_BIG3_STATE.NOT_IN_BASELINE, percent: null, lastTestedWeek: null, spoken: null };
    return {
      slot, label: st.name || label, percent: st.percent == null ? null : displayPercent(st.percent),
      lastTestedWeek: st.lastTested, spoken: st.spoken,
      state: STATE_BY_STATUS[st.status],
    };
  });
  return { big3, counts };
}

// Each row's right-hand value: plain words, and a percentage only where the
// snapshot produced a real per-lift score (#1171).
export function recoveryBig3Value(lift) {
  if (lift.state === RECOVERY_BIG3_STATE.NOT_IN_BASELINE) return 'Not in baseline';
  if (lift.state === RECOVERY_BIG3_STATE.NOT_RETESTED) return 'Not retested';
  if (lift.state === RECOVERY_BIG3_STATE.NOT_SCORED) return 'Not scored';
  if (lift.state === RECOVERY_BIG3_STATE.UNKNOWN) return 'Unknown';
  return `${lift.percent}%`;
}

// `deriveRecoveryBig3` lifts → Big3Bars rows.
export function recoveryBig3Rows(lifts) {
  return lifts.map(lift => {
    const scored = lift.state === RECOVERY_BIG3_STATE.SCORED;
    return {
      key: lift.slot,
      label: lift.label,
      value: recoveryBig3Value(lift),
      // A score carried from an earlier week names that week.
      age: lift.lastTestedWeek ? `Week ${lift.lastTestedWeek}` : null,
      strong: scored,
      done: scored && lift.percent >= 100,
      // Only a real score fills the bar; unscored lifts stay an empty track.
      fill: scored ? lift.percent : 0,
    };
  });
}
