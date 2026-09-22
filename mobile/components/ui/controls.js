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

// When the production KUA gate supplies `kua` (#1139) the primary button, chip,
// and trend badges resolve through the selected court palette; rendered outside
// the gate (isolated tests) `kua` is null and every role falls back to the
// unchanged legacy palette. KUA mappings follow components.md: the primary
// action button is `primary` fill / `on-primary` label, the danger button keeps
// its transparent-outline hierarchy repointed to `error`/`errorText`, and chips
// use the tinted `primary-container` / `primary-on-container` pair.
const createStyles = (colors, kua = null) => StyleSheet.create({
  button: {
    backgroundColor: kua ? kua.primary : colors.text,
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
  // consequence. See ui-design-rules.md #14. `error` is the shared danger FILL
  // used for the outline; the label takes `errorText`, the AA-safe foreground
  // ink (the fill red is only ~2.6:1 as text on dark cards).
  buttonDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: kua ? kua.error : colors.error,
  },
  buttonTextDanger: {
    color: kua ? kua.errorText : colors.error,
  },
  // The pill is the palette `text` (legacy) or `primary` (KUA), so the label is
  // the semantic contrasting ink: legacy inverts dark/light pill vs label
  // (15.65:1 / 16.81:1); KUA uses `on-primary`, tuned to AA on `primary` in
  // every court/mode combination (theme-rendering.test.js).
  buttonText: {
    color: kua ? kua.onPrimary : colors.buttonLabel,
    fontSize: 16,
    fontWeight: '700',
  },
  // Badge-only light label for filled trend tones; paired with the legacy
  // filled-tone badge surfaces above, so it stays on the legacy always-light
  // ink rather than KUA's mode-dependent on-primary.
  textLight: {
    color: colors.textLight,
  },
  // Trend badges (improved/held/regressed) are a filled status surface with a
  // light label in BOTH modes (legacy `textLight` stays light in dark mode).
  // KUA has no single always-light ink that clears AA on both a bright dark
  // `success` fill and a dark `error` fill, so — like the workout-family
  // StatCard/SessionGauge tones — the trend badge keeps the legacy filled-tone
  // palette rather than inventing a token. Not one of the court-identity shell
  // primitives (#1139); its status meaning, not the court, is what it signals.
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.chipBackground,
  },
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
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: kua ? kua.primaryOnContainer : colors.chipText,
  },
});
