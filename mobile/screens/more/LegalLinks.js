import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../../theme/ThemeContext';

export function LegalLinks() {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.legalLinks}>
      <Text
        style={styles.legalLink}
        onPress={() => Linking.openURL('https://bpronin90.github.io/privacy.html')}
        accessibilityLabel="Privacy Policy"
        accessibilityRole="link"
      >
        Privacy Policy
      </Text>
      <Text style={styles.legalSep}>·</Text>
      <Text
        style={styles.legalLink}
        onPress={() => Linking.openURL('https://bpronin90.github.io/terms.html')}
        accessibilityLabel="Terms of Service"
        accessibilityRole="link"
      >
        Terms of Service
      </Text>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  legalLink: {
    fontSize: 13,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  legalSep: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
