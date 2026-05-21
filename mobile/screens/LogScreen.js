import React, { useMemo, useState, useEffect } from 'react';
import { Alert, Platform, Pressable, BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, SectionTitle } from '../components/UI';
import { Colors } from '../theme/colors';
import { parseWorkoutNote } from '../lib/parser';
import { normalizeLiftName } from '../lib/data';
import { loadTrackedLifts, saveTrackedLifts } from '../storage/entries';
import { useWorkoutNotes } from '../hooks/useEntries';

export function LogScreen({ workoutNoteText, setWorkoutNoteText, onSaveWorkout }) {
  const { notes, currentId, currentNote, selectCurrent, update, add, remove } = useWorkoutNotes();

  const [mode, setMode] = useState(workoutNoteText ? 'read' : 'edit');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [workoutNoteTitle, setWorkoutNoteTitle] = useState('');

  const [trackedLifts, setTrackedLifts] = useState({});

  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingText, setEditingText] = useState('');
  const [noteIsSaving, setNoteIsSaving] = useState(false);

  useEffect(() => {
    loadTrackedLifts().then(setTrackedLifts);
  }, []);

  useEffect(() => {
    if (currentNote) {
      setWorkoutNoteTitle(currentNote.title || '');
    }
  }, [currentNote]);

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
        const result = await update(currentId, { 
          title: workoutNoteTitle || 'My Workout',
          raw_text: workoutNoteText 
        });
        ok = !!result;
      } else {
        const note = await add(workoutNoteTitle || 'My Workout', workoutNoteText);
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
    setEditingTitle(other.title || '');
    setEditingText(other.raw_text);
    setSaveError('');
  };

  const handleSaveOtherNote = async () => {
    if (noteIsSaving) return;
    setNoteIsSaving(true);
    setSaveError('');
    try {
      const result = await update(editingNoteId, { 
        title: editingTitle || 'Untitled Routine',
        raw_text: editingText 
      });
      if (!result) setSaveError('Save failed');
    } catch {
      setSaveError('Save failed');
    } finally {
      setNoteIsSaving(false);
    }
  };

  const handleDeleteRoutine = (id, title, isCurrent) => {
    Alert.alert(
      'Delete Routine',
      isCurrent
        ? `"${title}" is your current active routine. Deleting it will affect your analytics. Are you sure?`
        : `Are you sure you want to delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            await remove(id);
            setEditingNoteId(null);
            if (isCurrent) {
              setMode('edit');
              setWorkoutNoteText('');
              setWorkoutNoteTitle('');
            }
          } 
        },
      ]
    );
  };

  const handleCreateRoutine = async () => {
    const note = await add('New Routine', '');
    handleOpenOtherNote(note);
  };

  const handleSwitchCurrent = (id) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    // Check if there are unsaved changes in the editor for ANY routine
    const isEditing = editingNoteId !== null;
    const editingNote = isEditing ? notes.find(n => n.id === editingNoteId) : null;
    const hasUnsaved = isEditing && editingNote && (editingText !== editingNote.raw_text || editingTitle !== editingNote.title);

    const doSwitch = async () => {
      if (hasUnsaved) {
        try {
          await update(editingNoteId, { 
            title: editingTitle || 'Untitled Routine',
            raw_text: editingText 
          });
        } catch {
          setSaveError('Save failed. Routine was not switched.');
          return;
        }
      }
      await selectCurrent(id);
      setEditingNoteId(null);
    };

    const alertTitle = 'Set as Current Routine';
    let alertMessage = `Switching to "${note.title || 'Untitled Routine'}" will affect your analytics. Are you sure?`;
    
    if (hasUnsaved) {
      alertMessage = `Your unsaved changes in "${editingNote.title || 'Untitled Routine'}" will be saved before switching. Continue?`;
    }

    Alert.alert(
      alertTitle,
      alertMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Set as Current', onPress: doSwitch },
      ]
    );
  };

  const handleToggleTrack = (name) => {
    const key = normalizeLiftName(name);
    setTrackedLifts(prev => {
      const next = { ...prev };
      if (next[key]) { delete next[key]; } else { next[key] = true; }
      saveTrackedLifts(next);
      return next;
    });
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
        title={editingTitle || 'Routine'}
        subtitle="Edit routine"
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
              value={editingTitle}
              onChangeText={setEditingTitle}
              placeholder="Routine Name (e.g. Push Day)"
              placeholderTextColor={Colors.textMuted}
              style={[styles.input, styles.titleInput]}
            />
            <TextInput
              value={editingText}
              onChangeText={setEditingText}
              placeholder="e.g.&#10;=== Push Day ===&#10;Bench Press 135x5, 135x5, 135x5"
              placeholderTextColor={Colors.textMuted}
              multiline
              style={[styles.input, styles.editorInput]}
            />
            <Button
              onPress={handleSaveOtherNote}
              title="Save changes"
              disabled={noteIsSaving}
              style={styles.saveButton}
            />
          </Card>
          <Button
            onPress={() => handleSwitchCurrent(editingNoteId)}
            title="Set as current routine"
            style={styles.switchButton}
            textStyle={styles.switchButtonText}
          />
          <Button
            onPress={() => handleDeleteRoutine(editingNoteId, editingTitle || 'Untitled Routine', false)}
            title="Delete routine"
            style={styles.deleteButton}
            textStyle={styles.deleteButtonText}
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
                  isTracked={!!trackedLifts[normalizeLiftName(ex.name)]}
                  onToggleTrack={() => handleToggleTrack(ex.name)}
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
              value={workoutNoteTitle}
              onChangeText={setWorkoutNoteTitle}
              placeholder="Routine Name (e.g. Push Day)"
              placeholderTextColor={Colors.textMuted}
              style={[styles.input, styles.titleInput]}
            />
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
          {currentId && (
            <Button
              onPress={() => handleDeleteRoutine(currentId, workoutNoteTitle || 'My Workout', true)}
              title="Delete routine"
              style={styles.deleteButton}
              textStyle={styles.deleteButtonText}
            />
          )}
        </View>
      )}

      <View style={styles.previousRoutines}>
        {otherNotes.length > 0 && (
          <>
            <SectionTitle>Routines</SectionTitle>
            {otherNotes.map(other => (
              <Card
                key={other.id}
                style={styles.otherNoteCard}
              >
                <View style={styles.otherNoteHeader}>
                  <Pressable
                    onPress={() => handleOpenOtherNote(other)}
                    style={styles.otherNoteInfo}
                  >
                    <Text style={styles.otherNoteTitle}>{other.title || 'Untitled Routine'}</Text>
                    {other.updated_at && (
                      <Text style={styles.otherNoteSub}>{new Date(other.updated_at).toLocaleDateString()}</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => handleSwitchCurrent(other.id)}
                    style={styles.inlineSwitchButton}
                  >
                    <Text style={styles.inlineSwitchButtonText}>Set current</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </>
        )}
        <Button
          onPress={handleCreateRoutine}
          title="+ New routine"
          style={styles.createButton}
          textStyle={styles.createButtonText}
        />
      </View>
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
  deleteButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.error,
  },
  deleteButtonText: {
    color: Colors.error,
  },
  previousRoutines: {
    marginTop: 32,
    gap: 12,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  otherNoteInfo: {
    flex: 1,
  },
  otherNoteTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  otherNoteSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  inlineSwitchButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: Colors.chipBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  inlineSwitchButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
  },
  createButton: {
    marginTop: 8,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.accent,
    borderStyle: 'dashed',
  },
  createButtonText: {
    color: Colors.accent,
  },
});
