import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Card, Button, TextAction, TextField, DateField } from '../../components/UI';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './weightStyles';

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
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua), [colors, kua]);

  return (
    <Card style={editingId ? styles.editingCard : null}>
      {editingId && (
        <View style={styles.editingHeader}>
          <Text style={styles.editingTitle}>Editing entry</Text>
          <TextAction label="Cancel" onPress={cancelEdit} />
        </View>
      )}
      {displayError ? (
        <Text style={styles.errorText}>{displayError}</Text>
      ) : null}
      <TextField
        label={`Weight (${unit})`}
        numeric
        value={weightValue}
        onChangeText={setWeightValue}
        placeholder={unit === 'kg' ? '84.0' : '185.0'}
      />
      <DateField
        key={editingId ? 'edit-date' : 'new-date'}
        label="Date"
        value={editingId ? editDate : newEntryDate}
        onChangeDate={editingId ? setEditDate : (d) => {
          setNewEntryDate(d);
          setNewEntryDateTouched(true);
        }}
        accessibilityLabel={editingId ? 'Entry date' : 'Weigh-in date'}
      />
      <TextField
        label="Note"
        value={weightNote}
        onChangeText={setWeightNote}
        placeholder="Morning, fasted"
      />
      <Button
        onPress={handleSubmit}
        title={editingId ? "Update entry" : "Save weigh-in"}
        disabled={saving}
      />
    </Card>
  );
}
