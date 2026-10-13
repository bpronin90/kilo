// Scoped Recovery explainers (#1358). Each info icon explains only the thing
// beside it: the total-recovery percentage, the per-lift pace, or the bar scale.
// Block metadata (baseline, dates, reason) has no explainer. The dynamic lines
// are read from the Recovery snapshot; nothing here re-derives a number.

import { LIFT_STATE, PACE_MIN_POINTS, PACE_WINDOW } from '../../lib/data/recoveryStrength';
import { paceCompact, paceText } from './RecoveryStrengthLadder';

export const NON_MEDICAL_NOTE = 'Training numbers only. Not a medical judgment. Only you end a Recovery block.';
export const PERCENT_EXPLAINER = 'Total recovery compares your current strength with this block’s frozen baseline: each lift’s best set as a share of its baseline best set.';
export const PACE_EXPLAINER = `Pace is a best-case estimate: it assumes your recent weekly rate continues, uses up to your last ${PACE_WINDOW} scored weeks, and needs ${PACE_MIN_POINTS} scored weeks. “~2 wk” means about two more Recovery weeks.`;

const _sentence = l => (/[.!?]$/.test(l) ? l : `${l}.`);

// Beside the total-recovery number: what it means, how eligible scored lifts are
// totalled (the snapshot's own explainer lines), which lifts sit outside the
// average, and the non-medical note.
export function percentInfoLines(snapshot) {
  const { display, strength } = snapshot;
  const lines = [PERCENT_EXPLAINER, ...display.detail.map(_sentence)];
  const outside = (strength.lifts || []).filter(l => l.state === LIFT_STATE.SCORED && !l.in_cohort).map(l => l.name);
  if (outside.length > 0) lines.push(`Not in the average (not scored every week): ${outside.join(', ')}.`);
  lines.push(NON_MEDICAL_NOTE);
  return lines;
}

// Pace help exists only where a lift row visibly prints a pace.
export function hasVisiblePace(strength) {
  return (strength.lifts || []).some(l => l.state === LIFT_STATE.SCORED && !!paceCompact(l.pace));
}

export function paceInfoLines(snapshot) {
  const totalPace = snapshot.total && snapshot.total.pace ? paceText(snapshot.total.pace) : null;
  return totalPace ? [PACE_EXPLAINER, `Total recovery: ${totalPace}.`] : [PACE_EXPLAINER];
}
