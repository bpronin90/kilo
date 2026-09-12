import React, { useState, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { formatDate, formatDelta } from '../lib/format';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue } from '../lib/units';
import { createStyles, createHistoryPanel } from './weight/weightHistoryStyles';
import { WeightHistoryFilters } from './weight/WeightHistoryFilters';

// The delete affordance's pressed state is deliberately kept here rather than
// in weightHistoryStyles.js (#915 review, tracked by the codebase-wide
// `*Pressed`-opacity audit in tests/theme-rendering.test.js): its only child
// is a muted glyph already drawn at 0.5 opacity by design, so this fade
// cannot cross AA the way a label-bearing pressed style's would.
const createDeleteAffordanceStyles = (colors) => StyleSheet.create({
  deleteAffordancePressed: {
    backgroundColor: colors.chipBackground,
    opacity: 0.8,
  },
});

// Rows shown per expand step (#898). A long-tenured account can reach ~1,000
// weight entries; mapping all of them the moment the panel is expanded would
// just move the "dominates the daily surface" problem from load time to tap
// time. Windowing keeps each expand step cheap while full history stays
// reachable via repeated "Show more" taps.
const HISTORY_WINDOW_SIZE = 50;

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
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const s = useThemedStyles(createHistoryPanel);
  const deleteStyles = useThemedStyles(createDeleteAffordanceStyles);
  const unit = useWeightUnit();
  // Collapsed by default (#898): the daily Weight surface should open on a
  // latest/count summary, not a fully mapped history that grows unbounded
  // with tenure. Expanding reveals a windowed slice (see HISTORY_WINDOW_SIZE).
  const [collapsed, setCollapsed] = useState(true);
  const [windowSize, setWindowSize] = useState(HISTORY_WINDOW_SIZE);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const filteredEntries = useMemo(
    () => filterByDateRange(entries, fromDate, toDate),
    [entries, fromDate, toDate]
  );

  const hasRange = !!(fromDate || toDate);

  // The compact From/To controls are revealed from the history header. Turning
  // the filter off clears both bounds; clearing either bound below deliberately
  // leaves this control area open so a one-sided range is immediately usable.
  // If the panel is collapsed, always expand it and show the filter so the
  // controls are immediately visible (#411 feedback).
  const toggleDateFilter = () => {
    if (collapsed) {
      setCollapsed(false);
      setWindowSize(HISTORY_WINDOW_SIZE);
      setShowDateFilter(true);
      return;
    }
    setShowDateFilter(prev => {
      if (prev) {
        setFromDate('');
        setToDate('');
      }
      return !prev;
    });
  };

  // Re-expanding always starts from the first window so a long session of
  // collapse/expand cycling never leaves a huge window size stuck open.
  const toggleCollapsed = () => {
    setCollapsed(c => {
      const expanding = c === true;
      if (expanding) setWindowSize(HISTORY_WINDOW_SIZE);
      return !c;
    });
  };

  const visibleEntries = filteredEntries.slice(0, windowSize);
  const remainingCount = filteredEntries.length - visibleEntries.length;

  return (
    <View style={s.card}>
      {/* Header row IS the column-header / summary row. In expanded state the
          filter icon groups with Date; in collapsed state it stays in the
          trailing control cell because no Date header is visible. */}
      <Pressable
        onPress={toggleCollapsed}
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
                  color={(hasRange || showDateFilter) ? colors.accent : colors.textMuted}
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
                color={(hasRange || showDateFilter) ? colors.accent : colors.textMuted}
                accessible={false}
              />
            </Pressable>
          )}
          <MaterialIcons
            name={collapsed ? 'expand-more' : 'expand-less'}
            size={18}
            color={colors.textMuted}
            accessible={false}
          />
        </View>
      </Pressable>

      <WeightHistoryFilters
        visible={!collapsed && showDateFilter}
        fromDate={fromDate}
        setFromDate={setFromDate}
        toDate={toDate}
        setToDate={setToDate}
        showFromPicker={showFromPicker}
        setShowFromPicker={setShowFromPicker}
        showToPicker={showToPicker}
        setShowToPicker={setShowToPicker}
      />

      {!collapsed && visibleEntries.map((entry, index) => {
        const nextEntry = filteredEntries[index + 1];
        const delta = nextEntry ? entry.weight_value - nextEntry.weight_value : null;
        let severity = getWeightDeltaSeverity(delta);
        if (goalInfo && goalInfo.direction) {
          if (goalInfo.direction === 'loss' && delta < 0) severity = 'normal';
          else if (goalInfo.direction === 'gain' && delta > 0) severity = 'normal';
        }
        // Only the last row of the whole card (no "Show more" row beneath it)
        // drops its bottom border; the last row of a window keeps it so the
        // affordance below reads as a distinct trailing row.
        const isLast = index === visibleEntries.length - 1 && remainingCount === 0;
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
                pressed && deleteStyles.deleteAffordancePressed,
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

      {!collapsed && remainingCount > 0 && (
        <Pressable
          onPress={() => setWindowSize(w => w + HISTORY_WINDOW_SIZE)}
          style={({ pressed }) => [
            styles.loadMoreRow,
            pressed && styles.loadMorePressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Show more weight entries"
          testID="weight-history-show-more"
        >
          <Text style={styles.loadMoreText}>
            {`Show more (${remainingCount} remaining)`}
          </Text>
        </Pressable>
      )}

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
