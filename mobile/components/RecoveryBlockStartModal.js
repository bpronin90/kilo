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
  AccessibilityInfo,
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
import { useTheme } from '../theme/ThemeContext';
import { createInputStyle } from './UI';
import { MAX_RECOVERY_REASON_LENGTH } from '../lib/data/recoveryBlocks';
import { GEOMETRY, SPACING } from '../theme/spacing';
import { MODAL_SUPPORTED_ORIENTATIONS, dialogWidthStyle } from './adaptiveLayout';

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
  const { colors, kuaPalette: kua, mode: themeMode } = useTheme();
  const styles = React.useMemo(() => createStyles(kua, themeMode, colors), [kua, themeMode, colors]);
  const [reduceMotion, setReduceMotion] = useState(false);

  const [baselineNoteId, setBaselineNoteId] = useState(null);
  const [weekChoice, setWeekChoice] = useState('existing'); // 'existing' | 'new'
  const [weekNoteId, setWeekNoteId] = useState(null);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  // The optional reason (#872). Never gates Confirm and never blocks the flow:
  // a lifter starting a recovery block in the moment should not have to explain
  // themselves first, and the field is editable afterwards from Manage block.
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (!cancelled) setReduceMotion(!!v);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => {
      if (!cancelled) setReduceMotion(!!v);
    });
    return () => { cancelled = true; sub?.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) {
      setBaselineNoteId(null);
      setWeekChoice('existing');
      setWeekNoteId(null);
      setNewNoteTitle('');
      setReason('');
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

  // Gated on the preset itself, not on `mode` (#711). A side is "fixed" only
  // when a note was actually handed in to fix it — opening with no preset (the
  // Recovery entry point) renders the pickers that already existed here, and
  // the preset paths are unchanged. `mode` still distinguishes WHICH side a
  // preset fixes; it just no longer implies that one was supplied.
  const weekNoteFixed = mode === 'note' && !!presetNote;
  const baselineFixed = mode === 'routine' && !!presetNote;

  // Picking a baseline must also retire a Week 1 selection of that same note.
  // `weekChoices` only removes it from the LIST; without this the id stays in
  // state — selected, no longer visible, and no longer clearable — and Confirm
  // submits the same note as both sides, which can then only fail as
  // NOTE_IS_BASELINE after the fact. Only reachable since #711 let both pickers
  // be live at once (before, one side was always fixed by a preset).
  const handleSelectBaseline = (id) => {
    setBaselineNoteId(id);
    setWeekNoteId(prev => (prev === id ? null : prev));
  };

  // Belt and braces alongside the clearing above: the two sides must be
  // distinct, not merely both chosen. Confirm is never enabled for a
  // combination the domain would reject.
  const weekSelectionValid = weekChoice === 'existing'
    ? (!!weekNoteId && weekNoteId !== baselineNoteId)
    : newNoteTitle.trim().length > 0;

  const canConfirm = !blockingMessage && !!baselineNoteId && weekSelectionValid;

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
        // Handed over raw: the domain owns normalization, so a whitespace-only
        // entry becomes "no reason" in exactly one place rather than in every
        // caller that happens to remember to trim.
        reason,
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
    <Modal visible={visible} transparent supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS} animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
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
                <Text style={[styles.optionText, styles.optionTextSelected]}>{presetNote?.title || 'Untitled Routine'}</Text>
              </View>
            ) : baselineChoices.length === 0 ? (
              <Text style={styles.emptyText}>No eligible routine to freeze as a baseline.</Text>
            ) : (
              baselineChoices.map(n => (
                <Pressable
                  key={n.id}
                  onPress={() => handleSelectBaseline(n.id)}
                  style={[styles.optionRow, baselineNoteId === n.id && styles.optionRowSelected]}
                  accessibilityRole="radio"
                  accessibilityLabel={`Use ${n.title || 'Untitled Routine'} as the frozen baseline`}
                  accessibilityState={{ checked: baselineNoteId === n.id }}
                >
                  <Text style={[styles.optionText, baselineNoteId === n.id && styles.optionTextSelected]}>{n.title || 'Untitled Routine'}</Text>
                </Pressable>
              ))
            )}

            <Text style={styles.sectionLabel}>Recovery Week 1</Text>
            {weekNoteFixed ? (
              <View style={[styles.optionRow, styles.optionRowSelected]}>
                <Text style={[styles.optionText, styles.optionTextSelected]}>{presetNote?.title || 'Untitled Routine'}</Text>
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
                        <Text style={[styles.optionText, weekNoteId === n.id && styles.optionTextSelected]}>{n.title || 'Untitled Routine'}</Text>
                      </Pressable>
                    ))
                  )
                ) : (
                  <TextInput
                    style={styles.input}
                    placeholder="Recovery Week 1 note title"
                    placeholderTextColor={kua.onSurfaceVariant}
                    value={newNoteTitle}
                    onChangeText={setNewNoteTitle}
                    accessibilityLabel="Recovery Week 1 note title"
                  />
                )}
              </>
            )}

            {/* Why this block is starting (#872). Last in the sheet and
                explicitly optional: it records context for the lifter's own
                later review and takes no part in the baseline, the week
                sequence, fatigue, or any analytics result. `maxLength` matches
                the domain cap so the field cannot accept text the record would
                silently truncate on save. */}
            <Text style={styles.sectionLabel}>Reason (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. torn hamstring, 8 weeks off"
              placeholderTextColor={kua.onSurfaceVariant}
              value={reason}
              onChangeText={setReason}
              maxLength={MAX_RECOVERY_REASON_LENGTH}
              accessibilityLabel="Reason for this recovery block (optional)"
            />
            <Text style={styles.hintText}>
              Only for your own records. You can add or change this later.
            </Text>
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

const scrim = (mode) => mode === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)';

