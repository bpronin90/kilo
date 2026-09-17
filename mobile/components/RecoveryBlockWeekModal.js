// Recovery Block Week 2+ attach flow (#696): create a new ordinary note or
// attach an eligible existing note as the next sequential week of an already
// -active block. Mirrors RecoveryBlockStartModal's existing/new toggle, but
// there is no baseline choice here — the block and its baseline are fixed, and
// the week number is assigned by the domain, never chosen here.

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
import { GEOMETRY, SPACING } from '../theme/spacing';

export function RecoveryBlockWeekModal({
  visible,
  weekNumber,
  eligibleWeekNotes = [],
  blockingMessage = null,
  onConfirm,
  onClose,
}) {
  const { colors, kuaPalette: kua, mode } = useTheme();
  const styles = React.useMemo(() => createStyles(kua, mode, colors), [kua, mode, colors]);
  const [reduceMotion, setReduceMotion] = useState(false);

  const [weekChoice, setWeekChoice] = useState('existing'); // 'existing' | 'new'
  const [weekNoteId, setWeekNoteId] = useState(null);
  const [newNoteTitle, setNewNoteTitle] = useState('');
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
      setWeekChoice('existing');
      setWeekNoteId(null);
      setNewNoteTitle('');
      setSubmitting(false);
      setSubmitError(null);
    }
  }, [visible]);

  if (!visible) return null;

  const canConfirm = !blockingMessage && (
    (weekChoice === 'existing' && !!weekNoteId) ||
    (weekChoice === 'new' && newNoteTitle.trim().length > 0)
  );

  const handleConfirm = async () => {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await onConfirm({
        weekChoice,
        weekNoteId: weekChoice === 'existing' ? weekNoteId : null,
        newNoteTitle: weekChoice === 'new' ? newNoteTitle.trim() : null,
      });
      if (!result || result.ok === false) {
        setSubmitError((result && result.error) || 'Could not add the next recovery week.');
        return;
      }
      onClose();
    } catch (e) {
      setSubmitError(e?.message || 'Could not add the next recovery week.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = weekNumber != null ? `Add Recovery Week ${weekNumber}` : 'Add the next recovery week';

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
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

            <View style={styles.toggleRow}>
              <Pressable
                onPress={() => setWeekChoice('existing')}
                style={[styles.toggleBtn, weekChoice === 'existing' && styles.toggleBtnActive]}
                accessibilityRole="radio"
                accessibilityLabel="Use an existing unlinked note as this week"
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
                accessibilityLabel="Create a new note as this week"
                accessibilityState={{ checked: weekChoice === 'new' }}
              >
                <Text style={[styles.toggleBtnText, weekChoice === 'new' && styles.toggleBtnTextActive]}>
                  New note
                </Text>
              </Pressable>
            </View>

            {weekChoice === 'existing' ? (
              eligibleWeekNotes.length === 0 ? (
                <Text style={styles.emptyText}>No eligible unlinked note to attach.</Text>
              ) : (
                eligibleWeekNotes.map(n => (
                  <Pressable
                    key={n.id}
                    onPress={() => setWeekNoteId(n.id)}
                    style={[styles.optionRow, weekNoteId === n.id && styles.optionRowSelected]}
                    accessibilityRole="radio"
                    accessibilityLabel={`Use ${n.title || 'Untitled Routine'} as this recovery week`}
                    accessibilityState={{ checked: weekNoteId === n.id }}
                  >
                    <Text style={[styles.optionText, weekNoteId === n.id && styles.optionTextSelected]}>{n.title || 'Untitled Routine'}</Text>
                  </Pressable>
                ))
              )
            ) : (
              <TextInput
                style={styles.input}
                placeholder="Recovery week note title"
                placeholderTextColor={kua.onSurfaceVariant}
                value={newNoteTitle}
                onChangeText={setNewNoteTitle}
                accessibilityLabel="Recovery week note title"
              />
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
              accessibilityLabel={submitting ? 'Adding…' : 'Confirm and add recovery week'}
              accessibilityState={{ disabled: !canConfirm || submitting }}
            >
              <Text style={styles.footerBtnPrimaryText}>{submitting ? 'Adding…' : 'Confirm'}</Text>
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
  emptyText: {
    fontSize: 13,
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
