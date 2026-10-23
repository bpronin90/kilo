// Routine actions for the current routine (#1021/#1244/#1375/#1445), moved out
// of LogActiveRoutineCard's header for the redesign v3 Log root header (#1606).
// `useLogRoutineActions` owns the sheet's open state, the plate calculator,
// Copy/Share/Share as Image and the copy status line; `LogRoutineActionSheet`
// renders the one sheet + the one plate calculator + the image share preview.
// The items, their labels/hints, their order and their handlers are the ones
// the card has always offered — only the sheet's chrome (title, icons, close)
// is new. Exactly one owner renders these per screen: LogScreen hands the
// hook's result to both the header and the card, so the card renders none.
import React, { useContext, useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useKuaStyle, useTheme, useThemedStyles } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';
import {
  shareRoutine,
  copyRoutineToClipboard,
  ROUTINE_COPY_SUCCESS_MESSAGE,
  ROUTINE_COPY_FAILURE_MESSAGE,
} from '../../lib/interoperability/routineShare';
import { RoutineShareModal } from '../RoutineShareCard';
import { MODAL_SUPPORTED_ORIENTATIONS } from '../adaptiveLayout';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { PlateCalculatorModal } from '../PlateCalculatorModal';
import { useRoutinePlateCalculator } from './useRoutinePlateCalculator';

