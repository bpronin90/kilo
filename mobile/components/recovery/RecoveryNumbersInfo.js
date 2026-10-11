// "About these numbers" content (#1315): the dynamic context the compact Recovery
// UI no longer prints. Every sentence removed from the default view lands here
// or in an accessibility label: the baseline routine, coverage and cohort,
// unreadable weeks and dropped lifts (from the snapshot's `display.detail`), the
// bar scale legend, which lifts sit outside the average, each lift's full
// best-case pace wording, and the non-medical note.

import { LIFT_STATE } from '../../lib/data/recoveryStrength';
import { SNAPSHOT_STATE } from '../../lib/data/recoverySnapshot';
import { paceText } from './RecoveryStrengthLadder';
import { strengthScaleNote } from './RecoveryStrengthWeeks';

export const NON_MEDICAL_NOTE = 'Training numbers only. Not a medical judgment. Only you end a Recovery block.';
export const PACE_EXPLAINER = 'Pace is a best-case estimate: it assumes your recent weekly rate continues, uses up to your last 4 scored weeks, and needs 3 scored weeks. “~2 wk” means about two more recovery weeks.';

export function numbersInfoLines({ snapshot, routineTitle }) {
  const lines = [];
  const { display, strength, scaleMax } = snapshot;
  lines.push(`Baseline routine: ${routineTitle}.`);
  if (display.state === SNAPSHOT_STATE.SCORE) {
    lines.push(`${display.weekLabel}: ${display.headline}, from each lift’s best set as a share of its baseline best set.`);
  }
  // Total recovery wording first, then the secondary consistent-cohort detail.
  lines.push(...display.detail.map(l => (/[.!?]$/.test(l) ? l : `${l}.`)));
  if (strength.status === 'ok') {
    const outside = (strength.lifts || []).filter(l => l.state === LIFT_STATE.SCORED && !l.in_cohort).map(l => l.name);
    if (outside.length > 0) lines.push(`Not in the average (not scored every week): ${outside.join(', ')}.`);
    lines.push(strengthScaleNote(scaleMax));
    const paced = (strength.lifts || []).filter(l => l.state === LIFT_STATE.SCORED && paceText(l.pace));
    // #1318: pace is also stated for the total recovery trend (same #1305 rules).
    const totalPace = snapshot.total && snapshot.total.pace ? paceText(snapshot.total.pace) : null;
    if (paced.length > 0 || totalPace) {
      lines.push(PACE_EXPLAINER);
      if (totalPace) lines.push(`Total recovery: ${totalPace}.`);
      for (const l of paced) lines.push(`${l.name}: ${paceText(l.pace)}.`);
    }
  }
  lines.push(NON_MEDICAL_NOTE);
  return lines;
}
