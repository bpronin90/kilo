import { secureStorage as AsyncStorage } from '../secureStorage';
import {
  WORKOUT_KEY,
  WORKOUT_NOTE_KEY,
  WORKOUT_NOTES_KEY,
  CURRENT_WORKOUT_ID_KEY,
  NORMALIZATION_APPLY_INTENT_KEY,
} from './keys';
import { readList, writeList } from './jsonStorage';
import { stripDerivedSectionsFromList } from './derivedCache';
import {
  loadTrackedLiftsStrict,
  loadTrackedLiftActivationsStrict,
  saveTrackedLifts,
  saveTrackedLiftActivations,
} from './settings';
import { withLocalWriteLock } from '../sync/localWriteLock';
import { planTrackedLiftRenameTransition, reconcileDivergedApplyTracking } from '../../lib/data/workoutAnalyticsActivations';

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
  const out = stripDerivedSectionsFromList(list);
  // Spent evidence is dropped by the next ordinary write once no apply record
  // is pending (the commit itself runs with the flag set, so it keeps it).
  await writeList(WORKOUT_NOTES_KEY, applyIntentMaybePending || !out.some(n => n?.[APPLY_STAMP_FIELD]) ? out : out.map(({ [APPLY_STAMP_FIELD]: _spent, ...n }) => n));
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

// #1172: `loadWorkoutNotesRaw` / `replaceWorkoutNotesRaw` are the UNLOCKED
// notebook primitives for code already inside this lock. Every public notebook
// read-modify-write (here, cloud domain methods, sync pass writes, backup
// restore, migration, derived-cache purge) takes the lock; the lock is not
// reentrant, so a locked function must never call another locked one.
// Serializes the notebook read-modify-write of the note writers (local
// and cloud save/delete, and the compare-and-set below) so a compare can never
// be split from its write by another writer. The chain survives a rejected
// step. Callers inside the lock must use the unlocked raw helpers.
let notebookLock = Promise.resolve();
//
// #1395: every holder first settles any unfinished rename (apply intent), so a
// notebook replace (backup restore, sync write-back, migration, purge) can never
// erase the landing evidence and strand Track on the old key. The settle runs on
// the unlocked internals under THIS lock (no re-entry) and takes no other lock,
// so a holder that already owns the local-write lock (sync write-back) cannot
// deadlock on it. Lock order stays notebook -> local-write everywhere. If the
// intent cannot reach a safe terminal state the settle throws and the caller's
// fn never runs: the write is refused rather than replacing the notebook.
export function withWorkoutNotebookLock(fn) {
  return runInNotebookLock(async () => {
    if (applyIntentMaybePending) await finishApplyIntentUnlocked(settleOps);
    return fn();
  });
}

// The raw chain, for the two entry points that settle (and report) the intent.
function runInNotebookLock(fn) {
  const run = notebookLock.then(fn);
  notebookLock = run.catch(() => {});
  return run;
}

export function saveWorkoutNoteItem(note) {
  return withWorkoutNotebookLock(async () => {
    const list = await readNotebook();
    const idx = list.findIndex(n => n.id === note.id);
    if (idx >= 0) {
      list[idx] = note;
    } else {
      list.push(note);
    }
    await writeNotebook(list);
  });
}

// Read-merge-write of one live note under the notebook lock (#1172), so an
// editor patch is merged into the note as it is at write time rather than a
// copy read earlier. Returns the updated note, or false when it is missing.
export function updateWorkoutNoteItem(id, patch) {
  return withWorkoutNotebookLock(async () => {
    const list = await readNotebook();
    const idx = list.findIndex(n => n.id === id && !n.deleted_at);
    if (idx < 0) return false;
    const updated = { ...list[idx], ...patch, updated_at: new Date().toISOString() };
    list[idx] = updated;
    await writeNotebook(list);
    return updated;
  });
}

// Batch compare-and-set for a normalization import (#1172). One lock covers
// the authority check and every target write, so no note writer can interleave.
// Pure planning helper shared by the local and cloud implementations: returns
// the per-item plan without touching storage.
export function planWorkoutNoteTextBatch(list, { authority, items }, isLive = n => !n.deleted_at) {
  const byId = new Map(list.filter(n => n && isLive(n)).map(n => [n.id, n]));
  const current = byId.get(authority?.id);
  if (!current) return { authority: 'missing' };
  const accepted = [authority.expected_raw_text, ...(authority.accepted_raw_texts || [])];
  if (!accepted.includes(current.raw_text)) return { authority: 'stale' };
  const writes = [];
  const skipped = [];
  for (const item of items || []) {
    const note = byId.get(item.id);
    if (!note) skipped.push({ id: item.id, status: 'missing' });
    else if (note.raw_text !== item.expected_raw_text && note.raw_text !== item.next_raw_text) skipped.push({ id: item.id, status: 'stale' });
    else writes.push({ id: item.id, next_raw_text: item.next_raw_text });
  }
  return { authority: 'unchanged', writes, skipped };
}

