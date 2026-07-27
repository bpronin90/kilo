import React, { useContext, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useThemedStyles } from '../theme/ThemeContext';
import { TAB_BAR_VISUAL_GAP } from './TabBarLayout';

export function TabBar({ tabs, activeTab, onTabPress, addScrollListener, onHeightChange }) {
  const styles = useThemedStyles(createStyles);
  const { bottom: bottomInset = 0 } = useContext(SafeAreaInsetsContext) || {};

  const handleLayout = (e) => {
    if (onHeightChange) onHeightChange(e.nativeEvent.layout.height);
  };
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const timeoutRef = useRef(null);

  const animateTo = (toValue, duration, easing = Easing.out(Easing.exp)) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    Animated.timing(fadeAnim, {
      toValue,
      duration,
      easing,
      useNativeDriver: true,
    }).start();
  };

  const setSolid = (immediate = false) => 
    animateTo(1, immediate ? 0 : 300, Easing.out(Easing.exp));
    
  const setTransparent = (immediate = false) => 
    animateTo(0.25, immediate ? 0 : 1000, Easing.bezier(0.4, 0, 0.2, 1));

  // Initial settle
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      setTransparent(false);
    }, 2000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Handle external scroll activity
  useEffect(() => {
    if (!addScrollListener) return;
    return addScrollListener((scrolling) => {
      if (scrolling) {
        setTransparent(false);
      }
    });
  }, [addScrollListener]);

  const handleInteractionStart = () => {
    setSolid(false); // Smooth but quick appearance on touch
  };

  const handleInteractionEnd = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setTransparent(false);
    }, 1500);
  };

  return (
    <Animated.View
      style={[styles.container, { opacity: fadeAnim, bottom: TAB_BAR_VISUAL_GAP + bottomInset }]}
      onLayout={handleLayout}
      onTouchStart={handleInteractionStart}
      onTouchEnd={handleInteractionEnd}
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
    </Animated.View>
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
