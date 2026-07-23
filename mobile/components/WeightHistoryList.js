import React, { useState, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '../theme/colors';
import { formatDate, formatDelta } from '../lib/format';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue } from '../lib/units';

// ── Shared history-panel visual system (#411) ─────────────────────────────────
// Goal History (WeightScreen.js) and Weight History (this file) render as ONE
// uniform system. Every value below is kept numerically identical to the block
// of the same name in WeightScreen.js so the two panels' equivalent elements
// (header row, 3-column [value·value·date] grid, trailing control cell, values,
// dates, labels, and collapsed summary) match exactly. The only intended
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

const historyPanel = StyleSheet.create({
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
  dateHeaderGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dateHeaderFilterBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function WebDateTextInput({ value, onChange, placeholder }) {
  return React.createElement('input', {
    type: 'text',
    value: value || '',
    placeholder: placeholder || 'YYYY-MM-DD',
    onChange: (e) => {
      const next = e?.target?.value;
      onChange(next || '');
    },
    style: {
      backgroundColor: Colors.chipBackground,
      border: 'none',
      borderRadius: 8,
      padding: '4px 8px',
      fontSize: 12,
      fontWeight: '700',
      color: Colors.chipText,
      fontFamily: 'inherit',
      cursor: 'text',
      outline: 'none',
      width: 90,
    },
  });
}

function filterByDateRange(entries, fromDate, toDate) {
  if (!fromDate && !toDate) return entries;
  return entries.filter(e => {
    const d = (e.date || e.logged_at || '').slice(0, 10);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
}

function WeightHistoryListImpl({
  entries,
  editingId,
  handleEditEntry,
  handleDelete,
  getWeightDeltaSeverity,
  goalInfo,
}) {
  const unit = useWeightUnit();
  const [collapsed, setCollapsed] = useState(false);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const fromDateObj = useMemo(() => parseLocalDate(fromDate) || new Date(2000, 0, 1), [fromDate]);
  const toDateObj = useMemo(() => parseLocalDate(toDate) || new Date(), [toDate]);

  const filteredEntries = useMemo(
    () => filterByDateRange(entries, fromDate, toDate),
    [entries, fromDate, toDate]
  );

  const hasRange = !!(fromDate || toDate);

  const onFromChange = (event, selectedDate) => {
    setShowFromPicker(false);
    if (event.type === 'set' && selectedDate) setFromDate(toYMD(selectedDate));
  };

  const onToChange = (event, selectedDate) => {
    setShowToPicker(false);
    if (event.type === 'set' && selectedDate) setToDate(toYMD(selectedDate));
  };

  const clearRange = () => {
    setFromDate('');
    setToDate('');
  };

  // Option B: the From/To controls are hidden by default and revealed by the
  // header filter icon. Toggling the filter off — or clearing (✕) — closes and
  // clears the range so it can never overlap the first data row (#411).
  // If the panel is collapsed, always expand it and show the filter so the
  // controls are immediately visible (#411 feedback).
  const toggleDateFilter = () => {
    if (collapsed) {
      setCollapsed(false);
      setShowDateFilter(true);
      return;
    }
    setShowDateFilter(prev => {
      if (prev) clearRange();
      return !prev;
    });
  };

  const clearAndCloseFilter = () => {
    clearRange();
    setShowDateFilter(false);
  };

  const s = historyPanel;

  return (
    <View style={s.card}>
      {/* Header row IS the column-header / summary row. In expanded state the
          filter icon groups with Date; in collapsed state it stays in the
          trailing control cell because no Date header is visible. */}
      <Pressable
        onPress={() => setCollapsed(c => !c)}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? 'Expand history' : 'Collapse history'}
        style={[s.headerRow, !collapsed && s.headerRowBordered]}
      >
        {collapsed ? (
          <View style={s.headerContent}>
            {filteredEntries.length === 0 ? (
              <Text style={s.summaryCount}>0 entries</Text>
            ) : (
              <View style={s.summaryStack}>
                <Text style={s.summaryCount}>
                  {`${filteredEntries.length} ${filteredEntries.length === 1 ? 'entry' : 'entries'}`}
                </Text>
                <Text style={s.summaryLatest} numberOfLines={1}>
                  {'Latest: '}
                  <Text style={s.summaryEmphasis}>
                    {formatBodyweightValue(filteredEntries[0].weight_value, unit)} {unit}
                  </Text>
                  {' on '}
                  {formatDate(filteredEntries[0].logged_at)}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={s.headerContent}>
            <Text style={[s.columnLabel, s.col1]}>Weight</Text>
            <Text style={[s.columnLabel, s.col2, s.columnLabelCenter]}>Change</Text>
            <View style={[s.col3, s.dateHeaderGroup]} testID="weight-history-date-header">
              <Pressable
                onPress={toggleDateFilter}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Filter by date range"
                testID="weight-history-date-filter-header"
                style={s.dateHeaderFilterBtn}
              >
                <MaterialIcons
                  name="date-range"
                  size={18}
                  color={(hasRange || showDateFilter) ? Colors.accent : Colors.textMuted}
                  accessible={false}
                />
              </Pressable>
              <Text style={[s.columnLabel, s.columnLabelRight]}>Date</Text>
            </View>
          </View>
        )}
        <View style={s.controlCell}>
          {collapsed && (
            <Pressable
              onPress={toggleDateFilter}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Filter by date range"
              style={s.controlIconBtn}
            >
              <MaterialIcons
                name="date-range"
                size={18}
                color={(hasRange || showDateFilter) ? Colors.accent : Colors.textMuted}
                accessible={false}
              />
            </Pressable>
          )}
          <MaterialIcons
            name={collapsed ? 'expand-more' : 'expand-less'}
            size={18}
            color={Colors.textMuted}
            accessible={false}
          />
        </View>
      </Pressable>

      {/* Revealed date-range filter — its own row directly under the header,
          clearly separated so it never overlaps row 1 (#411). */}
      {!collapsed && showDateFilter && (
        <View style={styles.dateFilterRow}>
          {Platform.OS === 'web' ? (
            <>
              <WebDateTextInput value={fromDate} onChange={setFromDate} placeholder="From" />
              <Text style={styles.dateRangeSep}>—</Text>
              <WebDateTextInput value={toDate} onChange={setToDate} placeholder="To" />
            </>
          ) : (
            <>
              <Pressable
                onPress={() => setShowFromPicker(true)}
                style={styles.dateChip}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="From date"
              >
                <Text style={[styles.dateChipText, !fromDate && styles.dateChipPlaceholder]}>
                  {fromDate ? formatDate(fromDate) : 'From'}
                </Text>
              </Pressable>
              <Text style={styles.dateRangeSep}>—</Text>
              <Pressable
                onPress={() => setShowToPicker(true)}
                style={styles.dateChip}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="To date"
              >
                <Text style={[styles.dateChipText, !toDate && styles.dateChipPlaceholder]}>
                  {toDate ? formatDate(toDate) : 'To'}
                </Text>
              </Pressable>
            </>
          )}
          <Pressable onPress={clearAndCloseFilter} style={styles.dateClearBtn} hitSlop={8}>
            <Text style={styles.dateClearBtnText}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* Native date pickers (hidden until triggered) */}
      {showFromPicker && Platform.OS !== 'web' && (
        <DateTimePicker
          value={fromDateObj}
          mode="date"
          display="default"
          onChange={onFromChange}
          onDismiss={() => setShowFromPicker(false)}
          maximumDate={toDateObj}
        />
      )}
      {showToPicker && Platform.OS !== 'web' && (
        <DateTimePicker
          value={toDateObj}
          mode="date"
          display="default"
          onChange={onToChange}
          onDismiss={() => setShowToPicker(false)}
          minimumDate={fromDateObj}
          maximumDate={new Date()}
        />
      )}

      {!collapsed && filteredEntries.map((entry, index) => {
        const nextEntry = filteredEntries[index + 1];
        const delta = nextEntry ? entry.weight_value - nextEntry.weight_value : null;
        let severity = getWeightDeltaSeverity(delta);
        if (goalInfo && goalInfo.direction) {
          if (goalInfo.direction === 'loss' && delta < 0) severity = 'normal';
          else if (goalInfo.direction === 'gain' && delta > 0) severity = 'normal';
        }
        const isLast = index === filteredEntries.length - 1;
        const isActive = editingId === entry.id;

        return (
          <View
            key={entry.id}
            style={[
              s.rowContainer,
              isActive && s.activeRow,
              isLast && s.lastRow,
            ]}
          >
            <Pressable
              onPress={() => handleEditEntry(entry)}
              style={({ pressed }) => [
                s.rowMain,
                pressed && styles.historyRowPressed,
              ]}
            >
              <View style={s.rowCells}>
                <View style={s.col1}>
                  <Text style={s.value}>{formatBodyweightValue(entry.weight_value, unit)} {unit}</Text>
                  {entry.note ? (
                    <Text style={styles.rowNote} numberOfLines={1}>{entry.note}</Text>
                  ) : null}
                </View>
                <View style={s.col2}>
                  {delta !== null ? (
                    <Text style={[
                      styles.rowDelta,
                      severity === 'notable' && styles.deltaNotable,
                      severity === 'spike' && styles.deltaSpike,
                      severity === 'outlier' && styles.deltaOutlier,
                    ]}>
                      {formatDelta(displayWeight(delta, unit))}
                    </Text>
                  ) : (
                    <Text style={styles.rowDeltaEmpty}>—</Text>
                  )}
                </View>
                <View style={s.col3}>
                  <Text style={s.dateValue}>{formatDate(entry.logged_at)}</Text>
                </View>
              </View>
            </Pressable>
            <Pressable
              onPress={() => handleDelete(entry.id)}
              style={({ pressed }) => [
                s.controlCellRow,
                pressed && styles.deleteAffordancePressed,
              ]}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Delete weight entry"
            >
              <Text style={styles.deleteAffordanceText} accessible={false}>✕</Text>
            </Pressable>
          </View>
        );
      })}

      {!collapsed && filteredEntries.length === 0 && entries.length === 0 && (
        <Text style={styles.emptyText}>No weight entries yet.</Text>
      )}
      {!collapsed && filteredEntries.length === 0 && entries.length > 0 && (
        <Text style={styles.emptyText}>No entries in this range.</Text>
      )}
    </View>
  );
}

// Memoized (#592): WeightScreen re-renders on every Weight/Note field
// keystroke because it owns that input state, but its own local UI state
// (collapsed, date filter, etc.) lives inside this component, not in
// WeightScreen's props to it. Without memoization, a large expanded history
// (up to ~1,000 entries) gets fully remapped on every keystroke even though
// none of this component's own props changed. React.memo bails out unless
// entries/editingId/handleEditEntry/handleDelete/getWeightDeltaSeverity/goalInfo
// actually change; WeightScreen keeps those referentially stable across
// unrelated keystrokes (see its useCallback/useMemo usage).
export const WeightHistoryList = React.memo(WeightHistoryListImpl);

const styles = StyleSheet.create({
  historyRowPressed: {
    backgroundColor: Colors.chipBackground,
    opacity: 0.8,
  },
  dateFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.subtleBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  dateChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: Colors.chipBackground,
  },
  dateChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.chipText,
  },
  dateChipPlaceholder: {
    color: Colors.textMuted,
    fontWeight: '600',
  },
  dateRangeSep: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  dateClearBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  dateClearBtnText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '700',
  },
  rowDelta: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textMuted,
    textAlign: 'center',
  },
  rowDeltaEmpty: {
    fontSize: 12,
    color: Colors.textMuted,
    opacity: 0.4,
    textAlign: 'center',
  },
  deltaNotable: {
    color: Colors.caution,
  },
  deltaSpike: {
    color: Colors.error,
  },
  deltaOutlier: {
    color: Colors.error,
    fontWeight: '900',
  },
  rowNote: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  deleteAffordancePressed: {
    backgroundColor: Colors.chipBackground,
    opacity: 0.8,
  },
  deleteAffordanceText: {
    fontSize: 16,
    color: Colors.textMuted,
    opacity: 0.5,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textMuted,
    paddingVertical: 32,
    fontSize: 15,
  },
});
