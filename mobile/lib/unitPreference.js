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
// Bumped on every explicit set and every read start, so a read can tell it was
// overtaken (#1480): an explicit choice made after it began, or a newer read.
let explicitEpoch = 0;
let readGeneration = 0;
let lastAppliedGeneration = 0;
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
  explicitEpoch += 1;
  hydrateStarted = true;
  const next = unit === 'kg' ? 'kg' : 'lb';
  if (next !== currentUnit) {
    currentUnit = next;
    emit();
  }
}

// Read the persisted profile unit and apply it unless something newer won.
// `authoritative` (external refresh) overrides an earlier explicit set, because
// the persisted profile is the truth after a pull/import; an explicit set made
// while the read was in flight still wins. Read-only: never writes.
function readPersistedUnit({ authoritative }) {
  const generation = ++readGeneration;
  const epoch = explicitEpoch;
  return loadUserProfile()
    .then((profile) => {
      if (generation < lastAppliedGeneration) return;
      if (epoch !== explicitEpoch) return;
      if (explicitlySet && !authoritative) return;
      lastAppliedGeneration = generation;
      const next = unitFromUnitSystem(profile?.unit_system);
      if (next !== currentUnit) {
        currentUnit = next;
        emit();
      }
    })
    .catch(() => {});
}

function ensureHydrated() {
  if (hydrateStarted) return;
  hydrateStarted = true;
  readPersistedUnit({ authoritative: false });
}

// Re-read the stored profile after an external write (sync pull, backup
// import). Before first hydration there is nothing mounted to refresh: the
// first subscriber will hydrate from storage itself.
export function refreshWeightUnitPreference() {
  if (!hydrateStarted) return Promise.resolve();
  return readPersistedUnit({ authoritative: true });
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
  explicitEpoch = 0;
  readGeneration = 0;
  lastAppliedGeneration = 0;
  listeners.clear();
}
