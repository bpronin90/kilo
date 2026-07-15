import React, { useContext, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';

export function TabBar({ tabs, activeTab, onTabPress, addScrollListener }) {
  const { bottom: bottomInset = 0 } = useContext(SafeAreaInsetsContext) || {};
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
      style={[styles.container, { opacity: fadeAnim, bottom: 24 + bottomInset }]}
      onTouchStart={handleInteractionStart}
      onTouchEnd={handleInteractionEnd}
    >
      {tabs.map((tab) => (
        <Pressable
          key={tab}
          onPress={() => onTabPress(tab)}
          style={[styles.tab, activeTab === tab ? styles.tabActive : null]}
        >
          <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : null]}>
            {tab}
          </Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: Colors.card,
    borderRadius: 24,
    padding: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
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
    backgroundColor: Colors.chipBackground,
  },
  tabText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: Colors.chipText,
  },
});
