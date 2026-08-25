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
// export, or sync as if it were real note data. The key stays `kilo_`
// prefixed on purpose (#880 revised body) so `purgeLocalData` in
// `localDataOwner.js` still wipes it on an account switch, exactly like every
// other kilo-prefixed key.
//
// Every draft lives inside ONE shared JSON map under a single storage key, so
// every mutation — a save for one context, a clear for another — goes through
// `secureStorage.updateItem`, which holds the read/transform/write under its
// storage lock (#880 review). A plain getItem()-then-setItem() pair (the
// original implementation) is not atomic: two concurrent mutations (e.g.
// `useWorkoutNotes.remove` clearing `current:<id>` and `other:<id>` at the
// same time, or a draft-write timer racing a cleanup) can both read the same
// map and the later whole-map write silently resurrects whatever the other
// call deleted or overwrites whatever the other call wrote.
//
// Ownership stamp (#880 revised body). `purgeLocalData` already clears this
// key on an account switch, but only AFTER it runs — there is a window
// between a new account signing in and that purge completing where a stale
// draft, if restored blind, could hand one account's just-typed text to
// another. Every draft is stamped with `getLocalDataOwner()` at write time,
// and `loadWorkoutNoteDraft` refuses to return a draft whose stamped owner
// does not exactly match the CURRENT owner — enforced inside the read itself,
// not left to each caller, so cross-account restoration is structurally
// impossible rather than merely unlikely. `unknown` never matches a real
// userId (see localDataOwner.js's own contract), so it is rejected by the
// same equality check with no special-casing. Sign-out deliberately does NOT
// clear drafts here: local history (drafts included) is retained on sign-out
// and still belongs to that user, exactly like the rest of local storage.
import { secureStorage as AsyncStorage } from '../secureStorage';
import { getLocalDataOwner } from './localDataOwner';

const WORKOUT_NOTE_DRAFTS_KEY = 'kilo_workout_note_drafts_v1';

function parseDraftMap(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A corrupt or unreadable draft table is scratch state, not the
    // canonical note — treat it as empty (and let the next write replace it)
    // rather than surfacing an error the user cannot act on.
    return {};
  }
}

// contextKey identifies WHICH editor context a draft belongs to: editor
// context (current-routine / other-note / recovery) PLUS note identity
// together, e.g. `current:<id>` / `other:<id>` for an existing note, or
// `current:new` / `other:new` for an editor open on a not-yet-saved note.
// Restoring a draft under the wrong key (or the wrong note id) is exactly the
// "attaches to the wrong context" failure the acceptance criteria forbid, so
// callers must always pass the same key they used to save.
export async function saveWorkoutNoteDraft(contextKey, { title = '', raw_text = '', baseUpdatedAt = null } = {}) {
  if (!contextKey) return;
  const owner = await getLocalDataOwner();
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    drafts[contextKey] = {
      title,
      raw_text,
      baseUpdatedAt,
      owner,
      savedAt: new Date().toISOString(),
    };
    return JSON.stringify(drafts);
  });
}

// Returns the draft for `contextKey` only when it belongs to the CURRENT
// local data owner. A draft stamped for a different owner (or written before
// this concept existed, i.e. `owner` is absent) is treated as absent — never
// returned, never offered to a caller to restore. This is the structural
// half of the account-transition defence; `purgeLocalData` remains the other
// half (it deletes the whole table outright on a switch).
export async function loadWorkoutNoteDraft(contextKey) {
  if (!contextKey) return null;
  const raw = await AsyncStorage.getItem(WORKOUT_NOTE_DRAFTS_KEY);
  const drafts = parseDraftMap(raw);
  const draft = drafts[contextKey];
  if (!draft) return null;
  const owner = await getLocalDataOwner();
  if (draft.owner !== owner) return null;
  return draft;
}

export async function clearWorkoutNoteDraft(contextKey) {
  if (!contextKey) return;
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    if (!(contextKey in drafts)) return null; // no-op: nothing to rewrite
    delete drafts[contextKey];
    return JSON.stringify(drafts);
  });
}

// Compare-and-clear: removes the draft for `contextKey` only if it still
// matches the exact {title, raw_text} snapshot that was just saved (#880
// review). A save's success handler snapshots the text it saved at the
// START of the write; if the user kept typing while that write was in
// flight, the cheap draft timer can persist those NEWER keystrokes before
// the save resolves. An unconditional clear at that point would delete text
// the real autosave has not saved yet — silent data loss on a crash before
// the next autosave. Checking under the same storage-lock transform as the
// delete itself (rather than a separate loadWorkoutNoteDraft + clear) also
// closes the TOCTOU window between the compare and the write.
export async function clearWorkoutNoteDraftIfMatches(contextKey, { title = '', raw_text = '' } = {}) {
  if (!contextKey) return;
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    const draft = drafts[contextKey];
    if (!draft) return null; // no-op: nothing to rewrite
    if (draft.title !== title || draft.raw_text !== raw_text) return null; // newer draft — keep it
    delete drafts[contextKey];
    return JSON.stringify(drafts);
  });
}

// Account transition (sign-in/sign-out) and "drop everything" recovery paths
// must not leave a stale draft that could later attach to an unrelated
// note/account. Clears the whole table rather than trying to enumerate every
// live context key. NOT called on ordinary sign-out (#880 revised body):
// local history, drafts included, is deliberately retained for that user.
// Reserved for the same "drop everything" path `purgeLocalData` itself is
// used for.
export async function clearAllWorkoutNoteDrafts() {
  await AsyncStorage.removeItem(WORKOUT_NOTE_DRAFTS_KEY);
}
