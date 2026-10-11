// Primary selected-week summary (#1305, hard-cut #1315): the average % of
// baseline strength plus ONE short caption (`{N} lifts · Week {n}`). The wording
// comes from the single Recovery snapshot's `display`, so Home and the Overview
// row print the same thing. Coverage, cohort names, exclusions and drops are in
// the accessibility label and the "About these numbers" explainer. When no
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
      <Text style={styles.number}>{`${display.percent}%`}</Text>
      <Text testID="recovery-strength-caption" style={styles.caption}>{display.caption}</Text>
    </View>
  );
}
