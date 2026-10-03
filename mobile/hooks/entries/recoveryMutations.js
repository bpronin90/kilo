// Recovery-block mutations: plain async cores (storage passed in, directly
// unit-testable) plus the thin hooks that bind them to the real storage module
// (#695, #696, #836, #839, #872; split from recoveryBlockHooks.js in #1058,
// behavior unchanged). Every hook re-establishes a verified authoritative state
// at confirm time via `ensureVerifiedRecoveryState` before writing, then fires
// `notifyRecoveryBlocks` (and, for the two operations that also touch the
// notebook, `reloadWorkoutNotes`) AFTER the verified result — never before.

import { useCallback } from 'react';
import * as Storage from '../../storage/entries';
import {
  RECOVERY_OPERATION_CODES,
  RECOVERY_OPERATION_TYPES,
  deleteWorkoutNoteViaRecoveryOperations as deleteNoteViaJournalOperations,
  reconcileRecoveryOperations,
  runGuardedRecoveryAction,
  startRecoveryOperation,
} from '../../storage/entries/recoveryOperationJournal';
import {
  buildRecoveryWeek,
  findLiveMembershipForNote,
  isBlockActive,
  isLiveRecord,
  nextWeekNumber,
  orderedLiveWeeks,
  planBaselineRebuild,
} from '../../lib/data/recoveryBlocks';
import { replaceRecoveryBlockBaseline } from '../../storage/entries/recoveryStorage';
import { makeWorkoutNoteItem } from '../../lib/data';
// Imported for its module-load side effect: it registers the mode-aware
// note-deletion operations into the recovery journal (see
// hooks/entries/storageMode.js). Without it the journal would fall back to its
// local-only default even in cloud mode.
import './storageMode';
import { reloadWorkoutNotes } from './workoutNoteHooks';
import { ensureVerifiedRecoveryState, notifyRecoveryBlocks } from './recoveryReadState';

const RecoveryStorage = Storage;
const RebuildStorage = { ...Storage, replaceRecoveryBlockBaseline };

// Create the block, then attach exactly one week; a Week-1 failure rolls the
// just-created block back so no orphan active block is left. The whole flow (the
// optional "New note" write, block create, week attach, both rollbacks) runs behind
// the process-wide lock Reopen uses (#839) via `runGuardedRecoveryAction`, so Start
// and Reopen's "no active block" checks serialize. `createWeekNote`/`removeWeekNote`
// (optional) create/roll back a Week-1 note this call made. `reason` (#872) goes
// straight to the block record, which normalizes it.
export function startRecoveryBlockCore(storage, {
  baselineNoteId, baselineNoteTitle = null, baselineNoteText = '', weekNoteId = null,
  reason = null, createWeekNote, removeWeekNote,
} = {}) {
  return runGuardedRecoveryAction({}, async () => {
    let finalWeekNoteId = weekNoteId;
    let createdNoteId = null;
    if (!finalWeekNoteId && createWeekNote) {
      const created = await createWeekNote();
      finalWeekNoteId = created?.id || null;
      createdNoteId = finalWeekNoteId;
    }
    if (!finalWeekNoteId) {
      return { ok: false, error: 'Select or create a note for Recovery Week 1.' };
    }

    let block = null;
    try {
      block = await storage.createRecoveryBlock({
        baselineNoteId,
        baselineNoteTitle,
        baselineNoteText,
        reason,
      });
    } catch (e) {
      if (createdNoteId && removeWeekNote) {
        try {
          await removeWeekNote(createdNoteId);
        } catch (_rollbackError) {
          // Best-effort: the original failure is what the caller needs to see.
        }
      }
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not start the recovery block.' };
    }

    try {
      const week = await storage.addRecoveryWeek({ blockId: block.id, noteId: finalWeekNoteId });
      notifyRecoveryBlocks();
      return { ok: true, block, week };
    } catch (e) {
      try {
        await storage.deleteRecoveryBlock(block.id);
      } catch (_rollbackError) {
        // Best-effort rollback; the original failure is what the caller needs
        // to see either way.
      }
      if (createdNoteId && removeWeekNote) {
        try {
          await removeWeekNote(createdNoteId);
        } catch (_rollbackError) {
          // Best-effort: the original failure is what the caller needs to see.
        }
      }
      notifyRecoveryBlocks();
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not add Recovery Week 1.' };
    }
  });
}

