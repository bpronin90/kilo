// Recovery-block Log-screen hooks (#695).
//
// Wraps storage/entries/recoveryStorage.js for the smallest usable flow: select
// a baseline routine, then create-or-attach one ordinary note as Recovery Week
// 1. Week 2+, completion, browsing, and analytics are explicitly out of scope
// (later issues) — this file only ever creates a block and adds exactly one
// week.
//
// Eligibility is purely structural (findLiveMembershipForNote / the block's
// baseline_note_id), never inferred from note titles, dates, or content — with
// one exception: the pre-existing deload-note convention (title prefix) is
// reused as-is rather than re-derived, since it is not a recovery inference.

import { useState, useEffect, useCallback } from 'react';
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
  findActiveBlock,
  findLiveMembershipForNote,
  isBlockActive,
  isLiveRecord,
  nextWeekNumber,
  orderedLiveWeeks,
} from '../../lib/data/recoveryBlocks';
import { makeWorkoutNoteItem } from '../../lib/data';
import { safeNotify } from './shared';
import { SYNC_PHASE, SYNC_STATUS, subscribeSyncState } from '../../storage/syncRecovery';
// Imported for its module-load side effect as well as nothing else: it
// registers the mode-aware note-deletion operations into the recovery journal
// (see hooks/entries/storageMode.js). Without it the journal would fall back to
// its local-only default even in cloud mode.
import './storageMode';
import { reloadWorkoutNotes } from './workoutNoteHooks';

const RecoveryStorage = Storage;

let recoveryListeners = [];
const notifyRecoveryBlocks = () => safeNotify(recoveryListeners);

