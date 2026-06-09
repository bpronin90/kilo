import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { HeroMetric } from './UI';

export function TrendSection({ title, col1, col2, col3, isLast, paceLevel }) {
  const isSpike = paceLevel === 'spike';
  const isNotable = paceLevel === 'notable';

  let col3ColorStyle = null;
  if (isSpike) col3ColorStyle = styles.paceSpike;
  else if (isNotable) col3ColorStyle = styles.paceNotable;
  else if (col3.value?.startsWith('↑')) col3ColorStyle = styles.trendGaining;
  else if (col3.value?.startsWith('↓')) col3ColorStyle = styles.trendLosing;

  return (
    <View style={[styles.trendSection, !isLast && styles.trendSectionDivider]}>
      <Text style={styles.trendSectionTitle}>{title}</Text>
      <View style={styles.trendGrid}>
        <View style={styles.trendGridItem}>
          <Text style={styles.trendLabel}>{col1.label}</Text>
          <Text style={styles.trendValue}>{col1.value}</Text>
        </View>
        <View style={styles.trendGridItem}>
          <Text style={styles.trendLabel}>{col2.label}</Text>
          <Text style={styles.trendValue}>{col2.value}</Text>
        </View>
        <View style={styles.trendGridItem}>
          <Text style={styles.trendLabel}>{col3.label}</Text>
          <Text style={[styles.trendValue, col3ColorStyle]}>
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
    justifyContent: 'space-between',
    gap: 12,
  },
  trendGridItem: {
    flex: 1,
    gap: 2,
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
  trendGaining: {
    color: Colors.error,
  },
  trendLosing: {
    color: Colors.success,
  },
});