export function useStartRecoveryBlock() {
  // Confirm-time recheck: freezing a baseline against unverified state is the write
  // this gate prevents. Everything after it runs inside `startRecoveryBlockCore`'s
  // own lock, so there is exactly one gate and one lock acquisition (#711).
  const startBlock = useCallback(async ({
    baselineNoteId, baselineNoteTitle = null, baselineNoteText = '', weekNoteId = null,
    reason = null, createWeekNote, removeWeekNote,
  } = {}) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;

    return startRecoveryBlockCore(Storage, {
      baselineNoteId, baselineNoteTitle, baselineNoteText, weekNoteId, reason, createWeekNote, removeWeekNote,
    });
  }, []);
  return { startBlock };
}

// ── Week 2+ lifecycle (#696) ──────────────────────────────────────────────────
//
// No core below accepts a caller-supplied `weeks`/`blocks` snapshot: a confirm can
// sit open while background sync lands records, so every mutation re-reads storage
// immediately before it acts.

// Complete the block's current week (its single latest live week, if any — the
// same definition `nextWeekNumber` builds off of). A no-op (still ok:true)
// when there is no current week or it is already complete — completion is
// idempotent, matching the storage layer's own re-completion contract.
export function completeCurrentWeekCore(storage, { blockId }) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    const ordered = await storage.loadRecoveryWeeksForBlock(blockId);
    const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
    if (!current) {
      return { ok: false, code: 'NO_CURRENT_WEEK', error: 'This block has no current week to complete.' };
    }
    if (current.completed_at) return { ok: true, week: current };
    try {
      const week = await storage.completeRecoveryWeek(current.id);
      return { ok: true, week };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not complete the current week.' };
    }
  });
}

// Reopen the block's current (latest live) week — the inverse of
// completeCurrentWeekCore (#836). Restricted to the latest week exactly like
// unlinkRecoveryWeekCore: an earlier, already-superseded week can never be
// reopened, which is what keeps "at most one week in progress" true after an
// undo. A no-op error (not a silent success) when the current week is not
// actually completed, so a stale button press explains itself rather than
// pretending to have done something.
//
// Also refuses on a no-longer-active block: a stale confirm would otherwise leave a
// COMPLETED block with an IN-PROGRESS week, which the domain forbids (`isBlockActive`).
export function uncompleteCurrentWeekCore(storage, { blockId }) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    const [blocks, ordered] = await Promise.all([
      storage.loadRecoveryBlocks(),
      storage.loadRecoveryWeeksForBlock(blockId),
    ]);
    const block = blocks.find(b => b.id === blockId);
    if (!block || !isBlockActive(block)) {
      return { ok: false, code: 'BLOCK_NOT_ACTIVE', error: 'This recovery block is no longer active.' };
    }
    const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
    if (!current) {
      return { ok: false, code: 'NO_CURRENT_WEEK', error: 'This block has no completed week to reopen.' };
    }
    if (!current.completed_at) {
      return { ok: false, code: 'WEEK_NOT_COMPLETE', error: 'The current week is already in progress.' };
    }
    try {
      const week = await storage.uncompleteRecoveryWeek(current.id);
      return { ok: true, week };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not reopen this week.' };
    }
  });
}

// Attach the next sequential week. Rejects (without calling storage) when the
// current week has not been explicitly completed yet — Week 2+ can never be
// added early, no matter what the caller's own gating missed or what changed
// underneath it since the Add Week modal was opened.
export function addRecoveryWeekCore(storage, { blockId, noteId }) {
  return runGuardedRecoveryAction({ blockId, noteId }, async () => {
    const ordered = await storage.loadRecoveryWeeksForBlock(blockId);
    const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
    if (current && !current.completed_at) {
      return { ok: false, code: 'WEEK_NOT_COMPLETE', error: 'Complete the current week before adding the next one.' };
    }
    try {
      const week = await storage.addRecoveryWeek({ blockId, noteId });
      return { ok: true, week };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not add the next recovery week.' };
    }
  });
}

