import React from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { Card, Button } from '../UI';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { createStyles } from './logEditorStyles';

// The deload-record editor's note body — a plain multiline field plus its own
// Save control. Rendered in place of the full routine editor while a deload
// week is being edited.
export function EditorDeloadNoteInput({ value, onChangeText, onSave, saveSuccess, isSaving }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Card>
      <TextInput
        keyboardAppearance={colors.scheme}
        value={value}
        onChangeText={onChangeText}
        placeholder="Deload note…"
        placeholderTextColor={colors.textMuted}
        multiline
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        style={[styles.input, styles.editorInput]}
      />
      <Button
        onPress={onSave}
        title={saveSuccess ? 'Saved!' : 'Save changes'}
        disabled={isSaving}
        style={styles.saveButton}
      />
    </Card>
  );
}

// Explicit Save (and the secondary Import routine action) for a brand-new
// routine. Absent — not merely disabled — outside that case, exactly as
// before.
export function EditorSaveActions({ editingNoteId, currentId, onSave, onSaveOther, isSaving, noteIsSaving, onImportRoutine }) {
  const styles = useThemedStyles(createStyles);
  // #880 review: a brand-new note's FIRST save is exactly the non-autosaved,
  // longest-running path (full parse + derive + possible cloud enqueue, with
  // nothing cached yet), so it must show the in-flight state too — not just a
  // disabled button with no indication of what it's doing.
  if (!(editingNoteId === 'new' || (!editingNoteId && !currentId))) return null;
  return (
    <>
      <Button
        onPress={editingNoteId ? onSaveOther : onSave}
        title="Save"
        disabled={editingNoteId ? noteIsSaving : isSaving}
        style={styles.saveButton}
      />
      {/* #1021: secondary path for a brand-new routine — paste a shared routine
          instead of typing one from scratch. Opens the existing import preview;
          nothing here is saved until that screen's own explicit create action. */}
      {typeof onImportRoutine === 'function' && (
        <Pressable
          onPress={onImportRoutine}
          style={styles.importRoutineButton}
          accessibilityRole="button"
          accessibilityLabel="Import routine"
          accessibilityHint="Opens a preview to paste and save a shared routine"
        >
          <Text style={styles.importRoutineButtonText}>Import routine</Text>
        </Pressable>
      )}
    </>
  );
}
