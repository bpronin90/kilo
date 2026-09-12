import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card, Button } from '../../components/UI';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { localDateToday } from '../../lib/WeightScreenHelpers';
import { createStyles } from './weightStyles';

// Web-safe date input. The native @react-native-community/datetimepicker has no
// usable rendering on web, so on web we render a real DOM <input type="date">
// (react-native-web passes lowercase string element types through to the DOM).
// It writes the YYYY-MM-DD value straight back via onChangeDate, matching the
// native onChange path which also normalizes to a YYYY-MM-DD string.
function WebDateInput({ value, onChangeDate, accessibilityLabel }) {
  const { colors } = useTheme();
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
      backgroundColor: colors.inputBackground,
      borderRadius: 16,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: colors.inputBorder,
      padding: 14,
      fontSize: 16,
      colorScheme: colors.scheme,
      color: colors.text,
      fontFamily: 'inherit',
      width: '100%',
      boxSizing: 'border-box',
    },
  });
}

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
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
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
              themeVariant={colors.scheme}
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

// The weigh-in entry/edit Card: editing header, error banner, weight/date/note
// fields, and the save/update button. All of its state (editingId, field
// values, saving) is owned by WeightScreen and passed down as props — this
// component is purely presentational so none of that state crosses a remount
// boundary as part of this split.
export function WeightEntryForm({
  editingId,
  cancelEdit,
  displayError,
  unit,
  weightValue,
  setWeightValue,
  weightNote,
  setWeightNote,
  newEntryDate,
  setNewEntryDate,
  setNewEntryDateTouched,
  editDate,
  setEditDate,
  handleSubmit,
  saving,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Card style={editingId ? styles.editingCard : null}>
      {editingId && (
        <View style={styles.editingHeader}>
          <Text style={styles.editingTitle}>Editing entry</Text>
          <Pressable
            onPress={cancelEdit}
            style={styles.editorActionTarget}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText} accessible={false} importantForAccessibility="no">Cancel</Text>
          </Pressable>
        </View>
      )}
      {displayError ? (
        <Text style={styles.errorText}>{displayError}</Text>
      ) : null}
      <Text style={styles.inputLabel}>Weight ({unit})</Text>
      <TextInput
        keyboardAppearance={colors.scheme}
        value={weightValue}
        onChangeText={setWeightValue}
        placeholder={unit === 'kg' ? '84.0' : '185.0'}
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        style={styles.input}
      />
      {!editingId && (
        <>
          <DateEntryField
            value={newEntryDate}
            onChangeDate={(d) => {
              setNewEntryDate(d);
              setNewEntryDateTouched(true);
            }}
            a11yLabel="Weigh-in date"
          />
          <Text style={styles.inputLabel}>Note</Text>
          <TextInput
            keyboardAppearance={colors.scheme}
            value={weightNote}
            onChangeText={setWeightNote}
            placeholder="Morning, fasted"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            accessibilityLabel="Note"
          />
        </>
      )}
      {editingId && (
        <>
          <DateEntryField value={editDate} onChangeDate={setEditDate} a11yLabel="Entry date" />
          <Text style={styles.inputLabel}>Note</Text>
          <TextInput
            keyboardAppearance={colors.scheme}
            value={weightNote}
            onChangeText={setWeightNote}
            placeholder="Morning, fasted"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            accessibilityLabel="Note"
          />
        </>
      )}
      <Button
        onPress={handleSubmit}
        title={editingId ? "Update entry" : "Save weigh-in"}
        disabled={saving}
      />
    </Card>
  );
}
