import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { formatBodyweightValue, formatGoalWeightValue } from '../../lib/units';
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
// the hero answers only "what am I training and what next"; the header is the
// Weight handoff. #1339: supporting context, not a mini Weight tab — the latest
// weigh-in and one goal line. The trend chart and pace stats live on Weight.
export function HomeWeightCard({ dashboardData, weightGoal, onNavigate, unit }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const mutedStroke = kua ? kua.onSurfaceVariant : colors.textMuted;

  const gi = dashboardData.goalInfo;
  const modeLabel = gi?.direction === 'loss' ? 'Cutting' : gi?.direction === 'gain' ? 'Bulking' : 'Maintaining';
  // Active goal reads "on" (success), an ended one a caution to act on (#1112).
  const weeksColor = gi?.isOverdue ? (kua ? kua.warning : colors.cautionText) : (kua ? kua.success : colors.success);
  const targetText = weightGoal?.target_weight != null
    ? `${formatGoalWeightValue(weightGoal.target_weight, unit)} ${unit}`
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
        <View style={styles.weightSummaryRow}>
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
          {gi ? (
            <View testID="home-goal" style={styles.goalSummary}>
              <Text style={styles.goalDirectionText} numberOfLines={1}>
                <Text style={styles.goalModeAccent}>{modeLabel}</Text>
                {targetText ? ` · ${targetText}` : ''}
              </Text>
              <Text style={[styles.goalWeeksText, { color: weeksColor }]}>
                {gi.isOverdue ? 'Goal ended' : `${Math.round(gi.weeks_remaining)} weeks left`}
              </Text>
            </View>
          ) : null}
        </View>
        {/* Legacy-mode Analytics handoff; KUA keeps Home to the Weight handoff. */}
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
      </Card>
    </View>
  );
}
