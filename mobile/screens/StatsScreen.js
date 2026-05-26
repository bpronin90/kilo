import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, LineChart } from '../components/UI';
import { deriveWeightGoalAnalytics, derive1kTotal, DEFAULT_1K_EXERCISES, isStrengthExerciseName, deriveWorkoutNoteAnalytics, normalizeLiftName, getLatestRepDropOff } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useWeightEntries } from '../hooks/useEntries';
import { parseWorkoutNote, canonicalizeName } from '../lib/parser';
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

  const { trendSummary: weightTrends, paceLevel: weightPaceLevel, rollingSeries } = useMemo(
    () => deriveWeightGoalAnalytics(weightEntries, null),
    [weightEntries]
  );

  const weightSummary = useMemo(() => {
    if (weightEntries.length === 0) {
      return { latestWeight: '—', weightCount: '0', avg7: '—', avg30: '—', paceFlag: null, paceLevel: null };
    }
    return {
      latestWeight: weightTrends.currentWeight !== null ? `${weightTrends.currentWeight} lb` : '—',
      weightCount: String(weightEntries.length),
      avg7:  weightTrends.avg7  !== null ? `${weightTrends.avg7.toFixed(1)} lb`  : '—',
      avg30: weightTrends.avg30 !== null ? `${weightTrends.avg30.toFixed(1)} lb` : '—',
      paceFlag: weightTrends.paceFlag,
      paceLevel: weightPaceLevel,
    };
  }, [weightEntries.length, weightTrends, weightPaceLevel]);

  const oneKSelections = useMemo(() => ({
    ...DEFAULT_1K_EXERCISES,
    ...(currentNote?.one_k_exercises || {}),
  }), [currentNote]);

  // Parse sections once — single canonical source for all workout consumers in this screen
  const parsedSections = useMemo(() => {
    const allSections = notes.flatMap(n => n?.raw_text ? parseWorkoutNote(n.raw_text).sections : []);
    const currentSections = currentNote?.raw_text ? parseWorkoutNote(currentNote.raw_text).sections : [];
    return { allSections, currentSections };
  }, [notes, currentNote]);

  const noteExerciseNames = useMemo(() => {
    const names = parsedSections.currentSections.flatMap(s => s.exercises.map(e => e.name));
    return [...new Set(names)].filter(isStrengthExerciseName);
  }, [parsedSections]);

  const analytics = useMemo(() => {
    const { allSections, currentSections } = parsedSections;

    // Tracked lifts visible in the current routine — canonicalize exercise names so
    // alias variants in the note (e.g. 'DB Bench' for 'DB Bench Press') still match
    // tracked lift names stored under the canonical form.
    const namesInCurrent = new Set(
      currentSections.flatMap(s => s.exercises.map(e => normalizeLiftName(canonicalizeName(e.name))))
    );
    const globallyTrackedNames = Object.keys(trackedLifts).filter(k => trackedLifts[k]);
    const visibleTrackedNames = globallyTrackedNames.filter(
      name => namesInCurrent.has(normalizeLiftName(canonicalizeName(name)))
    );

    // Canonical derivation: signals, nameDisplayMap, and live repDropOffFlags from shared sections
    const { signals, nameDisplayMap, repDropOffFlags } = deriveWorkoutNoteAnalytics(allSections, visibleTrackedNames, multiplier);

    // Big Three 1RM total is scoped to the current routine per issue contract
    const oneK = derive1kTotal(currentSections, oneKSelections);

    return { signals, oneK, nameDisplayMap, repDropOffFlags };
  }, [parsedSections, trackedLifts, oneKSelections, multiplier]);

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

  const hasSignals = !isNotesLoading && !isTrackedLoading && analytics?.signals?.length > 0;

  return (
    <ScreenShell
      ref={scrollRef}
      title="Analytics"
      subtitle="Insights derived from your logs."
      stickyHeaderIndices={[4]}
    >
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

      <View style={styles.signalStickyHeader}>
        <SectionTitle>Progressive Overload</SectionTitle>
        {hasSignals && (
          <View style={styles.signalColumnHeader}>
            <Text style={[styles.signalColumnLabel, styles.signalColumnName]}>Exercise</Text>
            <View style={styles.signalColumnMetrics}>
              <Text style={styles.signalColumnLabel}>1 Rep Max</Text>
              <Text style={styles.signalColumnLabel}>Kilo Max</Text>
              <Text style={styles.signalColumnLabel}>Top Wt</Text>
              <Text style={[styles.signalColumnLabel, styles.signalColumnProgress]}>Trend</Text>
            </View>
          </View>
        )}
      </View>
      {(isNotesLoading || isTrackedLoading) ? (
        <View style={{ height: 100, justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : analytics?.signals?.length > 0 ? (
        <View style={styles.signalList}>
          {analytics.signals.map((sig, i) => {
            const normName = normalizeLiftName(sig.name);
            const dropOffFlag = getLatestRepDropOff(analytics.repDropOffFlags?.[normName]);
            const dropOffLabel = dropOffFlag === 'hit_wall' ? '⚠ Hit wall' : null;
            return (
            <View key={i} style={[styles.signalRow, i === analytics.signals.length - 1 && styles.signalRowLast]}>
              <View style={styles.signalRowInner}>
                <View style={styles.signalNameBlock}>
                  <Text style={styles.signalName}>{analytics.nameDisplayMap?.get(normName) || sig.name}</Text>
                  {dropOffLabel ? (
                    <Text style={[styles.classifBadge, dropOffBadgeColor(dropOffFlag)]}>
                      {dropOffLabel}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.signalMetrics}>
                  <Text style={styles.signalValue}>{sig.latest_pr ? `${sig.latest_pr.toFixed(0)} lb` : '—'}</Text>
                  <Text style={styles.signalValue}>{sig.kilo_max != null ? `${sig.kilo_max} lb` : '—'}</Text>
                  <Text style={styles.signalValue}>{sig.latest_top_weight ? (sig.is_bodyweight ? `${sig.latest_top_weight} reps` : `${sig.latest_top_weight} lb`) : '—'}</Text>
                  <Text style={[styles.signalValue, styles.signalProgress, overloadColor(sig.overload_trend)]}>
                    {formatOverload(sig.overload_trend)}
                  </Text>
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
    </ScreenShell>
  );
}

function dropOffBadgeColor(flag) {
  if (flag === 'hit_wall') return { color: Colors.error };
  return {};
}

function classifBadgeColor(label) {
  switch (label) {
    case 'progressing':  return { color: '#4ade80' };
    case 'initial':
    case 'stalled':
    case 'inconsistent': return { color: Colors.textMuted };
    default:             return {};
  }
}

function formatOverload(trend) {
  switch (trend) {
    case 'up': return '↑';
    case 'flat': return '↔';
    case 'down': return '↓';
    default: return '—';
  }
}

function overloadColor(trend) {
  switch (trend) {
    case 'up': return { color: '#4ade80' };
    case 'down': return { color: Colors.error };
    default: return { color: Colors.textMuted };
  }
}

const styles = StyleSheet.create({
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
  signalStickyHeader: {
    backgroundColor: Colors.background,
    paddingBottom: 2,
  },
  signalColumnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.cardBorder,
  },
  signalColumnLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  signalColumnName: {
    flex: 2,
  },
  signalColumnMetrics: {
    flex: 3,
    flexDirection: 'row',
  },
  signalColumnProgress: {
    textAlign: 'center',
  },
  signalList: {
    backgroundColor: Colors.card,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  signalRow: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  signalRowLast: {
    borderBottomWidth: 0,
  },
  signalRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  signalNameBlock: {
    flex: 2,
    gap: 2,
    paddingRight: 8,
  },
  signalName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  classifBadge: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  signalMetrics: {
    flex: 3,
    flexDirection: 'row',
  },
  signalValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
  signalProgress: {
    textAlign: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    marginTop: 20,
    fontSize: 15,
  },
});
