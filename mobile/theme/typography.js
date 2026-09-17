import { useMemo } from 'react';
import { Platform } from 'react-native';
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
const JBM_SEMIBOLD = 'JetBrainsMono-SemiBold';
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
  [JBM_SEMIBOLD]: require('../assets/fonts/JetBrainsMono-SemiBold.ttf'),
  [JBM_MEDIUM]: require('../assets/fonts/JetBrainsMono-Medium.ttf'),
  [JBM_BOLD]: require('../assets/fonts/JetBrainsMono-Bold.ttf'),
};

// Platform-specific fallback font families for use before bundled assets load.
//
// Native (iOS/Android): fontFamily must be a single exact name — RN does not
// parse CSS comma-separated stacks and rejects the entire value if it finds one.
//   iOS:     'Courier New' (built-in)
//   Android: 'monospace' (generic alias → Droid Sans Mono / Noto Mono)
//
// Web: CSS stacks are valid and desirable; 'Courier New' is absent on many
// Linux and ChromeOS installations, so a full stack ending with the
// generic 'monospace' guarantees a fixed-pitch face.
//
// Sans-serif: undefined defers to the OS/browser default without specifying
// a family name that might be rejected on any platform.
const SG_FALLBACK = undefined;
const JBM_FALLBACK = Platform.select({
  android: 'monospace',
  ios: 'Courier New',
  web: 'Courier New, Courier, monospace',
  default: 'Courier New',
});

// ---------------------------------------------------------------------------
// Typography role tokens
// Source: docs/design/kinetic-utilitarian-athletic/foundation.md
//
// fontWeight is intentionally omitted from every token. Each fontFamily value
// is a weight-specific asset name (e.g. 'SpaceGrotesk-Bold'). On native,
// React Native selects the file by that name; on web, expo-font registers each
// key as a separate @font-face at the default weight (400). Pairing an
// explicit fontWeight with a weight-named family would cause browsers to
// synthesize extra weight on top of the already-weighted face rather than
// accepting the real file as-is.
// ---------------------------------------------------------------------------

// Space Grotesk — linguistic content
export const TYPOGRAPHY = {
  'headline-xl': {
    fontFamily: SG_BOLD,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -0.03 * 40,
  },
  'headline-xl-mobile': {
    fontFamily: SG_BOLD,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.02 * 32,
  },
  'headline-lg': {
    fontFamily: SG_SEMIBOLD,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.02 * 28,
  },
  'headline-md': {
    fontFamily: SG_SEMIBOLD,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.01 * 22,
  },
  'headline-sm': {
    fontFamily: SG_SEMIBOLD,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0,
  },
  'body-lg': {
    fontFamily: SG_REGULAR,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
  },
  'body-md': {
    fontFamily: SG_REGULAR,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0,
  },
  'body-sm': {
    fontFamily: SG_REGULAR,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
  },

  // JetBrains Mono — quantitative / temporal values
  'metric-display': {
    fontFamily: JBM_BOLD,
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -0.02 * 36,
    fontVariant: ['tabular-nums'],
  },
  'metric-display-mobile': {
    fontFamily: JBM_BOLD,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.01 * 28,
    fontVariant: ['tabular-nums'],
  },
  'label-lg': {
    fontFamily: JBM_SEMIBOLD,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.02 * 14,
    fontVariant: ['tabular-nums'],
  },
  'label-md': {
    fontFamily: JBM_MEDIUM,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.04 * 12,
    fontVariant: ['tabular-nums'],
  },
  'label-sm': {
    fontFamily: JBM_MEDIUM,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.06 * 11,
    fontVariant: ['tabular-nums'],
  },
};

// Fallback versions of each role for use before fonts have loaded or when
// font loading fails. Identical specs but with platform-appropriate fallback
// family names instead of the bundled assets.
export const TYPOGRAPHY_FALLBACK = Object.fromEntries(
  Object.entries(TYPOGRAPHY).map(([role, spec]) => {
    const isMonospace = spec.fontFamily.startsWith('JetBrainsMono');
    const fallback = isMonospace ? JBM_FALLBACK : SG_FALLBACK;
    const { fontFamily: _ignored, ...rest } = spec;
    return fallback !== undefined
      ? [role, { ...rest, fontFamily: fallback }]
      : [role, rest];
  }),
);

// ---------------------------------------------------------------------------
// Font loading
// ---------------------------------------------------------------------------

// Returns the resolved token map: TYPOGRAPHY once all assets are loaded,
// TYPOGRAPHY_FALLBACK while still loading or when load fails. Callers receive
// live tokens that switch atomically after the font load settles; no
// consumer needs to re-check fontsLoaded independently.
export function useKuaTypography() {
  const [fontsLoaded] = ExpoFont.useFonts(FONT_ASSETS);
  return useMemo(
    () => (fontsLoaded ? TYPOGRAPHY : TYPOGRAPHY_FALLBACK),
    [fontsLoaded],
  );
}

// Lower-level hook for callers that only need the load state (e.g. App root).
export function useKuaFonts() {
  return ExpoFont.useFonts(FONT_ASSETS);
}
