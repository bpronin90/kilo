import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { makeWorkoutNoteItem } from '../../lib/data';
import { reconcileWorkoutReminder } from '../../lib/reminderScheduler';
import { maybeSyncCloud, readVia, writeVia } from './storageMode';
import { safeNotify } from './shared';

export const DELOAD_NOTE_PREFIX = 'Deload · ';

export let workoutNotesListeners = [];
export const notifyWorkoutNotes = () => safeNotify(workoutNotesListeners);

// Always-on workout-reminder reconciliation (issue #590, follow-up to the
// PR #649 review finding). Registered once at module load — not inside a
// component's useEffect — so it stays active for the lifetime of the app
// regardless of which screen is mounted: a card-local listener only existed
// while the Settings screen happened to be rendered, so routine edits/
// switches made from Log (or any other screen) left the workout reminder
// pinned to stale inferred days. This fires on every add/update/remove/
// selectCurrent, and reconcileWorkoutReminder's own dedup cache keeps it a
// no-op unless the resolved schedule actually changed.
workoutNotesListeners.push(() => {
  reconcileWorkoutReminder().catch(() => {});
});

// Reload fan-out, separate from the notify fan-out above.
//
// Every screen holding useWorkoutNotes() keeps its own React state, so an
// instance-local reload() only refreshes the screen that called it (#459: App
// reloaded its own instance after a cloud sync, leaving AnalyticsScreen's
// instance on the pre-sync note set, so Home and Analytics derived their 1K
// from different data). A sync that lands new rows must re-read EVERY mounted
// instance. These listeners are the instances' reload — a plain storage read —
// not refresh, so broadcasting cannot re-enter maybeSyncCloud.
let workoutNoteReloadListeners = [];
export const reloadWorkoutNotes = () => safeNotify(workoutNoteReloadListeners);

export function useWorkoutNotes() {
  const [notes, setNotes] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setError(null);
    return Promise.all([
      readVia('loadWorkoutNotes', Storage.loadWorkoutNotes),
      Storage.loadCurrentWorkoutId(),
    ])
      .then(([ns, id]) => {
        setNotes(ns);
        setCurrentId(id);
      })
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(() => {
    setError(null);
    maybeSyncCloud()
      .then(reload)
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    refresh();
    workoutNotesListeners.push(refresh);
    workoutNoteReloadListeners.push(reload);
    return () => {
      workoutNotesListeners = workoutNotesListeners.filter(l => l !== refresh);
      workoutNoteReloadListeners = workoutNoteReloadListeners.filter(l => l !== reload);
    };
  }, [refresh, reload]);

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

  return { notes, currentId, currentNote, deloadNotes, loading, error, add, update, remove, selectCurrent, refresh, reload };
}
