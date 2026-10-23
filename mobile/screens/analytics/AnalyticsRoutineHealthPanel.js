import React from 'react';
import { Text, View } from 'react-native';
import { SectionTitle, SessionGauge } from '../../components/UI';
import { AnalyticsFatigueCard } from '../../components/AnalyticsFatigueCard';
import { Panel, PanelSection, MonoLabel } from '../../components/ui/RedesignPrimitives';
import { useKuaTypography } from '../../theme/typography';

// Routine Health: how deep the current routine is and whether a deload is
// worth considering (`deriveRoutineStatus()` values, read as-is), plus the
// optional Session Check-ins evidence. The gauge always renders — routine
// depth is independent of whether check-in tracking is on.
//
// Redesign v3 (#1602): gauge/zones + Total, the Deload mode state and the
// check-ins share ONE flat panel separated by hairlines, with no card inside
// it. Deload mode off keeps production's Total-only gauge (#821) and shows no
// deload row, so nothing about a disabled feature is on screen.
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
  const typography = useKuaTypography();
  const showDeload = deloadModeEnabled && !isActiveRecovery;
  return (
    <View testID="routine-health-section" style={styles.routineHealthSection}>
      <SectionTitle>Routine Health</SectionTitle>
      <Panel testID="routine-health-panel">
        {/* Suppressed advisory (#871): the deload zones assume baseline sessions
            are accumulating, untrue during active Recovery — the count still
            renders as paused history. */}
        <SessionGauge
          count={sinceDeload}
          total={sessionCount}
          showDeload={showDeload}
          paused={isActiveRecovery}
          showTitle={false}
          contained={false}
        />
        {showDeload ? (
          <PanelSection divider style={styles.routineHealthRow}>
            <MonoLabel>Deload mode</MonoLabel>
            <Text style={[typography['body-md'], styles.routineHealthValue]}>On</Text>
          </PanelSection>
        ) : null}
        {fatigueTrackingEnabled ? (
          <View style={styles.routineHealthDivider}>
            <AnalyticsFatigueCard
              checkInHistory={checkInHistory}
              fatigueExpanded={fatigueExpanded}
              setFatigueExpanded={setFatigueExpanded}
              handleCheckInEdit={handleCheckInEdit}
              contained={false}
            />
          </View>
        ) : null}
      </Panel>
    </View>
  );
}
