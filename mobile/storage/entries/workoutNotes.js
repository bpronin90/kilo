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
import { quarantineApplyIntent, setUnfinishedRenameBlock } from '../syncRecovery';
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
  try { const raw = await AsyncStorage.getItem(WORKOUT_NOTE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

async function patchWorkoutNote(patch) {
  const note = { ...(await loadWorkoutNote()), ...patch, updated_at: new Date().toISOString() };
  await AsyncStorage.setItem(WORKOUT_NOTE_KEY, JSON.stringify(note));
  return note;
}

export async function saveWorkoutNote(raw_text) {
  const existing = await loadWorkoutNote();
  return patchWorkoutNote({
    raw_text,
    saved_at: existing ? existing.saved_at : new Date().toISOString(),
    tracked_exercises: existing?.tracked_exercises || [],
  });
}

export const saveTrackedExercises = tracked_exercises => patchWorkoutNote({ tracked_exercises });

export const saveOneKExercises = one_k_exercises => patchWorkoutNote({ one_k_exercises });

export async function clearWorkoutNote() {
  await AsyncStorage.removeItem(WORKOUT_NOTE_KEY);
}

// ── multi-note notebook ────────────────────────────────────────────────────────

// Every notebook read and write goes through these two so the persisted notebook
// never carries the parser-output cache (#813; derivedCache.js). Both return the
// list by identity when there is nothing to strip.
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
  // Tombstones are sync metadata, never user-visible notes: local mode applies the
  // same visibility as cloud mode (consent withdrawal falls back to local reads).
  return (await readNotebook()).filter((note) => !note?.deleted_at);
}

// Raw cache accessors for the cloud sync engine (Phase 4 / Task 11): the
// unfiltered list (tombstones, sync metadata included). Local mode never uses them.
export async function loadWorkoutNotesRaw() {
  return readNotebook();
}

export async function replaceWorkoutNotesRaw(list) {
  await writeNotebook(Array.isArray(list) ? list : []);
}

// #1172: `loadWorkoutNotesRaw` / `replaceWorkoutNotesRaw` are the UNLOCKED
// primitives for code already inside this lock. Every public notebook
// read-modify-write takes it, so a compare is never split from its write. Not
// reentrant; the chain survives a rejected step.
let notebookLock = Promise.resolve();
//
// #1395: every holder first settles any unfinished rename (apply intent), so a
// notebook replace can never erase the landing evidence and strand Track on the
// old key. The settle takes the local-write lock for its Track reads and writes
// (#1411); notebook -> local-write is total. An intent that cannot reach a safe
// terminal state throws and the caller's fn never runs (#1402 can discard it).
// Skipped while the device key is latched (#1186): the shared store refuses every
// encrypting write, and a recovery restore into its private overlay replaces the
// orphaned intent; settling would only block that recovery.
export function withWorkoutNotebookLock(fn) {
  return runInNotebookLock(async () => {
    if (applyIntentMaybePending && !AsyncStorage.isKeyUnavailable?.()) {
      await withLocalWriteLock(() => finishApplyIntentUnlocked(resolveSettleOps()));
    }
    return fn();
  });
}

// The raw chain, for the entry points that settle or recover the intent.
function runInNotebookLock(fn) {
  const run = notebookLock.then(fn);
  notebookLock = run.catch(() => {});
  return run;
}

export function saveWorkoutNoteItem(note) {
  return withWorkoutNotebookLock(async () => {
    const list = await readNotebook();
    const idx = list.findIndex(n => n.id === note.id);
    if (idx >= 0) list[idx] = note; else list.push(note);
    await writeNotebook(list);
  });
}

// Read-merge-write of one live note under the notebook lock (#1172). Returns the
// updated note, or false when it is missing.
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

// Batch compare-and-set for a normalization import (#1172): one lock covers the
// authority check and every write. Pure planner shared by local and cloud.
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
// A rename batch commits the note texts AND the Track maps it moves as one
// recoverable operation: a roll-forward intent (note texts and both resulting
// Track maps) is written first and removed last. An interrupted commit is
// finished from it before anything reads or pushes the mixed state. An in-process
// failure is rolled back; only when that fails too is the record rolled forward,
// and only when that fails as well is the item reported `landed`.
//
// Runs under the notebook lock then the local-write lock (#1393); neither is
// retaken inside and no network call is made. `ops` is the adapter: liveness,
// row stamping and (cloud) the upload enqueue.
const LOCAL_TEXT_OPS = { isLive: n => !n.deleted_at, prepare: async () => row => row, enqueue: null };

// True until a read shows no unfinished record, and again whenever a failed commit
// may have left one.
let applyIntentMaybePending = true;
// The adapter for a settle no caller chose, resolved when it runs (never stale);
// storageMode.js registers the mode-aware resolver, local is the default.
let resolveSettleOps = () => LOCAL_TEXT_OPS;
export function setNormalizationApplySettleOps(resolve) {
  resolveSettleOps = () => resolve?.() || LOCAL_TEXT_OPS;
}
export function isNormalizationApplyIntentMaybePending() {
  return applyIntentMaybePending;
}

// Local-only landing evidence (#1395): an apply id stamped onto the rows in the
// same setItem. Never uploaded: the transport's column whitelist drops it.
const APPLY_STAMP_FIELD = 'normalization_apply_id';

// An intent no replay can finish (#1402); a failed read stays a plain, retryable
// error. `reason`: 'unreadable' | 'invalid' | 'diverged'.
export class UnfinishedRenameError extends Error {
  constructor(reason) {
    super(reason === 'diverged' ? 'An unfinished routine rename could not be reconciled.' : 'An unfinished routine rename could not be read.');
    this.name = 'UnfinishedRenameError';
    this.reason = reason;
  }
}

function parseApplyIntent(raw) {
  let intent;
  try { intent = JSON.parse(raw); } catch { throw new UnfinishedRenameError('unreadable'); }
  const map = m => !!m && typeof m === 'object' && !Array.isArray(m);
  const maps = t => map(t) && map(t.lifts) && map(t.activations);
  const note = n => map(n) && typeof n.id === 'string' && typeof n.expected_raw_text === 'string' && typeof n.next_raw_text === 'string';
  // `before` is absent only on a pre-journal intent (still reconciled or blocked below).
  if (intent?.version !== 1 || !Array.isArray(intent.notes) || !intent.notes.every(note) || !maps(intent.tracking)
    || (intent.before != null && !maps(intent.before))) {
    throw new UnfinishedRenameError('invalid');
  }
  return intent;
}

async function readApplyIntent() {
  const raw = await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY);
  return raw == null ? null : parseApplyIntent(raw);
}