export function useLogRoutineActions({
  workoutNoteTitle, routineRawText, activeEditText, onShareRoutine,
  enterCurrentEditor, handleSkipWeek, handleUnskipWeek, canUnskipWeek,
  isCollapsed, toggleCollapsed,
}) {
  const [imageShare, setImageShare] = useState(null);
  // The sheet closes itself after any item is chosen.
  const [menuOpen, setMenuOpen] = useState(false);
  // #1375: the plate calculator's only Log entry — weights in the note are plain text.
  const plateCalculator = useRoutinePlateCalculator(menuOpen);
  // A single transient status line for the most recent copy attempt. A fresh
  // object per attempt so a second copy restarts the 4s expiry. The payload is
  // the FULL stored routine body — copy must carry both A/B halves and `---`.
  const [copyStatus, setCopyStatus] = useState(null);
  useEffect(() => {
    if (!copyStatus) return undefined;
    const timer = setTimeout(() => setCopyStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const payload = () => ({ title: workoutNoteTitle, rawText: routineRawText ?? activeEditText });
  const handleShareRoutine = () => {
    if (onShareRoutine) onShareRoutine(payload());
    else shareRoutine(payload());
  };
  const handleCopyRoutine = () => copyRoutineToClipboard(payload()).then(({ ok, showConfirmation }) => {
    if (!ok) {
      setCopyStatus({ message: ROUTINE_COPY_FAILURE_MESSAGE });
      AccessibilityInfo.announceForAccessibility?.(ROUTINE_COPY_FAILURE_MESSAGE);
      return;
    }
    // Android 13+ shows its own clipboard popup; suppress the in-app line there.
    if (showConfirmation) {
      setCopyStatus({ message: ROUTINE_COPY_SUCCESS_MESSAGE });
      AccessibilityInfo.announceForAccessibility?.(ROUTINE_COPY_SUCCESS_MESSAGE);
    } else {
      setCopyStatus(null);
    }
  });
  const title = workoutNoteTitle || 'Untitled Routine';
  const items = [
    { label: 'Edit', icon: 'edit', a11y: 'Edit routine', run: enterCurrentEditor },
    // Skip week always (skips stack); Remove skip only while a trailing skip exists.
    handleSkipWeek ? { label: 'Skip week', icon: 'skip-next', a11y: 'Skip week', run: handleSkipWeek, showsStatus: true } : null,
    // "Remove skip", not "Undo skip": that text collides with the editor's "Undo".
    canUnskipWeek && handleUnskipWeek
      ? { label: 'Remove skip', icon: 'undo', a11y: 'Remove skip', run: handleUnskipWeek, showsStatus: true }
      : null,
    { label: 'Plate calculator', icon: 'calculate', a11y: 'Plate calculator', hint: 'Enter a target weight to calculate plates', run: plateCalculator.request },
    // #956: Copy and Share stay distinct actions, not merged.
    { label: 'Copy', icon: 'content-copy', a11y: `Copy routine ${title}`, run: handleCopyRoutine, showsStatus: true },
    { label: 'Share', icon: 'share', a11y: 'Share routine', run: handleShareRoutine },
    { label: 'Share as Image', icon: 'image', a11y: 'Share routine as image', run: () => setImageShare(payload()) },
  ].filter(Boolean);
  const choose = (item) => {
    setMenuOpen(false);
    // Its result line renders in the card body, so open a collapsed card first.
    if (item.showsStatus && isCollapsed && toggleCollapsed) toggleCollapsed();
    return item.run && item.run();
  };
  return {
    title, items, choose, menuOpen, setMenuOpen, plateCalculator, copyStatus, imageShare, setImageShare,
    toggleMenu: () => setMenuOpen(o => !o),
    openPlates: () => { setMenuOpen(false); plateCalculator.open(); },
  };
}

export function LogRoutineActionSheet({ actions }) {
  const reduceMotion = useReducedMotion();
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { colors } = useTheme();
  const kua = useKuaStyle();
  // #1331: the sheet's last item clears the home indicator.
  const { bottom: bottomInset = 0 } = useContext(SafeAreaInsetsContext) || {};
  const { menuOpen, setMenuOpen, plateCalculator, imageShare, setImageShare } = actions;
  const muted = kua ? kua.onSurfaceVariant : colors.textMuted;
  return (
    <>
      {imageShare && <RoutineShareModal {...imageShare} onClose={() => setImageShare(null)} />}
      <PlateCalculatorModal visible={plateCalculator.visible} editableTarget onClose={plateCalculator.close} />
      {/* #1244: a sheet over a dismissable scrim, so opening it never shifts content. */}
      <Modal
        visible={menuOpen}
        transparent
        supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setMenuOpen(false)}
        onDismiss={plateCalculator.onMenuDismiss}
      >
        <View style={styles.scrim}>
          {/* Sibling scrim behind the sheet, not its parent, so TalkBack keeps
              each item focusable (RestTimerBanner pattern); back dismisses. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessible={false} importantForAccessibility="no" />
          <View style={[styles.sheet, { paddingBottom: 24 + bottomInset }]} accessibilityRole="menu" testID="log-current-routine-menu">
            <View style={styles.grab} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleBlock}>
                <Text style={[typography['headline-md'], styles.sheetTitle]} accessibilityRole="header">Routine actions</Text>
                <Text style={[typography['body-md'], styles.sheetSub]} numberOfLines={1}>{actions.title}</Text>
              </View>
              <Pressable onPress={() => setMenuOpen(false)} style={styles.close} accessibilityRole="button" accessibilityLabel="Close routine actions">
                <MaterialIcons name="close" size={24} color={muted} accessible={false} />
              </Pressable>
            </View>
            {actions.items.map(item => (
              <Pressable
                key={item.label}
                onPress={(e) => { e?.stopPropagation?.(); return actions.choose(item); }}
                style={styles.item}
                android_ripple={{ color: kua ? kua.selection : colors.chipBackground }}
                accessibilityRole="menuitem"
                accessibilityLabel={item.a11y}
                accessibilityHint={item.hint}
              >
                <MaterialIcons name={item.icon} size={22} color={muted} accessible={false} />
                <Text style={[typography['body-lg'], styles.itemText]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    paddingTop: 8,
    borderTopLeftRadius: GEOMETRY['radius-2xl'],
    borderTopRightRadius: GEOMETRY['radius-2xl'],
    backgroundColor: kua ? kua.surfaceCard : colors.card,
  },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8, backgroundColor: kua ? kua.surfaceBorder : colors.cardBorder },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 16, paddingRight: 8, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  sheetTitleBlock: { flex: 1, minWidth: 0, gap: 2, paddingTop: 4 },
  sheetTitle: { color: kua ? kua.onSurface : colors.text },
  sheetSub: { color: kua ? kua.onSurfaceVariant : colors.textMuted },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  item: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  itemText: { flex: 1, color: kua ? kua.onSurface : colors.chipAccentText },
});
