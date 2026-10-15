// Editable target weight for the Routine actions plate calculator (#1375).
// The note body no longer hosts per-weight calculator buttons, so this entry
// opens with an empty target the user types in. The fixed-target (Analytics)
// mode never renders this.
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';
import { formatPlateWeight, MAX_WEIGHT } from '../lib/plateMath';
import { kgToLb, lbToKg } from '../lib/units';
import { TYPOGRAPHY } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';

export const EMPTY_TARGET_ENTRY = { text: '', unit: null };

// `entry` = `{ text, unit }`: the exact text typed and the unit it was typed
// in. Returns `{ state: 'empty' | 'invalid' | 'valid', value? }`, where `value`
// is in `unit`. Empty is never zero; anything not a plain positive decimal
// within plate math's bound is invalid.
export function resolveTargetEntry(entry, unit) {
  const raw = (entry?.text ?? '').trim().replace(',', '.');
  if (raw === '') return { state: 'empty' };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(raw)) return { state: 'invalid' };
  const typed = Number(raw);
  if (!Number.isFinite(typed) || typed <= 0 || typed > MAX_WEIGHT) return { state: 'invalid' };
  // Converting from the typed value every time (never from a converted
  // display string) keeps repeated LB/KG switches from drifting, and the
  // unit it was typed in always gets the exact number back.
  if (!entry.unit || entry.unit === unit) return { state: 'valid', value: typed };
  const value = unit === 'kg' ? lbToKg(typed) : kgToLb(typed);
  if (!(value > 0 && value <= MAX_WEIGHT)) return { state: 'invalid' };
  return { state: 'valid', value };
}

// Text shown in the field for the active unit: the typed text verbatim in
// its own unit, otherwise the converted load rounded for display.
export function targetEntryDisplayText(entry, unit) {
  if (!entry?.unit || entry.unit === unit) return entry?.text ?? '';
  const resolved = resolveTargetEntry(entry, unit);
  return resolved.state === 'valid' ? formatPlateWeight(resolved.value) : '';
}

// On an LB/KG switch a valid target carries over as the equivalent load; an
// invalid draft is cleared rather than relabelled in the new unit.
export function targetEntryForUnitChange(entry, nextUnit) {
  const resolved = resolveTargetEntry(entry, nextUnit);
  return resolved.state === 'valid' ? entry : EMPTY_TARGET_ENTRY;
}

export function PlateCalculatorTargetInput({ entry, unit, onChange }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>Target weight ({unit})</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        value={targetEntryDisplayText(entry, unit)}
        onChangeText={(text) => onChange({ text, unit })}
        accessibilityLabel={`Target weight in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
        testID="plate-calculator-target-input"
      />
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  input: {
    minHeight: 44,
    minWidth: 96,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    borderRadius: GEOMETRY['radius-lg'],
    paddingHorizontal: 10,
    textAlign: 'right',
    color: kua ? kua.onSurface : colors.text,
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: TYPOGRAPHY['body-md'].fontSize }),
  },
});
