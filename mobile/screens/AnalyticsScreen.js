import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ScreenShell } from '../components/ScreenShell';
import { HeroMetric } from '../components/UI';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { deriveWeightGoalAnalytics, DEFAULT_1K_EXERCISES, deriveCheckInHistory, deriveRoutineStatus } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useWeightEntries, useDeloadHistory, useFeatureToggles, useRecoveryBlockState, useActiveTrainingContext } from '../hooks/useEntries';
import { useRecoveryAnalyticsFilter } from '../hooks/entries/recoveryBlockHooks';
import { findActiveBlock, isLiveRecord } from '../lib/data/recoveryBlocks';
import { deriveRecoveryComparison } from '../lib/data/recoveryAnalytics';
import { deriveRecoveryMovement, deriveRecoveryWeekBands } from '../lib/data/recoveryReturnBands';
import {
  deriveParsedSections,
  deriveNoteExerciseNames,
  deriveAnalytics,
  deriveGroupedSignals,
  deriveOneKChartData,
  deriveRoutineStartBoundaries,
  deriveOverviewRows,
  shapeEditCheckInData,
} from './analytics/analyticsDerivations';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

import { lerpColor } from '../lib/AnalyticsScreenHelpers';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue, displayChartSeries, lbToKg } from '../lib/units';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { ACTIVE_TRAINING_STATUS } from '../lib/data/activeTrainingContext';
import { normalizeExerciseKey } from '../lib/parser';
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
import { AnalyticsOverview } from './analytics/AnalyticsOverview';
import { AnalyticsProgression } from './analytics/AnalyticsProgression';

// The one section id that needs no measurement: "the top of Analytics" (#770).
// `Full history and insights` on Home requests it; a plain Analytics tab press
// deliberately preserves whatever the user was last looking at instead.
const OVERVIEW_SECTION = 'overview';

