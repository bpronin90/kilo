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
import { findActiveBlock, isBlockActive, isLiveRecord, orderedLiveWeeks } from './recoveryBlocks';

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

// Local-first display (#1366). While the first authoritative (reconciled) read
// is still pending, a bounded plain read of the persisted blocks/weeks may
// supply the last-known mode. It can reflect a half-applied journal operation
// or a malformed record, so it is used only when every identity in it is
// unambiguous and the active block's weeks line up:
//   - every block and week is a record with a non-empty string id, unique
//     among its kind, and every field the mode decision reads is well-typed:
//     lifecycle markers (`completed_at`, `deleted_at`) absent/null or a
//     parseable timestamp, `baseline_note_id` a non-empty string, the
//     inclusion preference a boolean if set;
//   - at most one active block;
//   - every live week has non-empty block/note ids, a positive integer week
//     number, belongs to a LIVE block, and is not that block's own baseline
//     note (storage's NOTE_IS_BASELINE rule);
//   - at most one live membership per note;
//   - every live block's live weeks have unique numbers, and the active
//     block has no open week before its latest.
// Anything else is unknown — never a guessed week and never a fallback to
// normal.
const isId = v => typeof v === 'string' && v.length > 0;
const hasUniqueIds = records => records.every(r => r && isId(r.id))
  && new Set(records.map(r => r.id)).size === records.length;
const isMarker = v => v == null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
const hasMarkers = r => isMarker(r.completed_at) && isMarker(r.deleted_at);
const isWellTypedBlock = b => hasMarkers(b) && isId(b.baseline_note_id)
  && (b.include_in_normal_analytics === undefined || typeof b.include_in_normal_analytics === 'boolean');
const isWellTypedWeek = w => !!w && isId(w.id) && hasMarkers(w) && isId(w.block_id) && isId(w.note_id)
  && Number.isSafeInteger(w.week_number) && w.week_number >= 1;

// The storage readers drop any record whose `deleted_at` is truthy before the
// selector sees it, so a malformed tombstone marker would vanish rather than
// read as unknown. This checks the RAW persisted lists, tombstones included.
// Shape only — cross-record consistency is #1368's (repair first, then enforce).
export function arePersistedRecoveryRecordsWellFormed(rawBlocks, rawWeeks) {
  return Array.isArray(rawBlocks) && Array.isArray(rawWeeks)
    && rawBlocks.every(b => b && isId(b.id) && isWellTypedBlock(b))
    && rawWeeks.every(isWellTypedWeek);
}

// Cross-record consistency shared by the provisional display selector and the
// authoritative classifier (#1368). It does NOT include the earlier-open-week
// rule: that state is reachable through ordinary use (uncompleting an earlier
// week) so it is no authoritative gate, only a provisional-display one.
function isSnapshotStructurallyConsistent(blocks, weeks) {
  if (!hasUniqueIds(blocks) || !hasUniqueIds(weeks)) return false;
  if (!blocks.every(isWellTypedBlock) || !weeks.every(hasMarkers)) return false;
  if (blocks.filter(isBlockActive).length > 1) return false;
  const liveBlocks = new Map(blocks.filter(isLiveRecord).map(b => [b.id, b]));
  const live = weeks.filter(isLiveRecord);
  const wellFormed = live.every(w => isId(w.block_id) && isId(w.note_id)
    && Number.isSafeInteger(w.week_number) && w.week_number >= 1 && liveBlocks.has(w.block_id)
    && w.note_id !== liveBlocks.get(w.block_id).baseline_note_id);
  if (!wellFormed || new Set(live.map(w => w.note_id)).size !== live.length) return false;
  // Ordinals are unique per block, completed blocks included.
  return new Set(live.map(w => `${w.block_id}|${w.week_number}`)).size === live.length;
}

