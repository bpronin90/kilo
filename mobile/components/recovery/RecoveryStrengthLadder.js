// Selected-week per-lift ladder (#1305): every scored baseline lift's % of its
// frozen best set against the 100% mark, its best set vs the baseline set, and a
// best-case pace in recovery weeks. Lifts outside the headline average say so.
// Lifts without a score this week, never retested, or never scoreable are listed
// with their plain reason, never as a zero.

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { formatLiftWeightValue } from '../../lib/units';
import {
  LIFT_STATE, NOT_RETESTED, PACE_STATUS, UNSCOREABLE_REASON, displayPercent,
} from '../../lib/data/recoveryStrength';
import { StrengthBar } from './RecoveryStrengthWeeks';
import { createStrengthStyles } from './recoveryStrengthStyles';

const NOT_RETESTED_COPY = Object.freeze({
  [NOT_RETESTED.ABSENT_THIS_WEEK]: 'not logged this week',
  [NOT_RETESTED.NEVER_LOGGED]: 'not logged in any week yet',
  [NOT_RETESTED.UNKNOWN]: 'not in any readable week',
});

const _weeks = (n) => `${n} ${n === 1 ? 'week' : 'weeks'}`;
const _set = (s, unit) => `${formatLiftWeightValue(s.weight, unit)} × ${s.reps}`;

// Pace copy. Every estimate says it is best-case and names its window and rate.
// A reached target is always named, even when no forecast is possible.
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

export function RecoveryStrengthLadder({ strength, scaleMax, unit = 'lb' }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const shown = strength.lifts.filter(l => l.state === LIFT_STATE.SCORED || l.state === LIFT_STATE.UNSCOREABLE);
  const notScored = new Map();
  for (const n of strength.not_scored || []) {
    const reason = UNSCOREABLE_REASON[n.reason] || UNSCOREABLE_REASON.no_scoreable_set;
    if (!notScored.has(reason)) notScored.set(reason, []);
    notScored.get(reason).push(n.name);
  }
  return (
    <View testID="recovery-strength-ladder" style={styles.section}>
      {shown.length > 0 && <Text style={styles.sectionTitle}>Each lift vs its baseline best set</Text>}
      {shown.map((l, i) => {
        if (l.state === LIFT_STATE.UNSCOREABLE) {
          const reason = UNSCOREABLE_REASON[l.reason] || UNSCOREABLE_REASON.no_scoreable_set;
          return (
            <View key={l.key} testID={`recovery-strength-lift-${l.key}`} style={[styles.row, i > 0 && styles.rowBordered]} accessible accessibilityLabel={`${l.name}: no strength score this week. ${reason}.`}>
              <Text style={styles.rowName}>{l.name}</Text>
              <Text style={styles.detail}>{reason}</Text>
            </View>
          );
        }
        const pct = displayPercent(l.percent);
        const sets = `Best set ${_set(l.best, unit)} ${unit} vs baseline ${_set(l.baseline, unit)} ${unit}`;
        const pace = paceText(l.pace);
        const cohort = l.in_cohort ? null : 'Not in the average: not scored every week';
        const label = [`${l.name}: ${pct}% of baseline strength`, sets, cohort, pace].filter(Boolean).join('. ');
        return (
          <View key={l.key} testID={`recovery-strength-lift-${l.key}`} style={[styles.row, i > 0 && styles.rowBordered]} accessible accessibilityLabel={label}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowName}>{l.name}</Text>
              <Text style={styles.rowValue}>{`${pct}%`}</Text>
            </View>
            <StrengthBar percent={l.percent} scaleMax={scaleMax} testID={`recovery-strength-lift-${l.key}-bar`} />
            <Text style={styles.detail}>{sets}</Text>
            {cohort ? <Text style={styles.detail}>{cohort}</Text> : null}
            {pace ? <Text testID={`recovery-strength-pace-${l.key}`} style={styles.detail}>{pace}</Text> : null}
          </View>
        );
      })}

      {strength.not_retested.length > 0 && (
        <View testID="recovery-strength-not-retested" style={styles.list} accessible accessibilityLabel={`Not retested yet: ${strength.not_retested.map(n => `${n.name}, ${NOT_RETESTED_COPY[n.kind]}`).join('; ')}.`}>
          <Text style={styles.sectionTitle}>Not retested yet</Text>
          {strength.not_retested.map(n => (
            <Text key={n.key} style={styles.detail}>{`${n.name}: ${NOT_RETESTED_COPY[n.kind]}`}</Text>
          ))}
        </View>
      )}

      {notScored.size > 0 && (
        <View testID="recovery-strength-not-scored" style={styles.list}>
          {[...notScored].map(([reason, names]) => (
            <Text key={reason} style={styles.detail}>{`Not scored for strength (${reason.toLowerCase()}): ${names.join(', ')}`}</Text>
          ))}
        </View>
      )}
    </View>
  );
}
