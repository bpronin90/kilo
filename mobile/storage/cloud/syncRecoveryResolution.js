import { SYNC_TABLES, isTombstone, stampWrite } from '../syncQueue';
import {
  isWellFormedRecoveryBlock,
  isWellFormedRecoveryWeek,
} from '../../lib/data/activeTrainingContext';

// ── recovery-block duplicate resolution (issue #693) ─────────────────────────
//
// kilo.recovery_blocks and kilo.recovery_block_weeks carry three PARTIAL unique
// indexes over live rows: one active block per user, one live membership per
// workout note, and one live ordinal per (block, week). #692 already enforces
// all three locally, but a single device cannot enforce a cross-device
// invariant: two devices that are both offline can each legitimately start a
// recovery block, or each link the same note as week 3, and neither write is
// wrong when it is made.
//
// The database rejects the second one deterministically, which is what the
// acceptance criteria ask for — but a rejection alone would wedge the losing
// device, whose queued row can never be accepted. So the merge result is
// collapsed here, on every device, using ONLY values carried on the merged
// records themselves. Every device sees the same merged set and therefore
// computes the same survivor, which is what makes this converge instead of
// oscillate: no `Date.now()`, no local-only state, no dependence on which
// device happens to run first.
//
// Resolution runs in the sync WRITE path (see createTableIo in syncTableIo.js),
// the same seam the phantom-note cleanup uses, and the rows it changes are
// deferred to the caller so they are enqueued and pushed by a follow-up pass
// rather than being cleared underneath the in-flight one.

// The ONE definition of a valid record timestamp (#1368): a string that parses
// to an instant. Ordering is by instant, never by string, so ISO strings with
// different offsets or precision compare correctly. Local repair eligibility
// (recoveryRepair.js) uses the same predicate, so an unparseable value is never
// compared there; in this shared path it sorts as the oldest instant.
export function recoveryInstant(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
const instantOrOldest = (value) => recoveryInstant(value) ?? -Infinity;

// Ascending record order used by every rule below: instant first, then the
// record id as the deterministic tie-break (equal instants, different strings).
// Both components are client-authored and immutable after creation, so all
// devices agree on it.
function compareRecoveryRecords(a, b, timeField) {
  const ta = instantOrOldest(a[timeField]);
  const tb = instantOrOldest(b[timeField]);
  return (ta < tb ? -1 : ta > tb ? 1 : 0) || String(a.id).localeCompare(String(b.id));
}

function laterIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const ta = instantOrOldest(a);
  const tb = instantOrOldest(b);
  if (ta === tb) return a > b ? a : b;
  return ta > tb ? a : b;
}

export function isLiveRecoveryRecord(record) {
  return Boolean(record) && record.id != null && !isTombstone(record);
}

// Shared safety guards (#1368). EVERY caller (pull/push cloud resolution and
// local Recovery repair) gets the same policy because the guards live here:
// evidence that makes a winner arbitrary leaves the records untouched.
//   * a null/non-object row, a missing id, or a DUPLICATE id is ambiguous
//     identity: nothing in that list is resolved;
//   * an unparseable timestamp the winner policy depends on is never compared;
//   * a membership whose parent block is missing (or ambiguous) is never
//     treated as deleted, and neither wins nor loses a collision.
function hasAmbiguousIdentity(list) {
  const seen = new Set();
  for (const r of list || []) {
    if (!r || typeof r !== 'object' || r.id == null || seen.has(r.id)) return true;
    seen.add(r.id);
  }
  return false;
}

// Explicit parent tombstone -> surviving live memberships (issue #693, #1368).
// A membership inherits the block's own `deleted_at`, so every device writes a
// byte-identical tombstone. A MISSING block is never treated as deleted, and a
// block id that appears on more than one row (a live/deleted conflict) is
// ambiguous: only an UNIQUE explicit tombstone cascades.
export function planDeletedBlockCascade(blocks, weeks, clientId) {
  const counts = new Map();
  for (const block of blocks || []) {
    if (block && block.id != null) counts.set(block.id, (counts.get(block.id) || 0) + 1);
  }
  const deletedBlockAt = new Map();
  for (const block of blocks || []) {
    // Only a unique, well-formed tombstone (parseable `deleted_at`) cascades,
    // and only onto well-formed children: every record a shared decision
    // touches must pass the same shape check local repair applies (#1368).
    if (block && block.id != null && counts.get(block.id) === 1 && isTombstone(block)
      && isWellFormedRecoveryBlock(block)) {
      deletedBlockAt.set(block.id, block.deleted_at);
    }
  }
  const cascaded = [];
  if (deletedBlockAt.size === 0 || hasAmbiguousIdentity(weeks)) return { list: weeks || [], cascaded };
  const list = (weeks || []).map((week) => {
    if (!isLiveRecoveryRecord(week)) return week;
    const deletedAt = deletedBlockAt.get(week.block_id);
    if (!deletedAt || !isWellFormedRecoveryWeek(week)) return week;
    const tombstone = { ...stampWrite(week, clientId), deleted_at: deletedAt };
    cascaded.push(tombstone);
    return tombstone;
  });
  return { list: cascaded.length > 0 ? list : weeks, cascaded };
}

