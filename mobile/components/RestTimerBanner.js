import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

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
// idle start affordance (the current editor session is in edit mode, i.e.
// there is a working set to rest after); it never renders while a timer is
// already running or just finished.
// `startOnly` renders just the idle start row (or nothing while a timer is
// already running/just finished) — used for the contextual instance mounted
// inside the Log editor, next to where sets are logged. The countdown/done
// surface itself is mounted once at the app-shell level (#950 review P1) so
// it stays visible on every tab, not only Log — `startOnly` keeps the two
// instances from ever rendering the same countdown/done UI twice.
// `compact` (#1006) is the editor-surface form of `startOnly`: a single
// stopwatch icon that lives in a corner of the current-routine editor and
// expands the four duration choices in place on tap, instead of a
// full-width bottom row. It renders nothing while a timer is running or has
// just completed and nothing when `showStart` is false, so it never reserves
// banner height or bottom-navigation clearance.
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
  compact = false,
  // #577 review: applied to the root View only when something actually
  // renders, so a caller reserving tab-bar/safe-area clearance (App.js)
  // never consumes that space while the component is idle (returns null).
  style,
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [expanded, setExpanded] = React.useState(false);

  const idleStart = !isRunning && !justElapsed && showStart;

  // Collapse the chooser whenever the idle-start state goes away — a timer
  // starts, or the user leaves the current-routine edit state. On the next
  // return to edit the control is closed again.
  React.useEffect(() => {
    if (!idleStart) setExpanded(false);
  }, [idleStart]);

  if (compact) {
    if (!idleStart) return null;
    return (
      <View style={[styles.compactWrap, style]}>
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={styles.compactToggle}
          accessibilityRole="button"
          accessibilityLabel="Rest timer"
          accessibilityState={{ expanded }}
        >
          <MaterialIcons name="timer" size={22} color={colors.accent} accessible={false} />
        </Pressable>
        {expanded && (
          <View style={styles.compactChooser} accessibilityRole="menu">
            {DURATION_PRESETS_SEC.map((sec) => (
              <Pressable
                key={sec}
                onPress={() => {
                  onStart?.(sec);
                  setExpanded(false);
                }}
                style={styles.compactChoiceBtn}
                accessibilityRole="button"
                accessibilityLabel={`Start ${sec} second rest timer`}
              >
                <Text style={styles.actionText}>{sec}s</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }

  if (startOnly) {
    if (isRunning || justElapsed || !showStart) return null;
  } else if (!isRunning && !justElapsed && !showStart) {
    return null;
  }

  if (!isRunning && !justElapsed && showStart) {
    return (
      <View style={[styles.banner, style]} accessibilityRole="summary">
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
    <View style={[styles.banner, style]} accessibilityRole="summary">
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
  // #1006: the collapsed control is self-sized and right-aligned so it sits
  // in the top corner of the editor content without stretching to a
  // full-width row or reserving vertical space of its own.
  compactWrap: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    gap: 8,
  },
  compactToggle: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.chipBackground,
  },
  // The chooser opens beneath the icon, inside the editor's scrollable
  // content — never over the bottom navigation.
  compactChooser: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    columnGap: 8,
    rowGap: 8,
  },
  compactChoiceBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.chipBackground,
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
