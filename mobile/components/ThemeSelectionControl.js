import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useKuaTypography } from '../theme/typography';
import { setThemeSelection } from '../lib/themePreference';

const THEME_OPTIONS = [
  { value: 'hard-court', label: 'Hard Court', a11yLabel: 'Use Hard Court' },
  { value: 'clay-court', label: 'Clay Court', a11yLabel: 'Use Clay Court' },
  { value: 'grass-court', label: 'Grass Court', a11yLabel: 'Use Grass Court' },
];

export function ThemeSelectionControl() {
  const { themeSelection, kuaPalette: kua, colors } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(kua, colors, typography), [kua, colors, typography]);

  return (
    <View testID="theme-selection-control" style={styles.row}>
      <View style={styles.labelContainer}>
        <Text style={styles.label}>Court</Text>
      </View>
      <View style={styles.toggle}>
        {THEME_OPTIONS.map(({ value, label, a11yLabel }) => {
          const selected = themeSelection === value;
          return (
            <Pressable
              key={value}
              onPress={() => setThemeSelection(value)}
              style={styles.tab}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={a11yLabel}
            >
              <View style={[styles.pill, selected && styles.pillActive]}>
                <Text style={[styles.tabText, selected && styles.tabTextActive]}>{label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (kua = null, colors = {}, typography = {}) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  labelContainer: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  toggle: {
    flexDirection: 'row',
    gap: 4,
  },
  tab: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
  },
  pillActive: {
    backgroundColor: kua ? kua.primary : colors.accent,
    borderColor: kua ? kua.primary : colors.accent,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '500',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Selected: both color and weight change so the selection is not color-only.
  tabTextActive: {
    color: kua ? kua.onPrimary : colors.onAccent,
    fontWeight: '700',
  },
});
