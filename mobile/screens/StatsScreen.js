import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { StatCard, Card, SectionTitle, Badge } from '../components/UI';
import { computeWeightTrends, derive1kTotal, DEFAULT_1K_EXERCISES } from '../lib/data';
import { useWorkoutNote, useWeightEntries } from '../hooks/useEntries';
import { parseWorkoutNote, countWorkoutSessions, deriveProgressionSignals } from '../lib/parser';
import { Colors } from '../theme/colors';

export function StatsScreen() {
  const { note, saveOneK } = useWorkoutNote();
  const { entries: weightEntries } = useWeightEntries();

  const [activeSlot, setActiveSlot] = useState(null); // 'bench' | 'squat' | 'deadlift'

  const weightSummary = useMemo(() => {
    const trends = computeWeightTrends(weightEntries);
    const latest = weightEntries[0];
    const unit = latest?.weight_unit || 'lb';
    return {
      latestWeight: latest ? `${latest.weight_value} ${unit}` : '—',
      weightCount: String(weightEntries.length),
      avg7:  trends.avg7  !== null ? `${trends.avg7.toFixed(1)} ${unit}`  : '—',
      avg30: trends.avg30 !== null ? `${trends.avg30.toFixed(1)} ${unit}` : '—',
      paceFlag: trends.paceFlag,
    };
  }, [weightEntries]);

  const oneKSelections = useMemo(() => ({
    ...DEFAULT_1K_EXERCISES,
    ...(note?.one_k_exercises || {}),
  }), [note]);

  const noteExerciseNames = useMemo(() => {
    if (!note?.raw_text) return [];
    const { sections } = parseWorkoutNote(note.raw_text);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    return [...new Set(names)];
  }, [note]);

  const analytics = useMemo(() => {
    if (!note?.raw_text) return null;
    const { sections } = parseWorkoutNote(note.raw_text);
    const trackedNames = note.tracked_exercises || [];
    const { exercises: signals } = deriveProgressionSignals(sections, trackedNames);
    const oneK = derive1kTotal(sections, oneKSelections);
    const workoutDayCount = countWorkoutSessions(note.raw_text);
    return { signals, oneK, workoutDayCount };
  }, [note, oneKSelections]);

  const workoutCount = useMemo(() => {
    return String(analytics?.workoutDayCount ?? 0);
  }, [analytics]);

  function handleSlotTap(slot) {
    setActiveSlot(prev => (prev === slot ? null : slot));
  }

  function handleSelectExercise(slot, exerciseName) {
    const next = { ...oneKSelections, [slot]: exerciseName };
    saveOneK(next);
    setActiveSlot(null);
  }

  const SLOT_LABELS = { bench: 'Bench', squat: 'Squat', deadlift: 'Deadlift' };

  return (
    <ScreenShell
      title="Analytics"
      subtitle="Insights derived from your logs."
    >
      <SectionTitle>Weight Trends</SectionTitle>
      <View style={styles.grid}>
        <StatCard label="Latest weight" value={weightSummary.latestWeight} tone="accent" />
        <StatCard label="7-day avg" value={weightSummary.avg7} />
        <StatCard label="30-day avg" value={weightSummary.avg30} />
        {weightSummary.paceFlag ? (
          <StatCard
            label="Pace flag"
            value={weightSummary.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
            tone={weightSummary.paceFlag === 'gain' ? 'error' : 'success'}
          />
        ) : null}
      </View>

      <SectionTitle>Strength</SectionTitle>
      {analytics?.oneK?.total ? (
        <Card style={styles.oneKCard}>
          <Text style={styles.oneKLabel}>1,000 lb Club Progress</Text>
          <Text style={styles.oneKValue}>{analytics.oneK.total.toFixed(0)} lb</Text>
          <View style={styles.oneKBreakdown}>
            <View style={styles.oneKItem}>
              <Text style={styles.oneKItemValue}>{analytics.oneK.squat?.toFixed(0) || '—'}</Text>
              <Text style={styles.oneKItemLabel}>Squat</Text>
            </View>
            <View style={styles.oneKItem}>
              <Text style={styles.oneKItemValue}>{analytics.oneK.bench?.toFixed(0) || '—'}</Text>
              <Text style={styles.oneKItemLabel}>Bench</Text>
            </View>
            <View style={styles.oneKItem}>
              <Text style={styles.oneKItemValue}>{analytics.oneK.deadlift?.toFixed(0) || '—'}</Text>
              <Text style={styles.oneKItemLabel}>Deadlift</Text>
            </View>
          </View>
        </Card>
      ) : (
        <Card style={styles.infoCard}>
          <Text style={styles.infoText}>
            Choose your squat, bench, and deadlift exercises below to track 1k progress.
          </Text>
        </Card>
      )}

      <Card style={styles.slotCard}>
        <Text style={styles.slotCardTitle}>1k exercise slots</Text>
        {(['bench', 'squat', 'deadlift']).map(slot => (
          <View key={slot}>
            <Pressable
              style={styles.slotRow}
              onPress={() => handleSlotTap(slot)}
            >
              <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
              <View style={styles.slotValueRow}>
                <Text style={styles.slotValue}>{oneKSelections[slot]}</Text>
                <Text style={styles.slotChevron}>{activeSlot === slot ? '▲' : '▼'}</Text>
              </View>
            </Pressable>
            {activeSlot === slot && noteExerciseNames.length > 0 && (
              <View style={styles.slotPicker}>
                {noteExerciseNames.map(name => (
                  <Pressable
                    key={name}
                    style={[styles.slotOption, oneKSelections[slot] === name && styles.slotOptionSelected]}
                    onPress={() => handleSelectExercise(slot, name)}
                  >
                    <Text style={[styles.slotOptionText, oneKSelections[slot] === name && styles.slotOptionTextSelected]}>
                      {name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {activeSlot === slot && noteExerciseNames.length === 0 && (
              <Text style={styles.slotEmpty}>Add exercises to your note first.</Text>
            )}
          </View>
        ))}
      </Card>

      <SectionTitle>Tracked Lifts</SectionTitle>
      <View style={styles.list}>
        {analytics?.signals?.length > 0 ? (
          analytics.signals.map((sig, i) => (
            <Card key={i} style={styles.signalCard}>
              <View style={styles.signalHeader}>
                <Text style={styles.signalName}>{sig.name}</Text>
                <Badge status={sig.progression_status}>
                  {formatStatus(sig.progression_status)}
                </Badge>
              </View>
              <View style={styles.signalMeta}>
                <View>
                  <Text style={styles.signalLabel}>Est. Max</Text>
                  <Text style={styles.signalValue}>
                    {sig.latest_pr ? `${sig.latest_pr.toFixed(0)} lb` : '—'}
                  </Text>
                </View>
                {sig.repeatability_score > 1 && (
                  <View>
                    <Text style={styles.signalLabel}>Sets</Text>
                    <Text style={styles.signalValue}>{sig.repeatability_score} sets</Text>
                  </View>
                )}
              </View>
            </Card>
          ))
        ) : (
          <Text style={styles.emptyText}>
            Tap the bookmark on any exercise in your note to track it here.
          </Text>
        )}
      </View>

      <SectionTitle>Totals</SectionTitle>
      <View style={styles.grid}>
        <StatCard label="Weight entries" value={weightSummary.weightCount} />
        <StatCard label="Workout sessions" value={workoutCount} />
      </View>
    </ScreenShell>
  );
}

function formatStatus(status) {
  switch (status) {
    case 'improved': return 'Improved';
    case 'held': return 'Held';
    case 'regressed': return 'Regressed';
    case 'first_session': return 'First';
    default: return '—';
  }
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  list: {
    gap: 12,
  },
  oneKCard: {
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  oneKLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  oneKValue: {
    fontSize: 48,
    fontWeight: '900',
    color: Colors.accent,
  },
  oneKBreakdown: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    paddingTop: 16,
  },
  oneKItem: {
    alignItems: 'center',
    gap: 2,
  },
  oneKItemValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  oneKItemLabel: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  infoCard: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 20,
  },
  infoText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  slotCard: {
    gap: 4,
    padding: 16,
  },
  slotCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  slotLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    width: 72,
  },
  slotValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  slotValue: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'right',
  },
  slotChevron: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  slotPicker: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    marginBottom: 4,
    overflow: 'hidden',
  },
  slotOption: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  slotOptionSelected: {
    backgroundColor: Colors.chipBackground,
  },
  slotOptionText: {
    fontSize: 14,
    color: Colors.text,
  },
  slotOptionTextSelected: {
    fontWeight: '700',
    color: Colors.accent,
  },
  slotEmpty: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  signalCard: {
    gap: 12,
  },
  signalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  signalName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  signalMeta: {
    flexDirection: 'row',
    gap: 32,
  },
  signalLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 2,
  },
  signalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    marginTop: 20,
    fontSize: 15,
  },
});
