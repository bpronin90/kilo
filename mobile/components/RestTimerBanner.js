import React from 'react';
import { AccessibilityInfo, Dimensions, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../theme/ThemeContext';
import { GEOMETRY } from '../theme/spacing';
import { TYPOGRAPHY } from '../theme/typography';
import { RestTimerPresetPanel, PANEL_WIDTH, formatCountdown } from './restTimer/RestTimerPresetPanel';
import { RestTimerPill } from './restTimer/RestTimerPill';

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
  // Compact only: the app-shell pill owns the countdown while the editor header
  // is scrolling away. The control keeps its layout slot (no header reflow) but
  // is invisible, inert and hidden from screen readers so it never shows twice.
  handedOff = false,
  // Running rest's full length (record.durationSec), for the panel's
  // "of m:ss rest" caption and progress; optional.
  durationSec = null,
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
          // Clamp against BOTH viewport edges: right-aligned under the control,
          // but never pushed past the left edge on a narrow screen.
          const width = Math.min(PANEL_WIDTH, winW - 16);
          setAnchor({
            position: 'absolute',
            top: y + h + 6,
            controlTop: y,
            width,
            right: Math.min(Math.max(8, winW - (x + w)), winW - width - 8),
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

    return (
      <View
        style={[styles.compactWrap, handedOff && styles.compactHandedOff, style]}
        pointerEvents={handedOff ? 'none' : 'auto'}
        accessibilityElementsHidden={handedOff}
        importantForAccessibility={handedOff ? 'no-hide-descendants' : 'auto'}
      >
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
        <RestTimerPresetPanel
          visible={expanded}
          anchor={anchor}
          phase={phase}
          remainingMs={remainingMs}
          durationSec={durationSec}
          alertMissing={alertMissing}
          reduceMotion={reduceMotion}
          onClose={() => setExpanded(false)}
          onStart={onStart}
          onCancel={onCancel}
          onDismissDone={onDismissDone}
        />
      </View>
    );
  }

  // App-shell instance: nothing to show until a timer is running or has just
  // finished.
  if (!isRunning && !justElapsed) return null;

  return (
    <RestTimerPill
      isRunning={isRunning}
      remainingMs={remainingMs}
      backgroundAlertAvailable={backgroundAlertAvailable}
      onCancel={onCancel}
      onDismissDone={onDismissDone}
      style={style}
    />
  );
}

const createStyles = (kua, mode, colors) => StyleSheet.create({
  // The collapsed compact control is just the icon button; the wrapper adds no
  // size of its own and only anchors the (Modal-hosted) menu.
  compactWrap: {
    position: 'relative',
  },
  compactHandedOff: {
    opacity: 0,
  },
  compactToggle: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GEOMETRY['radius-lg'],
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
});
