// Cheap, device-local workout-note drafts (#880). Drafts live outside the
// canonical note table, backup payload, parser, derivation, and sync pipeline.
// The kilo_ prefix intentionally keeps them inside purgeLocalData's account-
// transition wipe.
import { secureStorage as AsyncStorage } from '../secureStorage';
import { getLocalDataOwner } from './localDataOwner';

const WORKOUT_NOTE_DRAFTS_KEY = 'kilo_workout_note_drafts_v1';

function parseDraftMap(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isDraft(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.title === 'string' && typeof value.raw_text === 'string';
}

// The original unmerged implementation stored one draft directly at each
// context key. Accept that shape so rebased/dev installs migrate in place.
function normalizeBucket(value) {
  if (isDraft(value)) return { active: value, retained: [] };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { active: null, retained: [] };
  }
  return {
    active: isDraft(value.active) ? value.active : null,
    retained: Array.isArray(value.retained) ? value.retained.filter(isDraft) : [],
  };
}

function sameRevision(a, b) {
  return a?.baseUpdatedAt === b?.baseUpdatedAt && a?.owner === b?.owner;
}

function sameSnapshot(a, b) {
  return a?.title === b?.title && a?.raw_text === b?.raw_text;
}

function retainOnce(retained, draft) {
  if (!draft) return retained;
  if (retained.some((item) => sameRevision(item, draft) && sameSnapshot(item, draft))) {
    return retained;
  }
  return [...retained, draft];
}

function newestFirst(a, b) {
  return String(b?.savedAt || '').localeCompare(String(a?.savedAt || ''));
}

function removeOwnerFromBucket(bucket, owner) {
  return {
    active: bucket.active?.owner === owner ? null : bucket.active,
    retained: bucket.retained.filter((draft) => draft.owner !== owner),
  };
}

function bucketIsEmpty(bucket) {
  return !bucket.active && bucket.retained.length === 0;
}

// contextKey is editor context + note identity: current:<id|new>,
// other:<id|new>, or recovery:<id>. A revision change archives the previous
// active draft instead of overwriting it. preserveExisting is used when a
// deliberate new-note seed must not replace an older interrupted new draft
// that happens to share the null revision sentinel.
export async function saveWorkoutNoteDraft(
  contextKey,
  { title = '', raw_text = '', baseUpdatedAt = null } = {},
  { preserveExisting = false } = {},
) {
  if (!contextKey) return;
  const owner = await getLocalDataOwner();
  const nextDraft = {
    title,
    raw_text,
    baseUpdatedAt,
    owner,
    savedAt: new Date().toISOString(),
  };
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    const sequence = Number.isInteger(drafts.__nextSequence) ? drafts.__nextSequence : 1;
    nextDraft.sequence = sequence;
    drafts.__nextSequence = sequence + 1;
    const bucket = normalizeBucket(drafts[contextKey]);
    if (bucket.active && (
      preserveExisting
      || (!sameRevision(bucket.active, nextDraft) && !sameSnapshot(bucket.active, nextDraft))
    )) {
      bucket.retained = retainOnce(bucket.retained, bucket.active);
    }
    bucket.active = nextDraft;
    drafts[contextKey] = bucket;
    return JSON.stringify(drafts);
  });
}

// Establishes an ordering boundary before a canonical save starts. A later
// successful cleanup may retire conflicts that existed before this checkpoint,
// while preserving a different draft written after it (typing during flight).
export async function markWorkoutNoteDraftSaveStart() {
  let checkpoint = null;
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    checkpoint = Number.isInteger(drafts.__nextSequence) ? drafts.__nextSequence : 1;
    drafts.__nextSequence = checkpoint + 1;
    return JSON.stringify(drafts);
  });
  return checkpoint;
}

// Load only drafts stamped for the current local owner. When baseUpdatedAt is
// supplied, return the newest exact-revision match; stale revisions remain on
// disk but are never auto-applied over newer canonical text.
export async function loadWorkoutNoteDraft(contextKey, options = {}) {
  if (!contextKey) return null;
  const owner = await getLocalDataOwner();
  const raw = await AsyncStorage.getItem(WORKOUT_NOTE_DRAFTS_KEY);
  const bucket = normalizeBucket(parseDraftMap(raw)[contextKey]);
  const candidates = [bucket.active, ...bucket.retained]
    .filter((draft) => draft?.owner === owner)
    .sort(newestFirst);
  const hasRevision = Object.prototype.hasOwnProperty.call(options, 'baseUpdatedAt');
  if (!hasRevision) return candidates[0] || null;
  return candidates.find((draft) => draft.baseUpdatedAt === options.baseUpdatedAt) || null;
}

