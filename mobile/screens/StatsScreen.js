import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, Badge, LineChart } from '../components/UI';
import { computeWeightTrends, computeWeightPaceLevel, computeWeightRollingAverageSeries, derive1kTotal, DEFAULT_1K_EXERCISES, isStrengthExerciseName, deriveSignals } from '../lib/data';
import { useWorkoutNote, useWeightEntries } from '../hooks/useEntries';
import { parseWorkoutNote, countWorkoutSessions } from '../lib/parser';
import { Colors } from '../theme/colors';

export function StatsScreen({ multiplier }) {
  const { note, saveOneK } = useWorkoutNote();
  const { entries: weightEntries } = useWeightEntries();

  const [activeSlot, setActiveSlot] = useState(null); // 'bench' | 'squat' | 'deadlift'
  const [kiloMaxRawName, setKiloMaxRawName] = useState(null);

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
      paceLevel: computeWeightPaceLevel(weightEntries),
    };
  }, [weightEntries]);

  const rollingSeries = useMemo(() => {
    return computeWeightRollingAverageSeries(weightEntries, 7);
  }, [weightEntries]);

  const oneKSelections = useMemo(() => ({
    ...DEFAULT_1K_EXERCISES,
    ...(note?.one_k_exercises || {}),
  }), [note]);

  const noteExerciseNames = useMemo(() => {
    if (!note?.raw_text) return [];
    const { sections } = parseWorkoutNote(note.raw_text);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    return [...new Set(names)].filter(isStrengthExerciseName);
  }, [note]);

  const analytics = useMemo(() => {
    if (!note?.raw_text) return null;
    const { sections } = parseWorkoutNote(note.raw_text);
    const trackedNames = note.tracked_exercises || [];
    const { exercises: signals } = deriveSignals(sections, trackedNames, multiplier);
    const oneK = derive1kTotal(sections, oneKSelections);
    const workoutDayCount = countWorkoutSessions(note.raw_text);
    return { signals, oneK, workoutDayCount };
  }, [note, oneKSelections, multiplier]);

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
      <Card style={styles.weightCard}>
        <View style={styles.weightHeader}>
          <View>
            <Text style={styles.weightLabel}>Latest weigh-in</Text>
            <Text style={styles.weightValueLarge}>{weightSummary.latestWeight}</Text>
          </View>
          {weightSummary.paceFlag && (
            <View style={[styles.paceBadge, weightSummary.paceLevel === 'spike' ? styles.paceSpike : styles.paceNotable]}>
              <Text style={styles.paceText}>
                {weightSummary.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
              </Text>
            </View>
          )}
        </View>

        <LineChart data={rollingSeries} height={100} hideHeader />

        <View style={styles.weightFooter}>
          <View style={styles.weightStat}>
            <Text style={styles.weightStatValue}>{weightSummary.avg7}</Text>
            <Text style={styles.weightStatLabel}>7-day avg</Text>
          </View>
          <View style={styles.weightStat}>
            <Text style={styles.weightStatValue}>{weightSummary.avg30}</Text>
            <Text style={styles.weightStatLabel}>30-day avg</Text>
          </View>
        </View>
      </Card>

      <SectionTitle>Strength</SectionTitle>
      {analytics?.oneK?.total ? (
        <Card style={styles.oneKCard}>
          <Text style={styles.oneKLabel}>Big Three 1RM Total</Text>
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
        <Text style={styles.slotCardTitle}>Slot assignments</Text>
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
                  <Text style={styles.signalLabel}>Est. 1RM</Text>
                  <Text style={styles.signalValue}>
                    {sig.latest_pr ? `${sig.latest_pr.toFixed(0)} lb` : '—'}
                  </Text>
                </View>
                <Pressable onPress={() => setKiloMaxRawName(prev => prev === sig.name ? null : sig.name)}>
                  <Text style={styles.signalLabel}>Kilo max</Text>
                  <Text style={styles.signalValue}>
                    {kiloMaxRawName === sig.name && sig.kilo_max_raw != null
                      ? `${sig.kilo_max_raw} lb`
                      : (sig.kilo_max != null ? `${sig.kilo_max} lb` : '—')}
                  </Text>
                </Pressable>
                <View>
                  <Text style={styles.signalLabel}>Top weight</Text>
                  <Text style={styles.signalValue}>
                    {sig.latest_top_weight ? `${sig.latest_top_weight} lb` : '—'}
                  </Text>
                </View>
                <View>
                  <Text style={styles.signalLabel}>Overload</Text>
                  <Text style={styles.signalValue}>
                    {formatOverload(sig.overload_trend)}
                  </Text>
                </View>
              </View>
            </Card>
          ))
        ) : (
          <Text style={styles.emptyText}>
            Tap the bookmark on any exercise in your note to track it here.
          </Text>
        )}
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

function formatOverload(trend) {
  switch (trend) {
    case 'up': return '↑ Up';
    case 'flat': return '→ Flat';
    case 'down': return '↓ Down';
    case 'first_session': return 'First';
    default: return '—';
  }
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  weightCard: {
    padding: 20,
    gap: 16,
  },
  weightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  weightLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  weightValueLarge: {
    fontSize: 32,
    fontWeight: '900',
    color: Colors.accent,
  },
  paceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  paceSpike: {
    backgroundColor: Colors.error,
  },
  paceNotable: {
    backgroundColor: Colors.accent,
  },
  paceText: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textLight,
  },
  weightFooter: {
    flexDirection: 'row',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    paddingTop: 16,
  },
  weightStat: {
    gap: 2,
  },
  weightStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  weightStatLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
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
    flexWrap: 'wrap',
    gap: 16,
    rowGap: 12,
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