// Create a brand-new workout note AND attach it as the next sequential week, as
// one durable journaled operation.
//
// Both the note id and the week ordinal are minted exactly once here, inside the
// journal's single-flight lock, and recorded on the intent before anything is
// written. A replay writes those same seeds, so no retry can mint a second note
// or a second ordinal, and no two same-tick confirms can create competing notes.
export function addRecoveryWeekWithNewNoteCore(storage, { blockId, title }) {
  return startRecoveryOperation({
    // Scoped on the block alone at start time: the note and week ids do not exist
    // yet, so nothing else can be holding them. Once journaled, the record's own
    // note_id/week_id are what block a conflicting linked-note delete.
    scope: { blockId },
    validate: async () => {
      const blocks = await storage.loadRecoveryBlocksRaw();
      const block = blocks.find(b => b.id === blockId);
      if (!block || !isLiveRecord(block) || block.completed_at) {
        return { ok: false, code: 'BLOCK_NOT_ACTIVE', error: 'No active recovery block to add a week to.' };
      }
      const weeks = await storage.loadRecoveryBlockWeeksRaw();
      const ordered = orderedLiveWeeks(weeks, blockId);
      const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
      if (current && !current.completed_at) {
        return { ok: false, code: 'WEEK_NOT_COMPLETE', error: 'Complete the current week before adding the next one.' };
      }

      const requestedCreatedAt = new Date().toISOString();
      // `raw_text` is deliberately empty: the seed persisted in the journal holds
      // the title the user typed and no workout-note text.
      const noteSeed = { ...makeWorkoutNoteItem({ title, raw_text: '' }), raw_text: '' };
      const weekSeed = buildRecoveryWeek({
        blockId,
        noteId: noteSeed.id,
        weekNumber: nextWeekNumber(weeks, blockId),
        now: requestedCreatedAt,
      });
      return {
        ok: true,
        intent: {
          type: RECOVERY_OPERATION_TYPES.ADD_WEEK_WITH_NEW_NOTE,
          block_id: blockId,
          week_id: weekSeed.id,
          note_id: noteSeed.id,
          requested_created_at: requestedCreatedAt,
          note_seed: noteSeed,
          week_seed: weekSeed,
          intended_outcome: `new workout note ${noteSeed.id} exists and is linked to block ${blockId} as week ${weekSeed.week_number}`,
        },
        noteSeed,
        weekSeed,
      };
    },
  }).then(result => (result.ok && result.week === undefined
    ? { ...result, week: result.week_id ? { id: result.week_id, block_id: result.block_id, note_id: result.note_id } : null }
    : result));
}

// Complete the block's current (still-open) week and the block itself as one
// atomic storage operation (storage/entries/recoveryStorage.js
// completeRecoveryBlockWithCurrentWeek): either both land, or neither does.
// A completed block with an open week is never observable: a failed block write
// reverts the week write first. A `RecoveryReconciliationError` (the revert also
// failed) keeps its own code, so "cleanly failed, retry" differs from "needs
// manual reconciliation".
export function completeRecoveryBlockCore(storage, { blockId }) {
  return startRecoveryOperation({
    scope: { blockId },
    // Step 1: validate against persisted state. Every rejection below happens
    // before any journal record or domain write exists, which is what makes
    // "cancellation and validation failures write nothing" provable.
    validate: async () => {
      const blocks = await storage.loadRecoveryBlocksRaw();
      const block = blocks.find(b => b.id === blockId);
      if (!block || block.deleted_at) {
        return { ok: false, code: 'BLOCK_NOT_FOUND', error: `No recovery block with id ${blockId}.` };
      }
      const ordered = orderedLiveWeeks(await storage.loadRecoveryBlockWeeksRaw(), blockId);
      const current = ordered.length > 0 ? ordered[ordered.length - 1] : null;
      const openWeek = current && !current.completed_at ? current : null;

      // Already in the requested final state: no intent, no writes, no
      // timestamp churn. Replay of a real record reaches the same conclusion.
      if (block.completed_at && !openWeek) {
        return { ok: true, skip: true, result: { block } };
      }

      // One immutable requested timestamp, reused by every replay, so the block
      // and its current week always converge to the SAME stable completed_at no
      // matter how many attempts it takes.
      const requestedCompletedAt = new Date().toISOString();
      return {
        ok: true,
        intent: {
          type: RECOVERY_OPERATION_TYPES.COMPLETE_BLOCK_WITH_WEEK,
          block_id: blockId,
          week_id: openWeek ? openWeek.id : null,
          note_id: null,
          requested_completed_at: requestedCompletedAt,
          intended_outcome: openWeek
            ? 'block and its open current week both completed at the requested timestamp'
            : 'block completed at the requested timestamp',
        },
      };
    },
  }).then(async (result) => {
    if (!result.ok) return result;
    // Postconditions are verified; re-read the block so the caller reports what
    // is actually persisted rather than what it hoped to write.
    if (result.block) return result;
    try {
      const blocks = await storage.loadRecoveryBlocksRaw();
      return { ...result, block: blocks.find(b => b.id === blockId) || null };
    } catch {
      return result;
    }
  });
}

