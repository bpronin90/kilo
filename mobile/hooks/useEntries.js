import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../storage/entries';

let weightListeners = [];
const notifyWeight = () => weightListeners.forEach(l => l());

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

export function useWorkoutSessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Storage.loadWorkoutSessions()
      .then(setSessions)
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  const add = useCallback(async (session) => {
    await Storage.saveWorkoutSession(session);
    setSessions(prev => [session, ...prev]);
  }, []);

  const remove = useCallback(async (id) => {
    await Storage.deleteWorkoutSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
  }, []);

  return { sessions, loading, error, add, remove };
}

export function useWorkoutNote() {
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Storage.loadWorkoutNote()
      .then(n => n ?? Storage.migrateWorkoutNote())
      .then(setNote)
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (raw_text) => {
    const saved = await Storage.saveWorkoutNote(raw_text);
    setNote(saved);
    return saved;
  }, []);

  const clear = useCallback(async () => {
    await Storage.clearWorkoutNote();
    setNote(null);
  }, []);

  return { note, loading, error, save, clear };
}
