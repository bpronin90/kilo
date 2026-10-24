import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { createStyles } from './homeStyles';
import { useKuaTypography } from '../../theme/typography';
import { Icon } from '../../components/Icon';

export function Chevron({ color }) {
  return (
    <Svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" accessible={false}>
      <Path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

// The two daily-loop actions (#1333). #1341: shared by the normal training
// hero and the Recovery card, so whichever card leads Home carries "what to log
// next". Redesign v3 (#1605): a filled primary button and an outlined
// secondary one, side by side at >=48dp.
export function HomeActionStrip({ primaryLabel, primaryHint, onPrimary, onNavigate, primaryIcon = 'add' }) {
  const { colors, kuaPalette: kua } = useTheme();
  const typography = useKuaTypography();
  const styles = useMemo(() => createStyles(colors, kua, typography), [colors, kua, typography]);
  return (
    <View style={styles.heroPrimaryActions}>
      <Pressable
        testID="home-current-routine-link"
        hitSlop={4}
        onPress={onPrimary}
        style={[styles.heroButton, styles.heroButtonPrimary]}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        accessibilityHint={primaryHint}
      >
        {primaryIcon ? <Icon name={primaryIcon} size={18} color={kua ? kua.onPrimary : colors.buttonLabel} /> : null}
        <Text style={[styles.heroButtonText, styles.heroButtonPrimaryText]} numberOfLines={1}>{primaryLabel}</Text>
      </Pressable>
      <Pressable
        testID="home-weight-action"
        hitSlop={4}
        onPress={() => onNavigate('Weight')}
        style={[styles.heroButton, styles.heroButtonGhost]}
        accessibilityRole="button"
        accessibilityLabel="Log weight"
        accessibilityHint="Opens the Weight tab to log a weigh-in"
      >
        <Text style={[styles.heroButtonText, styles.heroButtonGhostText]} numberOfLines={1}>Log weight</Text>
      </Pressable>
    </View>
  );
}
