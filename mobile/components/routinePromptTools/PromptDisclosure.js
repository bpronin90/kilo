import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Card } from '../UI';
import { useTheme, useThemedStyles, useKuaStyle } from '../../theme/ThemeContext';
import { TYPOGRAPHY } from '../../theme/typography';

// Collapsed-by-default reference viewer for the generated prompt (#1385). The
// prompt is reference/debug content, so it is two siblings the flow can place
// apart: the toggle sits with the Copy/Share actions, while the expanded text
// renders last so growing it never pushes an operational section below it.
export function PromptDisclosureToggle({ expanded, onToggle }) {
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={styles.toggle}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide prompt' : 'View prompt'}
      accessibilityState={{ expanded }}
      testID="prompt-disclosure-toggle"
    >
      <Text style={styles.toggleText}>View prompt</Text>
      <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={18} color={kua ? kua.onSurfaceVariant : colors.textMuted} accessible={false} />
    </Pressable>
  );
}

export function PromptDisclosureBody({ expanded, text }) {
  const styles = useThemedStyles(createStyles);
  if (!expanded || !text) return null;
  return <View><Card><Text selectable style={styles.prompt} testID="routine-prompt-output">{text}</Text></Card></View>;
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  toggleText: { color: kua ? kua.onSurface : colors.text, fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '600' },
  prompt: { color: kua ? kua.onSurface : colors.text, fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 },
});
