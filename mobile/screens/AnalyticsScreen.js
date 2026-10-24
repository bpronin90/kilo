import React, { useMemo, useState, useRef, useEffect } from 'react';
import { View } from 'react-native';
import { useLocalCalendarDay, localDayToDate } from '../hooks/useLocalCalendarDay';
import { ScreenShell } from '../components/ScreenShell';
import { RootHeader } from '../components/RootHeader';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { deriveWeightGoalAnalytics, computeWeightRollingAverageSeries, resolveOneKSelections, deriveCheckInHistory, deriveRoutineStatus } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes, useWeightEntries, useWeightGoal, useDeloadHistory, useFeatureToggles, useRecoveryBlockState, useActiveTrainingContext } from '../hooks/useEntries';
import { useRecoveryAnalyticsFilter } from '../hooks/entries/recoveryBlockHooks';
import { isLiveRecord } from '../lib/data/recoveryBlocks';
import { isWeightThresholdMet } from '../lib/data/weightGoal';
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
import { overloadChipsVisible } from './analytics/OverloadFilterChips';
import { filterGroupsByStatus } from './analytics/OverloadRows';
import { buildAnalyticsContent } from './analytics/AnalyticsSectionContent';
import { ChapterIndex, NORMAL_CHAPTERS, ACTIVE_RECOVERY_CHAPTERS } from './analytics/AnalyticsChapters';
import { useAnalyticsChapterNavigation } from './analytics/useAnalyticsChapterNavigation';

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
  const { goal: weightGoal, loading: goalLoading, error: goalError } = useWeightGoal();
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
  // Progressive Overload status chip (#1604): in memory, tied to the routine it
  // was chosen on, so another routine starts at All.
  const [statusChoice, setStatusChoice] = useState({ noteId: null, value: 'all' });

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

  // Chapter structure (#1602) and every scroll/navigation concern: deep-link
  // section requests, the chapter index and its scroll-spy.
  const chapters = isActiveRecovery ? ACTIVE_RECOVERY_CHAPTERS : NORMAL_CHAPTERS;
  const nav = useAnalyticsChapterNavigation({
    section, sectionNonce, isActiveRecovery, baselineCollapsed, setBaselineCollapsed, chapters, reduceMotion,
  });

  // Canonical weight analytics (lib/data); presentation only below.
  const calendarDay = useLocalCalendarDay();
  const { trendSummary: weightTrends, paceLevel: weightPaceLevel, paceInfo: weightPaceInfo, goalInfo: weightGoalInfo } = useMemo(
    () => deriveWeightGoalAnalytics(weightEntries, weightGoal, {}, localDayToDate(calendarDay)),
    [weightEntries, weightGoal, calendarDay]
  );
  // Converted into display space here (identity in lb mode) so LineChart
  // labels and the trends card read in the selected unit.
  // Bodyweight (#1603) plots every weigh-in date, so both windows are the
  // existing rolling-average derivation over the whole history (not its
  // last-7 / last-30-date default): the 7D/30D toggle then swaps only the line.
  const rolling7 = useMemo(() => {
    const days = new Set(weightEntries.map(e => e.date)).size;
    return displayChartSeries(computeWeightRollingAverageSeries(weightEntries, days, 7), unit);
  }, [weightEntries, unit]);
  const rolling30 = useMemo(() => {
    const days = new Set(weightEntries.map(e => e.date)).size;
    return displayChartSeries(computeWeightRollingAverageSeries(weightEntries, days, 30), unit);
  }, [weightEntries, unit]);
  // The goal decorations (line, mode, target, to-go, pace) draw only for a goal
  // that is verified active: read without error, derivable from a current
  // weight, and not past its target date.
  const weightGoalContext = useMemo(() => {
    const target = weightGoal ? weightGoal.target_weight : null;
    const verified = !goalLoading && !goalError && !!weightGoal && !!weightGoalInfo
      && !weightGoalInfo.isOverdue && Number.isFinite(target) && weightTrends.currentWeight != null;
    if (!verified) return null;
    return {
      direction: weightGoalInfo.direction,
      target,
      info: weightGoalInfo,
      met: isWeightThresholdMet(weightGoal, weightTrends.currentWeight),
    };
  }, [weightGoal, weightGoalInfo, weightTrends, goalLoading, goalError]);
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

  // A chip that is not on screen (loading, no summary, baseline state) never
  // filters; search and the chip compose on the same derived day groups.
  const statusFilter = statusChoice.noteId === (currentNote?.id ?? null)
    && overloadChipsVisible(analytics, isNotesLoading || isTrackedLoading)
    ? statusChoice.value
    : 'all';
  const groupedSignals = useMemo(
    () => filterGroupsByStatus(deriveGroupedSignals(parsedSections, analytics, searchQuery), statusFilter, analytics, unit),
    [parsedSections, analytics, searchQuery, statusFilter, unit]
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

  // Recovery evidence reuses Home's resolved Big 3 selections (#1351); the
  // chapter header titles it, so the section's own title is off (#1602).
  const recoverySection = (
    <AnalyticsRecoverySection
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
      title={null}
    />
  );
  const screenContent = buildAnalyticsContent({
    styles, colors, kua, nav, chapters, onNavigate,
    notes, notesError, refreshNotes, weightError, refreshWeightEntries,
    isNotesLoading, isWeightLoading, isActiveRecovery, baselineCollapsed,
    toggleBaseline: () => setBaselineCollapsed(v => !v),
    activeRecoveryBlockId,
    recoveryFilterReady: recoveryFilter.ready,
    analytics, parsedSections, displayOneK, oneKChartData, oneKSelections, noteExerciseNames,
    activeSlot, handleSlotTap, handleSelectExercise,
    weightSummary, rolling7, rolling30, weightEntries, weightTrends, weightGoalContext,
    overloadProps: {
      isNotesLoading, isTrackedLoading, analytics, progressionSuggestionView,
      onMuteProgression: handleMuteProgression,
      onUnmuteProgression: handleUnmuteProgression,
      onDismissProgression: handleDismissProgression,
      groupedSignals, toggleAllGroups, allGroupsCollapsed, collapsedGroups, toggleGroup,
      searchQuery, setSearchQuery, unit,
      statusFilter,
      onStatusFilterChange: value => setStatusChoice({ noteId: currentNote?.id ?? null, value }),
      // View in Log targets the routine the rows were derived from; while
      // Recovery is active the current note is a recovery week, so none.
      currentNoteId: isActiveRecovery ? null : (currentNote?.id ?? null),
      currentSections: parsedSections.currentSections,
    },
    routineHealthProps: {
      sinceDeload, sessionCount, deloadModeEnabled, fatigueTrackingEnabled,
      checkInHistory, fatigueExpanded, setFatigueExpanded, handleCheckInEdit,
    },
    recoverySection,
    recovery: {
      ready: recoveryReady, stale: recoveryStale,
      completedCount: recoveryBlocks.filter(b => isLiveRecord(b) && b.completed_at).length,
    },
  });
  // Root header context (#1602): the current routine and Home's "Week N"
  // (deriveRoutineStatus().weeksIn), only when there is a routine. During
  // Recovery the current note is the Recovery week, whose title names its week.
  const showWeek = !isActiveRecovery && routineStatus.weeksIn > 0;
  const headerContext = currentNote
    ? [currentNote.title || 'Untitled Routine', showWeek ? `Week ${routineStatus.weeksIn}` : null].filter(Boolean).join(' · ')
    : null;
  const editCheckInData = shapeEditCheckInData(editPendingCheckIn);

  return (
    <>
      <ScreenShell
        ref={nav.scrollRef}
        onScroll={nav.handleScroll}
        header={(
          <View>
            <RootHeader title="Analytics" context={headerContext} uppercaseContext={false} />
            <ChapterIndex chapters={chapters} activeId={nav.activeChapter} onSelect={nav.handleChapterSelect} />
          </View>
        )}
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

