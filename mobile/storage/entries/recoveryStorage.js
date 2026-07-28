// Local persistence for the recovery-block domain (#692).
//
// Two collections, both stored as plain JSON lists behind the shared
// readList/writeList contract:
//
//   kilo_recovery_blocks       — one record per recovery block, carrying the
//                                frozen pre-recovery baseline snapshot
//   kilo_recovery_block_weeks  — ordered membership rows linking ordinary
//                                workout notes to a block
//
// Both follow the workout-note conventions the sync engine already understands:
// stable local ids that survive across devices, `saved_at`/`updated_at`
// timestamps, and `deleted_at` tombstones that are retained for convergence but
// never returned to user-facing readers. The `*Raw` accessors expose the
// unfiltered lists for the later cloud sync engine (#693); local mode never
// uses them.
//
// Cross-record invariants (at most one active block, one live membership per
// note, sequential week numbers) are enforced here because they need to see the
// whole collection. The shape and metric rules live in lib/data/recoveryBlocks.

import { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } from './keys';
import { readList, writeList } from './jsonStorage';
import {
  RECOVERY_ERROR_CODES,
  RecoveryBlockError,
  buildRecoveryBlock,
  buildRecoveryWeek,
  captureRecoveryBaselineFromText,
  findActiveBlock,
  findLiveMembershipForNote,
  isLiveRecord,
  nextWeekNumber,
  orderedLiveWeeks,
} from '../../lib/data/recoveryBlocks';

// Fields a caller may never patch through the generic update APIs. Three
// groups, all of which a naive `update(id, {...wholeRecord})` would otherwise
// rewrite:
//
//   record identity — `id`, `saved_at`, and (for weeks) the `block_id`/`note_id`
//     the membership binds.
//   frozen baseline — `baseline` and `baseline_note_id`. The whole contract is
//     that a later edit to the source routine cannot move the baseline.
//   lifecycle state — `started_at`, `completed_at`, `deleted_at`, and a week's
//     assigned `week_number`. These belong to the explicit
//     complete*/delete*/add* APIs that enforce the domain invariants. Letting a
//     generic patch write them is how a stale record spread into an update
//     reopens a completed block (breaking one-active-block), resurrects a
//     tombstoned membership whose note has since joined another block, or
//     assigns a duplicate/non-positive ordinal that makes week ordering
//     ambiguous for later comparison analytics.
//
// Silently dropping them (rather than throwing) keeps callers that spread a
// whole record into a patch safe.
const BLOCK_IMMUTABLE_FIELDS = [
  'id', 'saved_at',
  'baseline', 'baseline_note_id',
  'started_at', 'completed_at', 'deleted_at',
];
const WEEK_IMMUTABLE_FIELDS = [
  'id', 'saved_at', 'block_id', 'note_id',
  'week_number', 'completed_at', 'deleted_at',
];

function _stripImmutable(patch, fields) {
  const out = { ...(patch || {}) };
  for (const f of fields) delete out[f];
  // `updated_at` is stamped by the writer, never carried in from a patch;
  // accepting a caller's value would let a stale record rewind sync ordering.
  delete out.updated_at;
  return out;
}

// ── recovery blocks ───────────────────────────────────────────────────────────

// User-facing read: live blocks only, newest-started first.
export async function loadRecoveryBlocks() {
  const list = await readList(RECOVERY_BLOCKS_KEY);
  return list
    .filter(isLiveRecord)
    .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
}

// Unfiltered backing list (tombstones and sync metadata included) for the cloud
// sync engine.
export async function loadRecoveryBlocksRaw() {
  return readList(RECOVERY_BLOCKS_KEY);
}

export async function replaceRecoveryBlocksRaw(list) {
  await writeList(RECOVERY_BLOCKS_KEY, Array.isArray(list) ? list : []);
}

export async function getActiveRecoveryBlock() {
  return findActiveBlock(await readList(RECOVERY_BLOCKS_KEY));
}

// Create a block, freezing the baseline from the selected routine's text.
//
// The capture happens here, once, and the result is never recomputed: callers
// pass the routine's raw text, not a promise to re-read it later. Rejects with
// ACTIVE_BLOCK_EXISTS when a block is already running, since "at most one
// active block" is what makes `getActiveRecoveryBlock` unambiguous.
export async function createRecoveryBlock({
  baselineNoteId,
  baselineNoteTitle = null,
  baselineNoteText = '',
  includeInNormalAnalytics = false,
} = {}) {
  const list = await readList(RECOVERY_BLOCKS_KEY);
  const active = findActiveBlock(list);
  if (active) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.ACTIVE_BLOCK_EXISTS,
      `Recovery block ${active.id} is still active; complete or delete it first.`
    );
  }

  const block = buildRecoveryBlock({
    baselineNoteId,
    baselineNoteTitle,
    baseline: captureRecoveryBaselineFromText(baselineNoteText),
    includeInNormalAnalytics,
  });

  list.push(block);
  await writeList(RECOVERY_BLOCKS_KEY, list);
  return block;
}

