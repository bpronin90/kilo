import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Card, Button } from './UI';
import { Colors } from '../theme/colors';
import { DELOAD_NOTE_PREFIX } from '../lib/LogScreenHelpers';

export function LogScreenEditorCard({
  deloadMode,
  deloadEditText,
  setDeloadEditText,
  handleSaveDeload,
  isSaving,
  saveSuccess,
  editingNoteId,
  isEditingDeloadNote,
  editingTitle,
  setEditingTitle,
  workoutNoteTitle,
  setWorkoutNoteTitle,
  deloadDateEditEnabled,
  editingDeloadHasLinkedRecord,
  setShowDeloadDatePicker,
  deloadEditDate,
  deloadEditOrdinal,
  setDeloadEditOrdinal,
  showDeloadDatePicker,
  editingNote,
  setDeloadEditDate,
  editingText,
  setEditingText,
  activeEditText,
  handleCurrentTextChange,
  handleSaveOtherNote,
  handleSave,
  noteIsSaving,
  handleSwitchCurrent,
  handleDeleteDeloadNoteFromEditor,
  handleDeleteRoutine,
  currentId,
}) {
  return (
    <View style={styles.editContainer}>
      {deloadMode === 'edit' ? (
        <Card>
          <TextInput
            value={deloadEditText}
            onChangeText={setDeloadEditText}
            placeholder="Deload note…"
            placeholderTextColor={Colors.textMuted}
            multiline
            style={[styles.input, styles.editorInput]}
          />
          <Button
            onPress={handleSaveDeload}
            title={saveSuccess ? 'Saved!' : 'Save changes'}
            disabled={isSaving}
            style={styles.saveButton}
          />
        </Card>
      ) : (
        <>
          <Card>
            {!isEditingDeloadNote && (
              <TextInput
                value={editingNoteId ? editingTitle : workoutNoteTitle}
                onChangeText={editingNoteId ? setEditingTitle : setWorkoutNoteTitle}
                placeholder="Routine Name (e.g. Push Day)"
                placeholderTextColor={Colors.textMuted}
                style={[styles.input, styles.titleInput]}
              />
            )}
            {isEditingDeloadNote && deloadDateEditEnabled && (
              <>
                <Text style={styles.inputLabel}>Date</Text>
                <Pressable
                  style={[styles.input, styles.dateInput]}
                  onPress={editingDeloadHasLinkedRecord ? () => setShowDeloadDatePicker(true) : undefined}
                  accessibilityLabel="Deload date"
                  accessibilityRole={editingDeloadHasLinkedRecord ? 'button' : 'text'}
                >
                  <Text style={styles.dateInputText}>{deloadEditDate || '—'}</Text>
                </Pressable>
                {editingDeloadHasLinkedRecord && (
                  <>
                    <Text style={styles.inputLabel}>Session #</Text>
                    <TextInput
                      style={styles.input}
                      value={deloadEditOrdinal}
                      onChangeText={v => setDeloadEditOrdinal(v.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      placeholder="Session number"
                      placeholderTextColor={Colors.textMuted}
                      accessibilityLabel="Deload session number"
                    />
                  </>
                )}
                {editingDeloadHasLinkedRecord && showDeloadDatePicker && (
                  <DateTimePicker
                    value={(() => {
                      if (deloadEditDate) {
                        const [y, m, d] = deloadEditDate.split('-').map(Number);
                        return new Date(y, m - 1, d);
                      }
                      return new Date();
                    })()}
                    mode="date"
                    display="default"
                    maximumDate={new Date()}
                    onChange={(event, selectedDate) => {
                      setShowDeloadDatePicker(false);
                      if (selectedDate) {
                        const y = selectedDate.getFullYear();
                        const mo = String(selectedDate.getMonth() + 1).padStart(2, '0');
                        const dy = String(selectedDate.getDate()).padStart(2, '0');
                        const newDateStr = `${y}-${mo}-${dy}`;
                        setDeloadEditDate(newDateStr);
                        setEditingTitle(DELOAD_NOTE_PREFIX + newDateStr);
                      }
                    }}
                    onDismiss={() => setShowDeloadDatePicker(false)}
                  />
                )}
              </>
            )}
            <TextInput
              value={editingNoteId ? editingText : activeEditText}
              onChangeText={editingNoteId ? setEditingText : handleCurrentTextChange}
              placeholder="e.g.&#10;Monday&#10;+Lifting&#10;-Bench&#10;135 5,5,5"
              placeholderTextColor={Colors.textMuted}
              multiline
              style={[styles.input, styles.editorInput]}
            />
            {(editingNoteId === 'new' || (!editingNoteId && !currentId)) ? (
              <Button
                onPress={editingNoteId ? handleSaveOtherNote : handleSave}
                title="Save"
                disabled={editingNoteId ? noteIsSaving : isSaving}
                style={styles.saveButton}
              />
            ) : saveSuccess ? (
              <Text style={styles.autosaveIndicator}>{saveSuccess}</Text>
            ) : null}
          </Card>
          {editingNoteId && !isEditingDeloadNote && (
            <Button
              onPress={() => handleSwitchCurrent(editingNoteId)}
              title="Set as current routine"
              style={styles.switchButton}
              textStyle={styles.switchButtonText}
            />
          )}
          <Button
            onPress={() => {
              if (editingNoteId) {
                if (isEditingDeloadNote) {
                  handleDeleteDeloadNoteFromEditor();
                } else {
                  handleDeleteRoutine(editingNoteId, editingTitle || 'Untitled Routine', false);
                }
              } else {
                handleDeleteRoutine(currentId, workoutNoteTitle || 'Untitled Routine', true);
              }
            }}
            title={isEditingDeloadNote ? 'Delete deload record' : 'Delete routine'}
            style={styles.deleteButton}
            textStyle={styles.deleteButtonText}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  editContainer: {
    gap: 16,
  },
  input: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
  },
  titleInput: {
    marginBottom: 12,
    fontWeight: '700',
  },
  editorInput: {
    minHeight: 250,
    textAlignVertical: 'top',
  },
  saveButton: {
    marginTop: 12,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  switchButtonText: {
    color: Colors.accent,
  },
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  deleteButtonText: {
    color: Colors.error,
  },
  autosaveIndicator: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'right',
    marginTop: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 6,
    marginTop: 4,
  },
  dateInput: {
    justifyContent: 'center',
    marginBottom: 12,
  },
  dateInputText: {
    fontSize: 16,
    color: Colors.text,
  },
});
