// Cold-start theme hydration barrier, extracted from App.js (#1138).
//
// A persisted Clay/Grass theme or an explicit Light/Dark appearance is only
// known after an asynchronous AsyncStorage read (see lib/themePreference.js), so
// painting the shell from the in-memory defaults (Hard Court / System) would let
// the wrong theme visibly stabilize before the read lands. This gate holds the
// first *themed* frame until both preferences settle, then reveals the shell
// already on the correct palette.
//
// Two layers cooperate:
//   1. The JS hold — while unhydrated the gate renders a theme-neutral view (no
//      palette color committed while the theme is unknown), so no wrong-theme
//      frame is ever mounted.
//   2. The native splash — Expo auto-hides its splash on the first rendered
//      frame, and that frame is the neutral hold, so without intervention a
//      Dark/Clay user would briefly see the configured light splash/window
//      surface. Holding the splash via preventAutoHideAsync() and lifting it
//      only once hydration completes means the first *visible* frame is already
//      the correct theme.
//
// The barrier always releases: a failed, empty, or stuck read still marks the
// store hydrated (lib/themePreference.js), so there is no indefinite loading
// state. All SplashScreen calls are best-effort — an absent native module
// (web, tests) must never break startup.

import React, { useEffect } from 'react';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { useThemePreferencesHydrated } from '../lib/themePreference';

// Runs at import (before the first React frame) so the splash is pinned as early
// as possible on a native cold start.
SplashScreen.preventAutoHideAsync().catch(() => {});

export function ThemeHydrationGate({ children }) {
  const hydrated = useThemePreferencesHydrated();
  // Lift the native splash once the barrier opens. The effect runs after the
  // resolved shell has committed, so the splash covers the neutral hold until
  // the themed shell is on screen.
  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [hydrated]);
  if (!hydrated) return <View style={{ flex: 1 }} />;
  return children;
}
