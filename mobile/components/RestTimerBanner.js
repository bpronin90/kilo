import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';

function formatCountdown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DURATION_PRESETS_SEC = [60, 90, 120, 180];

// Non-modal countdown/done/start surface for the rest timer (#577). Coexists
// with PRMomentBanner and the fatigue check-in modal — never claims modal
// authorization and never dismisses another surface. `showStart` gates the
// idle start row (the current editor session is in edit mode, i.e. there is
// a working set to rest after); it never renders while a timer is already
// running or just finished.
// `startOnly` renders just the idle start row (or nothing while a timer is
// already running/just finished) — used for the contextual instance mounted
// inside the Log editor, next to where sets are logged. The countdown/done
// surface itself is mounted once at the app-shell level (#950 review P1) so
// it stays visible on every tab, not only Log — `startOnly` keeps the two
// instances from ever rendering the same countdown/done UI twice.
export function RestTimerBanner({
  isRunning,
  remainingMs,
  justElapsed,
  backgroundAlertAvailable,
  onCancel,
  onDismissDone,
  onStart,
  showStart = false,
  startOnly = false,
}) {
  const styles = useThemedStyles(createStyles);
  if (startOnly) {
    if (isRunning || justElapsed || !showStart) return null;
  } else if (!isRunning && !justElapsed && !showStart) {
    return null;
  }

  if (!isRunning && !justElapsed && showStart) {
    return (
      <View style={styles.banner} accessibilityRole="summary">
        <Text style={styles.startLabel}>Rest timer</Text>
        {DURATION_PRESETS_SEC.map((sec) => (
          <Pressable
            key={sec}
            onPress={() => onStart?.(sec)}
            hitSlop={6}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel={`Start ${sec} second rest timer`}
          >
            <Text style={styles.actionText}>{sec}s</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.banner} accessibilityRole="summary">
      {isRunning ? (
        <>
          <Text style={styles.countdown}>{formatCountdown(remainingMs)}</Text>
          {!backgroundAlertAvailable && (
            <Text style={styles.warning}>Background alert unavailable</Text>
          )}
          <Pressable
            onPress={onCancel}
            hitSlop={8}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel rest timer"
          >
            <Text style={styles.actionText}>Cancel</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.doneText}>Rest over</Text>
          <Pressable
            onPress={onDismissDone}
            hitSlop={8}
            style={styles.actionBtn}
            accessibilityRole="button"
            accessibilityLabel="Dismiss rest timer done banner"
          >
            <Text style={styles.actionText}>Dismiss</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: colors.panelBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  countdown: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    minWidth: 48,
  },
  startLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  warning: {
    flex: 1,
    fontSize: 11,
    color: colors.textMuted,
  },
  doneText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
  },
  actionBtn: {
    minHeight: 32,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
});
