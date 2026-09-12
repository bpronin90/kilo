import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card, LineChart } from '../../components/UI';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { useWeightUnit } from '../../lib/unitPreference';
import { formatBodyweightValue, displayChartSeries } from '../../lib/units';
import { createStyles } from './homeStyles';

// Tier 1 weekly-summary hero, extracted from HomeScreen (#1049). Presentation
// only: every value it renders is computed by HomeScreen and passed in, so the
// first-paint gate and dashboard math stay in one place.
export function HomeHeader({
  dashboardData,
  onNavigate,
  isRecoveryOpenWeek,
  isRecoveryBetweenWeeks,
  activeTrainingContext,
  weekToneColor,
  hasWeightSeries,
  baselinePaused,
  handleLogWorkoutPress,
  heroPrimaryActionLabel,
  heroPrimaryActionHint,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();

  return (
    <Card style={styles.weeklyHero}>
      {/* #2 inline week label. The two primary daily-loop actions live in
          one stable row below the hero state instead of being scattered
          beside the values they act on (#717 review). */}
      <View style={styles.heroWeekRow}>
        {isRecoveryOpenWeek || isRecoveryBetweenWeeks ? (
          <>
            <Text style={[styles.heroWeekLabel, styles.heroWeekLabelRecovery]}>
              {isRecoveryOpenWeek
                ? `Recovery · Week ${activeTrainingContext.recoveryWeekNumber ?? '—'}`
                : 'Recovery · Between weeks'}
            </Text>
            {isRecoveryOpenWeek && activeTrainingContext.activeNote ? (
              <Text testID="home-recovery-active-note" style={styles.heroRecoveryNoteLabel}>
                {activeTrainingContext.activeNote.title || 'Untitled'}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={[styles.heroWeekLabel, weekToneColor ? { color: weekToneColor } : null]}>
            {dashboardData.weeksIn !== null ? `Week ${dashboardData.weeksIn}` : 'Week —'}
          </Text>
        )}
      </View>

      {/* The hero metric stays a plain, non-pressable value (§8). With no
          weigh-in yet the slot reads as a short muted sentence instead of
          a bare dash over dead space. */}
      <View style={styles.heroWeightRow}>
        {dashboardData.latestWeight ? (
          <Text style={styles.heroWeightValue}>
            {formatBodyweightValue(dashboardData.latestWeight, unit)}
            <Text style={styles.heroWeightUnit}> {unit}</Text>
          </Text>
        ) : (
          <Text style={styles.heroWeightPlaceholder}>No weigh-in yet</Text>
        )}
      </View>

      <View style={styles.heroPrimaryActions}>
        <Pressable
          testID="home-current-routine-link"
          onPress={handleLogWorkoutPress}
          style={styles.heroPrimaryAction}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel={heroPrimaryActionLabel}
          accessibilityHint={heroPrimaryActionHint}
        >
          <Text style={styles.heroPrimaryActionText}>{heroPrimaryActionLabel}</Text>
          <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
        </Pressable>

        <View style={styles.heroPrimaryActionDivider} />

        <Pressable
          testID="home-weight-action"
          onPress={() => onNavigate('Weight')}
          style={styles.heroPrimaryAction}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel="Log weight"
          accessibilityHint="Opens the Weight tab to log a weigh-in"
        >
          <Text style={styles.heroPrimaryActionText}>Log weight</Text>
          <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
        </Pressable>
      </View>

      {/* #4 sparkline strip below weight. LineChart owns its own Pressable
          for point selection, so the Analytics-weight handoff is a separate
          explicit control beneath the chart — one press owner per region,
          no nested responders. The chart caption stays a plain caption; the
          handoff reads as an action ("See weight trends") so it is not
          mistaken for chart furniture (#717 review). */}
      <View style={styles.heroSparklineStrip}>
        {/* With no weigh-ins there is no trend to draw, so the caption and
            the chart's own "Not enough data" placeholder are suppressed
            rather than left as dead space in the primary card. The handoff
            itself stays available. */}
        {hasWeightSeries ? (
          <>
            <Text style={styles.heroSparklineSublabel}>7-day rolling avg</Text>
            <LineChart
              data={displayChartSeries(dashboardData.weightSeries, unit)}
              color={colors.textMuted}
              height={44}
              paddingHorizontal={0}
              hideHeader
            />
          </>
        ) : null}
        <Pressable
          testID="home-weight-trend-link"
          onPress={() => onNavigate('Analytics', 'weight')}
          style={styles.heroInlineAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="See weight trends"
          accessibilityHint="Opens the weight section of the Analytics tab"
        >
          <Text style={styles.heroInlineActionText}>See weight trends</Text>
          <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
        </Pressable>
      </View>

      {/* Classification band — handoff to Analytics' Progressive Overload
          table (#717, retargeted in #770). The counts under this header
          ARE the per-exercise progressing/steady/regressing classification,
          and that table is where they are itemized, so `strength` (the 1K
          block, higher up the tab) was landing short of what the label
          promises. Only the header row is the press target: the counts
          beneath are data, not a control, so making the whole band
          tappable was too much clickable area. The affordance is the plain
          chevron already used by `Full history and insights` on this same
          screen — no fill, no border. */}
      {baselinePaused ? (
        // Frozen baseline handoff (#869). The classification band and the
        // 1K card below both describe the frozen baseline routine, which
        // is not what is being trained right now — collapsed into one
        // compact, low-emphasis row rather than dominating active-Recovery
        // Home with numbers that cannot move until Recovery ends.
        <View style={styles.classifSection}>
          <Pressable
            testID="home-baseline-paused-link"
            onPress={() => onNavigate('Analytics', 'progressive-overload')}
            style={[styles.sectionHeaderAction, styles.sectionHeaderActionStart]}
            hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityLabel="Baseline training paused during Recovery"
            accessibilityHint="Opens the Progressive Overload section of the Analytics tab"
          >
            <Text style={[styles.classifSectionLabel, styles.sectionHeaderLabel]}>Baseline training paused during Recovery</Text>
            <View style={styles.sectionHeaderChevron}>
              <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
            </View>
          </Pressable>
        </View>
      ) : (
        <View style={styles.classifSection}>
          <Pressable
            testID="home-strength-summary-link"
            onPress={() => onNavigate('Analytics', 'progressive-overload')}
            style={[styles.sectionHeaderAction, styles.sectionHeaderActionStart]}
            hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityLabel="Exercise Progress"
            accessibilityHint="Opens the Progressive Overload section of the Analytics tab"
          >
            <Text style={[styles.classifSectionLabel, styles.sectionHeaderLabel]}>Exercise Progress</Text>
            <View style={styles.sectionHeaderChevron}>
              <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
            </View>
          </Pressable>
          <View style={styles.classifRow}>
            {[
              { label: 'Progressing', count: dashboardData.weeklySummary.classifications?.progressing ?? 0, color: colors.success },
              { label: 'Steady', count: dashboardData.weeklySummary.classifications?.stalled ?? 0, color: colors.caution },
              { label: 'Regressing', count: dashboardData.weeklySummary.classifications?.regressing ?? 0, color: colors.error },
            ].map((item, idx) => (
              <View key={idx} style={styles.classifCol}>
                <View style={[styles.classifDot, { backgroundColor: item.color }]} />
                <Text style={styles.classifCount}>{item.count}</Text>
                <Text style={styles.classifLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          {/* #894: the three counts above only cover a fully classified
              tracked span (progressing/steady/regressing) — a freshly
              opened span (#893) or inherited catalog/pre-#893 tracking
              contributes to neither bucket, so a 0/0/0 row would
              otherwise read as "nothing classifiable" rather than
              "still building history". Newly-tracked takes priority
              when both apply: it names a concrete next action. */}
          {dashboardData.weeklySummary.newlyTrackedCount > 0 ? (
            <Text style={styles.classifCaption}>
              {dashboardData.weeklySummary.newlyTrackedCount === 1
                ? '1 exercise in its first tracked session — log another to see a trend'
                : `${dashboardData.weeklySummary.newlyTrackedCount} exercises in their first tracked session — log another to see a trend`}
            </Text>
          ) : dashboardData.weeklySummary.hasInheritedTracking ? (
            <Text style={styles.classifCaption}>
              Includes exercises tracked before this update, using full history
            </Text>
          ) : null}
        </View>
      )}

      {/* #7 quiet CTA. Targets `overview` rather than a bare tab press
          (#770): "full history and insights" promises the whole tab from
          the top, and an unsectioned press would instead resume the last
          Analytics scroll position — which for a returning user is
          whatever single section they were reading last. */}
      <View style={styles.heroFooter}>
        <Pressable
          testID="home-insights-link"
          onPress={() => onNavigate('Analytics', 'overview')}
          style={styles.insightsLink}
          accessibilityRole="button"
          accessibilityLabel="Full history and insights"
          accessibilityHint="Opens the Analytics tab at the top"
        >
          <Text style={styles.insightsLinkText}>Full history and insights</Text>
          <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
        </Pressable>
      </View>
    </Card>
  );
}
