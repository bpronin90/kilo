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

// Tiers 1b-3 (recovery summary, 1K progress, body weight + goal), extracted from
// HomeScreen (#1049). Presentation only: HomeScreen still owns the loading
// gate, the four-source boundary and all dashboard math, and passes results in.
// #1339: strength first — 1K leads body weight, which is supporting context.
export function HomeDashboard({
  recoverySummary,
  onNavigate,
  dashboardData,
  weightGoal,
  baselinePaused,
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
  // Before a total, only the lifts already logged, as one quiet line.
  const loggedLiftsLine = oneKLifts
    .filter(l => l.value != null)
    .map(l => `${l.label} ${displayWeight(l.value, unit).toFixed(0)}`)
    .join(' · ');

  return (
    <>
      {/* Tier 1b: Recovery status, directly under the hero. In Recovery it owns
          the week and its Big 3; the hero carries only the next action. */}
      <HomeRecoverySummary summary={recoverySummary} onNavigate={onNavigate} />

      {baselinePaused ? null : (
      // No total yet is a setup state (#1333), and #1339 sizes it as one: a
      // left-aligned row of header, setup line and any lifts already logged.
      <Card style={hasOneKTotal ? styles.oneKCard : styles.oneKSetupCard}>
        <Pressable
          testID="home-one-k-link"
          onPress={() => onNavigate('Analytics', 'strength')}
          style={[styles.sectionHeaderAction, hasOneKTotal ? styles.sectionHeaderActionCenter : styles.sectionHeaderActionStart]}
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
          // The total needs one complete cycle of all three lifts (lib/data/oneK.js).
          <Text testID="home-one-k-setup" style={styles.oneKSetupText}>Log a session of each Big 3 lift to see your 1K total.</Text>
        )}
        {hasOneKTotal ? (
          <View style={styles.oneKGrid}>
            {oneKLifts.map((l, idx) => (
              <View key={l.key} style={[styles.oneKGridItem, idx > 0 && styles.oneKGridItemDivider]}>
                <Text style={styles.oneKGridValue}>{l.value != null ? displayWeight(l.value, unit).toFixed(0) : 'N/A'}</Text>
                <Text style={styles.oneKGridLabel}>{l.label}</Text>
              </View>
            ))}
          </View>
        ) : loggedLiftsLine ? (
          <Text testID="home-one-k-logged" style={styles.oneKSetupLifts}>{loggedLiftsLine}</Text>
        ) : null}
      </Card>
      )}

      <HomeWeightCard
        dashboardData={dashboardData}
        weightGoal={weightGoal}
        onNavigate={onNavigate}
        unit={unit}
      />
    </>
  );
}
