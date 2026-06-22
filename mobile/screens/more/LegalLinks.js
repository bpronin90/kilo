import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../../theme/colors';

export function LegalLinks() {
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

const styles = StyleSheet.create({
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  legalLink: {
    fontSize: 13,
    color: Colors.textMuted,
    textDecorationLine: 'underline',
  },
  legalSep: {
    fontSize: 13,
    color: Colors.textMuted,
  },
});
