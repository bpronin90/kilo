// Guarded Tidy names mutation, Undo and conflict resolution (#1309).
//
// The core runs through `startRecoveryOperation`, i.e. under the shared recovery
// lock after reconciliation. Inside that lock it re-reads the authoritative
// block, weeks and notes, re-plans, and requires the EXACT plan and evidence the
// user reviewed; any difference (text, timestamps, membership, baseline,
// lifecycle, deletion) rejects with zero domain writes. Only then does it persist
// the payload and the journal intent, and let the journal replay apply, verify
// and publish one logical result. No network is touched at any point.

import { useCallback } from 'react';
import * as Storage from '../../storage/entries';
import {
  RECOVERY_OPERATION_TYPES,
  readRecoveryJournal,
  resolveTidyConflict,
  startRecoveryOperation,
} from '../../storage/entries/recoveryOperationJournal';
import {
  buildTidyPayload,
  loadTidyUndoPayload,
  saveTidyPayload,
  sweepTidyPayloads,
} from '../../storage/entries/recoveryTidyPayload';
import { isLiveRecord } from '../../lib/data/recoveryBlocks';
import { baselineShapeFingerprint, planTidyNames, tidyUndoStillValid } from '../../lib/data/recoveryTidyNames';
import { ensureVerifiedRecoveryState, notifyRecoveryBlocks } from './recoveryReadState';
import { notifyWorkoutNotes } from './workoutNoteHooks';

const TidyStorage = { ...Storage, loadTidyUndoPayload, saveTidyPayload, sweepTidyPayloads, readRecoveryJournal };
const STALE = 'These names changed since you opened the review. Review them again.';

const mintPayloadId = () => `tidy_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

async function readAuthoritative(storage, blockId) {
  const block = (await storage.loadRecoveryBlocks()).find(b => b.id === blockId);
  if (!block || !isLiveRecord(block)) return { ok: false, error: 'This recovery block is no longer available.' };
  return { ok: true, block, weeks: await storage.loadRecoveryBlockWeeks(), notes: await storage.loadWorkoutNotes() };
}

// Drop expired Undo payloads and pending payloads no journal record names. Run
// under the lock, so a payload being started right now is never swept.
async function sweep(storage) {
  try {
    const journal = await storage.readRecoveryJournal();
    await storage.sweepTidyPayloads(journal.filter(r => r.payload_id).map(r => r.payload_id));
  } catch { /* housekeeping only; a failure never blocks the operation */ }
}

export function tidyNamesCore(storage, { blockId, evidence, signature } = {}) {
  return startRecoveryOperation({
    scope: { blockId },
    validate: async () => {
      const read = await readAuthoritative(storage, blockId);
      if (!read.ok) return read;
      await sweep(storage);
      const plan = planTidyNames(read);
      if (!plan.ok) return { ok: false, error: plan.error };
      if (!evidence || !signature || plan.evidence !== evidence || plan.signature !== signature) return { ok: false, error: STALE };
      if (plan.empty) return { ok: false, error: 'Names are already tidy. Nothing to change.' };
      const requestedAt = new Date().toISOString();
      const payload = buildTidyPayload({ id: mintPayloadId(), blockId, requestedAt, plan, baselineShape: baselineShapeFingerprint(read.block.baseline) });
      // Replay evidence is durable BEFORE the journal intent and any domain write.
      await storage.saveTidyPayload(payload);
      return {
        ok: true,
        intent: {
          type: RECOVERY_OPERATION_TYPES.TIDY_RECOVERY_NAMES,
          block_id: blockId,
          payload_id: payload.id,
          direction: 'apply',
          requested_at: requestedAt,
          note_ids: payload.notes.map(n => n.id),
          plan_signature: plan.signature,
        },
      };
    },
  });
}

export function undoTidyNamesCore(storage, { blockId } = {}) {
  return startRecoveryOperation({
    scope: { blockId },
    validate: async () => {
      const read = await readAuthoritative(storage, blockId);
      if (!read.ok) return read;
      await sweep(storage);
      const payload = await storage.loadTidyUndoPayload(blockId);
      if (!payload) return { ok: false, error: 'There is nothing to undo for this block.' };
      if (!tidyUndoStillValid(payload, read)) {
        return { ok: false, error: 'Names or notes changed since they were tidied, so undo is no longer available.' };
      }
      return {
        ok: true,
        intent: {
          type: RECOVERY_OPERATION_TYPES.TIDY_RECOVERY_NAMES,
          block_id: blockId,
          payload_id: payload.id,
          direction: 'undo',
          requested_at: new Date().toISOString(),
          note_ids: payload.notes.map(n => n.id),
        },
      };
    },
  });
}

// Summary the card needs to offer Undo (never the stored texts).
export async function loadTidyUndoSummary(storage, { blockId, block, notes } = {}) {
  const payload = await storage.loadTidyUndoPayload(blockId);
  if (!payload || !tidyUndoStillValid(payload, { block, notes })) return { available: false };
  return { available: true, noteCount: payload.notes.length, nameCount: payload.baseline.length };
}

function publish(result) {
  if (result && result.ok) {
    notifyRecoveryBlocks();
    notifyWorkoutNotes();
  } else if (result && result.tidy) {
    notifyRecoveryBlocks(); // surface the durable pending/conflict state
  }
  return result;
}

export function useRecoveryTidyNames() {
  const tidyNames = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    return publish(await tidyNamesCore(TidyStorage, params));
  }, []);
  const undoTidyNames = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    return publish(await undoTidyNamesCore(TidyStorage, params));
  }, []);
  const loadUndo = useCallback((params) => loadTidyUndoSummary(TidyStorage, params), []);
  // Resolution takes the recovery lock itself and deliberately skips the verified
  // gate: a pending conflict is what makes that gate fail.
  const resolveConflict = useCallback(async (params) => {
    const result = await resolveTidyConflict(params);
    notifyRecoveryBlocks();
    if (result.ok) notifyWorkoutNotes();
    return result;
  }, []);
  return { tidyNames, undoTidyNames, loadUndo, resolveConflict };
}
