// BackupScreen styles (issue #1060 split of BackupScreen.js).
//
// The themed StyleSheet factory, extracted verbatim so the screen component
// stays under the 600-line cap. Consumed via useThemedStyles(createStyles).

import { StyleSheet } from 'react-native';

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
  warnText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: kua ? kua.error : (colors.cautionText ?? colors.error ?? colors.textMuted),
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
  dangerZone: {
    backgroundColor: kua ? kua.surfaceCard : colors.errorSurface,
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
