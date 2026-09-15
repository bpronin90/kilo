import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Alert } from '../lib/platformAlert';
import { ScreenShell } from '../components/ScreenShell';
import { Card, SectionTitle, ErrorBanner } from '../components/UI';
import { useThemedStyles } from '../theme/ThemeContext';
import { useWeightEntries, useWeightGoal, useUserProfile } from '../hooks/useEntries';
import { getWeightDeltaSeverity } from '../lib/format';
import { parseWeightEntry } from '../lib/parser';
import { deriveWeightGoalAnalytics } from '../lib/data';
import { isGoalMet as computeIsGoalMet, isWeightThresholdMet } from '../lib/data/weightGoal';
import { useArchivedWeightGoals } from '../hooks/entries/weightHooks';
import { useWeightUnit } from '../lib/unitPreference';
import { formatBodyweightValue, inputWeightToLb } from '../lib/units';

import { localDateToday, buildTrendSections } from '../lib/WeightScreenHelpers';

import { TrendSection } from '../components/WeightTrendSection';
import { WeightGoalCard } from '../components/WeightGoalCard';
import { WeightHistoryList } from '../components/WeightHistoryList';
import { useWeightGoalForm } from '../hooks/useWeightGoalForm';
import { WeightEntryForm } from './weight/WeightEntryForm';
import { GoalHistoryPanel } from './weight/GoalHistoryPanel';
import { createStyles } from './weight/weightStyles';

