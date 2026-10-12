// Secondary-action sheet for Log tab cards (#1329). The same compact bottom
// sheet over a dismissable scrim that the current-routine card's Routine
// actions menu uses (#1244), packaged once so More Routines and the active
// Deload card can move their less-frequent actions out of the full-width
// button stack. The trigger is a 44dp outlined square that sits beside the
// card's one visible secondary action, inside the body (ui-design-rules §13).
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme, useThemedStyles, useKuaStyle } from '../../theme/ThemeContext';
import { MODAL_SUPPORTED_ORIENTATIONS } from '../adaptiveLayout';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

export function ActionSheetTrigger({ onPress, accessibilityLabel, accessibilityHint, expanded, testID }) {
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      style={styles.trigger}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ expanded: !!expanded }}
      testID={testID}
    >
      <MaterialIcons name="more-horiz" size={20} color={kua ? kua.primary : colors.accentText} accessible={false} />
    </Pressable>
  );
}

// `items`: `{ label, a11y?, onPress, disabled?, danger? }`; falsy entries are
// skipped. Choosing an item closes the sheet first, then runs its handler, so
// a confirmation alert never opens underneath the sheet.
export function ActionSheetMenu({ visible, onClose, items, testID }) {
  const reduceMotion = useReducedMotion();
  const styles = useThemedStyles(createStyles);
  return (
    <Modal
      visible={visible}
      transparent
      supportedOrientations={MODAL_SUPPORTED_ORIENTATIONS}
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        {/* Sibling scrim behind the sheet, not its parent, so TalkBack keeps
            each item focusable; back dismisses. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={styles.sheet} accessibilityRole="menu" testID={testID}>
          {items.filter(Boolean).map(item => (
            <Pressable
              key={item.label}
              onPress={item.disabled ? undefined : () => { onClose(); item.onPress(); }}
              style={styles.item}
              accessibilityRole="menuitem"
              accessibilityLabel={item.a11y || item.label}
              accessibilityState={{ disabled: !!item.disabled }}
            >
              <Text
                style={[
                  styles.itemText,
                  item.danger && styles.itemTextDanger,
                  item.disabled && styles.itemTextDisabled,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  trigger: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GEOMETRY['radius-lg'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    paddingVertical: 8,
    paddingBottom: 24,
    borderTopLeftRadius: GEOMETRY['radius-2xl'],
    borderTopRightRadius: GEOMETRY['radius-2xl'],
    backgroundColor: kua ? kua.surfaceCard : colors.card,
  },
  item: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  itemText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '600',
    color: kua ? kua.onSurface : colors.chipAccentText,
  },
  itemTextDanger: {
    color: kua ? kua.errorText : colors.error,
  },
  itemTextDisabled: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
});
