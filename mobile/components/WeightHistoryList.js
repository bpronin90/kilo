import React, { useState, useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '../theme/colors';
import { formatDate, formatDelta } from '../lib/format';

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
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

function localDateToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function WeightHistoryList({
  entries,
  editingId,
  handleEditEntry,
  handleDelete,
  getWeightDeltaSeverity,
  goalInfo,
}) {
  const [collapsed, setCollapsed] = useState(false);
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
    if (event.type === 'set' && selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      setFromDate(`${y}-${m}-${d}`);
    }
  };

  const onToChange = (event, selectedDate) => {
    setShowToPicker(false);
    if (event.type === 'set' && selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      setToDate(`${y}-${m}-${d}`);
    }
  };

  const clearRange = () => {
    setFromDate('');
    setToDate('');
  };

  return (
    <View style={styles.historyList}>
      {/* Header: date range + collapse toggle */}
      <View style={styles.listHeader}>
        <View style={styles.dateRangeRow}>
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
          {hasRange && (
            <Pressable onPress={clearRange} style={styles.dateClearBtn} hitSlop={8}>
              <Text style={styles.dateClearBtnText}>✕</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => setCollapsed(c => !c)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expand history' : 'Collapse history'}
          style={styles.collapseToggle}
        >
          <MaterialIcons
            name={collapsed ? 'expand-more' : 'expand-less'}
            size={18}
            color={Colors.textMuted}
          />
        </Pressable>
      </View>

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

      {/* Column headers */}
      {!collapsed && (
        <View style={styles.columnHeader}>
          <Text style={[styles.columnLabel, styles.colWeight]}>Weight</Text>
          <Text style={[styles.columnLabel, styles.colDelta]}>Change</Text>
          <Text style={[styles.columnLabel, styles.colDate]}>Date</Text>
        </View>
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
              styles.historyRowContainer,
              isActive && styles.activeEntryRow,
              isLast && styles.lastHistoryRow,
            ]}
          >
            <Pressable
              onPress={() => handleEditEntry(entry)}
              style={({ pressed }) => [
                styles.rowMain,
                pressed && styles.historyRowPressed,
              ]}
            >
              <View style={styles.rowCells}>
                <View style={styles.colWeight}>
                  <Text style={styles.rowWeight}>{entry.weight_value} {entry.weight_unit || 'lb'}</Text>
                  {entry.note ? (
                    <Text style={styles.rowNote} numberOfLines={1}>{entry.note}</Text>
                  ) : null}
                </View>
                <View style={styles.colDelta}>
                  {delta !== null ? (
                    <Text style={[
                      styles.rowDelta,
                      severity === 'notable' && styles.deltaNotable,
                      severity === 'spike' && styles.deltaSpike,
                      severity === 'outlier' && styles.deltaOutlier,
                    ]}>
                      {formatDelta(delta)}
                    </Text>
                  ) : (
                    <Text style={styles.rowDeltaEmpty}>—</Text>
                  )}
                </View>
                <View style={styles.colDate}>
                  <Text style={styles.rowDate}>{formatDate(entry.logged_at)}</Text>
                </View>
              </View>
            </Pressable>
            <Pressable
              onPress={() => handleDelete(entry.id)}
              style={({ pressed }) => [
                styles.deleteAffordance,
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

      {collapsed && (
        <View style={styles.collapsedSummary}>
          <Text style={styles.collapsedText}>{filteredEntries.length} entries</Text>
        </View>
      )}
    </View>
  );
}

const COL_WEIGHT_FLEX = 2;
const COL_DELTA_FLEX = 1;
const COL_DATE_FLEX = 1.5;

const styles = StyleSheet.create({
  historyList: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  dateRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  collapseToggle: {
    paddingLeft: 8,
  },
  columnHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: Colors.subtleBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  columnLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  colWeight: {
    flex: COL_WEIGHT_FLEX,
  },
  colDelta: {
    flex: COL_DELTA_FLEX,
    alignItems: 'center',
  },
  colDate: {
    flex: COL_DATE_FLEX,
    alignItems: 'flex-end',
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
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowCells: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowWeight: {
    fontSize: 20,
    fontWeight: '900',
    color: Colors.text,
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
  rowDate: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'right',
  },
  rowNote: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  deleteAffordance: {
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
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
  collapsedSummary: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  collapsedText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '600',
  },
});
