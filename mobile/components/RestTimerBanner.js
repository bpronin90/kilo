import React from 'react';
import { AccessibilityInfo, Dimensions, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../theme/ThemeContext';
import { GEOMETRY } from '../theme/spacing';
import { MODAL_SUPPORTED_ORIENTATIONS } from './adaptiveLayout';
import { TYPOGRAPHY } from '../theme/typography';

function formatCountdown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const DURATION_PRESETS_SEC = [60, 90, 120, 180];

// Non-modal rest-timer surface (#577, #1026). One control, one place, every
// state:
//
// - `compact` (docked in the Log editor header, #1006): while current-routine
//   edit is open (`showStart`) the same 44dp control stays mounted through the
//   whole lifecycle — a stopwatch when idle, the live countdown while running,
//   `Rest over` once done. Tapping it opens one anchored panel (a `Modal`, so
//   the header never clips it, positioned against the control's measured rect)
//   holding the presets (start, or restart while running/done) and the state's
//   own Cancel or Dismiss. It reserves no layout space of its own; App.js hides
//   the app-shell pill while this control is docked so the countdown never
//   shows twice.
//
// - app-shell instance (mounted once in App.js so it shows on every tab): the
//   running countdown and the completion notice render as the SAME compact
//   centered pill in the SAME place, each with its action always visible
//   (Cancel while running, Dismiss when done). Neither is a full-width banner.
//
// It never claims modal authorization for the pill and never dismisses another
// surface. Background notification behavior, timer persistence, replacement
// semantics, and scheduling live in useRestTimer and are untouched here.
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
  const { colors, kuaPalette: kua, mode } = useTheme();
  const styles = React.useMemo(() => createStyles(kua, mode, colors), [kua, mode, colors]);
  const [expanded, setExpanded] = React.useState(false);
  const [anchor, setAnchor] = React.useState(null);
  const [reduceMotion, setReduceMotion] = React.useState(false);
  const toggleRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (!cancelled) setReduceMotion(!!v);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => {
      if (!cancelled) setReduceMotion(!!v);
    });
    return () => { cancelled = true; sub?.remove(); };
  }, []);

  // Close the panel when the docked control goes away (the user leaves the
  // current-routine edit state); on the next return it starts closed.
  React.useEffect(() => {
    if (!showStart) setExpanded(false);
  }, [showStart]);

  // The panel is anchored to the toggle's measured window position, which a
  // rotation or window resize invalidates (#1126). Close it instead of leaving
  // it floating at a stale offset; no timer state is lost, only the open panel.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  React.useEffect(() => {
    setExpanded(false);
  }, [windowWidth, windowHeight]);

  if (compact) {
    if (!showStart) return null;
    const phase = isRunning ? 'running' : (justElapsed ? 'done' : 'idle');
    const countdown = formatCountdown(remainingMs);

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
    // A failed background alert is flagged on the closed control itself, not
    // only inside the panel, so it is seen before the user leaves the app.
    const alertMissing = phase === 'running' && !backgroundAlertAvailable;
    const toggleLabel = phase === 'running'
      ? `Rest timer, ${countdown} remaining${alertMissing ? ', background alert unavailable' : ''}`
      : phase === 'done' ? 'Rest timer, rest over' : 'Rest timer';
    const panelCaption = phase === 'running'
      ? 'Resting · tap a time to restart'
      : phase === 'done' ? 'Start another rest' : 'Choose a rest length';

    return (
      <View style={[styles.compactWrap, style]}>
        <Pressable
          ref={toggleRef}
          onPress={() => (expanded ? setExpanded(false) : openMenu())}
          style={[styles.compactToggle, phase !== 'idle' && styles.compactToggleLive]}
          accessibilityRole="button"
          accessibilityLabel={toggleLabel}
          accessibilityState={{ expanded }}
        >
          <MaterialIcons
            name={phase === 'done' ? 'check-circle' : 'timer'}
            size={phase === 'idle' ? 22 : 18}
            color={phase === 'done' ? kua.success : kua.primary}
            accessible={false}
          />
          {phase === 'running' && <Text style={styles.compactCountdown}>{countdown}</Text>}
          {alertMissing && (
            <MaterialIcons name="notifications-off" size={16} color={kua.onSurfaceVariant} accessible={false} testID="rest-timer-alert-unavailable" />
          )}
          {phase === 'done' && <Text style={styles.compactDoneText}>Done</Text>}
        </Pressable>
        <Modal
          visible={expanded}
          transparent
          supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
          animationType={reduceMotion ? 'none' : 'fade'}
          onRequestClose={() => setExpanded(false)}
        >
          <View style={styles.menuRoot}>
            {/* Sibling scrim BEHIND the panel, not its parent: an accessible
                Pressable wrapping the panel would group its items into one
                TalkBack element. Non-accessible here; TalkBack users dismiss
                with the back gesture (onRequestClose) or by choosing an item. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setExpanded(false)}
              accessible={false}
              importantForAccessibility="no"
            />
            <View style={[styles.compactChooser, anchor]} accessibilityRole="menu">
              {/* Header: the state itself, large — the countdown while running. */}
              <View style={styles.panelHeader}>
                {phase === 'running' ? (
                  <Text style={styles.panelCountdown} accessibilityLiveRegion="polite">{countdown}</Text>
                ) : (
                  <Text style={[styles.panelTitle, phase === 'done' && styles.panelTitleDone]} accessibilityLiveRegion="polite">
                    {phase === 'done' ? 'Rest over' : 'Rest timer'}
                  </Text>
                )}
                <Text style={styles.panelCaption}>{panelCaption}</Text>
              </View>
              {alertMissing && (
                <View style={styles.panelWarning}>
                  <MaterialIcons name="notifications-off" size={14} color={kua.onSurfaceVariant} accessible={false} />
                  <Text style={styles.warning}>Background alert unavailable</Text>
                </View>
              )}
              {/* Four equal presets in one row, in the countdown's m:ss format. */}
              <View style={styles.presetRow}>
                {DURATION_PRESETS_SEC.map((sec) => (
                  <Pressable
                    key={sec}
                    onPress={() => {
                      onStart?.(sec);
                      setExpanded(false);
                    }}
                    style={styles.compactChoiceBtn}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`${phase === 'idle' ? 'Start' : 'Restart'} ${sec} second rest timer`}
                  >
                    <Text style={styles.choiceText}>{formatCountdown(sec * 1000)}</Text>
                  </Pressable>
                ))}
              </View>
              {phase !== 'idle' && (
                <Pressable
                  onPress={() => {
                    if (phase === 'running') onCancel?.(); else onDismissDone?.();
                    setExpanded(false);
                  }}
                  style={styles.panelAction}
                  accessibilityRole="menuitem"
                  accessibilityLabel={phase === 'running' ? 'Cancel rest timer' : 'Dismiss rest timer done banner'}
                >
                  <Text style={styles.panelActionText}>{phase === 'running' ? 'Cancel timer' : 'Dismiss'}</Text>
                </Pressable>
              )}
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
          <View
            style={styles.pillMain}
            accessible
            accessibilityRole="timer"
            accessibilityLabel={`Rest timer, ${formatCountdown(remainingMs)} remaining`}
          >
            <MaterialIcons name="timer" size={16} color={kua.onSurface} accessible={false} />
            <Text style={styles.countdown}>{formatCountdown(remainingMs)}</Text>
          </View>
          {!backgroundAlertAvailable && (
            <Text style={styles.warning}>Background alert unavailable</Text>
          )}
          <Pressable
            onPress={onCancel}
            hitSlop={8}
            style={styles.pillAction}
            accessibilityRole="button"
            accessibilityLabel="Cancel rest timer"
          >
            <Text style={styles.actionText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.pillOuter, style]} pointerEvents="box-none">
      <View style={styles.pill} accessibilityRole="summary">
        <MaterialIcons name="check-circle" size={16} color={kua.success} accessible={false} />
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

