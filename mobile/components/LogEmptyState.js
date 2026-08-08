import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, Button } from './UI';
import { useThemedStyles } from '../theme/ThemeContext';
import {
  WORKOUT_SYNTAX_EXAMPLE_LINES,
  WORKOUT_SYNTAX_EXAMPLE_TEXT,
  WORKOUT_SYNTAX_ROW_EXPLANATIONS,
} from './WorkoutSyntaxReference';

// The empty state is the THIRD consumer of the shared syntax source (#748;
// #745 finding F4). It used to hold its own shorter explanation list, which had
// drifted: it dropped the `140 5,5` row that carries the session semantic
// ("each new line is a new session") and the bodyweight row, then used the word
// "session" in the next row to explain skipping. A user reading only the empty
// state learned "lines are sets" and had no idea how to log a second session.
//
// These re-exports keep the module's existing public surface (and its #585
// regression tests) pointing at exactly one example and one explanation set, so
// the taught syntax can no longer drift between Help, the editor modal, and the
// only surface an untaught first-time user actually lands on.
export const WORKOUT_SYNTAX_EXAMPLE = WORKOUT_SYNTAX_EXAMPLE_TEXT;
export const WORKOUT_SYNTAX_ROWS = WORKOUT_SYNTAX_EXAMPLE_LINES;

export function LogEmptyState({ onCreateRoutine }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.container}>
      <Card style={styles.introCard}>
        <Text style={styles.title}>Write your first routine</Text>
        <Text style={styles.copy}>
          Kilo uses a simple text format to track your progress. Name your routine and list the exercises you plan to do — you can log the actual sets any time after.
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
          {WORKOUT_SYNTAX_ROW_EXPLANATIONS.map((row) => (
            <View key={row.code} style={styles.formatRow}>
              <Text style={styles.codeText}>{row.code}</Text>
              <Text style={styles.formatDesc}>{row.desc}</Text>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
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
    color: colors.text,
    textAlign: 'center',
  },
  copy: {
    fontSize: 16,
    color: colors.textMuted,
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
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginLeft: 8,
    marginTop: 8,
  },
  exampleCard: {
    padding: 18,
  },
  codeBlock: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  codeLine: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: colors.text,
    lineHeight: 18,
  },
  helpText: {
    fontSize: 13,
    color: colors.textMuted,
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
    color: colors.text,
    fontWeight: '600',
    minWidth: 80,
  },
  formatDesc: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    flex: 1,
  },
});
