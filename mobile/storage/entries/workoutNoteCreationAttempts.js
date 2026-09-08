// Device-local workout-note creation attempts (#997).
//
// `add` in useWorkoutNotes mints a note id, writes the local row, and only
// then awaits the cloud enqueue — and in cloud mode `saveWorkoutNoteItem` can
// reject on the enqueue alone, after the routine has already landed on the
// device with no durable intent to upload it. A blind retry used to mint a
// second id and duplicate the routine.
//
// The correlation key is an explicit token the CALLER mints before the create
// and holds until the create fully succeeds. It is deliberately NOT derived
// from the note payload: the user must be able to fix the title or the body of
// a failed create and retry the SAME create (payload-keyed correlation cannot
// express an edited retry), while a genuinely new routine whose title and body
// happen to be byte-identical to an earlier one must still get its own id.
// There is no TTL, no age-out, no time window, and no payload-equality
// carve-out — one token correlates exactly one create-attempt sequence and
// nothing else ever does.
//
// Two records per attempt, both under ONE storage key so a single atomic
// read-modify-write (`secureStorage.updateItem`) covers them together:
//
//   pending[owner][contextKey] = token
//     the caller's durable "there is an unfinished create here" slot. Keyed by
//     caller context ('current:new', 'other:new', 'import'), so it survives an
//     app restart and is what each caller restores on mount. Nested under the
//     local-data owner so one account starting a create in a context can never
//     overwrite (and thereby strand) another account's unfinished one.
//
//   attempts[token] = { noteId, owner }
//     the id that attempt created. A retry carrying the same token completes
//     the ORIGINAL note under this id instead of minting a second one.
//
// This is device-local protocol state: it is not a sync table, never reaches
// the backup payload, and the kilo_ prefix keeps it inside purgeLocalData's
// account-transition wipe.
import { secureStorage as AsyncStorage } from '../secureStorage';
import { getLocalDataOwner } from './localDataOwner';

const WORKOUT_NOTE_CREATION_ATTEMPTS_KEY = 'kilo_workout_note_creation_attempts_v1';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Tolerant of absent, truncated, and legacy state for the same reason the
// draft store is: this is a local convenience record, and a parse failure must
// degrade to "no attempt is pending" rather than break saving a routine.
function parseState(raw) {
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const state = isPlainObject(parsed) ? parsed : {};
  return {
    pending: isPlainObject(state.pending) ? { ...state.pending } : {},
    attempts: isPlainObject(state.attempts) ? { ...state.attempts } : {},
    nextSequence: Number.isInteger(state.nextSequence) && state.nextSequence > 0
      ? state.nextSequence
      : 1,
  };
}

function ownerSlots(state, owner) {
  const slots = state.pending[owner];
  return isPlainObject(slots) ? slots : null;
}

function readPendingToken(state, contextKey, owner) {
  const token = ownerSlots(state, owner)?.[contextKey];
  return typeof token === 'string' && token ? token : null;
}

function writePendingToken(state, contextKey, owner, token) {
  const slots = { ...(ownerSlots(state, owner) || {}), [contextKey]: token };
  state.pending = { ...state.pending, [owner]: slots };
}

function deletePendingToken(state, contextKey, owner) {
  const slots = { ...(ownerSlots(state, owner) || {}) };
  delete slots[contextKey];
  const pending = { ...state.pending };
  if (Object.keys(slots).length === 0) delete pending[owner];
  else pending[owner] = slots;
  state.pending = pending;
}

function readAttemptNoteId(state, token, owner) {
  const attempt = state.attempts[token];
  if (!isPlainObject(attempt) || typeof attempt.noteId !== 'string' || !attempt.noteId) return null;
  if (attempt.owner !== owner) return null;
  return attempt.noteId;
}

// A persisted sequence, not a timestamp, is what makes tokens unique: two
// creates started inside the same millisecond still mint different tokens, and
// the counter is advanced inside the locked transform so concurrent callers
// cannot collide. The date segment is for human readability only — nothing
// ever reads it, and no rule anywhere ages a token out.
function mintToken(sequence) {
  return `wnca_${sequence}_${Date.now()}`;
}

