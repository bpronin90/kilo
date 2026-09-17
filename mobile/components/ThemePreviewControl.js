// Development/device-review control for switching all six theme+appearance
// combinations without source edits or a rebuild (#1105).
//
// This component is intentionally development-only and must not be promoted to
// a production-facing picker. Phase 5 will introduce the real Settings UX.

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { setThemeSelection } from '../lib/themePreference';

const THEME_OPTIONS = [
  { value: 'hard-court', label: 'Hard' },
  { value: 'clay-court', label: 'Clay' },
  { value: 'grass-court', label: 'Grass' },
];

const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemePreviewControl() {
  const { themeSelection, preference: appearance, setPreference: setAppearance } = useTheme();

  return (
    <View testID="theme-preview-control">
      <Text style={styles.devLabel}>DEV — Theme Preview</Text>
      <Text style={styles.sectionLabel}>Court</Text>
      <View style={styles.row}>
        {THEME_OPTIONS.map(({ value, label }) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`Select ${label} court theme`}
            accessibilityState={{ selected: themeSelection === value }}
            onPress={() => setThemeSelection(value)}
            style={[styles.chip, themeSelection === value && styles.chipActive]}
          >
            <Text style={[styles.chipText, themeSelection === value && styles.chipTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.sectionLabel}>Appearance</Text>
      <View style={styles.row}>
        {APPEARANCE_OPTIONS.map(({ value, label }) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityLabel={`Select ${label} appearance`}
            accessibilityState={{ selected: appearance === value }}
            onPress={() => setAppearance(value)}
            style={[styles.chip, appearance === value && styles.chipActive]}
          >
            <Text style={[styles.chipText, appearance === value && styles.chipTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// DEV-only styles — these are intentionally plain literals outside the palette
// system. This component is never migrated to a production theme.
const DEV_ORANGE = '#FF5C00';

const styles = {
  devLabel: { fontSize: 11, fontWeight: '700', color: DEV_ORANGE, marginBottom: 8, letterSpacing: 0.5 },
  sectionLabel: { fontSize: 11, fontWeight: '600', color: 'gray', marginBottom: 4, marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'lightgray',
    backgroundColor: 'transparent',
  },
  chipActive: { borderColor: 'royalblue', backgroundColor: 'aliceblue' },
  chipText: { fontSize: 13, color: 'dimgray' },
  chipTextActive: { color: 'navy', fontWeight: '600' },
};
