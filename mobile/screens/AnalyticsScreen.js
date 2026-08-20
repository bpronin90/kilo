import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ActivityIndicator, TextInput } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ScreenShell } from '../components/ScreenShell';
import { HeroMetric, SectionTitle, SessionGauge, ArtisanalPanel, ErrorBanner } from '../components/UI';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { deriveWeightGoalAnalytics, DEFAULT_1K_EXERCISES, normalizeLiftName, deriveCheckInHistory, deriveRoutineStatus } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useWeightEntries, useDeloadHistory, useFeatureToggles, useRecoveryBlockState } from '../hooks/useEntries';
import { useRecoveryAnalyticsFilter } from '../hooks/entries/recoveryBlockHooks';
import { isLiveRecord } from '../lib/data/recoveryBlocks';
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
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

import { lerpColor } from '../lib/AnalyticsScreenHelpers';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue, formatLiftWeightValue, displayChartSeries, lbToKg } from '../lib/units';
import { AnalyticsWeightTrendsCard } from '../components/AnalyticsWeightTrendsCard';
import { AnalyticsFatigueCard } from '../components/AnalyticsFatigueCard';
import { AnalyticsStrengthSection } from '../components/AnalyticsStrengthSection';
import { CrossDayComparison, formatOverload } from '../components/AnalyticsCrossDayComparison';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';

// The one section id that needs no measurement: "the top of Analytics" (#770).
// `Full history and insights` on Home requests it, and it is what makes that
// control differ from a plain Analytics tab press, which deliberately preserves
// whatever the user was last looking at.
const OVERVIEW_SECTION = 'overview';

