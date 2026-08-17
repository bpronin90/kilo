import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { safeNotify } from './shared';
import { markStartupPhase } from '../../storage/entries/startupTiming';

let trackedLiftsListeners = [];
const notifyTrackedLifts = () => safeNotify(trackedLiftsListeners);

let currentTrackedLifts = {};
// Seed the write queue with the initial load so toggle/save always derive from
// real storage, not the empty module-scope default.
let trackedLiftsPromise = Storage.loadTrackedLifts()
  .then(data => { currentTrackedLifts = data; })
  .catch(() => {});

export function useTrackedLifts() {
  const [trackedLifts, setTrackedLifts] = useState(currentTrackedLifts);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The mirror of the eager-clear bug in the other read hooks (#737 review):
  // this one never cleared `error` at all, so once a read failed the flag stayed
  // set for the life of the hook and a consumer's banner could never come down,
  // even after a retry succeeded. Clearing it on success — and only on success —
  // fixes that without reintroducing the mid-retry verified-empty window.
  const refresh = useCallback(() => {
    Storage.loadTrackedLifts()
      .then(data => {
        currentTrackedLifts = data;
        setTrackedLifts(data);
        setError(null);
        markStartupPhase('trackedLifts:reload:done');
      })
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    trackedLiftsListeners.push(refresh);
    return () => {
      trackedLiftsListeners = trackedLiftsListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const save = useCallback(async (nextTrackedLifts) => {
    trackedLiftsPromise = trackedLiftsPromise.then(async () => {
      currentTrackedLifts = nextTrackedLifts;
      setTrackedLifts(nextTrackedLifts);
      await Storage.saveTrackedLifts(nextTrackedLifts);
      notifyTrackedLifts();
      return nextTrackedLifts;
    });
    return trackedLiftsPromise;
  }, []);

  const toggle = useCallback(async (name) => {
    trackedLiftsPromise = trackedLiftsPromise.then(async () => {
      const next = { ...currentTrackedLifts };
      if (next[name]) {
        delete next[name];
      } else {
        next[name] = true;
      }
      currentTrackedLifts = next;
      setTrackedLifts(next);
      await Storage.saveTrackedLifts(next);
      notifyTrackedLifts();
      return next;
    });
    return trackedLiftsPromise;
  }, []);

  return { trackedLifts, loading, error, save, toggle, refresh };
}
