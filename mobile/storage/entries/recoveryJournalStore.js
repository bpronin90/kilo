// Persistence, single-flight serialization, and durable record editing for the
// recovery operation journal (#696). Split out of recoveryOperationJournal.js;
// the entry file re-exports the public members of this surface unchanged.
//
// This layer owns the exclusive lock and every read/write of the journal key.
// It never decides an outcome — replay does that from persisted domain state —
// so nothing here interprets a record beyond validating its shape on read.

import { RECOVERY_OPERATION_JOURNAL_KEY } from './keys';
import { readList, writeList } from './jsonStorage';
import { RecoveryJournalCorruptError, isValidRecord } from './recoveryJournalSchema';

// ── single-flight serialization ──────────────────────────────────────────────
//
// UI actions, the retry affordance, mount/remount reconciliation, and the cloud
// sync boundary all funnel through this one queue. Re-entry awaits the in-flight
// work rather than starting a competing replay, so a double tap cannot allocate
// two ordinals and a sync pass cannot race a lifecycle write.

let operationTail = Promise.resolve();

export function withRecoveryOperationLock(fn) {
  const scheduled = operationTail.then(fn, fn);
  operationTail = scheduled.then(() => {}, () => {});
  return scheduled;
}

// Reset the lock queue to a fresh resolved tail. Test/teardown only, invoked by
// the composed journal reset helper.
export function resetRecoveryOperationLock() {
  operationTail = Promise.resolve();
}

// ── journal persistence ──────────────────────────────────────────────────────

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

export async function writeRecoveryJournal(records) {
  await writeList(RECOVERY_OPERATION_JOURNAL_KEY, records);
}

let operationCounter = 0;
export function nextOperationId() {
  operationCounter += 1;
  return `recop_${Date.now()}_${operationCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

// Public read used by the UI to decide whether a pending operation blocks an
// action. Throws RecoveryJournalCorruptError, deliberately: the caller must
// surface it, not treat it as an empty journal.
export function loadPendingRecoveryOperations() {
  return withRecoveryOperationLock(() => readRecoveryJournal());
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

export async function updateRecordStage(record, { stage, error }) {
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

// Durably rewrite fields on a journaled record and return the updated record, so
// the rest of the pass acts on what is now persisted. Unlike updateRecordStage
// this is NOT best effort: it is a write-ahead step for a changed outcome, so a
// failure must stop the pass rather than let it write something the record does
// not name.
export async function updateRecordFields(record, patch) {
  const journal = await readRecoveryJournal();
  const idx = journal.findIndex((r) => r.operation_id === record.operation_id);
  if (idx < 0) return record;
  const updated = { ...journal[idx], ...patch, updated_at: new Date().toISOString() };
  journal[idx] = updated;
  await writeRecoveryJournal(journal);
  return updated;
}

export async function clearRecord(record) {
  const journal = await readRecoveryJournal();
  const remaining = journal.filter((r) => r.operation_id !== record.operation_id);
  if (remaining.length === journal.length) return;
  await writeRecoveryJournal(remaining);
}
