import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Button } from './UI';
import { Colors } from '../theme/colors';
import { WORKOUT_SYNTAX_EXAMPLE, WORKOUT_SYNTAX_ROWS } from './WorkoutSyntaxReference';

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

      <Text style={styles.exampleLabel}>Type this format</Text>
      <Card style={styles.exampleCard}>
        <View style={styles.codeBlock}>
          {WORKOUT_SYNTAX_ROWS.map((row, idx) => (
            <Text key={idx} style={styles.codeLine}>{row}</Text>
          ))}
        </View>
        <Text style={[styles.helpText, { marginTop: 12 }]}>
          <Text style={{ fontWeight: 'bold' }}>How it works:</Text>
        </Text>
        <View style={{ marginTop: 6, gap: 6 }}>
          <View style={styles.formatRow}>
            <Text style={styles.codeText}>-Bench</Text>
            <Text style={styles.formatDesc}>Exercise name (starts with a dash)</Text>
          </View>
          <View style={styles.formatRow}>
            <Text style={styles.codeText}>135 5,5,5</Text>
            <Text style={styles.formatDesc}>3 sets at 135 lbs for 5 reps</Text>
          </View>
          <View style={styles.formatRow}>
            <Text style={styles.codeText}>-</Text>
            <Text style={styles.formatDesc}>A dash alone marks a skipped session</Text>
          </View>
        </View>
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
    padding: 18,
  },
  codeBlock: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  codeLine: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: Colors.text,
    lineHeight: 18,
  },
  helpText: {
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  formatRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  codeText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: Colors.text,
    fontWeight: '600',
    minWidth: 80,
  },
  formatDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
    flex: 1,
  },
});
