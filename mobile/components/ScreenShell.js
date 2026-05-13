import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';

export function ScreenShell({ title, subtitle, children }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
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
    gap: 8,
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
