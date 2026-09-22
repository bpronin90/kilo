// Appearance context (#689).
//
// Patterned after components/TabBarLayout.js: a plain createContext with a
// safe default so any component rendered outside the provider (isolated unit
// tests, storybook-style harnesses) still gets a complete palette instead of
// crashing on undefined.
//
// The provider owns exactly one derivation: preference + OS scheme -> resolved
// mode -> palette. `system` reads React Native's useColorScheme(), which is
// already a live subscription, so an OS light/dark switch re-renders every
// consumer without any extra listener wiring.
//
// There is intentionally no mutable module-level palette. Styles that depend on
// the palette are built per palette via a `createStyles(colors)` factory and
// memoized on `colors`, because StyleSheet.create() captures values at call
// time and a module-scope sheet could never repaint without a reload.

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';

import { LightColors, KUA_PALETTES, paletteForMode } from './colors';
import {
  DEFAULT_APPEARANCE_PREFERENCE,
  DEFAULT_THEME_SELECTION,
  setAppearancePreference,
  setThemeSelection,
  useAppearancePreference,
  useThemeSelection,
} from '../lib/themePreference';

// Resolve the effective mode. 'light'/'dark' are absolute; 'system' follows the
// OS, defaulting to light when the platform reports no scheme (web SSR, older
// Android surfaces, and the test renderer all return null here).
export function resolveThemeMode(preference, systemScheme) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

// Reconcile the JS preference with React Native's native `Appearance` (#985).
// Light/Dark pin the native scheme so keyboards, pickers, switches, alerts and
// the OS status bar match; System passes `null`, which hands control back to the
// OS so `useColorScheme()` keeps tracking live light/dark switches. Because
// `resolveThemeMode` derives the app's mode from the *preference* first and only
// falls back to the scheme for `system`, pinning the scheme for an explicit
// choice cannot feed back into the resolved mode. Web has no native appearance
// layer, so it is skipped.
function applyNativeAppearance(preference) {
  if (Platform.OS === 'web') return;
  const pinned = preference === 'light' || preference === 'dark' ? preference : null;
  Appearance.setColorScheme(pinned);
}

// Map a theme slug ('hard-court', 'clay-court', 'grass-court') to a KUA_PALETTES key.
function themeKey(slug) {
  if (slug === 'clay-court') return 'clayCourt';
  if (slug === 'grass-court') return 'grassCourt';
  return 'hardCourt';
}

const DEFAULT_THEME = {
  preference: DEFAULT_APPEARANCE_PREFERENCE,
  mode: 'light',
  colors: LightColors,
  setPreference: setAppearancePreference,
  themeSelection: DEFAULT_THEME_SELECTION,
  setThemeSelection,
  kuaPalette: KUA_PALETTES.hardCourt.light,
};

export const ThemeContext = createContext(DEFAULT_THEME);

export function ThemeProvider({ children }) {
  const preference = useAppearancePreference();
  const themeSelection = useThemeSelection();
  const systemScheme = useColorScheme();
  const mode = resolveThemeMode(preference, systemScheme);

  useEffect(() => {
    applyNativeAppearance(preference);
  }, [preference]);

  const value = useMemo(
    () => ({
      preference,
      mode,
      colors: paletteForMode(mode),
      setPreference: setAppearancePreference,
      themeSelection,
      setThemeSelection,
      kuaPalette: KUA_PALETTES[themeKey(themeSelection)][mode],
    }),
    [preference, mode, themeSelection]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Native <Switch> tint from palette roles (#985). iOS renders only the `true`
// track (thumb stays system white); Android honours every field, so the `false`
// track and thumb must also read on the dark card. `disabled`/`busy` mute the
// accent so a pending or locked toggle does not look settled — matching the
// reduced-emphasis treatment those callsites already apply elsewhere.
export function switchColors(colors, { disabled = false, busy = false } = {}) {
  const muted = disabled || busy;
  return {
    trackColor: {
      false: colors.tabInactive,
      true: muted ? colors.textMuted : colors.accent,
    },
    thumbColor: colors.textLight,
    ios_backgroundColor: colors.tabInactive,
  };
}

// { preference, mode, colors, setPreference }
export function useTheme() {
  return useContext(ThemeContext);
}

// Shared-primitive KUA opt-in gate (#1139). Defaults to null so every shell and
// shared-primitive factory built with `useThemedStyles` keeps the unchanged
// legacy palette when rendered outside the production shell (isolated unit
// tests, storybook-style harnesses). Only the app root wraps the whole tree in
// `KuaStyleGate`, feeding it the selected court palette, so the shell, tab bar,
// alerts, and shared Card/Panel/Button/Chip/feedback/input surfaces resolve
// through the active KUA identity in production without changing how those same
// primitives render in isolation. Mirrors WorkoutKuaProvider's null-default
// opt-in, but sourced from the resolved theme rather than a per-subtree prop.
export const KuaStyleContext = createContext(null);

export function KuaStyleGate({ children }) {
  const { kuaPalette } = useTheme();
  return (
    <KuaStyleContext.Provider value={kuaPalette ?? null}>
      {children}
    </KuaStyleContext.Provider>
  );
}

// The gated KUA palette, or null outside the production shell. Inline styles
// (TabBar's active/inactive icon tint) read it directly; StyleSheet factories
// receive it as the second `createStyles(colors, kua)` argument.
export function useKuaStyle() {
  return useContext(KuaStyleContext);
}

// Palette-keyed StyleSheet cache. A `createStyles(colors, kua)` factory is a
// stable module-level function and every palette object (legacy or KUA) is a
// stable module-level constant, so every component instance sharing a factory
// shares one registered sheet per resolved palette instead of rebuilding it per
// mount. The cache key is the KUA palette when the gate supplies one and the
// legacy palette otherwise, so a fixed-mode court switch (same legacy `colors`,
// different `kua`) still returns a fresh sheet and repaints. Both keys are held
// weakly, so no palette can leak sheets.
const styleSheetCache = new WeakMap();

export function themedStyles(factory, colors, kua = null) {
  const key = kua || colors;
  let byPalette = styleSheetCache.get(factory);
  if (!byPalette) {
    byPalette = new WeakMap();
    styleSheetCache.set(factory, byPalette);
  }
  let sheet = byPalette.get(key);
  if (!sheet) {
    sheet = factory(colors, kua);
    byPalette.set(key, sheet);
  }
  return sheet;
}

// Styles for the active palette. Replaces module-scope StyleSheet.create(),
// which captures colors at module load and cannot repaint on a mode change.
// The factory receives the legacy `colors` and the gated KUA palette (`kua`,
// null outside the production shell) so a single factory serves both the
// legacy-isolated and KUA-in-production renders.
export function useThemedStyles(factory) {
  const { colors } = useTheme();
  const kua = useKuaStyle();
  return themedStyles(factory, colors, kua);
}
