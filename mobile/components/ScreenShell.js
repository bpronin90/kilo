import React, { useContext, createContext } from 'react';
import { ScrollView, StyleSheet, Text, View, Platform, StatusBar, SafeAreaView } from 'react-native';
import { Colors } from '../theme/colors';
import pkg from '../package.json';

export const ScrollContext = createContext({ onScroll: () => {} });

/**
 * Shared Shell Contract:
 * - Horizontal padding: 16px (standard boundary for all screen content)
 * - Vertical gap: 16px (consistent spacing between top-level components/cards)
 * - Bottom padding: 120px (ensures content clears the absolute TabBar and bottom safe area)
 * - Top safe area: Handled via localized SafeAreaView in the headerWrapper
 */
export const ScreenShell = React.forwardRef(({ title, subtitle, headerRight, keyboardShouldPersistTaps, onScroll: propOnScroll, style, children, stickyHeaderIndices }, ref) => {
  const version = `v${pkg.version}`;
  const { onScroll: contextOnScroll } = useContext(ScrollContext);

  const handleScroll = (e) => {
    if (contextOnScroll) contextOnScroll(e);
    if (propOnScroll) propOnScroll(e);
  };

  return (
    <ScrollView 
      ref={ref}
      style={[styles.scroll, style]}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      stickyHeaderIndices={stickyHeaderIndices}
    >
      <View style={styles.headerWrapper}>
        <View style={styles.header}>
          {!title && (
            <View style={styles.titleRow}>
              <Text style={styles.title}>Kilo</Text>
              <Text style={styles.version}>{version}</Text>
            </View>
          )}
          {title && (
            <View style={styles.titleRow}>
              <View style={styles.titleGroup}>
                {typeof title === 'string' ? <Text style={styles.title}>{title}</Text> : title}
              </View>
              {headerRight}
            </View>
          )}
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      </View>
      {children}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 16,
    paddingBottom: 120, // Space for tab bar + safe area
    gap: 16,
  },
  headerWrapper: {
    // Spacing handled by App.js safe area cap
  },
  header: {
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8, // Reduced gap from 12 to 8 for cleaner look
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center', // Changed from baseline to center for better alignment with icons/buttons
    gap: 12,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
  },
  version: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
});
