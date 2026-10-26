// Log root-header actions (#1606): the Plates button and the labelled `⋯`
// Routine actions trigger, plus the single sheet/plate-calculator instance they
// open (components/log/LogRoutineActionSheet.js). `actions` is the one
// `useLogRoutineActions` result LogScreen owns; the card shows its status lines.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useKuaStyle, useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import { LogRoutineActionSheet } from '../../components/log/LogRoutineActionSheet';
import { RootHeader } from '../../components/RootHeader';

export function LogRoutineHeaderActions({ actions, style, hostsCalculator = true }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const ink = kua ? kua.onSurface : colors.text;
  return (
    <View style={[styles.row, style]}>
      <LogRoutineActionSheet actions={actions} hostsCalculator={hostsCalculator} />
      <Pressable
        onPress={actions.openPlates}
        style={styles.plates}
        android_ripple={{ color: kua ? kua.selection : colors.chipBackground }}
        accessibilityRole="button"
        accessibilityLabel="Plate calculator"
        accessibilityHint="Enter a target weight to calculate plates"
        testID="log-plate-calculator-button"
      >
        <MaterialIcons name="calculate" size={18} color={ink} accessible={false} />
        <Text style={[typography['label-lg'], styles.platesText]}>Plates</Text>
      </Pressable>
      <Pressable
        onPress={actions.toggleMenu}
        style={styles.more}
        android_ripple={{ color: kua ? kua.selection : colors.chipBackground, borderless: true }}
        accessibilityRole="button"
        accessibilityLabel="Routine actions"
        accessibilityHint="Opens Edit, Copy, Share, Share as Image, and Skip week"
        accessibilityState={{ expanded: actions.menuOpen }}
        testID="log-routine-actions-button"
      >
        <MaterialIcons name="more-horiz" size={26} color={ink} accessible={false} />
      </Pressable>
    </View>
  );
}

// #1650: the note editor's Plates entry, in the editor header beside Done (not
// the tool row, which the rest timer, syntax help and problem badge share).
export function EditorPlatesButton({ onPress }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { colors } = useTheme();
  const kua = useKuaStyle();
  return (
    <Pressable
      onPress={onPress}
      style={styles.plates}
      android_ripple={{ color: kua ? kua.selection : colors.chipBackground }}
      accessibilityRole="button"
      accessibilityLabel="Plate calculator"
      accessibilityHint="Calculate plates without leaving your edit"
      testID="editor-plate-calculator-button"
    >
      <MaterialIcons name="calculate" size={18} color={kua ? kua.onSurface : colors.text} accessible={false} />
      <Text style={[typography['label-lg'], styles.platesText]}>Plates</Text>
    </Pressable>
  );
}

// The Log tab's root header: title "Log", the routine actions (when the
// screen supplies them) and any existing header control (e.g. Done), reporting
// its height so the pinned day index can sit directly beneath it.
export function LogRootHeader({ actions, headerRight, onHeight }) {
  const right = actions || headerRight ? <>{actions}{headerRight || null}</> : null;
  return (
    <View onLayout={(e) => onHeight && onHeight(e.nativeEvent.layout.height)}>
      <RootHeader title="Log" testID="log-root-header" right={right} />
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  plates: {
    minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
    borderRadius: GEOMETRY['radius-lg'], borderWidth: 1, borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  platesText: { textTransform: 'uppercase', letterSpacing: 1, color: kua ? kua.onSurface : colors.text },
  more: { minHeight: 44, minWidth: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