// Focused inspection surface for recovery/storage tests. It is owner-filtered
// for the same reason as loadWorkoutNoteDraft; callers can never enumerate a
// different account's retained text.
export async function loadWorkoutNoteDrafts(contextKey) {
  if (!contextKey) return [];
  const owner = await getLocalDataOwner();
  const raw = await AsyncStorage.getItem(WORKOUT_NOTE_DRAFTS_KEY);
  const bucket = normalizeBucket(parseDraftMap(raw)[contextKey]);
  return [bucket.active, ...bucket.retained]
    .filter((draft) => draft?.owner === owner)
    .sort(newestFirst);
}

// Explicit discard/revert clears this owner's whole context, including any
// retained conflict. Foreign-owner entries are neither returned nor mutated.
export async function clearWorkoutNoteDraft(contextKey) {
  if (!contextKey) return;
  const owner = await getLocalDataOwner();
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    if (!(contextKey in drafts)) return null;
    const bucket = removeOwnerFromBucket(normalizeBucket(drafts[contextKey]), owner);
    if (bucketIsEmpty(bucket)) delete drafts[contextKey];
    else drafts[contextKey] = bucket;
    return JSON.stringify(drafts);
  });
}

// Successful saves remove only drafts that still equal the exact snapshot the
// write started with. Newer typing and unrelated retained conflicts survive.
export async function clearWorkoutNoteDraftIfMatches(
  contextKey,
  { title = '', raw_text = '' } = {},
) {
  if (!contextKey) return;
  const owner = await getLocalDataOwner();
  const snapshot = { title, raw_text };
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    if (!(contextKey in drafts)) return null;
    const bucket = normalizeBucket(drafts[contextKey]);
    if (bucket.active?.owner === owner && sameSnapshot(bucket.active, snapshot)) {
      bucket.active = null;
    }
    bucket.retained = bucket.retained.filter(
      (draft) => draft.owner !== owner || !sameSnapshot(draft, snapshot),
    );
    if (bucketIsEmpty(bucket)) delete drafts[contextKey];
    else drafts[contextKey] = bucket;
    return JSON.stringify(drafts);
  });
}

// Called only after canonical persistence succeeds. It retires drafts that
// predate the save attempt (including retained revision conflicts) and the
// exact saved snapshot. A different draft written after the checkpoint is the
// user's newer in-flight typing and must survive.
export async function clearWorkoutNoteDraftsSupersededBySave(
  contextKey,
  checkpoint,
  { title = '', raw_text = '' } = {},
) {
  if (!contextKey) return;
  const owner = await getLocalDataOwner();
  const snapshot = { title, raw_text };
  const superseded = (draft) => draft?.owner === owner && (
    sameSnapshot(draft, snapshot)
    || (Number.isInteger(checkpoint) && (draft.sequence ?? 0) < checkpoint)
  );
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    if (!(contextKey in drafts)) return null;
    const bucket = normalizeBucket(drafts[contextKey]);
    if (superseded(bucket.active)) bucket.active = null;
    bucket.retained = bucket.retained.filter((draft) => !superseded(draft));
    if (bucketIsEmpty(bucket)) delete drafts[contextKey];
    else drafts[contextKey] = bucket;
    return JSON.stringify(drafts);
  });
}

// Note deletion removes exactly this owner's current/other/Recovery contexts
// in one locked transform, never a sibling note or a foreign owner's drafts.
export async function clearWorkoutNoteDraftsForNote(noteId) {
  if (!noteId) return;
  const owner = await getLocalDataOwner();
  const contextKeys = [`current:${noteId}`, `other:${noteId}`, `recovery:${noteId}`];
  await AsyncStorage.updateItem(WORKOUT_NOTE_DRAFTS_KEY, (current) => {
    const drafts = parseDraftMap(current);
    let touched = false;
    for (const contextKey of contextKeys) {
      if (!(contextKey in drafts)) continue;
      const bucket = removeOwnerFromBucket(normalizeBucket(drafts[contextKey]), owner);
      if (bucketIsEmpty(bucket)) delete drafts[contextKey];
      else drafts[contextKey] = bucket;
      touched = true;
    }
    return touched ? JSON.stringify(drafts) : null;
  });
}

export async function clearAllWorkoutNoteDrafts() {
  await AsyncStorage.removeItem(WORKOUT_NOTE_DRAFTS_KEY);
}