// Reopen the newest completed block (#839): reactivates only the block —
// every week's completion state is untouched, matching
// storage.uncompleteRecoveryBlock's own contract. Unlike completeBlock this
// touches one collection, so it stays a plain guarded action (the same shape
// as setRecoveryNormalAnalyticsInclusionCore) rather than a journaled
// multi-record operation. Every eligibility check — live, completed, newest
// completed, no other block active — is enforced by
// storage.uncompleteRecoveryBlock itself before any write, so a rejection
// here is provably a no-op. It runs under the SAME process-wide lock
// `startRecoveryBlockCore` uses, which is what serializes Start and Reopen.
export function reopenRecoveryBlockCore(storage, { blockId }) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    try {
      const block = await storage.uncompleteRecoveryBlock(blockId);
      return { ok: true, block };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not reopen this recovery block.' };
    }
  });
}

// Unlink one week membership. Restricted to the latest live week of a still
// -active block — earlier/history weeks, and any week of a block that has
// since completed, keep the ordinal sequence gap-free and stable, so unlinking
// them is refused rather than silently reordering anything.
export function unlinkRecoveryWeekCore(storage, { blockId, weekId }) {
  return runGuardedRecoveryAction({ blockId, weekId }, async () => {
    const [blocks, ordered] = await Promise.all([
      storage.loadRecoveryBlocks(),
      storage.loadRecoveryWeeksForBlock(blockId),
    ]);
    const block = blocks.find(b => b.id === blockId);
    const latest = ordered.length > 0 ? ordered[ordered.length - 1] : null;
    if (!block || !isBlockActive(block) || !latest || latest.id !== weekId) {
      return { ok: false, code: 'NOT_LATEST_WEEK', error: 'Only the most recent week of an active block can be unlinked.' };
    }
    try {
      await storage.deleteRecoveryWeek(weekId);
      return { ok: true };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not unlink this week.' };
    }
  });
}

// Delete a workout note that is (or may be) a recovery week, as one durable
// journaled operation.
//
// This applies uniformly to any linked week — active or completed-history —
// unlike the position-restricted explicit Unlink action above.
//
// The single roll-forward outcome is: membership tombstoned AND note deleted
// (absent locally, tombstoned plus durable pending-sync intent in cloud mode).
// There is no rollback path, deliberately: a `deleteNote` that persisted the
// removal and then threw is indistinguishable from one that never committed, so
// restoring the membership could point a live week at an already-gone note.
// Replay always converges toward the recorded deletion, and the journal record
// is retained until both postconditions are read back from storage.
//
// A note with NO live membership is a single-domain delete: no journal record
// is written, because there is no second collection to keep consistent.
export function unlinkNoteForDeleteCore(storage, { noteId }) {
  return startRecoveryOperation({
    scope: { noteId },
    validate: async () => {
      const weeks = await storage.loadRecoveryBlockWeeks();
      const membership = findLiveMembershipForNote(weeks, noteId);
      if (!membership) {
        try {
          await deleteNoteViaJournalOperations(noteId);
        } catch (e) {
          return { ok: false, code: RECOVERY_OPERATION_CODES.OPERATION_FAILED, reason: 'NOTE_DELETE_FAILED', error: e?.message || 'Could not delete this note.' };
        }
        return { ok: true, skip: true, result: { week: null } };
      }
      return {
        ok: true,
        intent: {
          type: RECOVERY_OPERATION_TYPES.DELETE_LINKED_NOTE,
          block_id: membership.block_id,
          week_id: membership.id,
          note_id: noteId,
          requested_deleted_at: new Date().toISOString(),
          intended_outcome: 'recovery week membership tombstoned and workout note deleted',
        },
        membership,
      };
    },
  }).then((result) => (result.ok && result.week === undefined
    ? { ...result, week: result.week_id ? { id: result.week_id, note_id: result.note_id } : null }
    : result));
}

// Set one block's `include_in_normal_analytics` preference (#699).
//
// Guarded like every other recovery mutation so a toggle cannot land while a
// journaled operation over the same block is still unresolved. It writes no
// journal record of its own: a single-field patch on a single collection has no
// second record whose partial write would need rolling forward.
//
// `updateRecoveryBlock` strips every immutable field (BLOCK_IMMUTABLE_FIELDS),
// so the frozen baseline, lifecycle timestamps, and record identity are
// untouched — and no workout note is rewritten. Completed blocks are patchable
// on purpose: reviewing a finished recovery and deciding it should count is a
// legitimate action.
export function setRecoveryNormalAnalyticsInclusionCore(storage, { blockId, include }) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    try {
      const block = await storage.updateRecoveryBlock(blockId, {
        include_in_normal_analytics: include === true,
      });
      return { ok: true, block };
    } catch (e) {
      return {
        ok: false,
        code: e?.code || null,
        error: e?.message || 'Could not change this block’s analytics setting.',
      };
    }
  });
}

