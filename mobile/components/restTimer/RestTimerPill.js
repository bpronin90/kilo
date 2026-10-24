// Redesign v3 app-shell rest-timer pill (#1607, extracted from
// RestTimerBanner). The running countdown and the completion notice share one
// centered pill in one place, each with its action always visible (Cancel
// while running, Dismiss when done). Presentation only.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { TYPOGRAPHY } from '../../theme/typography';
import { formatCountdown } from './RestTimerPresetPanel';

export function RestTimerPill({ isRunning, remainingMs, backgroundAlertAvailable, onCancel, onDismissDone, style }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = React.useMemo(() => createStyles(kua, colors), [kua, colors]);
  if (isRunning) {
    return (
      <View style={[styles.pillOuter, style]} pointerEvents="box-none">
        <View style={styles.pill} testID="rest-timer-pill">
          <View style={styles.pillMain} accessible accessibilityRole="timer" accessibilityLabel={`Rest timer, ${formatCountdown(remainingMs)} remaining`}>
            <MaterialIcons name="timer" size={20} color={kua.primary} accessible={false} />
            <Text style={styles.countdown}>{formatCountdown(remainingMs)}</Text>
          </View>
          {!backgroundAlertAvailable && <Text style={styles.warning}>Background alert unavailable</Text>}
          <Pressable onPress={onCancel} hitSlop={8} style={styles.pillAction} accessibilityRole="button" accessibilityLabel="Cancel rest timer">
            <Text style={styles.actionText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.pillOuter, style]} pointerEvents="box-none">
      <View style={styles.pill} accessibilityRole="summary" testID="rest-timer-pill">
        <MaterialIcons name="check-circle" size={20} color={kua.success} accessible={false} />
        <Text style={styles.doneText}>Rest over</Text>
        <Pressable onPress={onDismissDone} hitSlop={8} style={styles.pillAction} accessibilityRole="button" accessibilityLabel="Dismiss rest timer done banner">
          <Text style={styles.actionText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

// `pillOuter` is a full-width flow item that only centers the pill;
// `box-none` keeps the space beside it from intercepting touches.
const createStyles = (kua, colors) => StyleSheet.create({
  pillOuter: { alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center',
    columnGap: 12, rowGap: 4, maxWidth: '92%', paddingVertical: 6, paddingLeft: 16, paddingRight: 8,
    borderRadius: 999, backgroundColor: kua.surfaceCard, borderWidth: 1.5, borderColor: kua.primary,
    elevation: 6, shadowColor: colors.shadowColor, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  pillMain: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  pillAction: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 999 },
  countdown: { ...TYPOGRAPHY['label-lg'], fontSize: 18, color: kua.onSurface, minWidth: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },
  warning: { fontSize: TYPOGRAPHY['label-sm'].fontSize, color: kua.onSurfaceVariant },
  doneText: { ...TYPOGRAPHY['label-lg'], color: kua.success },
  actionText: { ...TYPOGRAPHY['label-md'], letterSpacing: 1.2, textTransform: 'uppercase', color: kua.primary },
});
