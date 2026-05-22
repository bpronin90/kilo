import React, { useMemo, useState, useEffect } from 'react';
import { Alert, Platform, Pressable, BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button, WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine, SectionTitle, SET_ROW_FONT_SIZE } from '../components/UI';
import { Colors } from '../theme/colors';
import { parseWorkoutNote } from '../lib/parser';
import { normalizeLiftName } from '../lib/data';
import { useTrackedLifts, useWorkoutNotes } from '../hooks/useEntries';

const COLLAPSED_STATE_KEY = 'kilo_log_current_collapsed';

export function LogScreen({ 
  workoutNoteText, 
  setWorkoutNoteText, 
  workoutNoteTitle, 
  setWorkoutNoteTitle, 
  isCollapsed,
  toggleCollapsed,
  onSaveWorkout 
}) {
  const { notes, currentId, currentNote, selectCurrent, update, add, remove } = useWorkoutNotes();
  const { trackedLifts, toggle: toggleTrackedLift } = useTrackedLifts();

  const [mode, setMode] = useState(workoutNoteText ? 'read' : 'edit');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingText, setEditingText] = useState('');
  const [noteIsSaving, setNoteIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  const hasUnsavedCurrent = useMemo(() => {
    if (!currentNote) return workoutNoteTitle.trim() !== '' || workoutNoteText.trim() !== '';
    return workoutNoteTitle !== (currentNote.title || '') || workoutNoteText !== currentNote.raw_text;
  }, [currentNote, workoutNoteTitle, workoutNoteText]);

  const editingNote = useMemo(() => 
    (editingNoteId && editingNoteId !== 'new') ? notes.find(n => n.id === editingNoteId) : null
  , [editingNoteId, notes]);

  const hasUnsavedOther = useMemo(() => {
    if (!editingNoteId) return false;
    if (editingNoteId === 'new') return editingTitle.trim() !== '' || editingText.trim() !== '';
    if (!editingNote) return false;
    return editingTitle !== (editingNote.title || '') || editingText !== editingNote.raw_text;
  }, [editingNoteId, editingNote, editingTitle, editingText]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const backAction = () => {
      if (editingNoteId) {
        handleDoneOther();
        return true;
      }
      if (mode === 'edit') {
        handleDoneCurrent();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  }, [editingNoteId, mode, workoutNoteText, workoutNoteTitle, editingTitle, editingText]);

  const otherNotes = notes.filter(n => n.id !== currentId);

  const parsed = useMemo(() => {
    return parseWorkoutNote(workoutNoteText);
  }, [workoutNoteText]);

  // Group consecutive sections that share the same day heading so each day
  // renders exactly one heading, regardless of warmup/lifting splits.
  const dayGroups = useMemo(() => {
    const groups = [];
    for (const section of parsed.sections) {
      const last = groups[groups.length - 1];
      if (last && last.heading === section.heading) {
        last.sections.push(section);
      } else {
        groups.push({ heading: section.heading, sections: [section] });
      }
    }
    return groups;
  }, [parsed.sections]);

  const hasContent = workoutNoteText.trim().length > 0;

  const handleSave = async () => {
    if (isSaving) return;
    if (!currentId && !workoutNoteText.trim()) {
      setSaveError('Workout notes are required');
      return;
    }
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
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
        setSaveSuccess('Saved!');
      } else {
        setSaveError('Save failed');
      }
      return ok;
    } catch {
      setSaveError('Save failed');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDoneCurrent = () => {
    if (!hasUnsavedCurrent) {
      setMode('read');
      return;
    }

    if (!currentId) {
      Alert.alert(
        'Discard changes?',
        'You have not saved this new routine. Are you sure you want to discard it?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            style: 'destructive', 
            onPress: () => {
              setMode('read');
              setWorkoutNoteText('');
              setWorkoutNoteTitle('');
            } 
          },
        ]
      );
    } else {
      Alert.alert(
        'Unsaved Changes',
        'Do you want to save your changes before leaving?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            style: 'destructive', 
            onPress: () => {
              setMode('read');
              setWorkoutNoteText(currentNote.raw_text);
              setWorkoutNoteTitle(currentNote.title || '');
            } 
          },
          { 
            text: 'Save', 
            onPress: async () => {
              const ok = await handleSave();
              if (ok) setMode('read');
            } 
          },
        ]
      );
    }
  };

  const handleDoneOther = () => {
    if (!hasUnsavedOther) {
      setEditingNoteId(null);
      return;
    }

    if (editingNoteId === 'new') {
      Alert.alert(
        'Discard changes?',
        'You have not saved this new routine. Are you sure you want to discard it?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            style: 'destructive', 
            onPress: () => setEditingNoteId(null) 
          },
        ]
      );
    } else {
      Alert.alert(
        'Unsaved Changes',
        'Do you want to save your changes before leaving?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            style: 'destructive', 
            onPress: () => setEditingNoteId(null) 
          },
          { 
            text: 'Save', 
            onPress: async () => {
              const ok = await handleSaveOtherNote();
              if (ok) setEditingNoteId(null);
            } 
          },
        ]
      );
    }
  };

  const handleOpenOtherNote = (other) => {
    setEditingNoteId(other.id);
    setEditingTitle(other.title || '');
    setEditingText(other.raw_text);
    setSaveError('');
    setSaveSuccess('');
  };

  const handleSaveOtherNote = async () => {
    if (noteIsSaving) return;
    setNoteIsSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      let result;
      if (editingNoteId === 'new') {
        result = await add(editingTitle || 'Untitled Routine', editingText);
        setEditingNoteId(result.id);
      } else {
        result = await update(editingNoteId, { 
          title: editingTitle || 'Untitled Routine',
          raw_text: editingText 
        });
      }
      if (!result) {
        setSaveError('Save failed');
      } else {
        setSaveSuccess('Saved!');
      }
      return result;
    } catch {
      setSaveError('Save failed');
      return false;
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

  const handleCreateRoutine = () => {
    setEditingNoteId('new');
    setEditingTitle('');
    setEditingText('');
    setSaveError('');
    setSaveSuccess('');
  };

  const handleSwitchCurrent = (id) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    // Check if there are unsaved changes in the editor for ANY routine
    const hasUnsaved = editingNoteId ? hasUnsavedOther : (mode === 'edit' ? hasUnsavedCurrent : false);

    const doSwitch = async () => {
      await selectCurrent(id);
      setEditingNoteId(null);
    };

    const alertTitle = 'Set as Current Routine';
    let alertMessage = `Switching to "${note.title || 'Untitled Routine'}" will affect your analytics. Are you sure?`;
    
    if (hasUnsaved) {
      alertMessage = `You have unsaved changes that will be lost if you switch. Continue?`;
      Alert.alert(
        alertTitle,
        alertMessage,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch Anyway', style: 'destructive', onPress: doSwitch },
          { 
            text: 'Save & Switch', 
            onPress: async () => {
              let ok = false;
              if (editingNoteId) {
                ok = await handleSaveOtherNote();
              } else {
                ok = await handleSave();
              }
              if (ok) await doSwitch();
            } 
          },
        ]
      );
    } else {
      Alert.alert(
        alertTitle,
        alertMessage,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Set as Current', onPress: doSwitch },
        ]
      );
    }
  };

  const handleToggleTrack = async (name) => {
    const key = normalizeLiftName(name);
    await toggleTrackedLift(key);
  };

  const headerRight = !editingNoteId && hasContent && mode === 'edit' && (
    <Pressable
      onPress={handleDoneCurrent}
      style={styles.modeToggle}
    >
      <Text style={styles.modeToggleText}>
        Done
      </Text>
    </Pressable>
  );

  if (editingNoteId) {
    return (
      <ScreenShell
        title={editingTitle || 'Routine'}
        subtitle="Edit routine"
        headerRight={
          <Pressable onPress={handleDoneOther} style={styles.modeToggle}>
            <Text style={styles.modeToggleText}>Done</Text>
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
              title={saveSuccess ? 'Saved!' : 'Save changes'}
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
      title="Workout Notes"
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
          <Card style={styles.currentRoutineCard}>
            <Pressable
              onPress={toggleCollapsed}
              style={styles.otherNoteHeader}
            >
              <View style={styles.otherNoteInfo}>
                <Text style={[styles.otherNoteTitle, { fontSize: 22, color: Colors.accent }]}>{workoutNoteTitle || 'My Workout'}</Text>
                <Text style={styles.otherNoteSub}>Current routine</Text>
              </View>
            </Pressable>

            <View style={[styles.currentNoteContent, isCollapsed ? { display: 'none' } : null]}>
              {dayGroups.map((group, gi) => (
                <View key={`day-${gi}`}>
                  {group.heading && (
                    <WorkoutHeading style={gi === 0 ? { marginTop: 12 } : null}>
                      {group.heading}
                    </WorkoutHeading>
                  )}
                  {group.sections.map((section, si) => (
                    <View key={`section-${gi}-${si}`}>
                      {section.subheading && <WorkoutSubheading>{section.subheading}</WorkoutSubheading>}
                      {section.exercises.map((ex, ei) => (
                        <ExerciseBlock
                          key={`ex-${gi}-${si}-${ei}`}
                          name={ex.name}
                          isTracked={!!trackedLifts[normalizeLiftName(ex.name)]}
                          onToggleTrack={() => handleToggleTrack(ex.name)}
                        >
                          {ex.rows.map((row, ri) => (
                            <SetLine key={`row-${gi}-${si}-${ei}-${ri}`} sets={row.sets} />
                          ))}
                          {ex.session_entries.filter(e => e.skipped).map((_, ski) => (
                            <Text key={`skip-${gi}-${si}-${ei}-${ski}`} style={styles.skipMarker}>—</Text>
                          ))}
                          {ex.unparsed_rows.map((u, ui) => (
                            <Text key={`u-${gi}-${si}-${ei}-${ui}`} style={styles.unparsedRow}>{u}</Text>
                          ))}
                        </ExerciseBlock>
                      ))}
                    </View>
                  ))}
                </View>
              ))}
              {!dayGroups.length && (
                <Text style={styles.emptyText}>Add some exercises to see the formatted view.</Text>
              )}
              <Button
                onPress={() => setMode('edit')}
                title="Edit note"
                style={styles.editButton}
                textStyle={styles.editButtonText}
              />
            </View>
          </Card>
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
              title={saveSuccess ? 'Saved!' : 'Save note'}
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
            <SectionTitle>More Routines</SectionTitle>
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
                    <Text style={styles.inlineSwitchButtonText}>Set Current</Text>
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
    paddingBottom: 2,
  },
  currentRoutineCard: {
    padding: 8,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: Colors.cardBorder,
  },
  unparsedRow: {
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.textMuted,
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
    fontSize: SET_ROW_FONT_SIZE,
    color: Colors.textMuted,
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
    marginTop: 4,
    gap: 12,
  },
  otherNoteCard: {
    padding: 0,
    overflow: 'hidden',
  },
  otherNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 12,
  },
  otherNoteInfo: {
    flex: 1,
  },
  otherNoteTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  otherNoteSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  currentNoteContent: {
    padding: 18,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  inlineSwitchButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.chipBackground,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  inlineSwitchButtonText: {
    fontSize: 12,
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
