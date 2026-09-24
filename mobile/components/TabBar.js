import React, { useContext } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useKuaStyle, useTheme, useThemedStyles } from '../theme/ThemeContext';
import { TAB_BAR_VISUAL_GAP } from './TabBarLayout';
import { Icon } from './Icon';
import { centeredColumnInsets } from './adaptiveLayout';

// The floating bottom navigation is always fully opaque (#1026). It previously
// animated itself down to 25% opacity two seconds after mount and again after
// scroll or touch, which left the muted 13px labels unreadable over arbitrary
// content and made the bar feel like it was disappearing. That behavior — and
// its scroll-activity plumbing in App.js — is removed; only the tabs, the
// floating rounded shape, the position, and the safe-area offset remain.
// KUA icon size for the tab bar per foundation.md: 22–24dp.
const TAB_ICON_SIZE = 24;

export function TabBar({ tabs, activeTab, onTabPress, onHeightChange }) {
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

  const handleLayout = (e) => {
    if (onHeightChange) onHeightChange(e.nativeEvent.layout.height);
  };

  return (
    <View
      style={[styles.container, { bottom: TAB_BAR_VISUAL_GAP + bottomInset, left: column.left, right: column.right }]}
      onLayout={handleLayout}
      accessibilityRole="tablist"
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
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  container: {
    position: 'absolute',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: kua ? kua.tabBarBg : colors.card,
    borderRadius: 24,
    padding: 8,
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
    paddingVertical: 10,
    borderRadius: 18,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: kua ? kua.selection : colors.chipBackground,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
});