// One active block per user. The most recently STARTED block is the recovery the
// lifter is actually in, so it survives; every older still-open block is
// completed as of the survivor's start — the reading a user would give it
// themselves ("that recovery ended when this one began"). Completion is exactly
// the state change #692 makes irreversible through the generic patch API, and
// this is a sync-engine write against the raw list, not a patch, so it does not
// go around that rule.
export function resolveDuplicateActiveBlocks(list, clientId) {
  const active = (list || []).filter(
    (b) => isLiveRecoveryRecord(b) && !b.completed_at
  );
  if (
    active.length < 2 ||
    hasAmbiguousIdentity(list) ||
    !active.every((b) => recoveryInstant(b.started_at) !== null && isWellFormedRecoveryBlock(b))
  ) {
    return { list: list || [], changed: [] };
  }

  const ordered = active.slice().sort((a, b) => compareRecoveryRecords(a, b, 'started_at'));
  const survivor = ordered[ordered.length - 1];

  const changedById = new Map();
  for (const loser of ordered.slice(0, -1)) {
    changedById.set(
      loser.id,
      stampWrite(
        { ...loser, completed_at: laterIso(survivor.started_at, loser.started_at) },
        clientId
      )
    );
  }

  return {
    list: (list || []).map((b) => (b && changedById.get(b.id)) || b),
    changed: [...changedById.values()],
  };
}

// A membership that must not stay live is tombstoned at its OWN creation time
// rather than at `now()`: the row is being retracted as one that should never
// have existed, and a client-authored, immutable value is identical on every
// device, so two devices resolving the same collision produce byte-identical
// tombstones instead of fighting over a timestamp.
const EPOCH_ISO = new Date(0).toISOString();

function retractedAt(record) {
  // The final fallback is never reached by a record the domain built (it always
  // stamps saved_at), but it must exist: returning null would leave the row LIVE,
  // so the same collision would be re-resolved and re-pushed on every pass.
  return record.saved_at || record.started_at || record.updated_at || EPOCH_ISO;
}

