// Kilo appearance palettes (#689).
//
// Two complete semantic palettes — refreshed Light and Dark (indigo) — that
// share the brand-orange accent #d98d42. Every visual color in the app resolves
// through one of these role names; nothing imports a static `Colors` object any
// more. Screens read the active palette from `useTheme()` (theme/ThemeContext)
// so a preference or OS scheme change repaints immediately.
//
// Contrast notes (WCAG 2.1 AA, 4.5:1 for normal text) are recorded next to the
// roles they constrain and are asserted automatically in
// tests/theme-rendering.test.js.

export const LightColors = {
  // CSS `color-scheme` for the web-only DOM controls (the `<input type="date">`
  // fallbacks), so the browser's own picker chrome matches the app appearance
  // instead of always rendering light.
  scheme: 'light',
  background: '#f7f2ea',
  card: '#ffffff',
  cardBorder: 'rgba(34,28,23,0.1)',
  accent: '#d98d42',
  text: '#221c17',
  textMuted: '#6b6259',
  textLight: '#faf6f0',
  tabBarBackground: '#201914',
  tabInactive: '#8a8177',
  inputBackground: '#fbf8f3',
  inputBorder: 'rgba(34,28,23,0.16)',
  chipBackground: '#f3ddc0',
  chipText: '#96571c',
  success: '#4a7c44',
  error: '#b03a2e',
  caution: '#c98f1a',
  divider: 'rgba(31,26,23,0.05)',
  subtleBg: 'rgba(34,28,23,0.04)',
  panelBackground: '#ffffff',

  // Filled tone surfaces (UI.js Card/StatCard tones and trend badges) render
  // `textLight`, so they use their own darkened tones rather than the direct
  // status colors. Ratios against textLight #faf6f0: accent 5.30:1,
  // success 6.72:1, caution 5.28:1, error 5.59:1.
  cardAccentBg: '#96571c',
  cardSuccessBg: '#3a6035',
  cardCautionBg: '#7f6310',
  cardErrorBg: '#b03a2e',

  // Label on the shared Button, whose background is the palette `text`.
  // #221c17 pill / #faf6f0 label -> 15.65:1.
  buttonLabel: '#faf6f0',
  // Label on small accent-filled controls (segmented-control active item,
  // confirm affordances). Light mode uses the palette `text` ink: white on the
  // #d98d42 accent measures only 2.68:1, while #221c17 clears AA at 6.29:1.
  onAccent: '#221c17',

  // Text ink for accent/caution *copy* (#908). The direct `accent` and
  // `caution` values are mark colors: on light surfaces they measure 2.68:1
  // and 2.83:1 against `card`, far under AA. These darkened inks carry the
  // same semantics for anything the user reads.
  //
  // Both are darkened past the obvious `chipText`/`cautionSurfaceText` reuse
  // because accent and caution copy also lands on `chipBackground` — the
  // Settings stepper, the Big 3 slot picker's selected row, Recovery's retry
  // button, Home's sync notice, and the history list's pressed rows. At
  // `#96571c`/`#7f6310` that pairing measured 4.33:1/4.31:1 (#915 review).
  // Those five accent strings carry `chipAccentText` as of #923 — whose light
  // value is this one — while caution copy still meets the chip directly.
  //
  // Ratios against card / background / subtleBg:
  // accentText 6.60 / 5.92 / 6.11, cautionText 7.04 / 6.32 / 6.51.
  // `cautionText` also clears `chipBackground` at 5.34; accent copy that can
  // land on a chip fill uses `chipAccentText` instead, in both modes.
  accentText: '#8a4e15',
  cautionText: '#6f5510',

  // Accent copy that can land on a `chipBackground` fill in any state (#918).
  // Light mode already clears AA there with `accentText`, so this is the same
  // value; the token exists because dark mode needs a different one and a
  // string must carry one role name across both palettes. No new color: this
  // half is `accentText`'s own light value.
  //
  // Ratios against card / background / subtleBg / chipBackground:
  // 6.60 / 5.92 / 6.11 / 5.00.
  chipAccentText: '#8a4e15',

  // Tinted (not filled) status surfaces. Labels are `error` and
  // `cautionSurfaceText`: error 5.26:1, caution 4.84:1.
  errorSurface: '#fdeceb',
  cautionSurface: '#f7ecd2',
  cautionSurfaceText: '#7f6310',

  // "Rough session" tier surface in the check-in modal; label is `chipText`
  // (5.01:1).
  roughBackground: '#fbeee0',
  roughBorder: '#e5c49c',

  // Modal scrim and shadow ink.
  overlay: 'rgba(31,26,23,0.55)',
  shadowColor: '#000000',
};