const createStyles = (kua, mode, colors) => StyleSheet.create({
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
    borderRadius: GEOMETRY['radius-xl'],
    backgroundColor: kua.primaryContainer,
  },
  // Running/done: the same control widens to carry its live state inline.
  compactToggleLive: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: kua.primaryContainerBorder,
  },
  compactCountdown: {
    ...TYPOGRAPHY['label-lg'],
    color: kua.primaryOnContainer,
    fontVariant: ['tabular-nums'],
  },
  compactDoneText: {
    ...TYPOGRAPHY['label-md'],
    color: kua.success,
  },
  panelHeader: {
    gap: 2,
  },
  panelTitle: {
    ...TYPOGRAPHY['headline-sm'],
    color: kua.onSurface,
  },
  panelTitleDone: {
    color: kua.success,
  },
  panelCountdown: {
    ...TYPOGRAPHY['metric-display-mobile'],
    color: kua.onSurface,
  },
  panelCaption: {
    ...TYPOGRAPHY['body-sm'],
    color: kua.onSurfaceVariant,
  },
  panelWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
  },
  // Full-width outlined secondary button, not a loose text link.
  panelAction: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua.surfaceBorder,
  },
  // Semibold face, no extra fontWeight (typography.js: never pair the two).
  panelActionText: {
    ...TYPOGRAPHY['body-md'],
    fontFamily: TYPOGRAPHY['headline-sm'].fontFamily,
    color: kua.primary,
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
    width: 280,
    maxWidth: '92%',
    gap: 14,
    padding: 16,
    borderRadius: GEOMETRY['radius-xl'],
    backgroundColor: kua.surfaceCard,
    borderWidth: 1,
    borderColor: kua.surfaceBorder,
    elevation: 8,
    shadowColor: colors.shadowColor,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  compactChoiceBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua.primaryContainer,
    borderWidth: 1,
    borderColor: kua.primaryContainerBorder,
  },
  choiceText: {
    ...TYPOGRAPHY['label-lg'],
    color: kua.primaryOnContainer,
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
    backgroundColor: kua.surfaceCard,
    borderWidth: 1,
    borderColor: kua.surfaceBorder,
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
    ...TYPOGRAPHY['label-lg'],
    color: kua.onSurface,
    minWidth: 44,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  warning: {
    fontSize: TYPOGRAPHY['label-sm'].fontSize,
    color: kua.onSurfaceVariant,
  },
  doneText: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '700',
    color: kua.success,
  },
  actionText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua.primary,
  },
});
