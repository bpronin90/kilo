// Confirmed exercise-name match for a frozen recovery baseline (#1298). The core
// runs inside the same guarded recovery lock as every other edit, re-reads the
// authoritative block + weeks + notes, re-plans, and writes ONLY if the exact
// previewed pair is still a unique one-to-one candidate. Notes are never touched.

import { useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { runGuardedRecoveryAction } from '../../storage/entries/recoveryOperationJournal';
import { renameRecoveryBlockBaselineRow } from '../../storage/entries/recoveryStorage';
import { planBaselineNameMatches } from '../../lib/data/recoveryBaselineNames';
import { isLiveRecord } from '../../lib/data/recoveryBlocks';
import { ensureVerifiedRecoveryState, notifyRecoveryBlocks } from './recoveryReadState';

const NameStorage = { ...Storage, renameRecoveryBlockBaselineRow };
const STALE = 'These names changed since you opened the review. Reopen it and try again.';

export function matchBaselineNameCore(storage, { blockId, fromKey, toKey, toName } = {}) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    try {
      const block = (await storage.loadRecoveryBlocks()).find(b => b.id === blockId);
      if (!block || !isLiveRecord(block)) return { ok: false, error: 'This recovery block is no longer available.' };
      const rows = block.baseline?.exercises || [];
      // Already applied: the source row is gone and the target row carries the logged name.
      if (!rows.some(r => r.key === fromKey) && rows.some(r => r.key === toKey && r.name === toName)) {
        return { ok: true, block, noop: true };
      }
      const weeks = await storage.loadRecoveryBlockWeeks();
      const notes = await storage.loadWorkoutNotes();
      const hit = planBaselineNameMatches({ block, weeks, notes })
        .find(c => c.from_key === fromKey && c.to_key === toKey && c.to_name === toName);
      if (!hit) return { ok: false, error: STALE };
      const updated = await storage.renameRecoveryBlockBaselineRow(blockId, { fromKey, toKey, toName });
      return { ok: true, block: updated };
    } catch (e) {
      return { ok: false, code: e?.code || null, error: e?.message || 'Could not match these names.' };
    }
  });
}

export function useRecoveryBaselineNames() {
  const matchBaselineName = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await matchBaselineNameCore(NameStorage, params);
    if (result.ok && !result.noop) notifyRecoveryBlocks();
    return result;
  }, []);
  return { matchBaselineName };
}