// Read-model for the Log screen: the active block (if any), every live week
// membership, and a note-id -> week-number lookup for the active block's own
// weeks (badge display never reaches into a completed/other block).
export function useRecoveryBlockState() {
  const [blocks, setBlocks] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Journaled operations that are not yet verified (#696). Recovery lifecycle
  // state is not considered ready until reconciliation has run, so a resumed
  // operation converges before the user can act on the records it touches.
  const [pendingRecovery, setPendingRecovery] = useState([]);
  const [recoveryPendingError, setRecoveryPendingError] = useState(null);

  const refresh = useCallback(() => {
    setError(null);
    // Reconciliation first, reads second: replaying a pending operation can
    // change what these two reads return, and publishing the pre-replay values
    // would show the user a transition that is about to be completed anyway.
    return reconcileRecoveryOperations()
      .then((reconciliation) => {
        setPendingRecovery(reconciliation.pending || []);
        setRecoveryPendingError(reconciliation.ok ? null : reconciliation.error);
        return Promise.all([Storage.loadRecoveryBlocks(), Storage.loadRecoveryBlockWeeks()]);
      })
      .then(([b, w]) => {
        setBlocks(b);
        setWeeks(w);
      })
      .catch(e => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    recoveryListeners.push(refresh);

    // A completed cloud sync (bootstrap or ongoing) can bring in another
    // device's active block/week records without any local
    // startRecoveryBlockCore call to fire the private `recoveryListeners`
    // notification above. mobile/App.js only reloads workout notes/weight on
    // its automatic-sync callback and tabs stay mounted, so without this the
    // badge/eligibility state here would go stale until an unrelated remount.
    // Subscribing directly to the sync-state broadcast (rather than requiring
    // App.js to know about recovery state) keeps the fix inside this hook.
    let lastSyncStatus = null;
    const handleSyncState = (syncState) => {
      const sync = syncState?.[SYNC_PHASE.SYNC];
      if (sync && sync.status === SYNC_STATUS.COMPLETE && lastSyncStatus !== SYNC_STATUS.COMPLETE) {
        refresh();
      }
      lastSyncStatus = sync ? sync.status : null;
    };
    const unsubscribeSync = subscribeSyncState(handleSyncState);

    return () => {
      recoveryListeners = recoveryListeners.filter(l => l !== refresh);
      unsubscribeSync();
    };
  }, [refresh]);

  const activeBlock = findActiveBlock(blocks);
  const recoveryWeekNumberByNoteId = {};
  if (activeBlock) {
    for (const w of weeks) {
      if (w.block_id === activeBlock.id) recoveryWeekNumberByNoteId[w.note_id] = w.week_number;
    }
  }

  return {
    blocks,
    weeks,
    activeBlock,
    recoveryWeekNumberByNoteId,
    loading,
    error,
    refresh,
    pendingRecovery,
    recoveryPendingError,
    // The `Retry recovery` affordance is deliberately the SAME call the initial
    // mount, the sync boundary, and every pre-action gate make. There is no
    // separate repair algorithm to keep in step.
    retryRecovery: refresh,
  };
}

// True when `note` may serve as a NEW block's frozen baseline: not a deload
// note, and not already a live member (baseline or week) of any block. A note
// may still be reused as a baseline after its old block was deleted — deletion
// tombstones every membership it owned.
export function isEligibleBaselineNote(note, { blocks = [], weeks = [], deloadNotePrefix = null } = {}) {
  if (!note || !note.id) return false;
  if (deloadNotePrefix && note.title?.startsWith(deloadNotePrefix)) return false;
  if (blocks.some(b => b.baseline_note_id === note.id)) return false;
  if (findLiveMembershipForNote(weeks, note.id)) return false;
  return true;
}

// True when `note` may serve as a Recovery Week 1 candidate: not a deload
// note, not any block's frozen baseline, and not already linked to any block.
export function isEligibleRecoveryWeekNote(note, { blocks = [], weeks = [], deloadNotePrefix = null } = {}) {
  return isEligibleBaselineNote(note, { blocks, weeks, deloadNotePrefix });
}

// Create the block, then attach exactly one week. On a Week-1 failure the
// just-created block is rolled back (deleted) so no orphan active block is
// left behind — the two writes must land as one unit from the caller's
// perspective, even though the storage layer does them as two calls.
//
// Extracted from the hook as a plain async function (taking the storage API
// as a parameter) so the rollback path is directly unit-testable with a fake
// storage object, with no React rendering involved.
export async function startRecoveryBlockCore(storage, { baselineNoteId, baselineNoteTitle = null, baselineNoteText = '', weekNoteId }) {
  let block = null;
  try {
    block = await storage.createRecoveryBlock({
      baselineNoteId,
      baselineNoteTitle,
      baselineNoteText,
    });
  } catch (e) {
    return { ok: false, code: e?.code || null, error: e?.message || 'Could not start the recovery block.' };
  }

  try {
    const week = await storage.addRecoveryWeek({ blockId: block.id, noteId: weekNoteId });
    notifyRecoveryBlocks();
    return { ok: true, block, week };
  } catch (e) {
    try {
      await storage.deleteRecoveryBlock(block.id);
    } catch (_rollbackError) {
      // Best-effort rollback; the original failure is what the caller needs
      // to see either way.
    }
    notifyRecoveryBlocks();
    return { ok: false, code: e?.code || null, error: e?.message || 'Could not add Recovery Week 1.' };
  }
}

export function useStartRecoveryBlock() {
  const startBlock = useCallback((params) => startRecoveryBlockCore(Storage, params), []);
  return { startBlock };
}

// ── Week 2+ lifecycle (#696) ──────────────────────────────────────────────────
//
// Every function below is a plain async core (storage passed in, directly unit
// -testable) plus a thin hook wrapper that binds it to the real storage module
// and fires the same module-scope `recoveryListeners` notification the Week-1
// flow uses, so every Log-screen instance stays in sync after a lifecycle
// action lands.
//
// None of these accept a caller-supplied `weeks`/`blocks` snapshot. A native
// confirmation (or the Add Week modal) can sit open for as long as the user
// takes, and a background cloud sync can land new records during that whole
// window — trusting a render-time array captured before the dialog opened
// would let a stale read decide what "the current week" is. Every mutation
// therefore re-reads the relevant records from storage immediately before it
// acts, so it always decides against what is actually persisted right now.

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
// Previously the note was created by the screen BEFORE any lock or journal record
// existed, and a failed attach was undone with a best-effort delete — so two
// failures in a row left an orphan note with no intent to attach or remove it,
// and two same-tick confirms could each create a note before either reached the
// serialized attach. Both the note id and the week ordinal are now minted exactly
// once here, inside the journal's single-flight lock, and recorded on the intent
// before anything is written. A replay writes those same seeds, so no retry can
// mint a second note or a second ordinal.
export function addRecoveryWeekWithNewNoteCore(storage, { blockId, title }) {
  return startRecoveryOperation({
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
// The domain-forbidden combination — a completed block whose current week is
// still open — can never be observed, including when the block write fails
// after its week write already landed, since that write is reverted before
// the error propagates. The one exception is a `RecoveryReconciliationError`:
// the storage layer's own revert write also failed, which is surfaced as its
// own distinct code so the caller can tell "cleanly failed, retry freely"
// apart from "left in an unknown state, needs manual reconciliation" — never
// the same generic error either way.
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
// There is no rollback path, deliberately. A `deleteNote` call that persisted
// the removal and then threw is indistinguishable from one that never
// committed, and a failed verification read is evidence of neither outcome, so
// restoring the membership could point a live week at a note that is already
// gone. Replay always converges toward the recorded deletion, and the journal
// record is retained until both postconditions are read back from storage.
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

export function useRecoveryBlockLifecycle() {
  const completeCurrentWeek = useCallback(async (params) => {
    const result = await completeCurrentWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const addWeek = useCallback(async (params) => {
    const result = await addRecoveryWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const addWeekWithNewNote = useCallback(async (params) => {
    const result = await addRecoveryWeekWithNewNoteCore(RecoveryStorage, params);
    if (result.ok) {
      notifyRecoveryBlocks();
      // This operation also writes the notebook, so every mounted workout-note
      // instance reloads — after the verified result, never before it.
      reloadWorkoutNotes();
    }
    return result;
  }, []);
  const completeBlock = useCallback(async (params) => {
    const result = await completeRecoveryBlockCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const unlinkWeek = useCallback(async (params) => {
    const result = await unlinkRecoveryWeekCore(RecoveryStorage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const unlinkNoteForDelete = useCallback(async (params) => {
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
  // Step 7 for the failure side, and the `Retry recovery` affordance's engine:
  // the SAME reconciler startup, sync, and every pre-action gate use.
  const retryRecovery = useCallback(async () => {
    const result = await reconcileRecoveryOperations();
    notifyRecoveryBlocks();
    reloadWorkoutNotes();
    return result;
  }, []);

  return { completeCurrentWeek, addWeek, addWeekWithNewNote, completeBlock, unlinkWeek, unlinkNoteForDelete, retryRecovery };
}
