import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Button, ActionChip, TextAction, TextField, DateField } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { useKuaTypography, TYPOGRAPHY, TYPOGRAPHY_FALLBACK } from '../theme/typography';
import { formatDate } from '../lib/format';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue, formatGoalWeightValue } from '../lib/units';

export function GoalDerived({ info, calorieEstimate }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
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

  return (
    <View style={styles.goalDerived}>
      <View style={styles.derivedRow}>
        <Text style={styles.derivedLabel}>Target pace</Text>
        {!hasPace && <Text style={styles.derivedValueNeutral}>-</Text>}
        {hasPace && isMaintain && <Text style={styles.derivedValue}>Maintain</Text>}
        {hasPace && !isMaintain && <Text style={styles.derivedValue}>{paceAbs} {unit} / week</Text>}
      </View>

      {hasPace && (tdeeBased || !isMaintain) && calLabel !== null && !(calLabel === 'maintain' && !tdeeBased) && (
        <View style={styles.derivedRow}>
          <Text style={styles.derivedLabel}>
            {tdeeBased ? 'Est. daily consumption' : 'Suggested '}
            {!tdeeBased && <Text style={{ fontStyle: 'italic' }}>{calLabel}</Text>}
          </Text>
          <Text style={styles.derivedValue}>
            {calories_per_day} cal / day{tdeeBased ? '' : ' (estimate)'}
          </Text>
        </View>
      )}

      {!hasPace && (
        <Text style={styles.goalWarningText}>Select a future target date for guidance.</Text>
      )}
      {hasPace && isMaintain && !tdeeBased && (
        <Text style={styles.goalInfoText}>Current weight is within maintenance range.</Text>
      )}
      {hasPace && !isMaintain && isUnrealistic && (
        <Text style={styles.goalWarningText}>Pace is unrealistic - consider a longer timeline.</Text>
      )}
      {hasPace && !isMaintain && isUnhealthy && (
        <Text style={styles.goalWarningText}>Pace is aggressive - a slower target is safer.</Text>
      )}
    </View>
  );
}

