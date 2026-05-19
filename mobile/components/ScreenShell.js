import React from 'react';
import { ScrollView, StyleSheet, Text, View, Platform, StatusBar } from 'react-native';
import { Colors } from '../theme/colors';
import pkg from '../package.json';

export function ScreenShell({ title, subtitle, headerRight, keyboardShouldPersistTaps, children }) {
  const version = `v${pkg.version}`;

  return (
    <ScrollView 
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    >
      <View style={styles.header}>
        {!title && (
          <View style={styles.titleRow}>
            <Text style={styles.title}>Kilo</Text>
            <Text style={styles.version}>{version}</Text>
          </View>
        )}
        {title && (
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {headerRight}
          </View>
        )}
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 120, // Space for tab bar
    gap: 16,
  },
  header: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 16,
    paddingBottom: 8,
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
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
