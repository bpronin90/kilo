// Durable write-ahead journal for multi-record recovery lifecycle operations
// (#696).
//
// AsyncStorage, the workout-note cloud queue, recovery-block storage, and
// recovery-week storage share no native transaction, so two of the Log tab's
// recovery actions cannot be made "both-or-neither" by any amount of
// snapshot-and-revert: the revert write can itself fail, and a note-delete that
// commits and then throws is indistinguishable from one that never committed if
// the only evidence is the thrown error.
//
// What IS achievable, and what this module implements, is a single deterministic
// roll-forward outcome per operation:
//
//   1. validate eligibility against persisted state;
//   2. persist the operation intent BEFORE the first domain write;
//   3. apply idempotent domain writes toward the recorded outcome;
//   4. re-read every affected collection from persisted storage;
//   5. verify all postconditions;
//   6. clear the journal record only after verification succeeds;
//   7. let the caller notify/refresh only after a verified result or a durable
//      pending state exists.
//
// An interrupted operation may therefore sit in a journaled `pending` state. It
// may never become an untracked partial transition, a live dangling membership,
// an outcome chosen by default after a failed verification read, or a success
// reported to the user before the persisted postconditions were read back.
//
// Replay is idempotent and timestamp-stable: every write reuses the immutable
// requested timestamp captured when the intent was created, and every write is
// skipped when its postcondition already holds. Replaying a fully satisfied
// operation is a no-op except for journal cleanup.
//
// The journal is device-local protocol metadata. It is not a sync table, is not
// part of the backup/export payload, and never stores workout-note text.

import { RECOVERY_OPERATION_JOURNAL_KEY, RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } from './keys';
import { readList, writeList } from './jsonStorage';
import {
  loadWorkoutNoteDeletionState as localLoadWorkoutNoteDeletionState,
  deleteWorkoutNoteItem as localDeleteWorkoutNoteItem,
} from './workoutNotes';

export const RECOVERY_JOURNAL_VERSION = 1;

export const RECOVERY_OPERATION_TYPES = Object.freeze({
  COMPLETE_BLOCK_WITH_WEEK: 'complete_block_with_week',
  DELETE_LINKED_NOTE: 'delete_linked_note',
});

// Machine-readable outcomes. Every public entry point in this module returns one
// of these in `code`, and nothing else.
export const RECOVERY_OPERATION_CODES = Object.freeze({
  // Eligibility/validation refused the request. No journal record, no domain
  // write — provably zero writes.
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  // A domain write failed. The durable intent is retained and will be replayed.
  OPERATION_FAILED: 'OPERATION_FAILED',
  // A read (or a verification read) is unavailable, so the outcome cannot be
  // determined. The durable intent is retained; no outcome is chosen.
  RECONCILIATION_PENDING: 'RECONCILIATION_PENDING',
  // The journal itself is unreadable, malformed, or written by an unsupported
  // schema version. Fails closed; never treated as "no pending work".
  JOURNAL_CORRUPT: 'JOURNAL_CORRUPT',
  // All postconditions were read back from persisted storage and hold.
  VERIFIED: 'VERIFIED',
  // Postconditions hold, but removing the (now redundant) journal record
  // failed. The user-visible operation succeeded; cleanup is retried on the
  // next reconciliation.
  VERIFIED_CLEANUP_PENDING: 'VERIFIED_CLEANUP_PENDING',
});

// Protocol stages recorded on the journal record for diagnostics and for the
// failure-injection matrix in tests. They are advisory: replay always decides
// what to do from persisted state, never from the recorded stage.
export const RECOVERY_OPERATION_STAGES = Object.freeze({
  INTENT: 'intent',
  DOMAIN_READ: 'domain_read',
  FIRST_WRITE: 'first_write',
  SECOND_WRITE: 'second_write',
  VERIFY_READ: 'verify_read',
  VERIFIED: 'verified',
  CLEANUP: 'cleanup',
});

export class RecoveryJournalCorruptError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'RecoveryJournalCorruptError';
    this.code = RECOVERY_OPERATION_CODES.JOURNAL_CORRUPT;
    if (cause !== undefined) this.cause = cause;
  }
}

