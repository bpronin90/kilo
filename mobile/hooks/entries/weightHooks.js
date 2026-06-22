import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { maybeSyncCloud, readVia, writeVia } from './storageMode';
import { safeNotify } from './shared';

let goalListeners = [];
const notifyGoal = () => safeNotify(goalListeners);

export function useWeightGoal() {
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    Storage.loadWeightGoal()
      .then(setGoal)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    goalListeners.push(refresh);
    return () => {
      goalListeners = goalListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const save = useCallback(async (goal_data) => {
    const saved = await Storage.saveWeightGoal(goal_data);
    setGoal(saved);
    notifyGoal();
    return saved;
  }, []);

  const clear = useCallback(async () => {
    await Storage.clearWeightGoal();
    setGoal(null);
    notifyGoal();
  }, []);

  return { goal, loading, save, clear };
}

let weightListeners = [];
const notifyWeight = () => safeNotify(weightListeners);

export function useWeightEntries() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setError(null);
    maybeSyncCloud()
      .then(() => readVia('loadWeightEntries', Storage.loadWeightEntries))
      .then(setEntries)
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    weightListeners.push(refresh);
    return () => {
      weightListeners = weightListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const add = useCallback(async (entry) => {
    await writeVia('saveWeightEntry', Storage.saveWeightEntry, entry);
    notifyWeight();
  }, []);

  const remove = useCallback(async (id) => {
    await writeVia('deleteWeightEntry', Storage.deleteWeightEntry, id);
    notifyWeight();
  }, []);

  const update = useCallback(async (id, weight_value, note, date) => {
    const ok = await writeVia('updateWeightEntry', Storage.updateWeightEntry, id, weight_value, note, date);
    if (ok) {
      notifyWeight();
    }
    return ok;
  }, []);

  return { entries, loading, error, add, remove, update, refresh };
}
