import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card } from '../../components/UI';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { useWeightUnit } from '../../lib/unitPreference';
import { displayWeight, formatBodyweightValue } from '../../lib/units';
import { createStyles } from './homeStyles';
import { HomeRecoverySummary } from './HomeRecoverySummary';

// Tiers 1b-3 (recovery summary, weight goal, 1K progress), extracted from
// HomeScreen (#1049). Presentation only: HomeScreen still owns the loading
// gate, the four-source boundary and all dashboard math, and passes results in.
export function HomeDashboard({
  recoverySummary,
  onNavigate,
  dashboardData,
  weightGoal,
  baselinePaused,
  oneKHeroColor,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const unit = useWeightUnit();

  return (
    <>
      {/* Tier 1b: Recovery status, directly under the hero because it is what
          the hero's week label and classification counts mean right now. */}
      <HomeRecoverySummary summary={recoverySummary} onNavigate={onNavigate} />

      {dashboardData.goalInfo ? (() => {
        const gi = dashboardData.goalInfo;
        const warnings = gi.warnings || [];
        const paceColor = warnings.includes('unrealistic') ? colors.error
          : warnings.includes('unhealthy') ? colors.cautionText
          : colors.success;
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
              <View
                style={styles.goalStatCol}
                accessible
                accessibilityLabel={`Pace: ${
                  gi.required_weekly_pace !== null
                    ? `${gi.required_weekly_pace > 0 ? '+' : ''}${displayWeight(gi.required_weekly_pace, unit).toFixed(1)} ${unit} per week`
                    : 'not available'
                }. ${
                  warnings.includes('unrealistic') ? 'Unrealistic pace.'
                    : warnings.includes('unhealthy') ? 'Unhealthy pace.'
                    : 'Healthy pace.'
                }`}
              >
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

      {baselinePaused ? null : (
      <Card style={styles.oneKCard}>
        <Pressable
          testID="home-one-k-link"
          onPress={() => onNavigate('Analytics', 'strength')}
          style={[styles.sectionHeaderAction, styles.sectionHeaderActionCenter]}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel="1K Progress"
          accessibilityHint="Opens the strength section of the Analytics tab"
        >
          <Text style={[styles.oneKLabel, styles.sectionHeaderLabel]}>1K Progress</Text>
          <View style={styles.sectionHeaderChevron}>
            <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
          </View>
        </Pressable>
        <Text style={[styles.oneKHeroValue, { color: oneKHeroColor }]}>
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
      )}
    </>
  );
}
