import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { loadFatigueTrackingEnabledStrict, loadDeloadModeEnabledStrict } from '../../storage/entries/settings';
import { safeNotify } from './shared';

const DEFAULT_FEATURE_TOGGLES = { fatigueTrackingEnabled: false, deloadModeEnabled: false };

// Three distinct boundaries (#1487):
//   - `durableToggles`: the last value storage is known to hold.
//   - `currentFeatureToggles`: the module mirror every mounted consumer renders,
//     optimistic while a write is pending.
//   - per-hook React state, which only ever copies the mirror.
// Writes go through one serialized queue and the newest request for a key owns
// that key's UI outcome, so a stale rejection can never undo newer state.
let durableToggles = { ...DEFAULT_FEATURE_TOGGLES };
let currentFeatureToggles = { ...DEFAULT_FEATURE_TOGGLES };
// key -> { attempted } for a save that failed and has not been reconciled.
let saveFailures = {};
const latestRequest = { fatigueTrackingEnabled: 0, deloadModeEnabled: 0 };
// Bumped by an external refresh: results of requests issued before it are
// superseded by what the refresh read after them.
let refreshEpoch = 0;
let writeQueue = Promise.resolve();
let featureToggleListeners = [];
const notifyFeatureToggles = () => safeNotify(featureToggleListeners);

const SAVERS = {
  fatigueTrackingEnabled: (enabled) => Storage.saveFatigueTrackingEnabled(enabled),
  deloadModeEnabled: (enabled) => Storage.saveDeloadModeEnabled(enabled),
};

// Read-only: loaders never write, so refresh notifications cannot loop.
// Every read takes a generation when it starts; a result older than the last
// applied one (e.g. a slow initial load finishing after a refresh) is dropped.
let readGeneration = 0;
let lastAppliedGeneration = 0;
// `strict` (external refresh) rethrows a failed/corrupt read so the caller keeps
// current state instead of adopting the lenient loaders' defaults (#1480).
async function readDurableToggles(strict = false) {
  const generation = ++readGeneration;
  const [fatigueTrackingEnabled, deloadModeEnabled] = await Promise.all(strict
    ? [loadFatigueTrackingEnabledStrict(), loadDeloadModeEnabledStrict()]
    : [Storage.loadFatigueTrackingEnabled(), Storage.loadDeloadModeEnabled()]);
  return { toggles: { fatigueTrackingEnabled, deloadModeEnabled }, generation };
}

// `snapshot` is the request counter per key when the load was queued. A key the
// user has toggled since then keeps its newer optimistic value.
function applyLoadedToggles({ toggles: loaded, generation }, snapshot) {
  if (generation < lastAppliedGeneration) return;
  lastAppliedGeneration = generation;
  durableToggles = { ...loaded };
  const next = { ...currentFeatureToggles };
  Object.keys(SAVERS).forEach((key) => {
    if (latestRequest[key] === snapshot[key]) {
      next[key] = loaded[key];
      saveFailures = { ...saveFailures, [key]: null };
    }
  });
  currentFeatureToggles = next;
  notifyFeatureToggles();
}

// Snapshot taken when the load starts so a toggle made while it is in flight
// survives the late result.
const initialSnapshot = { ...latestRequest };
let featureTogglesPromise = readDurableToggles()
  .then((loaded) => applyLoadedToggles(loaded, initialSnapshot))
  .catch(() => {});

// External refresh (e.g. a sync pull changed storage). Queued behind pending
// writes so it reads their outcome, and authoritative over their completion.
export function refreshFeatureToggles() {
  refreshEpoch += 1;
  const snapshot = { ...latestRequest };
  const run = async () => {
    try {
      applyLoadedToggles(await readDurableToggles(true), snapshot);
    } catch { /* keep current state */ }
  };
  writeQueue = writeQueue.then(run);
  return writeQueue;
}

function requestToggleSave(key, enabled) {
  const id = ++latestRequest[key];
  const epoch = refreshEpoch;
  saveFailures = { ...saveFailures, [key]: null };
  currentFeatureToggles = { ...currentFeatureToggles, [key]: enabled };
  notifyFeatureToggles();

  const run = async () => {
    await featureTogglesPromise;
    try {
      await SAVERS[key](enabled);
    } catch {
      // A refresh queued after this write is authoritative; a newer request
      // for the key owns the outcome. Either way this failure must not touch
      // the mirror.
      if (epoch === refreshEpoch && id === latestRequest[key]) {
        currentFeatureToggles = { ...currentFeatureToggles, [key]: durableToggles[key] };
        saveFailures = { ...saveFailures, [key]: { attempted: enabled } };
        notifyFeatureToggles();
      }
      return false;
    }
    if (epoch === refreshEpoch) durableToggles = { ...durableToggles, [key]: enabled };
    return true;
  };
  const result = writeQueue.then(run);
  writeQueue = result;
  return result;
}

export function useFeatureToggles() {
  const [toggles, setToggles] = useState(currentFeatureToggles);
  const [failures, setFailures] = useState(saveFailures);

  const refresh = useCallback(() => {
    setToggles({ ...currentFeatureToggles });
    setFailures(saveFailures);
  }, []);

  useEffect(() => {
    featureTogglesPromise.then(refresh);
    featureToggleListeners.push(refresh);
    return () => {
      featureToggleListeners = featureToggleListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  // Resolve (never reject) so the Switch handler cannot leak an unhandled
  // rejection; failure is reported through `saveFailures`.
  const setFatigueTrackingEnabled = useCallback(
    (enabled) => requestToggleSave('fatigueTrackingEnabled', enabled), []);
  const setDeloadModeEnabled = useCallback(
    (enabled) => requestToggleSave('deloadModeEnabled', enabled), []);
  const retryToggleSave = useCallback((key) => {
    const failure = saveFailures[key];
    return failure ? requestToggleSave(key, failure.attempted) : Promise.resolve(true);
  }, []);

  return { ...toggles, saveFailures: failures, retryToggleSave, setFatigueTrackingEnabled, setDeloadModeEnabled };
}
