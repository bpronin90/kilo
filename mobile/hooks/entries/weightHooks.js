import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import {
  loadArchivedWeightGoals,
  loadArchivedWeightGoalsRaw,
  replaceArchivedWeightGoalsRaw,
} from '../../storage/entries/weightGoal';
import { getClientId, stampWrite, enqueueDirty, SYNC_TABLES } from '../../storage/syncQueue';
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

  const archiveGoal = useCallback(async (completedWeight) => {
    if (!goal) return;
    const now = new Date().toISOString();
    const base = {
      id: `ag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      target_weight: goal.target_weight ?? null,
      target_date: goal.target_date ?? null,
      start_weight: goal.start_weight ?? null,
      start_date: goal.start_date ?? null,
      completed_weight: completedWeight ?? null,
      archived_at: now,
      saved_at: now,
    };
    const clientId = await getClientId();
    const stamped = stampWrite(base, clientId);
    const list = await loadArchivedWeightGoalsRaw();
    list.push(stamped);
    await replaceArchivedWeightGoalsRaw(list);
    await enqueueDirty(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS, stamped);
    await Storage.clearWeightGoal();
    setGoal(null);
    notifyGoal();
  }, [goal]);

  return { goal, loading, save, clear, archiveGoal };
}

let archivedGoalListeners = [];
const notifyArchivedGoals = () => safeNotify(archivedGoalListeners);

export function useArchivedWeightGoals() {
  const [archivedGoals, setArchivedGoals] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    loadArchivedWeightGoals()
      .then(setArchivedGoals)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    archivedGoalListeners.push(refresh);
    return () => {
      archivedGoalListeners = archivedGoalListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  return { archivedGoals, loading, refresh };
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
