// Roll-forward replay for the journaled Tidy names operation and its Undo
// (#1309). Dispatched from recoveryJournalOperations.js under the shared
// recovery lock, so it follows the same protocol as the other operations:
// persisted intent first, idempotent writes toward ONE recorded outcome, verified
// read-back of every affected record, journal cleared last.
//
// What is and is not promised: this is one published logical result with durable
// recovery of interrupted physical writes. It is not a native cross-store or
// cloud transaction. Notes are validated all-or-nothing before the first write,
// then the baseline names follow; a failure after any physical commit leaves the
// journal record (and its immutable payload) pending, blocking conflicting
// maintenance and sync until a replay verifies the whole outcome. Nothing is
// restored by blind snapshot: a note edited since (or deleted) is a CONFLICT
// that stops the roll-forward and waits for an explicit user resolution
// (`resolveTidyConflict` in recoveryJournalReplay.js).

import { RECOVERY_OPERATION_CODES, RECOVERY_OPERATION_STAGES } from './recoveryJournalSchema';
import { updateRecordStage, updateRecordFields } from './recoveryJournalStore';
import { loadTidyPayload, markTidyPayloadApplied, deleteTidyPayload } from './recoveryTidyPayload';
import { NAME_STATE, readBaselineNameState, writeRecoveryBlockBaselineNames } from './recoveryBaselineNameStorage';
import { applyTidyNoteTexts as localApply, loadTidyTextStates as localLoad } from './workoutNoteRecoveryBatch';

// Mode-aware note text operations, registered by hooks/entries/storageMode.js
// beside the other note operations; local-only is the default.
const DEFAULT_OPS = Object.freeze({ applyTidyTexts: localApply, loadTidyTextStates: localLoad });
let ops = DEFAULT_OPS;

export function setTidyNoteOperations(registered) {
  ops = {
    applyTidyTexts: registered?.applyTidyTexts || DEFAULT_OPS.applyTidyTexts,
    loadTidyTextStates: registered?.loadTidyTextStates || DEFAULT_OPS.loadTidyTextStates,
  };
}

export function resetTidyNoteOperations() {
  ops = DEFAULT_OPS;
}

const CODES = RECOVERY_OPERATION_CODES;
const STAGES = RECOVERY_OPERATION_STAGES;

function noteState(state, item) {
  if (!state || !state.exists || state.deleted) return 'conflict';
  if (state.raw_text === item.target) return 'done';
  return state.raw_text === item.source ? 'todo' : 'conflict';
}

const needsQueue = (state) => !!state && state.requiresQueue && !state.queued;

