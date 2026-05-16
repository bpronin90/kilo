import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';

export function Card({ children, style, tone = 'default' }) {
  return (
    <View style={[
      styles.card, 
      tone === 'accent' ? styles.cardAccent : null,
      style
    ]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Button({ onPress, title, style, textStyle, disabled = false }) {
  return (
    <Pressable
      onPress={disabled ? null : onPress}
      style={[styles.button, disabled ? styles.buttonDisabled : null, style]}
    >
      <Text style={[styles.buttonText, textStyle]}>{disabled ? 'Saving…' : title}</Text>
    </Pressable>
  );
}

export function StatCard({ label, value, tone = 'default' }) {
  return (
    <Card tone={tone} style={styles.statCard}>
      <Text style={[styles.statLabel, tone === 'accent' ? styles.textLight : null]}>{label}</Text>
      <Text style={[styles.statValue, tone === 'accent' ? styles.textLight : null]}>{value}</Text>
    </Card>
  );
}

export function Chip({ children }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  cardAccent: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 6,
  },
  button: {
    backgroundColor: Colors.text,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: Colors.textLight,
    fontSize: 16,
    fontWeight: '700',
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
  },
  textLight: {
    color: Colors.textLight,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.chipBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.chipText,
  },
});
