import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { FieldLabel } from './FieldLabel';
import { createFormFieldStyles, createWebDateInputStyle } from './ui/styles';
import { useTheme } from '../theme/ThemeContext';
import { useKuaTypography } from '../theme/typography';

// Shared labelled form controls (#1440). Standard fields compose these instead
// of restyling inputs per feature: the visible FieldLabel, the input skin, the
// placeholder ink, and the web/native date paths all live here. Feature styles
// may position a field, never re-skin it.

function useFieldStyles() {
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(
    () => StyleSheet.create(createFormFieldStyles(colors, kua, typo)),
    [colors, kua, typo],
  );
  return { colors, kua, styles };
}

// Local YYYY-MM-DD, matching the web <input type="date"> value format.
function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromYMD(value) {
  if (!value) return new Date();
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// A visible label above a text input. The input announces `accessibilityLabel`
// (default: the label text) so the name survives once the placeholder is gone.
// `numeric` selects the decimal keypad; other TextInput props pass through.
export function TextField({ label, accessibilityLabel, numeric = false, style, ...inputProps }) {
  const { colors, kua, styles } = useFieldStyles();
  return (
    <>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        keyboardAppearance={colors.scheme}
        placeholderTextColor={kua ? kua.onSurfaceVariant : colors.textMuted}
        keyboardType={numeric ? 'decimal-pad' : undefined}
        includeFontPadding={false}
        accessibilityLabel={accessibilityLabel ?? label}
        {...inputProps}
        style={[numeric ? styles.numericInput : styles.input, style]}
      />
    </>
  );
}

// A visible label above a date value. Web renders a real DOM <input type="date">
// (the native picker has no web rendering); native renders a button-role field
// that opens the platform picker. `range` bounds both paths to today: 'past'
// (on or before) or 'future' (on or after). `onChangeDate` receives YYYY-MM-DD.
// Picker visibility is internal unless `pickerVisible`/`onPickerVisibleChange`
// make it controlled.
export function DateField({
  label,
  value,
  onChangeDate,
  accessibilityLabel,
  range = 'past',
  placeholder,
  formatValue,
  pickerVisible,
  onPickerVisibleChange,
}) {
  const { colors, kua, styles } = useFieldStyles();
  const [ownVisible, setOwnVisible] = useState(false);
  const controlled = pickerVisible !== undefined;
  const visible = controlled ? pickerVisible : ownVisible;
  const setVisible = (next) => {
    if (!controlled) setOwnVisible(next);
    onPickerVisibleChange?.(next);
  };
  const a11yLabel = accessibilityLabel ?? label;
  const isPast = range === 'past';

  if (Platform.OS === 'web') {
    return (
      <>
        <FieldLabel>{label}</FieldLabel>
        {React.createElement('input', {
          type: 'date',
          value: value || '',
          [isPast ? 'max' : 'min']: toYMD(new Date()),
          'aria-label': a11yLabel,
          onChange: (e) => {
            const next = e?.target?.value;
            if (next) onChangeDate(next);
          },
          style: createWebDateInputStyle(colors, kua),
        })}
      </>
    );
  }

  const shown = value ? (formatValue ? formatValue(value) : value) : (placeholder ?? '');
  return (
    <>
      <FieldLabel>{label}</FieldLabel>
      <Pressable
        style={styles.input}
        onPress={() => setVisible(true)}
        accessibilityLabel={a11yLabel}
        accessibilityRole="button"
      >
        <Text style={[styles.pickerText, !value && styles.pickerPlaceholder]}>{shown}</Text>
      </Pressable>
      {visible && (
        <DateTimePicker
          themeVariant={colors.scheme}
          value={fromYMD(value)}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setVisible(false);
            if (selected) onChangeDate(toYMD(selected));
          }}
          onDismiss={() => setVisible(false)}
          {...(isPast ? { maximumDate: new Date() } : { minimumDate: new Date() })}
        />
      )}
    </>
  );
}
