import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Card } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { displayWeight } from '../../lib/units';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';
import { HomeRecoverySummary } from './HomeRecoverySummary';
import { HomeWeightCard } from './HomeWeightCard';

// Tiers 1b-3 (recovery summary, body weight + goal, 1K progress), extracted from
// HomeScreen (#1049). Presentation only: HomeScreen still owns the loading
// gate, the four-source boundary and all dashboard math, and passes results in.
export function HomeDashboard({
  recoverySummary,
  onNavigate,
  dashboardData,
  weightGoal,
  baselinePaused,
  hasWeightSeries,
  oneKHeroColor,
  unit,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const hasOneKTotal = !!dashboardData.oneK?.total;
  const oneKLifts = [
    { key: 'squat', label: 'Squats', value: dashboardData.oneK?.squat ?? null },
    { key: 'bench', label: 'Bench', value: dashboardData.oneK?.bench ?? null },
    { key: 'deadlift', label: 'Deadlifts', value: dashboardData.oneK?.deadlift ?? null },
  ];

  return (
    <>
      {/* Tier 1b: Recovery status, directly under the hero because it is what
          the hero's week label and classification counts mean right now. */}
      <HomeRecoverySummary summary={recoverySummary} onNavigate={onNavigate} />

      <HomeWeightCard
        dashboardData={dashboardData}
        weightGoal={weightGoal}
        hasWeightSeries={hasWeightSeries}
        onNavigate={onNavigate}
        unit={unit}
      />

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
          <Text style={[styles.oneKLabel, styles.sectionHeaderLabel]} numberOfLines={1}>1K Progress</Text>
          <View style={styles.sectionHeaderChevron}>
            <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={kua ? kua.onSurfaceVariant : colors.textMuted} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}><Path d="M9 5l7 7-7 7" /></Svg>
          </View>
        </Pressable>
        {hasOneKTotal ? (
          <>
            <Text style={[styles.oneKHeroValue, { color: oneKHeroColor }]}>
              {`${displayWeight(dashboardData.oneK.total, unit).toFixed(0)}`}
              <Text style={styles.oneKHeroUnit}> {unit}</Text>
            </Text>
            <View style={styles.progressBarLarge}>
              <View
                style={[
                  styles.progressFillLarge,
                  { width: `${Math.min(100, (dashboardData.oneK.total / 1000) * 100)}%` }
                ]}
              />
            </View>
          </>
        ) : (
          // #1333: no total yet is a setup state, not a hero full of N/A. The
          // total needs one complete cycle of all three lifts (lib/data/oneK.js).
          <Text testID="home-one-k-setup" style={styles.oneKHeroCaption}>Log a session of each Big 3 lift to see your 1K total.</Text>
        )}
        {/* Lifts with a value only once there is a total; before that only
            the ones already logged, and nothing at all when none are. */}
        {hasOneKTotal || oneKLifts.some(l => l.value != null) ? (
          <View style={styles.oneKGrid}>
            {oneKLifts.filter(l => hasOneKTotal || l.value != null).map((l, idx) => (
              <View key={l.key} style={[styles.oneKGridItem, idx > 0 && styles.oneKGridItemDivider]}>
                <Text style={styles.oneKGridValue}>{l.value != null ? displayWeight(l.value, unit).toFixed(0) : 'N/A'}</Text>
                <Text style={styles.oneKGridLabel}>{l.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
      )}
    </>
  );
}