// Patch a block's mutable presentation fields (today: `baseline_note_title` and
// `include_in_normal_analytics`). Record identity, the frozen baseline, and
// lifecycle state are dropped from the patch rather than applied — see
// BLOCK_IMMUTABLE_FIELDS.
//
// A tombstoned block is rejected outright: a deleted record has no mutable
// state, and allowing a write would let a stale device edit a block the user
// already removed. A completed block is still patchable, because reviewing a
// finished recovery and toggling whether it counts toward normal analytics is a
// legitimate action.
export async function updateRecoveryBlock(id, patch) {
  const list = await readList(RECOVERY_BLOCKS_KEY);
  const idx = list.findIndex(b => b.id === id);
  if (idx < 0) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND,
      `No recovery block with id ${id}.`
    );
  }
  if (!isLiveRecord(list[idx])) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND,
      `Recovery block ${id} is deleted.`
    );
  }

  const effective = _stripImmutable(patch, BLOCK_IMMUTABLE_FIELDS);
  // A patch of nothing but immutable fields is a no-op, not a touch. Stamping a
  // fresh updated_at here would mark the record dirty and hand the sync engine a
  // change to push that carries no content.
  if (Object.keys(effective).length === 0) return list[idx];

  const updated = {
    ...list[idx],
    ...effective,
    updated_at: new Date().toISOString(),
  };
  list[idx] = updated;
  await writeList(RECOVERY_BLOCKS_KEY, list);
  return updated;
}

// Explicitly complete a block. Nothing else in the domain sets `completed_at`:
// no metric, week count, or elapsed time ends a recovery block on its own.
// Re-completing an already-completed block is a no-op that preserves the
// original completion time rather than sliding it forward.
export async function completeRecoveryBlock(id, completedAt = new Date().toISOString()) {
  const list = await readList(RECOVERY_BLOCKS_KEY);
  const idx = list.findIndex(b => b.id === id);
  if (idx < 0) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND,
      `No recovery block with id ${id}.`
    );
  }
  if (!isLiveRecord(list[idx])) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND,
      `Recovery block ${id} is deleted.`
    );
  }
  if (list[idx].completed_at) return list[idx];

  const updated = {
    ...list[idx],
    completed_at: completedAt,
    updated_at: new Date().toISOString(),
  };
  list[idx] = updated;
  await writeList(RECOVERY_BLOCKS_KEY, list);
  return updated;
}

// Tombstone a block and every live membership it owns.
//
// Cascading to the weeks matters for convergence: an orphaned live membership
// would keep a workout note bound to a block that no longer exists, blocking the
// note from joining a new one. Already-tombstoned weeks keep their original
// `deleted_at` so a replayed delete does not churn timestamps.
export async function deleteRecoveryBlock(id) {
  const now = new Date().toISOString();

  const blocks = await readList(RECOVERY_BLOCKS_KEY);
  const idx = blocks.findIndex(b => b.id === id);
  if (idx < 0) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND,
      `No recovery block with id ${id}.`
    );
  }
  if (isLiveRecord(blocks[idx])) {
    blocks[idx] = { ...blocks[idx], deleted_at: now, updated_at: now };
    await writeList(RECOVERY_BLOCKS_KEY, blocks);
  }

  const weeks = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  let touched = false;
  const cascaded = weeks.map(w => {
    if (w.block_id !== id || !isLiveRecord(w)) return w;
    touched = true;
    return { ...w, deleted_at: now, updated_at: now };
  });
  if (touched) await writeList(RECOVERY_BLOCK_WEEKS_KEY, cascaded);

  return blocks[idx];
}

// ── recovery week memberships ─────────────────────────────────────────────────

// User-facing read: live memberships only, ordered by block then week number.
export async function loadRecoveryBlockWeeks() {
  const list = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  return list
    .filter(isLiveRecord)
    .sort((a, b) =>
      String(a.block_id).localeCompare(String(b.block_id)) ||
      a.week_number - b.week_number ||
      String(a.id).localeCompare(String(b.id))
    );
}

export async function loadRecoveryBlockWeeksRaw() {
  return readList(RECOVERY_BLOCK_WEEKS_KEY);
}

export async function replaceRecoveryBlockWeeksRaw(list) {
  await writeList(RECOVERY_BLOCK_WEEKS_KEY, Array.isArray(list) ? list : []);
}

