import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Card, LineChart } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { formatBodyweightValue, displayChartSeries } from '../../lib/units';
import { createStyles } from './homeStyles';

// Small chevron affordance shared by every quiet handoff on this card.
function Chevron({ color }) {
  return (
    <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

// Info glyph for the classification caption toggle. Replaces the "ⓘ" text
// character, which is absent from the bundled Space Grotesk / JetBrains Mono
// faces and rendered as a tofu box on device (#1112).
function InfoIcon({ color }) {
  return (
    <Svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Circle cx="12" cy="12" r="9" />
      <Line x1="12" y1="11" x2="12" y2="16" />
      <Circle cx="12" cy="7.5" r="0.6" fill={color} stroke={color} />
    </Svg>
  );
}

// Tier 1 weekly-summary hero, extracted from HomeScreen (#1049). Presentation
// only: every value it renders is computed by HomeScreen and passed in, so the
// first-paint gate and dashboard math stay in one place.
//
// #1112 redesign: training leads. The card opens with a KUA section header
// (accent bar + "THIS WEEK") and the week's classification trio as the lead
// figures; the two daily-loop actions follow; body weight is demoted to a
// supporting metric grouped with its own trend below. Body weight is no longer
// the hero of the "current routine progress" screen.
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
  unit,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const [captionExpanded, setCaptionExpanded] = useState(false);

  const isRecovery = isRecoveryOpenWeek || isRecoveryBetweenWeeks;
  // The header carries the week identity itself — no separate "THIS WEEK" label
  // duplicated by a week number on the right (#1112 owner feedback). Recovery
  // keeps a "Recovery" header with the week/state on the line below.
  const headerLabel = isRecovery
    ? 'Recovery'
    : dashboardData.weeksIn !== null ? `Week ${dashboardData.weeksIn}` : 'Week —';
  const recoverySubline = isRecoveryOpenWeek
    ? `Week ${activeTrainingContext.recoveryWeekNumber ?? '—'}`
    : isRecoveryBetweenWeeks
      ? 'Between weeks'
      : null;

  const mutedStroke = kua ? kua.onSurfaceVariant : colors.textMuted;
  const actionStroke = kua ? kua.primaryOnContainer : colors.textMuted;

  const newlyTrackedCount = dashboardData.weeklySummary.newlyTrackedCount;
  const captionText = newlyTrackedCount > 0
    ? (newlyTrackedCount === 1
        ? '1 exercise in its first tracked session — log another to see a trend'
        : `${newlyTrackedCount} exercises in their first tracked session — log another to see a trend`)
    : dashboardData.weeklySummary.hasInheritedTracking
      ? 'Includes exercises tracked before this update, using full history'
      : null;

  return (
    <Card style={styles.weeklyHero}>
      {/* KUA section header (#1112): accent bar + the week identity itself.
          The info toggle (only when the counts need explaining) lives on the
          right, in the space the redundant week label used to occupy — it no
          longer costs its own row below the counts. */}
      <View style={styles.heroHeaderRow}>
        <View style={styles.heroHeaderLeft}>
          <View style={styles.heroAccentBar} />
          <Text style={styles.heroSectionLabel} numberOfLines={1}>{headerLabel}</Text>
        </View>
        {!baselinePaused ? (
          <View style={styles.heroHeaderRight}>
            <Text style={styles.heroClassifHeaderLabel} numberOfLines={1}>Exercise Progress</Text>
            {captionText && kua ? (
              <Pressable
                testID="home-classif-info"
                onPress={() => setCaptionExpanded(v => !v)}
                style={styles.heroInfoToggle}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityState={{ expanded: captionExpanded }}
                accessibilityLabel={captionText}
              >
                <InfoIcon color={mutedStroke} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Recovery sub-line: the live week/state under the "Recovery" header. */}
      {recoverySubline ? (
        <Text style={styles.heroWeekSubline} numberOfLines={1}>{recoverySubline}</Text>
      ) : null}

      {/* The active Recovery note's own title, named directly under the header
          so "what is current" answers both the week and which note that is. */}
      {isRecoveryOpenWeek && activeTrainingContext.activeNote ? (
        <Text testID="home-recovery-active-note" style={styles.heroRecoveryNoteLabel}>
          {activeTrainingContext.activeNote.title || 'Untitled'}
        </Text>
      ) : null}

      {/* Lead content: the week's per-exercise classification pulse (#1112).
          Only the counts vary by tone; the label row is data, not a control. */}
      {baselinePaused ? (
        // Frozen baseline handoff (#869). The classification band and the 1K
        // card below both describe the frozen baseline routine, which is not
        // what is being trained right now — collapsed into one compact,
        // low-emphasis row rather than dominating active-Recovery Home with
        // numbers that cannot move until Recovery ends.
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
              <Chevron color={mutedStroke} />
            </View>
          </Pressable>
        </View>
      ) : (
        <View style={styles.classifSection}>
          <View style={styles.classifRow}>
            {[
              { label: 'Progressing', count: dashboardData.weeklySummary.classifications?.progressing ?? 0, color: kua ? kua.success : colors.success },
              { label: 'Steady', count: dashboardData.weeklySummary.classifications?.stalled ?? 0, color: kua ? kua.warning : colors.caution },
              { label: 'Regressing', count: dashboardData.weeklySummary.classifications?.regressing ?? 0, color: kua ? kua.error : colors.error },
            ].map((item, idx) => (
              <View key={idx} style={styles.classifCol}>
                <Text style={[styles.classifCount, kua ? { color: item.color } : null]}>{item.count}</Text>
                <Text style={styles.classifLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          {/* #894: the counts above only cover a fully classified tracked span;
              a freshly opened span or inherited/pre-#893 tracking contributes
              to neither bucket, so the caption explains a 0/0/0 row instead of
              letting it read as "nothing classifiable". In KUA mode it is
              toggled from the header info icon and revealed inline here; legacy
              mode shows it plainly. */}
          {captionText ? (
            kua ? (
              captionExpanded ? (
                <Text style={styles.classifCaption}>{captionText}</Text>
              ) : null
            ) : (
              <Text style={styles.classifCaption}>{captionText}</Text>
            )
          ) : null}
        </View>
      )}

      {/* The two highest-frequency daily-loop actions, in one stable row. */}
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
          <Chevron color={actionStroke} />
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
          <Chevron color={actionStroke} />
        </Pressable>
      </View>

      {/* Body weight — a supporting metric now, grouped with the trend it
          belongs to (#1112). With no weigh-in the value degrades to a short
          muted sentence and the empty sparkline is suppressed. */}
      <View style={styles.heroSparklineStrip}>
        <Text style={styles.heroMetricLabel}>Body weight</Text>
        {dashboardData.latestWeight ? (
          <View style={styles.heroWeightValueRow}>
            <Text style={styles.heroWeightValue} numberOfLines={1}>
              {formatBodyweightValue(dashboardData.latestWeight, unit)}
            </Text>
            <Text style={styles.heroWeightUnit}>{unit}</Text>
          </View>
        ) : (
          <Text style={styles.heroWeightPlaceholder}>No weigh-in yet</Text>
        )}
        {hasWeightSeries ? (
          <>
            <Text style={[styles.heroSparklineSublabel, { marginTop: 12 }]}>7-day rolling avg</Text>
            <View style={styles.heroSparklineChart}>
              <LineChart
                data={displayChartSeries(dashboardData.weightSeries, unit)}
                color={kua ? kua.primary : colors.textMuted}
                height={64}
                paddingHorizontal={0}
                hideHeader
              />
            </View>
          </>
        ) : null}
        {/* Legacy-mode Analytics handoff. In KUA mode the card footer's
            "Full history and insights" already covers this destination. */}
        {!kua ? (
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
            <Chevron color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* #7 quiet CTA. Targets `overview` rather than a bare tab press (#770):
          "full history and insights" promises the whole tab from the top. */}
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
          <Chevron color={mutedStroke} />
        </Pressable>
      </View>
    </Card>
  );
}