export function WeightGoalCard({
  goal,
  goalEditing,
  goalTargetWeight,
  setGoalTargetWeight,
  goalTargetDate,
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
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  const unit = useWeightUnit();
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

  return (
    <Card style={[styles.goalCard, isGoalMet && goal && !goalEditing ? styles.goalCardMet : null]}>
      {(goal || goalEditing) && (
        <View style={styles.goalHeader}>
          {!goalEditing && isGoalMet && (
            <View style={styles.goalHeaderMet}>
              <Text style={styles.goalMetBadge}>Goal Met!</Text>
              <View style={styles.goalHeaderActions}>
                <ActionChip label="Archive" tone="positive" onPress={() => handleArchiveGoal(currentWeight)} />
                <ActionChip label="Edit" onPress={startEditGoal} />
              </View>
            </View>
          )}
          {!goalEditing && !isGoalMet && goalInfo?.isOverdue && (
            <View style={styles.goalHeaderOverdue}>
              <Text style={styles.goalEndedText}>Goal ended</Text>
              <View style={styles.goalHeaderButtons}>
                <ActionChip label="Archive" tone="positive" onPress={() => handleArchiveGoal(currentWeight)} />
                <ActionChip label="Edit" onPress={startEditGoal} />
                <ActionChip label="Clear" tone="danger" onPress={handleClearGoal} />
              </View>
            </View>
          )}
          {!goalEditing && !isGoalMet && !goalInfo?.isOverdue && (
            <View style={styles.goalHeaderActions}>
              <ActionChip label="Edit" onPress={startEditGoal} />
              <ActionChip label="Clear" tone="danger" onPress={handleClearGoal} />
            </View>
          )}
          {goalEditing && (
            <TextAction label="Cancel" onPress={cancelEditGoal} />
          )}
        </View>
      )}

      {!goal && !goalEditing ? (
        <View style={styles.goalEmptyRow} testID="weight-goal-empty">
          <Text style={styles.goalEmptyText}>No goal set</Text>
          <ActionChip label="Set goal" onPress={startEditGoal} />
        </View>
      ) : goalEditing ? (
        <>
          {goalError ? <Text style={styles.goalErrorText}>{goalError}</Text> : null}
          {!currentWeight && (
            <TextField
              label={`Current weight (${unit})`}
              numeric
              value={goalStartWeight}
              onChangeText={setGoalStartWeight}
              placeholder={unit === 'kg' ? '90' : '200'}
            />
          )}
          <TextField
            label={`Target (${unit})`}
            numeric
            value={goalTargetWeight}
            onChangeText={setGoalTargetWeight}
            placeholder={unit === 'kg' ? '80' : '175'}
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
            formatValue={formatDate}
            pickerVisible={showDatePicker}
            onPickerVisibleChange={setShowDatePicker}
          />
          {goalInfo && (
            <View style={styles.formDerived}>
              <View style={styles.goalDivider} />
              <GoalDerived info={goalInfo} calorieEstimate={calorieEstimate} />
              <View style={[styles.goalDivider, { marginBottom: 8 }]} />
            </View>
          )}
          <Button onPress={() => handleSaveGoal(formCurrentWeight)} title="Save goal" />
        </>
      ) : (
        <View style={styles.goalDisplay}>
          <View style={styles.goalDisplayRow}>
            <View style={styles.goalDisplayItem}>
              <Text style={styles.goalDisplayLabel}>Target</Text>
              <Text style={styles.goalDisplayValue}>{formatGoalWeightValue(goal.target_weight, unit)} {unit}</Text>
            </View>
            <View style={styles.goalDisplayItem}>
              <Text style={styles.goalDisplayLabel}>Target Date</Text>
              <Text style={styles.goalDisplayDateValue}>{formatDate(goal.target_date)}</Text>
            </View>
          </View>

          {remainingToGoal !== null && !isGoalMet && !goalInfo?.isOverdue && !aheadOfSchedule && (
            <View style={styles.goalProgressRow}>
              <Text style={styles.goalProgressValue}>{displayWeight(remainingToGoal, unit).toFixed(1)} {unit}</Text>
              <Text style={styles.goalProgressLabel}>to go</Text>
            </View>
          )}

          {aheadOfSchedule && (
            <View style={styles.goalProgressRow}>
              <Text style={styles.goalAheadText}>On Track</Text>
            </View>
          )}

          {goalInfo && !goalInfo.isOverdue && (
            <>
              <View style={styles.goalDivider} />
              <GoalDerived info={goalInfo} calorieEstimate={calorieEstimate} />
            </>
          )}
        </View>
      )}
    </Card>
  );
}

// Full JetBrains Mono role (family, tracking, tabular-nums); weight is encoded in the family.
const monoRole = (typo, role) => (typo || TYPOGRAPHY_FALLBACK)[role];

export const createStyles = (colors, kua = null, typo = null) => StyleSheet.create({
  goalCard: {
    gap: 8,
  },
  goalCardMet: {
    borderColor: kua ? kua.success : colors.success,
    borderWidth: 1.5,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  goalHeaderMet: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalHeaderActions: {
    flexDirection: 'row',
    gap: 4,
  },
  goalHeaderOverdue: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalHeaderButtons: {
    flexDirection: 'row',
    gap: 4,
  },
  goalMetBadge: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.success : colors.success,
    letterSpacing: 0.3,
  },
  goalErrorText: {
    color: kua ? kua.error : colors.error,
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
  },
  goalEmptyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalEmptyText: {
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '600',
  },
  goalDisplay: {
    gap: 8,
  },
  goalDisplayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalDisplayItem: {
    flex: 1,
    gap: 1,
  },
  goalDisplayValue: {
    ...monoRole(typo, 'label-lg'),
    color: kua ? kua.primary : colors.accentText,
  },
  goalDisplayDateValue: {
    ...monoRole(typo, 'label-lg'),
    color: kua ? kua.onSurface : colors.text,
  },
  goalDisplayLabel: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalProgressRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  goalProgressValue: {
    ...monoRole(typo, 'label-sm'),
    color: kua ? kua.primary : colors.accentText,
  },
  goalProgressLabel: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalEndedText: {
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
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
  goalDivider: {
    height: 1,
    backgroundColor: kua ? kua.surfaceBorder : colors.cardBorder,
    opacity: 0.5,
    marginVertical: 4,
  },
  goalDerived: {
    gap: 12,
  },
  derivedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  derivedLabel: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  derivedValue: {
    ...monoRole(typo, 'label-sm'),
    color: kua ? kua.onSurface : colors.text,
  },
  derivedValueNeutral: {
    ...monoRole(typo, 'label-sm'),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    opacity: 0.5,
  },
  goalInfoText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  goalWarningText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.errorText : colors.error,
    opacity: 0.9,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  formDerived: {
    gap: 12,
    marginVertical: 4,
  },
});
