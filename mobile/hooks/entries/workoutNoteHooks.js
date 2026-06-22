import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { makeWorkoutNoteItem } from '../../lib/data';
import { maybeSyncCloud, readVia, writeVia } from './storageMode';
import { safeNotify } from './shared';

export const DELOAD_NOTE_PREFIX = 'Deload · ';

export let workoutNotesListeners = [];
export const notifyWorkoutNotes = () => safeNotify(workoutNotesListeners);

export function useWorkoutNotes() {
  const [notes, setNotes] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setError(null);
    maybeSyncCloud()
      .then(() =>
        Promise.all([
          readVia('loadWorkoutNotes', Storage.loadWorkoutNotes),
          Storage.loadCurrentWorkoutId(),
        ])
      )
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
  const deloadNotes = notes.filter(n => n.title?.startsWith(DELOAD_NOTE_PREFIX));

  const add = useCallback(async (title, raw_text = '') => {
    const note = makeWorkoutNoteItem({ title, raw_text });
    await writeVia('saveWorkoutNoteItem', Storage.saveWorkoutNoteItem, note);
    notifyWorkoutNotes();
    return note;
  }, []);

  const update = useCallback(async (id, patch) => {
    const list = await readVia('loadWorkoutNotes', Storage.loadWorkoutNotes);
    const note = list.find(n => n.id === id);
    if (!note) return false;
    const updated = { ...note, ...patch, updated_at: new Date().toISOString() };
    await writeVia('saveWorkoutNoteItem', Storage.saveWorkoutNoteItem, updated);
    notifyWorkoutNotes();
    return updated;
  }, []);

  const remove = useCallback(async (id) => {
    await writeVia('deleteWorkoutNoteItem', Storage.deleteWorkoutNoteItem, id);
    if (id === currentId) {
      await Storage.clearCurrentWorkoutId();
    }
    notifyWorkoutNotes();
  }, [currentId]);

  const selectCurrent = useCallback(async (id) => {
    await Storage.setCurrentWorkoutNote(id);
    notifyWorkoutNotes();
  }, []);

  return { notes, currentId, currentNote, deloadNotes, loading, error, add, update, remove, selectCurrent, refresh };
}