// Authoritative classifier over WELL-FORMED raw lists (tombstones included)
// (#1368). Names the ids to exclude from operational state: duplicate ids,
// several active blocks, a live week without a live parent, a baseline-note
// membership, duplicate note or ordinal. Records stay persisted untouched.
//
// Timestamps are not classified here: the server columns are nullable, and no
// operational decision reads them except the winner policy, which only compares
// `started_at`/`saved_at` inside groups this classifier already excludes whole
// (several active blocks; duplicate note/ordinal groups). The shared helpers
// refuse to pick a winner from an unparseable timestamp (syncRecoveryResolution).
//
// An earlier open week is deliberately NOT unresolved: per-row LWW sync can
// produce it from ordinary use (device A completes week 1 and adds week 2 while
// device B reopens week 1), so it is a valid, reachable state.
//
// Result: `unresolvedCount`; `modeRelevant` (an unresolved record could change
// the operational answer: any unresolved block that is or could be active, a
// duplicate block id, or an unresolved week of the operative active block);
// and `scope`, what unresolved records touch, for dependent-mutation gating.
export function partitionRecoveryRecords(rawBlocks, rawWeeks) {
  const dupIds = (list) => {
    const seen = new Set();
    const dups = new Set();
    for (const r of list) (seen.has(r.id) ? dups : seen).add(r.id);
    return dups;
  };
  const dupB = dupIds(rawBlocks);
  const dupW = dupIds(rawWeeks);
  const live = rawBlocks.filter(b => isLiveRecord(b) && !dupB.has(b.id));
  const active = live.filter(isBlockActive);
  const blocks = active.length > 1 ? live.filter(b => !isBlockActive(b)) : live;
  const blockById = new Map(blocks.map(b => [b.id, b]));
  let weeks = rawWeeks.filter(w => isLiveRecord(w) && !dupW.has(w.id)
    && blockById.has(w.block_id) && w.note_id !== blockById.get(w.block_id).baseline_note_id);
  for (const keyOf of [w => w.note_id, w => `${w.block_id}|${w.week_number}`]) {
    const counts = new Map();
    for (const w of weeks) counts.set(keyOf(w), (counts.get(keyOf(w)) || 0) + 1);
    weeks = weeks.filter(w => counts.get(keyOf(w)) === 1);
  }
  const keptB = new Set(blocks.map(b => b.id));
  const keptW = new Set(weeks.map(w => w.id));
  const badBlocks = rawBlocks.filter(b => dupB.has(b.id) || (isLiveRecord(b) && !keptB.has(b.id)));
  const badWeeks = rawWeeks.filter(w => dupW.has(w.id) || (isLiveRecord(w) && !keptW.has(w.id)));
  const operativeId = findActiveBlock(blocks)?.id;
  const scope = {
    blockIds: new Set([...badBlocks.map(b => b.id), ...badWeeks.map(w => w.block_id)]),
    weekIds: new Set(badWeeks.map(w => w.id)),
    noteIds: new Set(badWeeks.map(w => w.note_id)),
    slots: new Set(badWeeks.map(w => `${w.block_id}|${w.week_number}`)),
  };
  const excludedBlockIds = new Set(badBlocks.map(b => b.id));
  const excludedWeekIds = scope.weekIds;
  return {
    excludedBlockIds,
    excludedWeekIds,
    unresolvedCount: excludedBlockIds.size + excludedWeekIds.size,
    modeRelevant: dupB.size > 0 || badBlocks.some(b => !b.completed_at)
      || (!!operativeId && badWeeks.some(w => w.block_id === operativeId)),
    scope,
  };
}

// Dependent-action gate (#1368) over a partition result: a mutation is blocked
// only when it targets an unresolved record or something related to one (same
// block id, week id, note id, or reserved ordinal slot). A `global` decision
// (starting a block) is blocked only when unresolved data could change the
// mode. `target` = { blockId?, weekId?, noteId?, slot?, global? }.
export function isRecoveryTargetBlocked(part, target) {
  if (!part || part.unresolvedCount === 0) return false;
  if (!target) return true;
  if (target.global) return !!part.modeRelevant;
  const scope = part.scope;
  return (!!target.blockId && scope.blockIds.has(target.blockId))
    || (!!target.weekId && scope.weekIds.has(target.weekId))
    || (!!target.noteId && scope.noteIds.has(target.noteId))
    || (!!target.slot && scope.slots.has(target.slot));
}

export function isRecoveryDataResolved(rawBlocks, rawWeeks) {
  return arePersistedRecoveryRecordsWellFormed(rawBlocks, rawWeeks)
    && partitionRecoveryRecords(rawBlocks, rawWeeks).unresolvedCount === 0;
}

function isProvisionalSnapshotConsistent(blocks, weeks) {
  if (!isSnapshotStructurallyConsistent(blocks, weeks)) return false;
  const activeBlock = findActiveBlock(blocks);
  if (!activeBlock) return true;
  return orderedLiveWeeks(weeks, activeBlock.id).slice(0, -1).every(w => !!w.completed_at);
}

export function selectProvisionalRecovery(provisional) {
  if (!provisional) return null;
  const { blocks, weeks } = provisional;
  const consistent = Array.isArray(blocks) && Array.isArray(weeks)
    && isProvisionalSnapshotConsistent(blocks, weeks);
  return consistent
    ? { consistent, activeBlock: findActiveBlock(blocks), weeks }
    : { consistent: false, activeBlock: null, weeks: [] };
}

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
  provisional = null,
} = {}) {
  // A read that is not yet verified — a first load in flight, or a terminal
  // first-load failure — is unknown, not normal. A consistent provisional read
  // (#1366, only offered while the first authoritative read is pending) answers
  // with the last-known mode, flagged `provisional`; an inconsistent one is
  // UNVERIFIED so the caller shows unknown rather than waiting or guessing.
  if (!recoveryReady) {
    const local = recoveryLoading ? selectProvisionalRecovery(provisional) : null;
    if (local && local.consistent) {
      return {
        ...deriveActiveTrainingContext({
          currentId, recoveryReady: true, activeBlock: local.activeBlock, weeks: local.weeks,
        }),
        provisional: true,
      };
    }
    return {
      ...EMPTY_CONTEXT,
      status: recoveryLoading && !local ? ACTIVE_TRAINING_STATUS.LOADING : ACTIVE_TRAINING_STATUS.UNVERIFIED,
      ...(local ? { provisional: true } : {}),
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
