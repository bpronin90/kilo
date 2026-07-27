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
  // Wrapped in Promise.resolve + try/catch so a storage adapter that throws
  // synchronously or returns a non-thenable leaves the app on the default
  // preference instead of tearing down the first render that subscribed.
  try {
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
      .catch(() => {});
  } catch (e) {
    // Ignored: the default preference already applies.
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
}
