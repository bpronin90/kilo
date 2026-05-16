import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { StatCard } from '../components/UI';
import { computeWeightTrends } from '../lib/data';

export function StatsScreen({ entries }) {
  const summary = useMemo(() => {
    const weightEntries = entries.filter((e) => e.entry_type === 'weight');
    const workoutEntries = entries.filter((e) => e.entry_type === 'workout');
    const latestWeight = weightEntries[0];
    const trends = computeWeightTrends(weightEntries);

    return {
      latestWeight: latestWeight ? `${latestWeight.weight_value} ${latestWeight.weight_unit || 'lb'}` : 'No data',
      weightCount: String(weightEntries.length),
      workoutCount: String(workoutEntries.length),
      avg7:  trends.avg7  !== null ? `${trends.avg7.toFixed(1)} lb`  : '—',
      avg30: trends.avg30 !== null ? `${trends.avg30.toFixed(1)} lb` : '—',
      paceFlag: trends.paceFlag,
    };
  }, [entries]);

  return (
    <ScreenShell
      title="Stats"
      subtitle="High-level metrics for your training journey."
    >
      <View style={styles.grid}>
        <StatCard label="Latest weight" value={summary.latestWeight} tone="accent" />
        <StatCard label="7-day avg" value={summary.avg7} />
        <StatCard label="30-day avg" value={summary.avg30} />
        {summary.paceFlag ? (
          <StatCard
            label="Pace flag"
            value={summary.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
            tone={summary.paceFlag === 'gain' ? 'warn' : 'accent'}
          />
        ) : null}
        <StatCard label="Weight entries" value={summary.weightCount} />
        <StatCard label="Workout entries" value={summary.workoutCount} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
});
