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
import { Colors } from '../theme/colors';
import { InputStyle } from './UI';

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

function deriveTitle(detectors, flagged) {
  if (!detectors || detectors.length === 0) return 'You okay?';

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

  const parts = [];

  if (detectors.includes('skipped')) {
    const names = nameList(byReason['skip']);
    parts.push(names ? `${names} skipped` : 'Exercises skipped');
  }

  if (detectors.includes('volume_drop') || detectors.includes('collapse')) {
    const combined = [
      ...(byReason['volume_drop'] || []),
      ...(byReason['collapse'] || []),
    ];
    const unique = [...new Set(combined)];
    const names = nameList(unique);
    parts.push(names ? `Big drop on ${names}` : 'Big volume drop');
  }

  if (detectors.includes('day_skip')) {
    parts.push('Whole day skipped');
  }

  if (parts.length === 0) return 'You okay?';
  return parts.join(' · ') + ' — you okay?';
}

export function SessionCheckInModal({ visible, checkInData, currentId, currentNote, update, onClose, isEdit = false }) {
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

  const handleDismiss = async () => {
    if (isEdit || !checkInData || !currentId) { onClose(); return; }
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const prevCheckins = currentNote?.session_checkins || {};
      const result = await update(currentId, {
        session_checkins: {
          ...prevCheckins,
          [checkInData.sessionIndex]: {
            status: null,
            reasons: [],
            flagged: checkInData.flagged,
            detectors: checkInData.detectors,
            exercises_skipped: checkInData.metrics.exercises_skipped,
            volume_decline_pct: checkInData.metrics.volume_decline_pct,
            responded_at: new Date().toISOString(),
          },
        },
      });
      if (result === false) {
        setSaveError('Could not dismiss — please try again.');
        return;
      }
      onClose();
    } catch (e) {
      setSaveError('Could not dismiss — please try again.');
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
              <Pressable onPress={() => setTier(null)} hitSlop={12} style={styles.backBtn}>
                <MaterialIcons name="arrow-back" size={20} color={Colors.textMuted} />
              </Pressable>
            ) : null}
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={handleDismiss} hitSlop={12} style={styles.closeBtn} disabled={isSaving}>
              <Text style={styles.closeBtnText}>✕</Text>
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
              >
                <Text style={styles.tierBtnText}>I'm okay</Text>
              </Pressable>
              <Pressable
                style={[styles.tierBtn, styles.tierBtnRough]}
                onPress={() => setTier('rough')}
              >
                <Text style={styles.tierBtnText}>Not great</Text>
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
                  >
                    <Text style={[styles.chipText, selectedReasons.has(r) && styles.chipTextSelected]}>
                      {r}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                style={[styles.submitBtn, isSaving && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={isSaving}
              >
                <Text style={styles.submitBtnText}>{isSaving ? 'Saving…' : 'Done'}</Text>
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
                      >
                        <Text style={[styles.chipText, selectedReasons.has(r) && styles.chipTextSelected]}>
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
                          >
                            <Text style={[styles.chipSubText, selectedReasons.has(r) && styles.chipTextSelected]}>
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
                placeholderTextColor={Colors.textMuted}
                value={freeText}
                onChangeText={setFreeText}
                multiline
                maxLength={300}
              />
              <Pressable
                style={[styles.submitBtn, isSaving && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={isSaving}
              >
                <Text style={styles.submitBtnText}>{isSaving ? 'Saving…' : 'Done'}</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(31,26,23,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  overlayTop: {
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  sheet: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
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
    borderBottomColor: Colors.cardBorder,
    gap: 8,
  },
  backBtn: {
    padding: 2,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.roughBackground,
    borderWidth: 1,
    borderColor: Colors.roughBorder,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.roughBorder,
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
    backgroundColor: Colors.chipBackground,
    borderColor: Colors.cardBorder,
  },
  tierBtnRough: {
    backgroundColor: Colors.roughBackground,
    borderColor: Colors.roughBorder,
  },
  tierBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.chipText,
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
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipSub: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  chipSubText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  chipSelected: {
    backgroundColor: Colors.chipBackground,
    borderColor: Colors.accent,
  },
  chipText: {
    fontSize: 14,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: Colors.chipText,
    fontWeight: '700',
  },
  noteInput: {
    ...InputStyle,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: Colors.accent,
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
    color: Colors.textLight,
  },
});
