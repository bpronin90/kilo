import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ActivityIndicator, TextInput } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ScreenShell } from '../components/ScreenShell';
import { HeroMetric, SectionTitle, SessionGauge, ArtisanalPanel } from '../components/UI';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { deriveWeightGoalAnalytics, DEFAULT_1K_EXERCISES, normalizeLiftName, deriveCheckInHistory, deriveRoutineStatus } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useWeightEntries, useDeloadHistory, useFeatureToggles } from '../hooks/useEntries';
import {
  deriveParsedSections,
  deriveNoteExerciseNames,
  deriveAnalytics,
  deriveGroupedSignals,
  deriveOneKChartData,
  deriveRoutineStartBoundaries,
  shapeEditCheckInData,
} from './analytics/analyticsDerivations';
import { formatDuration } from '../lib/format';
import { Colors } from '../theme/colors';

import { lerpColor } from '../lib/AnalyticsScreenHelpers';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue, formatLiftWeightValue, displayChartSeries, lbToKg } from '../lib/units';
import { AnalyticsWeightTrendsCard } from '../components/AnalyticsWeightTrendsCard';
import { AnalyticsFatigueCard } from '../components/AnalyticsFatigueCard';
import { AnalyticsStrengthSection } from '../components/AnalyticsStrengthSection';
import { CrossDayComparison, formatOverload } from '../components/AnalyticsCrossDayComparison';