export function AnalyticsScreen({ multiplier, section, sectionNonce, onNavigate }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
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
    mutationsAllowed: recoveryMutationsAllowed = true,
    pendingRecovery: recoveryPendingRecovery = [],
    retryRecovery: retryRecoveryState,
  } = useRecoveryBlockState() || {};
  // Product-wide "what am I training now?" context (#868), shared with Home and
  // Log. Resolved from the STORED current-routine id, not `currentNote?.id`: a
  // restored profile whose `current_workout_id` points at a missing/tombstoned
  // note leaves `currentNote` null while `currentId` stays set, and this must
  // resolve the same activeNoteId Log does rather than silently losing it
  // (review finding, PR #873).
  const activeTrainingContext = useActiveTrainingContext({ currentId, notes });
  // Zero Friction F9 (#871): whether Analytics is inside an active Recovery
  // block (live open week, or between weeks with the block still active) —
  // both mean baseline training is paused right now (#869). STALE/PENDING/
  // NORMAL never count: an unresolved read must not flip the hierarchy on a
  // guess, and a verified NORMAL read restores the unchanged normal hierarchy.
  const isActiveRecovery = activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK
    || activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS;
  // Baseline-only sections (Fatigue, Strength/Progressive Overload, Big 3
  // mapping) collapse under one disclosure while Recovery is active (#871),
  // collapsed by default since that's not what the user opened Analytics to
  // see. Only meaningful while `isActiveRecovery`, so Recovery ending always
  // restores the plain, always-expanded normal hierarchy.
  const [baselineCollapsed, setBaselineCollapsed] = useState(true);
  // Identity of the current active-Recovery PERIOD, distinct from
  // `isActiveRecovery` (review finding, PR #876): `activeBlock.id` stays the
  // same across an open-week/between-weeks flip, but is a NEW id (or null) once
  // that block ends and a later one starts. Resetting only on this identity
  // change lets a fresh Recovery period open collapsed while leaving
  // mid-period toggles alone.
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
  // Progressive Overload's offset comes from two boxes, not one; see
  // handleProgressiveOverloadHeaderLayout. Both start null so an unmeasured
  // box is never mistaken for a measured zero.
  const overloadHeaderHeight = useRef(null);
  const overloadListY = useRef(null);
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
  // may include excluded work. Recovery/weight/fatigue don't depend on it.
  const isNotesLoading = (loadingNotes && !notesError && notes.length === 0) || !recoveryFilter.ready;
  const isTrackedLoading = loadingTracked && Object.keys(trackedLifts).length === 0;

  function scrollToOffset(y) {
    scrollRef.current?.scrollTo({ y, animated: true });
    hasScrolled.current = true;
  }

  // One navigation path for every section request, external `section` prop
  // handoff or same-screen tap (Overview's rows, #871 review finding). Both
  // resolve a destination inside the collapsed baseline disclosure the same
  // way: expand it first and let the layout that follows fulfill the
  // still-pending request, rather than reading `sectionOffsets` directly while
  // unmounted — which is exactly what let Overview's rows no-op or scroll
  // stale before.
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

  // Progressive Overload can't report its own position: its sticky header's
  // onLayout reports y:0 (laid out inside ScrollView's own wrapper), but its
  // HEIGHT is true, and the ordinary list beneath it has an ordinary offset —
  // so the destination is the list's top minus the header's height. Either
  // measurement can arrive first; whichever completes the pair resolves the
  // pending request.
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
  const { trendSummary: weightTrends, paceLevel: weightPaceLevel, paceInfo: weightPaceInfo, rollingSeries, rollingSeries30 } = useMemo(
    () => deriveWeightGoalAnalytics(weightEntries, null),
    [weightEntries]
  );
  // Converted into display space here (identity in lb mode) so LineChart
  // labels and the trends card read in the selected unit.
  const rolling7 = useMemo(() => displayChartSeries(rollingSeries || [], unit), [rollingSeries, unit]);
  const rolling30 = useMemo(() => displayChartSeries(rollingSeries30 || [], unit), [rollingSeries30, unit]);
  const weightSummary = useMemo(() => {
    if (weightEntries.length === 0) {
      return { latestWeightValue: '—', showUnit: false, weightCount: '0', avg7: '—', avg30: '—', paceFlag: null, paceLevel: null, paceElapsedDays: null };
    }
    return {
      latestWeightValue: weightTrends.currentWeight !== null ? formatBodyweightValue(weightTrends.currentWeight, unit) : '—',
      showUnit: weightTrends.currentWeight !== null,
      weightCount: String(weightEntries.length),
      avg7:  weightTrends.avg7  !== null ? `${displayWeight(weightTrends.avg7, unit).toFixed(1)} ${unit}`  : '—',
      avg30: weightTrends.avg30 !== null ? `${displayWeight(weightTrends.avg30, unit).toFixed(1)} ${unit}` : '—',
      paceFlag: weightTrends.paceFlag,
      paceLevel: weightPaceLevel,
      paceElapsedDays: weightPaceInfo ? weightPaceInfo.elapsedDays : null,
    };
  }, [weightEntries.length, weightTrends, weightPaceLevel, weightPaceInfo, unit]);

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

  // #960: the strength surface's progression-suggestion cards, consuming
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
    // Boundaries are session ordinals INTO the 1K series (built from
    // parsedSections.noteSectionsList), so they must count the same
    // recovery-filtered note population or the markers would slide.
    const boundaries = deriveRoutineStartBoundaries(parsedSections.normalNotes, oneKSelections);
    const series = deriveOneKChartData(analytics.oneKSeries, boundaries);
    // #577: carry canonical-lb figures alongside display-space ones on every
    // point so a plate-calculator tap reads the exact canonical value.
    const withCanonical = series.map((p) => ({
      ...p,
      valueLb: p.value,
      benchLb: p.bench,
      squatLb: p.squat,
      deadliftLb: p.deadlift,
    }));
    if (unit !== 'kg') return withCanonical;
    // Display-space conversion for kg (#441): per-lift values convert too.
    return withCanonical.map((p) => ({
      ...p,
      value: Math.round(lbToKg(p.value)),
      unit: 'kg',
      bench: p.bench != null ? lbToKg(p.bench) : p.bench,
      squat: p.squat != null ? lbToKg(p.squat) : p.squat,
      deadlift: p.deadlift != null ? lbToKg(p.deadlift) : p.deadlift,
    }));
  }, [analytics.oneKSeries, parsedSections.normalNotes, oneKSelections, unit]);

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

  // #1029: current live week's return bands and (once its evidence bar is met)
  // movement, for the Overview `Recovery` row — reuses the same
  // `deriveRecoveryComparison` read AnalyticsRecoverySection renders from,
  // restricted to the active block since the row only describes right now.
  const activeRecoveryBlockForOverview = isActiveRecovery ? findActiveBlock(recoveryBlocks) : null;
  const recoveryOverviewInfo = useMemo(() => {
    if (!activeRecoveryBlockForOverview) return { bands: null, movement: null };
    const comparison = deriveRecoveryComparison({
      block: activeRecoveryBlockForOverview, weeks: recoveryWeeks, notes,
    });
    const weeks = comparison.weeks || [];
    const current = weeks.length > 0 ? weeks[weeks.length - 1] : null;
    const bands = deriveRecoveryWeekBands(current);
    // Never off an unverified/stale snapshot (#1023 v2 §4 req. 4) —
    // `recoveryStale` mirrors Home's own `isStale` gate.
    const movement = (!recoveryStale && current)
      ? deriveRecoveryMovement(weeks, { currentWeekId: current.week_id })
      : null;
    return { bands: bands.buckets ? bands : null, movement };
  }, [activeRecoveryBlockForOverview, recoveryWeeks, notes, recoveryStale]);

  // Overview rows (#821). Fed the same display-space arrays the charts below
  // are given, so a value here is literally the value its own section plots.
  const overviewRows = useMemo(
    () => deriveOverviewRows({
      oneKPoints: oneKChartData,
      signals: analytics.signals,
      sessionsSinceDeload: sinceDeload,
      deloadModeEnabled,
      currentWeight: weightTrends.currentWeight != null
        ? displayWeight(weightTrends.currentWeight, unit)
        : null,
      weightPoints: rolling7,
      notesUnavailable: !!notesError,
      weightUnavailable: !!weightError,
      activeTraining: { status: activeTrainingContext.status, recoveryWeekNumber: activeTrainingContext.recoveryWeekNumber },
      recoveryBands: recoveryOverviewInfo.bands,
      recoveryMovement: recoveryOverviewInfo.movement,
    }),
    [
      oneKChartData, analytics.signals, sinceDeload, deloadModeEnabled, weightTrends, unit, rolling7,
      notesError, weightError, activeTrainingContext.status, activeTrainingContext.recoveryWeekNumber,
      recoveryOverviewInfo,
    ]
  );
  const overviewLoading = isNotesLoading || isWeightLoading;

  // #1029 AC3: during active Recovery the panel header names the Recovery
  // state itself (as `activeTrainingContext` resolves for Home/Log) instead of
  // stamping "N sessions logged"; ending Recovery restores that stamp.
  const overviewAsOf = isActiveRecovery
    ? (activeTrainingContext.status === ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK
        ? `Recovery week ${activeTrainingContext.recoveryWeekNumber}`
        : 'Recovery, between weeks')
    : sessionCount > 0
      ? `${sessionCount} session${sessionCount === 1 ? '' : 's'} logged`
      : null;
  function handleOverviewSelect(sectionId) {
    if (!sectionId) return;
    navigateToSection(sectionId);
  }
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
  // null only for a verified, fresh snapshot with no live block; `some(isLiveRecord)`
  // covers both active and completed. Pinned against the section itself in
  // analytics-screen.test.js so the two cannot drift apart silently.
  const hasRecoverySection =
    !recoveryReady || recoveryStale || recoveryBlocks.some(isLiveRecord);
  // Extracted verbatim into analytics/AnalyticsOverview.js and
  // AnalyticsProgression.js (card #1051): same keys/testIDs/conditions as the
  // inline JSX they replace. Each returns a flat array (not a wrapped
  // component) so the sticky header and its overload-list anchor stay flat
  // siblings here, exactly as `stickyHeaderIndices` below depends on.
  const screenContent = React.Children.toArray([
    ...AnalyticsOverview({
      notesError, refreshNotes, weightError, refreshWeightEntries,
      overviewRows, overviewLoading, overviewAsOf, onSelectSection: handleOverviewSelect,
      handleWeightLayout, weightSummary, rolling7, rolling30, isWeightLoading, onNavigate,
      hasRecoverySection, handleRecoveryLayout, recoverySection,
    }),
    ...AnalyticsProgression({
      isActiveRecovery, baselineCollapsed, setBaselineCollapsed, styles, colors,
      sinceDeload, sessionCount, deloadModeEnabled,
      fatigueTrackingEnabled, checkInHistory, fatigueExpanded, setFatigueExpanded, handleCheckInEdit,
      handleStrengthLayout, isNotesLoading, isTrackedLoading,
      oneK: displayOneK, oneKCanonical: analytics.oneK, oneKChartData,
      progressionSuggestionView,
      onMuteProgression: handleMuteProgression,
      onUnmuteProgression: handleUnmuteProgression,
      onDismissProgression: handleDismissProgression,
      handleProgressiveOverloadHeaderLayout, handleProgressiveOverloadListLayout,
      groupedSignals, toggleAllGroups, allGroupsCollapsed, collapsedGroups, toggleGroup,
      searchQuery, setSearchQuery,
      analytics, trackedLiftActivations, unit, onNavigate,
      activeSlot, handleSlotTap, SLOT_LABELS, oneKSelections, noteExerciseNames, handleSelectExercise,
    }),
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