export async function replayTidyRecord(record, kit) {
  const { pendingResult, verifiedResult, finishVerified } = kit;
  const lenient = record.restore === true; // explicit restore: edited notes are left alone
  const hold = async (code, stage, error, message, extra) => {
    await updateRecordStage(record, { stage, error });
    return { ...pendingResult(record, { code, stage, error, message }), tidy: true, note_ids: record.note_ids, ...extra };
  };
  const conflictOut = async (conflicts, message) => {
    try {
      if (!record.conflict) await updateRecordFields(record, { conflict: { at: new Date().toISOString(), ids: conflicts.map(c => c.id).filter(Boolean), reason: conflicts[0]?.reason || 'changed' } });
    } catch { /* the pending result below still blocks; the flag is advisory */ }
    return {
      ...pendingResult(record, { code: CODES.RECONCILIATION_PENDING, stage: STAGES.VERIFY_READ, error: null, message }),
      tidy: true, note_ids: record.note_ids, conflict: true, conflicts,
    };
  };

  let payload;
  try {
    payload = await loadTidyPayload(record.payload_id);
  } catch (e) {
    return hold(CODES.RECONCILIATION_PENDING, STAGES.DOMAIN_READ, e, 'Tidy names data could not be read, so this operation is still pending.');
  }
  const sameNotes = payload && payload.notes.length === record.note_ids.length
    && payload.notes.every(n => record.note_ids.includes(n.id));
  if (!payload || payload.block_id !== record.block_id || !sameNotes) {
    return conflictOut([{ id: null, reason: 'payload_missing' }],
      'The saved copy needed to finish tidying names is missing. Choose how to resolve it.');
  }
  const forward = record.direction === 'apply';
  const items = payload.notes.map(n => ({ id: n.id, source: forward ? n.before : n.after, target: forward ? n.after : n.before }));
  const changes = payload.baseline;
  const direction = record.direction;

  const read = async () => ({
    notes: await ops.loadTidyTextStates(items.map(i => i.id)),
    // Always read the block: the reviewed frozen baseline (its shape, not just the
    // renamed rows) and its existence are part of the outcome even when no name
    // changes, so a competing snapshot or a removed block is a conflict.
    names: await readBaselineNameState(record.block_id, changes, direction),
  });
  let before;
  try {
    before = await read();
  } catch (e) {
    return hold(CODES.RECONCILIATION_PENDING, STAGES.DOMAIN_READ, e, 'Recovery data could not be read, so tidying names is still pending.');
  }

  const byId = new Map(before.notes.map(s => [s.id, s]));
  const conflicts = [];
  const work = [];
  for (const item of items) {
    const state = noteState(byId.get(item.id), item);
    if (state === 'conflict') conflicts.push({ id: item.id, reason: byId.get(item.id)?.exists && !byId.get(item.id).deleted ? 'edited' : 'missing' });
    else work.push(item);
  }
  const shapeChanged = !before.names.missing && before.names.shape !== payload.baseline_shape;
  const namesConflict = before.names.state === NAME_STATE.CONFLICT || shapeChanged;
  if (namesConflict) conflicts.push({ id: null, reason: before.names.missing ? 'block_missing' : 'baseline_changed' });
  if (conflicts.length && !lenient) {
    return conflictOut(conflicts, 'Names changed while this was being applied, so it cannot be finished safely. Choose how to resolve it.');
  }

  let writeError = null;
  const pendingWrite = work.some(i => noteState(byId.get(i.id), i) === 'todo' || needsQueue(byId.get(i.id)));
  if (pendingWrite) {
    try {
      const result = await ops.applyTidyTexts({ items: work, requestedAt: record.requested_at });
      if (result.status === 'conflict') {
        if (!lenient) return conflictOut(result.conflicts.map(c => ({ id: c.id, reason: c.reason })), 'Names changed while this was being applied, so it cannot be finished safely. Choose how to resolve it.');
      } else if (result.status === 'failed') {
        writeError = result.error || new Error('Note write failed');
      }
    } catch (e) {
      writeError = e;
    }
  }
  if (!writeError && !namesConflict && changes.length && before.names.state === NAME_STATE.TODO) {
    try {
      const result = await writeRecoveryBlockBaselineNames(record.block_id, changes, direction, record.requested_at);
      if (result.state === NAME_STATE.CONFLICT && !lenient) {
        return conflictOut([{ id: null, reason: 'baseline_changed' }], 'Names changed while this was being applied, so it cannot be finished safely. Choose how to resolve it.');
      }
    } catch (e) {
      writeError = e;
    }
  }
  if (writeError) {
    return hold(CODES.OPERATION_FAILED, STAGES.SECOND_WRITE, writeError, 'Tidying names could not be fully applied; it is retained and will be retried.');
  }

  let after;
  try {
    after = await read();
  } catch (e) {
    return hold(CODES.RECONCILIATION_PENDING, STAGES.VERIFY_READ, e, 'Tidying names could not be verified yet; the operation is still pending.');
  }
  const afterById = new Map(after.notes.map(s => [s.id, s]));
  const notesOk = work.every((i) => {
    const s = afterById.get(i.id);
    return s && s.exists && !s.deleted && s.raw_text === i.target && !needsQueue(s);
  });
  const namesOk = namesConflict || after.names.state === NAME_STATE.DONE;
  if (!notesOk || !namesOk) {
    return hold(CODES.RECONCILIATION_PENDING, STAGES.VERIFY_READ, null, 'Tidying names is not fully applied yet; the operation is still pending.');
  }

  // Verified. An applied tidy becomes its block's single bounded Undo payload;
  // an Undo (or an explicit restore) consumes it. A cleanup-only failure is
  // reported separately and retried: the record stays, replay is idempotent.
  if (forward && !lenient) {
    try {
      await markTidyPayloadApplied(payload.id);
    } catch (e) {
      await updateRecordStage(record, { stage: STAGES.CLEANUP, error: e });
      return verifiedResult(record, CODES.VERIFIED_CLEANUP_PENDING);
    }
    return finishVerified(record);
  }
  // Undo / restore: the payload is the only replay evidence, so it outlives the
  // journal record. Retire the intent first; only once that is durable is the
  // payload dropped (a crash in between leaves an inert, swept payload).
  const retired = await finishVerified(record);
  if (retired.code === CODES.VERIFIED) {
    try { await deleteTidyPayload(payload.id); } catch { /* swept on the next start */ }
  }
  return retired;
}
