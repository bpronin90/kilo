import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Button, WorkoutHeading, WorkoutSubheading, ExerciseBlock, SetLine } from './UI';
import { Colors } from '../theme/colors';

export function LogEmptyState({ onCreateRoutine }) {
  return (
    <View style={styles.container}>
      <Card style={styles.introCard}>
        <Text style={styles.title}>Get started</Text>
        <Text style={styles.copy}>
          Kilo uses a simple text format to track your progress. Log your first routine to see your stats come alive.
        </Text>
        <Button
          onPress={onCreateRoutine}
          title="New Routine"
          style={styles.createButton}
        />
      </Card>

      <Text style={styles.exampleLabel}>Example Format</Text>
      <Card style={styles.exampleCard}>
        <WorkoutHeading style={{ marginTop: 0 }}>Monday</WorkoutHeading>
        <WorkoutSubheading>Push Day</WorkoutSubheading>
        <ExerciseBlock name="Bench Press">
          <SetLine sets={[{ weight_value: 135, rep_count: 5 }, { weight_value: 135, rep_count: 5 }]} />
        </ExerciseBlock>
        <ExerciseBlock name="Overhead Press">
          <SetLine sets={[{ weight_value: 95, rep_count: 8 }]} />
        </ExerciseBlock>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
    paddingBottom: 24,
  },
  introCard: {
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  copy: {
    fontSize: 16,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  createButton: {
    width: '100%',
  },
  exampleLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: 8,
    marginTop: 8,
  },
  exampleCard: {
    opacity: 0.8,
    padding: 18,
  },
});
