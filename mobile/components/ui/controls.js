import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../../theme/ThemeContext';

export function Button({ onPress, title, loadingTitle, loading, style, textStyle, disabled = false, accessibilityLabel, tone = 'default' }) {
  const styles = useThemedStyles(createStyles);
  // Disabled and loading are different states. Preserve the existing shorthand
  // for callers that provide loadingTitle alongside disabled={busy}, while
  // allowing validation-disabled actions to keep their real label.
  const showLoading = loading === undefined ? disabled && Boolean(loadingTitle) : loading;
  // Announce the control as a button and expose truthful disabled/busy state so
  // assistive tech reflects both the non-interactive and loading conditions.
  // Titles stay the accessible name unless a caller supplies an explicit label.
  return (
    <Pressable
      onPress={disabled ? null : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: showLoading }}
      style={[styles.button, tone === 'danger' ? styles.buttonDanger : null, disabled ? styles.buttonDisabled : null, style]}
    >
      <Text style={[styles.buttonText, tone === 'danger' ? styles.buttonTextDanger : null, textStyle]}>
        {showLoading ? (loadingTitle || 'Saving…') : title}
      </Text>
    </Pressable>
  );
}

export function Badge({ children, status = 'default' }) {
  const styles = useThemedStyles(createStyles);
  const isDarkStatus = ['improved', 'regressed', 'held'].includes(status);
  return (
    <View style={[styles.badge, styles[`badge_${status}`]]}>
      <Text style={[styles.badgeText, isDarkStatus ? styles.textLight : null]}>
        {children}
      </Text>
    </View>
  );
}

export function Chip({ children }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{children}</Text>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  button: {
    backgroundColor: colors.text,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  // Destructive/irreversible actions: transparent fill with an error-colored
  // outline and label, so severity reads as hierarchy (a visually distinct
  // control) rather than color alone — the wording still states the
  // consequence. See ui-design-rules.md #14.
  buttonDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.error,
  },
  buttonTextDanger: {
    color: colors.error,
  },
  // The pill is the palette `text`, so the label is the semantic contrasting
  // ink: light mode stays dark pill / light label, dark mode inverts to light
  // pill / dark label. Both exceed 4.5:1 (15.65:1 and 16.81:1).
  buttonText: {
    color: colors.buttonLabel,
    fontSize: 16,
    fontWeight: '700',
  },
  textLight: {
    color: colors.textLight,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
  },
  // Trend badges render light text (textLight) for improved/held/regressed, so
  // all three take the mode-specific filled tone surfaces rather than the
  // direct status colors.
  badge_improved: {
    backgroundColor: colors.cardSuccessBg,
  },
  badge_regressed: {
    backgroundColor: colors.cardErrorBg,
  },
  badge_held: {
    backgroundColor: colors.cardAccentBg,
  },
  badge_first_session: {
    backgroundColor: colors.chipBackground,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.chipText,
    textTransform: 'uppercase',
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.chipBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chipText,
  },
});
