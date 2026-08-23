// Active training context (#868, Zero Friction F5).
//
// One pure derived contract over authoritative workout-note and Recovery state,
// answering "what am I training now?" the same way for Home, Log, and
// Analytics. This module owns no storage of its own — it reads the existing
// `currentId` (workout-note current-routine truth) and the existing Recovery
// snapshot (`useRecoveryBlockState`'s `activeBlock`/`weeks`/`stale`/
// `pendingRecovery`) and derives one consistent answer, never a second copy of
// either.
//
// "Latest open week" is determined structurally from the active block's live
// ordered memberships (`orderedLiveWeeks`), never from note titles, `currentId`,
// or array order — mirroring the same rule `recoveryBlockHooks.js` documents
// for Recovery eligibility.
import { orderedLiveWeeks } from './recoveryBlocks';

export const ACTIVE_TRAINING_STATUS = Object.freeze({
  // The authoritative Recovery read has not verified anything yet (first load,
  // or a first-load failure). Never resolved as "normal".
  LOADING: 'loading',
  UNVERIFIED: 'unverified',
  // A snapshot was verified once, but the latest refresh FAILED, and there is
  // no active block in the last-known-good data. `deriveRecoveryComparison`-
  // style consumers still get last-known-good `activeNoteId`/`baselinePaused`
  // (see below) — this status exists so a caller cannot present that as a
  // freshly-confirmed "normal training" answer (review finding on PR #873: a
  // verified-but-stale snapshot with no active block previously resolved to
  // `NORMAL` and silently dropped the fact that the read had failed).
  STALE: 'stale',
  // A snapshot is verified and current, but a journaled Recovery operation is
  // not yet resolved (`pendingRecovery`), and there is no active block in the
  // data read so far. Same reasoning as `STALE`: a mutation may be about to
  // change what "active block" even means, so this must not present as a
  // confirmed `NORMAL`.
  PENDING: 'pending',
  // No active Recovery block: either recovery was never started, or the most
  // recent block has been explicitly ended. Both converge to the same state —
  // the stored current routine, unpaused — because `findActiveBlock` already
  // excludes completed blocks. Only reachable over a snapshot that is both
  // verified AND current (not stale) AND has no unresolved Recovery operation.
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
  stale: false,
  pending: false,
});

// Pure derivation. Takes the exact fields `useRecoveryBlockState()` already
// publishes (`ready`, `loading`, `stale`, `pendingRecovery`, `activeBlock`,
// `weeks`) plus the workout-note `currentId`, and returns one deterministic
// context. No persistence or mutation side effects.
//
// `stale` and `pendingRecovery` are propagated onto every branch of the
// result (not just the ones that override `status`), so a caller showing an
// active Recovery week from a stale or pending read can still render that
// caveat rather than losing it the moment `activeBlock` is non-null.
export function deriveActiveTrainingContext({
  currentId = null,
  recoveryReady = false,
  recoveryLoading = false,
  recoveryStale = false,
  pendingRecovery = [],
  activeBlock = null,
  weeks = [],
} = {}) {
  // A read that is not yet verified — a first load in flight, or a terminal
  // first-load failure — is unknown, not normal.
  if (!recoveryReady) {
    return {
      ...EMPTY_CONTEXT,
      status: recoveryLoading ? ACTIVE_TRAINING_STATUS.LOADING : ACTIVE_TRAINING_STATUS.UNVERIFIED,
    };
  }

  const isStale = !!recoveryStale;
  const isPending = (pendingRecovery || []).length > 0;

  if (!activeBlock) {
    // Verified-but-unreliable AND nothing active in what was read: this must
    // not be presented as a confirmed "normal training" answer (the specific
    // gap flagged on PR #873) — but the last-known-good shape (current note
    // active/baseline, unpaused) is still the best available answer, so it is
    // still returned, just under a status that says so.
    if (isStale) {
      return {
        status: ACTIVE_TRAINING_STATUS.STALE,
        activeNoteId: currentId,
        baselineNoteId: currentId,
        baselinePaused: false,
        recoveryWeekNumber: null,
        nextAction: null,
        activeBlock: null,
        stale: true,
        pending: isPending,
      };
    }
    if (isPending) {
      return {
        status: ACTIVE_TRAINING_STATUS.PENDING,
        activeNoteId: currentId,
        baselineNoteId: currentId,
        baselinePaused: false,
        recoveryWeekNumber: null,
        nextAction: null,
        activeBlock: null,
        stale: false,
        pending: true,
      };
    }
    return {
      status: ACTIVE_TRAINING_STATUS.NORMAL,
      activeNoteId: currentId,
      baselineNoteId: currentId,
      baselinePaused: false,
      recoveryWeekNumber: null,
      nextAction: null,
      activeBlock: null,
      stale: false,
      pending: false,
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
      stale: isStale,
      pending: isPending,
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
    stale: isStale,
    pending: isPending,
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
