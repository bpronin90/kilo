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
import { findActiveBlock, findLiveMembershipForNote } from '../../lib/data/recoveryBlocks';
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
