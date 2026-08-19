import { secureStorage as AsyncStorage } from '../secureStorage';
import {
  WORKOUT_KEY,
  WORKOUT_NOTE_KEY,
  WORKOUT_NOTES_KEY,
  CURRENT_WORKOUT_ID_KEY,
} from './keys';
import { readList, writeList } from './jsonStorage';
import { stripDerivedSectionsFromList } from './derivedCache';

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

// Every notebook read and write goes through these two so the persisted
// notebook can never carry the parser-output cache again (issue #813; see
// derivedCache.js). Stripping on read keeps a notebook that was written by an
// older build lean in memory until the one-time purge below rewrites it; both
// helpers return the list by identity when there is nothing to strip.
async function readNotebook() {
  return stripDerivedSectionsFromList(await readList(WORKOUT_NOTES_KEY));
}

async function writeNotebook(list) {
  await writeList(WORKOUT_NOTES_KEY, stripDerivedSectionsFromList(list));
}

export async function loadWorkoutNotes() {
  // Tombstones are sync metadata, never user-visible notes. Cloud mode has
  // always filtered them in cloudDomainMethods; local mode must apply the same
  // visibility contract because consent withdrawal deliberately falls back to
  // local-only reads while retaining tombstones for later convergence.
  return (await readNotebook()).filter((note) => !note?.deleted_at);
}

// Raw cache accessors for the cloud sync engine (Phase 4 / Task 11). Expose the
// unfiltered backing notebook list (including delete tombstones and sync
// metadata) so the sync loop can merge, push, and advance cursors over the full
// record set. Local mode never uses these.
export async function loadWorkoutNotesRaw() {
  return readNotebook();
}

export async function replaceWorkoutNotesRaw(list) {
  await writeNotebook(Array.isArray(list) ? list : []);
}

export async function saveWorkoutNoteItem(note) {
  const list = await readNotebook();
  const idx = list.findIndex(n => n.id === note.id);
  if (idx >= 0) {
    list[idx] = note;
  } else {
    list.push(note);
  }
  await writeNotebook(list);
}

export async function deleteWorkoutNoteItem(id) {
  const list = await readNotebook();
  await writeNotebook(list.filter(n => n.id !== id));
  const currentId = await loadCurrentWorkoutId();
  if (currentId === id) {
    await clearCurrentWorkoutId();
  }
}

// Deletion-outcome probe for the recovery operation journal (#696).
//
// Answers one question from persisted state: is this note gone? Local mode hard
// -removes, so "absent" is the whole answer and there is no sync queue to keep
// intent in. `requiresQueue: false` tells the reconciler not to look for one.
//
// Deliberately reads the RAW list: a tombstone written by a previous cloud
// session that this device is now reading in local mode still counts as gone,
// and must never be mistaken for a live note the journal should re-delete.
export async function loadWorkoutNoteDeletionState(id) {
  const list = await readNotebook();
  const note = list.find(n => n?.id === id);
  return {
    exists: !!note,
    deleted: !note || !!note.deleted_at,
    requiresQueue: false,
    queued: false,
  };
}

// Presence probe for the recovery operation journal's "create a new note and
// attach it as the next week" operation (#696).
//
// The mirror image of loadWorkoutNoteDeletionState above: that one asks "is this
// note gone?", this one asks "is this note LIVE, and durably so?". Existence
// alone is not the answer — a tombstoned row exists, and a live membership
// pointing at a tombstoned note is exactly the dangling state the protocol
// forbids. Local mode has no upload queue, so `requiresQueue` is false.
export async function loadWorkoutNotePresenceState(id) {
  const list = await readNotebook();
  const note = list.find(n => n?.id === id);
  return {
    exists: !!note,
    deleted: !!note?.deleted_at,
    requiresQueue: false,
    queued: false,
  };
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
  const list = await readNotebook();
  const updated = list.map(n => {
    if (n.id === id) {
      return { ...n, isCurrent: true };
    }
    return { ...n, isCurrent: false };
  });
  await writeNotebook(updated);
  await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(id));
}
