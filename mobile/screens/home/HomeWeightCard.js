import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card, LineChart } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { displayChartSeries, displayWeight, formatBodyweightValue, formatGoalWeightValue } from '../../lib/units';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';

function Chevron({ color }) {
  return (
    <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

// The goal state that needs the user, in the Weight goal card's own words.
// Maintenance never gets a pace warning there, so it never gets one here.
export function goalAttentionText(goalInfo) {
  if (!goalInfo) return null;
  if (goalInfo.isOverdue) return 'Goal ended. Archive it or set a new one in Weight.';
  if (goalInfo.direction !== 'loss' && goalInfo.direction !== 'gain') return null;
  const warnings = goalInfo.warnings || [];
  if (warnings.includes('unrealistic')) return 'Pace is unrealistic - consider a longer timeline.';
  if (warnings.includes('unhealthy')) return 'Pace is aggressive - a slower target is safer.';
  return null;
}

// Body weight and its goal, one card (#1333). Moved out of the training hero so
// the hero answers only "what am I training and what next"; everything here is
// the Weight surface's summary, and the header is its handoff.
export function HomeWeightCard({ dashboardData, weightGoal, hasWeightSeries, onNavigate, unit }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const mutedStroke = kua ? kua.onSurfaceVariant : colors.textMuted;

  const gi = dashboardData.goalInfo;
  const warnings = gi?.warnings || [];
  const paceColor = warnings.includes('unrealistic') ? (kua ? kua.errorText : colors.error)
    : warnings.includes('unhealthy') ? (kua ? kua.warning : colors.cautionText)
    : (kua ? kua.success : colors.success);
  const modeLabel = gi?.direction === 'loss' ? 'Cutting' : gi?.direction === 'gain' ? 'Bulking' : 'Maintaining';
  // Active goal reads "on" (success), an ended one a caution to act on (#1112).
  const weeksColor = gi?.isOverdue ? (kua ? kua.warning : colors.cautionText) : (kua ? kua.success : colors.success);
  const paceText = gi && gi.required_weekly_pace !== null
    ? `${gi.required_weekly_pace > 0 ? '+' : ''}${displayWeight(gi.required_weekly_pace, unit).toFixed(1)}`
    : null;
  const attention = goalAttentionText(gi);

  return (
    <View testID="home-weight-card">
      <Card style={styles.goalCard}>
        <Pressable
          testID="home-weight-link"
          onPress={() => onNavigate('Weight')}
          style={[styles.sectionHeaderAction, styles.sectionHeaderActionStart]}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel="Body weight"
          accessibilityHint="Opens the Weight tab"
        >
          <Text style={[styles.classifSectionLabel, styles.sectionHeaderLabel]}>Body weight</Text>
          <View style={styles.sectionHeaderChevron}>
            <Chevron color={mutedStroke} />
          </View>
        </Pressable>
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
                height={52}
                paddingHorizontal={0}
                hideHeader
              />
            </View>
          </>
        ) : null}
        {/* Legacy-mode Analytics handoff. In KUA mode the hero footer's
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

        {gi ? (
          <View testID="home-goal" style={styles.goalSection}>
            <View style={styles.goalModeRow}>
              <Text style={styles.goalDirectionText}>
                Goal: <Text style={styles.goalModeAccent}>{modeLabel}</Text>
              </Text>
              <Text style={[styles.goalWeeksText, { color: weeksColor }]}>
                {gi.isOverdue ? 'Goal ended' : `${Math.round(gi.weeks_remaining)} weeks left`}
              </Text>
            </View>
            <View style={styles.goalStatsGrid}>
              <View style={styles.goalStatCol}>
                <Text style={styles.goalStatLabel}>Target</Text>
                <View style={styles.goalStatValueRow}>
                  <Text style={styles.goalStatValueLarge}>{weightGoal?.target_weight != null ? formatGoalWeightValue(weightGoal.target_weight, unit) : weightGoal?.target_weight}</Text>
                  <Text style={styles.goalStatUnitLabel}>{unit}</Text>
                </View>
              </View>
              {/* An ended goal has no pace to show; the attention line says what to do. */}
              {paceText !== null ? (
                <View
                  style={styles.goalStatCol}
                  accessible
                  accessibilityLabel={`Pace: ${paceText} ${unit} per week. ${
                    warnings.includes('unrealistic') ? 'Unrealistic pace.'
                      : warnings.includes('unhealthy') ? 'Unhealthy pace.'
                      : 'Healthy pace.'
                  }`}
                >
                  <Text style={styles.goalStatLabel}>Pace</Text>
                  <View style={styles.goalStatValueRow}>
                    <Text style={[styles.goalStatValueLarge, { color: paceColor }]}>{paceText}</Text>
                    <Text style={[styles.goalStatUnitLabel, { color: paceColor }]}>{unit}/wk</Text>
                  </View>
                </View>
              ) : null}
            </View>
            {attention ? (
              <View testID="home-goal-attention" style={styles.goalAttention}>
                <Text style={styles.goalAttentionText}>{attention}</Text>
                <Pressable
                  testID="home-goal-attention-action"
                  onPress={() => onNavigate('Weight')}
                  style={styles.recoveryAction}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Review goal"
                  accessibilityHint="Opens the Weight tab, where the goal can be edited"
                >
                  <Text style={styles.recoveryActionText}>Review goal</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </Card>
    </View>
  );
}
