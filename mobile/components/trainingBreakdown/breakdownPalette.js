import { scrim, withAlpha } from '../../theme/styleHelpers';

// Training breakdown dashboard (#1588) colour roles. Every value resolves from an
// existing palette role: the selected court's KUA palette when present, the
// legacy appearance palette otherwise. Heat steps and the comparison's second
// series are derived from those roles (primary opacity steps, onSurfaceVariant);
// no new token and no prototype hex value is introduced here.
export function resolveBreakdownPalette(colors, kua, mode) {
  if (kua) {
    return {
      canvas: kua.surface || kua.background,
      card: kua.surfaceCard,
      section: kua.surfaceSection,
      sheet: kua.surfaceCardHeader || kua.surfaceCard,
      border: kua.surfaceBorder,
      primary: kua.primary,
      container: kua.primaryContainer,
      containerBorder: kua.primaryContainerBorder,
      onContainer: kua.primaryOnContainer,
      ink: kua.onSurface,
      muted: kua.onSurfaceVariant,
      onPrimary: kua.onPrimary || kua.surfaceCard,
      scrim: scrim(mode),
    };
  }
  return {
    canvas: colors.background,
    card: colors.card,
    section: colors.inputBackground || colors.background,
    sheet: colors.card,
    border: colors.inputBorder || colors.cardBorder,
    primary: colors.accent,
    container: colors.chipBackground,
    containerBorder: colors.accent,
    onContainer: colors.chipText,
    ink: colors.text,
    muted: colors.textMuted,
    onPrimary: colors.textLight,
    scrim: scrim(mode),
  };
}

const parseHex = (hex) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Heat alpha for a value relative to the largest value on screen (0..1).
export const heatAlpha = (t) => 0.14 + Math.max(0, Math.min(1, t)) * 0.8;

// Tile fill for relative intensity `t`, plus the ink (onSurface or onPrimary)
// with the better contrast against the composited fill, so the printed values
// stay readable at every step in every court and mode.
export function heatFill(p, t) {
  const alpha = heatAlpha(t);
  const fill = withAlpha(p.primary, alpha);
  const fg = parseHex(p.primary);
  const bg = parseHex(p.card);
  if (!fg || !bg) return { backgroundColor: fill, ink: p.ink };
  const mixed = fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
  const inkRgb = parseHex(p.ink);
  const onRgb = parseHex(p.onPrimary);
  const ink = inkRgb && onRgb && contrastRatio(onRgb, mixed) > contrastRatio(inkRgb, mixed) ? p.onPrimary : p.ink;
  return { backgroundColor: fill, ink };
}

export const tint = (hex, alpha) => withAlpha(hex, alpha);
