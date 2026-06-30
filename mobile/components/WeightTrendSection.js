import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { HeroMetric } from './UI';

// Resolve the col3 trend color.
// Pace anomalies (spike/notable) are severity badges and keep their fixed
// error/caution treatment. Otherwise the success/error meaning of a trend
// direction depends on the user's goal: an upward trend is success for a gain
// goal but error for a loss goal, and vice versa. When there is no goal
// direction the semantics are ambiguous, so we fall back to neutral text and
// reserve red/green for cases where it is actually meaningful.
function resolveCol3ColorStyle({ value, paceLevel, goalDirection }) {
  if (paceLevel === 'spike') return styles.paceSpike;
  if (paceLevel === 'notable') return styles.paceNotable;

  if (goalDirection === 'gain' || goalDirection === 'loss') {
    if (value?.startsWith('↑')) {
      return goalDirection === 'gain' ? styles.trendPositive : styles.trendNegative;
    }
    if (value?.startsWith('↓')) {
      return goalDirection === 'loss' ? styles.trendPositive : styles.trendNegative;
    }
  }

  // Ambiguous (no goal) or stable (→): neutral, no success/error meaning.
  return null;
}

export function TrendSection({ title, col1, col2, col3, isLast, paceLevel, goalDirection }) {
  const col3ColorStyle = resolveCol3ColorStyle({ value: col3.value, paceLevel, goalDirection });

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
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trendSection: {
    padding: 16,
    gap: 12,
  },
  trendSectionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  trendSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
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
    ...HeroMetric.statTertiary,
    color: Colors.text,
  },
  trendLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paceSpike: {
    color: Colors.error,
  },
  paceNotable: {
    color: Colors.caution,
  },
  trendPositive: {
    color: Colors.success,
  },
  trendNegative: {
    color: Colors.error,
  },
});
