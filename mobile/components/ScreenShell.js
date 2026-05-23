import React, { useContext, createContext } from 'react';
import { ScrollView, StyleSheet, Text, View, Platform, StatusBar, SafeAreaView } from 'react-native';
import { Colors } from '../theme/colors';
import pkg from '../package.json';

export const ScrollContext = createContext({ onScroll: () => {} });

export function ScreenShell({ title, subtitle, headerLeft, headerRight, keyboardShouldPersistTaps, children }) {
  const version = `v${pkg.version}`;
  const { onScroll } = useContext(ScrollContext);

  return (
    <ScrollView 
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <SafeAreaView style={styles.headerWrapper}>
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
                {headerLeft}
                <Text style={styles.title}>{title}</Text>
              </View>
              {headerRight}
            </View>
          )}
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      </SafeAreaView>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 120, // Space for tab bar
    gap: 16,
  },
  headerWrapper: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0,
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
