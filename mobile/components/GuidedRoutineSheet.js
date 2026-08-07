// Guided routine scaffold (#748; #745 Part 3 §3.1 as amended by Part 4).
//
// Compose → parse-verify → preview the LITERAL text → confirm → persist. The
// three hard boundaries this component exists to enforce:
//
//   • Nothing is written until the user has seen the exact characters that will
//     be stored. The preview is the text itself, not a description of it.
//   • The app composes only from what the user typed HERE: a routine name, an
//     optional day label, and exercise names. No template library, no example
//     routine, no prior-user data, and — because Kilo has no basis for a weight
//     or a rep count — no set rows at all.
//   • Saving does not adopt. The confirmation names exactly one effect,
//     "Saves this routine"; the post-save prompt owns the adoption question.
//
// Follows the shipped WorkoutSyntaxModal overlay/sheet/close pattern so
// background content stays out of the accessibility order and no new modal
// mechanism is introduced.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from './UI';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { verifyScaffold } from '../lib/guidedEntry';

// Offered as suggestions only, never pre-selected: the app never guesses which
// day a user is training. They exist because the parser groups on weekday
// names, so choosing one is what makes the day heading meaningful.
const WEEKDAY_SUGGESTIONS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export function GuidedRoutineSheet({ visible, onClose, onWriteAsText, onSave }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [name, setName] = useState('');
  const [dayLabel, setDayLabel] = useState('');
  const [exercises, setExercises] = useState(['']);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  // The sheet is re-openable with its values intact within the same Log visit,
  // so state is reset on the transition into visibility, not out of it.
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setSaving(false);
      setSaveError(null);
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  const trimmedName = name.trim();
  const verification = useMemo(
    () => verifyScaffold({ dayLabel, exerciseNames: exercises }),
    [dayLabel, exercises]
  );
  const composedText = verification.text;
  const previewLines = composedText ? composedText.split('\n') : [];
  const canSave = !!trimmedName && verification.ok && !saving;

  const setExerciseAt = (index, value) => {
    setExercises(prev => prev.map((v, i) => (i === index ? value : v)));
  };
  const addExercise = () => setExercises(prev => [...prev, '']);
  const removeExerciseAt = (index) => {
    setExercises(prev => (prev.length <= 1 ? [''] : prev.filter((_, i) => i !== index)));
  };

  const resetDraft = () => {
    setName('');
    setDayLabel('');
    setExercises(['']);
    setSaveError(null);
    setSaving(false);
  };

  // `Cancel` writes nothing and discards the draft.
  const handleCancel = () => {
    resetDraft();
    onClose?.();
  };

  // The mandatory manual escape: closes the sheet and opens the ordinary
  // editor with the composed text and title pre-filled and UNSAVED, so the same
  // text then follows the normal `Save` flow.
  const handleWriteAsText = () => {
    const seed = { title: trimmedName, text: composedText };
    resetDraft();
    onWriteAsText?.(seed);
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    let result;
    try {
      result = await onSave?.({ title: trimmedName, text: composedText });
    } catch {
      result = { ok: false };
    }
    setSaving(false);
    if (result?.ok) {
      // Only a successful write closes the sheet; a failed one keeps every
      // field intact so `Try again` starts from the same draft.
      resetDraft();
      return;
    }
    setSaveError(result?.error || 'Could not save this routine. Nothing was written — try again.');
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} accessibilityLabel="Close new routine" />
      <KeyboardAvoidingView
        style={styles.overlay}
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">New routine</Text>
            <Pressable
              onPress={handleCancel}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close new routine"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.label}>Routine name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Push Day"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              spellCheck={false}
              style={styles.input}
              accessibilityLabel="Routine name"
            />

            <Text style={[styles.label, styles.labelSpaced]}>Day (optional)</Text>
            <TextInput
              value={dayLabel}
              onChangeText={setDayLabel}
              placeholder="e.g. Monday"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              spellCheck={false}
              style={styles.input}
              accessibilityLabel="Day label, optional"
            />
            <Text style={styles.hint}>
              A weekday name groups this routine by training day. Any other text is kept in your note as written.
            </Text>
            <View style={styles.chipRow}>
              {WEEKDAY_SUGGESTIONS.map((day) => {
                const selected = dayLabel.trim().toLowerCase() === day.toLowerCase();
                return (
                  <Pressable
                    key={day}
                    onPress={() => setDayLabel(selected ? '' : day)}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Use ${day} as the day label`}
                  >
                    <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{day}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>Exercises</Text>
            {exercises.map((value, index) => (
              <View key={index} style={styles.exerciseRow}>
                <View style={styles.exerciseInputWrap}>
                  <TextInput
                    value={value}
                    onChangeText={(v) => setExerciseAt(index, v)}
                    placeholder="e.g. Bench Press"
                    placeholderTextColor={colors.textMuted}
                    autoCorrect={false}
                    spellCheck={false}
                    style={styles.input}
                    accessibilityLabel={`Exercise ${index + 1} name`}
                  />
                  {verification.nameErrors?.[index] ? (
                    <Text style={styles.rowError}>{verification.nameErrors[index]}</Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => removeExerciseAt(index)}
                  style={styles.removeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove exercise ${index + 1}${value.trim() ? `, ${value.trim()}` : ''}`}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={addExercise}
              style={styles.addRow}
              accessibilityRole="button"
              accessibilityLabel="Add another exercise"
            >
              <Text style={styles.addRowText}>+ Add exercise</Text>
            </Pressable>

            <Text style={[styles.label, styles.labelSpaced]}>This is exactly what will be saved</Text>
            {/* Own horizontal scroller so a long exercise name never forces the
                page to scroll sideways at 320dp. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.previewScroll}
              contentContainerStyle={styles.previewContent}
            >
              <View>
                {previewLines.length > 0 ? previewLines.map((line, idx) => (
                  <Text key={idx} style={styles.previewLine}>{line}</Text>
                )) : (
                  <Text style={styles.previewEmpty}>Add an exercise to see your note.</Text>
                )}
              </View>
            </ScrollView>
            <Text style={styles.hint}>
              No sets are filled in — Kilo never invents a weight or a rep count. Add them yourself as you train.
            </Text>

            {/* One accessible node so a screen reader announces the complete
                consequence of the primary action in a single utterance. */}
            <View style={styles.effects} accessible accessibilityLabel="What this does: saves this routine. It does not change your current routine.">
              <Text style={styles.effectLine}>• Saves this routine</Text>
              <Text style={styles.effectLine}>• Does not change your current routine</Text>
            </View>

            {!trimmedName ? (
              <Text style={styles.blockingReason}>Enter a routine name to save.</Text>
            ) : verification.reason ? (
              <Text style={styles.blockingReason}>{verification.reason}</Text>
            ) : null}
            {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}

            <Button
              onPress={handleSave}
              title={saveError ? 'Try again' : 'Save routine'}
              disabled={!canSave}
              loading={saving}
              loadingTitle="Saving…"
              style={styles.primary}
              accessibilityLabel={saveError ? 'Try again, save routine' : 'Save routine'}
            />
            <Button
              onPress={handleWriteAsText}
              title="Write it as text instead"
              style={styles.secondary}
              textStyle={styles.secondaryText}
              accessibilityLabel="Write it as text instead, opens the plain-text editor"
            />
            <Button
              onPress={handleCancel}
              title="Cancel"
              style={styles.tertiary}
              textStyle={styles.tertiaryText}
              accessibilityLabel="Cancel and discard this draft"
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    maxWidth: 420,
    maxHeight: '100%',
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 20,
  },
  bodyContent: {
    paddingTop: 16,
    paddingBottom: 24,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  labelSpaced: {
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 44,
    fontSize: 16,
    color: colors.text,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: colors.chipBackground,
    borderColor: colors.chipBackground,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  chipTextSelected: {
    color: colors.chipText,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  exerciseInputWrap: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  removeBtn: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  removeBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
  },
  addRow: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  addRowText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  previewScroll: {
    backgroundColor: colors.inputBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  previewContent: {
    padding: 12,
  },
  previewLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  previewEmpty: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  effects: {
    marginTop: 8,
    gap: 4,
  },
  effectLine: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  blockingReason: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: 4,
  },
  saveError: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.error,
    marginTop: 4,
  },
  primary: {
    marginTop: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondary: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  secondaryText: {
    color: colors.accent,
  },
  tertiary: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  tertiaryText: {
    color: colors.textMuted,
  },
});
