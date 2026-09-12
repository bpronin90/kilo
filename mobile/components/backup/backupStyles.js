// BackupScreen styles (issue #1060 split of BackupScreen.js).
//
// The themed StyleSheet factory, extracted verbatim so the screen component
// stays under the 600-line cap. Consumed via useThemedStyles(createStyles).

import { StyleSheet } from 'react-native';

export const createStyles = (colors) => StyleSheet.create({
  statusText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textLight,
    textAlign: 'center',
  },
  helpText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
  },
  warnText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.cautionText ?? colors.error ?? colors.textMuted,
  },
  actionButton: {
    marginTop: 12,
  },
  importInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: colors.text,
    fontFamily: 'monospace',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  // Card tone="accent" is a filled dark surface; its label needs the light
  // contrasting ink rather than the default muted text color.
  textLight: {
    color: colors.textLight,
  },
  // Irreversible-action container: error-tinted surface groups Wipe Device
  // Data apart from routine export/import/sync. See ui-design-rules.md #14.
  dangerZone: {
    backgroundColor: colors.errorSurface,
    borderWidth: 1,
    borderColor: colors.error,
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
    color: colors.error,
  },
});
