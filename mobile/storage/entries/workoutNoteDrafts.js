// Cheap, independent local drafts for the workout-note editors (#880).
//
// The existing autosave path (useLogCurrentRoutineEditor's debounced
// handleSave) is expensive: it re-parses the whole note, derives analytics,
// skip data, and session check-ins, and — in cloud mode — enqueues a sync
// write. That cost is why it only fires on a multi-second debounce and, for a
// brand-new note with no id yet, does not fire at all until the user taps
// Save. An interruption (background, crash, kill) before that first explicit
// save silently loses the whole new routine.
//
// This module is the cheap side of that split: a single JSON.stringify of
// {title, raw_text} keyed by editor context, written on its own short
// debounce and flushed immediately on backgrounding. It never parses,
// derives, or touches the network, so it is safe to persist far more often
// than the real save. It is a local safety net only — every draft is
// attached to a `baseUpdatedAt` snapshot of the canonical note (or `null` for
// a brand-new note) so a restore can refuse to overwrite canonical content
// that has moved on since the draft was written (e.g. a newer edit synced
// from another device).
//
// Deliberately its own storage key, separate from WORKOUT_NOTE_KEY /
// WORKOUT_NOTES_KEY: a draft is disposable scratch state, not part of the
// canonical note list, and must never be picked up by backup/restore,
// export, or sync as if it were real note data.
import { secureStorage as AsyncStorage } from '../secureStorage';

const WORKOUT_NOTE_DRAFTS_KEY = 'kilo_workout_note_drafts_v1';

async function readAllDrafts() {
  try {
    const raw = await AsyncStorage.getItem(WORKOUT_NOTE_DRAFTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A corrupt or unreadable draft table is scratch state, not the
    // canonical note — treat it as empty rather than surfacing an error the
    // user cannot act on.
    return {};
  }
}

async function writeAllDrafts(map) {
  await AsyncStorage.setItem(WORKOUT_NOTE_DRAFTS_KEY, JSON.stringify(map));
}

// contextKey identifies WHICH editor context a draft belongs to, e.g.
// `note:<id>` for an existing note (current or other), or `new-current` /
// `new-other` for an editor open on a not-yet-saved note. Restoring a draft
// under the wrong key (or the wrong note id) is exactly the "attaches to the
// wrong context" failure the acceptance criteria forbid, so callers must
// always pass the same key they used to save.
export async function saveWorkoutNoteDraft(contextKey, { title = '', raw_text = '', baseUpdatedAt = null } = {}) {
  if (!contextKey) return;
  const drafts = await readAllDrafts();
  drafts[contextKey] = {
    title,
    raw_text,
    baseUpdatedAt,
    savedAt: new Date().toISOString(),
  };
  await writeAllDrafts(drafts);
}

export async function loadWorkoutNoteDraft(contextKey) {
  if (!contextKey) return null;
  const drafts = await readAllDrafts();
  return drafts[contextKey] || null;
}

export async function clearWorkoutNoteDraft(contextKey) {
  if (!contextKey) return;
  const drafts = await readAllDrafts();
  if (!(contextKey in drafts)) return;
  delete drafts[contextKey];
  await writeAllDrafts(drafts);
}

// Account transition (sign-in/sign-out) and "drop everything" recovery paths
// must not leave a stale draft that could later attach to an unrelated
// note/account. Clears the whole table rather than trying to enumerate every
// live context key.
export async function clearAllWorkoutNoteDrafts() {
  await AsyncStorage.removeItem(WORKOUT_NOTE_DRAFTS_KEY);
}
