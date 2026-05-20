import React, { useMemo, useState, useEffect } from 'react';
import { Alert, Platform, Pressable, BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, SectionTitle } from '../components/UI';
import { Colors } from '../theme/colors';
import { parseWorkoutNote } from '../lib/parser';
import { useWorkoutNotes } from '../hooks/useEntries';

export function LogScreen({ workoutNoteText, setWorkoutNoteText, onSaveWorkout }) {
  const [mode, setMode] = useState(workoutNoteText ? 'read' : 'edit');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [noteIsSaving, setNoteIsSaving] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      if (editingNoteId) {
        setEditingNoteId(null);
        return true;
      }
      if (mode === 'edit' && workoutNoteText) {
        setMode('read');
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  }, [editingNoteId, mode, workoutNoteText]);

  const { notes, currentId, selectCurrent, update, add } = useWorkoutNotes();
  const currentNote = notes.find(n => n.id === currentId);
  const otherNotes = notes.filter(n => n.id !== currentId);

  const parsed = useMemo(() => {
    return parseWorkoutNote(workoutNoteText);
  }, [workoutNoteText]);

  const hasContent = workoutNoteText.trim().length > 0;

  const handleSave = async () => {
    if (isSaving) return;
    if (!currentId && !workoutNoteText.trim()) {
      setSaveError('Workout note is required');
      return;
    }
    setIsSaving(true);
    setSaveError('');
    try {
      let ok = false;
      if (currentId) {
        const result = await update(currentId, { raw_text: workoutNoteText });
        ok = !!result;
      } else {
        const note = await add('My Workout', workoutNoteText);
        await selectCurrent(note.id);
        ok = true;
      }
      if (ok) {
        setMode('read');
      } else {
        setSaveError('Save failed');
      }
    } catch {
      setSaveError('Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenOtherNote = (other) => {
    setEditingNoteId(other.id);
    setEditingText(other.raw_text);
    setSaveError('');
  };

  const handleSaveOtherNote = async () => {
    if (noteIsSaving) return;
    setNoteIsSaving(true);
    setSaveError('');
    try {
      const result = await update(editingNoteId, { raw_text: editingText });
      if (!result) setSaveError('Save failed');
    } catch {
      setSaveError('Save failed');
    } finally {
      setNoteIsSaving(false);
    }
  };

  const handleSwitchCurrent = (id) => {
    const editingNote = notes.find(n => n.id === editingNoteId);
    const hasUnsaved = editingNote && editingText !== editingNote.raw_text;

    const doSwitch = async () => {
      if (hasUnsaved) {
        let saved;
        try {
          saved = await update(editingNoteId, { raw_text: editingText });
        } catch {
          setSaveError('Save failed. Routine was not switched.');
          return;
        }
        if (!saved) {
          setSaveError('Save failed. Routine was not switched.');
          return;
        }
      }
      selectCurrent(id);
      setEditingNoteId(null);
    };

    Alert.alert(
      'Switch Workout',
      hasUnsaved
        ? 'Your edits will be saved and this routine will become your current workout. Continue?'
        : 'Switching your current workout affects analytics. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', style: 'destructive', onPress: doSwitch },
      ]
    );
  };

  const headerRight = !editingNoteId && hasContent && (
    <Pressable
      onPress={() => setMode(mode === 'read' ? 'edit' : 'read')}
      style={styles.modeToggle}
    >
      <Text style={styles.modeToggleText}>
        {mode === 'read' ? 'Edit' : 'Done'}
      </Text>
    </Pressable>
  );

  if (editingNoteId) {
    const editingNote = notes.find(n => n.id === editingNoteId);
    return (
      <ScreenShell
        title={editingNote?.title || 'Routine'}
        subtitle="Edit raw note"
        headerRight={
          <Pressable onPress={() => setEditingNoteId(null)} style={styles.modeToggle}>
            <Text style={styles.modeToggleText}>Back</Text>
          </Pressable>
        }
        keyboardShouldPersistTaps="handled"
      >
        {saveError ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{saveError}</Text>
          </Card>
        ) : null}
        <View style={styles.editContainer}>
          <Card>
            <TextInput
              value={editingText}
              onChangeText={setEditingText}
              placeholder="e.g.&#10;=== Push Day ===&#10;Bench Press 135x5, 135x5, 135x5"
              placeholderTextColor={Colors.textMuted}
              multiline
              autoFocus
              style={[styles.input, styles.editorInput]}
            />
            <Button
              onPress={handleSaveOtherNote}
              title="Save note"
              disabled={noteIsSaving}
              style={styles.saveButton}
            />
          </Card>
          <Button
            onPress={() => handleSwitchCurrent(editingNoteId)}
            title="Switch to this routine"
            style={styles.switchButton}
            textStyle={styles.switchButtonText}
          />
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      title="Workout note"
      subtitle="Your active training routine. Update it as you go."
      headerRight={headerRight}
      keyboardShouldPersistTaps="handled"
    >
      {saveError ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{saveError}</Text>
        </Card>
      ) : null}

      {mode === 'read' && hasContent ? (
        <View style={styles.mirrorContainer}>
          {parsed.sections.map((section, si) => (
            <View key={`section-${si}`}>
              {section.heading && <WorkoutHeading>{section.heading}</WorkoutHeading>}
              {section.subheading && <WorkoutSubheading>{section.subheading}</WorkoutSubheading>}
              {section.exercises.map((ex, ei) => (
                <ExerciseBlock
                  key={`ex-${si}-${ei}`}
                  name={ex.name}
                  isTracked={false}
                  disabledTrack={true}
                >
                  {ex.rows.map((row, ri) => (
                    <SetLine key={`row-${si}-${ei}-${ri}`} sets={row.sets} />
                  ))}
                  {ex.session_entries.filter(e => e.skipped).map((_, ski) => (
                    <Text key={`skip-${si}-${ei}-${ski}`} style={styles.skipMarker}>—</Text>
                  ))}
                  {ex.unparsed_rows.map((u, ui) => (
                    <Text key={`u-${si}-${ei}-${ui}`} style={styles.unparsedRow}>{u}</Text>
                  ))}
                </ExerciseBlock>
              ))}
            </View>
          ))}
          {!parsed.sections.length && (
            <Text style={styles.emptyText}>Add some exercises to see the formatted view.</Text>
          )}
          <Button
            onPress={() => setMode('edit')}
            title="Edit note"
            style={styles.editButton}
            textStyle={styles.editButtonText}
          />
        </View>
      ) : (
        <View style={styles.editContainer}>
          <Card>
            <TextInput
              value={workoutNoteText}
              onChangeText={setWorkoutNoteText}
              placeholder="e.g.&#10;=== Push Day ===&#10;Bench Press 135x5, 135x5, 135x5"
              placeholderTextColor={Colors.textMuted}
              multiline
              autoFocus={!hasContent}
              style={[styles.input, styles.editorInput]}
            />
            <Button
              onPress={handleSave}
              title="Save note"
              disabled={isSaving}
              style={styles.saveButton}
            />
          </Card>
        </View>
      )}

      {otherNotes.length > 0 && (
        <View style={styles.previousRoutines}>
          <SectionTitle>Previous Routines</SectionTitle>
          {otherNotes.map(other => (
            <Card
              key={other.id}
              onPress={() => handleOpenOtherNote(other)}
              style={styles.otherNoteCard}
            >
              <Text style={styles.otherNoteTitle}>{other.title || 'Untitled Routine'}</Text>
              <Text style={styles.otherNotePreview} numberOfLines={1}>
                {other.raw_text.split('\n').filter(l => l.trim()).join(' ') || 'No content'}
              </Text>
            </Card>
          ))}
        </View>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  modeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: Colors.chipBackground,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  errorCard: {
    borderColor: Colors.error,
    backgroundColor: '#fff0f0', // Slight red tint
    padding: 12,
    marginBottom: 8,
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
  editorInput: {
    minHeight: 250,
    textAlignVertical: 'top',
  },
  saveButton: {
    marginTop: 12,
  },
  mirrorContainer: {
    paddingBottom: 24,
  },
  unparsedRow: {
    fontSize: 15,
    color: Colors.textMuted,
    fontStyle: 'italic',
    paddingLeft: 0,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 40,
  },
  editButton: {
    marginTop: 32,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  editButtonText: {
    color: Colors.accent,
  },
  skipMarker: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  editContainer: {
    gap: 16,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  switchButtonText: {
    color: Colors.accent,
  },
  previousRoutines: {
    marginTop: 32,
    gap: 12,
  },
  otherNoteCard: {
    padding: 14,
    gap: 4,
  },
  otherNoteTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  otherNotePreview: {
    fontSize: 14,
    color: Colors.textMuted,
  },
});
