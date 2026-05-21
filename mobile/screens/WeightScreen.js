import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, SectionTitle } from '../components/UI';
import { Colors } from '../theme/colors';
import { useWeightEntries, useWeightGoal } from '../hooks/useEntries';
import { formatDate, formatTimestamp, formatDelta, getWeightDeltaSeverity } from '../lib/format';
import { parseWeightEntry } from '../lib/parser';
import { computeWeightTrends, computeWeightPaceLevel, computeWeightGoal, computeCalorieEstimate } from '../lib/data';

function GoalDerived({ info }) {
  if (!info) return null;
  const { direction, required_weekly_pace, warnings } = info;
  if (required_weekly_pace === null) {
    return (
      <View style={styles.goalDerived}>
        <Text style={styles.goalWarningText}>Target date must be in the future.</Text>
      </View>
    );
  }

  const paceAbs = Math.abs(required_weekly_pace).toFixed(2);
  const { calories_per_day, label: calLabel } = computeCalorieEstimate(required_weekly_pace, direction);

  return (
    <View style={styles.goalDerived}>
      <View style={styles.suggestionRow}>
        <View style={styles.suggestionItem}>
          <Text style={styles.suggestionValue}>{paceAbs}</Text>
          <Text style={styles.suggestionLabel}>lb / week</Text>
        </View>
        {calories_per_day !== null && calLabel !== 'maintain' ? (
          <View style={styles.suggestionItem}>
            <Text style={styles.suggestionValue}>{calories_per_day}</Text>
            <Text style={styles.suggestionLabel}>cal {calLabel}</Text>
          </View>
        ) : null}
      </View>

      {warnings.includes('unrealistic') ? (
        <Text style={styles.goalWarningText}>Pace is unrealistic — consider a longer timeline.</Text>
      ) : warnings.includes('unhealthy') ? (
        <Text style={styles.goalWarningText}>Pace is aggressive — a slower target is safer.</Text>
      ) : null}
    </View>
  );
}