// Ordered live weeks of one block. This is the ordering later comparison
// analytics walk, so it is defined once here rather than at each call site.
export async function loadRecoveryWeeksForBlock(blockId) {
  return orderedLiveWeeks(await readList(RECOVERY_BLOCK_WEEKS_KEY), blockId);
}

// Link an ordinary workout note to a block as its next week.
//
// The week number is assigned by the domain (one past the highest live week),
// never supplied by the caller, so ordinals stay positive, unique within the
// block, and sequential. Rejects when the note already has a live membership —
// including in this same block, which would otherwise create a duplicate — and
// when the note is the block's own frozen baseline routine, which is
// pre-recovery data rather than a recovery week.
export async function addRecoveryWeek({ blockId, noteId } = {}) {
  const blocks = await readList(RECOVERY_BLOCKS_KEY);
  const block = blocks.find(b => b.id === blockId);
  if (!block) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.BLOCK_NOT_FOUND,
      `No recovery block with id ${blockId}.`
    );
  }
  if (!isLiveRecord(block) || block.completed_at) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.BLOCK_NOT_ACTIVE,
      `Recovery block ${blockId} is not active; weeks can only be added to an active block.`
    );
  }
  if (noteId && noteId === block.baseline_note_id) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.NOTE_IS_BASELINE,
      `Workout note ${noteId} is the frozen baseline for block ${blockId} and cannot also be a recovery week.`
    );
  }

  const weeks = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  const existing = findLiveMembershipForNote(weeks, noteId);
  if (existing) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.NOTE_ALREADY_IN_BLOCK,
      `Workout note ${noteId} already belongs to recovery block ${existing.block_id}.`
    );
  }

  const week = buildRecoveryWeek({
    blockId,
    noteId,
    weekNumber: nextWeekNumber(weeks, blockId),
  });

  weeks.push(week);
  await writeList(RECOVERY_BLOCK_WEEKS_KEY, weeks);
  return week;
}

// Patch a membership's mutable fields.
//
// Every field a week record carries today is identity, ordinal, or lifecycle
// state, so this currently accepts no content — it exists as the forward
// -compatible seam for fields later issues add, and it deliberately refuses to
// become a back door around addRecoveryWeek/completeRecoveryWeek/
// deleteRecoveryWeek. Tombstoned memberships are rejected: resurrecting one
// after its note joined another block would put a note in two blocks at once.
export async function updateRecoveryWeek(id, patch) {
  const list = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  const idx = list.findIndex(w => w.id === id);
  if (idx < 0) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.WEEK_NOT_FOUND,
      `No recovery week with id ${id}.`
    );
  }
  if (!isLiveRecord(list[idx])) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.WEEK_NOT_FOUND,
      `Recovery week ${id} is deleted.`
    );
  }

  const effective = _stripImmutable(patch, WEEK_IMMUTABLE_FIELDS);
  if (Object.keys(effective).length === 0) return list[idx];

  const updated = {
    ...list[idx],
    ...effective,
    updated_at: new Date().toISOString(),
  };
  list[idx] = updated;
  await writeList(RECOVERY_BLOCK_WEEKS_KEY, list);
  return updated;
}

// Mark one recovery week done. Like block completion this is explicit, and
// re-completing preserves the original timestamp.
export async function completeRecoveryWeek(id, completedAt = new Date().toISOString()) {
  const list = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  const idx = list.findIndex(w => w.id === id);
  if (idx < 0) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.WEEK_NOT_FOUND,
      `No recovery week with id ${id}.`
    );
  }
  if (!isLiveRecord(list[idx])) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.WEEK_NOT_FOUND,
      `Recovery week ${id} is deleted.`
    );
  }
  if (list[idx].completed_at) return list[idx];

  const updated = {
    ...list[idx],
    completed_at: completedAt,
    updated_at: new Date().toISOString(),
  };
  list[idx] = updated;
  await writeList(RECOVERY_BLOCK_WEEKS_KEY, list);
  return updated;
}

// Tombstone one membership. The workout note itself is untouched — removing a
// note from a recovery block never edits its canonical text.
export async function deleteRecoveryWeek(id) {
  const list = await readList(RECOVERY_BLOCK_WEEKS_KEY);
  const idx = list.findIndex(w => w.id === id);
  if (idx < 0) {
    throw new RecoveryBlockError(
      RECOVERY_ERROR_CODES.WEEK_NOT_FOUND,
      `No recovery week with id ${id}.`
    );
  }
  if (!isLiveRecord(list[idx])) return list[idx];

  const now = new Date().toISOString();
  const updated = { ...list[idx], deleted_at: now, updated_at: now };
  list[idx] = updated;
  await writeList(RECOVERY_BLOCK_WEEKS_KEY, list);
  return updated;
}