export function AnalyticsScreen({ multiplier, section, sectionNonce, onNavigate }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const {
    notes,
    currentNote,
    loading: loadingNotes,
    error: notesError,
    refresh: refreshNotes,
    update: updateNote,
  } = useWorkoutNotes();
  const [editPendingCheckIn, setEditPendingCheckIn] = useState(null); // { ci, note }
  const [fatigueExpanded, setFatigueExpanded] = useState(false);
  const {
    entries: hookWeightEntries,
    loading: loadingWeight,
    error: weightError,
    refresh: refreshWeightEntries,
  } = useWeightEntries();
  const { trackedLifts, loading: loadingTracked } = useTrackedLifts();
  const { history: deloadHistory } = useDeloadHistory();
  const { fatigueTrackingEnabled, deloadModeEnabled } = useFeatureToggles();
  // Same authoritative Recovery snapshot the Log screen renders from (#716).
  // The hook is backed by one shared store, so while both tabs are mounted they
  // cannot disagree, and `recoveryReady` keeps an unread snapshot from being
  // presented here as "no recovery blocks".
  const {
    blocks: recoveryBlocks = [],
    weeks: recoveryWeeks = [],
    ready: recoveryReady = true,
    loading: recoveryStateLoading = false,
    refreshing: recoveryRefreshing = false,
    stale: recoveryStale = false,
    error: recoveryStateError = null,
    mutationsAllowed: recoveryMutationsAllowed = true,
    pendingRecovery: recoveryPendingRecovery = [],
    retryRecovery: retryRecoveryState,
  } = useRecoveryBlockState() || {};
  // Ordinary-analytics boundary (#699). Recovery-linked notes whose block keeps
  // `include_in_normal_analytics` off are dropped from every ordinary population
  // below. AnalyticsRecoverySection still receives the unfiltered `notes`.
  const recoveryFilter = useRecoveryAnalyticsFilter();
  const unit = useWeightUnit();

  const [activeSlot, setActiveSlot] = useState(null); // 'bench' | 'squat' | 'deadlift'
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  const scrollRef = useRef(null);
  // Measured top of every targetable section, keyed by the shell's bounded
  // section id (#770). A section is only scrollable to once its own onLayout
  // has reported where it is, so an id missing from this map means "requested
  // destination not laid out yet" — the request stays pending and is fulfilled
  // by the layout that resolves it, never by guessing a position.
  const sectionOffsets = useRef({});
  // Progressive Overload's offset is derived from two boxes rather than read
  // off one; see handleProgressiveOverloadHeaderLayout. Both start null so an
  // unmeasured box is never mistaken for a measured zero.
  const overloadHeaderHeight = useRef(null);
  const overloadListY = useRef(null);
  const pendingSection = useRef(section);
  const hasScrolled = useRef(false);

  const weightEntries = useMemo(() => {
    return (hookWeightEntries || []).filter(e => e && e.date && e.weight_value != null);
  }, [hookWeightEntries]);

  // A failed read must not be laundered into a permanent loading state (#737).
  // useWorkoutNotes/useWeightEntries both clear `loading` and leave the
  // collection empty when a read fails, so without this the affected cards
  // would sit on their "Not enough data" copy forever with nothing on screen
  // saying why or offering a retry.
  const isWeightLoading = loadingWeight && !weightError && weightEntries.length === 0;
  // An unverified recovery boundary (#699) counts as notes-not-ready: the 1K
  // card and the Progressive Overload list are both derived from a note
  // population that is not yet known to be correct, so they hold their loading
  // state rather than painting aggregates that may include excluded work. The
  // Recovery, weight, and fatigue sections do not depend on the boundary and are
  // deliberately left alone.
  const isNotesLoading = (loadingNotes && !notesError && notes.length === 0) || !recoveryFilter.ready;
  const isTrackedLoading = loadingTracked && Object.keys(trackedLifts).length === 0;

  function scrollToOffset(y) {
    scrollRef.current?.scrollTo({ y, animated: true });
    hasScrolled.current = true;
  }

  useEffect(() => {
    pendingSection.current = section;
    hasScrolled.current = false;
    if (!section) return;

    // The overview is the top of the tab, so its position is known without
    // measurement and an `overview` request lands immediately. Every other
    // destination waits for its layout.
    if (section === OVERVIEW_SECTION) {
      scrollToOffset(0);
      return;
    }

    const y = sectionOffsets.current[section];
    if (y > 0) scrollToOffset(y);
    // `sectionNonce` changes on every navigation request, so repeating the same
    // handoff (weight → weight) re-targets the section instead of no-op'ing.
  }, [section, sectionNonce]);

  // One measurement path for every targetable section (#770). The layout that
  // resolves a still-pending request fulfills it; `hasScrolled` keeps a later
  // reflow of the same section from yanking the user back after they land.
  function recordSectionOffset(id, y) {
    const known = sectionOffsets.current[id];
    if (known != null && Math.abs(known - y) < 1) return;
    sectionOffsets.current[id] = y;

    if (pendingSection.current === id && !hasScrolled.current) scrollToOffset(y);
  }

  // Named per section rather than passed as one generic handler: the weight and
  // strength anchors are props of components outside this issue's scope, so
  // their prop names and one-argument shape stay exactly as they were.
  function handleWeightLayout(e) {
    recordSectionOffset('weight', e.nativeEvent.layout.y);
  }

  function handleStrengthLayout(e) {
    recordSectionOffset('strength', e.nativeEvent.layout.y);
  }

  function handleRecoveryLayout(e) {
    recordSectionOffset('recovery', e.nativeEvent.layout.y);
  }

  // Progressive Overload is the one destination that cannot report its own
  // position: its header is a sticky header, and ScrollView lays a sticky child
  // out inside a wrapper of its own, so the header's `onLayout` reports a
  // position relative to that wrapper (y: 0) rather than a content offset. Its
  // HEIGHT is still true, and the list beneath it is an ordinary child with an
  // ordinary offset — so the destination is the list's top minus the header's
  // height, which parks the pinned header at the top of the viewport with the
  // first exercise row directly beneath it. Both measurements are needed and
  // either can arrive first, so whichever completes the pair is the one that
  // resolves a pending request. Acting on the list alone would scroll a header
  // height too far and then be unable to correct itself: the pending request is
  // already spent by the time the real height shows up.
  function handleProgressiveOverloadHeaderLayout(e) {
    overloadHeaderHeight.current = e.nativeEvent.layout.height;
    resolveOverloadOffset();
  }

  function handleProgressiveOverloadListLayout(e) {
    overloadListY.current = e.nativeEvent.layout.y;
    resolveOverloadOffset();
  }

  function resolveOverloadOffset() {
    if (overloadListY.current == null || overloadHeaderHeight.current == null) return;
    recordSectionOffset(
      'progressive-overload',
      Math.max(0, overloadListY.current - overloadHeaderHeight.current)
    );
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

  const parsedSections = useMemo(
    () => deriveParsedSections(notes, currentNote, recoveryFilter.excludedNoteIds),
    [notes, currentNote, recoveryFilter]
  );

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

  // Bulk collapse for Progressive Overload. `groupedSignals` is the same list
  // the rows render from, so the control always acts on exactly what is on
  // screen — including while a search query is narrowing the groups. Expanding
  // clears the whole set rather than only the visible names, so a group hidden
  // behind a search filter is never left collapsed with no way to reach its
  // header.
  const allGroupsCollapsed =
    groupedSignals.length > 0 && groupedSignals.every(group => collapsedGroups.has(group.name));

  function toggleAllGroups() {
    setCollapsedGroups(prev => {
      const collapsed =
        groupedSignals.length > 0 && groupedSignals.every(group => prev.has(group.name));
      return collapsed ? new Set() : new Set(groupedSignals.map(group => group.name));
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
    // Boundaries are session ordinals INTO the 1K series, which is built from
    // parsedSections.noteSectionsList — so they must be counted over the same
    // recovery-filtered note population or the markers would slide.
    const boundaries = deriveRoutineStartBoundaries(parsedSections.normalNotes, oneKSelections);
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
  }, [analytics.oneKSeries, parsedSections.normalNotes, oneKSelections, unit]);

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

  const recoverySection = (
    <AnalyticsRecoverySection
      key="recovery-section"
      blocks={recoveryBlocks}
      weeks={recoveryWeeks}
      notes={notes}
      stateReady={recoveryReady}
      stateLoading={recoveryStateLoading}
      stateRefreshing={recoveryRefreshing}
      stateStale={recoveryStale}
      stateError={recoveryStateError}
      mutationsAllowed={recoveryMutationsAllowed}
      pendingRecovery={recoveryPendingRecovery}
      onRetry={retryRecoveryState}
      onNavigate={onNavigate}
    />
  );

  // Mirrors AnalyticsRecoverySection's own "nothing to say" condition (#716):
  // it renders null only for a verified, fresh snapshot that holds no live
  // block — an unverified or stale one always states its condition, and a live
  // block is either active or completed, so `some(isLiveRecord)` covers both
  // populations the section draws. Pinned against the section itself in
  // analytics-screen.test.js so the two cannot drift apart silently.
  const hasRecoverySection =
    !recoveryReady || recoveryStale || recoveryBlocks.some(isLiveRecord);

  const screenContent = React.Children.toArray([
    // Load failures first, above every derived card (#737). Analytics is
    // entirely derived from the note and weight collections, so a failed read
    // silently turns the whole tab into a plausible-looking "you have no data"
    // report. One banner per failed source, each retrying only its own read.
    notesError ? (
      <ErrorBanner
        key="notes-error-banner"
        message="Could not load workout notes. Training analytics are incomplete."
        onRetry={refreshNotes}
      />
    ) : null,

    weightError ? (
      <ErrorBanner
        key="weight-error-banner"
        message="Could not load weight entries. Weight trends are incomplete."
        onRetry={refreshWeightEntries}
      />
    ) : null,

    <AnalyticsWeightTrendsCard
      key="weight-trends-card"
      handleWeightLayout={handleWeightLayout}
      weightSummary={weightSummary}
      rolling7={rolling7}
      rolling30={rolling30}
      isWeightLoading={isWeightLoading}
    />,

    // Recovery sits above Fatigue (R5b, #793): it is the only time-boxed,
    // situational section on the tab, and the two adjacent "should I be
    // training normally right now?" answers read together — Fatigue's own
    // gauge is what makes a given baseline count interpretable. Anchor for the
    // `recovery` handoff (#770): AnalyticsRecoverySection owns its own
    // presentation and takes no layout prop, so the wrapper carries the anchor
    // — and only while the section has something to render. An empty wrapper
    // would still take a slot in the shell's 16px column gap and open a hole
    // between Weight and Fatigue, so the silent case renders exactly what it
    // rendered before: the section alone, which resolves to nothing.
    hasRecoverySection ? (
      <View key="recovery-section" testID="recovery-section-anchor" onLayout={handleRecoveryLayout}>
        {recoverySection}
      </View>
    ) : recoverySection,

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
      onLayout={handleProgressiveOverloadHeaderLayout}
    >
      <View style={styles.signalHeaderRow}>
        <SectionTitle>Progressive Overload</SectionTitle>
        {groupedSignals.length > 0 && (
          <Pressable
            testID="po-collapse-all"
            onPress={toggleAllGroups}
            style={styles.collapseAllButton}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ expanded: !allGroupsCollapsed }}
            accessibilityLabel={
              allGroupsCollapsed ? 'Expand all exercise groups' : 'Collapse all exercise groups'
            }
          >
            <Text style={styles.collapseAllText}>
              {allGroupsCollapsed ? 'Expand all' : 'Collapse all'}
            </Text>
            {/* `unfold-less`/`unfold-more` rather than the single-panel
                `expand-less`/`expand-more` chevron of ui-design-rules §6: this
                acts on every group at once, and reusing the per-panel glyph
                would read as the sticky header collapsing itself. */}
            <MaterialIcons
              name={allGroupsCollapsed ? 'unfold-more' : 'unfold-less'}
              size={16}
              color={colors.textMuted}
              accessible={false}
            />
          </Pressable>
        )}
      </View>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search tracked exercises..."
          placeholderTextColor={colors.textMuted}
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

    // Progressive Overload's measurable box (#770): the sticky header above
    // cannot report its own content offset, so this list — an ordinary child
    // with an ordinary one — carries the anchor. Every branch renders content,
    // so the wrapper is never an empty box in the shell's column.
    <View
      key="overload-list"
      testID="overload-list-anchor"
      onLayout={handleProgressiveOverloadListLayout}
    >
      {(isNotesLoading || isTrackedLoading) ? (
        <View key="loading" style={{ height: 100, justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
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
                    color={colors.textMuted}
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
                                {formatOverload(nw.exercise_class === 'reps_only' ? nw.reps_arrow : nw.hold_arrow, colors)}
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
                                {formatOverload(rowTrend, colors)}
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
        <View key="empty-tracked" style={styles.emptyTracked}>
          <Text style={styles.emptyText}>
            Tap Track on any exercise in your note to track it here.
          </Text>
          <Pressable
            testID="analytics-empty-log-link"
            onPress={() => onNavigate?.('Log')}
            style={styles.emptyTrackedLink}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go to Log"
            accessibilityHint="Opens the Log tab so you can write a workout note"
          >
            <Text style={styles.emptyTrackedLinkText}>Go to Log</Text>
          </Pressable>
        </View>
      )}
    </View>
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

const createStyles = (colors) => StyleSheet.create({
  signalStickyHeader: {
    backgroundColor: colors.background,
    paddingTop: 8,
    paddingBottom: 8,
  },
  signalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  collapseAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  collapseAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchContainer: {
    marginTop: 12,
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
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
    color: colors.textMuted,
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
    borderTopColor: colors.divider,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.subtleBg,
  },
  groupName: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
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
    borderTopColor: colors.divider,
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
    color: colors.text,
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
    color: colors.text,
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
    color: colors.textMuted,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  multiDaySummary: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  emptySearch: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 20,
    fontSize: 15,
  },
  emptyTracked: {
    alignItems: 'center',
  },
  emptyTrackedLink: {
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  emptyTrackedLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
});
