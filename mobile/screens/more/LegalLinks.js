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

// Under the production KUA gate (`kua` supplied) the legal links resolve
// through the selected court palette; outside the gate (`kua` null — isolated
// tests) they keep the legacy palette.
export const createStyles = (colors, kua = null) => StyleSheet.create({
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  legalLink: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textDecorationLine: 'underline',
  },
  legalSep: {
    fontSize: 13,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
});
