// Module-level store for the lb/kg display preference (#441).
//
// The preference persists on the local user profile as unit_system
// ('imperial'/'metric'), which the existing cloud bootstrap promotion
// (storage/cloud/bootstrapPlan.js) already round-trips for signed-in users.
// This store mirrors that value synchronously so every display surface can
// read it O(1) via useWeightUnit() without prop drilling or per-row storage
// reads.
//
// Hydration is lazy: the first subscriber triggers a one-time async load from
// the stored profile. An explicit setWeightUnitPreference (the Settings
// selector writes the profile itself) always wins over in-flight hydration.

import { useSyncExternalStore } from 'react';
import { loadUserProfile } from '../storage/entries/profileStorage';
import { unitFromUnitSystem } from './units';

let currentUnit = 'lb';
let hydrateStarted = false;
let explicitlySet = false;
const listeners = new Set();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function getWeightUnit() {
  return currentUnit;
}

// Set the in-memory preference. Persistence to the profile (unit_system) is
// the caller's responsibility (Settings selector via useUserProfile().save).
export function setWeightUnitPreference(unit) {
  explicitlySet = true;
  hydrateStarted = true;
  const next = unit === 'kg' ? 'kg' : 'lb';
  if (next !== currentUnit) {
    currentUnit = next;
    emit();
  }
}

function ensureHydrated() {
  if (hydrateStarted) return;
  hydrateStarted = true;
  loadUserProfile()
    .then((profile) => {
      if (explicitlySet) return;
      const next = unitFromUnitSystem(profile?.unit_system);
      if (next !== currentUnit) {
        currentUnit = next;
        emit();
      }
    })
    .catch(() => {});
}

export function subscribeWeightUnit(listener) {
  listeners.add(listener);
  ensureHydrated();
  return () => {
    listeners.delete(listener);
  };
}

// Current display unit ('lb' | 'kg') for React components.
export function useWeightUnit() {
  return useSyncExternalStore(subscribeWeightUnit, getWeightUnit, getWeightUnit);
}

// Test-only reset so unit tests can exercise default/hydration behavior.
export function __resetWeightUnitForTests() {
  currentUnit = 'lb';
  hydrateStarted = false;
  explicitlySet = false;
  listeners.clear();
}