// ── the batch commit, with its Track transition (#1395) ──────────────────────
//
// A rename batch commits the note texts AND the Track flags/activations it moves
// as one recoverable operation. Separate setItem calls are not atomic, so the
// commit is journaled: a roll-forward intent (the note texts and both resulting
// Track maps) is written first and removed last. An interrupted commit is
// finished from that record — at the next apply, Track write, tracked-lift load
// or sync pass — before anything reads or pushes the mixed state. An in-process
// failure is rolled back instead, so a failed result means nothing changed; only
// when the rollback fails too is the record rolled forward, and only when that
// fails as well is the item reported `landed` (the record still finishes it).
//
// Runs under the notebook lock and then the shared local-write lock (#1393), so
// note writers, Track toggles and a sync write-back all land wholly before or
// after it. Neither lock is taken again inside, and no network call is made.
// `ops` is the adapter: liveness, row stamping and (cloud) the upload enqueue.
const LOCAL_TEXT_OPS = { isLive: n => !n.deleted_at, prepare: async () => row => row, enqueue: null };

// True until a read shows no unfinished record, and again whenever a failed
// commit may have left one; makes the common no-record check free.
let applyIntentMaybePending = true;
// The adapter (local or cloud) that last drove an apply or replay in this
// process; the lock-level settle reuses it so cloud rows are stamped/enqueued.
let settleOps = LOCAL_TEXT_OPS;
export function isNormalizationApplyIntentMaybePending() {
  return applyIntentMaybePending;
}

// Local-only landing evidence for a rename's notebook write (#1395): an apply id
// stamped onto the rows in that same setItem. Never uploaded: cloud upserts copy
// only the transport's per-table column whitelist (UPSERT_COLUMNS), so this field
// is dropped at the wire and needs no backend or schema change.
const APPLY_STAMP_FIELD = 'normalization_apply_id';

async function readApplyIntent() {
  const raw = await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY);
  if (raw == null) return null;
  const intent = JSON.parse(raw);
  if (intent?.version !== 1 || !Array.isArray(intent.notes) || !intent.tracking || typeof intent.tracking !== 'object') {
    throw new Error('An unfinished routine rename could not be read.');
  }
  return intent;
}

// Idempotent roll-forward. A note already holding its new text is left alone,
// and one changed since by anything else is never overwritten. Unreadable state
// throws and keeps the record: an unknown outcome is never treated as done.
async function finishApplyIntentUnlocked(ops) {
  if (!applyIntentMaybePending) return null;
  const tracking = await settleApplyIntentUnlocked(ops);
  await stripSpentApplyStamps();
  return tracking;
}

// The stamp is local-only evidence (exported by backup, ignored elsewhere), so it
// must not outlive its intent. Best effort: a failure leaves a spent stamp that
// nothing consults and the next ordinary notebook write drops.
async function stripSpentApplyStamps() {
  try {
    if (applyIntentMaybePending) return;
    const list = await readNotebook();
    if (list.some(n => n?.[APPLY_STAMP_FIELD])) await writeNotebook(list);
  } catch { /* spent evidence only */ }
}

async function settleApplyIntentUnlocked(ops) {
  const intent = await readApplyIntent();
  if (intent) {
    const stamp = await ops.prepare();
    const byId = new Map(intent.notes.map(n => [n.id, n]));
    const now = new Date().toISOString();
    const rows = [];
    const current = await readNotebook();
    // A target note that is neither pre-apply nor applied changed after the
    // interruption; it is never overwritten. Track may be half-moved (write
    // order notebook -> flags -> activations), so whether the notebook write
    // landed comes from evidence written in that same setItem: the rows carry
    // the intent's APPLY_STAMP_FIELD, which editors preserve by merging into the
    // stored row. Landed (stamp, applied text, or a moved Track key): roll the
    // affected Track keys forward. Not landed: retire untouched. Unknown (a key
    // matching neither before nor after, unreadable state, pre-journal intent):
    // keep the intent and throw, so nothing is pushed.
    const live = new Map(current.filter(n => n && ops.isLive(n)).map(n => [n.id, n]));
    const state = intent.notes.map((rec) => {
      const text = live.get(rec.id)?.raw_text;
      return text === rec.expected_raw_text ? 'pre' : text === rec.next_raw_text ? 'post' : 'diverged';
    });
    if (state.includes('diverged')) {
      if (!intent.before || !intent.id) throw new Error('An unfinished routine rename could not be reconciled.');
      const lifts = await loadTrackedLiftsStrict();
      const activations = await loadTrackedLiftActivationsStrict();
      const stamped = state.includes('post') || current.some(n => n?.[APPLY_STAMP_FIELD] === intent.id);
      const { landed, ...plans } = reconcileDivergedApplyTracking(intent, lifts, activations, stamped);
      if (landed) {
        await saveTrackedLifts(plans.lifts);
        await saveTrackedLiftActivations(plans.activations);
      }
      await AsyncStorage.removeItem(NORMALIZATION_APPLY_INTENT_KEY);
      applyIntentMaybePending = false;
      return landed ? plans : null;
    }
    const updated = current.map(n => {
      const rec = n && ops.isLive(n) ? byId.get(n.id) : null;
      if (!rec || n.raw_text !== rec.expected_raw_text) return n;
      const row = stamp({ ...n, raw_text: rec.next_raw_text, updated_at: now, [APPLY_STAMP_FIELD]: intent.id });
      rows.push(row);
      return row;
    });
    if (rows.length) await writeNotebook(updated);
    await saveTrackedLifts(intent.tracking.lifts);
    await saveTrackedLiftActivations(intent.tracking.activations);
    await AsyncStorage.removeItem(NORMALIZATION_APPLY_INTENT_KEY);
    // A missed enqueue is re-detected by the next pass's baseline reconciliation.
    if (ops.enqueue) for (const row of rows) await ops.enqueue(row).catch(() => {});
  }
  applyIntentMaybePending = false;
  return intent ? intent.tracking : null;
}

