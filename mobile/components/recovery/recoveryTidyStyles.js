import { StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

// Tidy names preview (#1309). Buttons and captions reuse the Recovery card's
// reason-editor tokens (analyticsRecoveryStyles); only the preview list is new.
export const createTidyStyles = (colors, kua = null) => StyleSheet.create({
  preview: {
    gap: 8,
    padding: 12,
    borderRadius: GEOMETRY['radius-lg'],
    backgroundColor: kua ? kua.surfaceSection : colors.subtleBg,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  sectionLabel: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  row: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    lineHeight: 18,
    color: kua ? kua.onSurface : colors.text,
  },
  meta: {
    fontSize: TYPOGRAPHY['label-md'].fontSize,
    lineHeight: 16,
    paddingLeft: 12,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  noteText: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
});
