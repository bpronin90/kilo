import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';

// Squat / Bench / Deadlift as labelled bars (#1341, #1353): one shape for Home's
// 1K card, Home's Recovery card and the Analytics Recovery summary, so every
// surface reads as the same summary. Each row: name left, value right, an
// optional muted `age` beside the value, and a track filled to `fill` (0–100).
// Callers decide what the fill means; this component computes nothing.
export function Big3Bars({ rows, idPrefix, testID }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createBig3BarStyles(colors, kua, typography), [colors, kua, typography]);
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

export const createBig3BarStyles = (colors, kua = null, typography = TYPOGRAPHY) => StyleSheet.create({
  liftList: {
    gap: 12,
  },
  liftHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    columnGap: 8,
    marginBottom: 4,
  },
  liftName: {
    ...(kua ? typography['label-lg'] : { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
    flexShrink: 1,
  },
  liftValueRow: {
    flexDirection: 'row', alignItems: 'baseline', columnGap: 6, flexShrink: 0,
  },
  liftAge: {
    ...(kua ? typography['label-sm'] : { fontSize: TYPOGRAPHY['label-sm'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  liftValue: {
    ...(kua ? typography['label-md'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  liftValueStrong: {
    ...(kua ? typography['label-lg'] : { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  liftValueDone: {
    color: kua ? kua.completion : colors.success,
  },
  liftTrack: {
    height: 6,
    borderRadius: GEOMETRY['radius-xs'],
    overflow: 'hidden',
    backgroundColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  liftFill: {
    height: 6,
    borderRadius: GEOMETRY['radius-xs'],
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  liftFillDone: {
    backgroundColor: kua ? kua.completion : colors.success,
  },
});
