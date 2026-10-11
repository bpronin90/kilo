// Weekly strength trend (#1305): one bar per recovery week through the selected
// week, each the SAME cohort's average % of baseline, on the common percent
// scale shared with the ladder. Weeks are ordinals, never dates. An unreadable
// week is a dashed "No data" gap, never a zero. The rows are also the week
// selector (#1307).

import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { RECOVERY_WEEK_STATUS } from '../../lib/data/recoveryAnalytics';
import { STRENGTH_STATUS, displayPercent } from '../../lib/data/recoveryStrength';
import { createStrengthStyles } from './recoveryStrengthStyles';

// One scale for trend and ladder: at least 100%, extended to the next 10 above
// the largest value so a >100% lift stays fully visible and factual.
export function strengthScaleMax(strength) {
  const values = [
    ...(strength.weeks || []).map(w => w.mean),
    ...(strength.lifts || []).map(l => l.percent),
  ].filter(v => typeof v === 'number' && Number.isFinite(v));
  const top = Math.max(100, ...values);
  return top <= 100 ? 100 : Math.ceil(top / 10) * 10;
}

export function StrengthBar({ percent, scaleMax, testID }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  const width = `${Math.max(0, Math.min(100, (percent / scaleMax) * 100))}%`;
  const ref = `${(100 / scaleMax) * 100}%`;
  return (
    <View testID={testID} style={styles.track} accessible={false}>
      <View testID={testID ? `${testID}-fill` : undefined} style={[styles.fill, { width }]} />
      <View testID={testID ? `${testID}-reference` : undefined} style={[styles.reference, { left: ref, marginLeft: scaleMax === 100 ? -2 : -1 }]} />
    </View>
  );
}

export function StrengthScaleNote({ scaleMax }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  return (
    <Text testID="recovery-strength-scale" style={styles.scaleNote}>
      {`Bars run 0–${scaleMax}%. The dark mark is your baseline (100%).`}
    </Text>
  );
}

// The SOLE Analytics week selector (#1307). Membership is every live week of the
// block (comparison results, by stable week_id), so any week stays selectable:
// an unreadable or missing one reveals its explicit notice rather than being a
// silent no-op. The score comes from the as-of trend when it has the week; a week
// later than the selection (or a baseline with no strength data) says so.
export function RecoveryStrengthWeeks({ weekResults, strength, scaleMax, selectedWeekId, onSelect }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  if (!weekResults || weekResults.length < 1) return null;
  const trend = new Map((strength.weeks || []).map(w => [w.week_id, w]));
  return (
    <View testID="recovery-strength-weeks" style={styles.section}>
      <Text style={styles.sectionTitle}>Week by week</Text>
      {weekResults.map(w => {
        const t = trend.get(w.week_id);
        const unreadable = w.status !== RECOVERY_WEEK_STATUS.OK || (t && !t.readable);
        const scored = !unreadable && t && t.mean != null;
        const valueText = scored ? `${displayPercent(t.mean)}%`
          : unreadable ? 'No data'
          : t ? 'No average'
          : strength.status === STRENGTH_STATUS.OK ? 'Select to view' : 'Not scored';
        const selected = w.week_id === selectedWeekId;
        const label = `Week ${w.week_number}: ${scored ? `${valueText} of baseline strength` : unreadable ? 'no readable evidence' : valueText.toLowerCase()}`;
        return (
          <Pressable
            key={w.week_id}
            testID={`recovery-strength-week-${w.week_number}`}
            onPress={() => onSelect && onSelect(w.week_id)}
            style={[styles.weekRow, styles.weekRowPress, selected && styles.weekRowSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            accessibilityHint="Shows this week's evidence"
          >
            <Text style={[styles.weekLabel, selected && styles.weekLabelSelected]}>{`Week ${w.week_number}`}</Text>
            {scored ? (
              <StrengthBar percent={t.mean} scaleMax={scaleMax} testID={`recovery-strength-week-${w.week_number}-bar`} />
            ) : (
              <View style={styles.gapTrack} />
            )}
            <Text style={styles.weekValue}>{valueText}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
