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
import { markStartupPhase } from '../../storage/entries/startupTiming';

let goalListeners = [];
const notifyGoal = () => safeNotify(goalListeners);

export function useWeightGoal() {
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  // A goal read can fail like any other (#737 review). Without this the
  // `.finally` below cleared `loading` while `goal` stayed null, so a rejected
  // read was indistinguishable from a verified "no goal set" — and the
  // rejection itself went unhandled. Matches the error/refresh shape
  // useWeightEntries and useTrackedLifts already expose, so consumers can keep
  // loading, failure, and verified-empty apart.
  const [error, setError] = useState(null);

  // `error` is cleared by a read that SUCCEEDS, never on the way in (#737
  // review). Clearing it up front made the failure vanish the instant Retry was
  // tapped: `loading` is already false by then and the collection is still
  // empty, so the screen dropped straight back to rendering a verified-looking
  // "no goal set" while the retry was still in flight. The last completed read
  // stays the truth until a new one replaces it.
  const refresh = useCallback(() => {
    // loadWeightGoalResult, not loadWeightGoal: the latter collapses a failed
    // read into `null`, which is exactly the "no goal set" answer this state
    // exists to distinguish from. The result variant never rejects, so the
    // `.catch` below covers only an unexpected throw (or a mocked/alternate
    // implementation that does reject), not the ordinary failure path.
    //
    // The previous goal is deliberately left in place on failure: stale but
    // true beats silently reverting the user to "no goal".
    return Storage.loadWeightGoalResult()
      .then(({ ok, goal: next, error: readError }) => {
        if (ok) {
          setGoal(next);
          setError(null);
          markStartupPhase('weightGoal:reload:done');
        } else {
          setError(readError || new Error('Could not read the weight goal.'));
        }
      })
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    goalListeners.push(refresh);
    return () => {
      goalListeners = goalListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  // Writes deliberately do NOT clear `error` themselves. `notifyGoal()` re-runs
  // refresh on every mounted instance, so the next authoritative READ decides
  // the error state: it clears when the read recovers and stays put when it does
  // not. Clearing it here as well would briefly hide a failure that is still
  // real, which is the exact dishonesty this state exists to prevent.
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
    notifyArchivedGoals();
  }, [goal]);

  return { goal, loading, error, refresh, save, clear, archiveGoal };
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

// Reload fan-out. See the equivalent block in workoutNoteHooks.js (#459):
// reload() is instance-local, so a post-sync reload of one instance leaves every
// other mounted useWeightEntries() on the pre-sync snapshot. Listeners here are
// the instances' reload (a storage read), so this cannot re-enter maybeSyncCloud.
let weightReloadListeners = [];
export const reloadWeightEntries = () => safeNotify(weightReloadListeners);

export function useWeightEntries() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Cleared on success only — same reasoning as useWeightGoal above: an eager
  // clear made Retry drop the banner immediately and let Weight render "no
  // weigh-ins yet" as a verified answer while the retry was still in flight.
  const reload = useCallback(() => {
    return readVia('loadWeightEntries', Storage.loadWeightEntries)
      .then((next) => {
        setEntries(next);
        setError(null);
        markStartupPhase('weight:reload:done');
      })
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  // reload() owns clearing the error, so a sync that succeeds but is followed by
  // a failing read correctly stays in the failed state.
  const refresh = useCallback(() => {
    maybeSyncCloud()
      .then(reload)
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    // First paint reads on-device storage immediately instead of gating it
    // behind maybeSyncCloud()'s network round trip (#809): reload() alone is
    // the authoritative on-device cache and is exactly what refresh() would
    // eventually show anyway once sync settles, so there is nothing dishonest
    // about painting it first. The initial cloud sync (when signed in) still
    // runs, just in the background, and its own reload() lands whatever it
    // finds without re-opening the skeleton. Every LATER reload — a write, a
    // broadcast, or an explicit refresh() call — keeps the ordinary
    // sync-then-reload sequence below.
    reload();
    maybeSyncCloud().then(reload).catch(e => setError(e));
    weightListeners.push(refresh);
    weightReloadListeners.push(reload);
    return () => {
      weightListeners = weightListeners.filter(l => l !== refresh);
      weightReloadListeners = weightReloadListeners.filter(l => l !== reload);
    };
  }, [refresh, reload]);

  const add = useCallback(async (entry) => {
    // Propagate the write result (#596): the local/cloud saveWeightEntry
    // implementations resolve `undefined` on success, so callers must treat
    // anything other than an explicit `false` as success — a mocked or future
    // implementation that resolves `false` must still be caught as a failure.
    const result = await writeVia('saveWeightEntry', Storage.saveWeightEntry, entry);
    if (result !== false) {
      notifyWeight();
    }
    return result;
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

  return { entries, loading, error, add, remove, update, refresh, reload };
}
