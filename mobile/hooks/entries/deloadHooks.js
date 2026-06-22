import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { writeVia } from './storageMode';
import { safeNotify } from './shared';
import { DELOAD_NOTE_PREFIX, notifyWorkoutNotes } from './workoutNoteHooks';

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

let deloadHistoryListeners = [];
const notifyDeloadHistory = () => safeNotify(deloadHistoryListeners);

export function useDeloadHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setError(null);
    Storage.loadDeloadHistory()
      .then(setHistory)
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    deloadHistoryListeners.push(refresh);
    return () => {
      deloadHistoryListeners = deloadHistoryListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const deleteDeload = useCallback(async (id) => {
    await Storage.deleteDeloadHistory(id);
    notifyDeloadHistory();
  }, []);

  const completeDeload = useCallback(async ({ sessionCount, deloadSessionOrdinal }) => {
    const activeNote = await Storage.loadDeloadNote();
    if (!activeNote) return null;
    const completed_at = new Date().toISOString();
    const dateStr = completed_at.slice(0, 10);
    const noteId = `wn_dl_${dateStr}_${Date.now()}`;
    const workoutNote = {
      id: noteId,
      title: `${DELOAD_NOTE_PREFIX}${dateStr}`,
      raw_text: activeNote.raw_text,
      saved_at: completed_at,
      updated_at: completed_at,
      tracked_exercises: [],
      one_k_exercises: null,
      isCurrent: false,
    };
    const record = {
      id: `dl_${dateStr}_${Date.now()}`,
      raw_text: activeNote.raw_text,
      generated_at: activeNote.saved_at,
      completed_at,
      session_count: sessionCount,
      deload_session_ordinal: deloadSessionOrdinal ?? null,
      note_id: noteId,
    };
    await Storage.appendDeloadHistory(record);
    await writeVia('saveWorkoutNoteItem', Storage.saveWorkoutNoteItem, workoutNote);
    await Storage.clearDeloadNote();
    notifyDeloadHistory();
    notifyDeloadNote();
    notifyWorkoutNotes();
    return record;
  }, []);

  const deleteDeloadNote = useCallback(async (noteId) => {
    const hist = await Storage.loadDeloadHistory();
    const record = hist.find(r => r.note_id === noteId);
    if (record) {
      await Storage.deleteDeloadHistory(record.id);
      notifyDeloadHistory();
    }
    await writeVia('deleteWorkoutNoteItem', Storage.deleteWorkoutNoteItem, noteId);
    notifyWorkoutNotes();
  }, []);

  const updateDeload = useCallback(async (id, patch) => {
    await Storage.updateDeloadHistory(id, patch);
    notifyDeloadHistory();
  }, []);

  return { history, loading, error, completeDeload, deleteDeload, deleteDeloadNote, updateDeload, refresh };
}
