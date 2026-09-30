import React, { useContext, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useKuaStyle, useTheme, useThemedStyles } from '../theme/ThemeContext';
import { TAB_BAR_VISUAL_GAP, TAB_BAR_HEIGHT_FALLBACK } from './TabBarLayout';
import { Icon } from './Icon';
import { centeredColumnInsets } from './adaptiveLayout';

// The floating bottom navigation is always fully opaque (#1026). It previously
// animated itself down to 25% opacity two seconds after mount and again after
// scroll or touch, which left the muted 13px labels unreadable over arbitrary
// content and made the bar feel like it was disappearing. That behavior — and
// its scroll-activity plumbing in App.js — is removed; only the tabs, the
// floating rounded shape, the position, and the safe-area offset remain.
// #1209 reverses the always-visible rule: the bar is still fully opaque when
// shown, but it slides off-screen with a translateY (never an opacity fade, and
// never unmounted or re-laid-out) when `hidden` is set by scroll direction.
// Compact bar (#1209): 20dp icon keeps the five tabs shorter than the prior
// 24dp/10dp-padding layout while each tab stays a >=44dp touch target.
const TAB_ICON_SIZE = 20;

const HIDE_DURATION_MS = 180;

export function TabBar({ tabs, activeTab, onTabPress, onHeightChange, hidden = false }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const { bottom: bottomInset = 0, left: leftInset = 0, right: rightInset = 0 } = useContext(SafeAreaInsetsContext) || {};
  // Wide windows (#1126): the bar aligns with ScreenShell's centered content
  // column and clears side insets instead of spanning a tablet or landscape
  // display. On phone portrait this resolves to the original 16/16 offsets.
  const { width: windowWidth } = useWindowDimensions();
  const column = centeredColumnInsets(windowWidth, { left: leftInset, right: rightInset });

  // Active/inactive tint from the selected court palette, falling back to the
  // legacy palette outside the production KUA gate (#1139). The active tab keeps
  // its `selection` (primary-container) pill, so the active icon/11px label take
  // `primaryOnContainer` — the ink KUA guarantees AA on that container in every
  // court/mode — rather than `primary`, which is only 4.25:1 on Hard Court dark's
  // selection fill. Inactive items sit on `tabBarBg` and take onSurfaceVariant.
  const activeColor = kua ? kua.primaryOnContainer : colors.chipText;
  const inactiveColor = kua ? kua.onSurfaceVariant : colors.textMuted;

  // Slide distance covers the bar, its bottom offset and its shadow so nothing
  // peeks above the screen edge. Measured height is reported unchanged.
  const heightRef = useRef(TAB_BAR_HEIGHT_FALLBACK);
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(translateY, {
      toValue: hidden ? heightRef.current + TAB_BAR_VISUAL_GAP + bottomInset + 24 : 0,
      duration: HIDE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hidden, bottomInset, translateY]);

  const handleLayout = (e) => {
    heightRef.current = e.nativeEvent.layout.height;
    if (onHeightChange) onHeightChange(e.nativeEvent.layout.height);
  };

  return (
    <Animated.View
      style={[styles.container, { bottom: TAB_BAR_VISUAL_GAP + bottomInset, left: column.left, right: column.right, transform: [{ translateY }] }]}
      onLayout={handleLayout}
      accessibilityRole="tablist"
      // Off-screen while hidden (#1209): block touches and hide the tabs from
      // TalkBack/VoiceOver so an invisible destination can't be focused or pressed.
      pointerEvents={hidden ? 'none' : 'auto'}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={!!hidden}
    >
      {tabs.map((tab) => (
        <Pressable
          key={tab}
          onPress={() => onTabPress(tab)}
          style={[styles.tab, activeTab === tab ? styles.tabActive : null]}
          accessibilityRole="tab"
          accessibilityLabel={tab}
          accessibilityState={{ selected: activeTab === tab }}
          accessible={true}
        >
          <Icon
            name={tab}
            size={TAB_ICON_SIZE}
            color={activeTab === tab ? activeColor : inactiveColor}
          />
          <Text style={[styles.tabText, { color: activeTab === tab ? activeColor : inactiveColor, fontWeight: activeTab === tab ? '700' : '500' }]}>
            {tab}
          </Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  container: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 4,
    backgroundColor: kua ? kua.tabBarBg : colors.card,
    borderRadius: 20,
    padding: 4,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  tab: {
    flex: 1,
    minHeight: 46,
    paddingVertical: 5,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: kua ? kua.selection : colors.chipBackground,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
});
