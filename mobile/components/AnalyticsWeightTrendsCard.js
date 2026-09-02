import React, { useState, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle, LineChart } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { useWeightUnit } from '../lib/unitPreference';
import { formatPaceElapsed } from '../lib/format';

// One insufficient-data treatment for both charts (#821). It replaces the bare
// "Not enough data", which named no threshold and offered nothing to do about
// it. Two weigh-ins is the real threshold: computeWeightRollingAverageSeries
// emits one point per weigh-in DATE, and LineChart needs two points to draw a
// line — so two weigh-ins on different days is exactly what turns this into a
// chart, for both the 7-day and the 30-day window.
function ChartEmptyState({ loading, onNavigate }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  if (loading) {
    return (
      <View style={styles.chartPlaceholder}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.chartPlaceholder}>
      <Text style={styles.chartEmpty}>Weigh in on two different days to see this trend.</Text>
      {!!onNavigate && (
        <Pressable
          testID="weight-trends-empty-log-link"
          onPress={() => onNavigate('Weight')}
          style={styles.chartEmptyAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Log a weigh-in"
          accessibilityHint="Opens the Weight tab"
        >
          <Text style={styles.chartEmptyActionText}>Log a weigh-in</Text>
        </Pressable>
      )}
    </View>
  );
}

export function AnalyticsWeightTrendsCard({
  handleWeightLayout,
  weightSummary,
  rolling7,
  rolling30,
  isWeightLoading,
  onNavigate,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // rolling7/rolling30 and weightSummary arrive already converted into display
  // space by AnalyticsScreen, so only the unit label is needed here.
  const unit = useWeightUnit();
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
      latestWeightValue: unit === 'kg' ? selectedPoint.value.toFixed(1) : `${selectedPoint.value}`,
      showUnit: true,
      weightCount: weightSummary.weightCount,
      avg7: p7 ? `${p7.value.toFixed(1)} ${unit}` : '—',
      avg30: p30 ? `${p30.value.toFixed(1)} ${unit}` : '—',
      paceFlag: null,
      paceLevel: null,
      paceElapsedDays: null,
      selectedDate: label,
    };
  }, [selectedPoint, weightSummary, byLabel7, byLabel30, unit]);

  return (
    <View onLayout={handleWeightLayout} style={styles.sectionWrapper}>
      <SectionTitle>Weight Trends</SectionTitle>
      <Card style={styles.weightCard}>
        <View style={styles.weightHeader}>
          <View>
            <Text style={styles.weightLabel}>
              {display.selectedDate ? `Selected · ${display.selectedDate}` : 'Latest weigh-in'}
            </Text>
            <Text style={styles.weightValueLarge}>
              {display.latestWeightValue}
              {display.showUnit && <Text style={styles.weightUnit}> {unit}</Text>}
            </Text>
          </View>
          {display.paceFlag && (
            <View style={[styles.paceBadge, display.paceLevel === 'spike' ? styles.paceSpike : styles.paceNotable]}>
              <Text style={styles.paceText}>
                {display.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
              </Text>
              <Text style={styles.pacePeriodText}>{formatPaceElapsed(display.paceElapsedDays)}</Text>
            </View>
          )}
        </View>

        <View style={styles.chartBlock}>
          <Text style={styles.chartLabel}>7-day rolling average</Text>
          <View style={styles.chartArea}>
            {rolling7.length > 1 ? (
              <LineChart
                data={rolling7}
                height={100}
                hideHeader
                showScale
                seriesLabel="7-day rolling average bodyweight"
                onSelect={handleSelect}
              />
            ) : (
              <ChartEmptyState loading={isWeightLoading} onNavigate={onNavigate} />
            )}
          </View>
        </View>

        <View style={styles.chartBlock}>
          <Text style={styles.chartLabel}>30-day rolling average</Text>
          <View style={styles.chartArea}>
            {rolling30.length > 1 ? (
              <LineChart
                data={rolling30}
                height={100}
                hideHeader
                showScale
                color={colors.textMuted}
                seriesLabel="30-day rolling average bodyweight"
                onSelect={handleSelect}
              />
            ) : (
              <ChartEmptyState loading={isWeightLoading} onNavigate={onNavigate} />
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

const createStyles = (colors) => StyleSheet.create({
  sectionWrapper: {
    gap: 16,
  },
  weightCard: {
    padding: 20,
    gap: 16,
    backgroundColor: colors.panelBackground,
  },
  chartBlock: {
    gap: 4,
  },
  chartLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // minHeight, not a fixed height: the insufficient-data state now carries copy
  // and a 44px action, and at a large font scale that is taller than the chart
  // it stands in for. A fixed 100 clipped it.
  chartArea: {
    minHeight: 100,
    justifyContent: 'center',
  },
  chartPlaceholder: {
    minHeight: 100,
    paddingVertical: 12,
    backgroundColor: colors.subtleBg,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartEmpty: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  chartEmptyAction: {
    marginTop: 8,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  chartEmptyActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentText,
  },
  weightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  weightLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  weightValueLarge: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.accentText,
  },
  weightUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginLeft: 4,
  },
  paceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  // Filled pace badges carrying a `textLight` label, so they use the error and
  // caution *surface* tones rather than the direct status colors (#689).
  paceSpike: {
    backgroundColor: colors.cardErrorBg,
  },
  paceNotable: {
    backgroundColor: colors.cardCautionBg,
  },
  paceText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textLight,
  },
  // States the elapsed span in words so the badge does not lean on color alone.
  pacePeriodText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textLight,
    textAlign: 'right',
    marginTop: 1,
  },
  weightFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
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
    color: colors.text,
  },
  weightStatLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
