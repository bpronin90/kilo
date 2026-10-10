// Guarded Tidy names action (#1309): two independent, idempotent steps.
//
//   1. baseline: rows whose frozen name carries a descriptor get their clean
//      display name (key/name only; every number, the pair, order, basis and
//      version stay as frozen);
//   2. weeks: each linked header becomes the baseline row's clean name, its own
//      descriptor moves to one `-- ` note, and every note is saved through the
//      ordinary workout-note compare-and-set path (the same mode-aware save/sync
//      path as any edit).
//
// There is deliberately no cross-store transaction. A partial failure leaves some
// lifts visibly unmatched and re-running the action finishes them: both steps
// skip what is already done. Before anything is written the action re-reads the
// authoritative block, weeks and notes under the recovery guard and requires the
// exact plan and evidence captured when the review opened (zero writes if stale).

import { useCallback } from 'react';
import * as Storage from '../../storage/entries';
import { runGuardedRecoveryAction } from '../../storage/entries/recoveryOperationJournal';
import { compareAndSetWorkoutNoteText } from '../../storage/entries/workoutNotes';
import { writeRecoveryBlockBaselineNames } from '../../storage/entries/recoveryBaselineNameStorage';
import { isLiveRecord } from '../../lib/data/recoveryBlocks';
import { planTidyNames } from '../../lib/data/recoveryTidyNames';
import { ensureVerifiedRecoveryState, notifyRecoveryBlocks } from './recoveryReadState';
import { notifyWorkoutNotes } from './workoutNoteHooks';
import { writeVia } from './storageMode';

const STALE = 'These names changed since you opened the review. Review them again.';

const TidyStorage = {
  ...Storage,
  writeBaselineNames: writeRecoveryBlockBaselineNames,
  saveNoteText: (id, expected, next) => writeVia('compareAndSetWorkoutNoteText', compareAndSetWorkoutNoteText, id, expected, next),
};

export function tidyNamesCore(storage, { blockId, evidence, signature } = {}) {
  return runGuardedRecoveryAction({ blockId }, async () => {
    try {
      const block = (await storage.loadRecoveryBlocks()).find(b => b.id === blockId);
      if (!block || !isLiveRecord(block)) return { ok: false, error: 'This recovery block is no longer available.' };
      const weeks = await storage.loadRecoveryBlockWeeks();
      const notes = await storage.loadWorkoutNotes();
      const plan = planTidyNames({ block, weeks, notes });
      if (!plan.ok) return { ok: false, error: plan.error };
      if (!evidence || !signature || plan.evidence !== evidence || plan.signature !== signature) return { ok: false, error: STALE };
      if (plan.empty) return { ok: false, error: 'Names are already tidy. Nothing to change.' };
      if (plan.baseline.length) await storage.writeBaselineNames(blockId, plan.baseline);
      const failed = [];
      for (const w of plan.noteWrites) {
        // eslint-disable-next-line no-await-in-loop
        const status = await storage.saveNoteText(w.note_id, w.expected_raw_text, w.next_raw_text);
        if (status !== 'saved') failed.push(w.week_number);
      }
      if (failed.length) {
        return {
          ok: false,
          partial: true,
          error: `Week ${failed.join(', ')} could not be tidied because the note changed or is unavailable. Run Tidy names again to finish.`,
        };
      }
      return { ok: true, noteCount: plan.noteWrites.length, nameCount: plan.baseline.length };
    } catch (e) {
      return { ok: false, partial: true, error: `${e?.message || 'Tidy names did not finish.'} Run Tidy names again to finish.` };
    }
  });
}

export function useRecoveryTidyNames() {
  const tidyNames = useCallback(async (params) => {
    const gate = await ensureVerifiedRecoveryState();
    if (!gate.ok) return gate;
    const result = await tidyNamesCore(TidyStorage, params);
    // A partial run still changed something; publish so what did land is shown.
    notifyRecoveryBlocks();
    notifyWorkoutNotes();
    return result;
  }, []);
  return { tidyNames };
}
