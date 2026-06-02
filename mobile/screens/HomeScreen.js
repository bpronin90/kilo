import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { ScreenShell } from '../components/ScreenShell';
import { Card, HeroMetric, LineChart, getSessionTone } from '../components/UI';
import { Colors } from '../theme/colors';
import { useWeightGoal, useTrackedLifts, getNoteSections } from '../hooks/useEntries';
import { normalizeExerciseKey, countWorkoutSessionsFromSections } from '../lib/parser';
import {
  deriveWeightGoalAnalytics,
  derive1kTotal,
  derive1kTotalSeries,
  DEFAULT_1K_EXERCISES,
  deriveWorkoutNoteAnalytics,
  deriveOverloadCounts,
  computeWeeklySummary,
} from '../lib/data';

// Home title wordmark. Source artwork: src/assets/brand/home-title.svg
function KiloWordmark({ width = 140, height = 48 }) {
  return (
    <View style={{ width, height, justifyContent: 'center', marginLeft: -8 }}>
      <Svg width="100%" height="100%" viewBox="0 0 303 106">
        {/* K */}
        <Rect x="8" y="9" width="7" height="88" rx="3.5" ry="3.5" fill={Colors.text} />
        <Path d="M 21 52 L 43 52 L 78 12 M 43 52 L 78 92" fill="none" stroke={Colors.text} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {/* I */}
        <Rect x="102" y="30" width="7" height="66" rx="3.5" ry="3.5" fill={Colors.text} />
        <Rect x="102" y="10" width="7" height="15" rx="3.5" ry="3.5" fill="#FF5C00" />
        {/* L */}
        <Path d="M 136.5 12.5 V 80.5 A 12 12 0 0 0 148.5 92.5 H 178.5" fill="none" stroke={Colors.text} strokeWidth="7" strokeLinecap="round" />
        {/* O (dot) */}
        <Rect x="187" y="89.5" width="16" height="7" rx="3.5" ry="3.5" fill="#FF5C00" />
        {/* O (circle) */}
        <Path d="M 251.5 11.5 C 282.7 11.5 290.5 19.7 290.5 52.5 C 290.5 85.3 282.7 93.5 251.5 93.5 C 220.3 93.5 212.5 85.3 212.5 52.5 C 212.5 19.7 220.3 11.5 251.5 11.5 Z" fill="none" stroke={Colors.text} strokeWidth="7" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}


export function HomeScreen({ weightEntries, workoutNote, notes, successMessage, onNavigate }) {
  const { goal: weightGoal } = useWeightGoal();
  const { trackedLifts } = useTrackedLifts();

  const allSections = useMemo(
    () => (notes || []).flatMap(n => getNoteSections(n)),
    [notes]
  );

  const dashboardData = useMemo(() => {
    let oneK = null;
    let oneKTrendColor = null;
    let sections = null;

    if (workoutNote?.raw_text) {
      sections = getNoteSections(workoutNote);

      const oneKSelections = {
        ...DEFAULT_1K_EXERCISES,
        ...(workoutNote?.one_k_exercises || {}),
      };
      oneK = derive1kTotal(sections, oneKSelections);

      // Trend color for the 1K outline: last vs prior session total (null until two).
      const series = derive1kTotalSeries(sections, oneKSelections);
      if (series.length >= 2) {
        const last = series[series.length - 1].total;
        const prev = series[series.length - 2].total;
        oneKTrendColor = last > prev ? Colors.success : last < prev ? Colors.error : Colors.caution;
      }
    }

    const { rollingSeries: weightSeries, trendSummary: weightTrends, goalInfo } = deriveWeightGoalAnalytics(weightEntries, weightGoal);
    const latestWeight = weightTrends.currentWeight;
    const { weeksIn } = deriveWorkoutNoteAnalytics(sections, []);

    // Mirror StatsScreen: derive signals for tracked exercises visible in the current note only.
    const namesInCurrent = new Set(
      (sections || []).flatMap(s => s.exercises.map(e => normalizeExerciseKey(e.name)))
    );
    const globallyTracked = Object.keys(trackedLifts || {}).filter(k => trackedLifts[k]);
    const visibleTrackedNames = globallyTracked.filter(
      name => namesInCurrent.has(normalizeExerciseKey(name))
    );
    const { signals, perDaySignals } = deriveWorkoutNoteAnalytics(allSections, visibleTrackedNames);
    const counts = deriveOverloadCounts(sections, signals, perDaySignals);

    const weeklySummary = computeWeeklySummary(sections, workoutNote);
    weeklySummary.classifications = counts;

    const sessionCount = countWorkoutSessionsFromSections(sections || []);

    return {
      weightSeries,
      oneK,
      oneKTrendColor,
      latestWeight,
      weeksIn,
      weeklySummary,
      sessionCount,
      goalInfo: goalInfo ? { ...goalInfo } : null,
    };
  }, [weightEntries, workoutNote, weightGoal, allSections, trackedLifts]);

  const weekTone = getSessionTone(dashboardData.sessionCount);
  const weekToneColor = weekTone === 'error' ? Colors.error
    : weekTone === 'warn' ? Colors.caution
    : weekTone === 'success' ? Colors.success
    : null;

  return (
    <ScreenShell
      title={<KiloWordmark />}
      subtitle="Current routine progress."
    >
      {/* ══ TIER 1: Weekly Summary ══ */}
      <Card style={styles.weeklyHero}>
        <View style={styles.heroContent}>
          {/* #2 inline week label */}
          <Text style={[styles.heroWeekLabel, weekToneColor ? { color: weekToneColor } : null]}>
            {dashboardData.weeksIn !== null ? `Week ${dashboardData.weeksIn}` : 'Week —'}
          </Text>

          <Text style={dashboardData.latestWeight ? styles.heroWeightValue : styles.heroWeightPlaceholder}>
            {dashboardData.latestWeight ? dashboardData.latestWeight : '—'}
            {dashboardData.latestWeight ? <Text style={styles.heroWeightUnit}> lb</Text> : null}
          </Text>

          {/* #4 sparkline strip below weight */}
          <View style={styles.heroSparklineStrip}>
            <LineChart
              data={dashboardData.weightSeries}
              color={Colors.textMuted}
              height={44}
              paddingHorizontal={0}
              hideHeader
            />
            <Text style={styles.heroSparklineSublabel}>7-day rolling avg</Text>
          </View>

          {/* Classification band */}
          <View style={styles.classifSection}>
            <View style={styles.classifSectionHeader}>
              <Text style={styles.classifSectionLabel}>Exercise Progress</Text>
            </View>
            <View style={styles.classifRow}>
              {[
                { label: 'Progressing', count: dashboardData.weeklySummary.classifications?.progressing ?? 0, color: Colors.success },
                { label: 'Steady', count: dashboardData.weeklySummary.classifications?.stalled ?? 0, color: Colors.caution },
                { label: 'Regressing', count: dashboardData.weeklySummary.classifications?.regressing ?? 0, color: Colors.error },
              ].map((item, idx) => (
                <View key={idx} style={styles.classifCol}>
                  <View style={[styles.classifDot, { backgroundColor: item.color }]} />
                  <Text style={styles.classifCount}>{item.count}</Text>
                  <Text style={styles.classifLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* #7 quiet CTA */}
          <View style={styles.heroFooter}>
            <Pressable onPress={() => onNavigate('Analytics')} style={styles.insightsLink}>
              <Text style={styles.insightsLinkText}>Full history and insights</Text>
              <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={Colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><Path d="M9 5l7 7-7 7" /></Svg>
            </Pressable>
          </View>
        </View>
      </Card>

      {/* ══ TIER 2: Weight Goal ══ */}
      {dashboardData.goalInfo ? (() => {
        const gi = dashboardData.goalInfo;
        const warnings = gi.warnings || [];
        const paceColor = warnings.includes('unrealistic') ? Colors.error
          : warnings.includes('unhealthy') ? Colors.caution
          : Colors.success;
        const modeLabel = gi.direction === 'loss' ? 'Cutting' : gi.direction === 'gain' ? 'Bulking' : 'Maintaining';
        return (
          <Card style={styles.goalCard}>
            <View style={styles.goalModeRow}>
              <Text style={styles.goalDirectionText}>
                Goal: <Text style={styles.goalModeAccent}>{modeLabel}</Text>
              </Text>
              <Text style={styles.goalWeeksText}>{Math.round(gi.weeks_remaining)} weeks left</Text>
            </View>
            <View style={styles.goalStatsGrid}>
              <View style={styles.goalStatCol}>
                <Text style={styles.goalStatLabel}>Target</Text>
                <View style={styles.goalStatValueRow}>
                  <Text style={styles.goalStatValueLarge}>{weightGoal?.target_weight}</Text>
                  <Text style={styles.goalStatUnitLabel}>lb</Text>
                </View>
              </View>
              <View style={styles.goalStatCol}>
                <Text style={styles.goalStatLabel}>Pace</Text>
                <View style={styles.goalStatValueRow}>
                  <Text style={[styles.goalStatValueLarge, { color: paceColor }]}>
                    {gi.required_weekly_pace > 0 ? '+' : ''}
                    {gi.required_weekly_pace.toFixed(1)}
                  </Text>
                  <Text style={[styles.goalStatUnitLabel, { color: paceColor }]}>lb/wk</Text>
                </View>
              </View>
            </View>
          </Card>
        );
      })() : null}

      {/* ══ TIER 3: 1k Club Progress ══ */}
      <Card style={styles.oneKCard}>
        <Text style={styles.oneKLabel}>1K Progress</Text>
        <Text style={[styles.oneKHeroValue, dashboardData.oneKTrendColor && { color: dashboardData.oneKTrendColor }]}>
          {dashboardData.oneK?.total ? `${dashboardData.oneK.total.toFixed(0)}` : '—'}
          <Text style={styles.oneKHeroUnit}> lb</Text>
        </Text>
        <View style={styles.progressBarLarge}>
          <View
            style={[
              styles.progressFillLarge,
              { width: `${Math.min(100, ((dashboardData.oneK?.total || 0) / 1000) * 100)}%` }
            ]}
          />
        </View>
        <View style={styles.oneKGrid}>
          <View style={styles.oneKGridItem}>
            <Text style={styles.oneKGridValue}>{dashboardData.oneK?.squat?.toFixed(0) || '—'}</Text>
            <Text style={styles.oneKGridLabel}>Squats</Text>
          </View>
          <View style={[styles.oneKGridItem, styles.oneKGridItemBorder]}>
            <Text style={styles.oneKGridValue}>{dashboardData.oneK?.bench?.toFixed(0) || '—'}</Text>
            <Text style={styles.oneKGridLabel}>Bench</Text>
          </View>
          <View style={styles.oneKGridItem}>
            <Text style={styles.oneKGridValue}>{dashboardData.oneK?.deadlift?.toFixed(0) || '—'}</Text>
            <Text style={styles.oneKGridLabel}>Deadlifts</Text>
          </View>
        </View>
      </Card>
    </ScreenShell>
  );
}
const styles = StyleSheet.create({
  weeklyHero: {
    padding: 0,
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginTop: 12,
  },
  heroContent: {
    padding: 24,
  },
  heroWeekLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 12,
  },
  heroWeightValue: {
    ...HeroMetric.hero,
    color: Colors.accent,
  },
  heroWeightPlaceholder: {
    ...HeroMetric.hero,
    fontWeight: '400',
    color: Colors.textMuted,
  },
  heroWeightUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  heroSparklineStrip: {
    marginTop: 8,
    marginBottom: 24,
  },
  heroSparklineSublabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'right',
    marginTop: 2,
  },
  classifSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    paddingTop: 16,
    marginBottom: 16,
  },
  classifSectionHeader: {
    marginBottom: 12,
  },
  classifSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  classifRow: {
    flexDirection: 'row',
  },
  classifCol: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  classifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  classifCount: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
  },
  classifLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 14,
  },
  heroFooter: {
    alignItems: 'center',
    marginTop: 12,
  },
  insightsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  insightsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  goalCard: {
    padding: 24,
    borderRadius: 24,
  },
  goalModeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  goalDirectionText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  goalModeAccent: {
    color: Colors.accent,
  },
  goalWeeksText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  goalStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  goalStatCol: {
    flex: 1,
    gap: 4,
  },
  goalStatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  goalStatValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  goalStatValueLarge: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.text,
  },
  goalStatUnitLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  oneKCard: {
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
  },
  oneKLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  oneKHero: {
    alignItems: 'center',
    marginBottom: 16,
  },
  oneKHeroValue: {
    ...HeroMetric.hero,
    color: Colors.text,
  },
  oneKHeroUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  progressBarLarge: {
    height: 8,
    backgroundColor: Colors.cardBorder,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 28,
    alignSelf: 'stretch',
  },
  progressFillLarge: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 6,
  },
  oneKGrid: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },
  oneKGridItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  oneKGridItemBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: Colors.cardBorder,
  },
  oneKGridValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
  },
  oneKGridLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  placeholderText: {
    fontSize: 48,
    color: Colors.textMuted,
    fontWeight: '400',
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    fontStyle: 'italic',
  },
});