export function isRecoveryJournalCorruptError(err) {
  return err instanceof RecoveryJournalCorruptError;
}

// ── note-deletion operations registry ────────────────────────────────────────
//
// The "delete a linked workout note" outcome must go through the SAME
// local/cloud-aware note-removal path the rest of the app uses, including cloud
// tombstone + sync-queue bookkeeping. The journal cannot import the hook layer
// (that would invert the storage/hook dependency and create a cycle), and it
// must not reimplement the cloud path, so the mode-aware implementation is
// registered into this module at load time by hooks/entries/storageMode.js.
//
// The default is the local implementation, which is also the correct behaviour
// for a signed-out/local-only device: repair never requires network access.
const DEFAULT_NOTE_OPERATIONS = Object.freeze({
  loadNoteState: (noteId) => localLoadWorkoutNoteDeletionState(noteId),
  deleteNote: (noteId) => localDeleteWorkoutNoteItem(noteId),
});

let noteOperations = DEFAULT_NOTE_OPERATIONS;

export function setRecoveryNoteOperations(ops) {
  noteOperations = { ...DEFAULT_NOTE_OPERATIONS, ...(ops || {}) };
}

// Run the registered (mode-aware) note deletion directly. Used only for the
// single-domain case — deleting a note that has no live recovery membership —
// so that path stays on the exact same adapter-aware call the journal replays.
export function deleteWorkoutNoteViaRecoveryOperations(noteId) {
  return noteOperations.deleteNote(noteId);
}

export function resetRecoveryNoteOperations() {
  noteOperations = DEFAULT_NOTE_OPERATIONS;
}

// ── single-flight serialization ──────────────────────────────────────────────
//
// UI actions, the retry affordance, mount/remount reconciliation, and the cloud
// sync boundary all funnel through this one queue. Re-entry awaits the in-flight
// work rather than starting a competing replay, so a double tap cannot allocate
// two ordinals and a sync pass cannot race a lifecycle write.

let operationTail = Promise.resolve();
let inFlightReconcile = null;

function withRecoveryOperationLock(fn) {
  const scheduled = operationTail.then(fn, fn);
  operationTail = scheduled.then(() => {}, () => {});
  return scheduled;
}

// ── journal persistence ──────────────────────────────────────────────────────

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isValidRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (record.version !== RECOVERY_JOURNAL_VERSION) return false;
  if (!isNonEmptyString(record.operation_id)) return false;
  if (!isNonEmptyString(record.created_at)) return false;
  if (record.type === RECOVERY_OPERATION_TYPES.COMPLETE_BLOCK_WITH_WEEK) {
    return isNonEmptyString(record.block_id) && isNonEmptyString(record.requested_completed_at);
  }
  if (record.type === RECOVERY_OPERATION_TYPES.DELETE_LINKED_NOTE) {
    return (
      isNonEmptyString(record.week_id) &&
      isNonEmptyString(record.note_id) &&
      isNonEmptyString(record.requested_deleted_at)
    );
  }
  return false;
}

// Fails closed on every ambiguous input: an unreadable key, malformed JSON, a
// non-list payload, an unknown schema version, or a record missing the fields
// replay needs. None of those may be silently discarded — discarding them is
// exactly how an interrupted operation becomes an untracked partial transition.
export async function readRecoveryJournal() {
  let list;
  try {
    list = await readList(RECOVERY_OPERATION_JOURNAL_KEY);
  } catch (e) {
    throw new RecoveryJournalCorruptError('The recovery operation journal could not be read.', e);
  }
  for (const record of list) {
    if (!isValidRecord(record)) {
      throw new RecoveryJournalCorruptError(
        'The recovery operation journal contains a record this version cannot interpret.'
      );
    }
  }
  return list;
}

async function writeRecoveryJournal(records) {
  await writeList(RECOVERY_OPERATION_JOURNAL_KEY, records);
}

