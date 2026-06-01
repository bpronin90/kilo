import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../storage/entries';
import { makeWorkoutNoteItem } from '../lib/data';
import { parseWorkoutNote } from '../lib/parser';

// Per-note parsed-sections cache, keyed by note id. We store the raw_text the
// sections were parsed from so a note edit only reparses that one note while
// unrelated notes reuse their cached sections. Replaces the full-notebook
// reparse Home and Analytics each ran on every render.
const noteSectionsCache = new Map();

export function getNoteSections(note) {
  if (!note || !note.raw_text) return [];
  const key = note.id != null ? note.id : note.raw_text;
  const cached = noteSectionsCache.get(key);
  if (cached && cached.raw_text === note.raw_text) {
    return cached.sections;
  }
  const { sections } = parseWorkoutNote(note.raw_text);
  noteSectionsCache.set(key, { raw_text: note.raw_text, sections });
  return sections;
}

const safeNotify = (listeners) =>
  listeners.forEach(l => { try { l(); } catch (e) { console.warn('[useEntries] listener error', e); } });

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

  const update = useCallback(async (id, weight_value, note, date) => {
    const ok = await Storage.updateWeightEntry(id, weight_value, note, date);
    if (ok) {
      notifyWeight();
    }
    return ok;
  }, []);

  return { entries, loading, error, add, remove, update, refresh };
}


let workoutNotesListeners = [];
const notifyWorkoutNotes = () => safeNotify(workoutNotesListeners);

let trackedLiftsListeners = [];
const notifyTrackedLifts = () => safeNotify(trackedLiftsListeners);

let currentTrackedLifts = {};
// Seed the write queue with the initial load so toggle/save always derive from
// real storage, not the empty module-scope default.
let trackedLiftsPromise = Storage.loadTrackedLifts()
  .then(data => { currentTrackedLifts = data; })
  .catch(() => {});

export function useWorkoutNotes() {
  const [notes, setNotes] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setError(null);
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

let deloadNoteListeners = [];
const notifyDeloadNote = () => safeNotify(deloadNoteListeners);

export function useDeloadNote() {
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setError(null);
    Storage.loadDeloadNote()
      .then(setNote)
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    deloadNoteListeners.push(refresh);
    return () => {
      deloadNoteListeners = deloadNoteListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const save = useCallback(async (raw_text) => {
    const saved = await Storage.saveDeloadNote(raw_text);
    setNote(saved);
    notifyDeloadNote();
    return saved;
  }, []);

  const clear = useCallback(async () => {
    await Storage.clearDeloadNote();
    setNote(null);
    notifyDeloadNote();
  }, []);

  return { note, loading, error, save, clear, refresh };
}

let profileListeners = [];
const notifyProfile = () => safeNotify(profileListeners);

export function useUserProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    Storage.loadUserProfile()
      .then(setProfile)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    profileListeners.push(refresh);
    return () => {
      profileListeners = profileListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const save = useCallback(async (profile_data) => {
    const saved = await Storage.saveUserProfile(profile_data);
    setProfile(saved);
    notifyProfile();
    return saved;
  }, []);

  const clear = useCallback(async () => {
    await Storage.clearUserProfile();
    setProfile(null);
    notifyProfile();
  }, []);

  return { profile, loading, save, clear };
}
