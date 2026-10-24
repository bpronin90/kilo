import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { themedStyles, useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { Panel } from '../ui/RedesignPrimitives';

// Redesign v3 Settings layout pieces (#1608; docs/design/app-redesign-v3
// "More"). Settings keeps production's order, labels and controls; these only
// change the presentation to one flat panel per section with hairline-split
// rows (no nested cards). Behaviour stays in SettingsScreen.

// Styles follow useTheme()'s palette, exactly as SettingsScreen's own do, so a
// Light/Dark/court change repaints these rows in the same render.
function useSettingsStyles() {
  const { colors, kuaPalette } = useTheme();
  return themedStyles(createStyles, colors, kuaPalette);
}

// Section label (literal uppercase text, as production has always rendered it)
// over one flat panel.
export function SettingsSection({ label, children, testID }) {
  const styles = useSettingsStyles();
  const typography = useKuaTypography();
  return (
    <View style={styles.section} testID={testID}>
      <Text style={[typography['label-md'], styles.sectionLabel]} accessibilityRole="header">{label}</Text>
      <Panel>{children}</Panel>
    </View>
  );
}

// One padded row: title + optional help on the left, the control on the right
// (or below it when `stacked`). `children` render under the row inside the same
// hairline block, e.g. an inline save-failure banner.
export function SettingRow({ label, help = null, control = null, divider = false, stacked = false, children }) {
  const styles = useSettingsStyles();
  const typography = useKuaTypography();
  return (
    <View style={[styles.block, divider ? styles.divider : null]}>
      <View style={[styles.row, stacked ? styles.rowStacked : null]}>
        <View style={styles.info}>
          <Text style={[styles.label, { fontFamily: typography['headline-sm'].fontFamily }]}>{label}</Text>
          {help ? <Text style={[typography['body-sm'], styles.help]}>{help}</Text> : null}
        </View>
        {control}
      </View>
      {children}
    </View>
  );
}

// Compact segmented control shared by Mode and Weight unit: a labelled
// radiogroup of mutually exclusive radio options (checked/disabled state).
// Each option is a transparent >=44x44dp target holding a compact pill.
export function SegmentedOptions({ options, value, onSelect, disabled = false, label }) {
  const styles = useSettingsStyles();
  const typography = useKuaTypography();
  return (
    <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            disabled={disabled}
            style={styles.segmentTarget}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            accessibilityLabel={option.a11yLabel}
          >
            <View style={[styles.segmentPill, selected && styles.segmentPillActive, disabled && styles.segmentPillDisabled]}>
              <Text style={[typography['label-md'], styles.segmentText, selected && styles.segmentTextActive]}>{option.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export const createStyles = (colors, kua = null) => StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionLabel: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  block: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    lineHeight: 22,
    color: kua ? kua.onSurface : colors.text,
  },
  help: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // flexWrap lets Mode's three labels drop to a second line instead of
  // overflowing the panel under large accessibility font scales (#1173).
  segment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'flex-start',
    gap: 2,
    padding: 2,
    borderRadius: GEOMETRY['radius-lg'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceSection : colors.inputBackground,
  },
  segmentTarget: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Compact: padded, never stretched to the 44dp target height (#1018).
  segmentPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: GEOMETRY['radius-lg'],
  },
  segmentPillActive: {
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  segmentPillDisabled: {
    opacity: 0.5,
  },
  segmentText: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Selected pills are accent-filled, so the label takes the on-accent ink (#689).
  segmentTextActive: {
    color: kua ? kua.onPrimary : colors.onAccent,
  },
});
