import React, { useState, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle, LineChart } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { TYPOGRAPHY } from '../theme/typography';
import { useWeightUnit } from '../lib/unitPreference';
import { formatPaceElapsed } from '../lib/format';

// One insufficient-data treatment for both charts (#821). It replaces the bare
// "Not enough data", which named no threshold and offered nothing to do about
// it. Two weigh-ins is the real threshold: computeWeightRollingAverageSeries
// emits one point per weigh-in DATE, and LineChart needs two points to draw a
// line — so two weigh-ins on different days is exactly what turns this into a
// chart, for both the 7-day and the 30-day window.
function ChartEmptyState({ loading, onNavigate }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);

  if (loading) {
    return (
      <View style={styles.chartPlaceholder}>
        <ActivityIndicator size="small" color={kua ? kua.primary : colors.accent} />
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
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
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
                color={kua ? kua.primary : undefined}
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
                color={kua ? kua.primary : colors.textMuted}
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

export const createStyles = (colors, kua = null) => StyleSheet.create({
  sectionWrapper: {
    gap: 16,
  },
  weightCard: {
    padding: 20,
    gap: 16,
    backgroundColor: kua ? kua.surfaceCard : colors.panelBackground,
  },
  chartBlock: {
    gap: 4,
  },
  chartLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
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
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartEmpty: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
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
    color: kua ? kua.primary : colors.accentText,
  },
  weightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  weightLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  weightValueLarge: {
    ...(kua ? { ...TYPOGRAPHY['metric-display-mobile'], fontSize: 32, lineHeight: 36 } : { fontSize: 36, fontWeight: '800' }),
    color: kua ? kua.onSurface : colors.accentText,
  },
  weightUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.text,
    marginLeft: 4,
  },
  paceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  // Filled pace badges. In KUA mode the spike badge uses the semantic error
  // token (all 6 palettes). The notable badge has no KUA-mode filled-caution
  // surface, so it keeps the tuned legacy filled caution surface
  // (`cardCautionBg`) in both modes rather than the raw `caution` mark color —
  // that mark is a bright saturated yellow (dark #f2b94a) meant for a glyph,
  // and using it as a filled background under near-white `textLight` read as a
  // harsh, low-contrast pill in dark mode. `cardCautionBg` is the deep muted
  // amber the badge already showed in legacy mode. In legacy mode, both use the
  // filled-surface tones from #689.
  paceSpike: {
    backgroundColor: kua ? kua.error : colors.cardErrorBg,
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
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
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
    color: kua ? kua.onSurface : colors.text,
  },
  weightStatLabel: {
    fontSize: 11,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
