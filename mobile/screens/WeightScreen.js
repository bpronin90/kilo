import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, SectionTitle, ErrorBanner } from '../components/UI';
import { Colors } from '../theme/colors';
import { useWeightEntries, useWeightGoal, useUserProfile } from '../hooks/useEntries';
import { formatDate, getWeightDeltaSeverity } from '../lib/format';
import { parseWeightEntry } from '../lib/parser';
import { deriveWeightGoalAnalytics } from '../lib/data';
import { isGoalMet as computeIsGoalMet } from '../lib/data/weightGoal';
import { useArchivedWeightGoals } from '../hooks/entries/weightHooks';

import { localDateToday, buildTrendSections } from '../lib/WeightScreenHelpers';

// Web-safe date input. The native @react-native-community/datetimepicker has no
// usable rendering on web, so on web we render a real DOM <input type="date">
// (react-native-web passes lowercase string element types through to the DOM).
// It writes the YYYY-MM-DD value straight back via onChangeDate, matching the
// native onChange path which also normalizes to a YYYY-MM-DD string.
function WebDateInput({ value, onChangeDate, accessibilityLabel }) {
  return React.createElement('input', {
    type: 'date',
    value: value || '',
    max: localDateToday(),
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
import { TrendSection } from '../components/WeightTrendSection';
import { WeightGoalCard } from '../components/WeightGoalCard';
import { WeightHistoryList } from '../components/WeightHistoryList';
import { useWeightGoalForm } from '../hooks/useWeightGoalForm';

export function WeightScreen({
  weightValue,
  setWeightValue,
  weightNote,
  setWeightNote,
  onSaveWeight,
  errorMessage,
  saving,
  weightDateEditEnabled,
}) {
  const { entries, remove, update, error: entriesError, refresh: refreshEntries } = useWeightEntries();
  const { goal, save: saveGoal, clear: clearGoal, archiveGoal } = useWeightGoal();
  const { archivedGoals } = useArchivedWeightGoals();
  const profile = useUserProfile()?.profile ?? null;
  const [editingId, setEditingId] = useState(null);
  const [localError, setLocalError] = useState('');
  const [newEntryDate, setNewEntryDate] = useState(localDateToday);
  const [showNewEntryDatePicker, setShowNewEntryDatePicker] = useState(false);
  const [editDate, setEditDate] = useState('');
  const [showEditDatePicker, setShowEditDatePicker] = useState(false);
  const [goalHistoryCollapsed, setGoalHistoryCollapsed] = useState(true);
  const scrollRef = useRef(null);

  const goalForm = useWeightGoalForm(goal, saveGoal, clearGoal, archiveGoal);

  const {
    trendSummary: trends,
    paceLevel,
    goalInfo: rawGoalInfo,
    calorieEstimate,
  } = useMemo(
    () =>
      deriveWeightGoalAnalytics(
        entries,
        goal,
        {
          goalEditing: goalForm.goalEditing,
          goalTargetWeight: goalForm.goalTargetWeight,
          goalTargetDate: goalForm.goalTargetDate,
          goalStartWeight: goalForm.goalStartWeight,
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

  const trendSections = useMemo(() => buildTrendSections(trends, paceLevel), [trends, paceLevel]);

  const isGoalMet = useMemo(
    () => computeIsGoalMet(goal, trends.currentWeight),
    [goal, trends.currentWeight]
  );

  const sortedArchivedGoals = useMemo(() => {
    return [...archivedGoals].sort((a, b) => {
      const dateA = a.archived_at || a.saved_at || '';
      const dateB = b.archived_at || b.saved_at || '';
      return dateB.localeCompare(dateA);
    });
  }, [archivedGoals]);

  const newEntryDateObj = useMemo(() => {
    if (newEntryDate) {
      const [y, m, d] = newEntryDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [newEntryDate]);

  const editDateObj = useMemo(() => {
    if (editDate) {
      const [y, m, d] = editDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [editDate]);

  const onNewEntryDateChange = (event, selectedDate) => {
    setShowNewEntryDatePicker(false);
    if (selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      setNewEntryDate(`${y}-${m}-${d}`);
    }
  };

  const onEditDateChange = (event, selectedDate) => {
    setShowEditDatePicker(false);
    if (selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      setEditDate(`${y}-${m}-${d}`);
    }
  };

  const handleEditEntry = (entry) => {
    setLocalError('');
    setEditingId(entry.id);
    setWeightValue(String(entry.weight_value));
    setWeightNote(entry.note || '');
    setEditDate(entry.date);
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
  };

  const cancelEdit = () => {
    setLocalError('');
    setEditingId(null);
    setWeightValue('');
    setWeightNote('');
    setEditDate('');
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
      await update(editingId, parsed.weight_value, weightNote.trim() || undefined, weightDateEditEnabled ? editDate : undefined);
      cancelEdit();
    } else {
      const date = weightDateEditEnabled ? newEntryDate : undefined;
      const ok = await onSaveWeight(date);
      if (ok && weightDateEditEnabled) setNewEntryDate(localDateToday());
    }
  };

  const displayError = localError || errorMessage;

  return (
    <ScreenShell
      ref={scrollRef}
      title="Weight log"
      subtitle="Track your body weight over time."
      keyboardShouldPersistTaps="handled"
    >
      {entriesError ? (
        <ErrorBanner message="Could not load weight entries." onRetry={refreshEntries} />
      ) : null}
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
        {weightDateEditEnabled && !editingId && (
          <>
            <Text style={styles.inputLabel}>Date</Text>
            {Platform.OS === 'web' ? (
              <WebDateInput
                value={newEntryDate}
                onChangeDate={setNewEntryDate}
                accessibilityLabel="Weigh-in date"
              />
            ) : (
              <>
                <Pressable
                  style={styles.input}
                  onPress={() => setShowNewEntryDatePicker(true)}
                  accessibilityLabel="Weigh-in date"
                  accessibilityRole="button"
                >
                  <Text style={styles.pickerText}>{newEntryDate}</Text>
                </Pressable>
                {showNewEntryDatePicker && (
                  <DateTimePicker
                    value={newEntryDateObj}
                    mode="date"
                    display="default"
                    onChange={onNewEntryDateChange}
                    onDismiss={() => setShowNewEntryDatePicker(false)}
                    maximumDate={new Date()}
                  />
                )}
              </>
            )}
          </>
        )}
        {weightDateEditEnabled && editingId && (
          <>
            <Text style={styles.inputLabel}>Date</Text>
            {Platform.OS === 'web' ? (
              <WebDateInput
                value={editDate}
                onChangeDate={setEditDate}
                accessibilityLabel="Entry date"
              />
            ) : (
              <>
                <Pressable
                  style={styles.input}
                  onPress={() => setShowEditDatePicker(true)}
                  accessibilityLabel="Entry date"
                  accessibilityRole="button"
                >
                  <Text style={styles.pickerText}>{editDate}</Text>
                </Pressable>
                {showEditDatePicker && (
                  <DateTimePicker
                    value={editDateObj}
                    mode="date"
                    display="default"
                    onChange={onEditDateChange}
                    onDismiss={() => setShowEditDatePicker(false)}
                    maximumDate={new Date()}
                  />
                )}
              </>
            )}
          </>
        )}
        <Button
          onPress={handleSubmit}
          title={editingId ? "Update entry" : "Save weigh-in"}
          disabled={saving}
        />
      </Card>

      <SectionTitle>Goal</SectionTitle>
      <WeightGoalCard
        goal={goal}
        goalInfo={goalInfo}
        calorieEstimate={calorieEstimate}
        currentWeight={trends.currentWeight}
        isGoalMet={isGoalMet}
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

      {sortedArchivedGoals.length > 0 && (
        <View style={styles.archivedContainer}>
          <Pressable
            onPress={() => setGoalHistoryCollapsed(c => !c)}
            style={styles.archivedSectionHeader}
            accessibilityRole="button"
            accessibilityLabel={goalHistoryCollapsed ? 'Expand goal history' : 'Collapse goal history'}
          >
            <SectionTitle>Goal History</SectionTitle>
            <MaterialIcons
              name={goalHistoryCollapsed ? 'expand-more' : 'expand-less'}
              size={18}
              color={Colors.textMuted}
              accessible={false}
            />
          </Pressable>
          <Card style={styles.archivedCard}>
            <View style={styles.archivedColumnHeader}>
              <Text style={[styles.archivedColLabel, { flex: 1 }]}>Target</Text>
              <Text style={[styles.archivedColLabel, { flex: 1 }]}>End Weight</Text>
              <Text style={[styles.archivedColLabel, { flex: 1.2, textAlign: 'right' }]}>Target Date</Text>
            </View>
            {!goalHistoryCollapsed && sortedArchivedGoals.map((g, index) => {
              const isLast = index === sortedArchivedGoals.length - 1;
              // Color End Weight by archived outcome: success when the completed
              // weight met the saved target, error when it did not, neutral when
              // no completed weight was recorded. Reuses the active-goal helper.
              const hasCompletedWeight =
                g.completed_weight !== null && g.completed_weight !== undefined;
              const endWeightOutcomeStyle = hasCompletedWeight
                ? (computeIsGoalMet(g, g.completed_weight)
                    ? styles.archivedValueMet
                    : styles.archivedValueMissed)
                : null;
              return (
                <View key={g.id}>
                  <View style={styles.archivedRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.archivedValue}>{g.target_weight} lb</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.archivedValue, endWeightOutcomeStyle]}>
                        {hasCompletedWeight
                          ? `${g.completed_weight} lb`
                          : '—'}
                      </Text>
                    </View>
                    <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
                      <Text style={styles.archivedDateValue}>
                        {g.target_date ? formatDate(g.target_date) : '—'}
                      </Text>
                    </View>
                  </View>
                  {!isLast && <View style={styles.archivedDivider} />}
                </View>
              );
            })}
            {goalHistoryCollapsed && (
              <View style={styles.archivedCollapsedRow}>
                <Text style={styles.archivedCollapsedText}>
                  Last:{' '}
                  <Text style={styles.archivedCollapsedWeight}>
                    {sortedArchivedGoals[0].completed_weight ?? sortedArchivedGoals[0].target_weight} lb
                  </Text>
                  {`  ·  ${sortedArchivedGoals.length} past goals`}
                </Text>
              </View>
            )}
          </Card>
        </View>
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
  pickerText: {
    fontSize: 16,
    color: Colors.text,
  },
  trendsCardMerged: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
  archivedContainer: {
    gap: 16,
  },
  archivedSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  archivedCard: {
    paddingVertical: 0,
    paddingHorizontal: 0,
    gap: 0,
    overflow: 'hidden',
  },
  archivedColumnHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: Colors.subtleBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  archivedColLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  archivedValue: {
    fontSize: 20,
    fontWeight: '900',
    color: Colors.text,
  },
  archivedValueMet: {
    color: Colors.success,
  },
  archivedValueMissed: {
    color: Colors.error,
  },
  archivedDateValue: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'right',
  },
  archivedDivider: {
    height: 1,
    backgroundColor: Colors.cardBorder,
    marginHorizontal: 16,
  },
  archivedCollapsedRow: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  archivedCollapsedText: {
    fontSize: 15,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  archivedCollapsedWeight: {
    fontWeight: '900',
    color: Colors.text,
  },
});
