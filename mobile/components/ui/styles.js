import { useThemedStyles } from '../../theme/ThemeContext';
import { TYPOGRAPHY, TYPOGRAPHY_FALLBACK } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

export const SET_ROW_FONT_SIZE = TYPOGRAPHY['label-lg'].fontSize;

// Display exception per #1283 foundation: legacy (non-KUA) hero/stat sizes sit
// above the type scale and keep their pre-migration values. Every KUA consumer
// (homeStyles, AnalyticsStrengthSection) already branches to the fallback-aware
// metric-display roles via useKuaTypography(), so these only render in legacy
// mode, where the system-font 900 weight is the intended look.
export const HeroMetric = {
  hero:          { fontSize: 48, fontWeight: '900', lineHeight: 52 },
  statPrimary:   { fontSize: 32, fontWeight: '900' },
  statSecondary: { fontSize: 24, fontWeight: '900' },
  statTertiary:  { fontSize: 20, fontWeight: '900' },
};

// Shared text-input skin. Two forms because both call shapes exist (#689):
// createInputStyle(colors, kua) so a screen's own createStyles() factory can
// spread it, and useInputStyle() for the JSX call sites that apply it directly.
// Under the production KUA gate (#1139) it resolves through the selected court
// palette (surface-card / surface-border / on-surface per components.md →
// Inputs); outside the gate `kua` is null and it keeps the legacy palette.
export const createInputStyle = (colors, kua = null) => ({
  backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
  borderWidth: 1,
  borderColor: kua ? kua.surfaceBorder : colors.inputBorder,
  borderRadius: GEOMETRY['radius-xl'],
  paddingHorizontal: 12,
  paddingVertical: 12,
  fontSize: TYPOGRAPHY['body-md'].fontSize,
  color: kua ? kua.onSurface : colors.text,
});

export function useInputStyle() {
  return useThemedStyles(createInputStyle);
}

// Labelled form-field skin (#1440), the app-level treatment the shared
// TextField/DateField controls (components/FormControls.js) render with. Same
// palette roles as createInputStyle (inlined: the #1142 court-palette scan
// treats a factory-to-factory `kua` hand-off as unresolved), plus the 48dp
// field height and the JetBrains Mono label-lg value role, so numeric entries
// line up with the metrics they produce. `typo` is the fallback-aware role set from
// useKuaTypography(); null falls back to the system-font roles.
export const createFormFieldStyles = (colors, kua = null, typo = null) => {
  const valueRole = (typo || TYPOGRAPHY_FALLBACK)['label-lg'];
  const field = {
    backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
    borderWidth: 1,
    borderColor: kua ? kua.surfaceBorder : colors.inputBorder,
    color: kua ? kua.onSurface : colors.text,
    borderRadius: GEOMETRY['radius-2xl'],
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 48,
    ...valueRole,
    justifyContent: 'center',
    textAlignVertical: 'center',
  };
  return {
    input: field,
    numericInput: field,
    pickerText: { ...valueRole, color: field.color },
    pickerPlaceholder: {
      color: kua ? kua.onSurfaceVariant : colors.textMuted,
      opacity: 0.6,
      fontStyle: 'italic',
    },
  };
};

// Inline style for the web <input type="date"> the DateField renders (DOM
// style object: letterSpacing needs a px string and colorScheme follows mode).
export const createWebDateInputStyle = (colors, kua = null) => ({
  backgroundColor: kua ? kua.surfaceCard : colors.inputBackground,
  borderRadius: GEOMETRY['radius-2xl'],
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: kua ? kua.surfaceBorder : colors.inputBorder,
  padding: 14,
  minHeight: 48,
  ...(kua
    ? {
      fontFamily: TYPOGRAPHY['label-lg'].fontFamily,
      fontSize: TYPOGRAPHY['label-lg'].fontSize,
      letterSpacing: `${TYPOGRAPHY['label-lg'].letterSpacing}px`,
      fontVariantNumeric: 'tabular-nums',
    }
    : { fontSize: TYPOGRAPHY['label-lg'].fontSize, fontFamily: 'inherit' }),
  colorScheme: colors.scheme,
  color: kua ? kua.onSurface : colors.text,
  width: '100%',
  boxSizing: 'border-box',
});
