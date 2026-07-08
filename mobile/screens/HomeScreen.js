import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { ScreenShell } from '../components/ScreenShell';
import { Card, HeroMetric, LineChart, getSessionTone, Button } from '../components/UI';
import { Colors } from '../theme/colors';
import { useWeightGoal, useTrackedLifts, getNoteSections } from '../hooks/useEntries';
import { deriveHomeDashboardData } from './home/homeDashboardData';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue, displayChartSeries } from '../lib/units';

function lerpColor(a, b, t) {
  const p = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const [ar,ag,ab] = p(a), [br,bg,bb] = p(b);
  return `rgb(${Math.round(ar+(br-ar)*t)},${Math.round(ag+(bg-ag)*t)},${Math.round(ab+(bb-ab)*t)})`;
}

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

function BarbellIcon({ color = Colors.accent, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 4v16M6 4v16M2 8v8M22 8v8M6 12h12" />
    </Svg>
  );
}

function ScaleIcon({ color = Colors.accent, size = 22 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 6h18M12 6v14M12 20H9m3 0h3M5 6l3 8h8l3-8" />
    </Svg>
  );
}

export function HomeScreen({ weightEntries, workoutNote, notes, successMessage, onNavigate, loading }) {
  const { goal: weightGoal, loading: goalLoading } = useWeightGoal();
  const { trackedLifts, loading: trackedLiftsLoading } = useTrackedLifts();
  const unit = useWeightUnit();

  const noteSectionsList = useMemo(
    () => (notes || []).map(n => getNoteSections(n)),
    [notes]
  );

  const allSections = useMemo(
    () => noteSectionsList.flat(),
    [noteSectionsList]
  );

  const dashboardData = useMemo(
    () => deriveHomeDashboardData({ weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, trackedLifts }),
    [weightEntries, workoutNote, weightGoal, allSections, noteSectionsList, trackedLifts]
  );

  const weekTone = getSessionTone(dashboardData.sessionCount);
  const weekToneColor = weekTone === 'error' ? Colors.error
    : weekTone === 'warn' ? Colors.caution
    : weekTone === 'success' ? Colors.success
    : null;

  // Gate the whole first paint on every data source Home renders, not just
  // weight/notes: weight goal and tracked lifts feed the dashboard too, so
  // including their loading prevents those sections from popping in after
  // first paint.
  const isLoading = loading || goalLoading || trackedLiftsLoading;

  const isEmptyState = useMemo(() => {
    if (isLoading) return false;
    const hasTrackedLifts = trackedLifts && Object.values(trackedLifts).some(Boolean);
    return (!weightEntries || weightEntries.length === 0) &&
           (!notes || notes.length === 0) &&
           (!workoutNote?.raw_text || !workoutNote.raw_text.trim()) &&
           !weightGoal &&
           !hasTrackedLifts;
  }, [isLoading, weightEntries, notes, workoutNote, weightGoal, trackedLifts]);

  return (
    <ScreenShell
      title={<KiloWordmark />}
      subtitle="Current routine progress."
    >
      {isLoading ? null : isEmptyState ? (
        <Card style={styles.welcomeCard}>
          <View style={styles.welcomeHeader}>
            <Text style={styles.welcomeTitle}>Welcome to Kilo</Text>
            <Text style={styles.welcomeSubtitle}>
              Your strength journal and body weight tracker. Let's get started with your routine.
            </Text>
          </View>

          <View style={styles.welcomeDivider} />

          <View style={styles.welcomeStep}>
            <View style={styles.welcomeStepHeader}>
              <View style={styles.welcomeIconContainer}>
                <BarbellIcon />
              </View>
              <View style={styles.welcomeStepTextContainer}>
                <Text style={styles.welcomeStepTitle}>1. Log a Workout</Text>
                <Text style={styles.welcomeStepDesc}>
                  Write sets in plain text (e.g. "Squat: 315x5, 315x5"). Kilo automatically parses and tracks your volume.
                </Text>
              </View>
            </View>
            <Button
              title="Log Workout"
              onPress={() => onNavigate('Log')}
              style={styles.welcomeButton}
            />
          </View>

          <View style={styles.welcomeStep}>
            <View style={styles.welcomeStepHeader}>
              <View style={styles.welcomeIconContainer}>
                <ScaleIcon />
              </View>
              <View style={styles.welcomeStepTextContainer}>
                <Text style={styles.welcomeStepTitle}>2. Track Weight & Goals</Text>
                <Text style={styles.welcomeStepDesc}>
                  Set a target weight and log entries to visualize your 7-day average trend and weekly pace.
                </Text>
              </View>
            </View>
            <Button
              title="Log Weight"
              onPress={() => onNavigate('Weight')}
              style={styles.welcomeButton}
            />
          </View>
        </Card>
      ) : (
        <>
          {/* ══ TIER 1: Weekly Summary ══ */}
          <Card style={styles.weeklyHero}>
            {/* #2 inline week label */}
            <Text style={[styles.heroWeekLabel, weekToneColor ? { color: weekToneColor } : null]}>
              {dashboardData.weeksIn !== null ? `Week ${dashboardData.weeksIn}` : 'Week —'}
            </Text>

            <Text style={dashboardData.latestWeight ? styles.heroWeightValue : styles.heroWeightPlaceholder}>
              {dashboardData.latestWeight ? formatBodyweightValue(dashboardData.latestWeight, unit) : '—'}
              {dashboardData.latestWeight ? <Text style={styles.heroWeightUnit}> {unit}</Text> : null}
            </Text>

            {/* #4 sparkline strip below weight */}
            <View style={styles.heroSparklineStrip}>
              <LineChart
                data={displayChartSeries(dashboardData.weightSeries, unit)}
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
                  <Text style={styles.goalWeeksText}>
                    {gi.isOverdue ? 'Goal ended' : `${Math.round(gi.weeks_remaining)} weeks left`}
                  </Text>
                </View>
                <View style={styles.goalStatsGrid}>
                  <View style={styles.goalStatCol}>
                    <Text style={styles.goalStatLabel}>Target</Text>
                    <View style={styles.goalStatValueRow}>
                      <Text style={styles.goalStatValueLarge}>{weightGoal?.target_weight != null ? formatBodyweightValue(weightGoal.target_weight, unit) : weightGoal?.target_weight}</Text>
                      <Text style={styles.goalStatUnitLabel}>{unit}</Text>
                    </View>
                  </View>
                  <View style={styles.goalStatCol}>
                    <Text style={styles.goalStatLabel}>Pace</Text>
                    <View style={styles.goalStatValueRow}>
                      <Text style={[styles.goalStatValueLarge, { color: paceColor }]}>
                        {gi.required_weekly_pace !== null ? (
                          `${gi.required_weekly_pace > 0 ? '+' : ''}${displayWeight(gi.required_weekly_pace, unit).toFixed(1)}`
                        ) : (
                          '—'
                        )}
                      </Text>
                      <Text style={[styles.goalStatUnitLabel, { color: paceColor }]}>{unit}/wk</Text>
                    </View>
                  </View>
                </View>
              </Card>
            );
          })() : null}

          {/* ══ TIER 3: 1k Club Progress ══ */}
          <Card style={styles.oneKCard}>
            <Text style={styles.oneKLabel}>1K Progress</Text>
            <Text style={[styles.oneKHeroValue, { color: lerpColor(Colors.accent, Colors.success, Math.min(1, (dashboardData.oneK?.total || 0) / 1000)) }]}>
              {dashboardData.oneK?.total ? `${displayWeight(dashboardData.oneK.total, unit).toFixed(0)}` : '—'}
              <Text style={styles.oneKHeroUnit}> {unit}</Text>
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
                <Text style={styles.oneKGridValue}>{dashboardData.oneK?.squat != null ? displayWeight(dashboardData.oneK.squat, unit).toFixed(0) : '—'}</Text>
                <Text style={styles.oneKGridLabel}>Squats</Text>
              </View>
              <View style={[styles.oneKGridItem, styles.oneKGridItemBorder]}>
                <Text style={styles.oneKGridValue}>{dashboardData.oneK?.bench != null ? displayWeight(dashboardData.oneK.bench, unit).toFixed(0) : '—'}</Text>
                <Text style={styles.oneKGridLabel}>Bench</Text>
              </View>
              <View style={styles.oneKGridItem}>
                <Text style={styles.oneKGridValue}>{dashboardData.oneK?.deadlift != null ? displayWeight(dashboardData.oneK.deadlift, unit).toFixed(0) : '—'}</Text>
                <Text style={styles.oneKGridLabel}>Deadlifts</Text>
              </View>
            </View>
          </Card>
        </>
      )}
    </ScreenShell>
  );
}
const styles = StyleSheet.create({
  weeklyHero: {
    padding: 24,
    gap: 0,
    marginTop: 12,
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
  welcomeCard: {
    padding: 24,
    marginTop: 12,
  },
  welcomeHeader: {
    marginBottom: 8,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
    marginTop: 6,
  },
  welcomeDivider: {
    height: 1,
    backgroundColor: Colors.cardBorder,
    marginVertical: 16,
  },
  welcomeStep: {
    marginBottom: 20,
  },
  welcomeStepHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  welcomeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.8,
  },
  welcomeStepTextContainer: {
    flex: 1,
  },
  welcomeStepTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  welcomeStepDesc: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  welcomeButton: {
    borderRadius: 14,
    paddingVertical: 12,
  },
});
