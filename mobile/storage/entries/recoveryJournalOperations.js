// Concrete recovery lifecycle operations and the mode-aware note-deletion
// registry (#696). Split out of recoveryOperationJournal.js; the entry file
// re-exports the public members of this surface unchanged.
//
// Each operation is a single deterministic roll-forward: it re-reads persisted
// state, applies only the writes whose postcondition is unmet (idempotent under
// replay and double taps), reads every affected collection back, verifies all
// postconditions, and clears the record only after verification succeeds. The
// note registry lives here because the operations are its only consumers.

import { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } from './keys';
import { readList, writeList } from './jsonStorage';
import {
  RECOVERY_OPERATION_CODES,
  RECOVERY_OPERATION_STAGES,
  RECOVERY_OPERATION_TYPES,
} from './recoveryJournalSchema';
import { updateRecordStage, updateRecordFields, clearRecord } from './recoveryJournalStore';
import {
  loadWorkoutNoteDeletionState as localLoadWorkoutNoteDeletionState,
  loadWorkoutNotePresenceState as localLoadWorkoutNotePresenceState,
  deleteWorkoutNoteItem as localDeleteWorkoutNoteItem,
  saveWorkoutNoteItem as localSaveWorkoutNoteItem,
} from './workoutNotes';

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
  loadNoteLiveState: (noteId) => localLoadWorkoutNotePresenceState(noteId),
  ensureNoteLive: (noteSeed) => localSaveWorkoutNoteItem({ ...noteSeed, deleted_at: null }),
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

// ── result helpers ───────────────────────────────────────────────────────────

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

