import React from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles } from '../theme/ThemeContext';

function formatCountdown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DURATION_PRESETS_SEC = [60, 90, 120, 180];

// Non-modal rest-timer surface (#577, redesigned in #1026). One coherent
// control across its whole lifecycle:
//
// - `compact` (mounted in the Log editor header, #1006): a single stopwatch
//   button that opens an anchored preset menu (60/90/120/180s). The menu is
//   hosted in a `Modal` so it layers above the editor and is never clipped by
//   the header row's own small bounds, and it is positioned against the
//   button's measured screen rect so it reads as attached, not detached. It
//   renders nothing outside current-routine edit mode or while a timer is
//   running/just finished, and reserves no layout space of its own.
//
// - app-shell instance (mounted once in App.js so it shows on every tab): the
//   running countdown and the completion notice both render as the SAME
//   compact centered pill in the SAME place. Tapping the running pill reveals
//   its Cancel action inline; completion offers Dismiss. Neither is a
//   full-width banner.
//
// It never claims modal authorization for the countdown/completion pill and
// never dismisses another surface. Background notification behavior, timer
// persistence, replacement semantics, and scheduling live in useRestTimer and
// are untouched here.
export function RestTimerBanner({
  isRunning,
  remainingMs,
  justElapsed,
  backgroundAlertAvailable,
  onCancel,
  onDismissDone,
  onStart,
  showStart = false,
  compact = false,
  // Applied to the root only when something actually renders, so a caller
  // reserving tab-bar/safe-area clearance (App.js) never consumes that space
  // while the component is idle (returns null).
  style,
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [expanded, setExpanded] = React.useState(false);
  const [anchor, setAnchor] = React.useState(null);
  const [actionsShown, setActionsShown] = React.useState(false);
  const toggleRef = React.useRef(null);

  const idleStart = !isRunning && !justElapsed && showStart;

  // Collapse the preset menu whenever the idle-start state goes away — a timer
  // starts, or the user leaves the current-routine edit state. On the next
  // return to edit the control is closed again.
  React.useEffect(() => {
    if (!idleStart) setExpanded(false);
  }, [idleStart]);

  // The running pill starts collapsed every time a new timer starts.
  React.useEffect(() => {
    if (!isRunning) setActionsShown(false);
  }, [isRunning]);

  if (compact) {
    if (!idleStart) return null;

    const openMenu = () => {
      const node = toggleRef.current;
      if (node && typeof node.measureInWindow === 'function') {
        node.measureInWindow((x, y, w, h) => {
          const winW = Dimensions.get('window').width;
          setAnchor({
            position: 'absolute',
            top: y + h + 6,
            right: Math.max(8, winW - (x + w)),
          });
        });
      }
      setExpanded(true);
    };

    return (
      <View style={[styles.compactWrap, style]}>
        <Pressable
          ref={toggleRef}
          onPress={() => (expanded ? setExpanded(false) : openMenu())}
          style={styles.compactToggle}
          accessibilityRole="button"
          accessibilityLabel="Rest timer"
          accessibilityState={{ expanded }}
        >
          <MaterialIcons name="timer" size={22} color={colors.accent} accessible={false} />
        </Pressable>
        <Modal
          visible={expanded}
          transparent
          animationType="fade"
          onRequestClose={() => setExpanded(false)}
        >
          <View style={styles.menuRoot}>
            {/* Sibling scrim BEHIND the menu, not its parent: an accessible
                Pressable wrapping the menu would group the preset items into
                one TalkBack element. Non-accessible here; TalkBack users
                dismiss with the back gesture (onRequestClose) or by choosing
                a preset. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setExpanded(false)}
              accessible={false}
              importantForAccessibility="no"
            />
            <View style={[styles.compactChooser, anchor]} accessibilityRole="menu">
              {DURATION_PRESETS_SEC.map((sec) => (
                <Pressable
                  key={sec}
                  onPress={() => {
                    onStart?.(sec);
                    setExpanded(false);
                  }}
                  style={styles.compactChoiceBtn}
                  accessibilityRole="menuitem"
                  accessibilityLabel={`Start ${sec} second rest timer`}
                >
                  <Text style={styles.choiceText}>{sec}s</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // App-shell instance: nothing to show until a timer is running or has just
  // finished.
  if (!isRunning && !justElapsed) return null;

  if (isRunning) {
    return (
      <View style={[styles.pillOuter, style]} pointerEvents="box-none">
        <View style={styles.pill}>
          <Pressable
            onPress={() => setActionsShown((v) => !v)}
            hitSlop={6}
            style={styles.pillMain}
            accessibilityRole="button"
            accessibilityLabel={`Rest timer, ${formatCountdown(remainingMs)} remaining`}
            accessibilityHint="Shows the cancel action"
            accessibilityState={{ expanded: actionsShown }}
          >
            <MaterialIcons name="timer" size={16} color={colors.text} accessible={false} />
            <Text style={styles.countdown}>{formatCountdown(remainingMs)}</Text>
          </Pressable>
          {!backgroundAlertAvailable && (
            <Text style={styles.warning}>Background alert unavailable</Text>
          )}
          {actionsShown && (
            <Pressable
              onPress={onCancel}
              hitSlop={8}
              style={styles.pillAction}
              accessibilityRole="button"
              accessibilityLabel="Cancel rest timer"
            >
              <Text style={styles.actionText}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.pillOuter, style]} pointerEvents="box-none">
      <View style={styles.pill} accessibilityRole="summary">
        <MaterialIcons name="check-circle" size={16} color={colors.success} accessible={false} />
        <Text style={styles.doneText}>Rest over</Text>
        <Pressable
          onPress={onDismissDone}
          hitSlop={8}
          style={styles.pillAction}
          accessibilityRole="button"
          accessibilityLabel="Dismiss rest timer done banner"
        >
          <Text style={styles.actionText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  // The collapsed compact control is just the icon button; the wrapper adds no
  // size of its own and only anchors the (Modal-hosted) menu.
  compactWrap: {
    position: 'relative',
  },
  compactToggle: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.chipBackground,
  },
  // Full-screen host inside the Modal: a scrim and the anchored menu as
  // siblings.
  menuRoot: {
    flex: 1,
  },
  // Anchored against the stopwatch button's measured screen rect (see
  // `openMenu`); the fixed fallback here only applies if measurement is
  // unavailable. Solid card surface + border + elevation so it reads as one
  // control with the button rather than a floating slab.
  compactChooser: {
    position: 'absolute',
    top: 96,
    right: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    columnGap: 8,
    rowGap: 8,
    maxWidth: 240,
    padding: 8,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    elevation: 8,
    shadowColor: colors.shadowColor,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
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
  choiceText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  // App-shell running / completion pill. `pillOuter` is a full-width flow item
  // that only centers the pill; `box-none` keeps the empty space beside it
  // from intercepting touches meant for content or the tab bar.
  pillOuter: {
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 10,
    rowGap: 4,
    maxWidth: '92%',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.panelBackground,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    elevation: 6,
    shadowColor: colors.shadowColor,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  pillMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
  },
  pillAction: {
    minHeight: 32,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  countdown: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    minWidth: 44,
    textAlign: 'center',
  },
  warning: {
    fontSize: 11,
    color: colors.textMuted,
  },
  doneText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.success,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
});