// Each note against the intent, plus (when one diverged) the Track plan; throws
// UnfinishedRenameError when the recorded Track state matches neither side.
async function planApplyIntent(intent, current, isLive) {
  const live = new Map(current.filter(n => n && isLive(n)).map(n => [n.id, n]));
  const state = intent.notes.map((rec) => {
    const text = live.get(rec.id)?.raw_text;
    return text === rec.expected_raw_text ? 'pre' : text === rec.next_raw_text ? 'post' : 'diverged';
  });
  if (!state.includes('diverged')) return { state };
  if (!intent.before || !intent.id) throw new UnfinishedRenameError('diverged');
  const lifts = await loadTrackedLiftsStrict();
  const activations = await loadTrackedLiftActivationsStrict();
  const stamped = state.includes('post') || current.some(n => n?.[APPLY_STAMP_FIELD] === intent.id);
  try { return { state, ...reconcileDivergedApplyTracking(intent, lifts, activations, stamped) }; } catch { throw new UnfinishedRenameError('diverged'); }
}

// Idempotent roll-forward. A note already holding its new text is left alone,
// and one changed since by anything else is never overwritten. Unreadable state
// throws and keeps the record: an unknown outcome is never treated as done.
async function finishApplyIntentUnlocked(ops) {
  if (!applyIntentMaybePending) return null;
  let tracking;
  try {
    tracking = await settleApplyIntentUnlocked(ops);
  } catch (error) {
    if (error instanceof UnfinishedRenameError) setUnfinishedRenameBlock({ reason: error.reason });
    throw error;
  }
  setUnfinishedRenameBlock(null);
  await stripSpentApplyStamps();
  return tracking;
}

