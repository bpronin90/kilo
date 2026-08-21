// End-recovery-block confirmation modal (#843), replacing the old bare
// `Alert.alert` on `Complete recovery block`. Chrome mirrors
// RecoveryBlockWeekModal.js: transparent fade modal, full scrim, keyboard
// avoidance, bordered 20px-radius sheet capped at 85%, divided header/footer,
// close control, two equal footer buttons.
//
// This is confirmation, not a fresh question (#843): the block's CURRENT
// `include_in_normal_analytics` value is preselected and labelled `Your
// current setting`, and a confirm that does not change it writes nothing.
// Only when the selection differs from the stored value is a write attempted
// — ordered strictly before `completeBlock`, but not transactionally coupled
// to it, so a failed inclusion write never runs completion.

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

export function RecoveryBlockEndModal({
  visible,
  block,
  weekCount = 0,
  blockingMessage = null,
  onSetInclusion,
  onConfirmComplete,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const storedInclusion = block?.include_in_normal_analytics === true;
  const [pendingInclusion, setPendingInclusion] = useState(storedInclusion);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (visible) {
      setPendingInclusion(storedInclusion);
      setSubmitting(false);
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, block?.id]);

  if (!visible) return null;

  const baselineTitle = block?.baseline_note_title || 'Untitled Routine';

  const handleConfirm = async () => {
    if (submitting || blockingMessage) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // The write is ordered before completion, but not coupled to it: a
      // failed inclusion write stops here and completeBlock never runs.
      if (pendingInclusion !== storedInclusion) {
        const inclusionResult = await onSetInclusion({ blockId: block.id, include: pendingInclusion });
        if (!inclusionResult || inclusionResult.ok === false) {
          setSubmitError((inclusionResult && inclusionResult.error) || 'That setting could not be saved.');
          return;
        }
      }
      const completeResult = await onConfirmComplete({ blockId: block.id });
      if (!completeResult || completeResult.ok === false) {
        setSubmitError((completeResult && completeResult.error) || 'This recovery block could not be completed.');
        return;
      }
      onClose();
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
            <Text style={styles.title}>End this recovery block?</Text>
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
            <Text style={styles.summary}>
              {`${baselineTitle} · ${weekCount} ${weekCount === 1 ? 'week' : 'weeks'}${block?.started_at ? ` · started ${new Date(block.started_at).toLocaleDateString()}` : ''}`}
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

            <Text style={styles.kicker}>CONFIRM HOW THESE {weekCount} WEEKS COUNT</Text>

            <Pressable
              onPress={() => setPendingInclusion(false)}
              style={[styles.optionRow, !pendingInclusion && styles.optionRowSelected]}
              accessibilityRole="radio"
              accessibilityLabel="Keep them out of normal analytics"
              accessibilityState={{ checked: !pendingInclusion }}
            >
              <MaterialIcons
                name={!pendingInclusion ? 'radio-button-checked' : 'radio-button-unchecked'}
                size={20}
                color={!pendingInclusion ? colors.accent : colors.textMuted}
                accessible={false}
              />
              <View style={styles.optionInfo}>
                <View style={styles.optionTitleRow}>
                  <Text style={styles.optionTitle}>Keep them out of normal analytics</Text>
                  {!storedInclusion && <Text style={styles.optionCurrent}>Your current setting</Text>}
                </View>
                <Text style={styles.optionCopy}>
                  These weeks stay visible in Recovery Analytics only — classifications, overload
                  signals, Kilo Max, 1K, and Home summaries treat them as if they did not happen.
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => setPendingInclusion(true)}
              style={[styles.optionRow, pendingInclusion && styles.optionRowSelected]}
              accessibilityRole="radio"
              accessibilityLabel="Count them with everything else"
              accessibilityState={{ checked: pendingInclusion }}
            >
              <MaterialIcons
                name={pendingInclusion ? 'radio-button-checked' : 'radio-button-unchecked'}
                size={20}
                color={pendingInclusion ? colors.accent : colors.textMuted}
                accessible={false}
              />
              <View style={styles.optionInfo}>
                <View style={styles.optionTitleRow}>
                  <Text style={styles.optionTitle}>Count them with everything else</Text>
                  {storedInclusion && <Text style={styles.optionCurrent}>Your current setting</Text>}
                </View>
                <Text style={styles.optionCopy}>
                  These weeks are included in normal analytics — classifications, overload signals,
                  Kilo Max, 1K, and Home summaries.
                </Text>
              </View>
            </Pressable>

            <Text style={styles.footnote}>
              You can change this later from Recovery Analytics — this setting never affects the
              notes themselves, which stay fully visible and editable either way.
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
              disabled={submitting || !!blockingMessage}
              style={[styles.footerBtn, styles.footerBtnPrimary, (submitting || !!blockingMessage) && styles.footerBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel={submitting ? 'Ending…' : 'End block'}
              accessibilityState={{ disabled: submitting || !!blockingMessage }}
            >
              <Text style={styles.footerBtnPrimaryText}>{submitting ? 'Ending…' : 'End block'}</Text>
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
  summary: {
    fontSize: 13,
    color: colors.textMuted,
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
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.background,
  },
  optionRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.chipBackground,
  },
  optionInfo: {
    flex: 1,
    gap: 4,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  optionCurrent: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.accent,
  },
  optionCopy: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    marginTop: 2,
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