// Finish any unfinished record; resolves to the Track maps it committed, or null.
export function finishNormalizationApplyIntent(ops = LOCAL_TEXT_OPS) {
  settleOps = ops;
  if (!applyIntentMaybePending) return Promise.resolve(null);
  return runInNotebookLock(() => withLocalWriteLock(() => finishApplyIntentUnlocked(ops)));
}

async function commitTextBatch(updated, intent) {
  if (intent) {
    applyIntentMaybePending = true;
    await AsyncStorage.setItem(NORMALIZATION_APPLY_INTENT_KEY, JSON.stringify(intent));
  }
  await writeNotebook(updated);
  if (!intent) return;
  await saveTrackedLifts(intent.tracking.lifts);
  await saveTrackedLiftActivations(intent.tracking.activations);
  await AsyncStorage.removeItem(NORMALIZATION_APPLY_INTENT_KEY);
  applyIntentMaybePending = false;
  await stripSpentApplyStamps();
}

async function rollBackTextBatch(list, lifts, activations) {
  try {
    await writeNotebook(list);
    await saveTrackedLifts(lifts);
    await saveTrackedLiftActivations(activations);
    await AsyncStorage.removeItem(NORMALIZATION_APPLY_INTENT_KEY);
    applyIntentMaybePending = false;
    return true;
  } catch {
    return false;
  }
}

async function applyTextBatchUnlocked(request, ops) {
  await finishApplyIntentUnlocked(ops);
  const list = await readNotebook();
  const plan = planWorkoutNoteTextBatch(list, request, ops.isLive);
  if (plan.authority !== 'unchanged') return { authority: plan.authority, saved: [], skipped: [], failed: [] };
  const skipped = plan.skipped.map(s => ({ ...s, pending_sync: false }));
  const fail = (message, landed = false) => ({
    authority: 'unchanged', saved: [], skipped,
    failed: plan.writes.map(w => ({ id: w.id, message, pending_sync: false, ...(landed ? { landed: true } : {}) })),
  });
  if (!plan.writes.length) return { authority: 'unchanged', saved: [], skipped, failed: [] };

  // The Track transition is planned over the whole live notebook, unfiltered.
  // Unreadable Track state is unknown, never "untracked": nothing is written.
  const nextById = new Map(plan.writes.map(w => [w.id, w.next_raw_text]));
  let lifts;
  let activations;
  let transition;
  try {
    lifts = await loadTrackedLiftsStrict();
    activations = await loadTrackedLiftActivationsStrict();
    transition = planTrackedLiftRenameTransition(list.filter(n => n && ops.isLive(n)), nextById, lifts, activations);
  } catch {
    return fail('Couldn’t read Track settings, so nothing was written.');
  }
  if (!transition.ok) return fail(transition.reason);
  let tracking = transition.changed ? { lifts: transition.lifts, activations: transition.activations } : null;
  const intent = tracking && {
    version: 1,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    notes: plan.writes.map(w => ({ id: w.id, expected_raw_text: list.find(n => n?.id === w.id).raw_text, next_raw_text: w.next_raw_text })),
    tracking,
    before: { lifts, activations },
  };

  const stamp = await ops.prepare();
  const now = new Date().toISOString();
  const rowById = new Map();
  const updated = list.map((n) => {
    if (!nextById.has(n?.id) || !ops.isLive(n)) return n;
    const row = stamp({ ...n, raw_text: nextById.get(n.id), updated_at: now, ...(intent ? { [APPLY_STAMP_FIELD]: intent.id } : {}) });
    rowById.set(row.id, row);
    return row;
  });
  try {
    await commitTextBatch(updated, intent);
  } catch (error) {
    const message = error?.message || 'Write failed';
    if (!intent || await rollBackTextBatch(list, lifts, activations)) return fail(message);
    try {
      tracking = await finishApplyIntentUnlocked(ops);
    } catch {
      return fail(message, true);
    }
    // No record: the intent write itself failed, so nothing else was written.
    if (!tracking) return fail(message);
    for (const n of await readNotebook()) if (rowById.has(n?.id) && n.raw_text === nextById.get(n.id)) rowById.set(n.id, n);
  }

  const saved = [];
  const failed = [];
  for (const { id } of plan.writes) {
    if (!ops.enqueue) { saved.push({ id, pending_sync: false }); continue; }
    try {
      await ops.enqueue(rowById.get(id));
      saved.push({ id, pending_sync: true });
    } catch (error) {
      failed.push({ id, message: error?.message || 'Enqueue failed', landed: true, pending_sync: false });
    }
  }
  return { authority: 'unchanged', saved, skipped, failed, ...(tracking ? { tracking } : {}) };
}

