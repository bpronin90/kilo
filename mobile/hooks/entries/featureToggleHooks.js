import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { safeNotify } from './shared';

const DEFAULT_FEATURE_TOGGLES = { fatigueTrackingEnabled: true, deloadModeEnabled: true };
let currentFeatureToggles = { ...DEFAULT_FEATURE_TOGGLES };
let featureToggleListeners = [];
const notifyFeatureToggles = () => safeNotify(featureToggleListeners);

let featureTogglesPromise = Promise.all([
  Storage.loadFatigueTrackingEnabled(),
  Storage.loadDeloadModeEnabled(),
])
  .then(([fatigueTrackingEnabled, deloadModeEnabled]) => {
    currentFeatureToggles = { fatigueTrackingEnabled, deloadModeEnabled };
    notifyFeatureToggles();
  })
  .catch(() => {});

export function useFeatureToggles() {
  const [toggles, setToggles] = useState(currentFeatureToggles);

  const refresh = useCallback(() => {
    setToggles({ ...currentFeatureToggles });
  }, []);

  useEffect(() => {
    featureTogglesPromise.then(refresh);
    featureToggleListeners.push(refresh);
    return () => {
      featureToggleListeners = featureToggleListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const setFatigueTrackingEnabled = useCallback(async (enabled) => {
    currentFeatureToggles = { ...currentFeatureToggles, fatigueTrackingEnabled: enabled };
    setToggles(currentFeatureToggles);
    await Storage.saveFatigueTrackingEnabled(enabled);
    notifyFeatureToggles();
  }, []);

  const setDeloadModeEnabled = useCallback(async (enabled) => {
    currentFeatureToggles = { ...currentFeatureToggles, deloadModeEnabled: enabled };
    setToggles(currentFeatureToggles);
    await Storage.saveDeloadModeEnabled(enabled);
    notifyFeatureToggles();
  }, []);

  return { ...toggles, setFatigueTrackingEnabled, setDeloadModeEnabled };
}
