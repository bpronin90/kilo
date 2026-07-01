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

// Format a Date into a local YYYY-MM-DD string (matching the web <input type="date">
// value). Shared by the entry-date fields so native picker selections normalize the
// same way regardless of which field they came from.
function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Single weigh-in "Date" field. The new-entry and edit forms rendered identical
// label + web-input / native-picker blocks; this consolidates them and owns its own
// picker-visibility state so the parent only tracks the YYYY-MM-DD value.
function DateEntryField({ value, onChangeDate, a11yLabel }) {
  const [showPicker, setShowPicker] = useState(false);
  const dateObj = useMemo(() => {
    if (value) {
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [value]);

  const onPickerChange = (event, selectedDate) => {
    setShowPicker(false);
    if (selectedDate) onChangeDate(toYMD(selectedDate));
  };

  return (
    <>
      <Text style={styles.inputLabel}>Date</Text>
      {Platform.OS === 'web' ? (
        <WebDateInput
          value={value}
          onChangeDate={onChangeDate}
          accessibilityLabel={a11yLabel}
        />
      ) : (
        <>
          <Pressable
            style={styles.input}
            onPress={() => setShowPicker(true)}
            accessibilityLabel={a11yLabel}
            accessibilityRole="button"
          >
            <Text style={styles.pickerText}>{value}</Text>
          </Pressable>
          {showPicker && (
            <DateTimePicker
              value={dateObj}
              mode="date"
              display="default"
              onChange={onPickerChange}
              onDismiss={() => setShowPicker(false)}
              maximumDate={new Date()}
            />
          )}
        </>
      )}
    </>
  );
}

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
  const [editDate, setEditDate] = useState('');
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
    const met = computeIsGoalMet(latest, latest.completed_weight);
    return { label: met ? 'Success' : 'Missed', met };
  }, [sortedArchivedGoals]);

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
          <DateEntryField
            value={newEntryDate}
            onChangeDate={setNewEntryDate}
            a11yLabel="Weigh-in date"
          />
        )}
        {weightDateEditEnabled && editingId && (
          <DateEntryField
            value={editDate}
            onChangeDate={setEditDate}
            a11yLabel="Entry date"
          />
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
        <GoalHistoryPanel
          sortedArchivedGoals={sortedArchivedGoals}
          collapsed={goalHistoryCollapsed}
          setCollapsed={setGoalHistoryCollapsed}
          latestArchivedOutcome={latestArchivedOutcome}
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
    </ScreenShell>
  );
}

// Archived-goal history panel. Shares the one-panel visual system with Weight
// History (#411): the header row IS the column-header / summary row, with the
// collapse chevron in a trailing control cell and no separate empty chevron strip.
function GoalHistoryPanel({ sortedArchivedGoals, collapsed, setCollapsed, latestArchivedOutcome }) {
  return (
    <View style={styles.archivedContainer}>
      <SectionTitle>Goal History</SectionTitle>
      <View style={hp.card}>
        <Pressable
          onPress={() => setCollapsed(c => !c)}
          style={[hp.headerRow, !collapsed && hp.headerRowBordered]}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expand goal history' : 'Collapse goal history'}
        >
          {collapsed ? (
            <View style={hp.headerContent}>
              <View style={hp.summaryStack}>
                <Text style={hp.summaryCount}>
                  {`${sortedArchivedGoals.length} ${sortedArchivedGoals.length === 1 ? 'goal' : 'goals'}`}
                </Text>
                <Text style={hp.summaryLatest} numberOfLines={1}>
                  {'Latest: '}
                  <Text
                    style={[
                      hp.summaryEmphasis,
                      latestArchivedOutcome?.met === true && styles.archivedValueMet,
                      latestArchivedOutcome?.met === false && styles.archivedValueMissed,
                    ]}
                  >
                    {latestArchivedOutcome?.label}
                  </Text>
                </Text>
              </View>
            </View>
          ) : (
            <View style={hp.headerContent}>
              <Text style={[hp.columnLabel, hp.col1]}>Target</Text>
              <Text style={[hp.columnLabel, hp.col2, hp.columnLabelCenter]}>End Weight</Text>
              <Text style={[hp.columnLabel, hp.col3, hp.columnLabelRight]}>Target Date</Text>
            </View>
          )}
          <View style={hp.controlCell}>
            <MaterialIcons
              name={collapsed ? 'expand-more' : 'expand-less'}
              size={18}
              color={Colors.textMuted}
              accessible={false}
            />
          </View>
        </Pressable>
        {!collapsed && sortedArchivedGoals.map((g, index) => {
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
            <View key={g.id} style={[hp.rowContainer, isLast && hp.lastRow]}>
              <View style={hp.rowMain}>
                <View style={hp.rowCells}>
                  <View style={hp.col1}>
                    <Text style={hp.value}>{g.target_weight} lb</Text>
                  </View>
                  <View style={hp.col2}>
                    <Text style={[hp.value, endWeightOutcomeStyle]}>
                      {hasCompletedWeight ? `${g.completed_weight} lb` : '—'}
                    </Text>
                  </View>
                  <View style={hp.col3}>
                    <Text style={hp.dateValue}>
                      {g.target_date ? formatDate(g.target_date) : '—'}
                    </Text>
                  </View>
                </View>
              </View>
              {/* Reserved trailing control cell keeps the three content
                  columns aligned with Weight History's rows (#411). */}
              <View style={hp.controlCellRow} />
            </View>
          );
        })}
      </View>
    </View>
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
  // Semantic End Weight / latest-outcome colors — the only intended visual
  // difference from the Weight History panel (#411). Applied on top of the
  // shared hp.value / hp.summaryEmphasis typography below.
  archivedValueMet: {
    color: Colors.success,
  },
  archivedValueMissed: {
    color: Colors.error,
  },
});