// The atomic get-or-mint every create goes through. The durable slot is
// authoritative, so a caller whose in-memory restore has not landed yet (or
// failed) still continues the unfinished attempt instead of clobbering it with
// a fresh token — that clobber is exactly how a stranded create becomes a
// duplicate routine.
export async function ensureWorkoutNoteCreationAttempt(contextKey) {
  if (!contextKey) return null;
  const owner = await getLocalDataOwner();
  let token = null;
  await AsyncStorage.updateItem(WORKOUT_NOTE_CREATION_ATTEMPTS_KEY, (current) => {
    const state = parseState(current);
    const existing = readPendingToken(state, contextKey, owner);
    if (existing) {
      token = existing;
      return null;
    }
    token = mintToken(state.nextSequence);
    state.nextSequence += 1;
    writePendingToken(state, contextKey, owner, token);
    return JSON.stringify(state);
  });
  return token;
}

// Restore surface: the token a caller left behind, including across an app
// restart. Returns null when this context has no unfinished create.
export async function loadWorkoutNoteCreationAttempt(contextKey) {
  if (!contextKey) return null;
  const owner = await getLocalDataOwner();
  const raw = await AsyncStorage.getItem(WORKOUT_NOTE_CREATION_ATTEMPTS_KEY);
  return readPendingToken(parseState(raw), contextKey, owner);
}

// Binds the attempt to the id it creates, atomically and only once: the FIRST
// claim wins and every later claim for the same token is answered with that
// same id. Two overlapping creates carrying one token therefore write one row,
// and a retry is handed the original id rather than the one it just minted.
export async function claimWorkoutNoteCreationAttemptId(token, mintedNoteId) {
  if (!token || !mintedNoteId) return mintedNoteId ?? null;
  const owner = await getLocalDataOwner();
  let noteId = mintedNoteId;
  await AsyncStorage.updateItem(WORKOUT_NOTE_CREATION_ATTEMPTS_KEY, (current) => {
    const state = parseState(current);
    const bound = readAttemptNoteId(state, token, owner);
    if (bound) {
      noteId = bound;
      return null;
    }
    state.attempts[token] = { noteId: mintedNoteId, owner };
    return JSON.stringify(state);
  });
  return noteId;
}

// Inspection surface for tests and diagnosis; owner-filtered like every read
// here, so one account can never enumerate another's pending creates.
export async function loadWorkoutNoteCreationAttemptId(token) {
  if (!token) return null;
  const owner = await getLocalDataOwner();
  const raw = await AsyncStorage.getItem(WORKOUT_NOTE_CREATION_ATTEMPTS_KEY);
  return readAttemptNoteId(parseState(raw), token, owner);
}

// Called only once a create has FULLY succeeded (local row and cloud enqueue).
// It retires exactly the completed attempt: the binding for `token`, and this
// context's slot only while that slot still names `token`. A newer create in
// the same context — a different token — keeps its slot, so an overlapping
// completion can never strand it.
export async function clearWorkoutNoteCreationAttempt(contextKey, token) {
  if (!token) return;
  const owner = await getLocalDataOwner();
  await AsyncStorage.updateItem(WORKOUT_NOTE_CREATION_ATTEMPTS_KEY, (current) => {
    const state = parseState(current);
    let touched = false;
    if (readAttemptNoteId(state, token, owner)) {
      delete state.attempts[token];
      touched = true;
    }
    if (contextKey && readPendingToken(state, contextKey, owner) === token) {
      deletePendingToken(state, contextKey, owner);
      touched = true;
    }
    return touched ? JSON.stringify(state) : null;
  });
}

export async function clearAllWorkoutNoteCreationAttempts() {
  await AsyncStorage.removeItem(WORKOUT_NOTE_CREATION_ATTEMPTS_KEY);
}
