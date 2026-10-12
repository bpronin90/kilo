import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';

export function Chevron({ color }) {
  return (
    <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

// The two daily-loop actions in one stable strip (#1333). #1341: shared by the
// normal training hero and the Recovery card, so whichever card leads Home
// carries "what to log next".
export function HomeActionStrip({ primaryLabel, primaryHint, onPrimary, onNavigate }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  const actionStroke = kua ? kua.primaryOnContainer : colors.textMuted;
  return (
    <View style={styles.heroPrimaryActions}>
      <Pressable
        testID="home-current-routine-link"
        onPress={onPrimary}
        style={styles.heroPrimaryAction}
        hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        accessibilityHint={primaryHint}
      >
        <Text style={styles.heroPrimaryActionText}>{primaryLabel}</Text>
        <Chevron color={actionStroke} />
      </Pressable>

      <View style={styles.heroPrimaryActionDivider} />

      <Pressable
        testID="home-weight-action"
        onPress={() => onNavigate('Weight')}
        style={styles.heroPrimaryAction}
        hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
        accessibilityRole="button"
        accessibilityLabel="Log weight"
        accessibilityHint="Opens the Weight tab to log a weigh-in"
      >
        <Text style={styles.heroPrimaryActionText}>Log weight</Text>
        <Chevron color={actionStroke} />
      </Pressable>
    </View>
  );
}
