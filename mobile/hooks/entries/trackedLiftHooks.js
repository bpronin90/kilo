import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { safeNotify } from './shared';

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

  const refresh = useCallback(() => {
    Storage.loadTrackedLifts()
      .then(data => {
        currentTrackedLifts = data;
        setTrackedLifts(data);
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