export const DarkColors = {
  scheme: 'dark',
  background: '#100f1a',
  // Deliberate elevation jump from `background`; do not collapse the two.
  card: '#1e1c2c',
  cardBorder: 'rgba(217,141,66,0.28)',
  accent: '#d98d42',
  text: '#f2f0f7',
  textMuted: '#a29fb3',
  textLight: '#f2f0f7',
  tabBarBackground: '#1e1c2c',
  tabInactive: '#6a6780',
  inputBackground: '#242235',
  inputBorder: 'rgba(217,141,66,0.28)',
  chipBackground: 'rgba(217,141,66,0.32)',
  chipText: '#ffc98a',
  success: '#7ed968',
  error: '#f2705c',
  caution: '#f2b94a',
  divider: 'rgba(255,255,255,0.08)',
  subtleBg: 'rgba(255,255,255,0.06)',
  panelBackground: '#1e1c2c',

  // Dark filled tone surfaces. The bright direct status colors above are for
  // marks and text only — they cannot carry a `textLight` label — so these are
  // separate, deeper tones. Ratios against textLight #f2f0f7: accent 6.60:1,
  // success 7.11:1, caution 6.54:1, error 7.40:1.
  cardAccentBg: '#7a4a14',
  cardSuccessBg: '#2f5a28',
  cardCautionBg: '#6b5210',
  cardErrorBg: '#8a2f24',

  // Button inverts in dark mode: light #f2f0f7 pill / dark #100f1a label ->
  // 16.81:1.
  buttonLabel: '#100f1a',
  // Dark ink on the accent reads correctly against a dark shell and, unlike
  // white, is accessible on #d98d42 (7.09:1).
  onAccent: '#100f1a',

  // Text ink for accent/caution copy (#908). Dark mode already clears AA with
  // the direct mark values, so these keep them unchanged. Ratios against
  // card / background / subtleBg: accentText 6.23 / 7.09 / 5.24,
  // cautionText 9.39 / 10.69 / 7.89 — the latter also clears `chipBackground`
  // at 5.33.
  //
  // `accentText` must not be used on `chipBackground`: it measures 3.54:1
  // there, because that fill is the accent itself at 32% over `card`, so
  // accent-colored copy on it is inherently low-contrast. Chip-filled accent
  // copy takes `chipAccentText` below. As of #923 no shipping surface pairs
  // the two, so this is a boundary on the token rather than a gap the app
  // ships; the 3.54:1 stays pinned in tests/theme-rendering.test.js to record
  // why the pairing is unavailable.
  accentText: '#d98d42',
  cautionText: '#f2b94a',

  // Accent copy that can land on a `chipBackground` fill in any state (#918).
  // `accentText`'s 3.54:1 on that fill is the shortfall described above, so
  // chip-filled accent copy uses this lighter warm orange. No new color: it is
  // `chipText`'s own dark value, which is the ink the chip is already paired
  // with — recombined into an accent-copy role that also clears every other
  // surface, so a string that is only *sometimes* on a chip can carry it
  // everywhere.
  //
  // Ratios against card / background / subtleBg / chipBackground:
  // 11.11 / 12.64 / 9.33 / 6.31.
  chipAccentText: '#ffc98a',

  // Tinted status surfaces: error 5.20:1, caution 8.33:1.
  errorSurface: '#3a1f1c',
  cautionSurface: '#2e2717',
  cautionSurfaceText: '#f2b94a',

  // Rough tier surface; label is `chipText` (10.01:1).
  roughBackground: '#2a2338',
  roughBorder: 'rgba(217,141,66,0.32)',

  overlay: 'rgba(0,0,0,0.65)',
  shadowColor: '#000000',
};