// The stamp is local-only evidence, so it must not outlive its intent. Best effort:
// a spent stamp nothing consults is dropped by the next ordinary notebook write.
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
    // A note that is neither pre-apply nor applied changed since; it is never
    // overwritten. Whether the notebook write landed comes from the stamp written
    // in that same setItem (or applied text, or a moved Track key): landed rolls
    // the affected Track keys forward, not landed retires untouched. Unknown (a
    // key matching neither side, pre-journal intent) keeps the intent and throws.
    const { state, landed, ...plans } = await planApplyIntent(intent, current, ops.isLive);
    if (state.includes('diverged')) {
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
export function finishNormalizationApplyIntent(ops = resolveSettleOps()) {
  if (!applyIntentMaybePending) return Promise.resolve(null);
  return runInNotebookLock(() => withLocalWriteLock(() => finishApplyIntentUnlocked(ops)));
}

// Unfinished-rename recovery (#1402): runs under notebook -> local-write but never
// settles first (the settle is what throws). `blocked` is only a PROVEN
// unreconcilable record; a failed read throws (transient). `raw` is the identity
// a confirmation must still match.
async function classifyApplyIntentUnlocked() {
  const raw = await AsyncStorage.getItem(NORMALIZATION_APPLY_INTENT_KEY);
  if (raw == null) return { status: 'none' };
  try {
    await planApplyIntent(parseApplyIntent(raw), await readNotebook(), resolveSettleOps().isLive);
    return { status: 'pending' };
  } catch (error) {
    if (error instanceof UnfinishedRenameError) return { status: 'blocked', reason: error.reason, raw };
    throw error;
  }
}

const recoveryLocks = fn => runInNotebookLock(() => withLocalWriteLock(fn));

// Resolves { status: 'none' | 'pending' | 'blocked' | 'unknown' | 'key-unavailable' }.
export function inspectUnfinishedRename() {
  if (AsyncStorage.isKeyUnavailable?.()) return Promise.resolve({ status: 'key-unavailable' });
  return recoveryLocks(async () => {
    try {
      const found = await classifyApplyIntentUnlocked();
      setUnfinishedRenameBlock(found.status === 'blocked' ? found : null);
      return found;
    } catch (error) {
      return { status: 'unknown', message: error?.message };
    }
  });
}

// Retire a PROVEN unreconcilable intent after preserving its exact raw record,
// revalidated against `expectedRaw` so a stale confirmation discards nothing.
// Note text and both Track maps are never written. A failure keeps the active
// intent for retry/restart. Outcome: 'discarded' | 'gone' | 'stale' |
// 'not-blocked' | 'key-unavailable' | 'failed' (+ `quarantined` / `unverified`).
export function discardUnfinishedRename(expectedRaw) {
  if (AsyncStorage.isKeyUnavailable?.()) return Promise.resolve({ outcome: 'key-unavailable' });
  return recoveryLocks(async () => {
    let quarantined = false;
    try {
      const found = await classifyApplyIntentUnlocked();
      if (found.status === 'none') {
        applyIntentMaybePending = false;
        setUnfinishedRenameBlock(null);
        return { outcome: 'gone' };
      }
      if (found.status !== 'blocked') return { outcome: 'not-blocked' };
      if (found.raw !== expectedRaw) return { outcome: 'stale' };
      await quarantineApplyIntent(found.raw, found.reason);
      quarantined = true;
      await AsyncStorage.removeItem(NORMALIZATION_APPLY_INTENT_KEY);
    } catch (error) {
      return { outcome: 'failed', quarantined, ...(error?.unverified ? { unverified: true } : {}), message: error?.message };
    }
    applyIntentMaybePending = false;
    setUnfinishedRenameBlock(null);
    await stripSpentApplyStamps();
    return { outcome: 'discarded' };
  });
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
  } catch { return false; }
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

// Writes a validated import as brand-new notes: no merge/dedup read, no change to
// the current routine. `writeNote` is injectable for cloud mode and tests.
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
  return { ok: true, confirmed, unconfirmed: null, remaining: 0, warning: 'Repeat imports create another complete set.' };
}

export async function deleteWorkoutNoteItem(id) {
  await withWorkoutNotebookLock(async () => {
    const list = await readNotebook();
    await writeNotebook(list.filter(n => n.id !== id));
  });
  if ((await loadCurrentWorkoutId()) === id) await clearCurrentWorkoutId();
}

// Deletion-outcome probe for the recovery operation journal (#696): is this note
// gone? Local mode hard-removes and has no sync queue (`requiresQueue: false`).
// Reads the RAW list: a tombstone from a past cloud session still counts as gone.
export async function loadWorkoutNoteDeletionState(id) {
  const list = await readNotebook();
  const note = list.find(n => n?.id === id);
  return { exists: !!note, deleted: !note || !!note.deleted_at, requiresQueue: false, queued: false };
}

// Presence probe for the recovery journal's new-note operation (#696): is the note
// LIVE (a tombstone exists but is not live)? No upload queue locally.
export async function loadWorkoutNotePresenceState(id) {
  const list = await readNotebook();
  const note = list.find(n => n?.id === id);
  return { exists: !!note, deleted: !!note?.deleted_at, requiresQueue: false, queued: false };
}

// ── current workout selection ──────────────────────────────────────────────────

export async function loadCurrentWorkoutId() {
  try { const raw = await AsyncStorage.getItem(CURRENT_WORKOUT_ID_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// Current-id writers hold the local-write lock (#1399); Unlocked twins are for a holder.
export const saveCurrentWorkoutIdUnlocked = id => AsyncStorage.setItem(CURRENT_WORKOUT_ID_KEY, JSON.stringify(id));
export const clearCurrentWorkoutIdUnlocked = () => AsyncStorage.removeItem(CURRENT_WORKOUT_ID_KEY);
export const saveCurrentWorkoutId = id => withLocalWriteLock(() => saveCurrentWorkoutIdUnlocked(id));
export const clearCurrentWorkoutId = () => withLocalWriteLock(clearCurrentWorkoutIdUnlocked);

// Mark a note as the current routine.
// All other notes in the list are marked isCurrent: false.
// Also updates CURRENT_WORKOUT_ID_KEY for backward compatibility.
export function setCurrentWorkoutNote(id) {
  return withWorkoutNotebookLock(async () => {
    const list = await readNotebook();
    const updated = list.map(n => ({ ...n, isCurrent: n.id === id }));
    await writeNotebook(updated);
    await saveCurrentWorkoutId(id);
  });
}