let operationCounter = 0;
function nextOperationId() {
  operationCounter += 1;
  return `recop_${Date.now()}_${operationCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

// Public read used by the UI to decide whether a pending operation blocks an
// action. Throws RecoveryJournalCorruptError, deliberately: the caller must
// surface it, not treat it as an empty journal.
export function loadPendingRecoveryOperations() {
  return withRecoveryOperationLock(() => readRecoveryJournal());
}

// Test/teardown helper. Never called by production code.
export function __resetRecoveryOperationJournal() {
  operationTail = Promise.resolve();
  inFlightReconcile = null;
  noteOperations = DEFAULT_NOTE_OPERATIONS;
}

// ── record helpers ───────────────────────────────────────────────────────────

function describeError(error) {
  if (error == null) return null;
  if (typeof error === 'string') return { message: error, name: 'Error' };
  return {
    // Diagnostics only. Recovery-domain ids are already on the record; workout
    // -note TEXT is never read here and therefore never stored.
    name: error.name || 'Error',
    message: error.message || String(error),
    code: error.code || null,
  };
}

async function updateRecordStage(record, { stage, error }) {
  // Best effort by design: the durable evidence that matters (the intent) is
  // already persisted. Failing to annotate it changes nothing about what replay
  // will do, because replay reads persisted domain state rather than the stage.
  try {
    const journal = await readRecoveryJournal();
    const idx = journal.findIndex((r) => r.operation_id === record.operation_id);
    if (idx < 0) return;
    journal[idx] = {
      ...journal[idx],
      stage,
      attempts: (journal[idx].attempts || 0) + 1,
      updated_at: new Date().toISOString(),
      last_error: describeError(error),
    };
    await writeRecoveryJournal(journal);
  } catch {
    // Intentionally swallowed; see above.
  }
}

async function clearRecord(record) {
  const journal = await readRecoveryJournal();
  const remaining = journal.filter((r) => r.operation_id !== record.operation_id);
  if (remaining.length === journal.length) return;
  await writeRecoveryJournal(remaining);
}

function pendingResult(record, { code, stage, error, message }) {
  return {
    ok: false,
    code,
    stage,
    operationId: record.operation_id,
    type: record.type,
    block_id: record.block_id || null,
    week_id: record.week_id || null,
    note_id: record.note_id || null,
    error: message,
    cause: error || null,
  };
}

function verifiedResult(record, code) {
  return {
    ok: true,
    code,
    stage: code === RECOVERY_OPERATION_CODES.VERIFIED
      ? RECOVERY_OPERATION_STAGES.VERIFIED
      : RECOVERY_OPERATION_STAGES.CLEANUP,
    operationId: record.operation_id,
    type: record.type,
    block_id: record.block_id || null,
    week_id: record.week_id || null,
    note_id: record.note_id || null,
    error: null,
    cause: null,
  };
}

// Shared tail for both operations: postconditions have been read back and hold,
// so the record is redundant. A failed cleanup is reported as a SUCCESS whose
// journal cleanup still needs retry — never as a failure of the operation, and
// never as a silently dropped record.
async function finishVerified(record) {
  try {
    await clearRecord(record);
  } catch (e) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.CLEANUP, error: e });
    return verifiedResult(record, RECOVERY_OPERATION_CODES.VERIFIED_CLEANUP_PENDING);
  }
  return verifiedResult(record, RECOVERY_OPERATION_CODES.VERIFIED);
}

// ── operation: complete a block together with its current week ───────────────
//
// Single roll-forward outcome:
//   * the target live block carries one stable completed_at (the immutable
//     requested timestamp on the record);
//   * the week that was open when the intent was created carries that same
//     timestamp;
//   * nothing else is rewritten.
//
// Every write is conditional on its own postcondition being unmet, so a replay
// after either write already landed writes nothing, never slides a timestamp
// forward, and never reopens a record. "Week completed but block active" is not
// a terminal state: it is exactly the state replay converges out of.
async function replayCompleteBlockWithWeek(record) {
  let blocks;
  let weeks;
  try {
    blocks = await readList(RECOVERY_BLOCKS_KEY);
    weeks = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  } catch (e) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.DOMAIN_READ, error: e });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.DOMAIN_READ,
      error: e,
      message: 'Recovery data could not be read, so completing this block is still pending.',
    });
  }

  const block = blocks.find((b) => b.id === record.block_id);
  // The block is gone (never existed on this device, or was deleted — including
  // by a sync pull while the operation was pending). The recorded outcome has
  // nothing left to apply and cannot be applied later, so the record is
  // redundant rather than pending. Deleting a block already cascades tombstones
  // to its weeks, so no dangling membership can remain.
  if (!block || block.deleted_at) return finishVerified(record);

  const at = record.requested_completed_at;

  if (record.week_id) {
    const week = weeks.find((w) => w.id === record.week_id);
    if (week && !week.deleted_at && !week.completed_at) {
      try {
        await writeList(
          RECOVERY_BLOCK_WEEKS_KEY,
          weeks.map((w) => (w.id === record.week_id ? { ...w, completed_at: at, updated_at: at } : w))
        );
      } catch (e) {
        await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.FIRST_WRITE, error: e });
        return pendingResult(record, {
          code: RECOVERY_OPERATION_CODES.OPERATION_FAILED,
          stage: RECOVERY_OPERATION_STAGES.FIRST_WRITE,
          error: e,
          message: 'The current recovery week could not be completed; the operation is retained and will be retried.',
        });
      }
    }
  }

  if (!block.completed_at) {
    try {
      await writeList(
        RECOVERY_BLOCKS_KEY,
        blocks.map((b) => (b.id === record.block_id ? { ...b, completed_at: at, updated_at: at } : b))
      );
    } catch (e) {
      await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.SECOND_WRITE, error: e });
      return pendingResult(record, {
        code: RECOVERY_OPERATION_CODES.OPERATION_FAILED,
        stage: RECOVERY_OPERATION_STAGES.SECOND_WRITE,
        error: e,
        message: 'The recovery block could not be completed; the operation is retained and will be retried.',
      });
    }
  }

  let blocksAfter;
  let weeksAfter;
  try {
    blocksAfter = await readList(RECOVERY_BLOCKS_KEY);
    weeksAfter = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  } catch (e) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.VERIFY_READ, error: e });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.VERIFY_READ,
      error: e,
      message: 'Recovery completion could not be verified yet; the operation is still pending.',
    });
  }

  const verifiedBlock = blocksAfter.find((b) => b.id === record.block_id);
  const verifiedWeek = record.week_id ? weeksAfter.find((w) => w.id === record.week_id) : null;
  const blockOk = !verifiedBlock || !!verifiedBlock.deleted_at || !!verifiedBlock.completed_at;
  const weekOk = !record.week_id || !verifiedWeek || !!verifiedWeek.deleted_at || !!verifiedWeek.completed_at;

  if (!blockOk || !weekOk) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.VERIFY_READ, error: null });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.VERIFY_READ,
      error: null,
      message: 'Recovery completion is not fully applied yet; the operation is still pending.',
    });
  }

  return finishVerified(record);
}

// ── operation: delete a linked workout note ──────────────────────────────────
//
// Single roll-forward outcome:
//   * the target membership is tombstoned;
//   * the note is absent (local mode) or carries a delete tombstone (cloud);
//   * cloud mode holds durable pending-sync intent for that deletion;
//   * no live membership references the deleted note.
//
// The membership tombstone is written FIRST and is never reverted. That is the
// whole point: a rejected note delete is not evidence the note survived, and a
// failed verification read is not evidence of either outcome, so the only safe
// direction is forward. Restoring a live membership could point it at a note
// that is already gone.
async function replayDeleteLinkedNote(record) {
  let weeks;
  try {
    weeks = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  } catch (e) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.DOMAIN_READ, error: e });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.DOMAIN_READ,
      error: e,
      message: 'Recovery data could not be read, so this note deletion is still pending.',
    });
  }

  const membership = weeks.find((w) => w.id === record.week_id);
  if (membership && !membership.deleted_at) {
    const at = record.requested_deleted_at;
    try {
      await writeList(
        RECOVERY_BLOCK_WEEKS_KEY,
        weeks.map((w) => (w.id === record.week_id ? { ...w, deleted_at: at, updated_at: at } : w))
      );
    } catch (e) {
      await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.FIRST_WRITE, error: e });
      return pendingResult(record, {
        code: RECOVERY_OPERATION_CODES.OPERATION_FAILED,
        stage: RECOVERY_OPERATION_STAGES.FIRST_WRITE,
        error: e,
        message: 'The recovery week membership could not be removed; the operation is retained and will be retried.',
      });
    }
  }

  let noteState;
  try {
    noteState = await noteOperations.loadNoteState(record.note_id);
  } catch (e) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.DOMAIN_READ, error: e });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.DOMAIN_READ,
      error: e,
      message: 'The workout note could not be read, so this deletion is still pending.',
    });
  }

  // Re-run the delete when the note is still live, or when cloud mode holds the
  // tombstone without durable pending-sync intent (the queue-bookkeeping step
  // failed, or a pass cleared it). Both re-runs are idempotent.
  let deleteError = null;
  const needsDelete = !noteState?.deleted || (noteState?.requiresQueue && !noteState?.queued);
  if (needsDelete) {
    try {
      await noteOperations.deleteNote(record.note_id);
    } catch (e) {
      // Deliberately NOT returned here. A callback that persisted the deletion
      // and then threw looks identical from this side; only the persisted state
      // read below decides the outcome.
      deleteError = e;
    }
  }

  let weeksAfter;
  let noteStateAfter;
  try {
    weeksAfter = await readList(RECOVERY_BLOCK_WEEKS_KEY);
    noteStateAfter = await noteOperations.loadNoteState(record.note_id);
  } catch (e) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.VERIFY_READ, error: e });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.VERIFY_READ,
      error: e,
      message: 'This note deletion could not be verified yet; the operation is still pending.',
    });
  }

  const verifiedMembership = weeksAfter.find((w) => w.id === record.week_id);
  const membershipOk = !verifiedMembership || !!verifiedMembership.deleted_at;
  const noteOk = !!noteStateAfter?.deleted;
  const queueOk = !noteStateAfter?.requiresQueue || !!noteStateAfter?.queued;

  if (!membershipOk || !noteOk || !queueOk) {
    const stage = noteOk ? RECOVERY_OPERATION_STAGES.VERIFY_READ : RECOVERY_OPERATION_STAGES.SECOND_WRITE;
    await updateRecordStage(record, { stage, error: deleteError });
    return pendingResult(record, {
      code: deleteError
        ? RECOVERY_OPERATION_CODES.OPERATION_FAILED
        : RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage,
      error: deleteError,
      message: 'This note deletion is not fully applied yet; the operation is retained and will be retried.',
    });
  }

  return finishVerified(record);
}

function replayRecord(record) {
  if (record.type === RECOVERY_OPERATION_TYPES.COMPLETE_BLOCK_WITH_WEEK) {
    return replayCompleteBlockWithWeek(record);
  }
  return replayDeleteLinkedNote(record);
}

// ── reconciliation ───────────────────────────────────────────────────────────

function corruptReconciliation(error) {
  return {
    ok: false,
    code: RECOVERY_OPERATION_CODES.JOURNAL_CORRUPT,
    corrupt: true,
    pending: [],
    results: [],
    error:
      'Recovery operations could not be read from this device. Recovery actions are paused until this is retried.',
    cause: error || null,
  };
}

// Replay every journaled operation once. Never called directly by a caller
// outside this module — every entry point runs it under the shared lock.
async function reconcileAllUnlocked() {
  let journal;
  try {
    journal = await readRecoveryJournal();
  } catch (e) {
    return corruptReconciliation(e);
  }

  const results = [];
  for (const record of journal) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await replayRecord(record));
  }
  const pending = results.filter((r) => !r.ok);
  return {
    ok: pending.length === 0,
    code: pending.length === 0 ? RECOVERY_OPERATION_CODES.VERIFIED : pending[0].code,
    corrupt: false,
    pending,
    results,
    error: pending.length === 0 ? null : pending[0].error,
    cause: pending.length === 0 ? null : pending[0].cause,
  };
}

// Public reconciler. Startup/remount, the `Retry recovery` action, pre-action
// gating, and both cloud sync boundaries all call THIS function — there is no
// second repair algorithm anywhere in the codebase. A concurrent call awaits the
// in-flight pass instead of starting a competing replay.
export function reconcileRecoveryOperations() {
  if (inFlightReconcile) return inFlightReconcile;
  const pass = withRecoveryOperationLock(() => reconcileAllUnlocked());
  inFlightReconcile = pass;
  const clear = () => {
    if (inFlightReconcile === pass) inFlightReconcile = null;
  };
  pass.then(clear, clear);
  return pass;
}

function conflictsWith(record, { blockId, weekId, noteId }) {
  if (blockId && record.block_id === blockId) return true;
  if (weekId && record.week_id === weekId) return true;
  if (noteId && record.note_id === noteId) return true;
  return false;
}

// Run any recovery action (including the single-domain ones) behind the same
// guard, after reconciling. `scope` names the records the action touches so a
// still-pending operation over the same block/week/note blocks it rather than
// writing underneath it.
export function runGuardedRecoveryAction(scope, action) {
  return withRecoveryOperationLock(async () => {
    const reconciliation = await reconcileAllUnlocked();
    if (reconciliation.corrupt) {
      return { ok: false, code: reconciliation.code, error: reconciliation.error };
    }
    const blocking = reconciliation.pending.filter((p) => conflictsWith(p, scope || {}));
    if (blocking.length > 0) {
      return {
        ok: false,
        code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
        error: blocking[0].error,
      };
    }
    return action();
  });
}

// ── starting a journaled operation ───────────────────────────────────────────

async function beginAndReplay(intent) {
  const now = new Date().toISOString();
  const record = {
    version: RECOVERY_JOURNAL_VERSION,
    operation_id: nextOperationId(),
    created_at: now,
    updated_at: now,
    stage: RECOVERY_OPERATION_STAGES.INTENT,
    attempts: 0,
    last_error: null,
    ...intent,
  };

  // Step 2 of the protocol. If this fails, NO domain mutation happens at all.
  try {
    const journal = await readRecoveryJournal();
    journal.push(record);
    await writeRecoveryJournal(journal);
  } catch (e) {
    if (isRecoveryJournalCorruptError(e)) {
      return { ok: false, code: RECOVERY_OPERATION_CODES.JOURNAL_CORRUPT, error: e.message, cause: e };
    }
    return {
      ok: false,
      code: RECOVERY_OPERATION_CODES.OPERATION_FAILED,
      error: 'This recovery action could not be started safely, so nothing was changed.',
      cause: e,
    };
  }

  return replayRecord(record);
}

// Validate, journal, apply, verify. `validate` returns either
// `{ ok: false, error, code? }` (no journal record, no domain write) or
// `{ ok: true, intent }`.
export function startRecoveryOperation({ scope, validate }) {
  return withRecoveryOperationLock(async () => {
    const reconciliation = await reconcileAllUnlocked();
    if (reconciliation.corrupt) {
      return { ok: false, code: reconciliation.code, error: reconciliation.error };
    }
    const blocking = reconciliation.pending.filter((p) => conflictsWith(p, scope || {}));
    if (blocking.length > 0) {
      return {
        ok: false,
        code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
        error: blocking[0].error,
      };
    }

    let validation;
    try {
      validation = await validate();
    } catch (e) {
      return {
        ok: false,
        code: RECOVERY_OPERATION_CODES.VALIDATION_FAILED,
        error: e?.message || 'This recovery action could not be validated.',
        cause: e,
      };
    }
    if (!validation || validation.ok === false) {
      // Domain-specific reasons (BLOCK_NOT_FOUND, …) are preserved as `reason`
      // for the UI copy, but the machine-readable `code` stays inside this
      // module's own vocabulary so a caller can branch on it exhaustively.
      const isProtocolCode = Object.values(RECOVERY_OPERATION_CODES).includes(validation?.code);
      return {
        ok: false,
        code: isProtocolCode ? validation.code : RECOVERY_OPERATION_CODES.VALIDATION_FAILED,
        reason: isProtocolCode ? null : validation?.code || null,
        error: validation?.error || 'This recovery action is not allowed right now.',
      };
    }
    if (validation.skip) {
      // Nothing to do — already in the requested final state. No journal record
      // and no domain write.
      return { ok: true, code: RECOVERY_OPERATION_CODES.VERIFIED, ...validation.result };
    }

    return beginAndReplay(validation.intent);
  });
}
