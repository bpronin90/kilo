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
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';
import { createInputStyle } from './UI';

const REASON_GROUPS = [
  {
    label: 'Fatigue / Recovery',
    reasons: ['Tired', 'Poor sleep', 'Sore', 'Low energy'],
  },
  {
    label: 'Pain / Injury',
    sublabel: 'Side',
    reasons: ['Shoulder', 'Elbow', 'Knee', 'Lower back', 'Hip', 'Wrist', 'Other'],
    subReasons: ['Left', 'Right', 'Both'],
  },
  {
    label: 'Life / Logistics',
    reasons: ['No time', 'Short session', 'Gym busy', 'Traveling'],
  },
  {
    label: 'Illness / Stress',
    reasons: ['Sick', 'Stressed', 'Burned out', 'Low motivation'],
  },
];

const OK_CHIPS = ['No time', 'Short session'];

// The question the title never asks. Kept as a separate node so a screen reader
// announces the observation and the invitation as two utterances, and so no
// title ever ends in a question about the person.
const CHECKIN_SUBTITLE = 'Want to note why?';

// Neutral header for a stored record whose detectors select no title — records
// written before the D10 trigger contract can carry `collapse` or `day_skip`
// alone, and Analytics re-opens them for editing. Those are read-only history,
// so they are rendered, not migrated.
const CHECKIN_FALLBACK_TITLE = 'Session check-in';

// Selects one title by detector NAME (never by array position, so this does not
// couple to detector ordering). `volume_drop` wins when both triggers fired: it
// is the more specific observation — it names the exercises and carries the
// evidence — and one clause keeps the row inside the ~60-character cap that
// still fits beside the back and close controls at large text.
function deriveTitle(detectors, flagged) {
  const fired = detectors || [];

  // Group flagged exercise display names by their reason.
  const byReason = {};
  for (const f of (flagged || [])) {
    for (const r of (f.reasons || [])) {
      if (!byReason[r]) byReason[r] = [];
      byReason[r].push(f.name);
    }
  }

  // Produce a short comma-joined name list capped at 2, with "+N" overflow.
  const nameList = (names) => {
    if (!names || names.length === 0) return null;
    const shown = names.slice(0, 2);
    const rest = names.length - shown.length;
    return shown.join(', ') + (rest > 0 ? ` +${rest}` : '');
  };

  if (fired.includes('volume_drop')) {
    const names = nameList(byReason['volume_drop']);
    return names ? `Lighter than usual — ${names}` : 'Lighter than usual';
  }

  if (fired.includes('skipped')) {
    return 'More skipped than usual';
  }

  return CHECKIN_FALLBACK_TITLE;
}

