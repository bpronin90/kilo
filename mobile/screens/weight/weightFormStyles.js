import { GEOMETRY } from '../../theme/spacing';
import { TYPOGRAPHY, TYPOGRAPHY_FALLBACK } from '../../theme/typography';

// Single source for the Weight form controls shared by the weigh-in entry panel
// (WeightEntryForm) and the Goal card (WeightGoalCard). The weigh-in panel is the
// visual reference; goal-specific layout stays local to the Goal card.
const monoRole = (typo, role) => (typo || TYPOGRAPHY_FALLBACK)[role];

export const createWeightFormStyles = (colors, kua = null, typo = null) => {
  const field = {
    backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
    borderRadius: GEOMETRY['radius-2xl'],
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 48,
    ...monoRole(typo, 'label-lg'),
    color: kua ? kua.onSurface : colors.text,
    justifyContent: 'center',
    textAlignVertical: 'center',
  };
  return {
    inputLabel: {
      fontSize: TYPOGRAPHY['body-sm'].fontSize,
      fontWeight: '700',
      color: kua ? kua.onSurfaceVariant : colors.textMuted,
    },
    input: field,
    numericInput: field,
    pickerText: {
      ...monoRole(typo, 'label-lg'),
      color: kua ? kua.onSurface : colors.text,
    },
  };
};

// DOM (react-native-web) equivalent of a mono role: letterSpacing needs a px string.
const domMonoRole = (role) => ({
  fontFamily: TYPOGRAPHY[role].fontFamily,
  fontSize: TYPOGRAPHY[role].fontSize,
  letterSpacing: `${TYPOGRAPHY[role].letterSpacing}px`,
  fontVariantNumeric: 'tabular-nums',
});

// Inline style for the web <input type="date"> used by both panels.
export const webDateInputStyle = (colors, kua = null) => ({
  backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
  borderRadius: GEOMETRY['radius-2xl'],
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: kua ? kua.surfaceBorder : colors.inputBorder,
  padding: 14,
  minHeight: 48,
  ...(kua ? domMonoRole('label-lg') : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontFamily: 'inherit' }),
  colorScheme: colors.scheme,
  color: kua ? kua.onSurface : colors.text,
  width: '100%',
  boxSizing: 'border-box',
});
