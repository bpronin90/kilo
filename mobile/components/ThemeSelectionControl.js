import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../theme/ThemeContext';
import { useKuaTypography } from '../theme/typography';
import { KUA_PALETTES } from '../theme/colors';
import { setThemeSelection } from '../lib/themePreference';
import { TYPOGRAPHY } from '../theme/typography';
import { GEOMETRY } from '../theme/spacing';

// paletteKey mirrors ThemeContext's private themeKey() mapping, duplicated here
// (three entries) rather than exported, so this stays a display-only read of
// the swatch color and never becomes a second source of truth for resolution.
const THEME_OPTIONS = [
  { value: 'hard-court', label: 'Hard Court', a11yLabel: 'Use Hard Court', paletteKey: 'hardCourt' },
  { value: 'clay-court', label: 'Clay Court', a11yLabel: 'Use Clay Court', paletteKey: 'clayCourt' },
  { value: 'grass-court', label: 'Grass Court', a11yLabel: 'Use Grass Court', paletteKey: 'grassCourt' },
];

// Stacked preview rows (#1173): each row shows the palette's own accent as a
// swatch, its full name, and a checkmark when selected. Replaces the wrapping
// pill row, which cramped onto two lines at narrow widths and large font
// scales and read as three co-equal buttons rather than one palette choice
// with three options.
export function ThemeSelectionControl() {
  const { themeSelection, kuaPalette: kua, colors, mode } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(kua, colors, typography), [kua, colors, typography]);

  return (
    <View testID="theme-selection-control" style={styles.section}>
      <Text style={styles.label}>Theme</Text>
      <View style={styles.optionList}>
        {THEME_OPTIONS.map(({ value, label, a11yLabel, paletteKey }) => {
          const selected = themeSelection === value;
          const swatchColor = KUA_PALETTES[paletteKey][mode].primary;
          return (
            <Pressable
              key={value}
              onPress={() => setThemeSelection(value)}
              style={[styles.optionRow, selected && styles.optionRowActive]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={a11yLabel}
            >
              <View style={[styles.swatch, { backgroundColor: swatchColor }]} />
              <Text style={[styles.optionText, selected && styles.optionTextActive]}>{label}</Text>
              {selected ? (
                <MaterialIcons
                  name="check-circle"
                  size={20}
                  color={kua ? kua.primary : colors.accent}
                  accessible={false}
                />
              ) : (
                <View style={styles.checkPlaceholder} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (kua = null, colors = {}, typography = {}) => StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  label: {
    ...(typography['body-lg'] ?? { fontSize: TYPOGRAPHY['body-lg'].fontSize }),
    color: kua ? kua.onSurface : colors.text,
    marginBottom: 10,
  },
  optionList: {
    gap: 8,
  },
  // Each row is its own ≥44dp target (§15), full width so the longest label
  // (Grass Court) never needs to wrap or crowd its neighbors at narrow widths.
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: GEOMETRY['radius-lg'],
    borderWidth: 1,
    gap: 12,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
  },
  optionRowActive: {
    borderColor: kua ? kua.primary : colors.accent,
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: GEOMETRY['radius-full'],
  },
  optionText: {
    flex: 1,
    ...(typography['label-sm'] ?? { fontSize: TYPOGRAPHY['label-sm'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Selected: inherits label-sm metrics but upgrades to label-lg family/weight
  // for a real KUA medium-to-semibold change without hardcoded font names.
  optionTextActive: {
    fontFamily: (typography['label-lg'] ?? {}).fontFamily,
    fontWeight: (typography['label-lg'] ?? {}).fontWeight,
    color: kua ? kua.onSurface : colors.text,
  },
  checkPlaceholder: {
    width: 20,
    height: 20,
  },
});
