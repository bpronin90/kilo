import { SYNC_TABLES, isTombstone, stampWrite } from '../syncQueue';

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

// Ascending record order used by every rule below. Both components are
// client-authored and immutable after creation, so all devices agree on it.
function compareRecoveryRecords(a, b, timeField) {
  return (
    String(a[timeField] || '').localeCompare(String(b[timeField] || '')) ||
    String(a.id).localeCompare(String(b.id))
  );
}

function laterIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

export function isLiveRecoveryRecord(record) {
  return Boolean(record) && record.id != null && !isTombstone(record);
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
  if (active.length < 2) return { list: list || [], changed: [] };

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

// One live membership per note, and one live ordinal per (block, week).
//
// Both rules keep the EARLIEST membership, which is the one that was already
// established when the second device made its conflicting write. Duplicate
// note memberships are tombstoned (a note genuinely belongs to one block at a
// time). A colliding ORDINAL is not dropped, because the membership itself is
// legitimate — it is renumbered to the next free ordinal in its block, which
// preserves the established order and appends the newcomer after it rather than
// renumbering anything that already existed.
export function resolveDuplicateWeekMemberships(list, clientId) {
  const changedById = new Map();
  const record = (rec) => {
    changedById.set(rec.id, rec);
    return rec;
  };

  // Rule 1 — one live membership per note.
  const byNote = new Map();
  for (const week of list || []) {
    if (!isLiveRecoveryRecord(week) || week.note_id == null) continue;
    const bucket = byNote.get(week.note_id);
    if (bucket) bucket.push(week);
    else byNote.set(week.note_id, [week]);
  }
  const retracted = new Set();
  for (const bucket of byNote.values()) {
    if (bucket.length < 2) continue;
    const ordered = bucket.slice().sort((a, b) => compareRecoveryRecords(a, b, 'saved_at'));
    for (const loser of ordered.slice(1)) {
      retracted.add(loser.id);
      record({ ...stampWrite(loser, clientId), deleted_at: retractedAt(loser) });
    }
  }

  // Rule 2 — one live ordinal per (block, week_number), over what rule 1 left
  // live. Grouping by block first keeps this O(rows) rather than a nested scan.
  const byBlock = new Map();
  for (const week of list || []) {
    if (!isLiveRecoveryRecord(week) || retracted.has(week.id)) continue;
    const bucket = byBlock.get(week.block_id);
    if (bucket) bucket.push(week);
    else byBlock.set(week.block_id, [week]);
  }
  for (const bucket of byBlock.values()) {
    const byOrdinal = new Map();
    let maxOrdinal = 0;
    for (const week of bucket) {
      const ordinal = Number(week.week_number);
      if (Number.isInteger(ordinal) && ordinal > maxOrdinal) maxOrdinal = ordinal;
      const collided = byOrdinal.get(week.week_number);
      if (collided) collided.push(week);
      else byOrdinal.set(week.week_number, [week]);
    }
    for (const collided of byOrdinal.values()) {
      if (collided.length < 2) continue;
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
    list: (list || []).map((w) => (w && changedById.get(w.id)) || w),
    changed: [...changedById.values()],
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