export function SessionCheckInModal({ visible, checkInData, currentId, currentNote, update, onClose, isEdit = false }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [tier, setTier] = useState(null);
  const [selectedReasons, setSelectedReasons] = useState(new Set());
  const [freeText, setFreeText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!visible) {
      setTier(null);
      setSelectedReasons(new Set());
      setFreeText('');
      setIsSaving(false);
      setSaveError(null);
    } else if (isEdit && checkInData) {
      setTier(checkInData.status ?? null);
      setSelectedReasons(new Set(checkInData.reasons ?? []));
      setFreeText(checkInData.note ?? '');
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleReason = (reason) => {
    setSelectedReasons(prev => {
      const next = new Set(prev);
      if (next.has(reason)) next.delete(reason); else next.add(reason);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!checkInData || !currentId || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const record = {
        status: tier,
        reasons: [...selectedReasons],
        note: freeText.trim() || undefined,
        flagged: checkInData.flagged,
        detectors: checkInData.detectors,
        exercises_skipped: checkInData.metrics.exercises_skipped,
        volume_decline_pct: checkInData.metrics.volume_decline_pct,
        responded_at: (isEdit && checkInData.responded_at) ? checkInData.responded_at : new Date().toISOString(),
      };
      const prevCheckins = currentNote?.session_checkins || {};
      const result = await update(currentId, {
        session_checkins: { ...prevCheckins, [checkInData.sessionIndex]: record },
      });
      if (result === false) {
        setSaveError('Could not save — please try again.');
        return;
      }
      onClose();
    } catch (e) {
      setSaveError('Could not save — please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!checkInData) return null;

  const title = deriveTitle(checkInData.detectors, checkInData.flagged);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <KeyboardAvoidingView
        style={[styles.overlay, tier === 'rough' && styles.overlayTop]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <View
          style={[styles.sheet, tier === 'rough' ? styles.sheetExpanded : styles.sheetBounded]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.header}>
            {tier !== null ? (
              <Pressable
                onPress={() => setTier(null)}
                hitSlop={12}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <MaterialIcons
                  name="arrow-back"
                  size={20}
                  color={colors.textMuted}
                  accessible={false}
                  importantForAccessibility="no"
                />
              </Pressable>
            ) : null}
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{CHECKIN_SUBTITLE}</Text>
            </View>
            {/* Closing here defers, exactly like tapping outside the sheet or
                pressing Android back (both wired to the same `onClose`): it
                never writes a permanent "responded" record, so any answers
                selected so far are simply not saved and the check-in can
                still be asked next time. The only path that ever suppresses
                a session permanently is completing the flow via `Done`. */}
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityLabel="Close"
              accessibilityState={{ disabled: isSaving }}
            >
              <Text style={styles.closeBtnText} accessible={false} importantForAccessibility="no">✕</Text>
            </Pressable>
          </View>

          {saveError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{saveError}</Text>
            </View>
          ) : null}

          {tier === null && (
            <View style={styles.tierRow}>
              <Pressable
                style={[styles.tierBtn, styles.tierBtnOk]}
                onPress={() => setTier('ok')}
                accessibilityRole="button"
                accessibilityLabel="Normal for me"
              >
                <Text style={styles.tierBtnText} accessible={false} importantForAccessibility="no">Normal for me</Text>
              </Pressable>
              <Pressable
                style={[styles.tierBtn, styles.tierBtnRough]}
                onPress={() => setTier('rough')}
                accessibilityRole="button"
                accessibilityLabel="It was a rough one"
              >
                <Text style={styles.tierBtnText} accessible={false} importantForAccessibility="no">It was a rough one</Text>
              </Pressable>
            </View>
          )}

          {tier === 'ok' && (
            <ScrollView
              key="ok"
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.groupLabel}>Anything going on? (optional)</Text>
              <View style={styles.chipRow}>
                {OK_CHIPS.map(r => (
                  <Pressable
                    key={r}
                    style={[styles.chip, selectedReasons.has(r) && styles.chipSelected]}
                    onPress={() => toggleReason(r)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={r}
                    accessibilityState={{ checked: selectedReasons.has(r) }}
                  >
                    <Text
                      style={[styles.chipText, selectedReasons.has(r) && styles.chipTextSelected]}
                      accessible={false}
                      importantForAccessibility="no"
                    >
                      {r}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={[styles.submitBtn, isSaving && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={isSaving}
                accessibilityRole="button"
                accessibilityLabel={isSaving ? 'Saving…' : 'Done'}
                accessibilityState={{ disabled: isSaving }}
              >
                <Text style={styles.submitBtnText} accessible={false} importantForAccessibility="no">{isSaving ? 'Saving…' : 'Done'}</Text>
              </Pressable>
            </ScrollView>
          )}

          {tier === 'rough' && (
            <ScrollView
              key="rough"
              style={[styles.body, styles.bodyExpanded]}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {REASON_GROUPS.map(group => (
                <View key={group.label} style={styles.group}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <View style={styles.chipRow}>
                    {group.reasons.map(r => (
                      <Pressable
                        key={r}
                        style={[styles.chip, selectedReasons.has(r) && styles.chipSelected]}
                        onPress={() => toggleReason(r)}
                        accessibilityRole="checkbox"
                        accessibilityLabel={r}
                        accessibilityState={{ checked: selectedReasons.has(r) }}
                      >
                        <Text
                          style={[styles.chipText, selectedReasons.has(r) && styles.chipTextSelected]}
                          accessible={false}
                          importantForAccessibility="no"
                        >
                          {r}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {group.subReasons && (
                    <View style={styles.subGroup}>
                      <Text style={styles.subGroupLabel}>{group.sublabel}</Text>
                      <View style={styles.chipRow}>
                        {group.subReasons.map(r => (
                          <Pressable
                            key={r}
                            style={[styles.chipSub, selectedReasons.has(r) && styles.chipSelected]}
                            onPress={() => toggleReason(r)}
                            accessibilityRole="checkbox"
                            accessibilityLabel={r}
                            accessibilityState={{ checked: selectedReasons.has(r) }}
                          >
                            <Text
                              style={[styles.chipSubText, selectedReasons.has(r) && styles.chipTextSelected]}
                              accessible={false}
                              importantForAccessibility="no"
                            >
                              {r}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              ))}
              <TextInput
                style={styles.noteInput}
                placeholder="Any other notes… (optional)"
                placeholderTextColor={colors.textMuted}
                value={freeText}
                onChangeText={setFreeText}
                multiline
                maxLength={300}
                accessibilityLabel="Additional notes"
              />
              <Pressable
                style={[styles.submitBtn, isSaving && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={isSaving}
                accessibilityRole="button"
                accessibilityLabel={isSaving ? 'Saving…' : 'Done'}
                accessibilityState={{ disabled: isSaving }}
              >
                <Text style={styles.submitBtnText} accessible={false} importantForAccessibility="no">{isSaving ? 'Saving…' : 'Done'}</Text>
              </Pressable>
            </ScrollView>
          )}
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
  overlayTop: {
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  sheetBounded: {
    maxHeight: '85%',
  },
  sheetExpanded: {
    flex: 1,
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
  backBtn: {
    padding: 2,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '600',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
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
    // Filled error surface paired with `textLight`, matching the
    // cardAccentBg/cardSuccessBg/cardCautionBg convention for WCAG AA 4.5:1
    // contrast on filled tone surfaces (see docs/design-system-map.md).
    color: colors.textLight,
  },
  tierRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
  },
  tierBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  tierBtnOk: {
    backgroundColor: colors.chipBackground,
    borderColor: colors.cardBorder,
  },
  tierBtnRough: {
    backgroundColor: colors.roughBackground,
    borderColor: colors.roughBorder,
  },
  tierBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.chipText,
  },
  body: {
    flexShrink: 1,
  },
  bodyExpanded: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 16,
  },
  group: {
    gap: 8,
  },
  subGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  subGroupLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Both chip sizes grow to the 44dp minimum instead of taking a hitSlop: the
  // rows wrap with an 8dp gap, so a slop that large would overlap the chip on
  // the next line (#904).
  chipSub: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipSubText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.chipBackground,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: colors.chipText,
    fontWeight: '700',
  },
  noteInput: {
    ...createInputStyle(colors),
    minHeight: 72,
    textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onAccent,
  },
});
