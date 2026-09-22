import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../../theme/ThemeContext';

export function Card({ children, style, tone = 'default', onPress }) {
  const styles = useThemedStyles(createStyles);
  const Container = onPress ? Pressable : View;

  const baseStyles = [
    styles.card,
    tone === 'accent' ? styles.cardAccent : null,
    tone === 'success' ? styles.cardSuccess : null,
    tone === 'error' ? styles.cardError : null,
    tone === 'warn' ? styles.cardWarn : null,
    style
  ];

  if (!onPress) {
    return <View style={baseStyles}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        ...baseStyles,
        pressed ? { opacity: 0.7 } : null
      ]}
    >
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children }) {
  const styles = useThemedStyles(createStyles);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function ArtisanalPanel({ children, style }) {
  const styles = useThemedStyles(createStyles);
  return <View style={[styles.artisanalPanel, style]}>{children}</View>;
}

// Under the production KUA gate (#1139) the standard content card, panel, and
// section title resolve through the selected court palette (surface-card /
// surface-border / on-surface per components.md → Cards); outside the gate
// `kua` is null and they keep the legacy palette. The filled STATUS tones
// (accent/success/error/warn) carry a light label in both modes and stay on the
// AA-tuned legacy filled-tone surfaces — KUA has no always-light ink that clears
// AA on both a bright dark success/warning fill and a dark error fill, so, like
// the workout-family StatCard tones, they signal status rather than court.
const createStyles = (colors, kua = null) => StyleSheet.create({
  card: {
    backgroundColor: kua ? kua.surfaceCard : colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    gap: 10,
  },
  artisanalPanel: {
    backgroundColor: kua ? kua.surfaceCard : colors.panelBackground,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.divider,
    shadowColor: kua ? kua.onSurface : colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  // Filled tone cards render light text (textLight), so every tone uses its
  // mode-specific card surface (cardAccentBg/cardSuccessBg/cardCautionBg/
  // cardErrorBg) rather than the direct status color. Each pair is tuned to
  // WCAG AA 4.5:1 in both palettes and asserted in theme-rendering.test.js.
  cardAccent: {
    backgroundColor: colors.cardAccentBg,
    borderColor: colors.cardAccentBg,
  },
  cardSuccess: {
    backgroundColor: colors.cardSuccessBg,
    borderColor: colors.cardSuccessBg,
  },
  cardError: {
    backgroundColor: colors.cardErrorBg,
    borderColor: colors.cardErrorBg,
  },
  cardWarn: {
    backgroundColor: colors.cardCautionBg,
    borderColor: colors.cardCautionBg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
    marginTop: 6,
  },
});
