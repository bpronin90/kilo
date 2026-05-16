import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Button, WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine } from '../components/UI';
import { Colors } from '../theme/colors';
import { parseWorkoutNote } from '../lib/parser';

export function LogScreen({ workoutNoteText, setWorkoutNoteText, onSaveWorkout, errorMessage, saving }) {
  const [mode, setMode] = useState(workoutNoteText ? 'read' : 'edit');

  const parsed = useMemo(() => {
    return parseWorkoutNote(workoutNoteText);
  }, [workoutNoteText]);

  const hasContent = workoutNoteText.trim().length > 0;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Workout note</Text>
          {hasContent && (
            <Pressable 
              onPress={() => setMode(mode === 'read' ? 'edit' : 'read')}
              style={styles.modeToggle}
            >
              <Text style={styles.modeToggleText}>
                {mode === 'read' ? 'Edit' : 'Done'}
              </Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.subtitle}>Your active training routine. Update it as you go.</Text>
      </View>

      {mode === 'read' && hasContent ? (
        <View style={styles.mirrorContainer}>
          {parsed.sections.map((section, si) => (
            <View key={`section-${si}`}>
              {section.heading && <WorkoutHeading>{section.heading}</WorkoutHeading>}
              {section.subheading && <WorkoutSubheading>{section.subheading}</WorkoutSubheading>}
              {section.exercises.map((ex, ei) => (
                <ExerciseBlock key={`ex-${si}-${ei}`} name={ex.name}>
                  {ex.rows.map((row, ri) => (
                    <SetLine key={`row-${si}-${ei}-${ri}`} sets={row.sets} />
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
          />
        </View>
      ) : (
        <Card>
          {errorMessage ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : null}
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
            onPress={() => {
              onSaveWorkout();
              if (!errorMessage) setMode('read');
            }} 
            title="Save note" 
            disabled={saving} 
            style={styles.saveButton} 
          />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 120,
    gap: 16,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
  },
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
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
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
});
