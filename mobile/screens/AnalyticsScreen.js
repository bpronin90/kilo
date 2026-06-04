import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ActivityIndicator, TextInput } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenShell } from '../components/ScreenShell';
import { Card, HeroMetric, SectionTitle, LineChart, ArtisanalPanel, SessionGauge } from '../components/UI';
import { deriveWeightGoalAnalytics, derive1kTotal, derive1kTotalSeries, DEFAULT_1K_EXERCISES, isStrengthExerciseName, deriveWorkoutNoteAnalytics, normalizeLiftName, deriveNonWeightedTrackedExerciseMetrics } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useWeightEntries, getNoteSections, useDeloadHistory } from '../hooks/useEntries';
import { normalizeExerciseKey, countWorkoutSessionsFromSections, sessionsSinceLastDeload } from '../lib/parser';
import { formatDuration } from '../lib/format';
import { Colors } from '../theme/colors';

// Interpolate hex color a→b by t (0..1). Mirrors HomeScreen's 1K progress gradient.
function lerpColor(a, b, t) {
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

export function AnalyticsScreen({ multiplier, section }) {
  const { notes, currentNote, loading: loadingNotes, update: updateNote } = useWorkoutNotes();
  const { entries: hookWeightEntries, loading: loadingWeight } = useWeightEntries();
  const { trackedLifts, loading: loadingTracked } = useTrackedLifts();
  const { history: deloadHistory } = useDeloadHistory();

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
  const rolling7 = rollingSeries || [];
  const rolling30 = rollingSeries30 || [];

  const weightSummary = useMemo(() => {
    if (weightEntries.length === 0) {
      return { latestWeightValue: '—', showUnit: false, weightCount: '0', avg7: '—', avg30: '—', paceFlag: null, paceLevel: null };
    }
    return {
      latestWeightValue: weightTrends.currentWeight !== null ? `${weightTrends.currentWeight}` : '—',
      showUnit: weightTrends.currentWeight !== null,
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
    const allSections = notes.flatMap(n => getNoteSections(n));
    const currentSections = getNoteSections(currentNote);
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
      currentSections.flatMap(s => s.exercises.map(e => normalizeExerciseKey(e.name)))
    );
    const globallyTrackedNames = Object.keys(trackedLifts).filter(k => trackedLifts[k]);
    const visibleTrackedNames = globallyTrackedNames.filter(
      name => namesInCurrent.has(normalizeExerciseKey(name))
    );

    // Canonical derivation: signals, nameDisplayMap, and perDaySignals from shared sections
    const { signals, nameDisplayMap, perDaySignals } = deriveWorkoutNoteAnalytics(allSections, visibleTrackedNames, multiplier);

    // Non-weighted metrics for reps-only and time-based exercises (from #165 derivation)
    const nonWeightedMetrics = deriveNonWeightedTrackedExerciseMetrics(allSections, visibleTrackedNames);

    // Big Three 1RM total is scoped to the current routine per issue contract
    const oneK = derive1kTotal(currentSections, oneKSelections);
    const oneKSeries = derive1kTotalSeries(currentSections, oneKSelections);

    return { signals, oneK, oneKSeries, nameDisplayMap, perDaySignals, nonWeightedMetrics };
  }, [parsedSections, trackedLifts, oneKSelections, multiplier]);

  const groupedSignals = useMemo(() => {
    const groups = [];
    const sections = parsedSections.currentSections;
    const signals = analytics.signals || [];
    const perDaySignals = analytics.perDaySignals || {};
    const normCanon = normalizeExerciseKey;
    const nameToSignal = new Map(signals.map(s => [normCanon(s.name), s]));

    // To detect multi-day exercises
    const exerciseGroupCount = new Map();
    sections.forEach(s => s.exercises.forEach(e => {
      const norm = normCanon(e.name);
      exerciseGroupCount.set(norm, (exerciseGroupCount.get(norm) || 0) + 1);
    }));

    sections.forEach(section => {
      let groupExercises = section.exercises
        .map(e => nameToSignal.get(normCanon(e.name)))
        .filter(Boolean);

      if (searchQuery) {
        groupExercises = groupExercises.filter(sig =>
          sig.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }

      if (groupExercises.length > 0) {
        groups.push({
          name: section.heading,
          exercises: groupExercises.map(sig => {
            const norm = normCanon(sig.name);
            const isMultiDay = exerciseGroupCount.get(norm) > 1;
            const canonName = normalizeExerciseKey(sig.name);

            return {
              ...sig,
              isMultiDay,
              currentDayHeading: section.heading,
              otherDays: sections
                .filter(s => s !== section && s.exercises.some(e => normCanon(e.name) === norm))
                .map(s => s.heading),
              daySignals: isMultiDay ? (perDaySignals[canonName] || null) : null,
            };
          })
        });
      }
    });
    return groups;
  }, [parsedSections, analytics.signals, analytics.perDaySignals, searchQuery]);

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

  const sessionCount = useMemo(
    () => countWorkoutSessionsFromSections(parsedSections.currentSections),
    [parsedSections.currentSections]
  );

  const sinceDeload = useMemo(
    () => sessionsSinceLastDeload(sessionCount, deloadHistory),
    [sessionCount, deloadHistory]
  );

  const oneKChartData = useMemo(
    () => (analytics.oneKSeries || []).map(p => ({
      value: Math.round(p.total),
      label: `#${p.session}`,
      unit: 'lb',
    })),
    [analytics.oneKSeries]
  );

  const screenContent = React.Children.toArray([
    <View key="weight-trends-title" onLayout={handleWeightLayout}>
      <SectionTitle>Weight Trends</SectionTitle>
    </View>,
    <Card key="weight-card" style={styles.weightCard}>
      <View style={styles.weightHeader}>
        <View>
          <Text style={styles.weightLabel}>Latest weigh-in</Text>
          <Text style={styles.weightValueLarge}>
            {weightSummary.latestWeightValue}
            {weightSummary.showUnit && <Text style={styles.weightUnit}>lb</Text>}
          </Text>
        </View>
        {weightSummary.paceFlag && (
          <View style={[styles.paceBadge, weightSummary.paceLevel === 'spike' ? styles.paceSpike : styles.paceNotable]}>
            <Text style={styles.paceText}>
              {weightSummary.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.chartBlock}>
        <Text style={styles.chartLabel}>7-day rolling average</Text>
        <View style={styles.chartArea}>
          {rolling7.length > 1 ? (
            <LineChart data={rolling7} height={100} hideHeader />
          ) : (
            <View style={styles.chartPlaceholder}>
              {isWeightLoading
                ? <ActivityIndicator size="small" color={Colors.accent} />
                : <Text style={styles.chartEmpty}>Not enough data</Text>}
            </View>
          )}
        </View>
      </View>

      <View style={styles.chartBlock}>
        <Text style={styles.chartLabel}>30-day rolling average</Text>
        <View style={styles.chartArea}>
          {rolling30.length > 1 ? (
            <LineChart data={rolling30} height={100} hideHeader color={Colors.textMuted} />
          ) : (
            <View style={styles.chartPlaceholder}>
              {isWeightLoading
                ? <ActivityIndicator size="small" color={Colors.accent} />
                : <Text style={styles.chartEmpty}>Not enough data</Text>}
            </View>
          )}
        </View>
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
    </Card>,

    <View key="deload-title">
      <SectionTitle>Session Health</SectionTitle>
    </View>,
    <View key="session-gauge" style={styles.statRow}>
      <SessionGauge count={sinceDeload} total={sessionCount} />
    </View>,

    <View key="strength-section" onLayout={handleStrengthLayout} style={styles.strengthSection}>
      <SectionTitle>Strength</SectionTitle>
    {(isNotesLoading || analytics?.oneK?.total) ? (
      <ArtisanalPanel style={[styles.oneKCard, isNotesLoading && { opacity: 0.5, minHeight: 160, justifyContent: 'center' }]}>
        {isNotesLoading ? (
          <ActivityIndicator size="large" color={Colors.accent} />
        ) : (
          <>
            <Text style={styles.oneKLabel}>1K Progress</Text>
            <Text style={[styles.oneKValue, { color: lerpColor('#d98d42', '#4a7c44', Math.min(1, (analytics.oneK.total || 0) / 1000)) }]}>
              {analytics.oneK.total.toFixed(0)}<Text style={styles.oneKUnit}>lb</Text>
            </Text>
            
            <View style={styles.oneKProgressBarContainer}>
              <View style={[styles.oneKProgressBar, { width: `${Math.min(100, (analytics.oneK.total / 1000) * 100)}%` }]} />
            </View>

            <View style={styles.oneKBreakdown}>
              <View style={styles.oneKItem}>
                <Text style={styles.oneKItemValue}>{analytics.oneK.squat?.toFixed(0) || '—'}</Text>
                <Text style={styles.oneKItemLabel}>Squats</Text>
              </View>
              <View style={styles.oneKItem}>
                <Text style={styles.oneKItemValue}>{analytics.oneK.bench?.toFixed(0) || '—'}</Text>
                <Text style={styles.oneKItemLabel}>Bench</Text>
              </View>
              <View style={styles.oneKItem}>
                <Text style={styles.oneKItemValue}>{analytics.oneK.deadlift?.toFixed(0) || '—'}</Text>
                <Text style={styles.oneKItemLabel}>Deadlifts</Text>
              </View>
            </View>

            {oneKChartData.length > 1 && (
              <View style={styles.oneKChartBlock}>
                <Text style={styles.oneKChartLabel}>1K total over sessions</Text>
                <LineChart data={oneKChartData} height={120} hideHeader />
              </View>
            )}
          </>
        )}
      </ArtisanalPanel>
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
            accessibilityRole="button"
            accessibilityLabel={`${SLOT_LABELS[slot]}, ${oneKSelections[slot]}, ${activeSlot === slot ? 'collapse' : 'expand'}`}
          >
            <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
            <View style={styles.slotValueRow}>
              <Text style={styles.slotValue}>{oneKSelections[slot]}</Text>
              <Text style={styles.slotChevron} accessible={false}>{activeSlot === slot ? '▲' : '▼'}</Text>
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
    </View>,

    <View 
      key="sticky-header"
      style={styles.signalStickyHeader} 
      testID="sticky-header" // Note: testID is used at runtime by stickyHeaderIndex calculation below
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
                    // For multi-day exercises, use per-day metrics for this row's heading.
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
                                {rowPr ? Math.round(rowPr) : '—'}
                                {rowPr ? <Text style={styles.unitSuffix}>lb</Text> : null}
                              </Text>
                            </View>
                            <View style={styles.metricCol}>
                              <Text style={styles.signalValue}>
                                {sig.kilo_max != null ? sig.kilo_max : '—'}
                                {sig.kilo_max != null ? <Text style={styles.unitSuffix}>lb</Text> : null}
                              </Text>
                            </View>
                            <View style={styles.metricCol}>
                              <Text style={styles.signalValue}>
                                {rowTopWeight ? rowTopWeight : '—'}
                                {rowTopWeight ? <Text style={styles.unitSuffix}>{rowIsBodyweight ? 'reps' : 'lb'}</Text> : null}
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
        Tap the bookmark on any exercise in your note to track it here.
      </Text>
    )
  ]);

  const foundIndex = screenContent.findIndex(child => child?.props?.testID === 'sticky-header');
  // foundIndex + 1 to account for ScreenShell's internal headerWrapper.
  // If not found, we pass an empty array to disable sticky behavior rather than sticking a random element.
  const stickyHeaderIndices = foundIndex !== -1 ? [foundIndex + 1] : [];

  return (
    <ScreenShell
      ref={scrollRef}
      title="Analytics"
      subtitle="Insights derived from your logs."
      stickyHeaderIndices={stickyHeaderIndices}
    >
      {screenContent}
    </ScreenShell>
  );
}

function CrossDayComparison({ daySignals, currentDay, otherDays }) {
  const allDays = currentDay ? [currentDay, ...otherDays] : otherDays;
  return (
    <View style={styles.crossDayRow}>
      {allDays.map((day, i) => {
        const d = daySignals[day];
        const trendColor = d?.overload_trend === 'up' ? Colors.success
          : d?.overload_trend === 'down' ? Colors.error
          : Colors.caution;
        const trendChar = d?.overload_trend === 'up' ? '↑'
          : d?.overload_trend === 'down' ? '↓'
          : d?.overload_trend === 'flat' ? '↔' : null;
        return (
          <React.Fragment key={day}>
            {i > 0 && <Text style={styles.crossDaySep}>·</Text>}
            <View style={styles.crossDayChip}>
              <Text style={[styles.crossDayChipLabel, day === currentDay && styles.crossDayChipLabelCurrent]}>
                {day ? day.slice(0, 3).toUpperCase() : '—'}
              </Text>
              <Text style={styles.crossDayChipValue}>
                {d?.latest_top_weight != null ? `${d.latest_top_weight}` : '—'}
                {d?.latest_top_weight != null && <Text style={styles.crossDayUnit}>{d.is_bodyweight ? 'reps' : 'lb'}</Text>}
              </Text>
              {trendChar && <Text style={[styles.crossDayTrend, { color: trendColor }]}>{trendChar}</Text>}
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

function formatOverload(trend) {
  switch (trend) {
    case 'up':   return <MaterialIcons name="arrow-upward"    size={16} color={Colors.success} />;
    case 'flat': return <Text style={{ color: Colors.caution, fontSize: 14 }}>↔</Text>;
    case 'dash': return <Text style={{ color: Colors.caution, fontSize: 18, fontWeight: '900', lineHeight: 22 }}>—</Text>;
    case 'down': return <MaterialIcons name="arrow-downward"  size={16} color={Colors.error}   />;
    case 'baseline':
    case 'first_session': return <MaterialIcons name="fiber-manual-record" size={8} color={Colors.textMuted} style={{ opacity: 0.4 }} />;
    default:     return <Text style={{ color: Colors.textMuted, fontSize: 14 }}>—</Text>;
  }
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    gap: 12,
  },
  strengthSection: {
    gap: 16,
  },
  weightCard: {
    padding: 20,
    gap: 16,
    backgroundColor: Colors.panelBackground,
  },
  chartBlock: {
    gap: 4,
  },
  chartLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chartArea: {
    height: 100,
    justifyContent: 'center',
  },
  chartPlaceholder: {
    height: 100,
    backgroundColor: Colors.subtleBg,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartEmpty: {
    fontSize: 13,
    color: Colors.textMuted,
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
    fontWeight: '800',
    color: Colors.accent,
  },
  weightUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginLeft: 4,
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
    backgroundColor: Colors.caution,
  },
  paceText: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textLight,
  },
  weightFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    paddingTop: 16,
  },
  weightStat: {
    flex: 1,
    alignItems: 'center',
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
    gap: 8,
    backgroundColor: Colors.panelBackground,
  },
  oneKLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  oneKValue: {
    ...HeroMetric.hero,
    color: Colors.text,
  },
  oneKUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textMuted,
    marginLeft: 4,
  },
  oneKProgressBarContainer: {
    width: '100%',
    height: 8,
    backgroundColor: Colors.divider,
    borderRadius: 4,
    marginVertical: 12,
    overflow: 'hidden',
  },
  oneKProgressBar: {
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 4,
  },
  oneKBreakdown: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  oneKChartBlock: {
    width: '100%',
    marginTop: 16,
  },
  oneKChartLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  oneKItem: {
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  oneKItemValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  oneKItemLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
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
    paddingBottom: 8,
  },
  searchContainer: {
    marginTop: 12,
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: Colors.inputBackground,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
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
  classifBadge: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginLeft: 8,
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
  crossDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    flexWrap: 'wrap',
    gap: 4,
  },
  crossDaySep: {
    fontSize: 11,
    color: Colors.textMuted,
    marginHorizontal: 2,
  },
  crossDayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  crossDayChipLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  crossDayChipLabelCurrent: {
    color: Colors.text,
  },
  crossDayChipValue: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  crossDayUnit: {
    fontSize: 11,
    opacity: 0.5,
  },
  crossDayTrend: {
    fontSize: 11,
    fontWeight: '700',
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
