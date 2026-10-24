import React, { useState, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../theme/ThemeContext';
import { useKuaTypography } from '../theme/typography';
import { formatDate, formatDelta } from '../lib/format';
import { useWeightUnit } from '../lib/unitPreference';
import { displayWeight, formatBodyweightValue } from '../lib/units';
import { createStyles, createHistoryPanel } from './weight/weightHistoryStyles';
import { WeightHistoryFilters } from './weight/WeightHistoryFilters';
import { MonoLabel, Panel } from './ui/RedesignPrimitives';

// The delete affordance's pressed state is deliberately kept here rather than
// in weightHistoryStyles.js (#915 review, tracked by the codebase-wide
// `*Pressed`-opacity audit in tests/theme-rendering.test.js): its only child
// is a muted glyph already drawn at 0.5 opacity by design, so this fade
// cannot cross AA the way a label-bearing pressed style's would.
const createDeleteAffordanceStyles = (colors, kua = null) => StyleSheet.create({
  deleteAffordancePressed: {
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    opacity: 0.8,
  },
});

// Rows shown per expand step (#898). A long-tenured account can reach ~1,000
// weight entries; mapping all of them the moment the panel is expanded would
// just move the "dominates the daily surface" problem from load time to tap
// time. Windowing keeps each expand step cheap while full history stays
// reachable via repeated "Show more" taps.
const HISTORY_WINDOW_SIZE = 50;
// Collapsed preview (Redesign v3, #1601): the newest rows stay on the daily
// surface, bounded, with "Show more weight entries" opening the full window.
const HISTORY_PREVIEW_SIZE = 6;

function filterByDateRange(entries, fromDate, toDate) {
  if (!fromDate && !toDate) return entries;
  return entries.filter(e => {
    const d = (e.date || e.logged_at || '').slice(0, 10);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
}

// The History panel (Redesign v3, #1601): "HISTORY · N" with the date-range
// filter and an expand/collapse control, a Weight / Change / Date / delete
// table, and "Show more weight entries". Collapsed shows a bounded preview of
// the newest rows; expanded shows 50-row windows. Tapping a row edits it.
function WeightHistoryListImpl({
  entries,
  editingId,
  handleEditEntry,
  handleDelete,
  getWeightDeltaSeverity,
  goalInfo,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  const s = useMemo(() => createHistoryPanel(colors, kua, typo), [colors, kua, typo]);
  const deleteStyles = useMemo(() => createDeleteAffordanceStyles(colors, kua), [colors, kua]);
  const unit = useWeightUnit();
  const mutedInk = kua ? kua.onSurfaceVariant : colors.textMuted;
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
  // If the panel is collapsed, expand it too so a filtered range is shown in
  // full rather than as a preview (#411 feedback).
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

  const visibleEntries = filteredEntries.slice(0, collapsed ? HISTORY_PREVIEW_SIZE : windowSize);
  const remainingCount = filteredEntries.length - visibleEntries.length;
  const filterActive = hasRange || (!collapsed && showDateFilter);

  return (
    <Panel testID="weight-history-panel">
      <View style={s.headerRow}>
        <MonoLabel numberOfLines={1}>{`History · ${filteredEntries.length}`}</MonoLabel>
        <View style={s.headerActions}>
          <Pressable
            onPress={toggleDateFilter}
            accessibilityRole="button"
            accessibilityLabel="Filter by date range"
            accessibilityState={{ selected: filterActive }}
            testID="weight-history-date-filter-header"
            style={s.iconButton}
          >
            <MaterialIcons
              name="filter-list"
              size={22}
              color={filterActive ? (kua ? kua.primary : colors.accent) : mutedInk}
              accessible={false}
            />
          </Pressable>
          <Pressable
            onPress={toggleCollapsed}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? 'Expand history' : 'Collapse history'}
            accessibilityState={{ expanded: !collapsed }}
            aria-expanded={!collapsed}
            testID="weight-history-toggle"
            style={s.iconButton}
          >
            <MaterialIcons name={collapsed ? 'expand-more' : 'expand-less'} size={22} color={mutedInk} accessible={false} />
          </Pressable>
        </View>
      </View>

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

      {filteredEntries.length > 0 ? (
        <View style={s.columnsRow}>
          <Text style={[s.columnLabel, s.col1]}>Weight</Text>
          <Text style={[s.columnLabel, s.col2]}>Change</Text>
          <Text style={[s.columnLabel, s.col3]} testID="weight-history-date-header">Date</Text>
          <View style={s.controlCell} />
        </View>
      ) : null}

      {visibleEntries.map((entry, index) => {
        const nextEntry = filteredEntries[index + 1];
        const delta = nextEntry ? entry.weight_value - nextEntry.weight_value : null;
        let severity = getWeightDeltaSeverity(delta);
        if (goalInfo && goalInfo.direction) {
          if (goalInfo.direction === 'loss' && delta < 0) severity = 'normal';
          else if (goalInfo.direction === 'gain' && delta > 0) severity = 'normal';
        }
        const isActive = editingId === entry.id;
        const valueText = `${formatBodyweightValue(entry.weight_value, unit)} ${unit}`;

        return (
          <View key={entry.id} style={[s.rowContainer, isActive && s.activeRow]}>
            <Pressable
              onPress={() => handleEditEntry(entry)}
              accessibilityRole="button"
              accessibilityLabel={`Edit weigh-in ${valueText}, ${formatDate(entry.logged_at)}`}
              style={({ pressed }) => [s.rowMain, pressed && styles.historyRowPressed]}
            >
              <View style={s.col1}>
                <Text style={s.value} numberOfLines={1}>{valueText}</Text>
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
                  <Text style={styles.rowDeltaEmpty}>N/A</Text>
                )}
              </View>
              <View style={s.col3}>
                <Text style={s.dateValue}>{formatDate(entry.logged_at)}</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => handleDelete(entry.id)}
              style={({ pressed }) => [
                s.controlCellRow,
                pressed && deleteStyles.deleteAffordancePressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Delete weight entry"
            >
              <MaterialIcons name="close" size={20} style={styles.deleteAffordanceText} accessible={false} />
            </Pressable>
          </View>
        );
      })}

      {remainingCount > 0 && (
        <Pressable
          onPress={() => {
            if (collapsed) {
              setCollapsed(false);
              setWindowSize(HISTORY_WINDOW_SIZE);
            } else {
              setWindowSize(w => w + HISTORY_WINDOW_SIZE);
            }
          }}
          style={({ pressed }) => [
            styles.loadMoreRow,
            pressed && styles.loadMorePressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Show more weight entries' : `Show more weight entries, ${remainingCount} remaining`}
          testID="weight-history-show-more"
        >
          <Text style={styles.loadMoreText}>
            {collapsed ? 'Show more weight entries' : `Show more weight entries (${remainingCount} remaining)`}
          </Text>
        </Pressable>
      )}

      {filteredEntries.length === 0 && entries.length === 0 && (
        <Text style={styles.emptyText}>No weight entries yet.</Text>
      )}
      {filteredEntries.length === 0 && entries.length > 0 && (
        <Text style={styles.emptyText}>No entries in this range.</Text>
      )}
    </Panel>
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
