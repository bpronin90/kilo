import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';

// Single source of truth for the workout log text syntax taught in the App
// Guide (HelpScreen) and the editor-reachable WorkoutSyntaxModal (#584,
// follow-up to #573). Both consumers render this same example and the same
// row-by-row explanations so the taught syntax can never drift between the
// two surfaces. Exported as plain lines/rows (not JSX) so tests can assert on
// the exact taught example independent of rendering.
//
// This is a bare content block by design — no `Card`/`SectionTitle` wrapper
// (docs/ui-design-rules.md §4: no nested cards). Callers own the surrounding
// Card (HelpScreen) or sheet (WorkoutSyntaxModal).
export const WORKOUT_SYNTAX_EXAMPLE_LINES = [
  'Monday',
  '+Lifting',
  '-Bench',
  '135 5,5,5',
  '140 5,5',
  '-',
  '145 5',
];

export const WORKOUT_SYNTAX_EXAMPLE_TEXT = WORKOUT_SYNTAX_EXAMPLE_LINES.join('\n');

// Seed example for an empty workout note editor (#785, R6b-1). Deliberately a
// separate, shorter constant from the teaching example above: this one is
// inserted verbatim into the draft on tap, so it must stay exactly the
// four lines the acceptance criteria specify.
export const WORKOUT_SEED_EXAMPLE_TEXT = 'Monday\n+Lifting\n-Bench\n135 5,5,5';

// Row explanations shown under "How it works". Kept as data so both
// consumers render identical copy.
export const WORKOUT_SYNTAX_ROW_EXPLANATIONS = [
  { code: '-Bench', desc: 'Declares the exercise name (starts with a dash)' },
  { code: '135 5,5,5', desc: 'Logs 3 sets at 135 lbs for 5 reps (separated by commas)' },
  { code: '140 5,5', desc: 'Logs 2 sets at 140 lbs for 5 reps (each new line is a new session)' },
  { code: '-', desc: 'A single dash on a set line marks that session as skipped' },
  { code: '12,12', desc: 'Logs bodyweight exercises (reps only, no weight prefix)' },
  { code: '-- felt strong today', desc: 'Two dashes start a note — never parsed as a set' },
];

export function WorkoutSyntaxReference() {
  const styles = useThemedStyles(createStyles);
  return (
    <View>
      <Text style={styles.helpText}>
        Each workout note is plain text. Declare an exercise with a dash (<Text style={styles.bold}>-</Text>), then write your sets (weight followed by reps) on the lines below it.
      </Text>

      <View style={styles.codeBlock}>
        {WORKOUT_SYNTAX_EXAMPLE_LINES.map((line, idx) => (
          <Text key={idx} style={styles.codeText}>{line}</Text>
        ))}
      </View>

      <Text style={[styles.helpText, { marginTop: 12 }]}>
        How it works:
      </Text>
      <View style={styles.rowList}>
        {WORKOUT_SYNTAX_ROW_EXPLANATIONS.map((row) => (
          <View key={row.code} style={styles.formatRow}>
            <Text style={styles.codeText}>{row.code}</Text>
            <Text style={styles.formatDesc}>{row.desc}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.helpText, { marginTop: 12 }]}>
        Day names (e.g., <Text style={styles.boldText}>Monday</Text>) group exercises by training day. Block headers starting with a plus (e.g., <Text style={styles.boldText}>+Lifting</Text>) group exercises within that day. If you omit day names, exercises are parsed normally but will not have day/session grouping headings in the log view.{"\n\n"}
        To track an exercise in Analytics: tap it in your parsed log and tap "Track" to monitor its progress.
      </Text>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  helpText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  bold: {
    fontWeight: 'bold',
  },
  boldText: {
    fontWeight: 'bold',
    color: colors.text,
  },
  codeBlock: {
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 10,
    marginTop: 8,
    gap: 2,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: colors.text,
  },
  rowList: {
    marginTop: 6,
    gap: 6,
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  formatDesc: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
