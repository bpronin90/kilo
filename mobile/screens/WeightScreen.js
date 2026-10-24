import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { View } from 'react-native';
import { Alert } from '../lib/platformAlert';
import { ScreenShell } from '../components/ScreenShell';
import { RootHeader } from '../components/RootHeader';
import { useTheme } from '../theme/ThemeContext';
import { useWeightEntries, useWeightGoal, useUserProfile } from '../hooks/useEntries';
import { getWeightDeltaSeverity } from '../lib/format';
import { parseWeightEntry } from '../lib/parser';
import { convertWeightDraft, retainedDraftLb } from '../lib/parser/weightEntry';
import { deriveWeightGoalAnalytics } from '../lib/data';
import { isGoalMet as computeIsGoalMet, isWeightThresholdMet } from '../lib/data/weightGoal';
import { useArchivedWeightGoals } from '../hooks/entries/weightHooks';
import { useWeightUnit } from '../lib/unitPreference';
import { formatBodyweightValue, inputWeightToLb } from '../lib/units';

import { useLocalCalendarDay, localDayToDate } from '../hooks/useLocalCalendarDay';
import { localDateToday } from '../lib/WeightScreenHelpers';

import { WeightGoalCard } from '../components/WeightGoalCard';
import { WeightHistoryList } from '../components/WeightHistoryList';
import { useWeightGoalForm } from '../hooks/useWeightGoalForm';
import { WeightEntryForm } from './weight/WeightEntryForm';
import { GoalHistoryPanel } from './weight/GoalHistoryPanel';
import { WeightLatestPanel } from './weight/WeightLatestPanel';
import { WeightErrorBanners, WeightSkeleton, weightHeaderContext } from './weight/WeightScreenPanels';
import { createStyles } from './weight/weightStyles';
import { useReducedMotion } from '../lib/useReducedMotion';

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
  const { colors, kuaPalette: kua } = useTheme();
  const reduceMotion = useReducedMotion();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);
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

  // Weigh-in draft unit bridge (#1476). weightValue is text typed in the
  // selected unit; this screen stays mounted while hidden, so a preference
  // change converts the dirty draft once here (new and edit paths alike)
  // instead of letting the parser reinterpret the old number in the new unit.
  const draftProvRef = useRef(null);
  const prevUnitRef = useRef(unit);
  // Provenance lives only as long as the exact draft it describes: any user
  // keystroke, cancel, successful save, or an emptied field drops it, so a later
  // draft that happens to reuse the same text can never inherit a stale lb value.
  const onUserWeightChange = useCallback((text) => {
    draftProvRef.current = null;
    setWeightValue(text);
  }, [setWeightValue]);
  useEffect(() => {
    if (!weightValue) draftProvRef.current = null;
  }, [weightValue]);
  useEffect(() => {
    const from = prevUnitRef.current;
    if (from === unit) return;
    prevUnitRef.current = unit;
    const next = convertWeightDraft(weightValue, from, unit, draftProvRef.current);
    if (next) {
      draftProvRef.current = next;
      setWeightValue(next.text);
    }
  }, [unit]);
  const [goalHistoryCollapsed, setGoalHistoryCollapsed] = useState(true);
  const scrollRef = useRef(null);

  // Local calendar day (#549/#1484): gates goal completion on target_date and
  // is the reference day for trends/pace/goal projections, so they refresh at
  // midnight and on foreground without a remount.
  const today = useLocalCalendarDay();
  const referenceDate = useMemo(() => localDayToDate(today), [today]);

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
    (g, lbOverrides) => saveGoal({
      ...g,
      target_weight: lbOverrides?.target_weight ?? (g.target_weight != null ? inputWeightToLb(g.target_weight, unit) : g.target_weight),
      start_weight: lbOverrides?.start_weight ?? (g.start_weight != null ? inputWeightToLb(g.start_weight, unit) : g.start_weight),
    })
  ), [saveGoal, unit]);

  const goalForm = useWeightGoalForm(displayGoal, saveGoalCanonical, clearGoal, archiveGoal, isActive, registerBackConsumer, unit, goal);
  // No-goal setup disclosure. With no saved goal the draft feeds the analytics
  // (live direction/tone, as the always-open pre-redesign form did) only while
  // setup is open; a closed setup leaves no goal-derived state behind.
  const [goalSetupOpen, setGoalSetupOpen] = useState(false);
  const draftLive = goalForm.goalEditing || (!goal && goalSetupOpen);

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
    // Canonical, already-normalized goal state (overdue, clamped weeks, safe pace).
    goalInfo,
    calorieEstimate,
  } = useMemo(
    () =>
      deriveWeightGoalAnalytics(
        entries,
        goal,
        {
          goalEditing: goalForm.goalEditing,
          goalTargetWeight: draftLive ? draftToLbString(goalForm.goalTargetWeight) : '',
          goalTargetDate: draftLive ? goalForm.goalTargetDate : '',
          goalStartWeight: draftLive ? draftToLbString(goalForm.goalStartWeight) : '',
        },
        referenceDate,
        profile
      ),
    [
      entries,
      goal,
      goalForm.goalEditing,
      draftLive,
      goalForm.goalTargetWeight,
      goalForm.goalTargetDate,
      goalForm.goalStartWeight,
      profile,
      unit,
      referenceDate,
    ]
  );

  // Newest weigh-in date for the Latest panel label (the entry behind
  // trends.currentWeight); a selection only, no calculation.
  const latestDate = useMemo(
    () => entries.reduce((latest, e) => (e?.date && (!latest || e.date > latest) ? e.date : latest), null),
    [entries]
  );

  const isGoalMet = useMemo(() => {
    return computeIsGoalMet(goal, trends.currentWeight, referenceDate);
  }, [goal, trends.currentWeight, referenceDate]);

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
    if (!hasCompletedWeight) return { label: 'N/A', met: null };
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
    const seeded = formatBodyweightValue(entry.weight_value, unit);
    draftProvRef.current = { text: seeded, unit, lb: entry.weight_value };
    setWeightValue(seeded);
    setWeightNote(entry.note || '');
    setEditDate(entry.date);
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: !reduceMotion });
  }, [unit, reduceMotion, setWeightValue, setWeightNote]);

  const cancelEdit = useCallback(() => {
    setLocalError('');
    setEditingId(null);
    draftProvRef.current = null;
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
          ok = await update(editingId, retainedDraftLb(weightValue, unit, draftProvRef.current) ?? parsed.weight_value, weightNote.trim() || undefined, editDate);
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
        const newDate = newEntryDateTouched ? newEntryDate : undefined;
        const retainedLb = retainedDraftLb(weightValue, unit, draftProvRef.current);
        const ok = retainedLb == null ? await onSaveWeight(newDate) : await onSaveWeight(newDate, retainedLb);
        if (ok) {
          draftProvRef.current = null;
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

  const headerContext = isHistoryFirstLoad || historyUnavailable
    ? null
    : weightHeaderContext({ count: entries.length, verified: true, goal, goalInfo, unit });

  // Redesign v3 order (#1601): Log weigh-in → Latest → Goal → History → Goal
  // history. The weight trend chart lives only in Analytics (Full trend link).
  return (
    <ScreenShell
      ref={scrollRef}
      header={<RootHeader title="Weight" context={headerContext} uppercaseContext={false} testID="weight-root-header" />}
      keyboardShouldPersistTaps="handled"
      style={kua ? { backgroundColor: kua.background } : undefined}
    >
      <View style={styles.stack}>
      <WeightErrorBanners
        entriesError={entriesError}
        goalError={goalError}
        refreshEntries={refreshEntries}
        refreshGoal={refreshGoal}
      />
      <WeightEntryForm
        editingId={editingId}
        cancelEdit={cancelEdit}
        displayError={displayError}
        unit={unit}
        weightValue={weightValue}
        setWeightValue={onUserWeightChange}
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
      <WeightLatestPanel
        trends={trends}
        paceInfo={paceInfo}
        latestDate={latestDate}
        goalDirection={goalInfo?.direction ?? null}
        unit={unit}
        onNavigate={onNavigate}
      />

      <WeightGoalCard
        goal={goal}
        goalInfo={goalInfo}
        calorieEstimate={calorieEstimate}
        currentWeight={trends.currentWeight}
        isGoalMet={isGoalMet}
        aheadOfSchedule={aheadOfSchedule}
        {...goalForm}
        setupOpen={goalSetupOpen}
        onSetupOpenChange={setGoalSetupOpen}
      />

      <WeightHistoryList
        entries={entries}
        editingId={editingId}
        handleEditEntry={handleEditEntry}
        handleDelete={handleDelete}
        getWeightDeltaSeverity={getWeightDeltaSeverity}
        goalInfo={goalInfo}
      />

      {sortedArchivedGoals.length > 0 && (
        <GoalHistoryPanel
          sortedArchivedGoals={sortedArchivedGoals}
          collapsed={goalHistoryCollapsed}
          setCollapsed={setGoalHistoryCollapsed}
          latestArchivedOutcome={latestArchivedOutcome}
          unit={unit}
        />
      )}
      </>
      )}
      </View>
    </ScreenShell>
  );
}
