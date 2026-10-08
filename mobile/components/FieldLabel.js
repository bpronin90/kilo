import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { TYPOGRAPHY, useKuaTypography } from '../theme/typography';

// Persistent visible label for a text field (#1282). Placeholders are only
// optional examples, so a field that had no other visible name renders this
// above the input. The input still carries its own accessibilityLabel.
export function FieldLabel({ children, style, ...rest }) {
  const typo = useKuaTypography();
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createStyles(colors, kua, typo), [colors, kua, typo]);
  return (
    <Text style={[styles.label, style]} {...rest}>
      {children}
    </Text>
  );
}

// Space Grotesk semibold face from the headline-sm role at body-sm size. The
// face encodes the weight, so no literal fontWeight is set over it (the
// fallback role restores its own weight for system fonts).
const createStyles = (colors, kua = null, typo = TYPOGRAPHY) => StyleSheet.create({
  label: {
    ...typo['headline-sm'],
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    lineHeight: TYPOGRAPHY['body-sm'].lineHeight,
    letterSpacing: 0,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginBottom: 4,
  },
});
