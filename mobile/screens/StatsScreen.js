import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Card, SectionTitle, Badge, LineChart } from '../components/UI';
import { computeWeightTrends, computeWeightPaceLevel, computeWeightRollingAverageSeries, derive1kTotal, DEFAULT_1K_EXERCISES, isStrengthExerciseName, deriveSignals, normalizeLiftName } from '../lib/data';
import { formatSessionClassification } from '../lib/format';
import { useTrackedLifts, useWorkoutNotes, useWeightEntries } from '../hooks/useEntries';
import { parseWorkoutNote, countWorkoutSessions } from '../lib/parser';
import { Colors } from '../theme/colors';

export function StatsScreen({ multiplier, section }) {
  const { notes, currentNote, loading: loadingNotes, update: updateNote } = useWorkoutNotes();
  const { entries: hookWeightEntries, loading: loadingWeight } = useWeightEntries();
  const { trackedLifts, loading: loadingTracked } = useTrackedLifts();

  const [activeSlot, setActiveSlot] = useState(null); // 'bench' | 'squat' | 'deadlift'

  const scrollRef = useRef(null);
  const weightSectionY = useRef(0);
  const strengthSectionY = useRef(0);
  const pendingSection = useRef(section);
  const hasScrolled = useRef(false);

  const weightEntries = useMemo(() => {
    return (hookWeightEntries || []).filter(e => e && e.date && e.weight_value != null);
  }, [hookWeightEntries]);

  const isWeightLoading = loadingWeight && weightEntries.length === 0;
  const isNotesLoading = loadingNotes && notes.length === 0;
  const isTrackedLoading = loadingTracked && Object.keys(trackedLifts).length === 0;

  useEffect(() => {
    pendingSection.current = section;
    hasScrolled.current = false;
    
    // If we already have the layout position, scroll immediately
    if (section === 'weight' && weightSectionY.current > 0) {
      scrollRef.current?.scrollTo({ y: weightSectionY.current, animated: true });
      hasScrolled.current = true;
    } else if (section === 'strength' && strengthSectionY.current > 0) {
      scrollRef.current?.scrollTo({ y: strengthSectionY.current, animated: true });
      hasScrolled.current = true;
    }
  }, [section]);

  function handleWeightLayout(e) {
    const y = e.nativeEvent.layout.y;
    if (Math.abs(weightSectionY.current - y) < 1) return;
    weightSectionY.current = y;
    
    if (pendingSection.current === 'weight' && !hasScrolled.current) {
      scrollRef.current?.scrollTo({ y, animated: true });
      hasScrolled.current = true;
    }
  }

  function handleStrengthLayout(e) {
    const y = e.nativeEvent.layout.y;
    if (Math.abs(strengthSectionY.current - y) < 1) return;
    strengthSectionY.current = y;
    
    if (pendingSection.current === 'strength' && !hasScrolled.current) {
      scrollRef.current?.scrollTo({ y, animated: true });
      hasScrolled.current = true;
    }
  }

  // ... weightSummary and rollingSeries remain same but use weightEntries
  const weightSummary = useMemo(() => {
    if (weightEntries.length === 0) {
      return {
        latestWeight: '—',
        weightCount: '0',
        avg7: '—',
        avg30: '—',
        paceFlag: null,
        paceLevel: null,
      };
    }
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
    ...(currentNote?.one_k_exercises || {}),
  }), [currentNote]);

  const noteExerciseNames = useMemo(() => {
    if (!currentNote?.raw_text) return [];
    const { sections } = parseWorkoutNote(currentNote.raw_text);
    const names = sections.flatMap(s => s.exercises.map(e => e.name));
    return [...new Set(names)].filter(isStrengthExerciseName);
  }, [currentNote]);

  const analytics = useMemo(() => {
    // Collect sections from all routines for full history of tracked lifts
    const allSections = notes.flatMap(n => n?.raw_text ? parseWorkoutNote(n.raw_text).sections : []);
    
    // Identify lifts present in the current routine
    const currentSections = currentNote?.raw_text ? parseWorkoutNote(currentNote.raw_text).sections : [];
    const namesInCurrent = new Set(currentSections.flatMap(s => s.exercises.map(e => normalizeLiftName(e.name))));
    
    // Tracked lifts from the global store
    const globallyTrackedNames = Object.keys(trackedLifts).filter(k => trackedLifts[k]);
    
    // Filter to tracked lifts that also appear in current routine
    const visibleTrackedNames = globallyTrackedNames.filter(name => namesInCurrent.has(normalizeLiftName(name)));

    const { exercises: signals } = deriveSignals(allSections, visibleTrackedNames, multiplier);

    // Preserve original user-typed casing for display (last occurrence wins)
    const nameDisplayMap = new Map();
    allSections.forEach(s => s.exercises.forEach(e => {
      nameDisplayMap.set(normalizeLiftName(e.name), e.name);
    }));

    // Big Three 1RM total and workout count are scoped to the current routine per issue contract
    const oneK = derive1kTotal(currentSections, oneKSelections);
    const workoutDayCount = countWorkoutSessions(currentNote?.raw_text || '');

    return { signals, oneK, workoutDayCount, nameDisplayMap };
  }, [notes, currentNote, trackedLifts, oneKSelections, multiplier]);

  const workoutCount = useMemo(() => {
    return String(analytics?.workoutDayCount ?? 0);
  }, [analytics]);

  function handleSlotTap(slot) {
    setActiveSlot(prev => (prev === slot ? null : slot));
  }

  async function handleSelectExercise(slot, exerciseName) {
    if (!currentNote) return;
    const next = { ...oneKSelections, [slot]: exerciseName };
    await updateNote(currentNote.id, { one_k_exercises: next });
    setActiveSlot(null);
  }

  const SLOT_LABELS = { bench: 'Bench', squat: 'Squat', deadlift: 'Deadlift' };

  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.container}>
      <View style={styles.shellHeader}>
        <Text style={styles.shellTitle}>Analytics</Text>
        <Text style={styles.shellSubtitle}>Insights derived from your logs.</Text>
      </View>

      <View onLayout={handleWeightLayout}>
        <SectionTitle>Weight Trends</SectionTitle>
      </View>
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

        <View style={{ height: 100, justifyContent: 'center' }}>
          {rollingSeries.length > 0 ? (
            <LineChart data={rollingSeries} height={100} hideHeader />
          ) : (
            <View style={{ height: 100, backgroundColor: Colors.cardBorder, opacity: 0.05, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}>
               {isWeightLoading && <ActivityIndicator size="small" color={Colors.accent} />}
            </View>
          )}
        </View>

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

      <View onLayout={handleStrengthLayout} style={styles.strengthSection}>
        <SectionTitle>Strength</SectionTitle>
      {(isNotesLoading || analytics?.oneK?.total) ? (
        <Card style={[styles.oneKCard, isNotesLoading && { opacity: 0.5, minHeight: 160, justifyContent: 'center' }]}>
          {isNotesLoading ? (
            <ActivityIndicator size="large" color={Colors.accent} />
          ) : (
            <>
              <Text style={styles.oneKLabel}>1K Progress</Text>
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
            </>
          )}
        </Card>
      ) : (
        <Card style={styles.infoCard}>
          <Text style={styles.infoText}>
            Choose your squat, bench, and deadlift exercises below to track 1k progress.
          </Text>
        </Card>
      )}

      <Card style={styles.slotCard}>
        <Text style={styles.slotCardTitle}>Big 3 Mapping</Text>
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

      </View>

      <SectionTitle>Progressive Overload</SectionTitle>
      {(isNotesLoading || isTrackedLoading) ? (
        <View style={{ height: 100, justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : analytics?.signals?.length > 0 ? (
        <View style={styles.signalList}>
          {analytics.signals.map((sig, i) => {
            const normName = normalizeLiftName(sig.name);
            const classifLabel = formatSessionClassification(
              currentNote?.exercise_classifications?.[normName] ?? null
            );
            return (
            <View key={i} style={[styles.signalRow, i === analytics.signals.length - 1 && styles.signalRowLast]}>
              <View style={styles.signalRowTop}>
                <View style={styles.signalNameBlock}>
                  <Text style={styles.signalName}>{analytics.nameDisplayMap?.get(normName) || sig.name}</Text>
                  {classifLabel ? (
                    <Text style={[styles.classifBadge, classifBadgeColor(currentNote?.exercise_classifications?.[normName])]}>
                      {classifLabel}
                    </Text>
                  ) : null}
                </View>
                <Badge status={sig.progression_status}>
                  {formatStatus(sig.progression_status)}
                </Badge>
              </View>
              <View style={styles.signalMeta}>
                <View style={styles.signalMetaItem}>
                  <Text style={styles.signalValue}>{sig.latest_pr ? `${sig.latest_pr.toFixed(0)} lb` : '—'}</Text>
                  <Text style={styles.signalLabel}>1 Rep Max</Text>
                </View>
                <View style={styles.signalMetaItem}>
                  <Text style={styles.signalValue}>{sig.kilo_max != null ? `${sig.kilo_max} lb` : '—'}</Text>
                  <Text style={styles.signalLabel}>Kilo Max</Text>
                </View>
                <View style={styles.signalMetaItem}>
                  <Text style={styles.signalValue}>{sig.latest_top_weight ? `${sig.latest_top_weight} lb` : '—'}</Text>
                  <Text style={styles.signalLabel}>Top Weight</Text>
                </View>
                <View style={styles.signalMetaItem}>
                  <Text style={styles.signalValue}>{formatOverload(sig.overload_trend)}</Text>
                  <Text style={styles.signalLabel}>Progress</Text>
                </View>
              </View>
            </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.emptyText}>
          Tap the bookmark on any exercise in your note to track it here.
        </Text>
      )}
    </ScrollView>
  );
}

function formatStatus(status) {
  switch (status) {
    case 'improved': return 'Improved';
    case 'held': return 'Held';
    case 'regressed': return 'Regressed';
    case 'first_session': return 'Initial';
    default: return '—';
  }
}

function classifBadgeColor(label) {
  switch (label) {
    case 'progressing':  return { color: '#4ade80' };
    case 'regressing':   return { color: Colors.error };
    case 'stalled':      return { color: Colors.textMuted };
    case 'inconsistent': return { color: Colors.textMuted };
    default:             return {};
  }
}

function formatOverload(trend) {
  switch (trend) {
    case 'up': return '↑ Up';
    case 'flat': return '→ Flat';
    case 'down': return '↓ Down';
    case 'first_session': return 'Initial';
    default: return '—';
  }
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 120,
    gap: 16,
  },
  shellHeader: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 16,
    paddingBottom: 8,
    gap: 8,
  },
  shellTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
  },
  shellSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
  strengthSection: {
    gap: 16,
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
  signalList: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  signalRow: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  signalRowLast: {
    borderBottomWidth: 0,
  },
  signalRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  signalNameBlock: {
    flex: 1,
    gap: 2,
  },
  signalName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  classifBadge: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  signalMeta: {
    flexDirection: 'row',
  },
  signalMetaItem: {
    flex: 1,
  },
  signalLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  signalValue: {
    fontSize: 13,
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
