import React from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card, Button, InputStyle } from './UI';
import { Colors } from '../theme/colors';
import { formatDate } from '../lib/format';
import { localDateToday } from '../lib/WeightScreenHelpers';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue } from '../lib/units';

// Web-safe goal target date input. The native @react-native-community/datetimepicker
// has no usable rendering on web, so on web we render a real DOM <input type="date">
// (react-native-web passes lowercase string element types through to the DOM),
// mirroring the Weight tab entry-form fallback. Goal targets are future dates, so
// this uses min={today} for parity with the native picker's minimumDate.
function WebGoalDateInput({ value, onChangeDate, accessibilityLabel }) {
  return React.createElement('input', {
    type: 'date',
    value: value || '',
    min: localDateToday(),
    'aria-label': accessibilityLabel,
    onChange: (e) => {
      const next = e?.target?.value;
      if (next) onChangeDate(next);
    },
    style: {
      backgroundColor: Colors.inputBackground,
      borderRadius: 16,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: Colors.inputBorder,
      padding: 14,
      fontSize: 16,
      color: Colors.text,
      fontFamily: 'inherit',
      width: '100%',
      boxSizing: 'border-box',
    },
  });
}

export function GoalDerived({ info, calorieEstimate }) {
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
  pickerDate,
  goalInfo,
  calorieEstimate,
  currentWeight,
  isGoalMet,
  aheadOfSchedule,
}) {
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
      {goal && (
        <View style={styles.goalHeader}>
          {!goalEditing && isGoalMet && (
            <View style={styles.goalHeaderMet}>
              <Text style={styles.goalMetBadge}>Goal Met!</Text>
              <View style={styles.goalHeaderActions}>
                <Pressable onPress={() => handleArchiveGoal(currentWeight)} hitSlop={12} style={[styles.goalActionChip, styles.goalArchiveChip]}>
                  <Text style={[styles.goalActionChipText, styles.goalArchiveText]}>Archive</Text>
                </Pressable>
                <Pressable onPress={startEditGoal} hitSlop={12} style={styles.goalActionChip}>
                  <Text style={styles.goalActionChipText}>Edit</Text>
                </Pressable>
              </View>
            </View>
          )}
          {!goalEditing && !isGoalMet && (
            <View style={styles.goalHeaderActions}>
              {goalInfo?.isOverdue && (
                <Pressable onPress={() => handleArchiveGoal(currentWeight)} hitSlop={12} style={[styles.goalActionChip, styles.goalArchiveChip]}>
                  <Text style={[styles.goalActionChipText, styles.goalArchiveText]}>Archive</Text>
                </Pressable>
              )}
              <Pressable onPress={startEditGoal} hitSlop={12} style={styles.goalActionChip}>
                <Text style={styles.goalActionChipText}>Edit</Text>
              </Pressable>
              <Pressable onPress={handleClearGoal} hitSlop={12} style={styles.goalActionChip}>
                <Text style={[styles.goalActionChipText, styles.goalClearText]}>Clear</Text>
              </Pressable>
            </View>
          )}
          {goalEditing && (
            <Pressable onPress={cancelEditGoal} hitSlop={8}>
              <Text style={styles.goalActionText}>Cancel</Text>
            </Pressable>
          )}
        </View>
      )}

      {(!goal || goalEditing) ? (
        <>
          {goalError ? <Text style={styles.goalErrorText}>{goalError}</Text> : null}
          {!currentWeight && (
            <>
              <Text style={styles.inputLabel}>Current weight ({unit})</Text>
              <TextInput
                value={goalStartWeight}
                onChangeText={setGoalStartWeight}
                placeholder={unit === 'kg' ? '90.0' : '200.0'}
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </>
          )}
          <Text style={styles.inputLabel}>Target ({unit})</Text>
          <TextInput
            value={goalTargetWeight}
            onChangeText={setGoalTargetWeight}
            placeholder={unit === 'kg' ? '80.0' : '175.0'}
            placeholderTextColor={Colors.textMuted}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <Text style={styles.inputLabel}>Target Date</Text>
          {Platform.OS === 'web' ? (
            <WebGoalDateInput
              value={goalTargetDate}
              onChangeDate={(dateStr) => {
                const [y, m, d] = dateStr.split('-').map(Number);
                onDateChange({ type: 'set' }, new Date(y, m - 1, d));
              }}
              accessibilityLabel="Goal target date"
            />
          ) : (
            <>
              <Pressable
                onPress={() => setShowDatePicker(true)}
                style={styles.input}
                accessibilityLabel="Goal target date"
                accessibilityRole="button"
              >
                <Text style={[styles.pickerText, !goalTargetDate && styles.pickerTextPlaceholder]}>
                  {goalTargetDate ? formatDate(goalTargetDate) : 'Select date'}
                </Text>
              </Pressable>
              {showDatePicker && (
                <DateTimePicker
                  value={pickerDate}
                  mode="date"
                  display="default"
                  onChange={onDateChange}
                  onDismiss={() => setShowDatePicker(false)}
                  minimumDate={new Date()}
                />
              )}
            </>
          )}
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
              <Text style={styles.goalDisplayValue}>{formatBodyweightValue(goal.target_weight, unit)} {unit}</Text>
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

          {goalInfo && (
            <>
              <View style={styles.goalDivider} />
              {goalInfo.isOverdue ? (
                <Text style={styles.goalEndedText}>Goal ended.</Text>
              ) : (
                <GoalDerived info={goalInfo} calorieEstimate={calorieEstimate} />
              )}
            </>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  input: {
    ...InputStyle,
    justifyContent: 'center',
  },
  goalCard: {
    gap: 10,
  },
  goalCardMet: {
    borderColor: Colors.success,
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
    gap: 8,
  },
  goalMetBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.success,
    letterSpacing: 0.3,
  },
  goalArchiveChip: {
    backgroundColor: Colors.cardSuccessBg,
  },
  goalArchiveText: {
    color: Colors.textLight,
  },
  goalActionChip: {
    backgroundColor: Colors.chipBackground,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  goalActionChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.chipText,
  },
  goalClearText: {
    color: Colors.error,
  },
  goalActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    padding: 4,
  },
  pickerText: {
    fontSize: 16,
    color: Colors.text,
  },
  pickerTextPlaceholder: {
    color: Colors.textMuted,
  },
  goalErrorText: {
    color: Colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  goalDisplay: {
    gap: 12,
  },
  goalDisplayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalDisplayItem: {
    flex: 1,
    gap: 2,
  },
  goalDisplayValue: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.accent,
  },
  goalDisplayDateValue: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.text,
  },
  goalDisplayLabel: {
    fontSize: 12,
    color: Colors.textMuted,
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
    fontSize: 16,
    fontWeight: '800',
    color: Colors.accent,
  },
  goalProgressLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalEndedText: {
    fontSize: 14,
    color: Colors.error,
    fontWeight: '600',
  },
  goalAheadText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.caution,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalDivider: {
    height: 1,
    backgroundColor: Colors.cardBorder,
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
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  derivedValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  derivedValueNeutral: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textMuted,
    opacity: 0.5,
  },
  goalInfoText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  goalWarningText: {
    fontSize: 13,
    color: Colors.error,
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
