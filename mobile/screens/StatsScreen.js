import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { StatCard } from '../components/UI';

export function StatsScreen({ entries }) {
  const summary = useMemo(() => {
    const weightEntries = entries.filter((entry) => entry.type === 'weight');
    const workoutEntries = entries.filter((entry) => entry.type === 'workout');
    const latestWeight = weightEntries[0];

    return {
      latestWeight: latestWeight ? `${latestWeight.value} ${latestWeight.unit}` : 'No data',
      weightCount: String(weightEntries.length),
      workoutCount: String(workoutEntries.length),
    };
  }, [entries]);

  return (
    <ScreenShell
      title="Stats"
      subtitle="High-level metrics for your training journey."
    >
      <View style={styles.grid}>
        <StatCard label="Latest weight" value={summary.latestWeight} tone="accent" />
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
