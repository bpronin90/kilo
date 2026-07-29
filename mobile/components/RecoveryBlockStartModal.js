// Recovery Block start flow (#695): confirm a frozen baseline routine and a
// Recovery Week 1 note, then create the block. Stops after Week 1 — no
// completion, no week 2+, no browsing, no analytics.
//
// Structural only: every selectable note here already passed
// isEligibleBaselineNote/isEligibleRecoveryWeekNote (hooks/entries/
// recoveryBlockHooks.js) upstream in LogScreen. This component never inspects
// note titles/dates/content to decide eligibility itself.

import React, { useEffect, useState } from 'react';
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
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { createInputStyle } from './UI';

export function RecoveryBlockStartModal({
  visible,
  mode, // 'routine' (baseline preset) | 'note' (week-1 preset)
  presetNote,
  eligibleBaselineNotes = [],
  eligibleWeekNotes = [],
  blockingMessage = null,
  onConfirm,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [baselineNoteId, setBaselineNoteId] = useState(null);
  const [weekChoice, setWeekChoice] = useState('existing'); // 'existing' | 'new'
  const [weekNoteId, setWeekNoteId] = useState(null);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!visible) {
      setBaselineNoteId(null);
      setWeekChoice('existing');
      setWeekNoteId(null);
      setNewNoteTitle('');
      setSubmitting(false);
      setSubmitError(null);
      return;
    }
    if (mode === 'routine' && presetNote) {
      setBaselineNoteId(presetNote.id);
      setWeekChoice('existing');
      setWeekNoteId(null);
    } else if (mode === 'note' && presetNote) {
      setBaselineNoteId(null);
      setWeekChoice('existing');
      setWeekNoteId(presetNote.id);
    }
  }, [visible, mode, presetNote]);

  if (!visible) return null;

  // In 'note' mode the preset note is already fixed as Week 1, so it can
  // never also be offered as the baseline — picking it would only surface as
  // a NOTE_IS_BASELINE failure after Confirm instead of being excluded here.
  const baselineChoices = mode === 'note' && presetNote
    ? eligibleBaselineNotes.filter(n => n.id !== presetNote.id)
    : eligibleBaselineNotes;
  // A note picked as baseline can never also be the week-1 note.
  const weekChoices = eligibleWeekNotes.filter(n => n.id !== baselineNoteId);

  const weekNoteFixed = mode === 'note';
  const baselineFixed = mode === 'routine';

  const canConfirm = !blockingMessage && !!baselineNoteId && (
    (weekChoice === 'existing' && !!weekNoteId) ||
    (weekChoice === 'new' && newNoteTitle.trim().length > 0)
  );

  const handleConfirm = async () => {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await onConfirm({
        baselineNoteId,
        weekChoice,
        weekNoteId: weekChoice === 'existing' ? weekNoteId : null,
        newNoteTitle: weekChoice === 'new' ? newNoteTitle.trim() : null,
      });
      if (!result || result.ok === false) {
        setSubmitError((result && result.error) || 'Could not start the recovery block.');
        return;
      }
      onClose();
    } catch (e) {
      // onConfirm rejecting (e.g. the new-note write itself failing) must not
      // leave Confirm stuck disabled on "Starting…" with no visible error.
      setSubmitError(e?.message || 'Could not start the recovery block.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title}>Start a recovery block</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.explainer}>
              Your latest completed pre-skip work on the selected baseline routine will be
              frozen for comparison. Recovery weeks are kept out of normal analytics unless
              you opt in later.
            </Text>

            {blockingMessage ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{blockingMessage}</Text>
              </View>
            ) : null}

            {submitError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{submitError}</Text>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>Baseline routine</Text>
            {baselineFixed ? (
              <View style={[styles.optionRow, styles.optionRowSelected]}>
                <Text style={styles.optionText}>{presetNote?.title || 'Untitled Routine'}</Text>
              </View>
            ) : baselineChoices.length === 0 ? (
              <Text style={styles.emptyText}>No eligible routine to freeze as a baseline.</Text>
            ) : (
              baselineChoices.map(n => (
                <Pressable
                  key={n.id}
                  onPress={() => setBaselineNoteId(n.id)}
                  style={[styles.optionRow, baselineNoteId === n.id && styles.optionRowSelected]}
                  accessibilityRole="radio"
                  accessibilityLabel={`Use ${n.title || 'Untitled Routine'} as the frozen baseline`}
                  accessibilityState={{ checked: baselineNoteId === n.id }}
                >
                  <Text style={styles.optionText}>{n.title || 'Untitled Routine'}</Text>
                </Pressable>
              ))
            )}

            <Text style={styles.sectionLabel}>Recovery Week 1</Text>
            {weekNoteFixed ? (
              <View style={[styles.optionRow, styles.optionRowSelected]}>
                <Text style={styles.optionText}>{presetNote?.title || 'Untitled Routine'}</Text>
              </View>
            ) : (
              <>
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setWeekChoice('existing')}
                    style={[styles.toggleBtn, weekChoice === 'existing' && styles.toggleBtnActive]}
                    accessibilityRole="radio"
                    accessibilityLabel="Use an existing unlinked note as Week 1"
                    accessibilityState={{ checked: weekChoice === 'existing' }}
                  >
                    <Text style={[styles.toggleBtnText, weekChoice === 'existing' && styles.toggleBtnTextActive]}>
                      Existing note
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setWeekChoice('new')}
                    style={[styles.toggleBtn, weekChoice === 'new' && styles.toggleBtnActive]}
                    accessibilityRole="radio"
                    accessibilityLabel="Create a new note as Week 1"
                    accessibilityState={{ checked: weekChoice === 'new' }}
                  >
                    <Text style={[styles.toggleBtnText, weekChoice === 'new' && styles.toggleBtnTextActive]}>
                      New note
                    </Text>
                  </Pressable>
                </View>

                {weekChoice === 'existing' ? (
                  weekChoices.length === 0 ? (
                    <Text style={styles.emptyText}>No eligible unlinked note to use as Week 1.</Text>
                  ) : (
                    weekChoices.map(n => (
                      <Pressable
                        key={n.id}
                        onPress={() => setWeekNoteId(n.id)}
                        style={[styles.optionRow, weekNoteId === n.id && styles.optionRowSelected]}
                        accessibilityRole="radio"
                        accessibilityLabel={`Use ${n.title || 'Untitled Routine'} as Recovery Week 1`}
                        accessibilityState={{ checked: weekNoteId === n.id }}
                      >
                        <Text style={styles.optionText}>{n.title || 'Untitled Routine'}</Text>
                      </Pressable>
                    ))
                  )
                ) : (
                  <TextInput
                    style={styles.input}
                    placeholder="Recovery Week 1 note title"
                    placeholderTextColor={colors.textMuted}
                    value={newNoteTitle}
                    onChangeText={setNewNoteTitle}
                    accessibilityLabel="Recovery Week 1 note title"
                  />
                )}
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              style={[styles.footerBtn, styles.footerBtnSecondary]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.footerBtnSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm || submitting}
              style={[styles.footerBtn, styles.footerBtnPrimary, (!canConfirm || submitting) && styles.footerBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel={submitting ? 'Starting…' : 'Confirm and start recovery block'}
              accessibilityState={{ disabled: !canConfirm || submitting }}
            >
              <Text style={styles.footerBtnPrimaryText}>{submitting ? 'Starting…' : 'Confirm'}</Text>
            </Pressable>
          </View>
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
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    maxHeight: '85%',
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
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '600',
  },
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  explainer: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
  },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.cardErrorBg,
    borderWidth: 1,
    borderColor: colors.cardErrorBg,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textLight,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  optionRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.background,
  },
  optionRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.chipBackground,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.background,
  },
  toggleBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  toggleBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  toggleBtnTextActive: {
    color: colors.onAccent,
  },
  input: {
    ...createInputStyle(colors),
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  footerBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  footerBtnSecondaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
  },
  footerBtnPrimary: {
    backgroundColor: colors.accent,
  },
  footerBtnDisabled: {
    opacity: 0.5,
  },
  footerBtnPrimaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onAccent,
  },
});
