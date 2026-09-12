// Reconciliation engine and public entry points for the recovery operation
// journal (#696). Split out of recoveryOperationJournal.js; the entry file
// re-exports the public members of this surface unchanged.
//
// This layer orchestrates: it replays every journaled operation once under the
// shared lock, gates new actions behind pending conflicts, and starts a new
// journaled operation by persisting its intent before any domain write. The
// concrete per-operation logic lives in recoveryJournalOperations.js.

import {
  RECOVERY_JOURNAL_VERSION,
  RECOVERY_OPERATION_CODES,
  RECOVERY_OPERATION_STAGES,
  isRecoveryJournalCorruptError,
} from './recoveryJournalSchema';
import {
  withRecoveryOperationLock,
  resetRecoveryOperationLock,
  readRecoveryJournal,
  writeRecoveryJournal,
  nextOperationId,
} from './recoveryJournalStore';
import { replayRecord, resetRecoveryNoteOperations } from './recoveryJournalOperations';

let inFlightReconcile = null;

// Test/teardown helper. Never called by production code.
export function __resetRecoveryOperationJournal() {
  resetRecoveryOperationLock();
  inFlightReconcile = null;
  resetRecoveryNoteOperations();
}

// ── reconciliation ───────────────────────────────────────────────────────────

function corruptReconciliation(error) {
  return {
    ok: false,
    code: RECOVERY_OPERATION_CODES.JOURNAL_CORRUPT,
    corrupt: true,
    pending: [],
    cancelled: [],
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
  // A terminal cancellation is RESOLVED, not pending: its record is already
  // cleared, so it must never keep an action locked or be retried. It is still
  // reported separately so the UI can explain once what happened.
  const cancelled = results.filter((r) => !r.ok && r.terminal);
  const pending = results.filter((r) => !r.ok && !r.terminal);
  const headline = pending[0] || cancelled[0] || null;
  return {
    ok: pending.length === 0,
    code: pending.length > 0
      ? pending[0].code
      : (cancelled.length > 0 ? cancelled[0].code : RECOVERY_OPERATION_CODES.VERIFIED),
    corrupt: false,
    pending,
    cancelled,
    results,
    error: headline ? headline.error : null,
    cause: headline ? headline.cause : null,
  };
}

// Hold the recovery-operation guard across a whole multi-step sequence — the one
// caller is the cloud sync/bootstrap boundary, which must reconcile, run its
// pass, and reconcile again as ONE indivisible unit.
//
// Reconciling under the lock and then releasing it for the pass is not enough. A
// journaled UI action could acquire the queue during the unguarded pass, and both
// sides read a complete `recovery_blocks`/`recovery_block_weeks` array and later
// write the whole array back: whichever writes last silently discards the other's
// change. The post-pass reconciliation cannot detect that, because the UI
// operation already verified and cleared its own record — so sync would report
// success over a lost update. Excluding lifecycle writes for the duration of the
// pass is the only thing that actually prevents it.
//
// `run` receives a `reconcile()` that replays WITHOUT re-acquiring the queue,
// which is what keeps the nested pre/post reconciliation from deadlocking against
// the guard this function is already holding. Competing UI actions simply queue
// behind it and run once the pass is done.
export function withExclusiveRecoveryAccess(run) {
  return withRecoveryOperationLock(() => run({ reconcile: () => reconcileAllUnlocked() }));
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
