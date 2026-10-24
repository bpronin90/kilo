// Redesign v3 anchored rest-timer preset panel (#1607, extracted from
// RestTimerBanner). Presentation only: it receives the docked control's phase
// and callbacks and never touches timer state, scheduling or persistence. A
// Modal so the editor header never clips it; positioned against the toggle's
// measured rect (`anchor`).
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { GEOMETRY } from '../../theme/spacing';
import { MODAL_SUPPORTED_ORIENTATIONS } from '../adaptiveLayout';
import { TYPOGRAPHY } from '../../theme/typography';

export const DURATION_PRESETS_SEC = [30, 60, 90, 120, 180];
export const PANEL_WIDTH = 320;

export function formatCountdown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function RestTimerPresetPanel({
  visible, anchor, phase, remainingMs, durationSec, alertMissing, reduceMotion,
  onClose, onStart, onCancel, onDismissDone,
}) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = React.useMemo(() => createStyles(kua, colors), [kua, colors]);
  const countdown = formatCountdown(remainingMs);
  const caption = phase === 'running'
    ? (durationSec ? `of ${formatCountdown(durationSec * 1000)} rest` : 'Resting · tap a time to restart')
    : phase === 'done' ? 'Start another rest' : 'Choose a rest length';
  // Elapsed share of the running rest; only drawn when the duration is known.
  const progress = phase === 'running' && durationSec
    ? Math.min(1, Math.max(0, 1 - remainingMs / (durationSec * 1000))) : null;
  // Vertical fit: below the control when the measured panel fits above the
  // bottom safe area, else flipped above it, else pinned inside the window.
  // Hidden until measured so it never flashes at an overflowing offset.
  const insets = React.useContext(SafeAreaInsetsContext) || { top: 0, bottom: 0 };
  const { height: winH } = useWindowDimensions();
  const [panelH, setPanelH] = React.useState(null);
  let placed = null;
  if (anchor) {
    const { controlTop, ...rest } = anchor;
    placed = rest;
    const maxBottom = winH - insets.bottom - 8;
    if (panelH == null) placed = { ...rest, opacity: 0 };
    else if (rest.top + panelH > maxBottom) {
      const above = (controlTop ?? rest.top) - 6 - panelH;
      placed = { ...rest, top: above >= insets.top + 8 ? above : Math.max(insets.top + 8, maxBottom - panelH) };
    }
  }
  return (
    <Modal
      visible={visible}
      transparent
      supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
    >
      <View style={styles.menuRoot}>
        {/* Sibling scrim BEHIND the panel, not its parent: an accessible
            Pressable wrapping the panel would group its items into one
            TalkBack element. TalkBack users dismiss with the back gesture
            (onRequestClose) or by choosing an item. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} importantForAccessibility="no" />
        <View
          style={[styles.chooser, placed]}
          onLayout={(e) => { const h = e.nativeEvent.layout.height; setPanelH(prev => (prev === h ? prev : h)); }}
          accessibilityRole="menu"
          testID="rest-timer-preset-panel"
        >
          <View style={styles.panelHeader}>
            {phase === 'running' ? (
              <Text style={styles.panelCountdown} accessibilityLiveRegion="polite">{countdown}</Text>
            ) : (
              <Text style={[styles.panelTitle, phase === 'done' && styles.panelTitleDone]} accessibilityLiveRegion="polite">
                {phase === 'done' ? 'Rest over' : 'Rest timer'}
              </Text>
            )}
            <Text style={styles.panelCaption}>{caption}</Text>
          </View>
          {progress != null && (
            <View style={styles.track} accessible={false}>
              <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
            </View>
          )}
          {alertMissing && (
            <View style={styles.panelWarning}>
              <MaterialIcons name="notifications-off" size={14} color={kua.onSurfaceVariant} accessible={false} />
              <Text style={styles.warning}>Background alert unavailable</Text>
            </View>
          )}
          <View style={styles.presetRow}>
            {DURATION_PRESETS_SEC.map((sec) => {
              const active = phase === 'running' && durationSec === sec;
              return (
                <Pressable
                  key={sec}
                  onPress={() => { onStart?.(sec); onClose(); }}
                  style={[styles.choiceBtn, active && styles.choiceBtnActive]}
                  accessibilityRole="menuitem"
                  accessibilityLabel={`${phase === 'idle' ? 'Start' : 'Restart'} ${sec} second rest timer`}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{formatCountdown(sec * 1000)}</Text>
                </Pressable>
              );
            })}
          </View>
          {phase !== 'idle' && (
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => { if (phase === 'running') onCancel?.(); else onDismissDone?.(); onClose(); }}
                style={styles.panelAction}
                accessibilityRole="menuitem"
                accessibilityLabel={phase === 'running' ? 'Cancel rest timer' : 'Dismiss rest timer done banner'}
              >
                <Text style={styles.panelActionText}>{phase === 'running' ? 'Cancel timer' : 'Dismiss'}</Text>
              </Pressable>
              {phase === 'running' && (
                <Pressable onPress={onClose} style={styles.panelAction} accessibilityRole="menuitem" accessibilityLabel="Close rest timer panel">
                  <Text style={styles.panelActionText}>Dismiss</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (kua, colors) => StyleSheet.create({
  menuRoot: { flex: 1 },
  // Fixed fallback only applies if measurement is unavailable.
  chooser: {
    position: 'absolute', top: 96, right: 16, width: 288, maxWidth: '92%',
    gap: 14, padding: 16, borderRadius: GEOMETRY['radius-xl'],
    backgroundColor: kua.surfaceCard, borderWidth: 1, borderColor: kua.surfaceBorder,
    elevation: 8, shadowColor: colors.shadowColor, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  panelHeader: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, rowGap: 2 },
  panelTitle: { ...TYPOGRAPHY['headline-sm'], color: kua.onSurface },
  panelTitleDone: { color: kua.success },
  panelCountdown: { ...TYPOGRAPHY['metric-display-mobile'], color: kua.onSurface, fontVariant: ['tabular-nums'] },
  panelCaption: { ...TYPOGRAPHY['body-sm'], color: kua.onSurfaceVariant },
  track: { height: 4, borderRadius: 2, backgroundColor: kua.surfaceBorder, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: kua.primary },
  panelWarning: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warning: { fontSize: TYPOGRAPHY['label-sm'].fontSize, color: kua.onSurfaceVariant },
  presetRow: { flexDirection: 'row', gap: 6 },
  choiceBtn: {
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: GEOMETRY['radius-lg'], borderWidth: 1, borderColor: kua.surfaceBorder,
  },
  choiceBtnActive: { backgroundColor: kua.primaryContainer, borderColor: kua.primary },
  choiceText: { ...TYPOGRAPHY['label-lg'], color: kua.onSurface, fontVariant: ['tabular-nums'] },
  choiceTextActive: { color: kua.primaryOnContainer },
  actionRow: { flexDirection: 'row', gap: 8 },
  panelAction: {
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: GEOMETRY['radius-lg'], borderWidth: 1, borderColor: kua.surfaceBorder,
  },
  // Label face, uppercase per the redesign's button ink.
  panelActionText: { ...TYPOGRAPHY['label-lg'], letterSpacing: 1.2, textTransform: 'uppercase', color: kua.onSurface },
});
