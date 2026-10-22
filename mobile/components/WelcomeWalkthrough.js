import React, { useContext, useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useKuaStyle, useTheme } from '../theme/ThemeContext';
import { useKuaTypography } from '../theme/typography';
import { scrim } from '../theme/styleHelpers';
import { GEOMETRY, SPACING } from '../theme/spacing';
import { centeredColumnInsets, MODAL_SUPPORTED_ORIENTATIONS } from './adaptiveLayout';
import { WALKTHROUGH_STEPS } from '../hooks/useWelcomeWalkthrough';

function focus(node) {
  if (!node) return;
  if (Platform.OS === 'web') node.focus?.();
  else {
    const handle = findNodeHandle(node);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }
}

// Static transitions respect reduced motion. The ring uses real tab bounds.
export function WelcomeWalkthrough({ tour, anchorVisible }) {
  const { width, height } = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext) || {};
  const { colors, mode } = useTheme();
  const kua = useKuaStyle();
  const styles = useMemo(() => createStyles(colors, kua, mode), [colors, kua, mode]);
  const type = useKuaTypography();
  const title = useRef(null);
  const restore = useRef(null);
  const anchor = tour.anchor;
  const column = centeredColumnInsets(width, insets);
  const valid = tour.active && anchorVisible && anchor && anchor.windowWidth === width
    && anchor.windowHeight === height && anchor.width > 0 && anchor.height >= 44
    && anchor.x >= 0 && anchor.x + anchor.width <= width
    && anchor.y > (insets.top || 0) + 72 && anchor.y + anchor.height <= height - (insets.bottom || 0);
  const visible = !!valid;
  useEffect(() => {
    // Blocking-flow interruptions must retain that flow's own focus.
    if (!tour.dismissalRequest) return undefined;
    const frame = requestAnimationFrame(() => focus(restore.current));
    return () => cancelAnimationFrame(frame);
  }, [tour.dismissalRequest]);
  useEffect(() => {
    if (!visible) return undefined;
    restore.current = anchor.node;
    const frame = requestAnimationFrame(() => focus(title.current));
    return () => cancelAnimationFrame(frame);
  }, [visible, tour.step, anchor]);
  if (!visible) return null;
  const step = WALKTHROUGH_STEPS[tour.step];
  const textColor = kua ? kua.onSurface : colors.text;
  const primary = kua ? kua.primary : colors.text;
  const action = (label, onPress, filled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={[styles.action, filled && { backgroundColor: primary }]}>
      <Text style={[type['body-md'], { color: filled ? (kua ? kua.onPrimary : colors.buttonLabel) : textColor }]}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent
      supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS} onRequestClose={() => tour.skip()}
      onShow={() => focus(title.current)}>
      <View style={styles.overlay} testID="welcome-walkthrough" accessibilityViewIsModal>
        <View pointerEvents="none" style={[styles.ring, { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height, borderColor: primary }]} />
        <View style={[styles.connector, { left: anchor.x + anchor.width / 2 - 1, top: anchor.y - SPACING['space-md'], backgroundColor: primary }]} />
        <View style={[styles.panel, { left: column.left, right: column.right, bottom: height - anchor.y + SPACING['space-md'],
          maxHeight: Math.max(44, anchor.y - (insets.top || 0) - SPACING.margin - SPACING['space-md']),
        }]}>
          <ScrollView bounces={false} contentContainerStyle={styles.copy}>
            <Text ref={title} accessible accessibilityRole="header" tabIndex={-1}
              accessibilityLabel={`${step.tab}, ${tour.step + 1} of 5`}
              style={[type['headline-sm'], { color: textColor }]}>{step.tab} · {tour.step + 1} of 5</Text>
            <Text style={[type['body-md'], { color: textColor }]}>{step.body}</Text>
            <View style={styles.actions}>
              {action('Skip', () => tour.skip())}
              {tour.step > 0 && action('Back', tour.back)}
              {action(tour.step === 4 ? 'Done' : 'Next', tour.step === 4 ? tour.done : tour.next, true)}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors, kua, mode) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: scrim(mode) },
  ring: { position: 'absolute', borderWidth: 2, borderRadius: GEOMETRY['radius-2xl'] },
  connector: { position: 'absolute', width: 2, height: SPACING['space-md'] },
  panel: { backgroundColor: kua ? kua.surfaceCard : colors.card, borderColor: kua ? kua.surfaceBorder : colors.cardBorder, position: 'absolute', borderWidth: 1, borderRadius: GEOMETRY['radius-2xl'], overflow: 'hidden' },
  copy: { padding: SPACING.margin, gap: SPACING['space-md'] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: SPACING['space-sm'] },
  action: { minWidth: 44, minHeight: 44, paddingHorizontal: SPACING['space-md'], paddingVertical: SPACING['space-sm'], justifyContent: 'center', alignItems: 'center', borderRadius: GEOMETRY['radius-xl'] },
});
