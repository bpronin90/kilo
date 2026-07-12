// Local-data ownership marker (issue #450, audit #447 Finding 1).
//
// `kilo_local_data_owner` is the single source of truth for whose data lives in
// this device's local storage. It replaces the per-user
// `kilo_sync_bootstrapped_<userId>` markers: if local data already belongs to
// the signing-in user there is nothing to bootstrap, so ownership subsumes the
// old bootstrap gate and no second marker can drift out of agreement with it.
//
// Values:
//   'unclaimed' — local data belongs to no account (fresh install or post-purge)
//   '<userId>'  — local data belongs to that account
//   'unknown'   — belongs to *some* account we cannot identify (legacy installs
//                 whose data was already co-mingled across accounts). Never
//                 equals a real userId, so it falls through to the
//                 foreign-owner branch without special-casing.
//
// Write rules: set the owner only after a successful bootstrap, or immediately
// after a purge. Sign-out must NOT clear it — local history is intentionally
// retained on sign-out and still belongs to that user.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const LOCAL_DATA_OWNER_KEY = 'kilo_local_data_owner';
export const OWNER_UNCLAIMED = 'unclaimed';
export const OWNER_UNKNOWN = 'unknown';

export const LEGACY_BOOTSTRAP_MARKER_PREFIX = 'kilo_sync_bootstrapped_';

// One-time derivation from the legacy per-user bootstrap markers so existing
// installs migrate silently: a single-account device becomes owned by that
// account (no prompt, no re-upload), and a device whose data was already
// co-mingled across accounts becomes 'unknown' rather than looking unclaimed.
async function deriveOwnerFromLegacyMarkers() {
  const keys = await AsyncStorage.getAllKeys();
  const legacy = keys.filter((k) => k.startsWith(LEGACY_BOOTSTRAP_MARKER_PREFIX));
  if (legacy.length === 0) return OWNER_UNCLAIMED;
  if (legacy.length === 1) {
    return legacy[0].slice(LEGACY_BOOTSTRAP_MARKER_PREFIX.length);
  }
  return OWNER_UNKNOWN;
}

// Returns the current owner, running the one-time legacy migration when the
// marker is absent. After the first call the marker is persisted and never
// absent again (except when the persist write itself fails, in which case the
// derivation simply reruns next time).
export async function getLocalDataOwner() {
  try {
    const stored = await AsyncStorage.getItem(LOCAL_DATA_OWNER_KEY);
    if (stored) return stored;
    const derived = await deriveOwnerFromLegacyMarkers();
    try {
      await AsyncStorage.setItem(LOCAL_DATA_OWNER_KEY, derived);
    } catch {
      // Non-critical: worst case the derivation reruns on the next read.
    }
    return derived;
  } catch {
    // Fail safe: an unreadable marker must never authorize an automatic
    // upload, so report the one value that always forces the explicit-choice
    // branch.
    return OWNER_UNKNOWN;
  }
}

// Persist the owner. Errors intentionally propagate: ownership is the single
// source of truth for whether bootstrap may run, so callers must not treat a
// claim as durable (or activate cloud mode) unless this write actually
// succeeded.
export async function setLocalDataOwner(owner) {
  if (!owner) return;
  await AsyncStorage.setItem(LOCAL_DATA_OWNER_KEY, owner);
}

// Remove every kilo-prefixed key — all entry data from keys.js, the legacy
// bootstrap markers, archived weight goals, sync dirty/cursor state (stale
// dirty records must never be pushed into the next account), and settings —
// then write the owner explicitly. The owner is never left absent after a
// purge: an absent marker would re-run the legacy migration and could
// re-derive a stale owner from leftovers.
//
// Errors intentionally propagate: a caller must not treat this device as
// fresh unless the purge actually completed.
export async function purgeLocalData(nextOwner = OWNER_UNCLAIMED) {
  const keys = await AsyncStorage.getAllKeys();
  const kiloKeys = keys.filter((k) => k.startsWith('kilo_'));
  if (kiloKeys.length > 0) {
    await AsyncStorage.multiRemove(kiloKeys);
  }
  await AsyncStorage.setItem(LOCAL_DATA_OWNER_KEY, nextOwner);
}
