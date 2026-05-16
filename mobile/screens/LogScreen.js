import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Button } from '../components/UI';
import { Colors } from '../theme/colors';

export function LogScreen({ workoutNoteText, setWorkoutNoteText, onSaveWorkout, errorMessage, saving }) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Workout note</Text>
        <Text style={styles.subtitle}>Your active training routine. Update it as you go.</Text>
      </View>
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
          style={[styles.input, styles.editorInput]}
        />
        <Button onPress={onSaveWorkout} title="Save note" disabled={saving} style={styles.saveButton} />
      </Card>
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
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
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
});
