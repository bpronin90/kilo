import { useState, useEffect, useCallback } from 'react';
import * as Storage from '../storage/entries';
import { cloudAdapter } from '../storage/cloudAdapter';
import { makeWorkoutNoteItem } from '../lib/data';
import { parseWorkoutNote } from '../lib/parser';
import {
  SYNC_PHASE,
  getSyncState,
  subscribeSyncState,
  runPhase,
} from '../storage/syncRecovery';

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
  const deloadNotes = notes.filter(n => n.title?.startsWith(DELOAD_NOTE_PREFIX));

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

  return { notes, currentId, currentNote, deloadNotes, loading, error, add, update, remove, selectCurrent, refresh };
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

const DELOAD_NOTE_PREFIX = 'Deload · ';

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
    await Storage.saveWorkoutNoteItem(workoutNote);
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
    await Storage.deleteWorkoutNoteItem(noteId);
    notifyWorkoutNotes();
  }, []);

  const updateDeload = useCallback(async (id, patch) => {
    await Storage.updateDeloadHistory(id, patch);
    notifyDeloadHistory();
  }, []);

  return { history, loading, error, completeDeload, deleteDeload, deleteDeloadNote, updateDeload, refresh };
}

// ── feature toggles (fatigue tracking / deload mode) ──────────────────────────
// Module-scoped cache + listeners so toggling in Settings propagates live to the
// Log and Analytics tabs without threading props through App.
const DEFAULT_FEATURE_TOGGLES = { fatigueTrackingEnabled: true, deloadModeEnabled: true };
let currentFeatureToggles = { ...DEFAULT_FEATURE_TOGGLES };
let featureToggleListeners = [];
const notifyFeatureToggles = () => safeNotify(featureToggleListeners);

let featureTogglesPromise = Promise.all([
  Storage.loadFatigueTrackingEnabled(),
  Storage.loadDeloadModeEnabled(),
])
  .then(([fatigueTrackingEnabled, deloadModeEnabled]) => {
    currentFeatureToggles = { fatigueTrackingEnabled, deloadModeEnabled };
    notifyFeatureToggles();
  })
  .catch(() => {});

export function useFeatureToggles() {
  const [toggles, setToggles] = useState(currentFeatureToggles);

  const refresh = useCallback(() => {
    setToggles({ ...currentFeatureToggles });
  }, []);

  useEffect(() => {
    featureTogglesPromise.then(refresh);
    featureToggleListeners.push(refresh);
    return () => {
      featureToggleListeners = featureToggleListeners.filter(l => l !== refresh);
    };
  }, [refresh]);

  const setFatigueTrackingEnabled = useCallback(async (enabled) => {
    currentFeatureToggles = { ...currentFeatureToggles, fatigueTrackingEnabled: enabled };
    setToggles(currentFeatureToggles);
    await Storage.saveFatigueTrackingEnabled(enabled);
    notifyFeatureToggles();
  }, []);

  const setDeloadModeEnabled = useCallback(async (enabled) => {
    currentFeatureToggles = { ...currentFeatureToggles, deloadModeEnabled: enabled };
    setToggles(currentFeatureToggles);
    await Storage.saveDeloadModeEnabled(enabled);
    notifyFeatureToggles();
  }, []);

  return { ...toggles, setFatigueTrackingEnabled, setDeloadModeEnabled };
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

// ── cloud sync recovery + cloud export (Phase 4 / Task 12) ────────────────────
//
// useSyncRecovery exposes the bootstrap/sync recovery state from the recovery
// store so screens can show idle/running/failed/complete and offer a retry. The
// retry is non-destructive: it re-invokes the bound runner via the store, and a
// failure leaves local data untouched.
//
// Runner binding lives here (not in the screen) so MoreScreen stays declarative
// and never imports the supabase client directly:
//   - BOOTSTRAP: bound to cloudAdapter.bootstrapFromLocal(userId) using the
//     signed-in user's id. Available now (#319 is on this branch).
//   - SYNC: feature-detected from the active storage adapter. When #320's
//     offline-sync engine lands it exposes adapter.sync(); until then no sync
//     runner is available and retry reports an honest "not available" state
//     instead of silently succeeding.
//
// Passing no user (signed out / pre-auth) yields no bootstrap runner, so retry
// reports honestly rather than calling the adapter with a missing id.

function makeBootstrapRunner(user) {
  const userId = user?.id;
  if (!userId) return null;
  return () => cloudAdapter.bootstrapFromLocal(userId);
}

function makeSyncRunner() {
  const adapter = Storage.getStorageAdapter();
  return typeof adapter.sync === 'function' ? () => adapter.sync() : null;
}

export function useSyncRecovery(user = null) {
  const [snapshot, setSnapshot] = useState(getSyncState);

  useEffect(() => {
    // Resync once on mount in case state changed before subscribe attached.
    setSnapshot(getSyncState());
    const unsubscribe = subscribeSyncState((next) => setSnapshot(next));
    return unsubscribe;
  }, []);

  const userId = user?.id ?? null;

  const runBootstrap = useCallback(() => {
    const runner = makeBootstrapRunner(user);
    if (!runner) {
      return Promise.resolve({
        ok: false,
        error: 'Sign in to bootstrap your cloud data.',
      });
    }
    return runPhase(SYNC_PHASE.BOOTSTRAP, runner);
  }, [userId]);

  const runSync = useCallback(() => {
    const runner = makeSyncRunner();
    if (!runner) {
      return Promise.resolve({
        ok: false,
        error: 'Cloud sync is not available in this build yet.',
      });
    }
    return runPhase(SYNC_PHASE.SYNC, runner);
  }, []);

  return {
    bootstrap: snapshot[SYNC_PHASE.BOOTSTRAP],
    sync: snapshot[SYNC_PHASE.SYNC],
    // Retry re-invokes the same bound runner; initial action and retry share
    // one path so a failed run becomes retryable and actually re-runs.
    runBootstrap,
    retryBootstrap: runBootstrap,
    runSync,
    retrySync: runSync,
  };
}

// useCloudExport builds a v3-compatible export plus the documented cloud-only
// fields. It is read-only and works regardless of sync state. `account` is the
// optional non-sensitive identity for the signed-in user.
export function useCloudExport() {
  const exportCloud = useCallback(async (account = null) => {
    try {
      const payload = await Storage.buildCloudExport({ account });
      return { ok: true, json: JSON.stringify(payload, null, 2), payload };
    } catch (e) {
      return { ok: false, error: e?.message || 'Failed to export cloud data.' };
    }
  }, []);

  return { exportCloud };
}
