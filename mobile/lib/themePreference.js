// Module-level store for the local appearance preference (#689).
//
// Three values only: 'light', 'dark', and 'system'. Anything missing or
// invalid resolves to 'system'.
//
// Patterned after lib/unitPreference.js: a synchronous in-memory value plus a
// listener set so every subscriber repaints the instant a selection lands,
// with lazy one-time hydration on the first subscriber. Unlike the unit
// preference this store owns its own persistence, because appearance is a
// device display setting with no profile/cloud column behind it.
//
// The key is deliberately dot-namespaced rather than `kilo_`-prefixed: the
// account-switch purge in storage/entries/localDataOwner.js removes every
// `kilo_` key, and a device's chosen appearance is not user data that should
// be wiped when a different account signs in on the same phone.

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const APPEARANCE_PREFERENCE_KEY = 'kilo.appearance_preference';

export const APPEARANCE_PREFERENCES = ['light', 'dark', 'system'];

export const DEFAULT_APPEARANCE_PREFERENCE = 'system';

// Coerce any stored/passed value to a supported preference. The single place
// that decides what "invalid" means, so hydration, the setter, and the tests
// cannot disagree.
export function normalizeAppearancePreference(value) {
  return APPEARANCE_PREFERENCES.includes(value)
    ? value
    : DEFAULT_APPEARANCE_PREFERENCE;
}

let currentPreference = DEFAULT_APPEARANCE_PREFERENCE;
let hydrateStarted = false;
let explicitlySet = false;
const listeners = new Set();

function emit() {
  for (const listener of [...listeners]) listener();
}

// ---------------------------------------------------------------------------
// Cold-start hydration barrier (#1138)
//
// Each store starts on its in-memory default and only learns the persisted
// value after an asynchronous AsyncStorage read. Painting the shell from those
// defaults lets a Clay/Grass or explicit Light/Dark user watch Hard Court /
// System stabilize first, then jump. The barrier below lets the app root hold
// the first *themed* frame until BOTH preferences have settled (resolved,
// rejected, or pre-empted by an explicit selection), so the first stable frame
// is the correct one. It always releases — a read failure marks the store
// hydrated too, so there is no indefinite loading state.
// ---------------------------------------------------------------------------
let appearanceHydrated = false;
let themeSelectionHydrated = false;
const hydrationListeners = new Set();

function emitHydration() {
  for (const listener of [...hydrationListeners]) listener();
}

function markAppearanceHydrated() {
  if (appearanceHydrated) return;
  appearanceHydrated = true;
  emitHydration();
}

function markThemeSelectionHydrated() {
  if (themeSelectionHydrated) return;
  themeSelectionHydrated = true;
  emitHydration();
}

// True once neither store can still swap its value out from under the first
// paint. Synchronous so it can seed useSyncExternalStore's snapshot.
export function getThemePreferencesHydrated() {
  return appearanceHydrated && themeSelectionHydrated;
}

// Safety-net release (#1138 review). Rejection and synchronous-throw settle the
// barrier, but a read whose promise simply never resolves (a stalled native
// storage bridge) would otherwise strand the app on the neutral hold forever.
// A bounded fallback guarantees the barrier always opens; the value still
// corrects if the real read lands late (markHydrated is idempotent). Generous
// enough not to fire on an ordinary slow cold-start read (tens of ms), so it
// only ever trips on a genuinely stuck read.
export const THEME_HYDRATION_TIMEOUT_MS = 3000;

