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
import { findActiveBlock, findLiveMembershipForNote, orderedLiveWeeks } from '../../lib/data/recoveryBlocks';
import { safeNotify } from './shared';
import { SYNC_PHASE, SYNC_STATUS, subscribeSyncState } from '../../storage/syncRecovery';

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

  const refresh = useCallback(() => {
    setError(null);
    Promise.all([Storage.loadRecoveryBlocks(), Storage.loadRecoveryBlockWeeks()])
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

  return { blocks, weeks, activeBlock, recoveryWeekNumberByNoteId, loading, error, refresh };
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

// The block's current week is its single latest live week, if any — the same
// definition `nextWeekNumber` builds off of. No separate "current" flag exists
// or is needed.
function _currentWeek(weeks, blockId) {
  const ordered = orderedLiveWeeks(weeks, blockId);
  return ordered.length > 0 ? ordered[ordered.length - 1] : null;
}

// Complete the block's current week. A no-op (still ok:true) when there is no
// current week or it is already complete — completion is idempotent, matching
// the storage layer's own re-completion contract.
export async function completeCurrentWeekCore(storage, { weeks, blockId }) {
  const current = _currentWeek(weeks, blockId);
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
}

// Attach the next sequential week. Rejects (without calling storage) when the
// current week has not been explicitly completed yet — Week 2+ can never be
// added early, no matter what the caller's own gating missed.
export async function addRecoveryWeekCore(storage, { weeks, blockId, noteId }) {
  const current = _currentWeek(weeks, blockId);
  if (current && !current.completed_at) {
    return { ok: false, code: 'WEEK_NOT_COMPLETE', error: 'Complete the current week before adding the next one.' };
  }
  try {
    const week = await storage.addRecoveryWeek({ blockId, noteId });
    return { ok: true, week };
  } catch (e) {
    return { ok: false, code: e?.code || null, error: e?.message || 'Could not add the next recovery week.' };
  }
}

// Complete the block. If its current week is still open this completes that
// week first — the same idempotent completeCurrentWeekCore the explicit
// "Complete week" action uses — so a block can always be finished in one user
// action without requiring a separate week tap first. Because that first step
// leaves the domain in an already-valid state (a completed week under an
// active block is exactly what "Complete week" alone produces), a failure on
// the second call is safely retryable rather than a corrupt half-transition.
export async function completeRecoveryBlockCore(storage, { weeks, blockId }) {
  const current = _currentWeek(weeks, blockId);
  if (current && !current.completed_at) {
    const weekResult = await completeCurrentWeekCore(storage, { weeks, blockId });
    if (!weekResult.ok) return weekResult;
  }
  try {
    const block = await storage.completeRecoveryBlock(blockId);
    return { ok: true, block };
  } catch (e) {
    return { ok: false, code: e?.code || null, error: e?.message || 'Could not complete the recovery block.' };
  }
}

// Unlink one week membership. Restricted to the latest live week of an active
// block — earlier/history weeks keep the ordinal sequence gap-free and stable,
// so unlinking them is refused rather than silently reordering anything.
export async function unlinkRecoveryWeekCore(storage, { weeks, blockId, weekId }) {
  const ordered = orderedLiveWeeks(weeks, blockId);
  const latest = ordered.length > 0 ? ordered[ordered.length - 1] : null;
  if (!latest || latest.id !== weekId) {
    return { ok: false, code: 'NOT_LATEST_WEEK', error: 'Only the most recent week can be unlinked.' };
  }
  try {
    await storage.deleteRecoveryWeek(weekId);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e?.code || null, error: e?.message || 'Could not unlink this week.' };
  }
}

// Cascade a workout-note deletion to any live recovery-week membership it
// holds, regardless of block state or position — unlike unlinkRecoveryWeekCore
// above, this is not the user choosing to unlink; the note itself is being
// destroyed, so its membership cannot be left dangling no matter which week it
// was. A note with no live membership is a no-op.
export async function unlinkNoteForDeleteCore(storage, { weeks, noteId }) {
  const membership = findLiveMembershipForNote(weeks, noteId);
  if (!membership) return { ok: true, week: null };
  try {
    await storage.deleteRecoveryWeek(membership.id);
    return { ok: true, week: membership };
  } catch (e) {
    return { ok: false, code: e?.code || null, error: e?.message || 'Could not unlink this note from its recovery block.' };
  }
}

export function useRecoveryBlockLifecycle() {
  const completeCurrentWeek = useCallback(async (params) => {
    const result = await completeCurrentWeekCore(Storage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const addWeek = useCallback(async (params) => {
    const result = await addRecoveryWeekCore(Storage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const completeBlock = useCallback(async (params) => {
    const result = await completeRecoveryBlockCore(Storage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const unlinkWeek = useCallback(async (params) => {
    const result = await unlinkRecoveryWeekCore(Storage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);
  const unlinkNoteForDelete = useCallback(async (params) => {
    const result = await unlinkNoteForDeleteCore(Storage, params);
    if (result.ok) notifyRecoveryBlocks();
    return result;
  }, []);

  return { completeCurrentWeek, addWeek, completeBlock, unlinkWeek, unlinkNoteForDelete };
}
