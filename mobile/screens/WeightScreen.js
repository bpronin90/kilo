import React, { useMemo, useState, useEffect } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, SectionTitle } from '../components/UI';
import { Colors } from '../theme/colors';
import { useWeightEntries, useWeightGoal } from '../hooks/useEntries';
import { formatDate, formatDelta, getWeightDeltaSeverity } from '../lib/format';
import { parseWeightEntry } from '../lib/parser';
import { deriveWeightGoalAnalytics } from '../lib/data';

function formatTrendValue(value) {
  return value !== null ? `${value.toFixed(1)} lb` : '-';
}

function formatTrendDeltaValue(currentValue, priorValue) {
  return currentValue !== null && priorValue !== null
    ? formatDelta(currentValue - priorValue)
    : '-';
}

function formatTrendCue(currentValue, priorValue) {
  if (currentValue === null || priorValue === null) return '-';
  if (currentValue > priorValue) return '↑ Gaining';
  if (currentValue < priorValue) return '↓ Losing';
  return '→ Stable';
}

function buildTrendSections(trends, paceLevel) {
  return [
    {
      title: 'Pace',
      col1: { label: 'Current', value: formatTrendValue(trends.currentWeight) },
      col2: { label: 'Vs Previous', value: formatTrendDeltaValue(trends.currentWeight, trends.priorDayWeight) },
      col3: { label: 'Trend', value: trends.paceFlag ? (trends.paceFlag === 'gain' ? '↑ Gaining' : '↓ Losing') : '-' },
      paceLevel,
    },
    {
      title: '7-day rolling',
      col1: { label: 'Average', value: formatTrendValue(trends.avg7) },
      col2: { label: 'Vs Prior 7d', value: formatTrendDeltaValue(trends.avg7, trends.priorAvg7) },
      col3: { label: 'Trend', value: formatTrendCue(trends.avg7, trends.priorAvg7) },
    },
    {
      title: '30-day rolling',
      col1: { label: 'Average', value: formatTrendValue(trends.avg30) },
      col2: { label: 'Vs Prior 30d', value: formatTrendDeltaValue(trends.avg30, trends.priorAvg30) },
      col3: { label: 'Trend', value: formatTrendCue(trends.avg30, trends.priorAvg30) },
      isLast: true,
    },
  ];
}

