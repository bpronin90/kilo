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
import { useThemedStyles } from '../theme/ThemeContext';
import {
  computePlateLoad,
  formatPlateWeight,
  defaultPlateCalculatorProfile,
  normalizePlateCalculatorProfile,
} from '../lib/plateMath';
import { lbToKg } from '../lib/units';
import { loadPlateCalculatorProfile, savePlateCalculatorProfile } from '../storage/entries';
import { MODAL_SUPPORTED_ORIENTATIONS } from './adaptiveLayout';

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
    if (nextUnit === unit) return;
    // #577 review: the unit toggle is reachable while an inventory edit is
    // in progress (it renders above, not inside, the editing branch below).
    // `draft` is seeded from the OLD unit's profile in startEdit() and is
    // never re-seeded on a unit switch, so an edit left open across a
    // switch and then Saved would write the OLD unit's numeric bar/plate
    // values into the NEW unit's profile slot — e.g. a "45" bar weight
    // typed while in lb mode landing in profiles.kg as 45 kg. Switching
    // units always discards any in-progress (unsaved) edit rather than
    // carrying it across, matching "switching unit loads that unit's own
    // saved/default profile" — it never mixes the two.
    setEditing(false);
    setDraft(null);
    // Functional update avoids the closure-captured `profile` from this
    // render going stale relative to any edit that just committed via
    // setProfile in the same interaction.
    setProfile((p) => {
      const next = { ...p, activeUnit: nextUnit };
      savePlateCalculatorProfile(next).catch(() => {});
      return next;
    });
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
    // #577 review (Codex, post-freeze): normalize ONCE, through the exact
    // same normalizePlateCalculatorProfile() the persistence layer already
    // uses, and use that single result for BOTH component state and the
    // save call — never publish the raw, unvalidated draft to state while
    // persistence independently normalizes a second time. Before this fix
    // an empty bar field (`Number('') === 0`, invalid) or an excessive
    // count could leave the open modal showing state that differed from
    // what was actually persisted (and from what reappears after
    // reopening) — normalizePlateCalculatorProfile's existing
    // reject-and-fall-back-to-default behavior on an invalid field now
    // applies identically to what the user sees immediately and to what is
    // stored.
    const rawCandidate = {
      ...profile,
      profiles: {
        ...profile.profiles,
        [unit]: {
          barWeight: Number(draft.barWeight),
          platesPerSide: draft.platesPerSide.map((p) => ({ size: p.size, count: Number(p.count) })),
        },
      },
    };
    const normalized = normalizePlateCalculatorProfile(rawCandidate);
    setProfile(normalized);
    savePlateCalculatorProfile(normalized).catch(() => {});
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
    <Modal visible={visible} transparent supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS} animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
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
            <ScrollView style={styles.viewScroll} contentContainerStyle={styles.body}>
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
            </ScrollView>
          )}

          {editing && (
            <ScrollView
              style={styles.editScroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
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
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Under the production KUA gate (`kua` supplied) the sheet chrome, unit
// toggle, plate rows, inputs, and edit actions resolve through the selected
// court palette; the dim backdrop stays on the court-neutral legacy overlay
// token, and outside the gate (`kua` null — isolated modal tests) every value
// keeps the legacy palette.
const createStyles = (colors, kua = null) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    paddingHorizontal: 16,
    // Short landscape windows (#1126): keep the sheet off the edges and let
    // its body scroll rather than clipping the plate breakdown.
    paddingVertical: 16,
  },
  sheet: {
    backgroundColor: kua ? kua.surfaceCard : colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    maxWidth: 360,
    maxHeight: '100%',
    width: '100%',
    alignSelf: 'center',
  },
  viewScroll: {
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    fontSize: 16,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
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
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  unitToggleActive: {
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    borderColor: kua ? kua.primary : colors.accent,
  },
  unitToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  unitToggleTextActive: {
    color: kua ? kua.primaryOnContainer : colors.chipAccentText,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 10,
  },
  editScroll: {
    maxHeight: '70%',
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  plateBlock: {
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.divider,
  },
  plateBlockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  message: {
    fontSize: 14,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    lineHeight: 20,
  },
  remainder: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  editLink: {
    paddingTop: 6,
  },
  editLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: kua ? kua.primary : colors.accent,
  },
  input: {
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    minWidth: 64,
    textAlign: 'right',
    color: kua ? kua.onSurface : colors.text,
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
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  editActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  editActionTextPrimary: {
    color: kua ? kua.onPrimary : colors.accentText,
  },
});