// Retire an operation whose recorded outcome can never be reached. The record is
// removed (so nothing stays locked) and the caller receives a terminal, non-ok
// result describing what happened, which the UI shows once instead of a
// permanent pending warning.
async function finishCancelled(record, message) {
  try {
    await clearRecord(record);
  } catch (e) {
    // The record could not be removed. Report it as ordinarily pending rather
    // than terminal: the cleanup itself is still retryable, and a stale record
    // left behind must not be reported as resolved.
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.CLEANUP,
      error: e,
      message,
    });
  }
  return {
    ok: false,
    terminal: true,
    code: RECOVERY_OPERATION_CODES.CONFLICT_CANCELLED,
    stage: RECOVERY_OPERATION_STAGES.CLEANUP,
    operationId: record.operation_id,
    type: record.type,
    block_id: record.block_id || null,
    week_id: record.week_id || null,
    note_id: record.note_id || null,
    error: message,
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
      // The immutable requested timestamp travels with the call so cloud mode
      // can reconstruct a tombstone for a note a local-mode attempt already
      // hard-deleted before the storage mode changed.
      await noteOperations.deleteNote(record.note_id, { deletedAt: record.requested_deleted_at });
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

// ── operation: attach a brand-new note as the next recovery week ──────────────
//
// The "create a new note for this week" path changes two collections — the
// notebook and the recovery-week memberships — so it is journaled like the other
// two. Before this it created the note OUTSIDE any durable record and relied on a
// best-effort `remove()` if the membership write failed; a second failure there
// left an untracked orphan note that no restart could attach or clean up.
//
// Single roll-forward outcome:
//   * a workout note with the recorded id exists;
//   * a live membership with the recorded id links it to the block at the
//     recorded ordinal;
//   * no second note and no second ordinal are ever created, however many times
//     this replays.
//
// Both the note and the membership are minted ONCE, at intent time, and stored on
// the record as seeds. Replay writes the seeds verbatim, which is what makes
// "assign the next ordinal exactly once" true under double taps and replay alike:
// a retry cannot mint a new id or a new ordinal, because it has none to mint.
// `note_seed` carries the title the user typed and an empty `raw_text` — the
// journal never stores workout-note text.
async function replayAddWeekWithNewNote(operationRecord) {
  let record = operationRecord;
  let blocks;
  let weeks;
  let noteState;
  try {
    blocks = await readList(RECOVERY_BLOCKS_KEY);
    weeks = await readList(RECOVERY_BLOCK_WEEKS_KEY);
    noteState = await noteOperations.loadNoteLiveState(record.note_id);
  } catch (e) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.DOMAIN_READ, error: e });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.DOMAIN_READ,
      error: e,
      message: 'Recovery data could not be read, so adding this week is still pending.',
    });
  }

  const block = blocks.find((b) => b.id === record.block_id);
  // The block is gone (deleted locally, or a sync pull brought its tombstone).
  // The recorded outcome can never be applied: a live membership under a deleted
  // block is precisely the dangling state cascadeDeletedBlockMemberships exists
  // to remove. Retire the record. Anything this operation already persisted stays
  // as an ordinary workout note — deleting a note the user asked to create, on a
  // race they did not cause, would destroy user data to tidy protocol state.
  if (!block || block.deleted_at) {
    return finishCancelled(
      record,
      'The recovery block was removed while this week was being added, so the new note was kept as an ordinary routine instead.'
    );
  }

  // The note postcondition is "durably LIVE", not merely "present". Existence
  // alone would accept a tombstone (creating a membership that points at a
  // deleted note) and would accept a cloud row whose enqueue failed after the
  // write committed, which would publish a membership referencing a note that
  // never uploads. `ensureNoteLive` is idempotent and repairs every one of those
  // states from the recorded seed.
  const noteNeedsWork = !noteState?.exists
    || !!noteState?.deleted
    || (noteState?.requiresQueue && !noteState?.queued);
  if (noteNeedsWork) {
    try {
      await noteOperations.ensureNoteLive(record.note_seed);
    } catch (e) {
      await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.FIRST_WRITE, error: e });
      return pendingResult(record, {
        code: RECOVERY_OPERATION_CODES.OPERATION_FAILED,
        stage: RECOVERY_OPERATION_STAGES.FIRST_WRITE,
        error: e,
        message: 'The note for this recovery week could not be created; the operation is retained and will be retried.',
      });
    }
  }

  const liveForNote = weeks.find((w) => w.note_id === record.note_id && !w.deleted_at);
  if (liveForNote && liveForNote.block_id !== record.block_id) {
    // The note belongs to another block now. One note cannot be in two blocks, and
    // no retry, restart, or sync can undo that — retrying forever would lock every
    // recovery action on this block permanently. Terminal cancellation: the note
    // stays where it is, and the user is told what happened.
    return finishCancelled(
      record,
      'That note was linked to a different recovery block before this week could be added, so this week was not created.'
    );
  }

  if (!liveForNote) {
    const ordinalOwner = weeks.find(
      (w) => w.block_id === record.block_id
        && !w.deleted_at
        && w.week_number === record.week_seed.week_number
        && w.note_id !== record.note_id
    );
    if (ordinalOwner) {
      // Another device claimed this ordinal while the operation was pending. The
      // conflict is permanent for the RECORDED ordinal, so retrying it unchanged
      // could never succeed. The deterministic transition is a durable
      // reassignment: recompute the next free ordinal (one past the highest live
      // week, the same rule the domain applies), persist it onto the journal
      // record BEFORE writing anything, then continue in this same pass. Replay
      // and verification both read the reassigned value, so the outcome stays
      // single and recorded rather than silently chosen at write time.
      const highest = weeks.reduce(
        (max, w) => (w.block_id === record.block_id && !w.deleted_at && w.week_number > max ? w.week_number : max),
        0
      );
      const reassigned = highest + 1;
      try {
        record = await updateRecordFields(record, {
          week_seed: { ...record.week_seed, week_number: reassigned },
          reassigned_from_week_number: record.reassigned_from_week_number ?? record.week_seed.week_number,
          reassignments: (record.reassignments || 0) + 1,
          stage: RECOVERY_OPERATION_STAGES.SECOND_WRITE,
        });
      } catch (e) {
        return pendingResult(record, {
          code: RECOVERY_OPERATION_CODES.OPERATION_FAILED,
          stage: RECOVERY_OPERATION_STAGES.SECOND_WRITE,
          error: e,
          message: 'This recovery week could not be renumbered after a conflict; the operation is retained and will be retried.',
        });
      }
    }

    const existingRow = weeks.find((w) => w.id === record.week_id);
    const next = existingRow
      // A tombstoned row with our own id: revive it verbatim from the seed rather
      // than appending a duplicate id.
      ? weeks.map((w) => (w.id === record.week_id ? { ...record.week_seed } : w))
      : [...weeks, record.week_seed];
    try {
      await writeList(RECOVERY_BLOCK_WEEKS_KEY, next);
    } catch (e) {
      await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.SECOND_WRITE, error: e });
      return pendingResult(record, {
        code: RECOVERY_OPERATION_CODES.OPERATION_FAILED,
        stage: RECOVERY_OPERATION_STAGES.SECOND_WRITE,
        error: e,
        message: 'This recovery week could not be attached; the operation is retained and will be retried.',
      });
    }
  }

  let weeksAfter;
  let noteStateAfter;
  try {
    weeksAfter = await readList(RECOVERY_BLOCK_WEEKS_KEY);
    noteStateAfter = await noteOperations.loadNoteLiveState(record.note_id);
  } catch (e) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.VERIFY_READ, error: e });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.VERIFY_READ,
      error: e,
      message: 'Adding this recovery week could not be verified yet; the operation is still pending.',
    });
  }

  const verifiedWeeks = weeksAfter.filter(
    (w) => w.note_id === record.note_id && w.block_id === record.block_id && !w.deleted_at
  );
  const noteOk = !!noteStateAfter?.exists
    && !noteStateAfter?.deleted
    && (!noteStateAfter?.requiresQueue || !!noteStateAfter?.queued);
  const membershipOk = verifiedWeeks.length === 1
    && verifiedWeeks[0].week_number === record.week_seed.week_number;

  if (!noteOk || !membershipOk) {
    await updateRecordStage(record, { stage: RECOVERY_OPERATION_STAGES.VERIFY_READ, error: null });
    return pendingResult(record, {
      code: RECOVERY_OPERATION_CODES.RECONCILIATION_PENDING,
      stage: RECOVERY_OPERATION_STAGES.VERIFY_READ,
      error: null,
      message: 'This recovery week is not fully attached yet; the operation is still pending.',
    });
  }

  return finishVerified(record);
}

export function replayRecord(record) {
  if (record.type === RECOVERY_OPERATION_TYPES.COMPLETE_BLOCK_WITH_WEEK) {
    return replayCompleteBlockWithWeek(record);
  }
  if (record.type === RECOVERY_OPERATION_TYPES.ADD_WEEK_WITH_NEW_NOTE) {
    return replayAddWeekWithNewNote(record);
  }
  return replayDeleteLinkedNote(record);
}
