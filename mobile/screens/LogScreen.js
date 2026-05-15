import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Button } from '../components/UI';
import { Colors } from '../theme/colors';

export function LogScreen({ workoutTitle, setWorkoutTitle, workoutDetail, setWorkoutDetail, onSaveWorkout, errorMessage, saving }) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Workout log</Text>
        <Text style={styles.subtitle}>Direct entry for your training sessions.</Text>
      </View>
      <Card>
        {errorMessage ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : null}
        <Text style={styles.inputLabel}>Workout name</Text>
        <TextInput
          value={workoutTitle}
          onChangeText={setWorkoutTitle}
          placeholder="e.g. Push Day"
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
        />
        <Text style={styles.inputLabel}>Session details</Text>
        <TextInput
          value={workoutDetail}
          onChangeText={setWorkoutDetail}
          placeholder="e.g. Bench 3x5, Rows 3x8"
          placeholderTextColor={Colors.textMuted}
          multiline
          style={[styles.input, styles.multilineInput]}
        />
        <Button onPress={onSaveWorkout} title="Save workout" disabled={saving} />
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
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
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
  multilineInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
});