// ── Shared history-panel visual system (#411) ─────────────────────────────────
// Goal History (this screen) and Weight History (WeightHistoryList.js) render as
// ONE uniform system. Every value below is kept numerically identical to the
// block of the same name in WeightHistoryList.js so the two panels' equivalent
// elements (header row, 3-column [value·value·date] grid, trailing control cell,
// values, dates, labels, and collapsed summary) match exactly. The only intended
// differences between panels are the literal label text and semantic outcome
// colors (End Weight / Success-Missed). These constants are duplicated (not
// imported) because both panels must stay inside their Allowed Files.
const HISTORY_COL1_FLEX = 1.35; // primary value, left aligned
const HISTORY_COL2_FLEX = 1.25; // secondary value, center aligned
const HISTORY_COL3_FLEX = 1.5; // date, right aligned
const HISTORY_CONTROL_WIDTH = 56; // trailing control cell (chevron / filter / delete)
const HISTORY_ROW_PAD_V = 12;
const HISTORY_ROW_PAD_H = 16;
const HISTORY_VALUE_SIZE = 20;
const HISTORY_VALUE_WEIGHT = '700';
const HISTORY_DATE_SIZE = 15;
const HISTORY_DATE_WEIGHT = '600';
const HISTORY_LABEL_SIZE = 11;
const HISTORY_LABEL_WEIGHT = '700';
const HISTORY_SUMMARY_SIZE = 15;
const HISTORY_SUMMARY_WEIGHT = '600';
const HISTORY_SUMMARY_EMPHASIS_WEIGHT = '900';
const HISTORY_SUMMARY_COUNT_SIZE = 12;
const HISTORY_SUMMARY_COUNT_WEIGHT = '600';

const hp = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: HISTORY_ROW_PAD_H,
    paddingRight: 0,
    paddingVertical: 10,
    backgroundColor: Colors.subtleBg,
  },
  headerRowBordered: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  headerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  controlCell: {
    width: HISTORY_CONTROL_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 12,
    gap: 8,
  },
  controlIconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlCellRow: {
    width: HISTORY_CONTROL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  columnLabel: {
    fontSize: HISTORY_LABEL_SIZE,
    fontWeight: HISTORY_LABEL_WEIGHT,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  col1: {
    flex: HISTORY_COL1_FLEX,
    alignItems: 'flex-start',
  },
  col2: {
    flex: HISTORY_COL2_FLEX,
    alignItems: 'center',
  },
  col3: {
    flex: HISTORY_COL3_FLEX,
    alignItems: 'flex-end',
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  activeRow: {
    backgroundColor: Colors.chipBackground,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    paddingLeft: HISTORY_ROW_PAD_H,
    paddingRight: 0,
    paddingVertical: HISTORY_ROW_PAD_V,
  },
  rowCells: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  value: {
    fontSize: HISTORY_VALUE_SIZE,
    fontWeight: HISTORY_VALUE_WEIGHT,
    color: Colors.text,
  },
  dateValue: {
    fontSize: HISTORY_DATE_SIZE,
    fontWeight: HISTORY_DATE_WEIGHT,
    color: Colors.textMuted,
    textAlign: 'right',
  },
  summaryText: {
    flex: 1,
    fontSize: HISTORY_SUMMARY_SIZE,
    fontWeight: HISTORY_SUMMARY_WEIGHT,
    color: Colors.textMuted,
  },
  summaryEmphasis: {
    fontWeight: HISTORY_SUMMARY_EMPHASIS_WEIGHT,
    color: Colors.text,
  },
  summaryStack: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 2,
  },
  summaryCount: {
    fontSize: HISTORY_SUMMARY_COUNT_SIZE,
    fontWeight: HISTORY_SUMMARY_COUNT_WEIGHT,
    color: Colors.textMuted,
  },
  summaryLatest: {
    fontSize: HISTORY_SUMMARY_SIZE,
    fontWeight: HISTORY_SUMMARY_WEIGHT,
    color: Colors.textMuted,
  },
  columnLabelCenter: {
    textAlign: 'center',
  },
  columnLabelRight: {
    textAlign: 'right',
  },
});