const createStyles = (kua, mode, colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: scrim(mode),
    justifyContent: 'center',
    paddingHorizontal: SPACING.margin,
  },
  sheet: {
    ...dialogWidthStyle,
    backgroundColor: kua.surfaceCard,
    borderRadius: GEOMETRY['radius-2xl'],
    borderWidth: 1,
    borderColor: kua.surfaceBorder,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING['space-lg'],
    paddingTop: SPACING['space-lg'],
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: kua.surfaceBorder,
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: kua.onSurface,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: kua.onSurfaceVariant,
    fontWeight: '600',
  },
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: SPACING['space-lg'],
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  explainer: {
    fontSize: 13,
    color: kua.onSurfaceVariant,
    marginBottom: 4,
  },
  errorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua.error,
    borderWidth: 1,
    borderColor: kua.error,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textLight,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: kua.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  emptyText: {
    fontSize: 13,
    color: kua.onSurfaceVariant,
  },
  hintText: {
    fontSize: 12,
    color: kua.onSurfaceVariant,
  },
  optionRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua.surfaceBorder,
    backgroundColor: kua.background,
  },
  optionRowSelected: {
    borderColor: kua.primary,
    backgroundColor: kua.primaryContainer,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    color: kua.onSurface,
  },
  optionTextSelected: {
    fontWeight: '800',
    color: kua.primaryOnContainer,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: GEOMETRY['radius-lg'],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: kua.surfaceBorder,
    backgroundColor: kua.background,
  },
  toggleBtnActive: {
    backgroundColor: kua.primary,
    borderColor: kua.primary,
  },
  toggleBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: kua.onSurfaceVariant,
  },
  toggleBtnTextActive: {
    color: kua.onPrimary,
  },
  input: {
    ...createInputStyle({ inputBackground: kua.background, inputBorder: kua.surfaceBorder, text: kua.onSurface }),
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: SPACING['space-lg'],
    borderTopWidth: 1,
    borderTopColor: kua.surfaceBorder,
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: GEOMETRY['radius-xl'],
    alignItems: 'center',
  },
  footerBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: kua.surfaceBorder,
  },
  footerBtnSecondaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: kua.onSurfaceVariant,
  },
  footerBtnPrimary: {
    backgroundColor: kua.primary,
  },
  footerBtnDisabled: {
    opacity: 0.5,
  },
  footerBtnPrimaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: kua.onPrimary,
  },
});