export function WeightScreen({ weightValue, setWeightValue, weightNote, setWeightNote, onSaveWeight, errorMessage, saving }) {
  const { entries, remove, update } = useWeightEntries();
  const { goal, save: saveGoal, clear: clearGoal } = useWeightGoal();
  const [editingId, setEditingId] = useState(null);
  const [localError, setLocalError] = useState('');
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalTargetWeight, setGoalTargetWeight] = useState('');
  const [goalTargetDate, setGoalTargetDate] = useState('');
  const [goalError, setGoalError] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const trends = useMemo(() => computeWeightTrends(entries), [entries]);
  const paceLevel = useMemo(() => computeWeightPaceLevel(entries), [entries]);

  // Populate form inputs when a saved goal loads
  React.useEffect(() => {
    if (goal && !goalEditing) {
      setGoalTargetWeight(String(goal.target_weight));
      setGoalTargetDate(goal.target_date);
    }
  }, [goal]);

  const currentWeight = entries.length > 0 ? entries[0].weight_value : null;

  const goalInfo = useMemo(() => {
    const tw = parseFloat(goalTargetWeight);
    if (!currentWeight || isNaN(tw) || !goalTargetDate) return null;
    try {
      return computeWeightGoal({ currentWeight, targetWeight: tw, targetDate: goalTargetDate });
    } catch {
      return null;
    }
  }, [currentWeight, goalTargetWeight, goalTargetDate]);

  const handleSaveGoal = async () => {
    setGoalError('');
    const tw = parseFloat(goalTargetWeight);
    if (isNaN(tw) || tw <= 0) {
      setGoalError('Enter a valid target weight.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(goalTargetDate)) {
      setGoalError('Enter target date.');
      return;
    }
    const [tYear, tMonth, tDay] = goalTargetDate.split('-').map(Number);
    const parsedDate = new Date(tYear, tMonth - 1, tDay);
    if (parsedDate.getFullYear() !== tYear || parsedDate.getMonth() !== tMonth - 1 || parsedDate.getDate() !== tDay) {
      setGoalError('Enter a valid calendar date.');
      return;
    }
    await saveGoal({ target_weight: tw, target_date: goalTargetDate });
    setGoalEditing(false);
  };

  const handleClearGoal = () => {
    Alert.alert('Clear Goal', 'Remove your weight goal?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await clearGoal();
        setGoalTargetWeight('');
        setGoalTargetDate('');
        setGoalEditing(false);
      }},
    ]);
  };

  const startEditGoal = () => {
    if (goal) {
      setGoalTargetWeight(String(goal.target_weight));
      setGoalTargetDate(goal.target_date);
    } else {
      // Default to one month from now if no goal exists
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      setGoalTargetDate(d.toISOString().slice(0, 10));
    }
    setGoalError('');
    setGoalEditing(true);
  };

  const cancelEditGoal = () => {
    setGoalError('');
    setGoalEditing(false);
  };

  const onDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
      // Use local date parts to avoid UTC shift
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      setGoalTargetDate(`${y}-${m}-${d}`);
    }
  };

  const pickerDate = useMemo(() => {
    if (goalTargetDate) {
      const [y, m, d] = goalTargetDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [goalTargetDate]);

  const handleEditEntry = (entry) => {
    setLocalError('');
    setEditingId(entry.id);
    setWeightValue(String(entry.weight_value));
    setWeightNote(entry.note || '');
  };

  const cancelEdit = () => {
    setLocalError('');
    setEditingId(null);
    setWeightValue('');
    setWeightNote('');
  };

  const handleDelete = (id) => {
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
  };

  const handleSubmit = async () => {
    setLocalError('');
    if (editingId) {
      const parsed = parseWeightEntry(weightValue);
      if (!parsed.ok) {
        setLocalError(parsed.error);
        return;
      }
      await update(editingId, parsed.weight_value, weightNote.trim() || undefined);
      cancelEdit();
    } else {
      onSaveWeight();
    }
  };

  const displayError = localError || errorMessage;

  return (
    <ScreenShell
      title="Weight log"
      subtitle="Track your body weight over time."
      keyboardShouldPersistTaps="handled"
    >
      <Card style={styles.goalCard}>
        <View style={styles.goalHeader}>
          <Text style={styles.goalTitle}>Goal</Text>
          {goal && !goalEditing ? (
            <View style={styles.goalHeaderActions}>
              <Pressable onPress={startEditGoal} hitSlop={8}>
                <Text style={styles.goalActionText}>Edit</Text>
              </Pressable>
              <Pressable onPress={handleClearGoal} hitSlop={8}>
                <Text style={[styles.goalActionText, styles.goalClearText]}>Clear</Text>
              </Pressable>
            </View>
          ) : null}
          {goalEditing && goal ? (
            <Pressable onPress={cancelEditGoal} hitSlop={8}>
              <Text style={styles.goalActionText}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>

        {(!goal || goalEditing) ? (
          <View style={styles.goalForm}>
            {goalError ? <Text style={styles.goalErrorText}>{goalError}</Text> : null}
            <Text style={styles.inputLabel}>Target weight (lb)</Text>
            <TextInput
              value={goalTargetWeight}
              onChangeText={setGoalTargetWeight}
              placeholder="175.0"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <Text style={styles.inputLabel}>Target date</Text>
            <Pressable 
              onPress={() => setShowDatePicker(true)}
              style={styles.input}
            >
              <Text style={{ color: goalTargetDate ? Colors.text : Colors.textMuted }}>
                {goalTargetDate ? formatDate(goalTargetDate) : 'Select date'}
              </Text>
            </Pressable>
            {showDatePicker && (
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display="default"
                onChange={onDateChange}
                minimumDate={new Date()}
              />
            )}
            {goalInfo ? <GoalDerived info={goalInfo} /> : null}
            <Button onPress={handleSaveGoal} title="Save goal" />
          </View>
        ) : (
          <View style={styles.goalDisplay}>
            <View style={styles.goalDisplayRow}>
              <View style={styles.goalDisplayItem}>
                <Text style={styles.goalDisplayValue}>{goal.target_weight} lb</Text>
                <Text style={styles.goalDisplayLabel}>target</Text>
              </View>
              <View style={styles.goalDisplayItem}>
                <Text style={styles.goalDisplayValue}>{formatDate(goal.target_date)}</Text>
                <Text style={styles.goalDisplayLabel}>by date</Text>
              </View>
            </View>
            {goalInfo ? <GoalDerived info={goalInfo} /> : null}
          </View>
        )}
      </Card>

      <Card style={editingId ? styles.editingCard : null}>
        {editingId ? (
          <View style={styles.editingHeader}>
            <Text style={styles.editingTitle}>Editing entry</Text>
            <Pressable onPress={cancelEdit}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {displayError ? (
          <Text style={styles.errorText}>{displayError}</Text>
        ) : null}
        <Text style={styles.inputLabel}>Weight (lb)</Text>
        <TextInput
          value={weightValue}
          onChangeText={setWeightValue}
          placeholder="185.0"
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <Text style={styles.inputLabel}>Note</Text>
        <TextInput
          value={weightNote}
          onChangeText={setWeightNote}
          placeholder="Morning, fasted"
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
        />
        <Button 
          onPress={handleSubmit} 
          title={editingId ? "Update entry" : "Save weigh-in"} 
          disabled={saving}
          style={styles.saveButton}
        />
      </Card>

      {(trends.avg7 !== null || trends.avg30 !== null) ? (
        <Card style={styles.trendsCard}>
          <Text style={styles.trendsTitle}>Trends</Text>
          <View style={styles.trendsRow}>
            {trends.avg7 !== null ? (
              <View style={styles.trendItem}>
                <Text style={styles.trendValue}>{trends.avg7.toFixed(1)} lb</Text>
                <Text style={styles.trendLabel}>7-day avg</Text>
              </View>
            ) : null}
            {trends.avg30 !== null ? (
              <View style={styles.trendItem}>
                <Text style={styles.trendValue}>{trends.avg30.toFixed(1)} lb</Text>
                <Text style={styles.trendLabel}>30-day avg</Text>
              </View>
            ) : null}
            {trends.paceFlag ? (
              <View style={styles.trendItem}>
                <Text style={[styles.trendValue, paceLevel === 'spike' ? styles.paceSpike : styles.paceNotable]}>
                  {trends.paceFlag === 'gain' ? '↑ Gaining fast' : '↓ Losing fast'}
                </Text>
                <Text style={styles.trendLabel}>pace flag</Text>
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      <SectionTitle>History</SectionTitle>
      <View style={styles.historyList}>
        {entries.map((entry, index) => {
          const nextEntry = entries[index + 1];
          const delta = nextEntry ? entry.weight_value - nextEntry.weight_value : null;
          const severity = getWeightDeltaSeverity(delta);

          return (
            <View 
              key={entry.id} 
              style={[
                styles.historyRowContainer,
                editingId === entry.id && styles.activeEntryRow,
                index === entries.length - 1 && styles.lastHistoryRow
              ]}
            >
              <Pressable 
                onPress={() => handleEditEntry(entry)}
                style={({ pressed }) => [
                  styles.rowMain,
                  pressed && styles.historyRowPressed
                ]}
              >
                <View style={styles.rowTop}>
                  <View style={styles.rowWeightGroup}>
                    <Text style={styles.rowWeight}>
                      {entry.weight_value} {entry.weight_unit || 'lb'}
                    </Text>
                    {delta !== null && (
                      <Text style={[
                        styles.rowDelta,
                        severity === 'notable' && styles.deltaNotable,
                        severity === 'spike' && styles.deltaSpike,
                        severity === 'outlier' && styles.deltaOutlier,
                      ]}>
                        {formatDelta(delta)}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.rowDate}>{formatDate(entry.logged_at)}</Text>
                </View>
                {entry.note ? (
                  <Text style={styles.rowNote} numberOfLines={1}>
                    {entry.note}
                  </Text>
                ) : null}
              </Pressable>
              <Pressable 
                onPress={() => handleDelete(entry.id)} 
                style={({ pressed }) => [
                  styles.deleteAffordance,
                  pressed && styles.deleteAffordancePressed
                ]}
                hitSlop={12}
              >
                <Text style={styles.deleteAffordanceText}>✕</Text>
              </Pressable>
            </View>
          );
        })}
        {entries.length === 0 ? (
          <Text style={styles.emptyText}>No weight entries yet.</Text>
        ) : null}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  errorText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
    justifyContent: 'center',
  },
  editingCard: {
    borderColor: Colors.accent,
    borderWidth: 2,
  },
  editingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  editingTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
    textTransform: 'uppercase',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    padding: 4,
  },
  historyList: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  historyRowContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  historyRowPressed: {
    backgroundColor: Colors.chipBackground,
    opacity: 0.8,
  },
  activeEntryRow: {
    backgroundColor: Colors.chipBackground,
  },
  lastHistoryRow: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowWeightGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  rowWeight: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  rowDelta: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  deltaNotable: {
    color: Colors.accent,
  },
  deltaSpike: {
    color: Colors.error,
  },
  deltaOutlier: {
    color: Colors.error,
    fontWeight: '900',
    textDecorationLine: 'underline',
  },
  rowDate: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  rowNote: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 1,
  },
  deleteAffordance: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteAffordancePressed: {
    backgroundColor: Colors.chipBackground,
    opacity: 0.8,
  },
  deleteAffordanceText: {
    fontSize: 18,
    color: Colors.textMuted,
    opacity: 0.5,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    paddingVertical: 32,
    fontSize: 15,
  },
  trendsCard: {
    gap: 10,
  },
  trendsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  trendsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  trendItem: {
    gap: 2,
  },
  trendValue: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  trendLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  paceSpike: {
    color: Colors.error,
  },
  paceNotable: {
    color: Colors.accent,
  },
  goalCard: {
    gap: 10,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  goalTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  goalHeaderActions: {
    flexDirection: 'row',
    gap: 12,
  },
  goalActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  goalClearText: {
    color: Colors.error,
    opacity: 0.7,
  },
  goalForm: {
    gap: 8,
  },
  goalErrorText: {
    color: Colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  goalDisplay: {
    gap: 8,
  },
  goalDisplayRow: {
    flexDirection: 'row',
    gap: 20,
  },
  goalDisplayItem: {
    gap: 2,
  },
  goalDisplayValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  goalDisplayLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  goalDerived: {
    marginTop: 4,
    gap: 12,
  },
  suggestionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  suggestionItem: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  suggestionValue: {
    fontSize: 24,
    fontWeight: '900',
    color: Colors.accent,
  },
  suggestionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  goalWarningText: {
    fontSize: 13,
    color: Colors.error,
    opacity: 0.9,
    fontWeight: '600',
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: Colors.accent,
    paddingVertical: 12,
  },
});
