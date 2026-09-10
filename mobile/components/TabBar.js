import React, { useContext } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useThemedStyles } from '../theme/ThemeContext';
import { TAB_BAR_VISUAL_GAP } from './TabBarLayout';

// The floating bottom navigation is always fully opaque (#1026). It previously
// animated itself down to 25% opacity two seconds after mount and again after
// scroll or touch, which left the muted 13px labels unreadable over arbitrary
// content and made the bar feel like it was disappearing. That behavior — and
// its scroll-activity plumbing in App.js — is removed; only the tabs, the
// floating rounded shape, the position, and the safe-area offset remain.
export function TabBar({ tabs, activeTab, onTabPress, onHeightChange }) {
  const styles = useThemedStyles(createStyles);
  const { bottom: bottomInset = 0 } = useContext(SafeAreaInsetsContext) || {};

  const handleLayout = (e) => {
    if (onHeightChange) onHeightChange(e.nativeEvent.layout.height);
  };

  return (
    <View
      style={[styles.container, { bottom: TAB_BAR_VISUAL_GAP + bottomInset }]}
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
          <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : null]}>
            {tab}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 18,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.chipBackground,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.chipText,
  },
});