// Edit (or clear) one block's optional `reason` (#872). Guarded and journal-free
// for the same reasons as the inclusion preference above.
//
// `updateRecoveryBlock` normalizes the text and strips every immutable field, so
// this changes no baseline, membership, note, fatigue check-in, week ordinal, or
// lifecycle timestamp — and a patch whose normalized reason already matches the
// stored one does not even stamp `updated_at`. Completed blocks are editable on
// purpose: naming a past injury correctly is a legitimate review action.
export function setRecoveryBlockReasonCore(storage, { blockId, reason }) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    try {
      const block = await storage.updateRecoveryBlock(blockId, { reason });
      return { ok: true, block };
    } catch (e) {
      return {
        ok: false,
        code: e?.code || null,
        error: e?.message || 'Could not save this block’s reason.',
      };
    }
  });
}

// Explicit v1 -> v2 baseline rebuild (#1227). Inside the same guarded lock as every
// other Recovery edit it re-reads the authoritative block + exact baseline note,
// re-plans with the v2 capture, and replaces ONLY `baseline`. Stale/ineligible
// state (v2, tombstone, note gone/unreadable) or a snapshot that differs from the
// previewed `expectedBaseline` writes nothing.
export function rebuildRecoveryBaselineCore(storage, { blockId, expectedBaseline }) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    try {
      const block = (await storage.loadRecoveryBlocks()).find(b => b.id === blockId);
      const notes = await storage.loadWorkoutNotes();
      const plan = planBaselineRebuild(block, notes.find(n => n.id === block?.baseline_note_id));
      if (!plan.eligible) return { ok: false, error: plan.message };
      if (JSON.stringify(plan.baseline) !== JSON.stringify(expectedBaseline)) {
        return { ok: false, error: 'The routine changed since this preview. Review the updated values and try again.' };
      }
      const updated = await storage.replaceRecoveryBlockBaseline(blockId, plan.baseline);
      return { ok: true, block: updated };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not rebuild this baseline.' };
    }
  });
}

export function useRecoveryBlockLifecycle() {
  const completeCurrentWeek = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await completeCurrentWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const uncompleteCurrentWeek = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await uncompleteCurrentWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const addWeek = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await addRecoveryWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const addWeekWithNewNote = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await addRecoveryWeekWithNewNoteCore(RecoveryStorage, params);
    if (result.ok) {
      notifyRecoveryBlocks();
      // This also writes the notebook: mounted note instances reload after the verified result.
      reloadWorkoutNotes();
    }
    return result;
  }, []);
  const completeBlock = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await completeRecoveryBlockCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const reopenBlock = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await reopenRecoveryBlockCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const unlinkWeek = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await unlinkRecoveryWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const unlinkNoteForDelete = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await unlinkNoteForDeleteCore(RecoveryStorage, params);
    if (result.ok) {
      notifyRecoveryBlocks();
      // This operation is the one that also changes the notebook. Reload (not
      // refresh) every mounted workout-note instance so the deleted note leaves
      // the Log tab without re-entering cloud sync from inside a lifecycle
      // action. Step 7: notify only after the verified result.
      reloadWorkoutNotes();
    }
    return result;
  }, []);
  // Step 7 failure side and `Retry recovery`'s engine: the SAME reconciler every gate uses.
  const retryRecovery = useCallback(async () => {
    const result = await reconcileRecoveryOperations();
    notifyRecoveryBlocks();
    reloadWorkoutNotes();
    return result;
  }, []);

  // Inclusion changes no note/baseline: only recovery subscribers refresh.
  const setIncludeInNormalAnalytics = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await setRecoveryNormalAnalyticsInclusionCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);

  // Like inclusion, the reason repaints only the Log/Analytics captions.
  const setBlockReason = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await setRecoveryBlockReasonCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);

  const rebuildBaseline = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await rebuildRecoveryBaselineCore(RebuildStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);

  return { completeCurrentWeek, uncompleteCurrentWeek, addWeek, addWeekWithNewNote, completeBlock, reopenBlock, unlinkWeek, unlinkNoteForDelete, setIncludeInNormalAnalytics, setBlockReason, rebuildBaseline, retryRecovery };
}
