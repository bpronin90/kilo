import { GEOMETRY } from '../theme/spacing';
import React, { useState, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LineChart } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { TYPOGRAPHY, TYPOGRAPHY_FALLBACK, useKuaTypography } from '../theme/typography';
import { useWeightUnit } from '../lib/unitPreference';
import { formatDate } from '../lib/format';
import { displayChartSeries, formatGoalWeightValue } from '../lib/units';
import { formatTrendDeltaValue } from '../lib/WeightScreenHelpers';
import { weightDirection, weightTrendTone } from '../lib/data/derivedAnalytics';
import { BodyweightPanel } from './analyticsWeight/BodyweightPanel';
import { BodyweightStats } from './analyticsWeight/BodyweightStats';
import { buildWeighInPoints } from './lineChart/weightChartPresentation';

// One insufficient-data treatment for either window (#821). It replaces the bare
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

// One chart, two canonical series (#1349). The toggle only picks which
// already-derived rolling-average line to draw; it never merges or recomputes
// either series, and (#1603) never changes the weigh-ins or the date range.
const WINDOWS = [
  { key: '7', short: '7D AVG', label: '7-day rolling average', days: 7 },
  { key: '30', short: '30D AVG', label: '30-day rolling average', days: 30 },
];

const noop = () => {};

// Analytics > Bodyweight (Redesign v3, #1603). `entries` are the usable
// weigh-ins (canonical lb), `trends` the canonical trend summary and
// `goalContext` the verified active goal (null for no goal, an ended goal or a
// goal that could not be read), all from AnalyticsScreen's existing derivations.
// rolling7/rolling30 arrive in display space, one point per weigh-in date.
export function AnalyticsWeightTrendsCard({
  handleWeightLayout,
  weightSummary,
  rolling7,
  rolling30,
  isWeightLoading,
  onNavigate,
  entries = null,
  trends = null,
  goalContext = null,
}) {
  const { kuaPalette: kua, colors } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  const unit = useWeightUnit();
  const [windowKey, setWindowKey] = useState('7');
  const activeWindow = WINDOWS.find(w => w.key === windowKey);
  const activeSeries = windowKey === '30' ? rolling30 : rolling7;

  // Changing the window remounts the chart (key below), which drops its
  // selection: an average line the point was read against no longer exists.
  function handleWindow(key) {
    if (key !== windowKey) setWindowKey(key);
  }

  const plot = useMemo(() => {
    if (!entries || entries.length === 0 || activeSeries.length < 2) return null;
    const { points, line } = buildWeighInPoints({ entries, series: activeSeries, windowDays: activeWindow.days, unit });
    if (points.length < 2) return null;
    const goal = goalContext && Number.isFinite(goalContext.target)
      ? { value: displayChartSeries([{ value: goalContext.target, unit: 'lb' }], unit)[0].value, text: formatGoalWeightValue(goalContext.target, unit) }
      : null;
    return { points, line, goal, windowLabel: activeWindow.label };
  }, [entries, activeSeries, activeWindow, unit, goalContext]);

  const latestDate = useMemo(() => {
    const newest = (entries || []).reduce((acc, e) => (e && e.date && (!acc || e.date > acc) ? e.date : acc), null);
    return newest ? formatDate(newest) : null;
  }, [entries]);

  // Change vs the previous weigh-in day: the same pair of local-date values as
  // the Weight tab's Latest panel (#947), toned by production's goal-aware rule.
  const change = useMemo(() => {
    if (!trends) return null;
    const direction = weightDirection(trends.recentDateWeight ?? null, trends.priorDateWeight ?? null);
    const text = formatTrendDeltaValue(trends.recentDateWeight ?? null, trends.priorDateWeight ?? null, unit);
    if (text === '-') return null;
    const tone = weightTrendTone({
      direction,
      goalDirection: goalContext ? goalContext.direction : null,
      paceLevel: weightSummary.paceLevel ?? null,
    });
    return { text, direction, tone };
  }, [trends, unit, goalContext, weightSummary.paceLevel]);

  const count = plot ? plot.points.length : 0;
  const stroke = kua ? (kua.chartSeries1 || kua.primary) : colors.accent;

  return (
    <View onLayout={handleWeightLayout}>
      <BodyweightPanel
        summary={weightSummary}
        unit={unit}
        latestDate={latestDate}
        change={change}
        windows={WINDOWS}
        windowKey={windowKey}
        onWindow={handleWindow}
        onNavigate={onNavigate}
        styles={styles}
        stats={(
          <BodyweightStats
            trends={trends}
            goalContext={goalContext}
            currentWeight={trends ? trends.currentWeight : null}
            unit={unit}
            styles={styles}
          />
        )}
      >
        {activeSeries.length > 1 ? (
          <>
            <LineChart
              key={windowKey}
              data={activeSeries}
              weightPlot={plot}
              height={plot ? 150 : 100}
              hideHeader
              showScale
              showGrid
              color={stroke}
              seriesLabel={`${activeWindow.label} bodyweight`}
              onSelect={noop}
            />
            {plot ? (
              <Text style={styles.caption} testID="bodyweight-caption">
                {`${count} ${count === 1 ? 'weigh-in' : 'weigh-ins'} at recorded dates \u00b7 Line: ${activeWindow.label} \u00b7 Ring: latest weigh-in`}
              </Text>
            ) : null}
          </>
        ) : (
          <ChartEmptyState loading={isWeightLoading} onNavigate={onNavigate} />
        )}
      </BodyweightPanel>
    </View>
  );
}

