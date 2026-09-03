import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';
import {
  computePlateLoad,
  formatPlateWeight,
  defaultPlateCalculatorProfile,
} from '../lib/plateMath';
import { lbToKg } from '../lib/units';
import { loadPlateCalculatorProfile, savePlateCalculatorProfile } from '../storage/entries';

// Lightweight sheet showing the per-side plate loading for a tapped weight,
// against a persisted, editable lb/kg equipment profile (#577). Follows the
// SessionCheckInModal sheet pattern (transparent fade modal, dimmed
// overlay, bordered card sheet with a header row and ✕ close).
//
// `weightLb` is ALWAYS canonical lb — never a display-converted value (#577
// review). `authoredKg` is the exact value the user typed, passed only when
// the tapped set was itself recorded with an explicit kg marker
// (`converted_from_kg: true`); it is used only as the kg-mode target so an
// authored-in-kg set doesn't round-trip through a canonical-lb conversion,
// and is otherwise ignored.
export function PlateCalculatorModal({ visible, weightLb, authoredKg = null, onClose }) {
  const styles = useThemedStyles(createStyles);
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadPlateCalculatorProfile().then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible) return null;
  if (!profile) return null; // brief load; avoids flashing stale/default math

  const unit = profile.activeUnit;
  const unitProfile = profile.profiles[unit];
  const target = unit === 'kg'
    ? (Number.isFinite(authoredKg) && authoredKg > 0 ? authoredKg : lbToKg(weightLb))
    : weightLb;

  const load = computePlateLoad({
    totalWeight: target,
    barWeight: unitProfile.barWeight,
    platesPerSide: unitProfile.platesPerSide,
  });

  const setUnit = (nextUnit) => {
    setProfile((p) => ({ ...p, activeUnit: nextUnit }));
    savePlateCalculatorProfile({ ...profile, activeUnit: nextUnit }).catch(() => {});
  };

  const startEdit = () => {
    setDraft({
      barWeight: String(unitProfile.barWeight),
      platesPerSide: unitProfile.platesPerSide.map((p) => ({ size: p.size, count: String(p.count) })),
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditing(false);
  };

  const saveEdit = () => {
    const barWeight = Number(draft.barWeight);
    const platesPerSide = draft.platesPerSide
      .map((p) => ({ size: p.size, count: Number(p.count) }))
      .filter((p) => Number.isInteger(p.count) && p.count >= 0);
    const nextProfile = {
      ...profile,
      profiles: { ...profile.profiles, [unit]: { barWeight, platesPerSide } },
    };
    setProfile(nextProfile);
    savePlateCalculatorProfile(nextProfile).catch(() => {});
    setDraft(null);
    setEditing(false);
  };

  const resetDefault = () => {
    const defaults = defaultPlateCalculatorProfile();
    const nextProfile = { ...profile, profiles: { ...profile.profiles, [unit]: defaults.profiles[unit] } };
    setProfile(nextProfile);
    savePlateCalculatorProfile(nextProfile).catch(() => {});
    setDraft(null);
    setEditing(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title}>
              Plates for {formatPlateWeight(target)} {unit}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close plate calculator"
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.unitToggleRow}>
            {['lb', 'kg'].map((u) => (
              <Pressable
                key={u}
                onPress={() => setUnit(u)}
                style={[styles.unitToggle, unit === u && styles.unitToggleActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: unit === u }}
                accessibilityLabel={`Use ${u} bar and plates`}
              >
                <Text style={[styles.unitToggleText, unit === u && styles.unitToggleTextActive]}>
                  {u.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          {!editing && (
            <View style={styles.body}>
              {!load.valid && (
                <Text style={styles.message}>No plate math for this weight.</Text>
              )}

              {load.valid && load.belowBar && (
                <Text style={styles.message}>
                  Below the {formatPlateWeight(load.barWeight)} {unit} bar — no plates needed.
                </Text>
              )}

              {load.valid && !load.belowBar && (
                <>
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>Bar</Text>
                    <Text style={styles.rowValue}>{formatPlateWeight(load.barWeight)} {unit}</Text>
                  </View>

                  {load.plates.length === 0 && load.remainder === 0 && (
                    <Text style={styles.message}>Empty bar — no plates.</Text>
                  )}

                  {load.plates.length > 0 && (
                    <View style={styles.plateBlock}>
                      <Text style={styles.plateBlockLabel}>Per side</Text>
                      {load.plates.map(p => (
                        <View key={p.size} style={styles.row}>
                          <Text style={styles.rowLabel}>{formatPlateWeight(p.size)} {unit}</Text>
                          <Text style={styles.rowValue}>× {p.count}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {load.remainder > 0 && (
                    <Text style={styles.remainder}>
                      {formatPlateWeight(load.remainder)} {unit} per side can't be loaded with this inventory.
                    </Text>
                  )}
                </>
              )}

              <Pressable onPress={startEdit} style={styles.editLink} accessibilityRole="button">
                <Text style={styles.editLinkText}>
                  Edit {unit} bar &amp; inventory
                </Text>
              </Pressable>
            </View>
          )}

          {editing && (
            <View style={styles.body}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Bar weight ({unit})</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={draft.barWeight}
                  onChangeText={(v) => setDraft((d) => ({ ...d, barWeight: v }))}
                  accessibilityLabel={`Bar weight in ${unit}`}
                />
              </View>
              {draft.platesPerSide.map((p, i) => (
                <View key={p.size} style={styles.row}>
                  <Text style={styles.rowLabel}>{formatPlateWeight(p.size)} {unit} × per side</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={p.count}
                    onChangeText={(v) => setDraft((d) => {
                      const platesPerSide = [...d.platesPerSide];
                      platesPerSide[i] = { ...platesPerSide[i], count: v };
                      return { ...d, platesPerSide };
                    })}
                    accessibilityLabel={`${formatPlateWeight(p.size)} ${unit} plates available per side`}
                  />
                </View>
              ))}
              <View style={styles.editActionsRow}>
                <Pressable onPress={resetDefault} style={styles.editActionBtn} accessibilityRole="button">
                  <Text style={styles.editActionText}>Reset to default</Text>
                </Pressable>
                <Pressable onPress={cancelEdit} style={styles.editActionBtn} accessibilityRole="button">
                  <Text style={styles.editActionText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={saveEdit} style={[styles.editActionBtn, styles.editActionBtnPrimary]} accessibilityRole="button">
                  <Text style={[styles.editActionText, styles.editActionTextPrimary]}>Save</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
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
    maxWidth: 360,
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
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: '600',
  },
  unitToggleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  unitToggle: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  unitToggleActive: {
    backgroundColor: colors.chipBackground,
    borderColor: colors.accent,
  },
  unitToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  unitToggleTextActive: {
    color: colors.chipAccentText,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  plateBlock: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  plateBlockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  message: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
  remainder: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  editLink: {
    paddingTop: 6,
  },
  editLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    minWidth: 64,
    textAlign: 'right',
    color: colors.text,
    fontSize: 14,
  },
  editActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 8,
  },
  editActionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  editActionBtnPrimary: {
    backgroundColor: colors.accent,
  },
  editActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  editActionTextPrimary: {
    color: colors.accentText,
  },
});
