// BackupScreen styles (issue #1060 split of BackupScreen.js).
//
// The themed StyleSheet factory, extracted verbatim so the screen component
// stays under the 600-line cap. Consumed via useThemedStyles(createStyles).

import { StyleSheet } from 'react-native';

// `kua.error` is a plain `#rrggbb` string, fixed across all six theme/mode
// combinations (theme/colors.js) — this derives a tinted danger fill from it
// so the Danger Zone reads as danger-coded by background, not border alone,
// in every palette. Mirrors the withAlpha helper in LogRecoveryWeeks.js.
function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// `kua` is the active KUA palette (theme.kuaPalette) or null; `typography` is
// the result of useKuaTypography() — see SettingsScreen/WeightScreen for the
// same conditional-token pattern this screen follows.
export const createStyles = (colors, kua = null, typography = {}) => StyleSheet.create({
  // Section headers: KUA renders an uppercase label-sm micro-header
  // (onSurfaceVariant) in place of the legacy SectionTitle, matching
  // SettingsScreen's KUA migration.
  sectionHeader: {
    ...(typography['label-sm'] ?? { fontSize: 11, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: kua ? kua.onSurface : colors.textLight,
    textAlign: 'center',
  },
  // Success/error status card container — KUA uses a tinted-not-filled
  // surface (surfaceCard) with a tone-colored border, matching the
  // errorBanner treatment in weightStyles.js rather than the legacy filled
  // Card tone.
  statusCardSuccess: {
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.success : undefined,
  },
  statusCardError: {
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.error : undefined,
  },
  statusTextSuccess: {
    color: kua ? kua.success : undefined,
  },
  statusTextError: {
    color: kua ? kua.error : undefined,
  },
  helpText: {
    fontSize: 15,
    lineHeight: 22,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Caution ink (not error): "unencrypted export" and "wipe retry needed" are
  // disclosures/prompts, not failures, so KUA uses the dedicated `warning`
  // token rather than `error` — matching the legacy `cautionText` intent this
  // replaces (#914-style status-meaning preservation).
  warnText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: kua ? kua.warning : (colors.cautionText ?? colors.error ?? colors.textMuted),
  },
  actionButton: {
    marginTop: 12,
  },
  // Danger-zone buttons keep the shared Button `tone="danger"` shape
  // (transparent fill, outlined) but repoint the outline/label to the KUA
  // error token instead of the legacy `colors.error`.
  dangerButton: {
    borderColor: kua ? kua.error : undefined,
  },
  dangerButtonText: {
    color: kua ? kua.error : undefined,
  },
  importInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: kua ? kua.onSurface : colors.text,
    fontFamily: 'monospace',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  // Card tone="accent" is a filled dark surface; its label needs the light
  // contrasting ink rather than the default muted text color. In KUA mode the
  // Cloud sign-in prompt instead uses the tinted primaryContainer surface, so
  // its label takes primaryOnContainer via `accentCardStyle`/`textAccent`
  // below rather than this legacy override.
  textLight: {
    color: kua ? kua.primaryOnContainer : colors.textLight,
  },
  // Irreversible-action container: error-tinted surface groups Wipe Device
  // Data apart from routine export/import/sync. See ui-design-rules.md #14.
  // KUA must never fall back to the plain `surfaceCard` neutral fill every
  // other card on this screen uses — that would read as an ordinary card and
  // lose the danger semantic — so this tints `kua.error` itself rather than
  // reusing a non-danger surface token.
  dangerZone: {
    backgroundColor: kua ? withAlpha(kua.error, 0.14) : colors.errorSurface,
    borderWidth: 1,
    borderColor: kua ? kua.error : colors.error,
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  dangerZoneHeading: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerZoneHeadingText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: kua ? kua.error : colors.error,
  },
});