function groupBy(list, keyOf) {
  const groups = new Map();
  for (const item of list) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

// One live membership per note, and one live ordinal per (block, week).
//
// Both rules keep the EARLIEST membership, which is the one that was already
// established when the second device made its conflicting write. Duplicate
// note memberships are tombstoned (a note genuinely belongs to one block at a
// time). A colliding ORDINAL is not dropped, because the membership itself is
// legitimate — it is renumbered to the next free ordinal in its block, which
// preserves the established order and appends the newcomer after it rather than
// renumbering anything that already existed.
//
// `blocks` (the block list the weeks belong to) makes parent evidence part of
// the policy: a membership whose parent is missing/ambiguous or that names its
// block's baseline note is UNRESOLVED. It is never changed, still RESERVES its
// note and ordinal slot, and any collision group it belongs to is left alone.
export function resolveDuplicateWeekMemberships(list, clientId, { blocks } = {}) {
  const all = list || [];
  if (hasAmbiguousIdentity(all)) return { list: all, changed: [], unresolvedBlocks: [] };

  let isEligible = () => true;
  if (blocks) {
    const counts = new Map();
    for (const b of blocks) if (b && b.id != null) counts.set(b.id, (counts.get(b.id) || 0) + 1);
    const parents = new Map(
      blocks.filter((b) => isLiveRecoveryRecord(b) && counts.get(b.id) === 1).map((b) => [b.id, b])
    );
    isEligible = (w) => {
      const parent = parents.get(w.block_id);
      return !!parent && w.note_id !== parent.baseline_note_id;
    };
  }
  // A group may be repaired only when every member is eligible and carries a
  // timestamp the ordering can compare.
  const repairable = (group) =>
    group.every((w) => isEligible(w) && isWellFormedRecoveryWeek(w) && recoveryInstant(w.saved_at) !== null);

  const changedById = new Map();
  const record = (rec) => {
    changedById.set(rec.id, rec);
    return rec;
  };
  const live = all.filter((w) => isLiveRecoveryRecord(w));

  // Rule 1 — one live membership per note. Members of a note group that
  // cannot be resolved stay PROTECTED through rule 2: their note ownership is
  // undecided, so no ordinal decision may depend on them.
  const retracted = new Set();
  const protectedIds = new Set();
  for (const bucket of groupBy(live.filter((w) => w.note_id != null), (w) => w.note_id).values()) {
    if (bucket.length < 2) continue;
    if (!repairable(bucket)) {
      for (const w of bucket) protectedIds.add(w.id);
      continue;
    }
    const ordered = bucket.slice().sort((a, b) => compareRecoveryRecords(a, b, 'saved_at'));
    for (const loser of ordered.slice(1)) {
      retracted.add(loser.id);
      record({ ...stampWrite(loser, clientId), deleted_at: retractedAt(loser) });
    }
  }

  // Rule 2 — one live ordinal per (block, week_number), over what rule 1 left
  // live. Unresolved rows stay in the buckets: they RESERVE their ordinal.
  const unresolvedBlocks = [];
  const byBlock = groupBy(live.filter((w) => !retracted.has(w.id)), (w) => w.block_id);
  for (const [blockId, bucket] of byBlock) {
    let maxOrdinal = 0;
    let valid = true;
    for (const week of bucket) {
      const ordinal = week.week_number;
      // An ordinal that is not a positive safe integer cannot be ordered or
      // appended after, so this block is left exactly as found (#1368).
      if (!Number.isSafeInteger(ordinal) || ordinal < 1) valid = false;
      else if (ordinal > maxOrdinal) maxOrdinal = ordinal;
    }
    const collisions = [...groupBy(bucket, (w) => w.week_number).entries()]
      .filter(([, group]) => group.length > 1 && repairable(group)
        && group.every((w) => !protectedIds.has(w.id)))
      // Ascending ordinal, never input order, so every device allocates the
      // same new ordinals to the same losers.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (collisions.length === 0) continue;
    const losers = collisions.reduce((n, [, group]) => n + group.length - 1, 0);
    if (!valid || maxOrdinal + losers > Number.MAX_SAFE_INTEGER) {
      unresolvedBlocks.push(blockId);
      continue;
    }
    for (const [, collided] of collisions) {
      const ordered = collided
        .slice()
        .sort((a, b) => compareRecoveryRecords(a, b, 'saved_at'));
      for (const loser of ordered.slice(1)) {
        maxOrdinal += 1;
        record(stampWrite({ ...loser, week_number: maxOrdinal }, clientId));
      }
    }
  }

  return {
    list: all.map((w) => (w && changedById.get(w.id)) || w),
    changed: [...changedById.values()],
    // Blocks whose ordinal collision could not be renumbered safely; their
    // records are returned untouched (#1368).
    unresolvedBlocks,
  };
}

// Statement-safe push order for the recovery collections (issue #693).
//
// The partial unique indexes are checked ROW BY ROW as Postgres processes an
// upsert, against the state the earlier rows left behind — not against the
// batch's end state. So a batch is rejected whenever a row CLAIMS a live slot
// that a LATER row in the same batch frees, even though the completed batch
// would satisfy every index.
//
// That is exactly the shape the duplicate collapse produces, and the dirty queue
// hands it over in the worst possible order. When THIS device holds the
// surviving active block, its own row was queued first (it is the pending local
// write) and the collapse's completion for the losing block is appended after
// it. Sent in that order the survivor is inserted while the loser still occupies
// the active slot, the statement rolls back, and the retry rebuilds the same
// order forever: a permanent wedge, not a transient rejection.
//
// The ordering below is derived from row CONTENT, not from a marker the collapse
// leaves behind, so it is correct for any batch — including one assembled from a
// restored dirty queue after a restart, where no in-memory knowledge of the
// collapse survives.
//
//   blocks:  rows that do not occupy the active slot (tombstoned or completed)
//            first, then the live-active row. Freeing always precedes claiming
//            because the collapse frees a slot only by completing a block.
//   weeks:   tombstoned rows first — they release both the note and the ordinal
//            slot — then live rows by DESCENDING week_number. A collapse only
//            ever moves a membership UP to the next free ordinal, so the mover is
//            sent before the row that inherits the ordinal it vacated.
//
// Both are stable: ids break ties, so two devices that push the same batch
// produce the same statement.
export function orderRecoveryPush(table) {
  if (table === SYNC_TABLES.RECOVERY_BLOCKS) {
    return (records) =>
      records
        .slice()
        .sort(
          (a, b) =>
            Number(claimsActiveBlockSlot(a)) - Number(claimsActiveBlockSlot(b)) ||
            String(a.id).localeCompare(String(b.id))
        );
  }
  if (table === SYNC_TABLES.RECOVERY_BLOCK_WEEKS) {
    return (records) =>
      records
        .slice()
        .sort(
          (a, b) =>
            Number(!isTombstone(a)) - Number(!isTombstone(b)) ||
            Number(b.week_number || 0) - Number(a.week_number || 0) ||
            String(a.id).localeCompare(String(b.id))
        );
  }
  return undefined;
}

function claimsActiveBlockSlot(record) {
  return !isTombstone(record) && !record.completed_at;
}

// The recovery collections are the two tables whose failure must not take the
// rest of a pass down (issue #693). They are the only synced tables carrying
// cross-record uniqueness constraints, so a two-device race can legitimately get
// one push rejected — and weight entries, workout notes, and settings have
// nothing to do with that. Every pass therefore runs them in isolation: their
// error is recorded, the pass continues through every other table, and the error
// is raised only once the rest of the work is durably done.
export const RECOVERY_SYNC_TABLES = Object.freeze([
  SYNC_TABLES.RECOVERY_BLOCKS,
  SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
]);

export function isRecoverySyncTable(table) {
  return RECOVERY_SYNC_TABLES.includes(table);
}
