import { useThemedStyles } from '../../theme/ThemeContext';
import { TYPOGRAPHY } from '../../theme/typography';

export const SET_ROW_FONT_SIZE = TYPOGRAPHY['label-lg'].fontSize;

// Display exception per #1283 foundation: these hero/stat sizes sit above the
// type scale and keep their pre-migration size, but they carry the quantitative
// (JetBrains Mono, metric-display) family, tracking and tabular figures. The
// weight-specific family replaces the literal 900 so no synthetic bold is added.
const HERO_MONO = (() => {
  const { fontFamily, letterSpacing, fontVariant } = TYPOGRAPHY['metric-display'];
  return { fontFamily, letterSpacing, fontVariant };
})();

export const HeroMetric = {
  hero:          { ...HERO_MONO, fontSize: 48, lineHeight: 52 },
  statPrimary:   { ...HERO_MONO, fontSize: 32 },
  statSecondary: { ...HERO_MONO, fontSize: 24 },
  statTertiary:  { ...HERO_MONO, fontSize: 20 },
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
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 12,
  fontSize: 15,
  color: kua ? kua.onSurface : colors.text,
});

export function useInputStyle() {
  return useThemedStyles(createInputStyle);
}