export function WeightScreen({
  weightValue,
  setWeightValue,
  weightNote,
  setWeightNote,
  onSaveWeight,
  errorMessage,
  saving,
  isActive,
  onNavigate,
  registerBackConsumer,
}) {
  const styles = useThemedStyles(createStyles);
  const { entries, remove, update, loading: entriesLoading, error: entriesError, refresh: refreshEntries } = useWeightEntries();
  const { goal, loading: goalLoading, error: goalError, refresh: refreshGoal, save: saveGoal, clear: clearGoal, archiveGoal } = useWeightGoal();
  const { archivedGoals } = useArchivedWeightGoals();
  const profile = useUserProfile()?.profile ?? null;
  const unit = useWeightUnit();
  const [editingId, setEditingId] = useState(null);
  const [localError, setLocalError] = useState('');
  const [newEntryDate, setNewEntryDate] = useState(localDateToday);
  // Tracks whether the user explicitly picked a date for the new-entry form
  // (#764 feedback). WeightScreen stays mounted under `display: none` across
  // tab switches, so `newEntryDate` can silently go stale past local midnight.
  // Only pass an explicit date to onSaveWeight when the user actually chose
  // one; otherwise pass undefined so App.saveWeight recomputes localToday at
  // submission time, preserving the original default-today semantics.
  const [newEntryDateTouched, setNewEntryDateTouched] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [goalHistoryCollapsed, setGoalHistoryCollapsed] = useState(true);
  const scrollRef = useRef(null);

  // Local calendar day used to gate goal completion on target_date (#549).
  // Refreshes itself at the next local midnight (and re-schedules) so a goal
  // whose weight threshold was already reached becomes "Goal Met!" on its
  // target_date without requiring a remount or another state change.
  const [today, setToday] = useState(localDateToday);
  useEffect(() => {
    let timeoutId;
    const scheduleMidnightRefresh = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timeoutId = setTimeout(() => {
        setToday(localDateToday());
        scheduleMidnightRefresh();
      }, nextMidnight.getTime() - now.getTime());
    };
    scheduleMidnightRefresh();
    return () => clearTimeout(timeoutId);
  }, []);

  // Display-unit bridge for the goal form (#441): the form's text fields hold
  // values in the SELECTED unit, but canonical storage is lb. The form seeds
  // from a display-space goal and saves through a wrapper that converts back
  // to lb. Both are identity passthroughs in lb mode.
  const displayGoal = useMemo(() => {
    if (!goal || unit !== 'kg') return goal;
    return {
      ...goal,
      target_weight: goal.target_weight != null ? Number(formatBodyweightValue(goal.target_weight, 'kg')) : goal.target_weight,
      start_weight: goal.start_weight != null ? Number(formatBodyweightValue(goal.start_weight, 'kg')) : goal.start_weight,
    };
  }, [goal, unit]);

  const saveGoalCanonical = useMemo(() => (
    (g) => saveGoal({
      ...g,
      target_weight: g.target_weight != null ? inputWeightToLb(g.target_weight, unit) : g.target_weight,
      start_weight: g.start_weight != null ? inputWeightToLb(g.start_weight, unit) : g.start_weight,
    })
  ), [saveGoal, unit]);

  const goalForm = useWeightGoalForm(displayGoal, saveGoalCanonical, clearGoal, archiveGoal, isActive, registerBackConsumer);

  // Draft goal fields are typed in the selected unit; convert them to lb-space
  // strings before the lb-domain analytics derivation (identity in lb mode).
  const draftToLbString = (text) => {
    if (unit !== 'kg' || !text) return text;
    const n = parseFloat(text);
    return Number.isNaN(n) ? text : String(inputWeightToLb(n, 'kg'));
  };

  const {
    trendSummary: trends,
    paceInfo,
    goalInfo: rawGoalInfo,
    calorieEstimate,
  } = useMemo(
    () =>
      deriveWeightGoalAnalytics(
        entries,
        goal,
        {
          goalEditing: goalForm.goalEditing,
          goalTargetWeight: draftToLbString(goalForm.goalTargetWeight),
          goalTargetDate: goalForm.goalTargetDate,
          goalStartWeight: draftToLbString(goalForm.goalStartWeight),
        },
        new Date(),
        profile
      ),
    [
      entries,
      goal,
      goalForm.goalEditing,
      goalForm.goalTargetWeight,
      goalForm.goalTargetDate,
      goalForm.goalStartWeight,
      profile,
      unit,
    ]
  );

  const goalInfo = useMemo(() => {
    if (!rawGoalInfo) return null;
    const rawWeeks = rawGoalInfo.weeks_remaining;
    const weeks_remaining = (rawWeeks === null || rawWeeks === undefined || isNaN(rawWeeks)) ? 0 : Math.max(0, rawWeeks);

    const activeTargetDate = goalForm.goalEditing ? goalForm.goalTargetDate : goal?.target_date;
    const isOverdue = !!(activeTargetDate && weeks_remaining <= 0);

    let required_weekly_pace = rawGoalInfo.required_weekly_pace;
    if (isOverdue || required_weekly_pace === null || required_weekly_pace === undefined || isNaN(required_weekly_pace) || !isFinite(required_weekly_pace)) {
      required_weekly_pace = null;
    }

    return {
      ...rawGoalInfo,
      weeks_remaining,
      required_weekly_pace,
      isOverdue,
    };
  }, [rawGoalInfo, goalForm.goalEditing, goalForm.goalTargetDate, goal?.target_date]);

  const trendSections = useMemo(() => buildTrendSections(trends, paceInfo, unit), [trends, paceInfo, unit]);

  const isGoalMet = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number);
    return computeIsGoalMet(goal, trends.currentWeight, new Date(y, m - 1, d));
  }, [goal, trends.currentWeight, today]);

  // Weight threshold reached before target_date: positive progress, not yet
  // completion. Shown as "On Track" instead of "Goal Met!"/Archive.
  const aheadOfSchedule = useMemo(
    () => isWeightThresholdMet(goal, trends.currentWeight) && !isGoalMet,
    [goal, trends.currentWeight, isGoalMet]
  );

  const sortedArchivedGoals = useMemo(() => {
    return [...archivedGoals].sort((a, b) => {
      const dateA = a.archived_at || a.saved_at || '';
      const dateB = b.archived_at || b.saved_at || '';
      return dateB.localeCompare(dateA);
    });
  }, [archivedGoals]);

  // Outcome of the most recent archived goal for the collapsed Goal History
  // summary. The latest goal is already the first sorted element (O(1)), and the
  // met/missed judgment reuses the same isGoalMet helper used for End Weight
  // coloring. Neutral only when the latest goal has no completed weight to judge.
  const latestArchivedOutcome = useMemo(() => {
    const latest = sortedArchivedGoals[0];
    if (!latest) return null;
    const hasCompletedWeight =
      latest.completed_weight !== null && latest.completed_weight !== undefined;
    if (!hasCompletedWeight) return { label: '—', met: null };
    // Judge against the goal's own archived_at date, not "today" — an archived
    // goal's outcome must stay stable regardless of when it's later viewed.
    const archivedRef = latest.archived_at ? new Date(latest.archived_at) : new Date();
    const met = computeIsGoalMet(latest, latest.completed_weight, archivedRef);
    return { label: met ? 'Success' : 'Missed', met };
  }, [sortedArchivedGoals]);

  // Stable callback identities (#592): WeightHistoryList is wrapped in
  // React.memo so it does not remap a large expanded history when WeightScreen
  // re-renders for an unrelated reason (e.g. a Weight/Note field keystroke).
  // That bail-out only works if the callbacks passed to it keep the same
  // reference across those renders, so handleEditEntry and handleDelete are
  // useCallback rather than freshly defined functions every render.
  const handleEditEntry = useCallback((entry) => {
    setLocalError('');
    setEditingId(entry.id);
    setWeightValue(formatBodyweightValue(entry.weight_value, unit));
    setWeightNote(entry.note || '');
    setEditDate(entry.date);
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
  }, [unit, setWeightValue, setWeightNote]);

  const cancelEdit = useCallback(() => {
    setLocalError('');
    setEditingId(null);
    setWeightValue('');
    setWeightNote('');
    setEditDate('');
  }, [setWeightValue, setWeightNote]);

  const handleDelete = useCallback((id) => {
    Alert.alert(
      'Delete Entry',
      'Are you sure you want to delete this weight entry?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await remove(id);
            if (id === editingId) cancelEdit();
          }
        },
      ]
    );
  }, [remove, editingId, cancelEdit]);

  // Synchronous in-flight lock (#596 review follow-up): a rapid double-press —
  // including a retry tapped again before the failed attempt's error/re-render
  // lands — must not fire a second add()/update() write. This is a plain ref
  // rather than React state so the guard is checked and set on the very first
  // synchronous line, before any `await`, closing the window a state-based
  // check (which only takes effect after a re-render) would leave open.
  const submittingRef = useRef(false);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLocalError('');
    try {
      if (editingId) {
        const parsed = parseWeightEntry(weightValue);
        if (!parsed.ok) {
          setLocalError(parsed.error);
          return;
        }
        let ok;
        try {
          ok = await update(editingId, parsed.weight_value, weightNote.trim() || undefined, editDate);
        } catch {
          ok = false;
        }
        if (ok) {
          cancelEdit();
        } else {
          // Rejected update (false return or thrown rejection): keep the edit
          // open with the entered values so the user can retry (#596).
          setLocalError('Could not update weight entry. Please try again.');
        }
      } else {
        const ok = await onSaveWeight(newEntryDateTouched ? newEntryDate : undefined);
        if (ok) {
          setNewEntryDate(localDateToday());
          setNewEntryDateTouched(false);
        }
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const displayError = localError || errorMessage;

  // Derived-history gate (#737). The weigh-in form is never gated — logging must
  // stay available the instant the tab opens — but everything below it (goal,
  // trends, history) is derived from `entries`/`goal` and reads as a real
  // "0 entries, no goal" answer before those resolve. `entries.length === 0`
  // keeps a background refresh from flipping populated sections back to bars.
  const isHistoryFirstLoad = (entriesLoading && entries.length === 0) || (goalLoading && !goal);
  // A failed read leaves `entries` empty and `goal` null, which the
  // goal/trends/history sections would present as a verified "no weigh-ins, no
  // goal". Suppress them and let the ErrorBanner's Retry be the only claim on
  // screen. Both sources gate the same block the loading state already gates:
  // whatever an unresolved read withholds, a failed read withholds too.
  const historyUnavailable = (!!entriesError && entries.length === 0)
    || (!!goalError && !goal);

  return (
    <ScreenShell
      ref={scrollRef}
      title="Weight log"
      subtitle="Track your body weight over time."
      keyboardShouldPersistTaps="handled"
    >
      {/* One banner per failed source, each retrying only its own read (#737):
          a weigh-in read and a goal read fail independently, and merging them
          would offer a retry for something that never failed. */}
      {entriesError ? (
        <ErrorBanner message="Could not load weight entries." onRetry={refreshEntries} />
      ) : null}
      {goalError ? (
        <ErrorBanner message="Could not load your weight goal." onRetry={refreshGoal} />
      ) : null}
      <WeightEntryForm
        editingId={editingId}
        cancelEdit={cancelEdit}
        displayError={displayError}
        unit={unit}
        weightValue={weightValue}
        setWeightValue={setWeightValue}
        weightNote={weightNote}
        setWeightNote={setWeightNote}
        newEntryDate={newEntryDate}
        setNewEntryDate={setNewEntryDate}
        setNewEntryDateTouched={setNewEntryDateTouched}
        editDate={editDate}
        setEditDate={setEditDate}
        handleSubmit={handleSubmit}
        saving={saving}
      />

      {isHistoryFirstLoad ? <WeightSkeleton /> : historyUnavailable ? null : (
      <>
      <SectionTitle>Goal</SectionTitle>
      <WeightGoalCard
        goal={goal}
        goalInfo={goalInfo}
        calorieEstimate={calorieEstimate}
        currentWeight={trends.currentWeight}
        isGoalMet={isGoalMet}
        aheadOfSchedule={aheadOfSchedule}
        {...goalForm}
      />

      <SectionTitle>Trends</SectionTitle>
      <Card style={styles.trendsCardMerged}>
        {trendSections.map((section) => (
          <TrendSection
            key={section.title}
            title={section.title}
            col1={section.col1}
            col2={section.col2}
            col3={section.col3}
            isLast={section.isLast}
            paceLevel={section.paceLevel}
            goalDirection={goalInfo?.direction}
          />
        ))}
      </Card>

      <Pressable
        testID="weight-see-full-trends"
        onPress={() => onNavigate?.('Analytics', 'weight')}
        style={styles.fullTrendsLink}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="See full trends"
        accessibilityHint="Opens the weight section of the Analytics tab"
      >
        <Text style={styles.fullTrendsLinkText}>See full trends</Text>
      </Pressable>

      {sortedArchivedGoals.length > 0 && (
        <GoalHistoryPanel
          sortedArchivedGoals={sortedArchivedGoals}
          collapsed={goalHistoryCollapsed}
          setCollapsed={setGoalHistoryCollapsed}
          latestArchivedOutcome={latestArchivedOutcome}
          unit={unit}
        />
      )}

      <SectionTitle>Weight History</SectionTitle>
      <WeightHistoryList
        entries={entries}
        editingId={editingId}
        handleEditEntry={handleEditEntry}
        handleDelete={handleDelete}
        getWeightDeltaSeverity={getWeightDeltaSeverity}
        goalInfo={goalInfo}
      />
      </>
      )}
    </ScreenShell>
  );
}

// First-paint placeholder for the derived sections (#737). Static bars, no
// motion; the shapes track Goal / Trends / History so nothing shifts when the
// real cards land.
function WeightSkeleton() {
  const styles = useThemedStyles(createStyles);
  return (
    <View
      testID="weight-skeleton"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your weight history"
    >
      <View style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
      </View>
      <View style={styles.skeletonCard}>
        <View style={[styles.skeletonBar, styles.skeletonBarShort]} />
        <View style={[styles.skeletonBar, styles.skeletonBarFull]} />
        <View style={[styles.skeletonBar, styles.skeletonBarWide]} />
      </View>
    </View>
  );
}
