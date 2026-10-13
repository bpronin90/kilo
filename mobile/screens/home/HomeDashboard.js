import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { displayWeight } from '../../lib/units';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';
import { HomeRecoverySummary } from './HomeRecoverySummary';
import { HomeWeightCard } from './HomeWeightCard';
import { Chevron, HomeActionStrip } from './HomeActionStrip';
import { Big3Bars } from '../../components/Big3Bars';

// Everything below the training hero, extracted from HomeScreen (#1049).
// Presentation only: HomeScreen still owns the loading gate, the four-source
// boundary and all dashboard math, and passes results in.
// #1341: in Recovery the Recovery card is the training surface and carries the
// action strip (`recoveryActions`: its label, hint and press handler); the 1K card stays hidden while baseline is
// paused. Normal training: 1K / Big 3, then body weight.
export function HomeDashboard({
  recoverySummary,
  recoveryActions = null,
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
  // Before a total, only the lifts already logged (#1333).
  const oneKLifts = [
    { key: 'squat', label: 'Squat', value: dashboardData.oneK?.squat ?? null },
    { key: 'bench', label: 'Bench', value: dashboardData.oneK?.bench ?? null },
    { key: 'deadlift', label: 'Deadlift', value: dashboardData.oneK?.deadlift ?? null },
  ].filter(l => l.value != null);
  // #1341: the Big 3 bars are a bar chart of the three values on one shared
  // scale (heaviest lift = full track) — the numbers themselves, not a new metric.
  const heaviest = Math.max(0, ...oneKLifts.map(l => l.value));
  const liftRows = oneKLifts.map(l => ({
    key: l.key,
    label: l.label,
    value: displayWeight(l.value, unit).toFixed(0),
    strong: true,
    fill: heaviest > 0 ? (l.value / heaviest) * 100 : 0,
  }));

  return (
    <>
      <HomeRecoverySummary
        summary={recoverySummary}
        onNavigate={onNavigate}
        actions={recoveryActions ? <HomeActionStrip {...recoveryActions} onNavigate={onNavigate} /> : null}
      />

      {baselinePaused ? null : (
      <Card style={styles.oneKCard}>
        <Pressable
          testID="home-one-k-link"
          onPress={() => onNavigate('Analytics', 'strength')}
          style={[styles.sectionHeaderAction, styles.sectionHeaderActionStart]}
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          accessibilityRole="button"
          accessibilityLabel="1K Progress"
          accessibilityHint="Opens the strength section of the Analytics tab"
        >
          <Text style={[styles.classifSectionLabel, styles.sectionHeaderLabel]} numberOfLines={1}>1K Progress</Text>
          <View style={styles.sectionHeaderChevron}>
            <Chevron color={kua ? kua.onSurfaceVariant : colors.textMuted} />
          </View>
        </Pressable>
        {hasOneKTotal ? (
          <>
            <Text testID="home-one-k-total" style={[styles.oneKHeroValue, { color: oneKHeroColor }]}>
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
        {liftRows.length > 0 ? (
          <Big3Bars rows={liftRows} idPrefix="home-one-k-lift" testID="home-one-k-big3" />
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
