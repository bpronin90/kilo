import React from 'react';
import { displayWeight } from '../../lib/units';
import { HomeRecoverySummary } from './HomeRecoverySummary';
import { HomeWeightCard } from './HomeWeightCard';
import { HomeActionStrip } from './HomeActionStrip';
import { HomeOneKPanel } from './HomeOneKPanel';

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
  unit,
}) {
  const hasOneKTotal = !!dashboardData.oneK?.total;
  // Before a total, only the lifts already logged (#1333).
  const oneKLifts = [
    { key: 'squat', label: 'Squat', value: dashboardData.oneK?.squat ?? null },
    { key: 'bench', label: 'Bench', value: dashboardData.oneK?.bench ?? null },
    { key: 'deadlift', label: 'Deadlift', value: dashboardData.oneK?.deadlift ?? null },
  ].filter(l => l.value != null);
  // #1444: the three lifts are plain breakdown values; only the collective bar tracks a target.
  const liftRows = oneKLifts.map(l => ({ ...l, value: displayWeight(l.value, unit) }));

  return (
    <>
      <HomeRecoverySummary
        summary={recoverySummary}
        onNavigate={onNavigate}
        actions={recoveryActions ? <HomeActionStrip {...recoveryActions} onNavigate={onNavigate} /> : null}
      />

      {baselinePaused ? null : (
        // #1458 / #1605: Home-local 1K panel — total, stacked bar, Big 3 split; no graph.
        <HomeOneKPanel
          total={hasOneKTotal ? displayWeight(dashboardData.oneK.total, unit) : null}
          target={displayWeight(1000, unit)}
          unit={unit}
          emptyText="Log a session of each Big 3 lift to see your 1K total."
          onTitlePress={() => onNavigate('Analytics', 'strength')}
          titleHint="Opens the strength section of the Analytics tab"
          lifts={liftRows}
        />
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
