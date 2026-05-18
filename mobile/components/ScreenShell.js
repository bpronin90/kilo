import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';
import pkg from '../package.json';

export function ScreenShell({ title, subtitle, children }) {
  const logoSource = require('../assets/brand/logo.jpg');
  const wordmarkSource = require('../assets/brand/wordmark.jpg');
  const version = `alpha-${pkg.version}`;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={logoSource} style={styles.logo} resizeMode="contain" />
          <Image source={wordmarkSource} style={styles.wordmark} resizeMode="contain" />
          <View style={styles.versionBadge}>
            <Text style={styles.versionText}>{version}</Text>
          </View>
        </View>
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
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 32,
    height: 32,
  },
  wordmark: {
    width: 80,
    height: 24,
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