export const PALETTES = { light: LightColors, dark: DarkColors };

// Resolve a mode name to its palette. Anything unrecognized falls back to
// light so a bad value can never render an unstyled screen.
export function paletteForMode(mode) {
  return mode === 'dark' ? DarkColors : LightColors;
}

// ---------------------------------------------------------------------------
// KUA semantic token system — Phase 3 D1 (#1096)
//
// Six complete palettes for Hard Court, Clay Court, and Grass Court in light
// and dark modes. Token names are camelCase. Existing LightColors/DarkColors
// are unchanged; these palettes are additive exports only.
//
// Authority: docs/design/kinetic-utilitarian-athletic/tokens.md
// ---------------------------------------------------------------------------

// Shared semantic tokens are fixed values across all three themes.
// selection maps to each theme's primaryContainer per the spec.
const KUA_SHARED_LIGHT = {
  success: '#006C4A',
  warning: '#B45309',
  // Error INK for text/icons on surfaces (distinct from `error`, the danger
  // FILL). The fill red (#BA1A1A) is only ~2.6:1 as text on dark cards; this
  // mode-appropriate pair clears AA on every KUA canvas and card surface
  // (min 5.86:1 light / 5.78:1 dark).
  errorText: '#B3261E',
  chartSeries1: '#0C7489',
  chartSeries2: '#C2410C',
  chartSeries3: '#7C3AED',
};

const KUA_SHARED_DARK = {
  success: '#10B981',
  warning: '#FBBF24',
  errorText: '#F2705C',
  chartSeries1: '#22D3EE',
  chartSeries2: '#F59E0B',
  chartSeries3: '#A78BFA',
};

export const HardCourtLightColors = {
  background: '#EEF3F9',
  surface: '#EEF3F9',
  surfaceCard: '#FFFFFF',
  surfaceSubtle: '#EEF3F9',
  surfaceBorder: '#DDE6F2',
  surfaceCardHeader: '#EEF3F9',
  surfaceSection: '#EEF3F9',
  primary: '#0A4ABF',
  primaryContainer: '#E1ECFB',
  primaryContainerBorder: '#9BC1F5',
  primaryOnContainer: '#083B9A',
  onSurface: '#0E1726',
  onSurfaceVariant: '#5A687A',
  completion: '#006C4A',
  onPrimary: '#FFFFFF',
  tabBarBg: '#FFFFFF',
  headerBg: '#EEF3F9',
  error: '#BA1A1A',
  selection: '#E1ECFB',
  ...KUA_SHARED_LIGHT,
};

export const HardCourtDarkColors = {
  background: '#080D18',
  surface: '#080D18',
  surfaceCard: '#101728',
  surfaceCardHeader: '#131D32',
  surfaceSection: '#0E1524',
  surfaceBorder: '#1C2742',
  primary: '#3B82F6',
  primaryLight: '#60A5FA',
  primaryContainer: '#17233D',
  primaryContainerBorder: '#2A3F6D',
  primaryOnContainer: '#60A5FA',
  onSurface: '#F0F4FC',
  onSurfaceVariant: '#8C9BB3',
  completion: '#10B981',
  onPrimary: '#080D18',
  tabBarBg: '#080D18',
  headerBg: '#080D18',
  error: '#BA1A1A',
  selection: '#17233D',
  ...KUA_SHARED_DARK,
};

