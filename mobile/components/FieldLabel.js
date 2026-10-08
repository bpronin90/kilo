import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useThemedStyles } from '../theme/ThemeContext';
import { TYPOGRAPHY } from '../theme/typography';

// Persistent visible label for a text field (#1282). Placeholders are only
// optional examples, so a field that had no other visible name renders this
// above the input. The input still carries its own accessibilityLabel.
export function FieldLabel({ children, style, ...rest }) {
  const styles = useThemedStyles(createStyles);
  return (
    <Text style={[styles.label, style]} {...rest}>
      {children}
    </Text>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  label: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginBottom: 4,
  },
});
