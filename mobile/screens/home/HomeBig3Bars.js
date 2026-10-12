import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';

// Squat / Bench / Deadlift as labelled bars (#1341), one shape for both the 1K
// card and the Recovery card so the two modes read as the same summary. Each
// row: name left, value right, an optional muted `age` beside the value, and a
// track filled to `fill` (0–100). Callers decide what the fill means; this
// component computes nothing.
export function HomeBig3Bars({ rows, idPrefix, testID }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  return (
    <View testID={testID} style={styles.liftList}>
      {rows.map(row => {
        const fill = Math.max(0, Math.min(row.fill || 0, 100));
        return (
          <View key={row.key} testID={`${idPrefix}-${row.key}`}>
            <View style={styles.liftHead}>
              <Text style={styles.liftName} numberOfLines={1}>{row.label}</Text>
              <View style={styles.liftValueRow}>
                {row.age ? (
                  <Text testID={`${idPrefix}-${row.key}-age`} style={styles.liftAge}>{row.age}</Text>
                ) : null}
                <Text testID={`${idPrefix}-${row.key}-value`} style={[styles.liftValue, row.strong && styles.liftValueStrong, row.done && styles.liftValueDone]}>
                  {row.value}
                </Text>
              </View>
            </View>
            <View style={styles.liftTrack}>
              {fill > 0 ? <View style={[styles.liftFill, row.done && styles.liftFillDone, { width: `${fill}%` }]} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
