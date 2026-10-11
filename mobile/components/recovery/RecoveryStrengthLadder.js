// Selected-week per-lift ladder (#1305, compacted #1315): each scored baseline
// lift shows name, %, bar, ONE compact best-set / baseline-set line and a compact
// pace. Everything else (full best-case pace qualification, rate and window,
// "not in the average") lives in the row accessibility label and the "About
// these numbers" explainer. Lifts without a score this week or ever are listed
// in the not-scored disclosure, never as a zero.

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { formatLiftWeightValue } from '../../lib/units';
import { LIFT_STATE, PACE_MIN_POINTS, PACE_STATUS, displayPercent } from '../../lib/data/recoveryStrength';
import { StrengthBar } from './RecoveryStrengthWeeks';
import { createStrengthStyles } from './recoveryStrengthStyles';

const _weeks = (n) => `${n} ${n === 1 ? 'week' : 'weeks'}`;
const _set = (s, unit) => `${formatLiftWeightValue(s.weight, unit)}×${s.reps}`;

// Full pace copy. Every estimate says it is best-case and names its window and
// rate. A reached target is always named, even when no forecast is possible.
export function paceText(pace) {
  const reached = (pace.targets || []).filter(t => t.reached).map(t => `${t.target}% reached`);
  const lead = reached.length > 0 ? `${reached.join(' · ')}. ` : '';
  switch (pace.status) {
    case PACE_STATUS.ESTIMATE: {
      const parts = pace.targets.map(t => (t.reached ? `${t.target}% reached` : `${t.target}% in ${_weeks(t.weeks)}`));
      const rate = `${pace.gain >= 0 ? '+' : ''}${pace.gain.toFixed(1)} pts/week over Weeks ${pace.from_week}–${pace.to_week}`;
      return `Best case, if your recent rate continues: ${parts.join(' · ')} (${rate})`;
    }
    case PACE_STATUS.INSUFFICIENT: return `${lead}Not enough weeks yet: log a third scored recovery week`;
    case PACE_STATUS.NO_GAIN: return `${lead}No forecast: no gain over Weeks ${pace.from_week}–${pace.to_week}`;
    case PACE_STATUS.REACHED: return 'Baseline reached';
    case PACE_STATUS.SUPPRESSED: return 'Pace is hidden until Recovery data is current';
    default: return null;
  }
}

// The short form printed in the row. Same facts, no qualification: the best-case
// wording is in `paceText` (row label + explainer).
export function paceCompact(pace) {
  const reached = (pace.targets || []).filter(t => t.reached).map(t => `${t.target}% reached`);
  switch (pace.status) {
    case PACE_STATUS.ESTIMATE:
      return pace.targets.map(t => (t.reached ? `${t.target}% reached` : `${t.target}% ~${t.weeks} wk`)).join(' · ');
    case PACE_STATUS.INSUFFICIENT: return [...reached, `need ${PACE_MIN_POINTS} wks`].join(' · ');
    case PACE_STATUS.NO_GAIN: return [...reached, 'no gain'].join(' · ');
    case PACE_STATUS.REACHED: return 'reached';
    case PACE_STATUS.SUPPRESSED: return 'pace hidden';
    default: return null;
  }
}

export function scoredLifts(strength) {
  return (strength.lifts || []).filter(l => l.state === LIFT_STATE.SCORED);
}

export function RecoveryStrengthLadder({ strength, scaleMax, unit = 'lb' }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const shown = scoredLifts(strength);
  if (shown.length === 0) return null;
  return (
    <View testID="recovery-strength-ladder" style={styles.list}>
      {shown.map((l, i) => {
        const pct = displayPercent(l.percent);
        const sets = `${_set(l.best, unit)} / ${_set(l.baseline, unit)} ${unit}`;
        const fullSets = `Best set ${_set(l.best, unit)} ${unit} vs baseline ${_set(l.baseline, unit)} ${unit}`;
        const pace = paceCompact(l.pace);
        const cohort = l.in_cohort ? null : 'Not in the average: not scored every week';
        const label = [`${l.name}: ${pct}% of baseline strength`, fullSets, cohort, paceText(l.pace)].filter(Boolean).join('. ');
        return (
          <View key={l.key} testID={`recovery-strength-lift-${l.key}`} style={[styles.row, i > 0 && styles.rowBordered]} accessible accessibilityLabel={label}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowName}>{l.name}</Text>
              <Text style={styles.rowValue}>{`${pct}%`}</Text>
            </View>
            <View style={styles.barLine}>
              <StrengthBar percent={l.percent} scaleMax={scaleMax} testID={`recovery-strength-lift-${l.key}-bar`} />
            </View>
            <Text testID={`recovery-strength-sets-${l.key}`} style={styles.detail}>{sets}</Text>
            {pace ? <Text testID={`recovery-strength-pace-${l.key}`} style={styles.detail}>{pace}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
