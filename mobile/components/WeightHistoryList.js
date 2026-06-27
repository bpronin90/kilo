import React, { useState, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import { formatDate, formatDelta } from '../lib/format';

const DATE_FILTERS = [
  { label: 'All', key: 'all', days: null },
  { label: '30d', key: '30d', days: 30 },
  { label: '90d', key: '90d', days: 90 },
  { label: '6m', key: '6m', days: 180 },
];

function filterByRange(entries, rangeKey) {
  if (rangeKey === 'all') return entries;
  const filter = DATE_FILTERS.find(f => f.key === rangeKey);
  if (!filter || !filter.days) return entries;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - filter.days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return entries.filter(e => (e.date || e.logged_at || '') >= cutoffStr);
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
  const [rangeKey, setRangeKey] = useState('all');

  const filteredEntries = useMemo(
    () => filterByRange(entries, rangeKey),
    [entries, rangeKey]
  );

  return (
    <View style={styles.historyList}>
      {/* Header: filter chips + collapse toggle */}
      <View style={styles.listHeader}>
        <View style={styles.filterRow}>
          {DATE_FILTERS.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setRangeKey(f.key)}
              style={[styles.filterChip, rangeKey === f.key && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, rangeKey === f.key && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => setCollapsed(c => !c)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expand history' : 'Collapse history'}
          style={styles.collapseToggle}
        >
          <Text style={styles.collapseToggleText}>{collapsed ? '▼' : '▲'}</Text>
        </Pressable>
      </View>

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
  filterRow: {
    flexDirection: 'row',
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: Colors.chipBackground,
  },
  filterChipActive: {
    backgroundColor: Colors.text,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.chipText,
  },
  filterChipTextActive: {
    color: Colors.textLight,
  },
  collapseToggle: {
    paddingLeft: 8,
  },
  collapseToggleText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '700',
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
    fontSize: 10,
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
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  rowCells: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowWeight: {
    fontSize: 15,
    fontWeight: '700',
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
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'right',
  },
  rowNote: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 1,
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
