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
