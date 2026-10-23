import React, { useMemo, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { TextAction } from '../../components/UI';
import { MonoLabel, Panel } from '../../components/ui/RedesignPrimitives';
import { useTheme } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { formatDate } from '../../lib/format';
import { localDateToday } from '../../lib/WeightScreenHelpers';
import { createStyles } from './weightStyles';

// Local YYYY-MM-DD for the picker round trip (never UTC).
function toYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function fromYMD(value) {
  if (!value) return new Date();
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// The invisible DOM date input laid over the compact date button on web: the
// browser owns the picker, the visible control stays the "Today" chip.
const WEB_DATE_OVERLAY = {
  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
  opacity: 0, cursor: 'pointer', border: 'none', padding: 0, margin: 0,
};

// Compact weigh-in date control (#1601): a 52dp button reading "Today" or the
// chosen date. Native opens the platform picker; web overlays a real
// <input type="date"> named like the native button. Dates are bounded to today.
function EntryDateButton({ value, onChangeDate, accessibilityLabel, styles, iconColor }) {
  const [pickerVisible, setPickerVisible] = useState(false);
  const today = localDateToday();
  const shown = !value || value === today ? 'Today' : formatDate(value);
  if (Platform.OS === 'web') {
    return (
      <View style={styles.dateButton}>
        <MaterialIcons name="date-range" size={18} color={iconColor} accessible={false} />
        <Text style={styles.dateButtonText} accessible={false}>{shown}</Text>
        {React.createElement('input', {
          type: 'date',
          value: value || '',
          max: today,
          'aria-label': accessibilityLabel,
          onClick: (e) => { try { e?.target?.showPicker?.(); } catch { /* picker unsupported */ } },
          onChange: (e) => {
            const next = e?.target?.value;
            if (next) onChangeDate(next);
          },
          style: WEB_DATE_OVERLAY,
        })}
      </View>
    );
  }
  return (
    <>
      <Pressable
        onPress={() => setPickerVisible(true)}
        style={styles.dateButton}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <MaterialIcons name="date-range" size={18} color={iconColor} accessible={false} />
        <Text style={styles.dateButtonText}>{shown}</Text>
      </Pressable>
      {pickerVisible && (
        <DateTimePicker
          value={fromYMD(value)}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={(event, selected) => {
            setPickerVisible(false);
            if (selected) onChangeDate(toYMD(selected));
          }}
          onDismiss={() => setPickerVisible(false)}
        />
      )}
    </>
  );
}

// The Log weigh-in panel (Redesign v3, #1601): the screen's one active panel.
// One row holds weight (unit suffix), the date button and Save; a borderless
// "Add note" field sits under it. Editing a history row swaps the header to
// "Editing entry" + Cancel and the action to Update. All state (editingId,
// field values, saving) is owned by WeightScreen and passed down as props.
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
  const { colors, kuaPalette: kua } = useTheme();
  const typo = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  const mutedInk = kua ? kua.onSurfaceVariant : colors.textMuted;
  const actionLabel = editingId ? 'Update entry' : 'Save weigh-in';

  return (
    <Panel active testID="weight-entry-panel">
      <View style={styles.panelHeader}>
        {editingId ? (
          <>
            <Text style={styles.editingTitle}>Editing entry</Text>
            <TextAction label="Cancel" onPress={cancelEdit} />
          </>
        ) : (
          <MonoLabel>Log weigh-in</MonoLabel>
        )}
      </View>
      {displayError ? <Text style={styles.errorText}>{displayError}</Text> : null}
      <View style={styles.entryRow}>
        <View style={styles.entryInputBox}>
          <TextInput
            style={styles.entryInput}
            value={weightValue}
            onChangeText={setWeightValue}
            placeholder={unit === 'kg' ? '84.0' : '185.0'}
            placeholderTextColor={mutedInk}
            keyboardType="decimal-pad"
            keyboardAppearance={colors.scheme}
            includeFontPadding={false}
            accessibilityLabel={`Weight (${unit})`}
          />
          <Text style={styles.unitText} accessible={false}>{unit}</Text>
        </View>
        <EntryDateButton
          key={editingId ? 'edit-date' : 'new-date'}
          value={editingId ? editDate : newEntryDate}
          onChangeDate={editingId ? setEditDate : (d) => {
            setNewEntryDate(d);
            setNewEntryDateTouched(true);
          }}
          accessibilityLabel={editingId ? 'Entry date' : 'Weigh-in date'}
          styles={styles}
          iconColor={kua ? kua.onSurface : colors.text}
        />
        <Pressable
          onPress={saving ? null : handleSubmit}
          style={[styles.saveButton, saving ? styles.saveButtonDisabled : null]}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled: !!saving, busy: !!saving }}
        >
          <Text style={[styles.saveButtonText, saving ? styles.saveButtonTextDisabled : null]} accessible={false}>
            {editingId ? 'Update' : 'Save'}
          </Text>
        </Pressable>
      </View>
      <View style={styles.noteRow}>
        <MaterialIcons name="add" size={16} color={mutedInk} accessible={false} />
        <TextInput
          style={styles.noteInput}
          value={weightNote}
          onChangeText={setWeightNote}
          placeholder="Add note"
          placeholderTextColor={mutedInk}
          keyboardAppearance={colors.scheme}
          includeFontPadding={false}
          accessibilityLabel="Note"
        />
      </View>
    </Panel>
  );
}
