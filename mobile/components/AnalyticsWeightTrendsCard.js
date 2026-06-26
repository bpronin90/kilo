import React, { useState, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle, LineChart } from './UI';
import { Colors } from '../theme/colors';

export function AnalyticsWeightTrendsCard({
  handleWeightLayout,
  weightSummary,
  rolling7,
  rolling30,
  isWeightLoading,
}) {
  const [selectedPoint, setSelectedPoint] = useState(null);

  const byLabel7 = useMemo(() => {
    const m = {};
    rolling7.forEach(p => { m[p.label] = p; });
    return m;
  }, [rolling7]);

  const byLabel30 = useMemo(() => {
    const m = {};
    rolling30.forEach(p => { m[p.label] = p; });
    return m;
  }, [rolling30]);

  function handleSelect(point) {
    setSelectedPoint(point);
  }

  const display = useMemo(() => {
    if (!selectedPoint) return weightSummary;
    const label = selectedPoint.label;
    const p7 = byLabel7[label] ?? null;
    const p30 = byLabel30[label] ?? null;
    return {
      latestWeightValue: `${selectedPoint.value}`,
      showUnit: true,
      weightCount: weightSummary.weightCount,
      avg7: p7 ? `${p7.value.toFixed(1)} lb` : '—',
      avg30: p30 ? `${p30.value.toFixed(1)} lb` : '—',
      paceFlag: null,
      paceLevel: null,
      selectedDate: label,
    };
  }, [selectedPoint, weightSummary, byLabel7, byLabel30]);

  return (
    <View onLayout={handleWeightLayout}>
      <SectionTitle>Weight Trends</SectionTitle>
      <Card style={styles.weightCard}>
        <View style={styles.weightHeader}>
          <View>
            <Text style={styles.weightLabel}>
              {display.selectedDate ? `Selected · ${display.selectedDate}` : 'Latest weigh-in'}
            </Text>
            <Text style={styles.weightValueLarge}>
              {display.latestWeightValue}
              {display.showUnit && <Text style={styles.weightUnit}>lb</Text>}
            </Text>
          </View>
          {display.paceFlag && (
            <View style={[styles.paceBadge, display.paceLevel === 'spike' ? styles.paceSpike : styles.paceNotable]}>
              <Text style={styles.paceText}>
                {display.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.chartBlock}>
          <Text style={styles.chartLabel}>7-day rolling average</Text>
          <View style={styles.chartArea}>
            {rolling7.length > 1 ? (
              <LineChart data={rolling7} height={100} hideHeader onSelect={handleSelect} />
            ) : (
              <View style={styles.chartPlaceholder}>
                {isWeightLoading
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Text style={styles.chartEmpty}>Not enough data</Text>}
              </View>
            )}
          </View>
        </View>

        <View style={styles.chartBlock}>
          <Text style={styles.chartLabel}>30-day rolling average</Text>
          <View style={styles.chartArea}>
            {rolling30.length > 1 ? (
              <LineChart data={rolling30} height={100} hideHeader color={Colors.textMuted} onSelect={handleSelect} />
            ) : (
              <View style={styles.chartPlaceholder}>
                {isWeightLoading
                  ? <ActivityIndicator size="small" color={Colors.accent} />
                  : <Text style={styles.chartEmpty}>Not enough data</Text>}
              </View>
            )}
          </View>
        </View>

        <View style={styles.weightFooter}>
          <View style={styles.weightStat}>
            <Text style={styles.weightStatValue}>{display.avg7}</Text>
            <Text style={styles.weightStatLabel}>7-day avg</Text>
          </View>
          <View style={styles.weightStat}>
            <Text style={styles.weightStatValue}>{display.avg30}</Text>
            <Text style={styles.weightStatLabel}>30-day avg</Text>
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  weightCard: {
    padding: 20,
    gap: 16,
    backgroundColor: Colors.panelBackground,
  },
  chartBlock: {
    gap: 4,
  },
  chartLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chartArea: {
    height: 100,
    justifyContent: 'center',
  },
  chartPlaceholder: {
    height: 100,
    backgroundColor: Colors.subtleBg,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartEmpty: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  weightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  weightLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  weightValueLarge: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.accent,
  },
  weightUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginLeft: 4,
  },
  paceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  paceSpike: {
    backgroundColor: Colors.error,
  },
  paceNotable: {
    backgroundColor: Colors.caution,
  },
  paceText: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textLight,
  },
  weightFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    paddingTop: 16,
  },
  weightStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  weightStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  weightStatLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
