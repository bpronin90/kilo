// Recovery/normal-analytics boundary (#699).
//
// One recovery block carries one authored preference,
// `include_in_normal_analytics`, which decides whether the ordinary workout
// notes linked to that block feed Kilo's ORDINARY cross-note analytics
// (classifications, progressive-overload signals, Kilo Max / fatigue-adjusted
// strength, non-weighted tracked metrics, 1K history and headline, and the Home
// summaries derived from aggregated notes). The default is off, because mixing
// rehab loads into ordinary progression reads as a months-long regression.
//
// Recovery-specific analytics (#697/#698) are unaffected: they always consume
// the block's linked notes directly and never come through this module.
//
// Two invariants make this module the single place the boundary is decided:
//
//   1. Membership is EXACT and LIVE. A note is a recovery note only because a
//      live `kilo_recovery_block_weeks` record names its id. Titles, dates, note
//      content, and the current selection are never consulted — the #692/#695
//      contract, restated here so no consumer re-derives it.
//   2. The decision is per BLOCK, not global. Two completed blocks with
//      different preferences filter their own memberships independently, and a
//      block's frozen baseline note is NOT a member, so the pre-recovery routine
//      always stays in ordinary analytics.
//
// Deload exclusion is orthogonal and stays where it already lives (the
// DELOAD_NOTE_PREFIX filter in analyticsDerivations.js). Turning recovery
// inclusion on only ever re-admits recovery-linked notes; it can never re-admit
// a deload note to a signal that already excludes them, because this module only
// removes notes and never adds any back to a population it was not given.

import { isLiveRecord } from './recoveryBlocks';

const _NO_EXCLUSIONS = Object.freeze(new Set());

// A verified filter that excludes nothing: the recovery records were read and
// no block is withholding anything. Shared frozen instance so consumers can use
// it without invalidating their own memoization every render.
export const EMPTY_RECOVERY_ANALYTICS_FILTER = Object.freeze({
  excludedNoteIds: _NO_EXCLUSIONS,
  isNoteExcluded: () => false,
  filterNotes: (notes) => notes || [],
  hasExclusions: false,
  // The boundary is KNOWN — every consumer may publish ordinary analytics.
  ready: true,
});

// The boundary is NOT known yet: the recovery records have not been read
// successfully even once (first paint, or a cold-start read that failed).
//
// It excludes nothing, because with no records there is no membership to name —
// guessing would be exactly the "hide unrelated ordinary notes" failure the
// module exists to prevent. `ready: false` is what makes that safe: consumers
// must not publish ordinary analytics derived from an unverified population,
// and instead keep showing their loading state until a read succeeds. Save-time
// callers fail closed the same way, by writing no classification at all.
export const PENDING_RECOVERY_ANALYTICS_FILTER = Object.freeze({
  ...EMPTY_RECOVERY_ANALYTICS_FILTER,
  ready: false,
});

// Note ids that must not reach ordinary analytics, given the live recovery
// records.
//
// Failure modes are deliberate and both fail SAFE — safe here means "keep the
// authored default", never "hide something unrelated":
//
//   - A membership naming a block that is missing or tombstoned is an
//     inconsistency (block deletion cascades to its weeks). Its note is
//     excluded, matching the off-by-default preference, rather than silently
//     promoted into ordinary analytics on the strength of a broken record.
//   - A membership with no usable `note_id` excludes nothing at all, so a
//     malformed record can never take an unrelated ordinary note down with it.
//   - A tombstoned membership is not a membership, so a note removed from a
//     block returns to ordinary analytics immediately.
export function deriveRecoveryExcludedNoteIds(blocks, weeks) {
  const excluded = new Set();
  if (!Array.isArray(weeks) || weeks.length === 0) return excluded;

  // Keyed lookup built once: the membership walk below is O(weeks), not
  // O(weeks x blocks).
  const includedBlockIds = new Set();
  for (const block of blocks || []) {
    if (!isLiveRecord(block)) continue;
    if (block.include_in_normal_analytics === true) includedBlockIds.add(block.id);
  }

  for (const week of weeks) {
    if (!isLiveRecord(week)) continue;
    const noteId = week.note_id;
    if (!noteId || typeof noteId !== 'string') continue;
    if (includedBlockIds.has(week.block_id)) continue;
    excluded.add(noteId);
  }
  return excluded;
}

// Build the filter consumers actually use. Every ordinary-analytics surface
// (save-time classification in the Log editor, Home's aggregated dashboard, and
// the Analytics derivations) runs the SAME object over the SAME note list, which
// is what keeps the surfaces from disagreeing.
//
// `ready: false` means the caller has not verified the records yet and must be
// reported as such regardless of what the (necessarily empty) inputs say.
export function buildRecoveryAnalyticsFilter(blocks, weeks, { ready = true } = {}) {
  if (!ready) return PENDING_RECOVERY_ANALYTICS_FILTER;

  const excludedNoteIds = deriveRecoveryExcludedNoteIds(blocks, weeks);
  if (excludedNoteIds.size === 0) return EMPTY_RECOVERY_ANALYTICS_FILTER;

  const isNoteExcluded = (noteId) => !!noteId && excludedNoteIds.has(noteId);
  return {
    excludedNoteIds,
    isNoteExcluded,
    filterNotes: (notes) => (notes || []).filter(note => !isNoteExcluded(note?.id)),
    hasExclusions: true,
    ready: true,
  };
}

// Drop excluded notes from a note list using a raw id set. Kept alongside the
// factory for the callers that already hold the set (screens thread the set
// through memoized derivations rather than the whole filter object).
export function filterNotesForNormalAnalytics(notes, excludedNoteIds) {
  if (!excludedNoteIds || excludedNoteIds.size === 0) return notes || [];
  return (notes || []).filter(note => !(note?.id && excludedNoteIds.has(note.id)));
}