export const createStyles = (colors, kua = null, typo = null) => {
  const role = (name) => (typo || TYPOGRAPHY_FALLBACK)[name];
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const ink = kua ? kua.onSurface : colors.text;
  const hairline = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    headerMain: {
      flexShrink: 1,
      minWidth: 0,
      paddingTop: 4,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    weightValueLarge: {
      ...role('metric-display'),
      fontSize: 36,
      lineHeight: 40,
      letterSpacing: -0.03 * 36,
      color: ink,
    },
    unit: {
      ...role('label-lg'),
      color: muted,
      marginLeft: 3,
    },
    // Radio group: two >=44dp options inside one hairline frame.
    toggle: {
      flexDirection: 'row',
      padding: 2,
      gap: 2,
      borderWidth: 1,
      borderColor: hairline,
      borderRadius: GEOMETRY['radius-lg'],
    },
    toggleOption: {
      minHeight: 44,
      minWidth: 56,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: GEOMETRY['radius-md'],
    },
    toggleOptionSelected: {
      backgroundColor: kua ? kua.surfaceCardHeader : colors.subtleBg,
      borderWidth: 1,
      borderColor: hairline,
    },
    toggleText: {
      ...role('label-md'),
      textTransform: 'uppercase',
      color: muted,
    },
    toggleTextSelected: {
      color: ink,
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: 6,
      rowGap: 6,
      paddingHorizontal: 16,
      paddingTop: 2,
    },
    changeLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    metaText: {
      ...role('label-md'),
      fontSize: 13,
      lineHeight: 18,
      color: muted,
    },
    chartSection: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 14,
    },
    paceBadge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: GEOMETRY['radius-xl'],
    },
    // Spike stays the loud saturated fill; notable is the mode-aware caution
    // container (same pairing as before the redesign, #941/#1242).
    paceSpike: {
      backgroundColor: kua ? kua.error : colors.cardErrorBg,
    },
    paceNotable: {
      backgroundColor: colors.cautionSurface,
    },
    paceText: {
      ...role('label-md'),
      color: colors.textLight,
    },
    paceTextNotable: {
      color: colors.cautionSurfaceText,
    },
    // States the elapsed span in words so the badge does not lean on color alone.
    pacePeriodText: {
      ...role('label-sm'),
      color: colors.textLight,
      marginTop: 1,
    },
    // Averages / goal split under the chart (BodyweightStats).
    weightCard: {
      backgroundColor: kua ? kua.surfaceCard : colors.panelBackground,
    },
    weightFooter: {
      borderTopWidth: 1,
      borderTopColor: hairline,
    },
    row: {
      flexDirection: 'row',
    },
    rowDivider: {
      borderTopWidth: 1,
      borderTopColor: hairline,
    },
    cell: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 4,
    },
    cellDivider: {
      borderLeftWidth: 1,
      borderLeftColor: hairline,
    },
    weightStatLabel: {
      ...role('label-md'),
      textTransform: 'uppercase',
      color: muted,
    },
    cellValueRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      columnGap: 8,
    },
    weightStatValue: {
      ...role('label-lg'),
      fontSize: 17,
      lineHeight: 22,
      color: ink,
    },
    cellUnit: {
      ...role('label-md'),
      color: muted,
    },
    cellNote: {
      ...role('body-sm'),
      color: muted,
    },
    caption: {
      ...role('body-sm'),
      color: muted,
      marginTop: 2,
    },
    // minHeight, not a fixed height: the insufficient-data state carries copy
    // and a 44px action, and at a large font scale that is taller than the
    // chart it stands in for. A fixed 100 clipped it.
    chartPlaceholder: {
      minHeight: 100,
      paddingVertical: 12,
      backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
      borderRadius: GEOMETRY['radius-lg'],
      justifyContent: 'center',
      alignItems: 'center',
    },
    chartEmpty: {
      fontSize: TYPOGRAPHY['body-sm'].fontSize,
      color: muted,
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
      fontSize: TYPOGRAPHY['body-sm'].fontSize,
      fontWeight: '600',
      color: kua ? kua.primary : colors.accentText,
    },
  });
};
