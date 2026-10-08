import { GEOMETRY } from '../../theme/spacing';
import React, { useMemo } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../../theme/ThemeContext';
import { useKuaTypography, TYPOGRAPHY } from '../../theme/typography';
import { formatDate } from '../../lib/format';
import { createStyles } from './weightHistoryStyles';
import { FieldLabel } from '../FieldLabel';

// DOM (react-native-web) equivalent of a mono role: letterSpacing needs a px string.
const domMonoRole = (role) => ({
  fontFamily: TYPOGRAPHY[role].fontFamily,
  fontSize: TYPOGRAPHY[role].fontSize,
  letterSpacing: `${TYPOGRAPHY[role].letterSpacing}px`,
  fontVariantNumeric: 'tabular-nums',
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

// Inline beside its chip, so drop the stacked-label bottom margin.
const INLINE_LABEL = { marginBottom: 0 };

function WebDateTextInput({ value, onChange, placeholder, label }) {
  const { colors, kuaPalette: kua } = useTheme();
  return React.createElement('input', {
    type: 'text',
    value: value || '',
    placeholder: placeholder || 'YYYY-MM-DD',
    'aria-label': label,
    onChange: (e) => {
      const next = e?.target?.value;
      onChange(next || '');
    },
    style: {
      backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
      border: 'none',
      borderRadius: GEOMETRY['radius-lg'],
      padding: '4px 8px',
      ...(kua ? domMonoRole('label-md') : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontFamily: 'inherit', fontWeight: '700' }),
      color: kua ? kua.primaryOnContainer : colors.chipText,
      cursor: 'text',
      outline: 'none',
      width: 90,
    },
  });
}

function DateBoundaryClear({ label, onPress }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  return (
    <Pressable
      onPress={onPress}
      style={styles.dateBoundaryClearBtn}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Clear ${label} date`}
    >
      <MaterialIcons name="close" size={20} style={styles.dateBoundaryClearText} accessible={false} />
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
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);

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
                <FieldLabel style={INLINE_LABEL}>From</FieldLabel>
                <WebDateTextInput value={fromDate} onChange={setFromDate} placeholder="YYYY-MM-DD" label="From date" />
                {fromDate ? <DateBoundaryClear label="From" onPress={() => setFromDate('')} /> : null}
              </View>
              <Text style={styles.dateRangeSep}>to</Text>
              <View style={styles.dateBoundary} testID="weight-history-to-boundary">
                <FieldLabel style={INLINE_LABEL}>To</FieldLabel>
                <WebDateTextInput value={toDate} onChange={setToDate} placeholder="YYYY-MM-DD" label="To date" />
                {toDate ? <DateBoundaryClear label="To" onPress={() => setToDate('')} /> : null}
              </View>
            </>
          ) : (
            <>
              <View style={styles.dateBoundary} testID="weight-history-from-boundary">
                <FieldLabel style={INLINE_LABEL}>From</FieldLabel>
                <Pressable
                  onPress={() => setShowFromPicker(true)}
                  style={styles.dateChip}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="From date"
                >
                  <Text style={[styles.dateChipText, !fromDate && styles.dateChipPlaceholder]}>
                    {fromDate ? formatDate(fromDate) : 'Any date'}
                  </Text>
                </Pressable>
                {fromDate ? <DateBoundaryClear label="From" onPress={() => setFromDate('')} /> : null}
              </View>
              <Text style={styles.dateRangeSep}>to</Text>
              <View style={styles.dateBoundary} testID="weight-history-to-boundary">
                <FieldLabel style={INLINE_LABEL}>To</FieldLabel>
                <Pressable
                  onPress={() => setShowToPicker(true)}
                  style={styles.dateChip}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="To date"
                >
                  <Text style={[styles.dateChipText, !toDate && styles.dateChipPlaceholder]}>
                    {toDate ? formatDate(toDate) : 'Any date'}
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
