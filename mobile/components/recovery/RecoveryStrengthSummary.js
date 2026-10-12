// Primary selected-week summary (#1305, #1315, #1318): `{total}% total recovery`
// plus ONE short caption (`{N} of {M} lifts back · avg {avg}% · Week {n}`). The
// wording comes from the single Recovery snapshot's `display`, so Home and the
// Overview row print the same thing. The cap/denominator, carried scores and the
// secondary consistent-cohort average are in the accessibility label and the
// "About these numbers" explainer. When no
// aggregate can be honest, a short reason is shown instead of a number.

import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { SNAPSHOT_STATE, STRENGTH_EMPTY_COPY } from '../../lib/data/recoverySnapshot';
import { createStrengthStyles } from './recoveryStrengthStyles';

export { STRENGTH_EMPTY_COPY };

export function RecoveryStrengthSummary({ display }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStrengthStyles(colors, kua), [colors, kua]);
  if (!display) return null;

  if (display.state !== SNAPSHOT_STATE.SCORE) {
    return (
      <View testID="recovery-strength-summary" style={styles.summary} accessible accessibilityLabel={display.a11y}>
        {display.weekLabel ? <Text style={styles.week}>{display.weekLabel}</Text> : null}
        <Text style={styles.caption}>{display.message}</Text>
      </View>
    );
  }
  return (
    <View testID="recovery-strength-summary" style={styles.summary} accessible accessibilityLabel={display.a11y}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 }}>
        <Text testID="recovery-strength-number" style={styles.number}>{`${display.percent}%`}</Text>
        <Text testID="recovery-strength-label" style={styles.numberLabel}>total recovery</Text>
      </View>
      <Text testID="recovery-strength-caption" style={styles.caption}>{display.caption}</Text>
    </View>
  );
}
