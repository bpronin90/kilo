import React, { useMemo } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { formatDate } from '../../lib/format';
import { createStyles } from './weightHistoryStyles';

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
  const { colors } = useTheme();
  return React.createElement('input', {
    type: 'text',
    value: value || '',
    placeholder: placeholder || 'YYYY-MM-DD',
    onChange: (e) => {
      const next = e?.target?.value;
      onChange(next || '');
    },
    style: {
      backgroundColor: colors.chipBackground,
      border: 'none',
      borderRadius: 8,
      padding: '4px 8px',
      fontSize: 12,
      fontWeight: '700',
      color: colors.chipText,
      fontFamily: 'inherit',
      cursor: 'text',
      outline: 'none',
      width: 90,
    },
  });
}

function DateBoundaryClear({ label, onPress }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      style={styles.dateBoundaryClearBtn}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Clear ${label} date`}
    >
      <Text style={styles.dateBoundaryClearText}>✕</Text>
    </Pressable>
  );
}

// The revealed date-range filter row (From/To boundary controls) and its
// native date pickers. All of its state (fromDate/toDate/showFromPicker/
// showToPicker/showDateFilter) is owned by WeightHistoryList and passed down
// as props — this component is purely presentational so none of that state
// crosses a remount boundary as part of this split.
export function WeightHistoryFilters({
  visible,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  showFromPicker,
  setShowFromPicker,
  showToPicker,
  setShowToPicker,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const fromDateObj = useMemo(() => parseLocalDate(fromDate) || new Date(2000, 0, 1), [fromDate]);
  const toDateObj = useMemo(() => parseLocalDate(toDate) || new Date(), [toDate]);

  const onFromChange = (event, selectedDate) => {
    setShowFromPicker(false);
    if (event.type === 'set' && selectedDate) setFromDate(toYMD(selectedDate));
  };

  const onToChange = (event, selectedDate) => {
    setShowToPicker(false);
    if (event.type === 'set' && selectedDate) setToDate(toYMD(selectedDate));
  };

  return (
    <>
      {/* Revealed date-range filter — its own row directly under the header,
          clearly separated so it never overlaps row 1 (#411). */}
      {visible && (
        <View style={styles.dateFilterRow} testID="weight-history-date-filter-controls">
          {Platform.OS === 'web' ? (
            <>
              <View style={styles.dateBoundary} testID="weight-history-from-boundary">
                <WebDateTextInput value={fromDate} onChange={setFromDate} placeholder="From" />
                {fromDate ? <DateBoundaryClear label="From" onPress={() => setFromDate('')} /> : null}
              </View>
              <Text style={styles.dateRangeSep}>—</Text>
              <View style={styles.dateBoundary} testID="weight-history-to-boundary">
                <WebDateTextInput value={toDate} onChange={setToDate} placeholder="To" />
                {toDate ? <DateBoundaryClear label="To" onPress={() => setToDate('')} /> : null}
              </View>
            </>
          ) : (
            <>
              <View style={styles.dateBoundary} testID="weight-history-from-boundary">
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
                {fromDate ? <DateBoundaryClear label="From" onPress={() => setFromDate('')} /> : null}
              </View>
              <Text style={styles.dateRangeSep}>—</Text>
              <View style={styles.dateBoundary} testID="weight-history-to-boundary">
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
                {toDate ? <DateBoundaryClear label="To" onPress={() => setToDate('')} /> : null}
              </View>
            </>
          )}
        </View>
      )}

      {/* Native date pickers (hidden until triggered) */}
      {showFromPicker && Platform.OS !== 'web' && (
        <DateTimePicker
          themeVariant={colors.scheme}
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
          themeVariant={colors.scheme}
          value={toDateObj}
          mode="date"
          display="default"
          onChange={onToChange}
          onDismiss={() => setShowToPicker(false)}
          minimumDate={fromDateObj}
          maximumDate={new Date()}
        />
      )}
    </>
  );
}
