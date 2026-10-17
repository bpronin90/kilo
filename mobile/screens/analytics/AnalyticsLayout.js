import React from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SectionTitle, SessionGauge } from '../../components/UI';
import { AnalyticsFatigueCard } from '../../components/AnalyticsFatigueCard';

// Analytics is the evidence surface: Home owns the summary, so the tab opens
// straight into analysis rather than an overview of the same signals.
//
// Normal training:   Strength → Routine Health → Progressive Overload →
//                    Weight Trends → Recovery history (only when it exists).
// Active Recovery:   Recovery → Weight Trends → `Baseline training · paused
//                    during Recovery` disclosure (collapsed by default) holding
//                    Strength → Progressive Overload → Routine Health.
//
// Pure ordering: every argument is an already-built element (or null), so the
// two hierarchies cannot drift in what they render — only where.
export function orderAnalyticsSections({
  isActiveRecovery,
  baselineExpanded,
  banners = [],
  strength,
  progressiveOverload,
  weight,
  routineHealth,
  recovery,
  disclosure,
}) {
  if (!isActiveRecovery) {
    return [...banners, strength, routineHealth, progressiveOverload, weight, recovery];
  }
  return [
    ...banners,
    recovery,
    weight,
    disclosure,
    ...(baselineExpanded ? [strength, progressiveOverload, routineHealth] : []),
  ];
}

// Baseline-training disclosure (#871, Zero Friction F9). Strength, Progressive
// Overload and Routine Health are derived from baseline sessions, which stop
// accumulating during an active Recovery block.
export function BaselineDisclosureToggle({ collapsed, onToggle, styles, colors, kua }) {
  return (
    <Pressable
      testID="baseline-disclosure-toggle"
      onPress={onToggle}
      style={styles.baselineDisclosureToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel="Baseline training, paused during Recovery"
      accessibilityHint={collapsed ? 'Shows strength and routine history from before Recovery' : 'Hides strength and routine history from before Recovery'}
    >
      <Text style={styles.baselineDisclosureLabel}>Baseline training · paused during Recovery</Text>
      <MaterialIcons
        name={collapsed ? 'expand-more' : 'expand-less'}
        size={20}
        color={kua ? kua.onSurfaceVariant : colors.textMuted}
        accessible={false}
      />
    </Pressable>
  );
}

// Routine Health: how deep the current routine is and whether a deload is
// worth considering (`deriveRoutineStatus()` values, read as-is), plus the
// optional Session Check-ins evidence. The gauge always renders — routine
// depth is independent of whether check-in tracking is on.
export function AnalyticsRoutineHealth({
  styles,
  sinceDeload,
  sessionCount,
  deloadModeEnabled,
  isActiveRecovery,
  fatigueTrackingEnabled,
  checkInHistory,
  fatigueExpanded,
  setFatigueExpanded,
  handleCheckInEdit,
}) {
  return (
    <View testID="routine-health-section" style={styles.routineHealthSection}>
      <SectionTitle>Routine Health</SectionTitle>
      {/* Suppressed advisory (#871): the deload zones assume baseline sessions
          are accumulating, untrue during active Recovery — the count still
          renders as paused history. */}
      <SessionGauge
        count={sinceDeload}
        total={sessionCount}
        showDeload={deloadModeEnabled && !isActiveRecovery}
        paused={isActiveRecovery}
        showTitle={false}
      />
      {fatigueTrackingEnabled ? (
        <AnalyticsFatigueCard
          checkInHistory={checkInHistory}
          fatigueExpanded={fatigueExpanded}
          setFatigueExpanded={setFatigueExpanded}
          handleCheckInEdit={handleCheckInEdit}
        />
      ) : null}
    </View>
  );
}