export function AnalyticsScreen({ multiplier, section }) {
  const { notes, currentNote, loading: loadingNotes, update: updateNote } = useWorkoutNotes();
  const [editPendingCheckIn, setEditPendingCheckIn] = useState(null); // { ci, note }
  const [fatigueExpanded, setFatigueExpanded] = useState(false);
  const { entries: hookWeightEntries, loading: loadingWeight } = useWeightEntries();
  const { trackedLifts, loading: loadingTracked } = useTrackedLifts();
  const { history: deloadHistory } = useDeloadHistory();
  const { fatigueTrackingEnabled, deloadModeEnabled } = useFeatureToggles();
  const unit = useWeightUnit();

  const [activeSlot, setActiveSlot] = useState(null); // 'bench' | 'squat' | 'deadlift'
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

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

  // null goal: Analytics renders trend data only, not goal-relative info
  const { trendSummary: weightTrends, paceLevel: weightPaceLevel, rollingSeries, rollingSeries30 } = useMemo(
    () => deriveWeightGoalAnalytics(weightEntries, null),
    [weightEntries]
  );
  // Chart series are converted into display space here (identity in lb mode)
  // so LineChart selection labels and the trends card read in the selected unit.
  const rolling7 = useMemo(() => displayChartSeries(rollingSeries || [], unit), [rollingSeries, unit]);
  const rolling30 = useMemo(() => displayChartSeries(rollingSeries30 || [], unit), [rollingSeries30, unit]);

  const weightSummary = useMemo(() => {
    if (weightEntries.length === 0) {
      return { latestWeightValue: '—', showUnit: false, weightCount: '0', avg7: '—', avg30: '—', paceFlag: null, paceLevel: null };
    }
    return {
      latestWeightValue: weightTrends.currentWeight !== null ? formatBodyweightValue(weightTrends.currentWeight, unit) : '—',
      showUnit: weightTrends.currentWeight !== null,
      weightCount: String(weightEntries.length),
      avg7:  weightTrends.avg7  !== null ? `${displayWeight(weightTrends.avg7, unit).toFixed(1)} ${unit}`  : '—',
      avg30: weightTrends.avg30 !== null ? `${displayWeight(weightTrends.avg30, unit).toFixed(1)} ${unit}` : '—',
      paceFlag: weightTrends.paceFlag,
      paceLevel: weightPaceLevel,
    };
  }, [weightEntries.length, weightTrends, weightPaceLevel, unit]);

  const oneKSelections = useMemo(() => ({
    ...DEFAULT_1K_EXERCISES,
    ...(currentNote?.one_k_exercises || {}),
  }), [currentNote]);

  const parsedSections = useMemo(() => deriveParsedSections(notes, currentNote), [notes, currentNote]);

  const noteExerciseNames = useMemo(() => deriveNoteExerciseNames(parsedSections.currentSections), [parsedSections]);

  const analytics = useMemo(
    () => deriveAnalytics(parsedSections, trackedLifts, oneKSelections, multiplier),
    [parsedSections, trackedLifts, oneKSelections, multiplier]
  );

  const groupedSignals = useMemo(
    () => deriveGroupedSignals(parsedSections, analytics, searchQuery),
    [parsedSections, analytics, searchQuery]
  );

  function handleSlotTap(slot) {
    setActiveSlot(prev => (prev === slot ? null : slot));
  }

  function toggleGroup(groupName) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  }

  async function handleSelectExercise(slot, exerciseName) {
    if (!currentNote) return;
    const next = { ...oneKSelections, [slot]: exerciseName };
    await updateNote(currentNote.id, { one_k_exercises: next });
    setActiveSlot(null);
  }

  const SLOT_LABELS = { bench: 'Bench', squat: 'Squat', deadlift: 'Deadlift' };

  const routineStatus = useMemo(
    () => deriveRoutineStatus(parsedSections.currentSections, currentNote, deloadHistory),
    [parsedSections.currentSections, currentNote, deloadHistory]
  );
  const sessionCount = routineStatus.sessionsLogged;
  const sinceDeload = routineStatus.sessionsSinceDeload;

  const checkInHistory = useMemo(() => deriveCheckInHistory(notes), [notes]);

  const noteById = useMemo(() => new Map(notes.map(n => [n.id, n])), [notes]);

  function handleCheckInEdit(ci) {
    const note = noteById.get(ci.noteId);
    if (!note) return;
    setEditPendingCheckIn({ ci, note });
  }

  const oneKChartData = useMemo(() => {
    const boundaries = deriveRoutineStartBoundaries(notes, oneKSelections);
    const series = deriveOneKChartData(analytics.oneKSeries, boundaries);
    if (unit !== 'kg') return series;
    // Display-space conversion for kg (#441): per-lift breakdown values ride
    // along with each point, so convert them alongside the plotted total.
    return series.map((p) => ({
      ...p,
      value: Math.round(lbToKg(p.value)),
      unit: 'kg',
      bench: p.bench != null ? lbToKg(p.bench) : p.bench,
      squat: p.squat != null ? lbToKg(p.squat) : p.squat,
      deadlift: p.deadlift != null ? lbToKg(p.deadlift) : p.deadlift,
    }));
  }, [analytics.oneKSeries, notes, oneKSelections, unit]);

  // 1K card values in display space (identity in lb mode). The 1,000 lb club
  // itself stays lb-defined; AnalyticsStrengthSection converts its progress
  // target the same way.
  const displayOneK = useMemo(() => {
    const oneK = analytics.oneK;
    if (unit !== 'kg' || !oneK) return oneK;
    return {
      ...oneK,
      total: oneK.total != null ? lbToKg(oneK.total) : oneK.total,
      squat: oneK.squat != null ? lbToKg(oneK.squat) : oneK.squat,
      bench: oneK.bench != null ? lbToKg(oneK.bench) : oneK.bench,
      deadlift: oneK.deadlift != null ? lbToKg(oneK.deadlift) : oneK.deadlift,
    };
  }, [analytics.oneK, unit]);

  const screenContent = React.Children.toArray([
    <AnalyticsWeightTrendsCard
      key="weight-trends-card"
      handleWeightLayout={handleWeightLayout}
      weightSummary={weightSummary}
      rolling7={rolling7}
      rolling30={rolling30}
      isWeightLoading={isWeightLoading}
    />,

    <View key="combined-section-title">
      <SectionTitle>Fatigue</SectionTitle>
    </View>,
    <SessionGauge key="session-gauge" count={sinceDeload} total={sessionCount} showDeload={deloadModeEnabled} />,

    fatigueTrackingEnabled ? (
      <AnalyticsFatigueCard
        key="fatigue-card"
        checkInHistory={checkInHistory}
        fatigueExpanded={fatigueExpanded}
        setFatigueExpanded={setFatigueExpanded}
        handleCheckInEdit={handleCheckInEdit}
      />
    ) : null,

    <AnalyticsStrengthSection
      key="strength-section"
      handleStrengthLayout={handleStrengthLayout}
      isNotesLoading={isNotesLoading}
      oneK={displayOneK}
      oneKChartData={oneKChartData}
      activeSlot={activeSlot}
      handleSlotTap={handleSlotTap}
      SLOT_LABELS={SLOT_LABELS}
      oneKSelections={oneKSelections}
      noteExerciseNames={noteExerciseNames}
      handleSelectExercise={handleSelectExercise}
    />,

    <View 
      key="sticky-header"
      style={styles.signalStickyHeader} 
      testID="sticky-header"
    >
      <SectionTitle>Progressive Overload</SectionTitle>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search tracked exercises..."
          placeholderTextColor={Colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
      </View>
      <View style={styles.signalColumnHeader}>
        <View style={styles.signalColumnMetrics}>
          <Text style={styles.signalColumnLabel}>1RM</Text>
          <Text style={styles.signalColumnLabel}>Kilo</Text>
          <Text style={styles.signalColumnLabel}>Best</Text>
          <Text style={styles.signalColumnLabel}>Trend</Text>
        </View>
      </View>
    </View>,

    (isNotesLoading || isTrackedLoading) ? (
      <View key="loading" style={{ height: 100, justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    ) : groupedSignals.length > 0 ? (
      <ArtisanalPanel key="po-container" style={styles.poContainer}>
        {groupedSignals.map((group, groupIdx) => {
          const isCollapsed = collapsedGroups.has(group.name);
          return (
            <View key={group.name} style={[styles.groupSection, groupIdx > 0 && styles.groupSectionBorder]}>
              <Pressable 
                onPress={() => toggleGroup(group.name)}
                style={styles.groupHeader}
              >
                <Text style={styles.groupName}>{group.name}</Text>
                <MaterialIcons 
                  name={isCollapsed ? "expand-more" : "expand-less"} 
                  size={20} 
                  color={Colors.textMuted} 
                />
              </Pressable>
              
              {!isCollapsed && (
                <View style={styles.exerciseList}>
                  {group.exercises.map((sig) => {
                    const normName = normalizeLiftName(sig.name);
                    const dayRow = sig.isMultiDay && sig.daySignals ? sig.daySignals[sig.currentDayHeading] : null;
                    const rowPr = dayRow ? dayRow.latest_pr : sig.latest_pr;
                    const rowTopWeight = dayRow ? dayRow.latest_top_weight : sig.latest_top_weight;
                    const rowTrend = dayRow?.overload_trend ?? sig.overload_trend;
                    const rowIsBodyweight = dayRow ? dayRow.is_bodyweight : sig.is_bodyweight;
                    const nw = analytics.nonWeightedMetrics?.[normName];

                    return (
                      <View key={normName + sig.currentDayHeading} style={[styles.signalRow, styles.signalRowBorder]}>
                        <View style={styles.signalNameRow}>
                          <Text style={styles.signalName}>{analytics.nameDisplayMap?.get(normName) || sig.name}</Text>
                        </View>

                        {nw ? (
                          <View style={styles.signalMetricsGrid}>
                            <View style={styles.metricCol}>
                              <Text style={styles.signalValue}>
                                {nw.exercise_class === 'reps_only' 
                                  ? (nw.avg_reps ?? '—')
                                  : formatDuration(nw.avg_hold)}
                              </Text>
                              <Text style={styles.nwMetricLabel}>AVG</Text>
                            </View>
                            <View style={styles.metricCol}>
                              <Text style={styles.signalValue}>
                                {nw.exercise_class === 'reps_only' 
                                  ? (nw.best_set_reps ?? '—')
                                  : formatDuration(nw.best_hold)}
                              </Text>
                              <Text style={styles.nwMetricLabel}>BEST</Text>
                            </View>
                            <View style={styles.metricCol} />
                            <View style={styles.metricCol}>
                              {formatOverload(nw.exercise_class === 'reps_only' ? nw.reps_arrow : nw.hold_arrow)}
                            </View>
                          </View>
                        ) : (
                          <View style={styles.signalMetricsGrid}>
                            <View style={styles.metricCol}>
                              <Text style={styles.signalValue}>
                                {rowPr ? formatLiftWeightValue(Math.round(rowPr), unit) : '—'}
                                {rowPr ? <Text style={styles.unitSuffix}>{unit}</Text> : null}
                              </Text>
                            </View>
                            <View style={styles.metricCol}>
                              <Text style={styles.signalValue}>
                                {sig.kilo_max != null ? formatLiftWeightValue(sig.kilo_max, unit) : '—'}
                                {sig.kilo_max != null ? <Text style={styles.unitSuffix}>{unit}</Text> : null}
                              </Text>
                            </View>
                            <View style={styles.metricCol}>
                              <Text style={styles.signalValue}>
                                {rowTopWeight ? (rowIsBodyweight ? rowTopWeight : formatLiftWeightValue(rowTopWeight, unit)) : '—'}
                                {rowTopWeight ? <Text style={styles.unitSuffix}>{rowIsBodyweight ? 'reps' : unit}</Text> : null}
                              </Text>
                            </View>
                            <View style={styles.metricCol}>
                              {formatOverload(rowTrend)}
                            </View>
                          </View>
                        )}

                        {sig.isMultiDay && (
                          sig.daySignals
                            ? <CrossDayComparison daySignals={sig.daySignals} currentDay={sig.currentDayHeading} otherDays={sig.otherDays} />
                            : sig.otherDays.length > 0 && <Text style={styles.multiDaySummary}>Also on {sig.otherDays.join(', ')}</Text>
                        )}

                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ArtisanalPanel>
    ) : searchQuery ? (
      <View key="empty-search" style={styles.emptySearch}>
        <Text style={styles.emptyText}>No matches for "{searchQuery}"</Text>
      </View>
    ) : (
      <Text key="empty-tracked" style={styles.emptyText}>
        Tap Track on any exercise in your note to track it here.
      </Text>
    )
  ]);

  const foundIndex = screenContent.findIndex(child => child?.props?.testID === 'sticky-header');
  const stickyHeaderIndices = foundIndex !== -1 ? [foundIndex + 1] : [];

  const editCheckInData = shapeEditCheckInData(editPendingCheckIn);

  return (
    <>
      <ScreenShell
        ref={scrollRef}
        title="Analytics"
        subtitle="Insights derived from your logs."
        stickyHeaderIndices={stickyHeaderIndices}
      >
        {screenContent}
      </ScreenShell>
      <SessionCheckInModal
        visible={fatigueTrackingEnabled && editPendingCheckIn != null}
        checkInData={editCheckInData}
        currentId={editPendingCheckIn?.note?.id ?? null}
        currentNote={editPendingCheckIn?.note ?? null}
        update={updateNote}
        onClose={() => setEditPendingCheckIn(null)}
        isEdit
      />
    </>
  );
}

const styles = StyleSheet.create({
  signalStickyHeader: {
    backgroundColor: Colors.background,
    paddingTop: 8,
    paddingBottom: 8,
  },
  searchContainer: {
    marginTop: 12,
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
  },
  signalColumnHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  signalColumnLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  signalColumnMetrics: {
    flex: 1,
    flexDirection: 'row',
  },
  poContainer: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  groupSection: {
    paddingBottom: 4,
  },
  groupSectionBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.subtleBg,
  },
  groupName: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  exerciseList: {
    paddingHorizontal: 16,
  },
  signalRow: {
    paddingVertical: 16,
  },
  signalRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  signalNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  signalName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  signalMetricsGrid: {
    flexDirection: 'row',
  },
  metricCol: {
    flex: 1,
    alignItems: 'center',
  },
  signalValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  unitSuffix: {
    fontSize: 11,
    opacity: 0.4,
    marginLeft: 2,
  },
  nwMetricLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  multiDaySummary: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  emptySearch: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    marginTop: 20,
    fontSize: 15,
  },
});
