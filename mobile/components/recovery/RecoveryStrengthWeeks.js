// Weekly strength trend (#1305): one bar per recovery week through the selected
// week, each the SAME cohort's average % of baseline, on the common percent
// scale shared with the ladder. Weeks are ordinals, never dates. An unreadable
// week is a dashed "No data" gap, never a zero.

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { displayPercent } from '../../lib/data/recoveryStrength';
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

export function RecoveryStrengthWeeks({ strength, scaleMax }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  // Rows stay even with no average (empty cohort): unreadable weeks remain
  // visible gaps and readable ones say there is no average, never a zero.
  if (!strength.weeks || strength.weeks.length < 2) return null;
  return (
    <View testID="recovery-strength-weeks" style={styles.section}>
      <Text style={styles.sectionTitle}>Week by week</Text>
      {strength.weeks.map(w => {
        const scored = w.readable && w.mean != null;
        const label = scored
          ? `Week ${w.week_number}: ${displayPercent(w.mean)}% of baseline strength`
          : w.readable ? `Week ${w.week_number}: no average` : `Week ${w.week_number}: no readable evidence`;
        return (
          <View key={w.week_id} testID={`recovery-strength-week-${w.week_number}`} style={styles.weekRow} accessible accessibilityLabel={label}>
            <Text style={styles.weekLabel}>{`Week ${w.week_number}`}</Text>
            {scored ? (
              <>
                <StrengthBar percent={w.mean} scaleMax={scaleMax} testID={`recovery-strength-week-${w.week_number}-bar`} />
                <Text style={styles.weekValue}>{`${displayPercent(w.mean)}%`}</Text>
              </>
            ) : (
              <>
                <View style={styles.gapTrack} />
                <Text style={styles.weekValue}>{w.readable ? 'No average' : 'No data'}</Text>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}