// A setTimeout that never keeps a Node test process alive on its own.
function scheduleHydrationFallback(settle) {
  const timer = setTimeout(settle, THEME_HYDRATION_TIMEOUT_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

export function getAppearancePreference() {
  return currentPreference;
}

// Apply a selection immediately, then persist. The in-memory update never
// waits on storage so the UI repaints on the same tick as the tap, and a
// failed write leaves the session on the chosen appearance rather than
// throwing into the Settings press handler.
export function setAppearancePreference(value) {
  explicitlySet = true;
  hydrateStarted = true;
  // An explicit choice is the final value; nothing pending can override it, so
  // the barrier no longer needs to wait on the read (which #1138's in-flight
  // test exercises: a selection made mid-hydration must release the gate).
  markAppearanceHydrated();
  const next = normalizeAppearancePreference(value);
  if (next !== currentPreference) {
    currentPreference = next;
    emit();
  }
  // Persistence is best-effort and fully isolated: a throwing or non-thenable
  // storage adapter must never surface into the Settings press handler.
  try {
    return Promise.resolve(
      AsyncStorage.setItem(APPEARANCE_PREFERENCE_KEY, next)
    ).catch(() => {});
  } catch (e) {
    return Promise.resolve();
  }
}

function ensureHydrated() {
  if (hydrateStarted) return;
  hydrateStarted = true;
  // Clears the fallback timer on settle so a normal read leaves no lingering
  // timeout, and releases the barrier exactly once (markAppearanceHydrated is
  // idempotent whether the read or the fallback wins).
  let fallbackTimer = null;
  const settle = () => {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    markAppearanceHydrated();
  };
  // Wrapped in Promise.resolve + try/catch so a storage adapter that throws
  // synchronously or returns a non-thenable leaves the app on the default
  // preference instead of tearing down the first render that subscribed.
  try {
    // Armed before the read so even a promise that never settles releases the
    // barrier (#1138 review): rejection and sync-throw are handled below, but a
    // stuck bridge would otherwise hold the neutral hold indefinitely.
    fallbackTimer = scheduleHydrationFallback(settle);
    Promise.resolve(AsyncStorage.getItem(APPEARANCE_PREFERENCE_KEY))
      .then((raw) => {
        // An explicit selection made while the read was in flight always wins.
        if (explicitlySet) return;
        const next = normalizeAppearancePreference(raw);
        if (next !== currentPreference) {
          currentPreference = next;
          emit();
        }
      })
      .catch(() => {})
      // Settled either way: release the barrier so a failed or empty read never
      // leaves the app on an indefinite loading frame.
      .finally(settle);
  } catch (e) {
    // A synchronously throwing adapter still counts as settled on the default.
    settle();
  }
}

export function subscribeAppearancePreference(listener) {
  listeners.add(listener);
  ensureHydrated();
  return () => {
    listeners.delete(listener);
  };
}

// Current appearance preference ('light' | 'dark' | 'system') for components.
export function useAppearancePreference() {
  return useSyncExternalStore(
    subscribeAppearancePreference,
    getAppearancePreference,
    getAppearancePreference
  );
}

// Test-only reset so unit tests can exercise default/hydration behavior.
export function __resetAppearancePreferenceForTests() {
  currentPreference = DEFAULT_APPEARANCE_PREFERENCE;
  hydrateStarted = false;
  explicitlySet = false;
  listeners.clear();
  appearanceHydrated = false;
  hydrationListeners.clear();
}

// ---------------------------------------------------------------------------
// Theme selection (#1105)
//
// Three court themes: 'hard-court', 'clay-court', 'grass-court'.
// Missing or invalid values normalize to 'hard-court'.
// Persisted separately from appearance so the two preferences are independent.
// ---------------------------------------------------------------------------

export const THEME_SELECTION_KEY = 'kilo.theme_selection';
export const THEME_SELECTIONS = ['hard-court', 'clay-court', 'grass-court'];
export const DEFAULT_THEME_SELECTION = 'hard-court';

export function normalizeThemeSelection(value) {
  return THEME_SELECTIONS.includes(value) ? value : DEFAULT_THEME_SELECTION;
}

let currentTheme = DEFAULT_THEME_SELECTION;
let themeHydrateStarted = false;
let themeExplicitlySet = false;
const themeListeners = new Set();

function emitTheme() {
  for (const listener of [...themeListeners]) listener();
}

export function getThemeSelection() {
  return currentTheme;
}

export function setThemeSelection(value) {
  themeExplicitlySet = true;
  themeHydrateStarted = true;
  // An explicit choice is final; release the barrier immediately (#1138).
  markThemeSelectionHydrated();
  const next = normalizeThemeSelection(value);
  if (next !== currentTheme) {
    currentTheme = next;
    emitTheme();
  }
  try {
    return Promise.resolve(
      AsyncStorage.setItem(THEME_SELECTION_KEY, next)
    ).catch(() => {});
  } catch (e) {
    return Promise.resolve();
  }
}

function ensureThemeHydrated() {
  if (themeHydrateStarted) return;
  themeHydrateStarted = true;
  let fallbackTimer = null;
  const settle = () => {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    markThemeSelectionHydrated();
  };
  try {
    // Same stuck-read safety net as the appearance store (#1138 review).
    fallbackTimer = scheduleHydrationFallback(settle);
    Promise.resolve(AsyncStorage.getItem(THEME_SELECTION_KEY))
      .then((raw) => {
        if (themeExplicitlySet) return;
        const next = normalizeThemeSelection(raw);
        if (next !== currentTheme) {
          currentTheme = next;
          emitTheme();
        }
      })
      .catch(() => {})
      .finally(settle);
  } catch (e) {
    // A synchronously throwing adapter still counts as settled on the default.
    settle();
  }
}

export function subscribeThemeSelection(listener) {
  themeListeners.add(listener);
  ensureThemeHydrated();
  return () => {
    themeListeners.delete(listener);
  };
}

export function useThemeSelection() {
  return useSyncExternalStore(
    subscribeThemeSelection,
    getThemeSelection,
    getThemeSelection
  );
}

export function __resetThemeSelectionForTests() {
  currentTheme = DEFAULT_THEME_SELECTION;
  themeHydrateStarted = false;
  themeExplicitlySet = false;
  themeListeners.clear();
  themeSelectionHydrated = false;
  hydrationListeners.clear();
}

// ---------------------------------------------------------------------------
// Combined hydration barrier subscription (#1138)
//
// Subscribing kicks off BOTH reads (so the gate can release even before the
// theme/appearance hooks themselves have any subscriber) and notifies whenever
// either store settles. The app root uses this to withhold the first themed
// frame until both persisted preferences have resolved.
// ---------------------------------------------------------------------------
export function subscribeThemePreferencesHydrated(listener) {
  hydrationListeners.add(listener);
  ensureHydrated();
  ensureThemeHydrated();
  return () => {
    hydrationListeners.delete(listener);
  };
}

export function useThemePreferencesHydrated() {
  return useSyncExternalStore(
    subscribeThemePreferencesHydrated,
    getThemePreferencesHydrated,
    getThemePreferencesHydrated
  );
}

// Begin both reads at module import, before the first React render, so the
// persisted values are already in flight when the app root mounts. On a real
// cold start the barrier still holds until they resolve; this only shortens the
// hold rather than deferring the read until the first subscriber (#1138).
ensureHydrated();
ensureThemeHydrated();
