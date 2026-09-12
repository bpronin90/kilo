import { useThemedStyles } from '../../theme/ThemeContext';

export const SET_ROW_FONT_SIZE = 14;

export const HeroMetric = {
  hero:          { fontSize: 48, fontWeight: '900', lineHeight: 52 },
  statPrimary:   { fontSize: 32, fontWeight: '900' },
  statSecondary: { fontSize: 24, fontWeight: '900' },
  statTertiary:  { fontSize: 20, fontWeight: '900' },
};

// Shared text-input skin. Two forms because both call shapes exist (#689):
// createInputStyle(colors) so a screen's own createStyles() factory can spread
// it, and useInputStyle() for the JSX call sites that apply it directly.
export const createInputStyle = (colors) => ({
  backgroundColor: colors.inputBackground,
  borderWidth: 1,
  borderColor: colors.inputBorder,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 12,
  fontSize: 15,
  color: colors.text,
});

export function useInputStyle() {
  return useThemedStyles(createInputStyle);
}
