// Schema, constants, typed errors, and record validation for the recovery
// operation journal (#696). Split out of recoveryOperationJournal.js so the
// serialized contract lives in one small module; the entry file re-exports this
// surface unchanged.
//
// Nothing in here performs I/O. It defines the version, the machine-readable
// operation/stage/code vocabularies, the corruption error type, and the
// fail-closed record validator that the persistence layer runs on every read.

export const RECOVERY_JOURNAL_VERSION = 1;

export const RECOVERY_OPERATION_TYPES = Object.freeze({
  COMPLETE_BLOCK_WITH_WEEK: 'complete_block_with_week',
  DELETE_LINKED_NOTE: 'delete_linked_note',
  ADD_WEEK_WITH_NEW_NOTE: 'add_week_with_new_note',
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
  // TERMINAL. The recorded outcome became permanently unreachable through no
  // fault of storage — a concurrent change made it impossible rather than merely
  // delayed — so the operation is retired with an explanation instead of being
  // retried forever. This exists because "retain and retry" is only honest when a
  // retry can change the result: a condition no restart, retry, or sync can alter
  // would otherwise lock every affected recovery action permanently and send the
  // user into exactly the undefined manual-reconciliation state the contract
  // forbids. The journal record is cleared, so actions unlock immediately.
  CONFLICT_CANCELLED: 'CONFLICT_CANCELLED',
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

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function isValidRecord(record) {
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
  if (record.type === RECOVERY_OPERATION_TYPES.ADD_WEEK_WITH_NEW_NOTE) {
    return (
      isNonEmptyString(record.block_id) &&
      isNonEmptyString(record.note_id) &&
      isNonEmptyString(record.week_id) &&
      isNonEmptyString(record.requested_created_at) &&
      !!record.note_seed && record.note_seed.id === record.note_id &&
      !!record.week_seed && record.week_seed.id === record.week_id &&
      Number.isInteger(record.week_seed.week_number) && record.week_seed.week_number > 0
    );
  }
  return false;
}
