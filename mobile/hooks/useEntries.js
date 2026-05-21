import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../storage/entries';
import { makeWorkoutNoteItem } from '../lib/data';

let goalListeners = [];
const notifyGoal = () => goalListeners.forEach(l => l());

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

  return { entries, loading, error, add, remove, update, refresh };
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

  return { note, loading, error, save, saveTracked, saveOneK, clear, refresh };
}

let workoutNotesListeners = [];
const notifyWorkoutNotes = () => workoutNotesListeners.forEach(l => l());

export function useWorkoutNotes() {
  const [notes, setNotes] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    Promise.all([Storage.loadWorkoutNotes(), Storage.loadCurrentWorkoutId()])
      .then(([ns, id]) => {
        setNotes(ns);
        setCurrentId(id);
      })
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    workoutNotesListeners.push(refresh);
    return () => {
      workoutNotesListeners = workoutNotesListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const currentNote = notes.find(n => n.id === currentId) ?? null;

  const add = useCallback(async (title, raw_text = '') => {
    const note = makeWorkoutNoteItem({ title, raw_text });
    await Storage.saveWorkoutNoteItem(note);
    notifyWorkoutNotes();
    return note;
  }, []);

  const update = useCallback(async (id, patch) => {
    const list = await Storage.loadWorkoutNotes();
    const note = list.find(n => n.id === id);
    if (!note) return false;
    const updated = { ...note, ...patch, updated_at: new Date().toISOString() };
    await Storage.saveWorkoutNoteItem(updated);
    notifyWorkoutNotes();
    return updated;
  }, []);

  const remove = useCallback(async (id) => {
    await Storage.deleteWorkoutNoteItem(id);
    if (id === currentId) {
      await Storage.clearCurrentWorkoutId();
    }
    notifyWorkoutNotes();
  }, [currentId]);

  const selectCurrent = useCallback(async (id) => {
    await Storage.setCurrentWorkoutNote(id);
    notifyWorkoutNotes();
  }, []);

  return { notes, currentId, currentNote, loading, error, add, update, remove, selectCurrent, refresh };
}
