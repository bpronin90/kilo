import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../../theme/ThemeContext';
import { SET_ROW_FONT_SIZE } from './styles';
import { withAlpha } from '../../theme/styleHelpers';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

// A single unrecognized set-row line in the read view. Without a parser
// `error` this preserves the prior bare-raw rendering (non-weight rows and
// fallback duplicates), muted or error-red per the section mode. With an
// `error` it adds a non-color-only affordance: a ⚠ glyph, the actionable
// parser message beneath the raw line, and an `accessibilityLabel` naming the
// raw line and its recovery hint so screen-reader users get the same guidance
// as the red text conveys visually (WCAG 1.4.1).
export function UnparsedRow({ raw, error, muted, selectable }) {
  const styles = useThemedStyles(createStyles);
  const rawStyle = muted ? styles.unparsedRowMuted : styles.unparsedRow;
  if (!error) {
    return (
      <Text selectable={selectable} style={rawStyle}>
        {raw}
      </Text>
    );
  }
  return (
    <View
      style={styles.unparsedGroup}
      accessible={true}
      accessibilityLabel={`Unrecognized set row: ${raw}. ${error}`}
    >
      <View style={styles.unparsedRawLine}>
        <Text style={muted ? styles.unparsedGlyphMuted : styles.unparsedGlyph}>⚠</Text>
        <Text selectable={selectable} style={rawStyle}>{raw}</Text>
      </View>
      <Text selectable={selectable} style={styles.unparsedHint}>{error}</Text>
    </View>
  );
}

// Note-level parse-failure affordance for a whole note the parser refuses
// (e.g. an oversize note returning `ok: false`). Replaces the blank read view
// with a visible, accessibility-labeled message so the failure is never
// silent. No synthetic exercise/section is invented.
export function NoteParseError({ message }) {
  const styles = useThemedStyles(createStyles);
  const text = message || 'This note could not be parsed.';
  return (
    <View
      style={styles.noteParseError}
      accessible={true}
      accessibilityLabel={`Note could not be parsed. ${text}`}
    >
      <Text style={styles.noteParseErrorText}>{`⚠ ${text}`}</Text>
    </View>
  );
}

export function ErrorBanner({ message, onRetry }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{message || 'Failed to load data.'}</Text>
      {onRetry && (
        <Pressable
          onPress={onRetry}
          style={styles.errorBannerRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <Text style={styles.errorBannerRetryText} accessible={false}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

// Under the production KUA gate (#1139) the error/parse-failure feedback
// surfaces resolve through the selected court palette; outside the gate `kua`
// is null and they keep the unchanged legacy palette. Danger copy on the tinted
// surface uses `errorText` (the AA-safe foreground ink), never the `error`
// fill/border red — matching backupStyles.js's Danger Zone treatment.
const createStyles = (colors, kua = null) => StyleSheet.create({
  errorBanner: {
    backgroundColor: kua ? withAlpha(kua.error, 0.14) : colors.errorSurface,
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua ? kua.error : colors.error,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.errorText : colors.error,
  },
  // Legacy: a filled error *surface* tone (dark mode's `error` is a bright
  // foreground red that cannot carry a textLight label). KUA: a transparent
  // outlined ghost repointed to the `error` outline / `errorText` label, so the
  // retry action clears AA on the tinted banner without an always-light ink.
  errorBannerRetry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? 'transparent' : colors.cardErrorBg,
    borderWidth: kua ? 1 : 0,
    borderColor: kua ? kua.error : 'transparent',
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBannerRetryText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: kua ? kua.errorText : colors.textLight,
  },
  // Unparsed-row styles. unparsedRow/unparsedRowMuted keep the exact single
  // color tokens the read view relied on before (colors.error for unresolved
  // lifting fallbacks, colors.text otherwise) so per-mode color parity holds.
  // The unresolved-line ink is danger text on the section surface, so KUA uses
  // the AA-safe `errorText` foreground rather than the `error` fill red.
  unparsedRow: {
    fontSize: SET_ROW_FONT_SIZE,
    color: kua ? kua.errorText : colors.error,
    paddingLeft: 0,
  },
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: kua ? kua.onSurface : colors.text,
    paddingLeft: 0,
  },
  unparsedGroup: {
    paddingLeft: 0,
    gap: 1,
  },
  unparsedRawLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  unparsedGlyph: {
    fontSize: SET_ROW_FONT_SIZE,
    color: kua ? kua.errorText : colors.error,
  },
  unparsedGlyphMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  unparsedHint: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    paddingLeft: 18,
  },
  noteParseError: {
    borderRadius: GEOMETRY['radius-xl'],
    borderWidth: 1,
    borderColor: kua ? kua.error : colors.error,
    backgroundColor: kua ? kua.surfaceCard : colors.panelBackground,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  noteParseErrorText: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '600',
    color: kua ? kua.errorText : colors.error,
  },
});
