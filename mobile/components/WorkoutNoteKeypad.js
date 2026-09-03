import React from 'react';
import { ScrollView, StyleSheet, Text, Pressable } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';

// #938: the ordered set of one-tap keys the accessory row exposes while the
// workout-note editor is focused — the digits plus the four symbols and the
// newline that logging a set otherwise needs a keyboard-plane switch to reach.
// Each entry carries the literal string it inserts (`insert`), its visible
// glyph, and the accessible name required by ui-design-rules.md §15.
export const WORKOUT_NOTE_KEYPAD_KEYS = [
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => ({
    insert: d,
    glyph: d,
    a11y: `Insert ${d}`,
    kind: 'digit',
  })),
  { insert: ' ', glyph: 'space', a11y: 'Insert space', kind: 'word' },
  { insert: ',', glyph: ',', a11y: 'Insert comma', kind: 'symbol' },
  { insert: '-', glyph: '-', a11y: 'Insert hyphen', kind: 'symbol' },
  { insert: '*', glyph: '*', a11y: 'Insert asterisk', kind: 'symbol' },
  { insert: '\n', glyph: '↵', a11y: 'Insert new line', kind: 'symbol' },
];

// #938: replace the current selection with `key` and collapse the caret after
// it — byte-for-byte what the same hardware keystroke would do at that
// selection. Pure and shared so the full-screen editor and the Recovery inline
// editor insert identically. A missing/degenerate selection is treated as a
// caret at the end of the text, matching a focused input with no reported
// selection yet.
export function insertKeypadKey(text, selection, key) {
  const value = typeof text === 'string' ? text : '';
  const len = value.length;
  const rawStart = Number.isFinite(selection?.start) ? selection.start : len;
  const rawEnd = Number.isFinite(selection?.end) ? selection.end : rawStart;
  const start = Math.min(Math.max(0, Math.min(rawStart, rawEnd)), len);
  const end = Math.min(Math.max(0, Math.max(rawStart, rawEnd)), len);
  const nextText = value.slice(0, start) + key + value.slice(end);
  const caret = start + key.length;
  return { text: nextText, selection: { start: caret, end: caret } };
}

// #938: the numeric/symbol accessory row. Rendered by the editor components
// only while their workout-note input holds focus; it is a plain in-flow row,
// never an InputAccessoryView, so it behaves the same on both platforms and
// never changes the input's `keyboardType`. A horizontally scrolling single
// row keeps every key at the full 44dp target (ui-design-rules.md §15) without
// wrapping to a second line on a narrow screen.
export function WorkoutNoteKeypad({ visible, onKeyPress, style, testID }) {
  const styles = useThemedStyles(createStyles);
  if (!visible) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={[styles.row, style]}
      contentContainerStyle={styles.rowContent}
      testID={testID}
    >
      {WORKOUT_NOTE_KEYPAD_KEYS.map((entry) => (
        <Pressable
          key={entry.insert}
          onPress={() => onKeyPress?.(entry.insert)}
          style={styles.key}
          accessibilityRole="button"
          accessibilityLabel={entry.a11y}
        >
          <Text
            style={[styles.keyGlyph, entry.kind === 'word' && styles.keyGlyphWord]}
            accessible={false}
            allowFontScaling={false}
          >
            {entry.glyph}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  row: {
    flexGrow: 0,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    backgroundColor: colors.inputBackground,
  },
  rowContent: {
    padding: 4,
    gap: 4,
    alignItems: 'center',
  },
  key: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  keyGlyph: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  keyGlyphWord: {
    fontSize: 12,
    fontWeight: '600',
  },
});
