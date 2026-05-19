import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View, Platform, StatusBar } from 'react-native';
import { Colors } from '../theme/colors';
import pkg from '../package.json';

export function ScreenShell({ title, subtitle, headerRight, keyboardShouldPersistTaps, children }) {
  const logoSource = require('../assets/brand/logo.png');
  const wordmarkSource = require('../assets/brand/wordmark.png');
  const version = `alpha-${pkg.version}`;

  return (
    <ScrollView 
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    >
      <View style={styles.header}>
        {!title && (
          <View style={styles.brandRow}>
            <Image source={logoSource} style={styles.logo} resizeMode="contain" />
            <Image source={wordmarkSource} style={styles.wordmark} resizeMode="contain" />
            <View style={styles.versionBadge}>
              <Text style={styles.versionText}>{version}</Text>
            </View>
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
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  logo: {
    width: 32,
    height: 32,
  },
  wordmark: {
    width: 91,
    height: 32,
  },
  versionBadge: {
    backgroundColor: Colors.chipBackground,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 4,
  },
  versionText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
});