export function applyNoteTextBatchWithTracking(request, ops) {
  settleOps = ops;
  return runInNotebookLock(() => withLocalWriteLock(() => applyTextBatchUnlocked(request, ops)));
}

export function applyWorkoutNoteTextBatchIfUnchanged(request) {
  return applyNoteTextBatchWithTracking(request, LOCAL_TEXT_OPS);
}

// Atomic compare-and-set of one note's text (#1172). Writes only while the note
// still holds `expectedRawText`, or already holds `nextRawText` (a retry).
// Returns 'saved' | 'stale' | 'missing'.
export function compareAndSetWorkoutNoteText(id, expectedRawText, nextRawText) {
  return withWorkoutNotebookLock(async () => {
    const list = await readNotebook();
    const idx = list.findIndex(n => n.id === id && !n.deleted_at);
    if (idx < 0) return 'missing';
    const note = list[idx];
    if (note.raw_text !== expectedRawText && note.raw_text !== nextRawText) return 'stale';
    list[idx] = { ...note, raw_text: nextRawText, updated_at: new Date().toISOString() };
    await writeNotebook(list);
    return 'saved';
  });
}

function defaultImportId() {
  return `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

// Writes an already parsed/validated import as brand-new notebook notes. This
// deliberately never reads the notebook for merge/deduplication and never
// changes current-routine selection. `writeNote` is injectable for cloud mode
// and for precise partial-failure reporting in callers/tests.
export async function saveFreshImportedWorkoutNotes(noteDrafts, {
  writeNote = saveWorkoutNoteItem,
  idFactory = defaultImportId,
  now = () => new Date().toISOString(),
} = {}) {
  if (!Array.isArray(noteDrafts) || noteDrafts.length === 0) throw new Error('Import requires at least one workout note.');
  // Validate the complete batch before the first durable write.
  noteDrafts.forEach((draft, index) => {
    if (!draft || typeof draft.raw_text !== 'string' || !draft.raw_text) throw new Error(`Imported note ${index + 1} is invalid.`);
  });
  const confirmed = [];
  for (let index = 0; index < noteDrafts.length; index++) {
    const draft = noteDrafts[index];
    const timestamp = now();
    const note = {
      id: idFactory(),
      title: draft.title || 'Imported workout',
      raw_text: draft.raw_text,
      saved_at: timestamp,
      updated_at: timestamp,
      tracked_exercises: [],
      isCurrent: false,
    };
    try {
      await writeNote(note);
      confirmed.push({ index, id: note.id, status: 'confirmed' });
    } catch (error) {
      return {
        ok: false,
        confirmed,
        unconfirmed: { index, id: note.id, status: 'unconfirmed', message: error?.message || String(error) },
        remaining: noteDrafts.length - index - 1,
        warning: 'The failing note may have been created. Inspect routines before retrying; repeat imports create another complete set.',
      };
    }
  }
  return {
    ok: true,
    confirmed,
    unconfirmed: null,
    remaining: 0,
    warning: 'Repeat imports create another complete set.',
  };
}

export async function deleteWorkoutNoteItem(id) {
  await withWorkoutNotebookLock(async () => {
    const list = await readNotebook();
    await writeNotebook(list.filter(n => n.id !== id));
  });
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
export function setCurrentWorkoutNote(id) {
  return withWorkoutNotebookLock(async () => {
    const list = await readNotebook();
    const updated = list.map(n => {
      if (n.id === id) {
        return { ...n, isCurrent: true };
      }
      return { ...n, isCurrent: false };
    });
    await writeNotebook(updated);
    await AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(id));
  });
}
