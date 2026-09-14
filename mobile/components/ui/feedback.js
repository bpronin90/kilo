import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../../theme/ThemeContext';
import { SET_ROW_FONT_SIZE } from './styles';

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

const createStyles = (colors) => StyleSheet.create({
  errorBanner: {
    backgroundColor: colors.errorSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
  // Filled, so it takes the error *surface* tone rather than the direct error
  // color: dark mode's `error` is a bright foreground red that cannot carry a
  // textLight label.
  errorBannerRetry: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.cardErrorBg,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBannerRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textLight,
  },
  // Unparsed-row styles. unparsedRow/unparsedRowMuted keep the exact single
  // color tokens the read view relied on before (colors.error for unresolved
  // lifting fallbacks, colors.text otherwise) so per-mode color parity holds.
  unparsedRow: {
    fontSize: SET_ROW_FONT_SIZE,
    color: colors.error,
    paddingLeft: 0,
  },
  unparsedRowMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: colors.text,
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
    color: colors.error,
  },
  unparsedGlyphMuted: {
    fontSize: SET_ROW_FONT_SIZE,
    color: colors.textMuted,
  },
  unparsedHint: {
    fontSize: SET_ROW_FONT_SIZE - 1,
    color: colors.textMuted,
    paddingLeft: 18,
  },
  noteParseError: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.panelBackground,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  noteParseErrorText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
});
