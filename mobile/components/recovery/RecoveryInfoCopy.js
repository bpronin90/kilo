// Scoped Recovery explainers (#1358, #1360). Each info icon explains only the one
// visible thing beside it: the total-recovery percentage or the per-lift pace
// (the week bars' note lives with them). The copy is fixed: no explainer prints
// snapshot detail, history, or a number not shown beside it.

import { LIFT_STATE, PACE_MIN_POINTS, PACE_WINDOW } from '../../lib/data/recoveryStrength';
import { paceCompact } from './RecoveryStrengthLadder';

export const NON_MEDICAL_NOTE = 'Training numbers only. Not a medical judgment. Only you end a Recovery block.';

// Beside the total-recovery number: what it compares, what it totals, and the
// non-medical note. The cohort/coverage/exclusion detail stays in the summary's
// accessibility label.
export const PERCENT_INFO_LINES = Object.freeze([
  'Total recovery compares your current strength with this block’s frozen baseline.',
  'It averages every baseline lift that can be scored for strength: each lift’s latest best set as a share of its baseline best set. A lift with no score yet counts as zero.',
  'Lifts with no load-and-reps baseline set, like timed or bodyweight work, are left out.',
  NON_MEDICAL_NOTE,
]);

export const PACE_INFO_LINES = Object.freeze([
  'Pace is a best-case estimate if your recent weekly rate continues.',
  `It uses up to your last ${PACE_WINDOW} scored weeks and needs at least ${PACE_MIN_POINTS} scored weeks.`,
  '“~2 wk” means about two more Recovery weeks.',
]);

// Pace help exists only where a lift row visibly prints a pace.
export function hasVisiblePace(strength) {
  return (strength.lifts || []).some(l => l.state === LIFT_STATE.SCORED && !!paceCompact(l.pace));
}
