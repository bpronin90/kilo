import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  WORKOUT_KEY,
  WORKOUT_NOTE_KEY,
  WORKOUT_NOTES_KEY,
  CURRENT_WORKOUT_ID_KEY,
} from './keys';
import { readList, writeList } from './jsonStorage';

// ── legacy workout sessions ────────────────────────────────────────────────────

export async function loadWorkoutSessions() {
  const list = await readList(WORKOUT_KEY);
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

export async function saveWorkoutSession(session) {
  const list = await readList(WORKOUT_KEY);
  list.push(session);
  await writeList(WORKOUT_KEY, list);
}

export async function deleteWorkoutSession(id) {
  const list = await readList(WORKOUT_KEY);
  await writeList(WORKOUT_KEY, list.filter(e => e.id !== id));
}

// ── single routine note ────────────────────────────────────────────────────────

export async function loadWorkoutNote() {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_NOTE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveWorkoutNote(raw_text) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    raw_text,
    saved_at: existing ? existing.saved_at : now,
    updated_at: now,
    tracked_exercises: existing?.tracked_exercises || [],
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function saveTrackedExercises(tracked_exercises) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    tracked_exercises,
    updated_at: now,
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function saveOneKExercises(one_k_exercises) {
  const now = new Date().toISOString();
  const existing = await loadWorkoutNote();
  const note = {
    ...existing,
    one_k_exercises,
    updated_at: now,
  };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function clearWorkoutNote() {
  await AsyncStorage.removeItem(WORKOUT_NOTE_KEY);
}

// ── multi-note notebook ────────────────────────────────────────────────────────

export async function loadWorkoutNotes() {
  // Tombstones are sync metadata, never user-visible notes. Cloud mode has
  // always filtered them in cloudDomainMethods; local mode must apply the same
  // visibility contract because consent withdrawal deliberately falls back to
  // local-only reads while retaining tombstones for later convergence.
  return (await readList(WORKOUT_NOTES_KEY)).filter((note) => !note?.deleted_at);
}

// Raw cache accessors for the cloud sync engine (Phase 4 / Task 11). Expose the
// unfiltered backing notebook list (including delete tombstones and sync
// metadata) so the sync loop can merge, push, and advance cursors over the full
// record set. Local mode never uses these.
export async function loadWorkoutNotesRaw() {
  return readList(WORKOUT_NOTES_KEY);
}

export async function replaceWorkoutNotesRaw(list) {
  await writeList(WORKOUT_NOTES_KEY, Array.isArray(list) ? list : []);
}

export async function saveWorkoutNoteItem(note) {
  const list = await readList(WORKOUT_NOTES_KEY);
  const idx = list.findIndex(n => n.id === note.id);
  if (idx >= 0) {
    list[idx] = note;
  } else {
    list.push(note);
  }
  await writeList(WORKOUT_NOTES_KEY, list);
}

export async function deleteWorkoutNoteItem(id) {
  const list = await readList(WORKOUT_NOTES_KEY);
  await writeList(WORKOUT_NOTES_KEY, list.filter(n => n.id !== id));
  const currentId = await loadCurrentWorkoutId();
  if (currentId === id) {
    await clearCurrentWorkoutId();
  }
}

// ── current workout selection ──────────────────────────────────────────────────

export async function loadCurrentWorkoutId() {
  try {
    const raw = await AsyncStorage.getItem(CURRENT_WORKOUT_ID_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveCurrentWorkoutId(id) {
  await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(id));
}

export async function clearCurrentWorkoutId() {
  await AsyncStorage.removeItem(CURRENT_WORKOUT_ID_KEY);
}

// Mark a note as the current routine.
// All other notes in the list are marked isCurrent: false.
// Also updates CURRENT_WORKOUT_ID_KEY for backward compatibility.
export async function setCurrentWorkoutNote(id) {
  const list = await readList(WORKOUT_NOTES_KEY);
  const updated = list.map(n => {
    if (n.id === id) {
      return { ...n, isCurrent: true };
    }
    return { ...n, isCurrent: false };
  });
  await writeList(WORKOUT_NOTES_KEY, updated);
  await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(id));
}
