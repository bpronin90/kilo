import * as ExpoFont from 'expo-font';

// Font family name constants used by all typography tokens.
export const FONT_SPACE_GROTESK = 'SpaceGrotesk';
export const FONT_JETBRAINS_MONO = 'JetBrainsMono';

// Variant suffixes used to distinguish weight-specific font family names.
// React Native loads each weight as a distinct asset; the fontFamily string
// must match the registered name exactly.
const SG_REGULAR = 'SpaceGrotesk-Regular';
const SG_MEDIUM = 'SpaceGrotesk-Medium';
const SG_SEMIBOLD = 'SpaceGrotesk-SemiBold';
const SG_BOLD = 'SpaceGrotesk-Bold';
const JBM_MEDIUM = 'JetBrainsMono-Medium';
const JBM_BOLD = 'JetBrainsMono-Bold';

// Font asset map keyed by the registered family name, resolved from the
// bundled asset directory. All paths are local — no CDN or Google Fonts
// fetch occurs at runtime.
export const FONT_ASSETS = {
  [SG_REGULAR]: require('../assets/fonts/SpaceGrotesk-Regular.ttf'),
  [SG_MEDIUM]: require('../assets/fonts/SpaceGrotesk-Medium.ttf'),
  [SG_SEMIBOLD]: require('../assets/fonts/SpaceGrotesk-SemiBold.ttf'),
  [SG_BOLD]: require('../assets/fonts/SpaceGrotesk-Bold.ttf'),
  [JBM_MEDIUM]: require('../assets/fonts/JetBrainsMono-Medium.ttf'),
  [JBM_BOLD]: require('../assets/fonts/JetBrainsMono-Bold.ttf'),
};

// Fallback stacks used when the bundled fonts have not yet loaded or have
// failed to load. The first entry matches the intended typeface role.
const SG_FALLBACK = 'system-ui, sans-serif';
const JBM_FALLBACK = 'Menlo, Courier New, monospace';

// ---------------------------------------------------------------------------
// Typography role tokens
// Source: docs/design/kinetic-utilitarian-athletic/foundation.md
// ---------------------------------------------------------------------------

// Space Grotesk — linguistic content
export const TYPOGRAPHY = {
  'headline-xl': {
    fontFamily: SG_BOLD,
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
    letterSpacing: -0.03 * 40,
  },
  'headline-xl-mobile': {
    fontFamily: SG_BOLD,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 36,
    letterSpacing: -0.02 * 32,
  },
  'headline-lg': {
    fontFamily: SG_SEMIBOLD,
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 32,
    letterSpacing: -0.02 * 28,
  },
  'headline-md': {
    fontFamily: SG_SEMIBOLD,
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 28,
    letterSpacing: -0.01 * 22,
  },
  'headline-sm': {
    fontFamily: SG_SEMIBOLD,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    letterSpacing: 0,
  },
  'body-lg': {
    fontFamily: SG_REGULAR,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
    letterSpacing: 0,
  },
  'body-md': {
    fontFamily: SG_REGULAR,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    letterSpacing: 0,
  },
  'body-sm': {
    fontFamily: SG_REGULAR,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    letterSpacing: 0,
  },

  // JetBrains Mono — quantitative / temporal values
  'metric-display': {
    fontFamily: JBM_BOLD,
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.02 * 36,
    fontVariant: ['tabular-nums'],
  },
  'metric-display-mobile': {
    fontFamily: JBM_BOLD,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
    letterSpacing: -0.01 * 28,
    fontVariant: ['tabular-nums'],
  },
  'label-lg': {
    fontFamily: JBM_MEDIUM,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    letterSpacing: 0.02 * 14,
    fontVariant: ['tabular-nums'],
  },
  'label-md': {
    fontFamily: JBM_MEDIUM,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    letterSpacing: 0.04 * 12,
    fontVariant: ['tabular-nums'],
  },
  'label-sm': {
    fontFamily: JBM_MEDIUM,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
    letterSpacing: 0.06 * 11,
    fontVariant: ['tabular-nums'],
  },
};

// Fallback versions of each role for use before fonts have loaded.
// Identical specs but using system font stacks instead of the bundled assets.
export const TYPOGRAPHY_FALLBACK = Object.fromEntries(
  Object.entries(TYPOGRAPHY).map(([role, spec]) => {
    const isMonospace = spec.fontFamily.startsWith('JetBrainsMono');
    return [role, { ...spec, fontFamily: isMonospace ? JBM_FALLBACK : SG_FALLBACK }];
  }),
);

// ---------------------------------------------------------------------------
// Font loading
// ---------------------------------------------------------------------------

// Returns [fontsLoaded, fontError] from expo-font. The caller must handle the
// error case — do not block rendering or navigate away; show whatever content
// is available using TYPOGRAPHY_FALLBACK.
export function useKuaFonts() {
  return ExpoFont.useFonts(FONT_ASSETS);
}
