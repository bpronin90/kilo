import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Button, TextAction, TextField, DateField } from './UI';
import { MonoLabel, Panel } from './ui/RedesignPrimitives';
import { useTheme } from '../theme/ThemeContext';
import { useKuaTypography, TYPOGRAPHY, TYPOGRAPHY_FALLBACK } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';
import { formatDate } from '../lib/format';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue, formatGoalWeightValue } from '../lib/units';
import { suggestedTargetDate } from '../hooks/useWeightGoalForm';

function useGoalStyles() {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  return useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
}

// One split cell: uppercase label over a mono value with an optional unit.
function SplitCell({ label, value, unit = null, note = null, styles, divider = false, muted = false }) {
  return (
    <View style={[styles.splitCell, divider ? styles.splitCellDivider : null]}>
      <Text style={styles.derivedLabel}>{label}</Text>
      <Text style={muted ? styles.derivedValueNeutral : styles.derivedValue}>
        {value}{unit ? <Text style={styles.unitText}>{` ${unit}`}</Text> : null}
      </Text>
      {note ? <Text style={styles.noteText}>{note}</Text> : null}
    </View>
  );
}

// Goal-derived pace and calorie guidance (existing values from
// deriveWeightGoalAnalytics), drawn as the Target pace / Suggested split row
// plus production's advisory copy. Used by the goal display and the form preview.
export function GoalDerived({ info, calorieEstimate }) {
  const styles = useGoalStyles();
  const unit = useWeightUnit();
  if (!info) return null;
  const { direction, required_weekly_pace, warnings } = info;

  const paceAbs = required_weekly_pace !== null ? Math.abs(displayWeight(required_weekly_pace, unit)).toFixed(2) : null;
  const calories_per_day = calorieEstimate?.calories_per_day ?? null;
  const calLabel = calorieEstimate?.label ?? null;
  const tdeeBased = calorieEstimate?.tdee_based ?? false;

  const isMaintain = direction === 'maintain';
  const hasPace = required_weekly_pace !== null;
  const isUnrealistic = warnings.includes('unrealistic');
  const isUnhealthy = warnings.includes('unhealthy');
  const showCalories = hasPace && (tdeeBased || !isMaintain) && calLabel !== null && !(calLabel === 'maintain' && !tdeeBased);

  let advisory = null;
  if (!hasPace) advisory = <Text style={styles.goalWarningText}>Select a future target date for guidance.</Text>;
  else if (isMaintain && !tdeeBased) advisory = <Text style={styles.goalInfoText}>Current weight is within maintenance range.</Text>;
  else if (!isMaintain && isUnrealistic) advisory = <Text style={styles.goalWarningText}>Pace is unrealistic - consider a longer timeline.</Text>;
  else if (!isMaintain && isUnhealthy) advisory = <Text style={styles.goalWarningText}>Pace is aggressive - a slower target is safer.</Text>;

  return (
    <View style={styles.goalDerived}>
      <View style={styles.split}>
        {!hasPace && <SplitCell label="Target pace" value="-" styles={styles} muted />}
        {hasPace && isMaintain && <SplitCell label="Target pace" value="Maintain" styles={styles} />}
        {hasPace && !isMaintain && <SplitCell label="Target pace" value={paceAbs} unit={`${unit}/wk`} styles={styles} />}
        {showCalories ? (
          <SplitCell
            label={tdeeBased ? 'Est. daily consumption' : `Suggested ${calLabel}`}
            value={calories_per_day}
            unit="cal/day"
            note={tdeeBased ? null : 'Estimate'}
            styles={styles}
            divider
          />
        ) : <View style={[styles.splitCell, styles.splitCellDivider]} />}
      </View>
      {advisory ? <View style={styles.advisory}>{advisory}</View> : null}
    </View>
  );
}

// Outlined goal action (Edit / Archive / Clear) with its own >=44dp box.
function GoalAction({ label, onPress, tone = 'default', icon = null, styles, iconColor }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.goalAction}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon ? <MaterialIcons name={icon} size={16} color={iconColor} accessible={false} /> : null}
      <Text style={[styles.goalActionText, tone === 'danger' ? styles.goalActionDanger : null]} accessible={false}>{label}</Text>
    </Pressable>
  );
}

