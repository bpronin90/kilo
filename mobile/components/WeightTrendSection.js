import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useKuaTypography, TYPOGRAPHY } from '../theme/typography';
import { WEIGHT_TONE, weightTrendTone } from '../lib/data/derivedAnalytics';

// The col3 color is the shared goal-aware tone (#1242): pace anomalies keep
// their fixed severity treatment; under a gain/loss goal, movement toward it is
// success and away is error; without one a bare ↑/↓ keeps a directional cue.
// Stable and missing data stay neutral. `styles` is passed in rather than
// closed over: the sheet is built per palette by the calling component (#689).
function toneStyle(tone, styles) {
  switch (tone) {
    case WEIGHT_TONE.SPIKE: return styles.paceSpike;
    case WEIGHT_TONE.NOTABLE: return styles.paceNotable;
    case WEIGHT_TONE.POSITIVE: return styles.trendPositive;
    case WEIGHT_TONE.NEGATIVE: return styles.trendNegative;
    case WEIGHT_TONE.GAINING: return styles.trendGaining;
    case WEIGHT_TONE.LOSING: return styles.trendLosing;
    default: return null;
  }
}

export function TrendSection({ title, col1, col2, col3, isLast, direction, paceLevel, goalDirection }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  const col3ColorStyle = toneStyle(weightTrendTone({ direction, goalDirection, paceLevel }), styles);

  return (
    <View style={[styles.trendSection, !isLast && styles.trendSectionDivider]}>
      <Text style={styles.trendSectionTitle}>{title}</Text>
      <View style={styles.trendGrid}>
        <View style={styles.trendGridItem}>
          <Text style={styles.trendLabel} numberOfLines={1}>{col1.label}</Text>
          <Text style={styles.trendValue} numberOfLines={1}>{col1.value}</Text>
        </View>
        <View style={styles.trendGridItem}>
          <Text style={styles.trendLabel} numberOfLines={1}>{col2.label}</Text>
          <Text style={styles.trendValue} numberOfLines={1}>{col2.value}</Text>
        </View>
        <View style={[styles.trendGridItem, styles.trendGridItemEnd]}>
          <Text style={[styles.trendLabel, styles.trendTextEnd]} numberOfLines={1}>{col3.label}</Text>
          <Text style={[styles.trendValue, styles.trendTextEnd, col3ColorStyle]} numberOfLines={1}>
            {col3.value}
          </Text>
          {!!col3.caption && (
            <Text style={[styles.trendCaption, styles.trendTextEnd, col3ColorStyle]}>
              {col3.caption}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const jbmFont = (typo, role, fallback) => {
  if (!typo) return { fontFamily: fallback };
  const { fontFamily, fontWeight } = typo[role];
  return fontWeight !== undefined ? { fontFamily, fontWeight } : { fontFamily };
};

const createStyles = (colors, kua = null, typo = null) => StyleSheet.create({
  trendSection: {
    padding: 16,
    gap: 12,
  },
  trendSectionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  trendSectionTitle: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trendGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  trendGridItem: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  trendGridItemEnd: {
    alignItems: 'flex-end',
  },
  trendTextEnd: {
    textAlign: 'right',
  },
  trendValue: {
    ...jbmFont(typo, 'metric-display', 'JetBrainsMono-Bold'),
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    color: kua ? kua.onSurface : colors.text,
  },
  // Secondary caption under the pace value (e.g. "over 5 days"). Its own line so
  // the elapsed span stays readable in the narrow trend column instead of being
  // truncated off the end of the value string.
  trendCaption: {
    ...jbmFont(typo, 'label-md', 'JetBrainsMono-Medium'),
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    marginTop: 2,
  },
  trendLabel: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paceSpike: {
    color: colors.error,
  },
  paceNotable: {
    color: colors.cautionText,
  },
  trendPositive: {
    color: colors.success,
  },
  trendNegative: {
    color: colors.error,
  },
  // No-goal directional fallback: gaining reads as a rise (error tone),
  // losing as a drop (success tone), matching the pre-goal-aware default.
  trendGaining: {
    color: colors.error,
  },
  trendLosing: {
    color: colors.success,
  },
});
