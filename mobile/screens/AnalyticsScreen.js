import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { ErrorBanner } from '../components/UI';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { deriveWeightGoalAnalytics, resolveOneKSelections, deriveCheckInHistory, deriveRoutineStatus } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useWeightEntries, useWeightGoal, useDeloadHistory, useFeatureToggles, useRecoveryBlockState, useActiveTrainingContext } from '../hooks/useEntries';
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
import { useTheme } from '../theme/ThemeContext';
import { useReducedMotion } from '../lib/useReducedMotion';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue, displayChartSeries, lbToKg } from '../lib/units';
import { View } from 'react-native';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { ACTIVE_TRAINING_STATUS } from '../lib/data/activeTrainingContext';
import { normalizeExerciseKey } from '../lib/parser';
import { derive1kTotalSeriesFromSectionsList } from '../lib/data/oneK';
import { DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';
import {
  hydrateProgressionSuggestionSettings,
  subscribeProgressionSuggestionSettings,
  getProgressionSuggestionSettings,
  setProgressionSuggestionMuted,
} from '../storage/entries/settings';
import {
  isRenderableProgressionSuggestion,
  progressionSuggestionInstanceId,
} from '../components/ProgressionSuggestionCard';
import { createStyles } from './analytics/analyticsStyles';
import { AnalyticsWeightTrendsCard } from '../components/AnalyticsWeightTrendsCard';
import { AnalyticsStrengthSection, AnalyticsBig3MappingCard } from '../components/AnalyticsStrengthSection';
import { AnalyticsProgressiveOverloadSection } from './analytics/AnalyticsProgressiveOverload';
import { orderAnalyticsSections, BaselineDisclosureToggle, AnalyticsRoutineHealth } from './analytics/AnalyticsLayout';

// The one section id that needs no measurement: "the top of Analytics" (#770).
// The Overview card is gone (Home owns the summary); the legacy id still means
// offset 0. A plain Analytics tab press preserves the last position instead.
const OVERVIEW_SECTION = 'overview';

export function AnalyticsScreen({ multiplier, section, sectionNonce, onNavigate }) {
  const { colors, kuaPalette: kua } = useTheme();
  const reduceMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
  const {
    notes,
    currentId,
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
  const { goal: weightGoal } = useWeightGoal();
  const { trackedLifts, activations: trackedLiftActivations, loading: loadingTracked } = useTrackedLifts();
  const { history: deloadHistory } = useDeloadHistory();
  const { fatigueTrackingEnabled, deloadModeEnabled } = useFeatureToggles();

  // Progression-suggestion UI state (#960): mirrors the settings store's live
  // cache. Dismissal is transient/surface-local (keyed on instance id, never
  // persisted) — dismissing here never dismisses the Log card.
  const [progressionSettings, setProgressionSettings] = useState(getProgressionSuggestionSettings);
  const [dismissedProgressionIds, setDismissedProgressionIds] = useState(() => new Set());
  useEffect(() => {
    let active = true;
    hydrateProgressionSuggestionSettings().catch(() => {});
    const unsubscribe = subscribeProgressionSuggestionSettings((next) => {
      if (active) setProgressionSettings(next);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  // Same authoritative Recovery snapshot Log renders from (#716), backed by one
  // shared store so the two tabs cannot disagree; `recoveryReady` keeps an
  // unread snapshot from presenting here as "no recovery blocks".
  const {
    blocks: recoveryBlocks = [],
    weeks: recoveryWeeks = [],
    ready: recoveryReady = true,
    loading: recoveryStateLoading = false,
    refreshing: recoveryRefreshing = false,
    stale: recoveryStale = false,
    error: recoveryStateError = null,
    retryRecovery: retryRecoveryState,
  } = useRecoveryBlockState() || {};
  // Product-wide "what am I training now?" context (#868), shared with Home and
  // Log. Resolved from the STORED current-routine id, not `currentNote?.id`, so a
  // missing/tombstoned current note still resolves the same activeNoteId Log does
  // (PR #873).
  const activeTrainingContext = useActiveTrainingContext({ currentId, notes });
  // Zero Friction F9 (#871): whether Analytics is inside an active Recovery
  // block (live open week, or between weeks with the block still active) —
  // both mean baseline training is paused right now (#869). STALE/PENDING/
  // NORMAL never count: an unresolved read must not flip the hierarchy on a
  // guess, and a verified NORMAL read restores the unchanged normal hierarchy.
  const isActiveRecovery = activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK
    || activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS;
  // Baseline-only sections (Strength, Progressive Overload, Routine Health)
  // collapse under one disclosure while Recovery is active (#871),
  // collapsed by default since that's not what the user opened Analytics to
  // see. Only meaningful while `isActiveRecovery`, so Recovery ending always
  // restores the plain, always-expanded normal hierarchy.
  const [baselineCollapsed, setBaselineCollapsed] = useState(true);
  // Identity of the active-Recovery PERIOD (review finding, PR #876): same id
  // across an open-week/between-weeks flip, a NEW id (or null) once the block
  // ends and a later one starts — resets only on that change.
  const activeRecoveryBlockId = isActiveRecovery ? (activeTrainingContext.activeBlock?.id ?? null) : null;
  const prevActiveRecoveryBlockId = useRef(null);
  useEffect(() => {
    if (activeRecoveryBlockId && activeRecoveryBlockId !== prevActiveRecoveryBlockId.current) {
      setBaselineCollapsed(true);
    }
    prevActiveRecoveryBlockId.current = activeRecoveryBlockId;
  }, [activeRecoveryBlockId]);
  // Ordinary-analytics boundary (#699): notes whose Recovery block keeps
  // `include_in_normal_analytics` off are dropped below. AnalyticsRecoverySection
  // still receives the unfiltered `notes`.
  const recoveryFilter = useRecoveryAnalyticsFilter();
  const unit = useWeightUnit();

  const [activeSlot, setActiveSlot] = useState(null); // 'bench' | 'squat' | 'deadlift'
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  const scrollRef = useRef(null);
  // Measured top of every targetable section, keyed by the shell's bounded
  // section id (#770). An id missing from this map means "not laid out yet" —
  // the request stays pending, fulfilled by whichever layout resolves it.
  const sectionOffsets = useRef({});
  const pendingSection = useRef(section);
  const hasScrolled = useRef(false);

  const weightEntries = useMemo(() => {
    return (hookWeightEntries || []).filter(e => e && e.date && e.weight_value != null);
  }, [hookWeightEntries]);

  // A failed read must not be laundered into a permanent loading state (#737):
  // both hooks clear `loading` and leave the collection empty on failure, so
  // without this the affected cards would sit on "Not enough data" forever
  // with no retry offered.
  const isWeightLoading = loadingWeight && !weightError && weightEntries.length === 0;
  // An unverified recovery boundary (#699) counts as notes-not-ready: the 1K
  // card and Progressive Overload list are derived from a note population not
  // yet known correct, so they hold loading rather than paint aggregates that
  // may include excluded work. Recovery/weight/check-ins don't depend on it.
  const isNotesLoading = (loadingNotes && !notesError && notes.length === 0) || !recoveryFilter.ready;
  const isTrackedLoading = loadingTracked && Object.keys(trackedLifts).length === 0;

  function scrollToOffset(y) {
    scrollRef.current?.scrollTo({ y, animated: !reduceMotion });
    hasScrolled.current = true;
  }

  // One navigation path for every section request (prop handoff or same-screen
  // tap, #871). A destination inside the collapsed baseline disclosure expands
  // it first and lets the layout that follows fulfill the pending request,
  // rather than reading `sectionOffsets` while unmounted.
  function navigateToSection(sectionId) {
    pendingSection.current = sectionId;
    hasScrolled.current = false;

    // The overview is the top of the tab — its position is known without
    // measurement. Every other destination waits for its own layout.
    if (sectionId === OVERVIEW_SECTION) {
      scrollToOffset(0);
      return;
    }

    // A section inside the collapsed baseline disclosure (#871) must open it
    // first — its onLayout never fires while unmounted. `recovery`/`weight`
    // never need this: both stay outside the disclosure.
    if (isActiveRecovery && baselineCollapsed
      && (sectionId === 'strength' || sectionId === 'progressive-overload')) {
      setBaselineCollapsed(false);
    }

    const y = sectionOffsets.current[sectionId];
    if (y > 0) scrollToOffset(y);
  }

  useEffect(() => {
    if (!section) {
      pendingSection.current = section;
      hasScrolled.current = false;
      return;
    }
    navigateToSection(section);
    // `sectionNonce` changes on every navigation request, so repeating the same
    // handoff (weight → weight) re-targets the section instead of no-op'ing.
  }, [section, sectionNonce, isActiveRecovery, baselineCollapsed]);

  // One measurement path for every section (#770); `hasScrolled` keeps a later
  // reflow from yanking the user back after they land.
  function recordSectionOffset(id, y) {
    const known = sectionOffsets.current[id];
    if (known != null && Math.abs(known - y) < 1) return;
    sectionOffsets.current[id] = y;

    if (pendingSection.current === id && !hasScrolled.current) scrollToOffset(y);
  }

  // Named per section (not one generic handler): the weight/strength anchors
  // are props of components outside this issue's scope, so their names/shape
  // stay exactly as before.
  function handleWeightLayout(e) {
    recordSectionOffset('weight', e.nativeEvent.layout.y);
  }
  function handleStrengthLayout(e) {
    recordSectionOffset('strength', e.nativeEvent.layout.y);
  }
  function handleRecoveryLayout(e) {
    recordSectionOffset('recovery', e.nativeEvent.layout.y);
  }

  function handleProgressiveOverloadLayout(e) {
    recordSectionOffset('progressive-overload', e.nativeEvent.layout.y);
  }

  // Canonical weight analytics (lib/data); presentation only below.
  const { trendSummary: weightTrends, paceLevel: weightPaceLevel, paceInfo: weightPaceInfo, rollingSeries, rollingSeries30 } = useMemo(
    () => deriveWeightGoalAnalytics(weightEntries, weightGoal),
    [weightEntries, weightGoal]
  );
  // Converted into display space here (identity in lb mode) so LineChart
  // labels and the trends card read in the selected unit.
  const rolling7 = useMemo(() => displayChartSeries(rollingSeries || [], unit), [rollingSeries, unit]);
  const rolling30 = useMemo(() => displayChartSeries(rollingSeries30 || [], unit), [rollingSeries30, unit]);
  const weightSummary = useMemo(() => {
    if (weightEntries.length === 0) {
      return { latestWeightValue: 'N/A', showUnit: false, weightCount: '0', avg7: 'N/A', avg30: 'N/A', paceFlag: null, paceLevel: null, paceElapsedDays: null };
    }
    return {
      latestWeightValue: weightTrends.currentWeight !== null ? formatBodyweightValue(weightTrends.currentWeight, unit) : 'N/A',
      showUnit: weightTrends.currentWeight !== null,
      weightCount: String(weightEntries.length),
      avg7:  weightTrends.avg7  !== null ? `${displayWeight(weightTrends.avg7, unit).toFixed(1)} ${unit}`  : 'N/A',
      avg30: weightTrends.avg30 !== null ? `${displayWeight(weightTrends.avg30, unit).toFixed(1)} ${unit}` : 'N/A',
      paceFlag: weightTrends.paceFlag,
      paceLevel: weightPaceLevel,
      paceElapsedDays: weightPaceInfo ? weightPaceInfo.elapsedDays : null,
    };
  }, [weightEntries.length, weightTrends, weightPaceLevel, weightPaceInfo, unit]);

  // Canonical Big 3 selection — the same resolver Home uses (lib/data/oneK).
  const oneKSelections = useMemo(() => resolveOneKSelections(currentNote), [currentNote]);

  const parsedSections = useMemo(
    () => deriveParsedSections(notes, currentNote, recoveryFilter.excludedNoteIds),
    [notes, currentNote, recoveryFilter]
  );
  const noteExerciseNames = useMemo(() => deriveNoteExerciseNames(parsedSections.currentSections), [parsedSections]);
  const analytics = useMemo(
    // #989: pass the STORED current-routine id (not `currentNote?.id`) — the
    // stable id a deload snapshot was frozen against — with deload history and
    // live recovery blocks, so re-entry context resolves here.
    () => deriveAnalytics(parsedSections, trackedLifts, oneKSelections, multiplier, trackedLiftActivations, {
      deloadHistory,
      sourceNoteId: currentId ?? null,
      recoveryBlocks,
    }),
    [parsedSections, trackedLifts, oneKSelections, multiplier, trackedLiftActivations, deloadHistory, currentId, recoveryBlocks]
  );

  // #960: Progressive Overload's progression-suggestion cards, consuming
  // `analytics.progressionSuggestions` unchanged. Off, muted, dismissed, and
  // non-renderable records (incl. the post-deload `re_entry` relabel) fall out.
  const progressionSuggestionView = useMemo(() => {
    // Held back until the Recovery boundary is verified: an unready filter
    // exposes the empty placeholder exclusion set, so a note that will be
    // excluded once membership resolves could briefly produce a card here.
    if (!progressionSettings.enabled || !recoveryFilter.ready) return { visible: [], muted: [] };
    const records = Array.isArray(analytics.progressionSuggestions) ? analytics.progressionSuggestions : [];
    const mutedKeys = new Set(progressionSettings.mutedKeys || []);
    const displayMap = analytics.nameDisplayMap;
    const visible = [];
    const muted = [];
    for (const record of records) {
      if (!isRenderableProgressionSuggestion(record)) continue;
      const key = normalizeExerciseKey(record.name);
      // The tracked-name list is already normalized/lower-cased; present the
      // user's own last-seen casing instead.
      const displayName = (displayMap && displayMap.get(key)) || record.name;
      const shown = { ...record, name: displayName };
      if (mutedKeys.has(key)) {
        muted.push({ name: displayName, key });
        continue;
      }
      const instanceId = progressionSuggestionInstanceId(shown, key);
      if (dismissedProgressionIds.has(instanceId)) continue;
      visible.push({ record: shown, key, instanceId });
    }
    return { visible, muted };
  }, [progressionSettings.enabled, recoveryFilter.ready, progressionSettings.mutedKeys, analytics.progressionSuggestions, analytics.nameDisplayMap, dismissedProgressionIds]);

  const handleMuteProgression = (key) => {
    setProgressionSuggestionMuted(key, true).catch(() => {});
  };
  const handleUnmuteProgression = (key) => {
    setProgressionSuggestionMuted(key, false).catch(() => {});
  };
  const handleDismissProgression = (instanceId) => {
    setDismissedProgressionIds(prev => {
      const next = new Set(prev);
      next.add(instanceId);
      return next;
    });
  };

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

  // Bulk collapse for Progressive Overload acts only on `groupedSignals` — what
  // is actually on screen. A group filtered out by search keeps its own state
  // in both directions: never silently expanding or reopening groups the user
  // can't see the result of (#826 review).
  const allGroupsCollapsed =
    groupedSignals.length > 0 && groupedSignals.every(group => collapsedGroups.has(group.name));

  function toggleAllGroups() {
    setCollapsedGroups(prev => {
      const visible = groupedSignals.map(group => group.name);
      const allVisibleCollapsed = visible.length > 0 && visible.every(name => prev.has(name));
      const next = new Set(prev);
      for (const name of visible) {
        if (allVisibleCollapsed) next.delete(name);
        else next.add(name);
      }
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
    // Boundaries are ordinals INTO the 1K series, so they must count the same
    // recovery-filtered notes or the markers would slide.
    const boundaries = deriveRoutineStartBoundaries(parsedSections.normalNotes, oneKSelections);
    // #1248: a deload note keeps its own point; flag its session ordinals.
    const deloadSessions = new Set();
    let offset = 0;
    parsedSections.normalNotes.forEach((n, i) => {
      // Real (possibly sparse) ordinals, mirroring the cross-note merge's offset.
      const noteSeries = derive1kTotalSeriesFromSectionsList([parsedSections.noteSectionsList[i]], oneKSelections);
      if (n.title?.startsWith(DELOAD_NOTE_PREFIX)) noteSeries.forEach(pt => deloadSessions.add(offset + pt.session));
      if (noteSeries.length > 0) offset += noteSeries[noteSeries.length - 1].session;
    });
    // #577: canonical-lb figures ride along for the plate calculator.
    const withCanonical = deriveOneKChartData(analytics.oneKSeries, boundaries).map((p, i) => ({
      ...p,
      isDeload: deloadSessions.has(analytics.oneKSeries[i].session),
      valueLb: p.value,
      benchLb: p.bench,
      squatLb: p.squat,
      deadliftLb: p.deadlift,
    }));
    if (unit !== 'kg') return withCanonical;
    // Display-space conversion for kg (#441): per-lift values convert too.
    const kg = (v) => (v != null ? lbToKg(v) : v);
    return withCanonical.map((p) => ({
      ...p,
      value: Math.round(lbToKg(p.value)),
      unit: 'kg',
      bench: kg(p.bench),
      squat: kg(p.squat),
      deadlift: kg(p.deadlift),
    }));
  }, [analytics.oneKSeries, parsedSections.normalNotes, parsedSections.noteSectionsList, oneKSelections, unit]);

  // 1K card values in display space (identity in lb mode); the 1,000 lb club
  // itself stays lb-defined, and AnalyticsStrengthSection converts the same way.
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
      notes={notes} notesError={notesError}
      stateReady={recoveryReady}
      stateLoading={recoveryStateLoading}
      stateRefreshing={recoveryRefreshing}
      stateStale={recoveryStale}
      stateError={recoveryStateError}
      onRetry={retryRecoveryState}
      oneKSelections={oneKSelections}
    />
  );
  // Mirrors AnalyticsRecoverySection's own "nothing to say" condition (#716):
  // null only for a verified, fresh snapshot with no live block; `some(isLiveRecord)`
  // covers both active and completed. Pinned against the section itself in
  // analytics-screen.test.js so the two cannot drift apart silently.
  const hasRecoverySection =
    !recoveryReady || recoveryStale || recoveryBlocks.some(isLiveRecord);
  const banners = [
    notesError ? (
      <ErrorBanner key="notes-error-banner" message="Could not load workout notes. Training analytics are incomplete." onRetry={refreshNotes} />
    ) : null,
    weightError ? (
      <ErrorBanner key="weight-error-banner" message="Could not load weight entries. Weight trends are incomplete." onRetry={refreshWeightEntries} />
    ) : null,
  ];
  const strength = (
    <AnalyticsStrengthSection
      key="strength-section"
      handleStrengthLayout={handleStrengthLayout}
      isNotesLoading={isNotesLoading}
      oneK={displayOneK}
      oneKCanonical={analytics.oneK}
      oneKChartData={oneKChartData}
      big3Mapping={(
        <AnalyticsBig3MappingCard
          activeSlot={activeSlot}
          handleSlotTap={handleSlotTap}
          SLOT_LABELS={SLOT_LABELS}
          oneKSelections={oneKSelections}
          noteExerciseNames={noteExerciseNames}
          handleSelectExercise={handleSelectExercise}
        />
      )}
    />
  );
  const progressiveOverload = (
    <AnalyticsProgressiveOverloadSection
      key="progressive-overload-section"
      styles={styles} colors={colors} kua={kua}
      onLayout={handleProgressiveOverloadLayout}
      isNotesLoading={isNotesLoading}
      isTrackedLoading={isTrackedLoading}
      analytics={analytics}
      progressionSuggestionView={progressionSuggestionView}
      onMuteProgression={handleMuteProgression}
      onUnmuteProgression={handleUnmuteProgression}
      onDismissProgression={handleDismissProgression}
      groupedSignals={groupedSignals}
      toggleAllGroups={toggleAllGroups}
      allGroupsCollapsed={allGroupsCollapsed}
      collapsedGroups={collapsedGroups}
      toggleGroup={toggleGroup}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      unit={unit}
      onNavigate={onNavigate}
    />
  );
  const weight = (
    <AnalyticsWeightTrendsCard
      key="weight-trends-card"
      handleWeightLayout={handleWeightLayout}
      weightSummary={weightSummary}
      rolling7={rolling7}
      rolling30={rolling30}
      isWeightLoading={isWeightLoading}
      onNavigate={onNavigate}
    />
  );
  const routineHealth = (
    <AnalyticsRoutineHealth
      key="routine-health"
      styles={styles}
      sinceDeload={sinceDeload}
      sessionCount={sessionCount}
      deloadModeEnabled={deloadModeEnabled}
      isActiveRecovery={isActiveRecovery}
      fatigueTrackingEnabled={fatigueTrackingEnabled}
      checkInHistory={checkInHistory}
      fatigueExpanded={fatigueExpanded}
      setFatigueExpanded={setFatigueExpanded}
      handleCheckInEdit={handleCheckInEdit}
    />
  );
  // Anchor for the `recovery` handoff (#770), only while the section has
  // something to render: an empty wrapper would still take a slot in the
  // shell's column gap, so the silent case renders the section alone (null).
  const recovery = hasRecoverySection ? (
    <View key="recovery-section" testID="recovery-section-anchor" onLayout={handleRecoveryLayout}>
      {recoverySection}
    </View>
  ) : recoverySection;
  const screenContent = orderAnalyticsSections({
    isActiveRecovery,
    baselineExpanded: !baselineCollapsed,
    banners,
    strength,
    progressiveOverload,
    weight,
    routineHealth,
    recovery,
    disclosure: (
      <BaselineDisclosureToggle
        key="baseline-disclosure-toggle"
        collapsed={baselineCollapsed}
        onToggle={() => setBaselineCollapsed(v => !v)}
        styles={styles} colors={colors} kua={kua}
      />
    ),
  }).filter(Boolean);
  const editCheckInData = shapeEditCheckInData(editPendingCheckIn);

  return (
    <>
      <ScreenShell
        ref={scrollRef}
        title="Analytics"
        subtitle="Insights derived from your logs."
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

