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
//
// ── module layout ─────────────────────────────────────────────────────────────
//
// This file is the compatibility barrel. The implementation is split, without
// any change to serialized data or recovery behavior, across:
//
//   * recoveryJournalSchema.js     — version, operation/stage/code constants,
//                                    the typed corruption error, record shape
//                                    validation;
//   * recoveryJournalStore.js      — the exclusive lock, journal read/write,
//                                    operation-id minting, durable record edits;
//   * recoveryJournalOperations.js — the three concrete roll-forward operations
//                                    and the mode-aware note-deletion registry;
//   * recoveryJournalReplay.js     — reconciliation, action gating, and the
//                                    entry points that start a journaled
//                                    operation.
//
// Every name previously exported from this file is re-exported below unchanged,
// as a plain (spy-able) binding, so existing importers and test seams — including
// `jest.spyOn(module, 'reconcileRecoveryOperations')` — keep working verbatim.

import * as schema from './recoveryJournalSchema';
import * as store from './recoveryJournalStore';
import * as operations from './recoveryJournalOperations';
import * as replay from './recoveryJournalReplay';

// schema/validation surface
export const RECOVERY_JOURNAL_VERSION = schema.RECOVERY_JOURNAL_VERSION;
export const RECOVERY_OPERATION_TYPES = schema.RECOVERY_OPERATION_TYPES;
export const RECOVERY_OPERATION_CODES = schema.RECOVERY_OPERATION_CODES;
export const RECOVERY_OPERATION_STAGES = schema.RECOVERY_OPERATION_STAGES;
export const RecoveryJournalCorruptError = schema.RecoveryJournalCorruptError;
export const isRecoveryJournalCorruptError = schema.isRecoveryJournalCorruptError;

// persistence/locking surface
export const readRecoveryJournal = store.readRecoveryJournal;
export const loadPendingRecoveryOperations = store.loadPendingRecoveryOperations;

// note-operations registry surface
export const setRecoveryNoteOperations = operations.setRecoveryNoteOperations;
export const deleteWorkoutNoteViaRecoveryOperations = operations.deleteWorkoutNoteViaRecoveryOperations;
export const resetRecoveryNoteOperations = operations.resetRecoveryNoteOperations;

// reconciliation / entry-point surface
export const withExclusiveRecoveryAccess = replay.withExclusiveRecoveryAccess;
export const reconcileRecoveryOperations = replay.reconcileRecoveryOperations;
export const runGuardedRecoveryAction = replay.runGuardedRecoveryAction;
export const startRecoveryOperation = replay.startRecoveryOperation;
export const __resetRecoveryOperationJournal = replay.__resetRecoveryOperationJournal;
