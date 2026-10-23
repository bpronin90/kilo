import React, { useContext } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useKuaStyle, useTheme, useThemedStyles } from '../theme/ThemeContext';
import { useKuaTypography } from '../theme/typography';
import { centeredColumnInsets } from './adaptiveLayout';
import { Icon } from './Icon';

// Redesign v3 root-tab header (#1600): a 28/700 display title, an optional
// uppercase mono context line under it, optional right-side actions, and a
// full-width bottom hairline. Root tabs have no back chevron; sub-screens keep
// ScreenShell's `onBack` bar. Pass it to `ScreenShell` as `header` so it stays
// fixed above the scroll; Home keeps its wordmark/sync header and does not use
// this. Tabs adopt it in their own redesign issues.
export function RootHeader({ title, context = null, right = null, uppercaseContext = true, hairline = true, testID = 'root-header', style }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const { left: leftInset = 0, right: rightInset = 0 } = useContext(SafeAreaInsetsContext) || {};
  const { width } = useWindowDimensions();
  const column = centeredColumnInsets(width, { left: leftInset, right: rightInset });
  const display = typography['headline-xl-mobile'];
  const titleStyle = { fontFamily: display.fontFamily, fontWeight: display.fontWeight, fontSize: 28, lineHeight: 34, letterSpacing: -0.01 * 28 };

  return (
    <View
      testID={testID}
      style={[styles.container, hairline ? styles.hairline : null, { paddingLeft: column.left, paddingRight: column.right - 8 }, style]}
    >
      <View style={styles.titleBlock}>
        <Text style={[styles.title, titleStyle]} accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        {context == null || context === '' ? null : typeof context === 'string' ? (
          <Text
            testID={`${testID}-context`}
            style={[styles.context, typography['label-md'], uppercaseContext ? styles.upper : null]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {context}
          </Text>
        ) : context}
      </View>
      {right ? <View style={styles.actions}>{right}</View> : null}
    </View>
  );
}

// A labelled 44x44 icon action for RootHeader's `right` slot. `label` is the
// accessible name (icon-only buttons must be labelled); `text` optionally shows
// a short visible label beside the icon.
export function RootHeaderAction({ icon, label, onPress, text = null, testID, disabled = false }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const typography = useKuaTypography();
  const color = kua ? kua.onSurface : colors.text;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={({ pressed }) => [styles.action, text ? styles.actionWithText : null, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
    >
      {icon ? <Icon name={icon} size={22} color={color} /> : null}
      {text ? <Text style={[typography['label-lg'], styles.upper, { color }]}>{text}</Text> : null}
    </Pressable>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  container: {
    minHeight: 64,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: kua ? kua.background : colors.background,
  },
  hairline: {
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: kua ? kua.onSurface : colors.text,
  },
  context: {
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  upper: {
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  action: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  actionWithText: {
    paddingHorizontal: 10,
  },
  // Press feedback lives in the fill, never a whole-control opacity fade.
  pressed: {
    backgroundColor: kua ? kua.selection : colors.chipBackground,
  },
  disabled: {
    opacity: 0.4,
  },
});
