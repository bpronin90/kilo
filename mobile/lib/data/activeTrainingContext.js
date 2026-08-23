// Active training context (#868, Zero Friction F5).
//
// One pure derived contract over authoritative workout-note and Recovery state,
// answering "what am I training now?" the same way for Home, Log, and
// Analytics. This module owns no storage of its own — it reads the existing
// `currentId` (workout-note current-routine truth) and the existing Recovery
// snapshot (`useRecoveryBlockState`'s `activeBlock`/`weeks`) and derives one
// consistent answer, never a second copy of either.
//
// "Latest open week" is determined structurally from the active block's live
// ordered memberships (`orderedLiveWeeks`), never from note titles, `currentId`,
// or array order — mirroring the same rule `recoveryBlockHooks.js` documents
// for Recovery eligibility.
import { orderedLiveWeeks } from './recoveryBlocks';

export const ACTIVE_TRAINING_STATUS = Object.freeze({
  // The authoritative Recovery read has not verified anything yet (first load,
  // or a first-load failure). Never resolved as "normal" — see acceptance
  // criteria: an unverified/pending/stale/failed Recovery read must never be
  // interpreted as normal training.
  LOADING: 'loading',
  UNVERIFIED: 'unverified',
  // No active Recovery block: either recovery was never started, or the most
  // recent block has been explicitly ended. Both converge to the same state —
  // the stored current routine, unpaused — because `findActiveBlock` already
  // excludes completed blocks.
  NORMAL: 'normal',
  // An active Recovery block with a latest live week that is still open.
  RECOVERY_OPEN_WEEK: 'recovery_open_week',
  // An active Recovery block with no open week right now: either the latest
  // week was just completed, or no week has been attached yet. The next
  // action is always "add the next week" or "end Recovery" — never "resume
  // training as normal" while the block itself is still active.
  RECOVERY_BETWEEN_WEEKS: 'recovery_between_weeks',
});

const EMPTY_CONTEXT = Object.freeze({
  status: ACTIVE_TRAINING_STATUS.UNVERIFIED,
  activeNoteId: null,
  baselineNoteId: null,
  baselinePaused: null,
  recoveryWeekNumber: null,
  nextAction: null,
  activeBlock: null,
});

// Pure derivation. Takes the exact fields `useRecoveryBlockState()` already
// publishes (`ready`, `loading`, `stale`, `activeBlock`, `weeks`) plus the
// workout-note `currentId`, and returns one deterministic context. No
// persistence or mutation side effects.
export function deriveActiveTrainingContext({
  currentId = null,
  recoveryReady = false,
  recoveryLoading = false,
  activeBlock = null,
  weeks = [],
} = {}) {
  // A read that is not yet verified — including a stale-over-nothing first
  // load, or a terminal first-load failure — is unknown, not normal. `stale`
  // and `refreshing` are both "verified" per the Recovery state contract
  // (last-known-good stays authoritative), so they fall through to the
  // ordinary derivation below rather than here.
  if (!recoveryReady) {
    return {
      ...EMPTY_CONTEXT,
      status: recoveryLoading ? ACTIVE_TRAINING_STATUS.LOADING : ACTIVE_TRAINING_STATUS.UNVERIFIED,
    };
  }

  if (!activeBlock) {
    return {
      status: ACTIVE_TRAINING_STATUS.NORMAL,
      activeNoteId: currentId,
      baselineNoteId: currentId,
      baselinePaused: false,
      recoveryWeekNumber: null,
      nextAction: null,
      activeBlock: null,
    };
  }

  const ordered = orderedLiveWeeks(weeks, activeBlock.id);
  const latest = ordered.length > 0 ? ordered[ordered.length - 1] : null;
  const openWeek = latest && !latest.completed_at ? latest : null;

  if (openWeek) {
    return {
      status: ACTIVE_TRAINING_STATUS.RECOVERY_OPEN_WEEK,
      activeNoteId: openWeek.note_id,
      baselineNoteId: activeBlock.baseline_note_id,
      baselinePaused: true,
      recoveryWeekNumber: openWeek.week_number,
      nextAction: null,
      activeBlock,
    };
  }

  return {
    status: ACTIVE_TRAINING_STATUS.RECOVERY_BETWEEN_WEEKS,
    activeNoteId: null,
    baselineNoteId: activeBlock.baseline_note_id,
    baselinePaused: true,
    recoveryWeekNumber: latest ? latest.week_number : null,
    nextAction: 'add_week_or_end_recovery',
    activeBlock,
  };
}

// Resolves the derived context's note ids against an actual notes array, so
// consumers get the note objects (or `null` when a linked note is missing or
// deleted) instead of doing their own lookup — and cannot disagree about what
// "missing" means.
export function resolveActiveTrainingContext({ currentId = null, notes = [], ...recoveryState } = {}) {
  const context = deriveActiveTrainingContext({ currentId, ...recoveryState });
  const findNote = (id) => (id ? (notes || []).find(n => n.id === id) ?? null : null);
  return {
    ...context,
    activeNote: findNote(context.activeNoteId),
    baselineNote: findNote(context.baselineNoteId),
  };
}
