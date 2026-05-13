import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { Card, Button } from '../components/UI';
import { Colors } from '../theme/colors';

export function LogScreen({ workoutTitle, setWorkoutTitle, workoutDetail, setWorkoutDetail, onSaveWorkout }) {
  return (
    <ScreenShell
      title="Workout log"
      subtitle="Direct entry for your training sessions."
    >
      <Card>
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
        <Button onPress={onSaveWorkout} title="Save workout" />
      </Card>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