// Presentational progress from an explicitly stored start_weight only: the
// share of start→target covered by the current weight, clamped to 0–100.
// Absent, non-positive or start==target baselines draw nothing (never inferred).
function goalProgress(goal, currentWeight) {
  const start = Number(goal?.start_weight);
  const target = Number(goal?.target_weight);
  if (!goal?.start_weight || !Number.isFinite(start) || start <= 0 || !Number.isFinite(target) || start === target || currentWeight == null) return null;
  const pct = Math.round(Math.min(1, Math.max(0, (start - currentWeight) / (start - target))) * 100);
  return { start, target, pct };
}

// The Goal panel (Redesign v3, #1601). Active goal: mode + status, to-go and
// weeks left, a progress bar only for a stored start_weight, Target / Target
// date and Target pace / Suggested splits, and production's actions for the
// state (in progress: Edit/Clear; met: Edit/Archive; ended: Edit/Archive/Clear).
// No goal: a compact "Set a goal" that opens the existing useWeightGoalForm form.
export function WeightGoalCard({
  goal,
  goalEditing,
  goalTargetWeight,
  setGoalTargetWeight,
  goalTargetDate,
  setGoalTargetDate,
  goalStartWeight,
  setGoalStartWeight,
  goalError,
  showDatePicker,
  setShowDatePicker,
  handleSaveGoal,
  handleClearGoal,
  handleArchiveGoal,
  startEditGoal,
  cancelEditGoal,
  onDateChange,
  goalInfo,
  calorieEstimate,
  currentWeight,
  isGoalMet,
  aheadOfSchedule,
  setupOpen: setupOpenProp,
  onSetupOpenChange,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useGoalStyles();
  const unit = useWeightUnit();
  const ink = kua ? kua.onSurface : colors.text;
  // No-goal setup is a UI disclosure only; it closes once a goal exists so a
  // later clear/archive returns to the compact "Set a goal" state. The screen
  // may own it (setupOpen + onSetupOpenChange) so a closed setup's draft stays
  // out of the analytics.
  const [ownSetupOpen, setOwnSetupOpen] = useState(false);
  const setupOpen = setupOpenProp ?? ownSetupOpen;
  const setSetupOpen = onSetupOpenChange ?? setOwnSetupOpen;
  useEffect(() => { if (goal) setSetupOpen(false); }, [goal]);
  // Cancelling no-goal setup discards the draft, so reopening starts clean.
  const cancelForm = () => {
    cancelEditGoal();
    if (!goal) {
      setGoalTargetWeight?.('');
      setGoalTargetDate?.(suggestedTargetDate());
    }
    setSetupOpen(false);
  };

  const remainingToGoal =
    goal && currentWeight != null && goal.target_weight != null
      ? Math.abs(currentWeight - goal.target_weight)
      : null;

  // The goal form's text fields are in the selected display unit, so the
  // current weight seeded into a form save must be display-space too (the
  // screen's save wrapper converts everything back to canonical lb).
  // handleArchiveGoal stores completed_weight directly and stays lb.
  const formCurrentWeight =
    currentWeight != null && unit === 'kg'
      ? Number(formatBodyweightValue(currentWeight, 'kg'))
      : currentWeight;

  // Persisted goal identity (`goal`) stays separate from the unsaved draft, so
  // a failed save keeps the form and its values on screen.
  const showForm = goalEditing || (!goal && setupOpen);
  const dir = goalInfo?.direction;
  const mode = dir === 'loss' ? 'Cutting' : dir === 'gain' ? 'Bulking' : dir === 'maintain' ? 'Maintaining' : null;
  const overdue = !!goalInfo?.isOverdue;

  if (!goal && !showForm) {
    return (
      <Panel testID="weight-goal-panel">
        <View style={styles.header}><MonoLabel>Goal</MonoLabel></View>
        <View style={styles.setupRow}>
          <Text style={styles.captionText}>No goal set.</Text>
          <GoalAction label="Set a goal" icon="flag" onPress={() => setSetupOpen(true)} styles={styles} iconColor={ink} />
        </View>
      </Panel>
    );
  }

  const progress = !showForm && !overdue ? goalProgress(goal, currentWeight) : null;
  const showToGo = remainingToGoal !== null && !isGoalMet && !overdue && !aheadOfSchedule;
  const weeks = goalInfo && !overdue && goalInfo.weeks_remaining > 0 ? Math.round(goalInfo.weeks_remaining) : null;
  const weeksText = weeks != null ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'} left` : null;

  return (
    <Panel testID="weight-goal-panel" style={isGoalMet && goal && !goalEditing ? styles.goalCardMet : null}>
      <View style={styles.header}>
        <MonoLabel numberOfLines={1} style={styles.headerLabel}>
          {showForm && !goal ? 'Set a goal' : 'Goal'}
          {mode && goal ? <Text>{' · '}<Text style={styles.modeText}>{mode}</Text></Text> : null}
        </MonoLabel>
        {showForm ? (
          <TextAction label="Cancel" onPress={cancelForm} />
        ) : isGoalMet ? (
          <Text style={styles.goalMetBadge}>Goal Met!</Text>
        ) : overdue ? (
          <Text style={styles.goalEndedText}>Goal ended</Text>
        ) : aheadOfSchedule ? (
          <Text style={styles.goalAheadText}>On Track</Text>
        ) : null}
      </View>

      {showForm ? (
        <View style={styles.formBody}>
          {goalError ? <Text style={styles.goalErrorText}>{goalError}</Text> : null}
          {!currentWeight && (
            <TextField
              label={`Current weight (${unit})`}
              numeric
              value={goalStartWeight}
              onChangeText={setGoalStartWeight}
              placeholder={unit === 'kg' ? '90.0' : '200.0'}
            />
          )}
          <TextField
            label={`Target (${unit})`}
            numeric
            value={goalTargetWeight}
            onChangeText={setGoalTargetWeight}
            placeholder={unit === 'kg' ? '80.0' : '175.0'}
          />
          <DateField
            label="Target Date"
            value={goalTargetDate}
            onChangeDate={(dateStr) => {
              const [y, m, d] = dateStr.split('-').map(Number);
              onDateChange({ type: 'set' }, new Date(y, m - 1, d));
            }}
            accessibilityLabel="Goal target date"
            range="future"
            placeholder="Select date"
            pickerVisible={showDatePicker}
            onPickerVisibleChange={setShowDatePicker}
          />
          {goalInfo && (
            <View style={styles.formDerived}>
              <GoalDerived info={goalInfo} calorieEstimate={calorieEstimate} />
            </View>
          )}
          <Button onPress={() => handleSaveGoal(formCurrentWeight)} title="Save goal" />
        </View>
      ) : (
        <>
          {showToGo || weeksText || progress ? (
            <View style={styles.summary}>
              {showToGo || weeksText ? (
                <Text style={styles.captionText}>
                  {showToGo ? <Text style={styles.metricText}>{displayWeight(remainingToGoal, unit).toFixed(1)}</Text> : null}
                  {showToGo ? <Text style={styles.unitText}>{` ${unit} to go`}</Text> : null}
                  {showToGo && weeksText ? ' · ' : ''}
                  {weeksText}
                </Text>
              ) : null}
              {progress ? (
                <View style={styles.progressBlock} testID="weight-goal-progress">
                  <View style={styles.progressTrack} accessible accessibilityRole="progressbar" accessibilityLabel={`${progress.pct}% of the way from ${formatGoalWeightValue(progress.start, unit)} to ${formatGoalWeightValue(progress.target, unit)} ${unit}`} accessibilityValue={{ min: 0, max: 100, now: progress.pct }}>
                    <View style={[styles.progressFill, { flex: progress.pct }]} />
                    <View style={{ flex: 100 - progress.pct }} />
                  </View>
                  <View style={styles.progressLegend}>
                    <Text style={styles.legendText}>{`Start ${formatGoalWeightValue(progress.start, unit)}`}</Text>
                    <Text style={styles.legendText}>{`${progress.pct}%`}</Text>
                    <Text style={styles.legendText}>{`Target ${formatGoalWeightValue(progress.target, unit)}`}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.split}>
            <SplitCell label="Target" value={formatGoalWeightValue(goal.target_weight, unit)} unit={unit} styles={styles} />
            <SplitCell label="Target date" value={formatDate(goal.target_date)} styles={styles} divider />
          </View>
          {goalInfo && !overdue ? <GoalDerived info={goalInfo} calorieEstimate={calorieEstimate} /> : null}
          <View style={styles.actions}>
            <GoalAction label="Edit" icon="edit" onPress={startEditGoal} styles={styles} iconColor={ink} />
            {isGoalMet || overdue ? <GoalAction label="Archive" onPress={() => handleArchiveGoal(currentWeight)} styles={styles} /> : null}
            {!isGoalMet ? <GoalAction label="Clear" tone="danger" onPress={handleClearGoal} styles={styles} /> : null}
          </View>
        </>
      )}
    </Panel>
  );
}

// Full JetBrains Mono role (family, tracking, tabular-nums); weight is encoded in the family.
const monoRole = (typo, role) => (typo || TYPOGRAPHY_FALLBACK)[role];

export const createStyles = (colors, kua = null, typo = null) => {
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  const ink = kua ? kua.onSurface : colors.text;
  const border = kua ? kua.surfaceBorder : colors.cardBorder;
  return StyleSheet.create({
    goalCardMet: {
      borderColor: kua ? kua.success : colors.success,
      borderWidth: 1.5,
    },
    header: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingLeft: 16,
      paddingRight: 12,
    },
    headerLabel: {
      flexShrink: 1,
    },
    modeText: {
      ...monoRole(typo, 'label-lg'),
      fontSize: 12,
      color: kua ? kua.primary : colors.accentText,
    },
    goalMetBadge: {
      fontSize: TYPOGRAPHY['body-sm'].fontSize,
      fontWeight: '700',
      color: kua ? kua.success : colors.success,
      letterSpacing: 0.3,
    },
    goalEndedText: {
      fontSize: TYPOGRAPHY['body-md'].fontSize,
      color: kua ? kua.errorText : colors.error,
      fontWeight: '600',
    },
    goalAheadText: {
      fontSize: TYPOGRAPHY['body-sm'].fontSize,
      fontWeight: '700',
      color: kua ? kua.warning : colors.cautionText,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    goalErrorText: {
      color: kua ? kua.errorText : colors.error,
      fontSize: TYPOGRAPHY['body-md'].fontSize,
      fontWeight: '600',
      marginBottom: 8,
    },
    setupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 14,
    },
    summary: {
      paddingHorizontal: 16,
      paddingBottom: 14,
      gap: 10,
    },
    captionText: {
      fontSize: TYPOGRAPHY['body-sm'].fontSize,
      lineHeight: TYPOGRAPHY['body-sm'].lineHeight,
      color: muted,
      flexShrink: 1,
    },
    metricText: {
      ...monoRole(typo, 'metric-display-mobile'),
      color: ink,
    },
    unitText: {
      ...monoRole(typo, 'label-lg'),
      color: muted,
    },
    progressBlock: {
      gap: 6,
    },
    progressTrack: {
      height: 10,
      flexDirection: 'row',
      borderRadius: 2,
      overflow: 'hidden',
      backgroundColor: kua ? kua.surfaceSection || kua.surfaceCardHeader : colors.subtleBg,
    },
    progressFill: {
      backgroundColor: kua ? kua.completion : colors.success,
    },
    progressLegend: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    legendText: {
      ...monoRole(typo, 'label-md'),
      textTransform: 'uppercase',
      color: muted,
    },
    split: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: border,
    },
    splitCell: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 4,
    },
    splitCellDivider: {
      borderLeftWidth: 1,
      borderLeftColor: border,
    },
    goalDerived: {},
    derivedLabel: {
      ...monoRole(typo, 'label-md'),
      color: muted,
      textTransform: 'uppercase',
    },
    derivedValue: {
      ...monoRole(typo, 'label-lg'),
      fontSize: 18,
      lineHeight: 22,
      color: ink,
    },
    derivedValueNeutral: {
      ...monoRole(typo, 'label-lg'),
      fontSize: 18,
      lineHeight: 22,
      color: muted,
    },
    noteText: {
      ...monoRole(typo, 'label-sm'),
      color: muted,
    },
    advisory: {
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    goalInfoText: {
      fontSize: TYPOGRAPHY['body-sm'].fontSize,
      color: muted,
      fontWeight: '500',
    },
    goalWarningText: {
      fontSize: TYPOGRAPHY['body-sm'].fontSize,
      color: kua ? kua.errorText : colors.error,
      opacity: 0.9,
      fontWeight: '600',
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: border,
    },
    goalAction: {
      minHeight: 44,
      minWidth: 44,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: border,
      borderRadius: GEOMETRY['radius-lg'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    goalActionText: {
      ...monoRole(typo, 'label-lg'),
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.06 * 13,
      color: ink,
    },
    goalActionDanger: {
      color: kua ? kua.errorText : colors.error,
    },
    formBody: {
      paddingHorizontal: 16,
      paddingBottom: 16,
    },
    formDerived: {
      marginTop: 12,
      marginBottom: 8,
      marginHorizontal: -16,
    },
  });
};