function GoalDerived({ info, calorieEstimate }) {
  if (!info) return null;
  const { direction, required_weekly_pace, warnings } = info;

  const paceAbs = required_weekly_pace !== null ? Math.abs(required_weekly_pace).toFixed(2) : null;
  const calories_per_day = calorieEstimate?.calories_per_day ?? null;
  const calLabel = calorieEstimate?.label ?? null;

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
        {hasPace && !isMaintain && <Text style={styles.derivedValue}>{paceAbs} lb / week</Text>}
      </View>

      {hasPace && !isMaintain && calLabel !== 'maintain' && (
        <View style={styles.derivedRow}>
          <Text style={styles.derivedLabel}>
            Suggested <Text style={{ fontStyle: 'italic' }}>{calLabel}</Text>
          </Text>
          <Text style={styles.derivedValue}>{calories_per_day} cal / day</Text>
        </View>
      )}

      {!hasPace && (
        <Text style={styles.goalWarningText}>Select a future target date for guidance.</Text>
      )}
      {hasPace && isMaintain && (
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

function TrendSection({ title, col1, col2, col3, isLast, paceLevel }) {
  const isSpike = paceLevel === 'spike';
  const isNotable = paceLevel === 'notable';

  return (
    <View style={[styles.trendSection, !isLast && styles.trendSectionDivider]}>
      <Text style={styles.trendSectionTitle}>{title}</Text>
      <View style={styles.trendGrid}>
        <View style={styles.trendGridItem}>
          <Text style={styles.trendLabel}>{col1.label}</Text>
          <Text style={styles.trendValue}>{col1.value}</Text>
        </View>
        <View style={styles.trendGridItem}>
          <Text style={styles.trendLabel}>{col2.label}</Text>
          <Text style={styles.trendValue}>{col2.value}</Text>
        </View>
        <View style={styles.trendGridItem}>
          <Text style={styles.trendLabel}>{col3.label}</Text>
          <Text style={[
            styles.trendValue,
            isSpike ? styles.paceSpike : isNotable ? styles.paceNotable : null
          ]}>
            {col3.value}
          </Text>
        </View>
      </View>
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
  const [goalStartWeight, setGoalStartWeight] = useState('');
  const [goalError, setGoalError] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const {
    trendSummary: trends,
    paceLevel,
    goalInfo,
    calorieEstimate,
  } = useMemo(
    () => deriveWeightGoalAnalytics(entries, goal, { goalEditing, goalTargetWeight, goalTargetDate, goalStartWeight }),
    [entries, goal, goalEditing, goalTargetWeight, goalTargetDate, goalStartWeight]
  );
  const trendSections = useMemo(() => buildTrendSections(trends, paceLevel), [trends, paceLevel]);

  useEffect(() => {
    if (goal && !goalEditing) {
      setGoalTargetWeight(String(goal.target_weight));
      setGoalTargetDate(goal.target_date);
      setGoalStartWeight(goal.start_weight ? String(goal.start_weight) : '');
    }
  }, [goal, goalEditing]);

  const handleSaveGoal = async () => {
    setGoalError('');
    const tw = parseFloat(goalTargetWeight);
    if (isNaN(tw) || tw <= 0) {
      setGoalError('Enter a valid target weight.');
      return;
    }
    const startW = trends.currentWeight ?? parseFloat(goalStartWeight);
    if (!trends.currentWeight && (isNaN(startW) || startW <= 0)) {
      setGoalError('Enter your current weight.');
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
    await saveGoal({
      target_weight: tw,
      target_date: goalTargetDate,
      start_weight: !isNaN(startW) && startW > 0 ? startW : null,
    });
    setGoalEditing(false);
  };

  const handleClearGoal = () => {
    Alert.alert('Clear Goal', 'Remove your weight goal?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await clearGoal();
        setGoalTargetWeight('');
        setGoalTargetDate('');
        setGoalStartWeight('');
        setGoalEditing(false);
      }},
    ]);
  };

  const startEditGoal = () => {
    if (goal) {
      setGoalTargetWeight(String(goal.target_weight));
      setGoalTargetDate(goal.target_date);
      setGoalStartWeight(goal.start_weight ? String(goal.start_weight) : '');
    } else {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      setGoalTargetDate(d.toISOString().slice(0, 10));
      setGoalStartWeight('');
    }
    setGoalError('');
    setGoalEditing(true);
  };

  const cancelEditGoal = () => {
    setGoalError('');
    setGoalStartWeight('');
    setGoalEditing(false);
  };

  const onDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) {
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
      <Card style={editingId ? styles.editingCard : null}>
        {editingId && (
          <View style={styles.editingHeader}>
            <Text style={styles.editingTitle}>Editing entry</Text>
            <Pressable onPress={cancelEdit}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        )}
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

      <SectionTitle>Goals</SectionTitle>
      <Card style={styles.goalCard}>
        <View style={styles.goalHeader}>
          <Text style={styles.goalTitle}>Goal</Text>
          {goal && !goalEditing && (
            <View style={styles.goalHeaderActions}>
              <Pressable onPress={startEditGoal} hitSlop={8}>
                <Text style={styles.goalActionText}>Edit</Text>
              </Pressable>
              <Pressable onPress={handleClearGoal} hitSlop={8}>
                <Text style={[styles.goalActionText, styles.goalClearText]}>Clear</Text>
              </Pressable>
            </View>
          )}
          {goalEditing && goal && (
            <Pressable onPress={cancelEditGoal} hitSlop={8}>
              <Text style={styles.goalActionText}>Cancel</Text>
            </Pressable>
          )}
        </View>

        {(!goal || goalEditing) ? (
          <View style={styles.goalForm}>
            {goalError ? <Text style={styles.goalErrorText}>{goalError}</Text> : null}
            {!trends.currentWeight && (
              <>
                <Text style={styles.inputLabel}>Current weight (lb)</Text>
                <TextInput
                  value={goalStartWeight}
                  onChangeText={setGoalStartWeight}
                  placeholder="200.0"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </>
            )}
            <Text style={styles.inputLabel}>Target</Text>
            <TextInput
              value={goalTargetWeight}
              onChangeText={setGoalTargetWeight}
              placeholder="175.0"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <Text style={styles.inputLabel}>By Date</Text>
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
            {goalInfo && (
              <View style={styles.formDerived}>
                <View style={styles.goalDivider} />
                <GoalDerived info={goalInfo} calorieEstimate={calorieEstimate} />
                <View style={[styles.goalDivider, { marginBottom: 8 }]} />
              </View>
            )}
            <Button onPress={handleSaveGoal} title="Save goal" />
          </View>
        ) : (
          <View style={styles.goalDisplay}>
            <View style={styles.goalDisplayRow}>
              <View style={styles.goalDisplayItem}>
                <Text style={styles.goalDisplayLabel}>Target</Text>
                <Text style={styles.goalDisplayValue}>{goal.target_weight} lb</Text>
              </View>
              <View style={styles.goalDisplayItem}>
                <Text style={styles.goalDisplayLabel}>By Date</Text>
                <Text style={styles.goalDisplayValue}>{formatDate(goal.target_date)}</Text>
              </View>
            </View>
            
            <View style={styles.goalDivider} />
            
            {goalInfo && <GoalDerived info={goalInfo} calorieEstimate={calorieEstimate} />}
          </View>
        )}
      </Card>

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
          />
        ))}
      </Card>

      <SectionTitle>History</SectionTitle>
      <View style={styles.historyList}>
        {entries.map((entry, index) => {
          const nextEntry = entries[index + 1];
          const delta = nextEntry ? entry.weight_value - nextEntry.weight_value : null;
          const severity = getWeightDeltaSeverity(delta);
          const isLast = index === entries.length - 1;
          const isActive = editingId === entry.id;

          return (
            <View 
              key={entry.id} 
              style={[
                styles.historyRowContainer,
                isActive && styles.activeEntryRow,
                isLast && styles.lastHistoryRow
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
                {entry.note && (
                  <Text style={styles.rowNote} numberOfLines={1}>
                    {entry.note}
                  </Text>
                )}
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
        {entries.length === 0 && (
          <Text style={styles.emptyText}>No weight entries yet.</Text>
        )}
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
  trendsCardMerged: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
  trendSection: {
    padding: 16,
    gap: 12,
  },
  trendSectionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  trendSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trendGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  trendGridItem: {
    flex: 1,
    gap: 2,
  },
  trendValue: {
    fontSize: 20,
    fontWeight: '900',
    color: Colors.text,
  },
  trendLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
    fontSize: 24,
    fontWeight: '900',
    color: Colors.accent,
  },
  goalDisplayLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '700',
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
    fontSize: 15,
    color: Colors.textMuted,
    fontWeight: '600',
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
  saveButton: {
    backgroundColor: Colors.accent,
    paddingVertical: 12,
  },
});
