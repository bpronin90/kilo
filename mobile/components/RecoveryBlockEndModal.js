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
  AccessibilityInfo,
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
import { useTheme } from '../theme/ThemeContext';
import { RECOVERY_INCLUSION_HELP } from './RecoveryInclusionToggle';
import { GEOMETRY, SPACING } from '../theme/spacing';
import { MODAL_SUPPORTED_ORIENTATIONS, dialogWidthStyle } from './adaptiveLayout';

export function RecoveryBlockEndModal({
  visible,
  block,
  // The block's own live weeks, oldest first (LogScreen passes
  // `orderedLiveWeeks`) — used to state the summary's first-to-last date
  // range, not just a single "started" date.
  weeks = [],
  blockingMessage = null,
  onSetInclusion,
  onConfirmComplete,
  onClose,
}) {
  const { colors, kuaPalette: kua, mode } = useTheme();
  const styles = React.useMemo(() => createStyles(kua, mode, colors), [kua, mode, colors]);
  const [reduceMotion, setReduceMotion] = useState(false);

  const storedInclusion = block?.include_in_normal_analytics === true;
  const [pendingInclusion, setPendingInclusion] = useState(storedInclusion);
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
    if (visible) {
      setPendingInclusion(storedInclusion);
      setSubmitting(false);
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, block?.id]);

  if (!visible) return null;

  const baselineTitle = block?.baseline_note_title || 'Untitled Routine';
  const weekCount = weeks.length;
  // First-to-last date range (review finding): the block's own `started_at`
  // is the first date, and the most recently added live week's `saved_at` is
  // the last — falling back to a single date when there is only one week (or
  // none yet), rather than printing a redundant one-day "range".
  const firstDateVal = block?.started_at || weeks[0]?.saved_at || null;
  const lastDateVal = weeks.length ? weeks[weeks.length - 1].saved_at : firstDateVal;
  const firstDate = firstDateVal ? new Date(firstDateVal).toLocaleDateString() : null;
  const lastDate = lastDateVal ? new Date(lastDateVal).toLocaleDateString() : null;
  const dateRangeText = firstDate
    ? (lastDate && lastDate !== firstDate ? `${firstDate}–${lastDate}` : firstDate)
    : null;

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
    <Modal visible={visible} transparent supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS} animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose}>
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
              {`${baselineTitle} · ${weekCount} ${weekCount === 1 ? 'week' : 'weeks'}${dateRangeText ? ` · ${dateRangeText}` : ''}`}
            </Text>
            <Text style={styles.assurance}>
              The baseline routine and every week's note are untouched — this only changes how
              these weeks count in analytics.
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
                color={!pendingInclusion ? kua.primary : kua.onSurfaceVariant}
                accessible={false}
              />
              <View style={styles.optionInfo}>
                <View style={styles.optionTitleRow}>
                  <Text style={[styles.optionTitle, !pendingInclusion && styles.optionTitleSelected]}>Keep them out of normal analytics</Text>
                  {!storedInclusion && <Text style={styles.optionCurrent}>Your current setting</Text>}
                </View>
                <Text style={styles.optionCopy}>
                  Off (the default) keeps them out of normal analytics — classifications, overload
                  signals, Kilo Max, 1K, and Home summaries.
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
                color={pendingInclusion ? kua.primary : kua.onSurfaceVariant}
                accessible={false}
              />
              <View style={styles.optionInfo}>
                <View style={styles.optionTitleRow}>
                  <Text style={[styles.optionTitle, pendingInclusion && styles.optionTitleSelected]}>Count them with everything else</Text>
                  {storedInclusion && <Text style={styles.optionCurrent}>Your current setting</Text>}
                </View>
                <Text style={styles.optionCopy}>
                  This block's linked recovery notes are included in normal analytics —
                  classifications, overload signals, Kilo Max, 1K, and Home summaries.
                </Text>
              </View>
            </Pressable>

            {/* The Recovery Analytics editability footnote (#843): the exact
                closing assurance `RECOVERY_INCLUSION_HELP` already gives this
                same setting on Log and Analytics, so the wording matches
                everywhere it appears rather than paraphrasing it here. */}
            <Text style={styles.footnote}>
              {RECOVERY_INCLUSION_HELP.slice(RECOVERY_INCLUSION_HELP.indexOf('Either way'))}
              {' '}You can change this later from Recovery Analytics.
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
  summary: {
    fontSize: 13,
    color: kua.onSurfaceVariant,
  },
  assurance: {
    fontSize: 12,
    lineHeight: 17,
    color: kua.onSurfaceVariant,
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
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    color: kua.onSurfaceVariant,
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
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua.surfaceBorder,
    backgroundColor: kua.background,
  },
  optionRowSelected: {
    borderColor: kua.primary,
    backgroundColor: kua.primaryContainer,
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
    color: kua.onSurface,
  },
  optionTitleSelected: {
    fontWeight: '800',
    color: kua.primaryOnContainer,
  },
  optionCurrent: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: kua.primaryOnContainer,
  },
  optionCopy: {
    fontSize: 12,
    lineHeight: 17,
    color: kua.onSurfaceVariant,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 17,
    color: kua.onSurfaceVariant,
    marginTop: 2,
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
