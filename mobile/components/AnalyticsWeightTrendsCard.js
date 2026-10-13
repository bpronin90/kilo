import { GEOMETRY } from '../theme/spacing';
import React, { useState, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle, LineChart } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { TYPOGRAPHY } from '../theme/typography';
import { useWeightUnit } from '../lib/unitPreference';
import { formatPaceElapsed } from '../lib/format';
import { paceDirection, WEIGHT_TONE, weightPaceBadgeText, weightTrendTone } from '../lib/data/derivedAnalytics';

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
// already-derived prop to draw; it never merges or recomputes either series.
const WINDOWS = [
  { key: '7', short: '7D', label: '7-day rolling average' },
  { key: '30', short: '30D', label: '30-day rolling average' },
];

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
  const [windowKey, setWindowKey] = useState('7');
  const activeWindow = WINDOWS.find(w => w.key === windowKey);
  const activeSeries = windowKey === '30' ? rolling30 : rolling7;

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

  // The remounted chart starts unselected, so the header must too — otherwise
  // it would keep naming a point the visible series no longer highlights.
  function handleWindow(key) {
    if (key === windowKey) return;
    setWindowKey(key);
    setSelectedPoint(null);
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
      avg7: p7 ? `${p7.value.toFixed(1)} ${unit}` : 'N/A',
      avg30: p30 ? `${p30.value.toFixed(1)} ${unit}` : 'N/A',
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
          {display.paceFlag && (() => {
            // Direction and severity tone from the shared layer (#1242).
            const isSpike = weightTrendTone({ direction: paceDirection(display.paceFlag), paceLevel: display.paceLevel }) === WEIGHT_TONE.SPIKE;
            return (
              <View style={[styles.paceBadge, isSpike ? styles.paceSpike : styles.paceNotable]}>
                <Text style={[styles.paceText, !isSpike && styles.paceTextNotable]}>
                  {weightPaceBadgeText(paceDirection(display.paceFlag))}
                </Text>
                <Text style={[styles.pacePeriodText, !isSpike && styles.paceTextNotable]}>
                  {formatPaceElapsed(display.paceElapsedDays)}
                </Text>
              </View>
            );
          })()}
        </View>

        <View style={styles.chartBlock}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartLabel}>{activeWindow.label}</Text>
            <View style={styles.windowToggle} accessibilityRole="radiogroup" accessibilityLabel="Rolling average window">
              {WINDOWS.map(w => {
                const selected = w.key === windowKey;
                return (
                  <Pressable
                    key={w.key}
                    testID={`weight-trends-window-${w.key}`}
                    onPress={() => handleWindow(w.key)}
                    style={[styles.windowOption, selected && styles.windowOptionSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={w.label}
                  >
                    <Text style={[styles.windowOptionText, selected && styles.windowOptionTextSelected]} accessible={false}>
                      {w.short}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.chartArea}>
            {activeSeries.length > 1 ? (
              <LineChart
                key={windowKey}
                data={activeSeries}
                height={100}
                hideHeader
                showScale
                color={kua ? kua.primary : undefined}
                seriesLabel={`${activeWindow.label} bodyweight`}
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
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  windowToggle: {
    flexDirection: 'row',
    gap: 4,
  },
  // Rule 15: grow the box to the 44dp floor rather than lean on hitSlop.
  windowOption: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: GEOMETRY['radius-lg'],
  },
  windowOptionSelected: {
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
  },
  windowOptionText: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  windowOptionTextSelected: {
    color: kua ? kua.primary : colors.accentText,
  },
  chartLabel: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
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
    borderRadius: GEOMETRY['radius-lg'],
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartEmpty: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
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
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.primary : colors.accentText,
  },
  weightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  weightLabel: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  weightValueLarge: {
    // display exception per #1283 foundation
    ...(kua ? { ...TYPOGRAPHY['metric-display-mobile'], fontSize: 32, lineHeight: 36 } : { fontSize: TYPOGRAPHY['metric-display'].fontSize, fontWeight: '800' }),
    color: kua ? kua.onSurface : colors.accentText,
  },
  weightUnit: {
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.text,
    marginLeft: 4,
  },
  paceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: GEOMETRY['radius-xl'],
  },
  // Pace badges. The spike badge stays a loud saturated fill (KUA `error` in all
  // six palettes, `cardErrorBg` legacy) with light text. The notable badge is a
  // step quieter: the mode-adaptive soft caution *container* (`cautionSurface`
  // with its paired `cautionSurfaceText` ink, both AA-tuned and asserted in
  // theme-rendering) — pale amber + dark ink in light mode, dark warm brown +
  // bright amber ink in dark mode. This replaces two earlier misfires: the raw
  // `caution` mark as a fill (a harsh 1.57:1 glyph-yellow in dark mode) and the
  // `cardCautionBg` filled tone (a dark amber that barely differed between light
  // and dark). No KUA-mode caution container token exists, so the notable badge
  // is court-neutral but mode-aware.
  paceSpike: {
    backgroundColor: kua ? kua.error : colors.cardErrorBg,
  },
  paceNotable: {
    backgroundColor: colors.cautionSurface,
  },
  paceText: {
    ...(kua ? TYPOGRAPHY['label-md'] : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '800' }),
    color: colors.textLight,
  },
  // Notable badge ink: the on-surface pair for `cautionSurface`, so the label
  // reads in both modes (dark amber on the pale light surface, bright amber on
  // the dark surface) instead of the near-white `textLight` the filled spike
  // badge uses.
  paceTextNotable: {
    color: colors.cautionSurfaceText,
  },
  // States the elapsed span in words so the badge does not lean on color alone.
  pacePeriodText: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
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
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  weightStatLabel: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
