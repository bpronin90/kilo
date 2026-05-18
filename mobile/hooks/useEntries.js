import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../storage/entries';

let weightListeners = [];
const notifyWeight = () => weightListeners.forEach(l => l());

let noteListeners = [];
const notifyNote = () => noteListeners.forEach(l => l());

export function useWeightEntries() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    Storage.loadWeightEntries()
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
    await Storage.saveWeightEntry(entry);
    notifyWeight();
  }, []);

  const remove = useCallback(async (id) => {
    await Storage.deleteWeightEntry(id);
    notifyWeight();
  }, []);

  const update = useCallback(async (id, weight_value, note) => {
    const ok = await Storage.updateWeightEntry(id, weight_value, note);
    if (ok) {
      notifyWeight();
    }
    return ok;
  }, []);

  return { entries, loading, error, add, remove, update };
}

export function useWorkoutNote() {
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    Storage.loadWorkoutNote()
      .then(n => n ?? Storage.migrateWorkoutNote())
      .then(setNote)
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    noteListeners.push(refresh);
    return () => {
      noteListeners = noteListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const save = useCallback(async (raw_text) => {
    const saved = await Storage.saveWorkoutNote(raw_text);
    setNote(saved);
    notifyNote();
    return saved;
  }, []);

  const saveTracked = useCallback(async (tracked) => {
    const saved = await Storage.saveTrackedExercises(tracked);
    setNote(saved);
    notifyNote();
    return saved;
  }, []);

  const saveOneK = useCallback(async (one_k_exercises) => {
    const saved = await Storage.saveOneKExercises(one_k_exercises);
    setNote(saved);
    notifyNote();
    return saved;
  }, []);

  const clear = useCallback(async () => {
    await Storage.clearWorkoutNote();
    setNote(null);
    notifyNote();
  }, []);

  return { note, loading, error, save, saveTracked, saveOneK, clear };
}