export const ClayCourtLightColors = {
  background: '#F8F5EE',
  surface: '#F8F5EE',
  surfaceCard: '#FFFDF9',
  surfaceElevated: '#F2EDE4',
  surfaceCardHeader: '#F2EDE4',
  surfaceSection: '#F2EDE4',
  surfaceBorder: '#E5DFD3',
  primary: '#A23E19',
  primaryDark: '#7E2E0F',
  primaryContainer: '#FBECE5',
  primaryContainerBorder: '#E89A7A',
  primaryOnContainer: '#7E2E0F',
  onSurface: '#1A1918',
  onSurfaceVariant: '#585550',
  onSurfaceMuted: '#736D65',
  completion: '#1E5B3A',
  onPrimary: '#FFFFFF',
  tabBarBg: '#F8F5EE',
  headerBg: '#F8F5EE',
  error: '#BA1A1A',
  selection: '#FBECE5',
  ...KUA_SHARED_LIGHT,
};

export const ClayCourtDarkColors = {
  background: '#141211',
  surface: '#141211',
  surfaceCard: '#1F1C1A',
  surfaceCardHeader: '#181513',
  surfaceLow: '#1A1816',
  surfaceBorder: '#2C2723',
  surfaceSection: '#1A1816',
  primary: '#D86538',
  primaryLight: '#F08B62',
  primaryContainer: '#341B13',
  primaryContainerBorder: '#5C2E1E',
  primaryOnContainer: '#F08B62',
  onSurface: '#F5F3F0',
  onSurfaceVariant: '#A89F96',
  completion: '#2CA864',
  onPrimary: '#141211',
  tabBarBg: '#141211',
  headerBg: '#141211',
  error: '#BA1A1A',
  selection: '#341B13',
  ...KUA_SHARED_DARK,
};

export const GrassCourtLightColors = {
  background: '#F4F8F5',
  surface: '#F4F8F5',
  surfaceCard: '#FFFFFF',
  surfaceSubtle: '#F2F7F4',
  surfaceCardHeader: '#F4F8F5',
  surfaceSection: '#F2F7F4',
  surfaceBorder: '#E0EAE3',
  surfaceSeg: '#E8EFEA',
  surfaceSegBorder: '#DEE7E1',
  primary: '#1E5B3A',
  primaryDark: '#14452B',
  primaryContainer: '#E8F4EC',
  primaryContainerBorder: '#A3D4B3',
  primaryOnContainer: '#14452B',
  onSurface: '#111813',
  onSurfaceVariant: '#556B5C',
  completion: '#1E5B3A',
  onPrimary: '#FFFFFF',
  tabBarBg: '#F4F8F5',
  headerBg: '#F4F8F5',
  error: '#BA1A1A',
  selection: '#E8F4EC',
  ...KUA_SHARED_LIGHT,
};

export const GrassCourtDarkColors = {
  background: '#0C130F',
  surface: '#0C130F',
  surfaceCard: '#15201A',
  surfaceCardHeader: '#0C130F',
  surfaceLow: '#111A15',
  surfaceSection: '#111A15',
  surfaceBorder: '#1F3025',
  surfaceSurface2: '#1C2B22',
  primary: '#2CA864',
  primaryNeon: '#4ADE80',
  primaryContainer: '#132B1C',
  primaryContainerBorder: '#235235',
  primaryOnContainer: '#4ADE80',
  onSurface: '#F0F5F2',
  onSurfaceVariant: '#91A398',
  completion: '#2CA864',
  onPrimary: '#0C130F',
  tabBarBg: '#0C130F',
  headerBg: '#0C130F',
  error: '#BA1A1A',
  selection: '#132B1C',
  ...KUA_SHARED_DARK,
};

// All six KUA palettes keyed by theme and mode.
export const KUA_PALETTES = {
  hardCourt: { light: HardCourtLightColors, dark: HardCourtDarkColors },
  clayCourt: { light: ClayCourtLightColors, dark: ClayCourtDarkColors },
  grassCourt: { light: GrassCourtLightColors, dark: GrassCourtDarkColors },
};
