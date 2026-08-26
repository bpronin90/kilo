import * as Storage from '../entries';
import {
  loadArchivedWeightGoalsRaw,
  replaceArchivedWeightGoalsRaw,
  replaceWeightGoalRaw,
} from '../entries/weightGoal';
import { mergeUserProfile } from '../entries/profileStorage';
import {
  loadDeloadNote,
  clearDeloadNote,
  applyDeloadNoteFromSync,
} from '../entries/deloadStorage';
import { WORKOUT_DELOAD_HISTORY_KEY } from '../entries/keys';
import { writeList } from '../entries/jsonStorage';
import {
  SYNC_TABLES,
  SINGLETON_SYNC_ID,
  syncTable,
  syncDiffTable,
  isTombstone,
  stampWrite,
  stampTombstone,
  stableStringify,
  getClientId,
  enqueueDirtyMany,
  getDirtyRecords,
  getSyncSnapshot,
  diffAgainstBaseline,
  reconcileAgainstBaseline,
  clearCursor,
  clearSyncSnapshot,
  reconcileLocalWrites,
} from '../syncQueue';
import {
  WEIGHT_GOAL_SYNC_FIELDS,
  DELOAD_RECORD_JSON_FIELDS,
  buildDeloadRecordJson,
  deriveFatigueCheckinRows,
} from './bootstrapPlan';
import { getTransport, getRecomputeDerived } from './transport';

// Legacy-note bootstrap provenance. A row is legacy-provenance when EITHER:
//   * it carries source_snapshot.async_storage_key === 'kilo_workout_note'
//     (the marker buildBootstrapPlan stamps on the kilo_workout_note import), OR
//   * its id is in the `wn_legacy_<userId>` namespace that ONLY bootstrap mints
//     for that import (see bootstrapPlan.js). User-authored notes and the local
//     `migrateToNotebook` entry use `wn_<date>_<ts>` ids, never this prefix.
//
// The id check exists because of issue #501: the ownership-confirmation upload
// path could re-upload a legacy row through bootstrap with its source_snapshot
// stripped to null, producing a live cloud row that the source_snapshot-only
// check no longer recognized. The id namespace is the durable provenance signal
// that survives that round trip, so a row already resurrected that way (including
// one already sitting in an account from the buggy build) is still cleaned.
function isLegacyProvenanceNote(note) {
  if (
    note.source_snapshot != null &&
    note.source_snapshot.async_storage_key === 'kilo_workout_note'
  ) {
    return true;
  }
  return typeof note.id === 'string' && note.id.startsWith('wn_legacy_');
}

// Returns true for a LIVE legacy-provenance row. Both phantom guards gate on
// hasNonPhantom, so a legacy-only user whose sole note is this row is preserved.
function isLegacyPhantomNote(note) {
  return !isTombstone(note) && isLegacyProvenanceNote(note);
}

async function clearTombstonedCurrentNote(tombstones) {
  if (tombstones.length === 0) return;
  const currentId = await Storage.loadCurrentWorkoutId();
  if (tombstones.some((note) => note.id === currentId)) {
    await Storage.clearCurrentWorkoutId();
  }
}

// ── pass-scoped local table cache (issue #806) ───────────────────────────────
//
// One sync pass reads and rewrites the same collection tables several times: the
// signed-out reconciliation reads them, the phantom-note cleanup reads and may
// rewrite workout_notes, syncTable reads before merging and writes the merged
// list, and the derived fatigue projection reads workout_notes again. Every one
// of those is a full decrypt + JSON.parse (or stringify + encrypt) of the whole
// table on device storage — measured at ~2.5MB of redundant reads for a single
// no-change pass on a large account.
//
// This cache makes each table read ONCE per pass and written only when the bytes
// actually change. It is created per `runSyncPass` and discarded with it, so it
// never outlives the exclusive cloud-operation queue that owns the pass.
//
// A pass that changes nothing now writes nothing, which removes the whole-table
// rewrite outright — the operation that could overwrite a domain write made
// while the pass was running.
//
// A pass that DOES change the table still replaces it wholesale, and the cloud
// operation queue does not serialize UI/domain writes, so `saveWeightEntry` (and
// every other domain write) can land between the copy this pass is holding and
// the write it is about to make. That copy is not trusted for such a write: the
// table is re-read first and any row the domain changed in the meantime is
// carried into the persisted list. A concurrent domain write in cloud mode is
// stamped and dirty-queued at write time, so preferring it here is the same rule
// syncTable already applies when it refuses to vote a pending local row against
// its remote counterpart.
//
// The revalidation read happens only on a write that will actually touch
// storage, so the steady-state pass — the one that reads the most and changes
// the least — pays nothing for it.
function createPassCache() {
  const entries = new Map();
  return {
    async read(table, load) {
      const hit = entries.get(table);
      if (hit) return hit.list;
      const list = (await load()) || [];
      entries.set(table, { list, serialized: JSON.stringify(list) });
      return list;
    },
    async write(table, list, persist, load) {
      const serialized = JSON.stringify(list);
      const hit = entries.get(table);
      if (hit && hit.serialized === serialized) {
        entries.set(table, { list, serialized });
        return list;
      }
      const next = hit ? preserveConcurrentWrites(hit.list, (await load()) || [], list) : list;
      await persist(next);
      entries.set(table, {
        list: next,
        serialized: next === list ? serialized : JSON.stringify(next),
      });
      return next;
    },
  };
}

// Fold rows the domain wrote to storage after this pass took its copy into the
// list the pass is about to persist. `base` is what the pass read, `current` is
// what storage holds now, `next` is what the pass wants to write.
//
// A row is "concurrent" when storage disagrees with the copy the pass started
// from; those rows win, because they are the writes the pass never saw and would
// otherwise erase. Everything else keeps the pass's own result, including its
// order. A row that is in `base` but has since vanished from `current` is NOT
// treated as a delete — that is the engine's standing rule (never infer a
// delete), and the pass's version is kept.
//
// Returns `next` by identity when nothing raced, so the ordinary path allocates
// nothing and the caller can skip re-serializing.
function preserveConcurrentWrites(base, current, next) {
  const baseById = new Map();
  for (const record of base || []) {
    if (record && record.id != null) baseById.set(record.id, JSON.stringify(record));
  }
  const concurrent = [];
  for (const record of current || []) {
    if (!record || record.id == null) continue;
    if (baseById.get(record.id) !== JSON.stringify(record)) concurrent.push(record);
  }
  if (concurrent.length === 0) return next;

  const positionById = new Map();
  const merged = [];
  for (const record of next) {
    if (record && record.id != null) positionById.set(record.id, merged.length);
    merged.push(record);
  }
  for (const record of concurrent) {
    const at = positionById.get(record.id);
    if (at === undefined) merged.push(record);
    else merged[at] = record;
  }
  return merged;
}

// Shared by the pre-pass cleanup below and the workout_notes sync write. Pure:
// returns the list to persist plus the tombstones it minted, and leaves both
// persistence and queueing to the caller (they differ between the two seams —
// see the deferral contract in createTableIo).
function tombstonePhantomNotes(list, clientId) {
  const hasNonPhantom = list.some((n) => !isTombstone(n) && !isLegacyPhantomNote(n));
  if (!hasNonPhantom) return { list, tombstoned: [] };

  const tombstoned = [];
  const processed = list.map((n) => {
    if (!isLegacyPhantomNote(n)) return n;
    const ts = stampTombstone(n, clientId);
    tombstoned.push(ts);
    return ts;
  });
  return { list: tombstoned.length > 0 ? processed : list, tombstoned };
}

// Tombstone any live phantom legacy notes already in local storage when non-phantom
// notes co-exist. Running before the sync loop ensures the tombstone participates
// in the LWW merge and that merged.get(id) returns the tombstone in syncTable
// step 3, so the correct tombstone row is pushed to cloud in the same pass.
// (Scenario A: phantom was written into local storage by a prior sync pull.)
async function tombstoneLocalPhantoms(cache) {
  const list = await cache.read(SYNC_TABLES.WORKOUT_NOTES, Storage.loadWorkoutNotesRaw);
  const clientId = await getClientId();
  const { list: processed, tombstoned } = tombstonePhantomNotes(list, clientId);
  if (tombstoned.length === 0) return;

  await cache.write(
    SYNC_TABLES.WORKOUT_NOTES,
    processed,
    Storage.replaceWorkoutNotesRaw,
    Storage.loadWorkoutNotesRaw
  );
  await clearTombstonedCurrentNote(tombstoned);
  await enqueueDirtyMany(SYNC_TABLES.WORKOUT_NOTES, tombstoned);
}

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
// Resolution runs in the sync WRITE path (see createTableIo below), the same
// seam the phantom-note cleanup uses, and the rows it changes are deferred to
// the caller so they are enqueued and pushed by a follow-up pass rather than
// being cleared underneath the in-flight one.

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

function isLiveRecoveryRecord(record) {
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

// Cascade a PULLED block tombstone to the memberships it should have taken with
// it (issue #693).
//
// #692 cascades locally: deleting a block tombstones its live memberships in the
// same write. A tombstone that arrives by PULL carries no such cascade — the
// merge simply adopts the block row — so a membership this device created while
// the block was still live stays live under a dead parent.
//
// Nothing downstream catches it. The foreign key cannot: a tombstoned block row
// is still physically present, so the reference is valid. The live-row unique
// indexes cannot: one live membership for that note is exactly what they allow.
// So the row uploads, and the user is left with a membership they cannot see
// (its block is gone) that permanently holds the live-note slot — meaning that
// workout note can never join another recovery block. The slot is the real
// damage; the invisible row is just how it hides.
//
// Runs BEFORE every recovery_block_weeks pass, so the tombstone is already in
// the dirty queue when that pass pushes and converges in the same pass rather
// than needing a follow-up.
//
// A block that is MISSING locally is deliberately not treated as deleted. That
// is the "never infer a delete" rule the rest of the engine follows: an absent
// block is a row this device has not downloaded yet (its push may simply have
// failed on the other device), and tombstoning its memberships would destroy
// legitimate data on a guess. Only an explicit tombstone cascades.
//
// The membership inherits the BLOCK's `deleted_at` rather than `now()`: it is a
// converged, server-visible value, so every device that performs this cascade
// writes a byte-identical tombstone instead of fighting over a timestamp.
export async function cascadeDeletedBlockMemberships(cache = createPassCache()) {
  const [blocks, weeks] = await Promise.all([
    cache.read(SYNC_TABLES.RECOVERY_BLOCKS, Storage.loadRecoveryBlocksRaw),
    cache.read(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, Storage.loadRecoveryBlockWeeksRaw),
  ]);

  const deletedBlockAt = new Map();
  for (const block of blocks || []) {
    if (block && block.id != null && isTombstone(block)) {
      deletedBlockAt.set(block.id, block.deleted_at);
    }
  }
  if (deletedBlockAt.size === 0) return [];

  const clientId = await getClientId();
  const cascaded = [];
  const next = (weeks || []).map((week) => {
    if (!isLiveRecoveryRecord(week)) return week;
    const deletedAt = deletedBlockAt.get(week.block_id);
    if (!deletedAt) return week;
    const tombstone = { ...stampWrite(week, clientId), deleted_at: deletedAt };
    cascaded.push(tombstone);
    return tombstone;
  });
  if (cascaded.length === 0) return [];

  await cache.write(
    SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
    next,
    Storage.replaceRecoveryBlockWeeksRaw,
    Storage.loadRecoveryBlockWeeksRaw
  );
  await enqueueDirtyMany(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, cascaded);
  return cascaded;
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
function orderRecoveryPush(table) {
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

// Every `write` returns the list it actually persisted, which is what syncTable
// records as the table's baseline (issue #806) — see the deliberate transforms
// on workout_notes and the two recovery collections below.
function createTableIo(
  deferWorkoutNoteTombstone,
  deferRecoveryResolution = () => {},
  cache = createPassCache()
) {
  return {
  [SYNC_TABLES.WEIGHT_ENTRIES]: {
    read: () => cache.read(SYNC_TABLES.WEIGHT_ENTRIES, Storage.loadWeightEntriesRaw),
    write: (list) =>
      cache.write(
        SYNC_TABLES.WEIGHT_ENTRIES,
        list,
        Storage.replaceWeightEntriesRaw,
        Storage.loadWeightEntriesRaw
      ),
  },
  [SYNC_TABLES.WORKOUT_NOTES]: {
    read: () => cache.read(SYNC_TABLES.WORKOUT_NOTES, Storage.loadWorkoutNotesRaw),
    // Tombstone any live phantom legacy notes that survived the LWW merge when
    // non-phantom notes exist. This handles Scenario B: phantom arrived via cloud
    // pull (not yet in local), so tombstoneLocalPhantoms could not act on it
    // before the merge. The tombstone is written locally (so loadWorkoutNotes
    // never surfaces the phantom) and enqueued dirty so the cursor advances past
    // the phantom's timestamp on this sync pass, stopping re-pulls.
    write: async (list) => {
      const clientId = await getClientId();
      const { list: processed, tombstoned } = tombstonePhantomNotes(list, clientId);
      const persisted = await cache.write(
        SYNC_TABLES.WORKOUT_NOTES,
        processed,
        Storage.replaceWorkoutNotesRaw,
        Storage.loadWorkoutNotesRaw
      );
      if (tombstoned.length > 0) {
        await clearTombstonedCurrentNote(tombstoned);
        // syncTable snapshots and clears its dirty batch around writeLocal. Defer
        // rows created during this write until the pass completes so they cannot
        // be cleared before upload.
        tombstoned.forEach(deferWorkoutNoteTombstone);
      }
      return persisted;
    },
  },
  [SYNC_TABLES.ARCHIVED_WEIGHT_GOALS]: {
    read: () => cache.read(SYNC_TABLES.ARCHIVED_WEIGHT_GOALS, loadArchivedWeightGoalsRaw),
    write: (list) =>
      cache.write(
        SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
        list,
        replaceArchivedWeightGoalsRaw,
        loadArchivedWeightGoalsRaw
      ),
  },
  // Both recovery collections write the merged list back VERBATIM apart from the
  // cross-device duplicate collapse above. In particular the frozen `baseline`
  // and each membership's `week_number` are persisted exactly as they arrived:
  // sync never recomputes a baseline metric and never reorders an established
  // membership sequence.
  [SYNC_TABLES.RECOVERY_BLOCKS]: {
    read: () => cache.read(SYNC_TABLES.RECOVERY_BLOCKS, Storage.loadRecoveryBlocksRaw),
    write: async (list) => {
      const clientId = await getClientId();
      const { list: resolved, changed } = resolveDuplicateActiveBlocks(list, clientId);
      const persisted = await cache.write(
        SYNC_TABLES.RECOVERY_BLOCKS,
        resolved,
        Storage.replaceRecoveryBlocksRaw,
        Storage.loadRecoveryBlocksRaw
      );
      // Same deferral contract as the phantom-note tombstones above: syncTable
      // snapshots and clears its dirty batch around writeLocal, so a row created
      // during the write must be enqueued after the pass, not inside it.
      for (const record of changed) deferRecoveryResolution(SYNC_TABLES.RECOVERY_BLOCKS, record);
      return persisted;
    },
  },
  [SYNC_TABLES.RECOVERY_BLOCK_WEEKS]: {
    read: () =>
      cache.read(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, Storage.loadRecoveryBlockWeeksRaw),
    write: async (list) => {
      const clientId = await getClientId();
      const { list: resolved, changed } = resolveDuplicateWeekMemberships(list, clientId);
      const persisted = await cache.write(
        SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
        resolved,
        Storage.replaceRecoveryBlockWeeksRaw,
        Storage.loadRecoveryBlockWeeksRaw
      );
      for (const record of changed) {
        deferRecoveryResolution(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, record);
      }
      return persisted;
    },
  },
  };
}

// The tables whose local changes are tracked by the dirty queue at write time.
// Every other synced table is diff-tracked (see DIFF_TABLES below), which
// detects local change by comparing live state against a snapshot instead.
//
// ORDER IS PART OF THE CONTRACT (issue #693). The list is walked in sequence by
// runSyncPass, and the last two tables reference rows in tables above them: a
// recovery block names the workout note its frozen baseline was captured from,
// and a membership names both its block and its note. Syncing them in this order
// is what makes a reference arrive after the row it points at, so a second
// device never sees a block whose baseline routine it has not downloaded yet.
const COLLECTION_SYNC_TABLES = Object.freeze([
  SYNC_TABLES.WEIGHT_ENTRIES,
  SYNC_TABLES.WORKOUT_NOTES,
  SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
  SYNC_TABLES.RECOVERY_BLOCKS,
  SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
]);

// The recovery collections are the two tables whose failure must not take the
// rest of a pass down (issue #693). They are the only synced tables carrying
// cross-record uniqueness constraints, so a two-device race can legitimately get
// one push rejected — and weight entries, workout notes, and settings have
// nothing to do with that. Every pass therefore runs them in isolation: their
// error is recorded, the pass continues through every other table, and the error
// is raised only once the rest of the work is durably done.
const RECOVERY_SYNC_TABLES = Object.freeze([
  SYNC_TABLES.RECOVERY_BLOCKS,
  SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
]);

function isRecoverySyncTable(table) {
  return RECOVERY_SYNC_TABLES.includes(table);
}

// Reconcile writes made while signed out (issue #525).
//
// Only the CLOUD adapter enqueues dirty records at write time, so anything the
// user created, edited, or deleted while signed out is invisible to the sync
// loop: the pass pushes nothing and still reports success. This diffs each
// collection table against the baseline syncTable persists and enqueues whatever
// diverged, so the ordinary loop below uploads it.
//
// Runs at the START of every sync pass rather than only on the sign-in
// transition. Sync is the single funnel every path goes through — automatic
// sign-in sync, "Sync Now", and the #538 post-purge rebuild — so putting the
// reconciliation here means no caller can reach a successful SYNC phase without
// it, and a reconciliation that fails throws out of the phase runner instead of
// letting the UI show "Fully synced" over unreconciled local data. On a device
// with nothing to reconcile it is a keyed O(rows) comparison that enqueues
// nothing, so repeated passes stay idempotent.
//
// This is the STEADY-STATE half only. A table with no baseline yet returns
// `deferred: true` and enqueues nothing here, because local state alone cannot
// distinguish a signed-out write from an untouched row — syncTable handles that
// table against a full pull instead (see reconcileAgainstRemote). Both halves
// run inside the same sync phase, so neither can be skipped on the way to a
// successful SYNC.
//
// Recovery reconciliation is isolated (issue #693) for the same reason its sync
// pass is: an unreadable recovery collection — the fail-closed CorruptStorageError
// readList raises for a key whose bytes will not parse — must not stop weight
// entries and workout notes from reconciling and uploading. The failure is
// carried out on the result instead of thrown, and runSyncPass raises it after
// the rest of the pass has completed, so it is reported rather than swallowed.
export async function reconcileSignedOutWrites(tableIo = createTableIo(() => {})) {
  const results = [];
  for (const table of COLLECTION_SYNC_TABLES) {
    const reconcile = () => reconcileLocalWrites({ table, readLocal: tableIo[table].read });
    if (!isRecoverySyncTable(table)) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await reconcile());
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      results.push(await reconcile());
    } catch (error) {
      results.push({ table, reconciled: 0, deferred: false, error });
    }
  }
  return results;
}

async function syncOne(table, tableIo, ownedDevice = false, knownUnbaselined = null) {
  const io = tableIo[table];
  return syncTable({
    table,
    transport: getTransport(),
    readLocal: io.read,
    writeLocal: io.write,
    recomputeDerived: getRecomputeDerived(),
    // Only the recovery collections need one; see orderRecoveryPush for the two
    // orderings and the wedge they exist to prevent.
    orderPush: orderRecoveryPush(table),
    // These three are the tables whose signed-out writes the dirty queue misses,
    // so they opt into the unbaselined (upgrade-window) reconciliation described
    // in syncQueue: on the one pass where no baseline exists yet, reconcile
    // against a full pull instead of against local state (#525). That pass also
    // classifies signed-out deletes against the validated pull cursor, and can
    // throw SyncReconciliationConflictError when the cursor cannot establish what
    // this device already observed — which fails the SYNC phase with an
    // actionable message instead of reporting success over an unreconciled table.
    reconcileUnbaselined: true,
    // Transition context for the missing-cursor case (#525, round 4). Only the app
    // layer knows whether this pass is a clean-device first download / #538
    // rebuild (false) or an owned device whose cursor was cleared (true); see
    // reconcileAgainstRemote. Defaults false so every unthreaded caller (the
    // background maybeSyncCloud refresh, #538 rebuildCloudCopy, tests) keeps the
    // safe non-blocking first-download behaviour.
    ownedDevice,
    // The baseline this table's reconciliation already read moments ago in this
    // same pass (issue #806). `null` makes syncTable read it itself, which is
    // what every caller outside runSyncPass gets.
    knownUnbaselined,
  });
}

// ── diff-tracked tables (issue #489) ─────────────────────────────────────────
//
// `user_profile`, `feature_toggles`, `weight_goal`, and `deload_history` used to
// be pushed exactly once, by bootstrap, and never again — so a routine change, a
// tracked-lift change, a toggle, the unit system, the fatigue multiplier, the
// active goal, and deload history all stopped at the device they were made on,
// and the cloud copy stayed frozen at first sign-in.
//
// They now run through `syncDiffTable`, which reuses the same LWW engine as the
// three original tables (`stampWrite`/`stampTombstone`/`pickWinner`/dirty queue/
// cursor). The one difference is dirty detection: these tables are assembled from
// a spread of AsyncStorage keys written by many setters across modules outside
// this issue's scope, so instead of hooking every setter we diff live local state
// against a persisted last-synced snapshot. See syncQueue.js for the convergence
// rule this implies (last write to REACH THE SERVER wins, ties by client_id).
//
// `buildLocal` projects local storage onto the cloud row shape; `applyMerged`
// writes LWW winners back into local storage. Every `applyMerged` MERGES into the
// existing local record rather than replacing it, so fields the cloud does not
// carry (profile demographics, unknown deload keys) are never clobbered on a
// device that already has data.

const SINGLETON_TABLES = new Set([
  SYNC_TABLES.USER_PROFILE,
  SYNC_TABLES.USER_HEALTH_PROFILE,
  SYNC_TABLES.FEATURE_TOGGLES,
  SYNC_TABLES.WEIGHT_GOAL,
]);

// Singleton rows have no `id` column, but the merge machinery is keyed by id.
// Give every pulled singleton row the same synthetic id so local and remote
// versions of the one logical row resolve against each other. The upsert column
// whitelist drops `id` again on the way out (see transport.js).
function withSingletonIds(transport) {
  return {
    async pull(table, cursor) {
      const rows = (await transport.pull(table, cursor)) || [];
      if (!SINGLETON_TABLES.has(table)) return rows;
      return rows.map((row) =>
        row && row.id == null ? { ...row, id: SINGLETON_SYNC_ID } : row
      );
    },
    push: (table, records) => transport.push(table, records),
  };
}

// Bounds for a synced fatigue multiplier, mirroring the backup-import validator.
// A remote value outside them is ignored rather than written into fatigue calc.
function isValidFatigueMultiplier(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 10;
}

function singletonRow(mergedList) {
  return mergedList.find((rec) => rec && rec.id === SINGLETON_SYNC_ID) || null;
}

// user_profile / user_health_profile ------------------------------------------
//
// One logical "profile" on the device, two cloud rows since #487: account
// settings in user_profile, and the three Art. 9 health values
// (current_workout_note_id, fatigue_multiplier, tracked_lifts) in the
// consent-gated user_health_profile.
//
// The split is not cosmetic. Left on user_profile, those three would keep syncing
// through an ungated table, and the contract migration that drops the columns
// would break settings sync along with them. Splitting also means a user who
// refuses health consent still syncs their display name and unit system: the gate
// blocks the health row, not their account.
//
// The active generated deload (issue #498) rides the same consent-gated health
// singleton via current_deload_note_raw_text / _saved_at / _updated_at, so a
// deload generated on device A becomes the active deload on device B. Its pulled
// winner is applied through applyDeloadNoteFromSync (timestamps written verbatim,
// no re-stamp) so it does not ping-pong.

const USER_PROFILE_FIELDS = Object.freeze([
  'display_name',
  'unit_system',
  'ui_state',
]);

const USER_HEALTH_PROFILE_FIELDS = Object.freeze([
  'current_workout_note_id',
  'fatigue_multiplier',
  'tracked_lifts',
  // Tracked-span activation records (#893). They ride the SAME row as the flags
  // they belong to, so the two can never desynchronize: whole-row LWW resolves a
  // conflict for both at once, exactly as it did for the flags alone.
  'tracked_lift_activations',
  // Active in-progress deload (issue #498). Health data, so gated with the row.
  'current_deload_note_raw_text',
  'current_deload_note_saved_at',
  'current_deload_note_updated_at',
]);

// The multiplier a device reports when the user has never touched it.
const DEFAULT_FATIGUE_MULTIPLIER = 1.07;

// True when the local row carries nothing the user actually authored. A singleton
// always exists locally (its storage keys fall back to defaults), so on the FIRST
// sync pass this is the only way to tell a clean install apart from a user who
// deliberately cleared every field. Without it, a clean install would stamp its
// empty defaults at `now` and overwrite the row another device authored.
// `ui_state` is not consulted: a collapsed panel is not user content.
function isEmptyUserProfile(record) {
  return record.display_name == null && record.unit_system == null;
}

function isEmptyUserHealthProfile(record) {
  const noTrackedLifts =
    !record.tracked_lifts || Object.keys(record.tracked_lifts).length === 0;
  const defaultMultiplier =
    record.fatigue_multiplier == null ||
    Number(record.fatigue_multiplier) === DEFAULT_FATIGUE_MULTIPLIER;
  // A device with an active deload note has real health content, so it must not be
  // treated as an empty clean-install row (which would adopt the cloud row and drop
  // the local deload on the seeded first pass).
  const noDeloadNote = record.current_deload_note_raw_text == null;
  return (
    record.current_workout_note_id == null &&
    noTrackedLifts &&
    defaultMultiplier &&
    noDeloadNote
  );
}

// Same first-pass rule for toggles: all four at their shipped defaults means the
// user has never set one, so a clean install adopts the account's toggles rather
// than resetting them for every other device.
function isDefaultFeatureToggles(record) {
  return (
    record.weight_date_edit_enabled === false &&
    record.deload_date_edit_enabled === false &&
    record.fatigue_tracking_enabled === true &&
    record.deload_mode_enabled === true
  );
}

async function buildUserProfileRecords() {
  const [profile, collapsed] = await Promise.all([
    Storage.loadUserProfile(),
    Storage.loadWorkoutCollapsed(),
  ]);
  return [
    {
      id: SINGLETON_SYNC_ID,
      display_name: profile?.display_name ?? null,
      unit_system: profile?.unit_system ?? null,
      ui_state: { log_current_collapsed: !!collapsed },
    },
  ];
}

async function applyUserProfile(mergedList) {
  const row = singletonRow(mergedList);
  if (!row || isTombstone(row)) return;

  if (row.ui_state && typeof row.ui_state === 'object') {
    const next = !!row.ui_state.log_current_collapsed;
    const local = !!(await Storage.loadWorkoutCollapsed());
    if (local !== next) await Storage.saveWorkoutCollapsed(next);
  }

  // MERGE, never replace: the local profile record also holds the device-local
  // demographics (date_of_birth/sex/height_cm/activity_level) that are
  // deliberately not synced (issue #476). saveUserProfile would drop them.
  const profile = await Storage.loadUserProfile();
  const nextName = row.display_name ?? null;
  const nextUnit = row.unit_system ?? null;
  if (
    (profile?.display_name ?? null) !== nextName ||
    (profile?.unit_system ?? null) !== nextUnit
  ) {
    await mergeUserProfile({ display_name: nextName, unit_system: nextUnit });
  }
}

// user_health_profile --------------------------------------------------------

async function buildUserHealthProfileRecords() {
  const [currentWorkoutId, fatigueMultiplier, trackedLifts, trackedLiftActivations, deloadNote] =
    await Promise.all([
      Storage.loadCurrentWorkoutId(),
      Storage.loadFatigueMultiplier(),
      Storage.loadTrackedLifts(),
      Storage.loadTrackedLiftActivations(),
      loadDeloadNote(),
    ]);
  const note = deloadNote || {};
  return [
    {
      id: SINGLETON_SYNC_ID,
      current_workout_note_id: currentWorkoutId ?? null,
      fatigue_multiplier: fatigueMultiplier ?? null,
      tracked_lifts: trackedLifts ?? {},
      tracked_lift_activations: trackedLiftActivations ?? {},
      current_deload_note_raw_text: note.raw_text ?? null,
      current_deload_note_saved_at: note.saved_at ?? null,
      current_deload_note_updated_at: note.updated_at ?? null,
    },
  ];
}

async function applyUserHealthProfile(mergedList) {
  const row = singletonRow(mergedList);
  if (!row || isTombstone(row)) return;

  const nextCurrent = row.current_workout_note_id ?? null;
  const localCurrent = (await Storage.loadCurrentWorkoutId()) ?? null;
  if (localCurrent !== nextCurrent) {
    if (nextCurrent == null) await Storage.clearCurrentWorkoutId();
    else await Storage.saveCurrentWorkoutId(nextCurrent);
  }

  if (row.fatigue_multiplier != null && isValidFatigueMultiplier(row.fatigue_multiplier)) {
    const next = Number(row.fatigue_multiplier);
    const local = Number(await Storage.loadFatigueMultiplier());
    if (local !== next) await Storage.saveFatigueMultiplier(next);
  }

  if (
    row.tracked_lifts &&
    typeof row.tracked_lifts === 'object' &&
    !Array.isArray(row.tracked_lifts)
  ) {
    const local = await Storage.loadTrackedLifts();
    if (stableStringify(local) !== stableStringify(row.tracked_lifts)) {
      await Storage.saveTrackedLifts(row.tracked_lifts);
    }
  }

  // #893. Applied independently of the flags above rather than nested under
  // them: a server predating the column serves the pulled winner with no such
  // field, so `undefined` here means "this row cannot speak to the records" and
  // must leave the local ones alone — not clear them. A present-but-empty object
  // IS a real value (every activation retired or untracked) and is applied.
  // Normalized on the way in, because this crossed a trust boundary.
  //
  // The prune below then runs UNCONDITIONALLY, against whatever flags this
  // device now holds. That is the half an older build cannot do for itself: its
  // upsert names `tracked_lifts` and not this column, so Postgres PRESERVES the
  // stored records across its untrack and the pulled row comes back carrying a
  // record for a key that is no longer tracked. Dropping it here is what stops a
  // later retrack from resuming the abandoned span with every gap session inside
  // it. A watermark-aware writer never trips this: it deletes flag and record
  // together, so there is nothing orphaned to drop.
  if (
    row.tracked_lift_activations &&
    typeof row.tracked_lift_activations === 'object' &&
    !Array.isArray(row.tracked_lift_activations)
  ) {
    const next = Storage.normalizeTrackedLiftActivations(row.tracked_lift_activations);
    const local = await Storage.loadTrackedLiftActivations();
    if (stableStringify(local) !== stableStringify(next)) {
      await Storage.saveTrackedLiftActivations(next);
    }
  }

  const flags = await Storage.loadTrackedLifts();
  const records = await Storage.loadTrackedLiftActivations();
  const pruned = Storage.pruneTrackedLiftActivations(flags, records);
  if (stableStringify(pruned) !== stableStringify(records)) {
    await Storage.saveTrackedLiftActivations(pruned);
  }

  // Active deload (issue #498). A null raw_text is a cleared deload; removing the
  // local note is what stops the next diff from re-pushing it (no resurrection).
  // Otherwise write the winner's timestamps VERBATIM via applyDeloadNoteFromSync,
  // never saveDeloadNote — re-stamping updated_at here would ping-pong the row
  // between devices. Compare on normalized timestamps so a Postgres +00:00/Z
  // round-trip is not mistaken for a change.
  const nextDeloadRaw = row.current_deload_note_raw_text ?? null;
  const nextDeloadSaved = row.current_deload_note_saved_at ?? null;
  const nextDeloadUpdated = row.current_deload_note_updated_at ?? null;
  const localDeload = await loadDeloadNote();
  if (nextDeloadRaw == null) {
    if (localDeload) await clearDeloadNote();
  } else {
    const sameTs = (a, b) => {
      const ta = a == null ? null : Date.parse(a);
      const tb = b == null ? null : Date.parse(b);
      return ta === tb;
    };
    const changed =
      (localDeload?.raw_text ?? null) !== nextDeloadRaw ||
      !sameTs(localDeload?.saved_at ?? null, nextDeloadSaved) ||
      !sameTs(localDeload?.updated_at ?? null, nextDeloadUpdated);
    if (changed) {
      await applyDeloadNoteFromSync({
        raw_text: nextDeloadRaw,
        saved_at: nextDeloadSaved,
        updated_at: nextDeloadUpdated,
      });
    }
  }
}

// feature_toggles ------------------------------------------------------------

const FEATURE_TOGGLE_FIELDS = Object.freeze([
  'weight_date_edit_enabled',
  'deload_date_edit_enabled',
  'fatigue_tracking_enabled',
  'deload_mode_enabled',
]);

async function buildFeatureToggleRecords() {
  const [weightDateEdit, deloadDateEdit, fatigueTracking, deloadMode] = await Promise.all([
    Storage.loadWeightDateEditEnabled(),
    Storage.loadDeloadDateEditEnabled(),
    Storage.loadFatigueTrackingEnabled(),
    Storage.loadDeloadModeEnabled(),
  ]);
  return [
    {
      id: SINGLETON_SYNC_ID,
      weight_date_edit_enabled: !!weightDateEdit,
      deload_date_edit_enabled: !!deloadDateEdit,
      fatigue_tracking_enabled: fatigueTracking !== false,
      deload_mode_enabled: deloadMode !== false,
    },
  ];
}

async function applyFeatureToggles(mergedList) {
  const row = singletonRow(mergedList);
  if (!row || isTombstone(row)) return;

  const setters = [
    ['weight_date_edit_enabled', Storage.loadWeightDateEditEnabled, Storage.saveWeightDateEditEnabled],
    ['deload_date_edit_enabled', Storage.loadDeloadDateEditEnabled, Storage.saveDeloadDateEditEnabled],
    ['fatigue_tracking_enabled', Storage.loadFatigueTrackingEnabled, Storage.saveFatigueTrackingEnabled],
    ['deload_mode_enabled', Storage.loadDeloadModeEnabled, Storage.saveDeloadModeEnabled],
  ];
  for (const [field, load, save] of setters) {
    if (typeof row[field] !== 'boolean') continue;
    // eslint-disable-next-line no-await-in-loop
    const local = !!(await load());
    // eslint-disable-next-line no-await-in-loop
    if (local !== row[field]) await save(row[field]);
  }
}

// weight_goal ----------------------------------------------------------------

async function buildWeightGoalRecords() {
  const goal = await Storage.loadWeightGoal();
  if (!goal) return [];
  const record = { id: SINGLETON_SYNC_ID };
  for (const field of WEIGHT_GOAL_SYNC_FIELDS) {
    record[field] = goal[field] ?? null;
  }
  return [record];
}

async function applyWeightGoal(mergedList) {
  const row = singletonRow(mergedList);
  const existing = await Storage.loadWeightGoal();

  // A tombstoned (or absent) goal means the goal was cleared. Removing it locally
  // is what stops the next pass from re-pushing it — no resurrection.
  if (!row || isTombstone(row)) {
    if (existing) await Storage.clearWeightGoal();
    return;
  }

  // Merge so any local-only key on the goal object survives the round trip.
  const next = { ...(existing || {}) };
  for (const field of WEIGHT_GOAL_SYNC_FIELDS) {
    next[field] = row[field] ?? null;
  }
  if (stableStringify(next) !== stableStringify(existing)) {
    await replaceWeightGoalRaw(next);
  }
}

// deload_history -------------------------------------------------------------

const DELOAD_HISTORY_FIELDS = Object.freeze(['date', 'raw_text', 'record_json', 'saved_at']);

async function buildDeloadHistoryRecords() {
  const list = (await Storage.loadDeloadHistory()) || [];
  return list
    .filter((record) => record && record.id != null)
    .map((record) => ({
      id: record.id,
      date: record.date ?? null,
      raw_text: record.raw_text ?? null,
      record_json: buildDeloadRecordJson(record),
      saved_at: record.saved_at ?? null,
    }));
}

// Project a merged cloud row back onto the flat local deload-record shape,
// preserving any local key the cloud does not carry.
function toLocalDeloadRecord(existing, row) {
  const record = {
    ...(existing || {}),
    id: row.id,
    date: row.date ?? null,
    raw_text: row.raw_text ?? null,
    saved_at: row.saved_at ?? null,
  };
  const json =
    row.record_json && typeof row.record_json === 'object' ? row.record_json : {};
  for (const key of DELOAD_RECORD_JSON_FIELDS) {
    if (json[key] !== undefined) record[key] = json[key];
  }
  return record;
}

async function applyDeloadHistory(mergedList) {
  const existing = (await Storage.loadDeloadHistory()) || [];
  const mergedById = new Map();
  for (const row of mergedList) {
    if (row && row.id != null) mergedById.set(row.id, row);
  }

  // Keep the existing local order, drop tombstoned records, then append records
  // that only exist remotely. O(local + merged), no nested scan.
  const next = [];
  const seen = new Set();
  for (const record of existing) {
    if (!record || record.id == null) continue;
    const row = mergedById.get(record.id);
    seen.add(record.id);
    if (!row) {
      next.push(record);
      continue;
    }
    if (isTombstone(row)) continue;
    next.push(toLocalDeloadRecord(record, row));
  }
  for (const row of mergedList) {
    if (!row || row.id == null || seen.has(row.id) || isTombstone(row)) continue;
    next.push(toLocalDeloadRecord(null, row));
  }

  if (stableStringify(next) !== stableStringify(existing)) {
    await writeList(WORKOUT_DELOAD_HISTORY_KEY, next);
  }
}

// fatigue_checkins (derived projection, issue #498) ---------------------------
//
// Canonical is workout_notes.session_checkins. These rows are DERIVED from the
// converged workout-note state (buildLocal reads the same raw notebook the
// workout_notes pass just merged), so every device produces the identical
// projection and repeated passes are idempotent. The projection is
// one-directional: applyFatigueCheckins is a deliberate no-op — a pulled remote
// fatigue row is NEVER written back into a note, so it can never become a second
// source of truth or mutate session_checkins. The syncDiffTable snapshot handles
// create/update/tombstone deterministically: a check-in that stops being derived
// (removed, or its source note deleted/tombstoned) drops out of buildLocal and is
// tombstoned against the snapshot without resurrection.

const FATIGUE_CHECKIN_FIELDS = Object.freeze([
  'workout_note_id',
  'session_date',
  'status',
  'reasons',
  'source_json',
]);

async function buildFatigueCheckinRecords() {
  const notes = await Storage.loadWorkoutNotesRaw();
  return deriveFatigueCheckinRows(notes);
}

// Intentionally does nothing: the canonical session_checkins on each note is the
// only source of truth, and syncDiffTable already persists the reconciled snapshot
// this table needs. Writing merged rows anywhere else would create a second copy.
async function applyFatigueCheckins() {}

// Sync order note: workout_notes runs before user_health_profile, so a routine
// pulled in the same pass already exists locally by the time
// current_workout_note_id points at it.
const DIFF_TABLES = Object.freeze([
  {
    // Derived from the converged workout_notes just synced above. Runs first among
    // the diff tables so it reflects the notebook's settled state this pass.
    table: SYNC_TABLES.FATIGUE_CHECKINS,
    buildLocal: buildFatigueCheckinRecords,
    applyMerged: applyFatigueCheckins,
    payloadFields: FATIGUE_CHECKIN_FIELDS,
    fieldKinds: {},
    // A removed check-in or a deleted source note must tombstone the derived row.
    allowDelete: true,
  },
  {
    table: SYNC_TABLES.DELOAD_HISTORY,
    buildLocal: buildDeloadHistoryRecords,
    applyMerged: applyDeloadHistory,
    payloadFields: DELOAD_HISTORY_FIELDS,
    fieldKinds: { saved_at: 'timestamp' },
    allowDelete: true,
  },
  {
    table: SYNC_TABLES.WEIGHT_GOAL,
    buildLocal: buildWeightGoalRecords,
    applyMerged: applyWeightGoal,
    payloadFields: WEIGHT_GOAL_SYNC_FIELDS,
    fieldKinds: {
      target_weight: 'number',
      start_weight: 'number',
      saved_at: 'timestamp',
    },
    // The active goal can be cleared, so a locally-missing goal is a real delete.
    allowDelete: true,
  },
  {
    table: SYNC_TABLES.FEATURE_TOGGLES,
    buildLocal: buildFeatureToggleRecords,
    applyMerged: applyFeatureToggles,
    payloadFields: FEATURE_TOGGLE_FIELDS,
    fieldKinds: {},
    // Toggles always exist (they fall back to defaults); there is nothing to delete.
    allowDelete: false,
    isEmptyLocal: isDefaultFeatureToggles,
  },
  {
    table: SYNC_TABLES.USER_PROFILE,
    buildLocal: buildUserProfileRecords,
    applyMerged: applyUserProfile,
    payloadFields: USER_PROFILE_FIELDS,
    fieldKinds: {},
    allowDelete: false,
    isEmptyLocal: isEmptyUserProfile,
  },
  {
    // Consent-gated (#487). A user without an active grant is denied this table by
    // RLS while their account settings above keep syncing normally.
    table: SYNC_TABLES.USER_HEALTH_PROFILE,
    buildLocal: buildUserHealthProfileRecords,
    applyMerged: applyUserHealthProfile,
    payloadFields: USER_HEALTH_PROFILE_FIELDS,
    fieldKinds: {
      fatigue_multiplier: 'number',
      current_deload_note_saved_at: 'timestamp',
      current_deload_note_updated_at: 'timestamp',
    },
    allowDelete: false,
    isEmptyLocal: isEmptyUserHealthProfile,
  },
]);

// A status read must not run a sync pass just to learn whether a save still
// needs upload. Collection writes are already present in the persisted dirty
// queue; the settings/history tables below intentionally have no write-time
// queue hooks, so compare their live projection to the last server-confirmed
// snapshot using the same diff as syncDiffTable. This function never stamps,
// enqueues, pulls, pushes, or changes a snapshot.
//
// fatigue_checkins is deliberately excluded. It is a deterministic projection
// of workout_notes, not a user-authored intent in its own right; any source
// note change is already represented by the collection queue or health profile.
const STATUS_DIFF_TABLES = Object.freeze(
  DIFF_TABLES.filter(({ table }) => table !== SYNC_TABLES.FATIGUE_CHECKINS)
);

// The recovery collections have no write-time queue hook (see the recovery
// methods in storage/cloudAdapter.js): the domain writes them through the same
// storage module in both adapter modes, and the sync engine picks the change up
// through reconcileSignedOutWrites at the start of the next pass. That is what
// makes them correct, but it also means their dirty queue is EMPTY between the
// write and that pass — so reading the queue alone would report "nothing to
// upload" over a recovery block the user just created.
//
// Reconciling against the persisted baseline is the same evidence the pass
// itself uses, so the count reported here is the count the next pass will push.
// Pure: it reads local state and the snapshot, and enqueues/stamps nothing (the
// stamped records reconcileAgainstBaseline builds are counted and discarded).
// The other three collection tables are deliberately not read this way — they DO
// enqueue at write time, so their queue is already the answer.
const STATUS_RECONCILED_COLLECTION_TABLES = RECOVERY_SYNC_TABLES;

export async function getPendingSyncIntent() {
  const dirtyByTable = await Promise.all(
    Object.values(SYNC_TABLES).map(async (table) => ({
      table,
      records: await getDirtyRecords(table),
    }))
  );
  const dirtyCount = dirtyByTable.reduce((count, { records }) => count + records.length, 0);

  const tableIo = createTableIo(() => {});
  const reconciled = await Promise.all(
    STATUS_RECONCILED_COLLECTION_TABLES.map(async (table) => {
      const baseline = await getSyncSnapshot(table);
      // No baseline: this device has no server-confirmed state to diff against,
      // so it cannot claim an upload is pending. Same rule as the diff tables.
      if (baseline == null) return { table, count: 0 };
      const { dirty } = reconcileAgainstBaseline({
        current: (await tableIo[table].read()) || [],
        baseline,
        clientId: 'pending-intent-read',
      });
      // A record already sitting in the dirty queue is counted once, above.
      const queued = new Set(
        (dirtyByTable.find((entry) => entry.table === table)?.records || []).map((r) => r.id)
      );
      return { table, count: dirty.filter((rec) => !queued.has(rec.id)).length };
    })
  );
  const reconciledCount = reconciled.reduce((count, result) => count + result.count, 0);

  const diffed = await Promise.all(
    STATUS_DIFF_TABLES.map(async (config) => {
      const baseline = await getSyncSnapshot(config.table);
      // No snapshot means this device has no server-confirmed baseline to
      // compare against. Treat that as local cache rather than inventing an
      // upload claim; the first real pass establishes the baseline safely.
      if (baseline == null) return { table: config.table, count: 0 };
      const current = (await config.buildLocal()) || [];
      const { dirty } = diffAgainstBaseline({
        current,
        baseline,
        // The value is never persisted: diffing needs an id only to construct
        // hypothetical records, and we retain only the count.
        clientId: 'pending-intent-read',
        payloadFields: config.payloadFields,
        fieldKinds: config.fieldKinds,
        allowDelete: config.allowDelete,
        isEmptyLocal: config.isEmptyLocal,
      });
      return { table: config.table, count: dirty.length };
    })
  );
  const diffCount = diffed.reduce((count, result) => count + result.count, 0);

  return {
    hasPending: dirtyCount + diffCount + reconciledCount > 0,
    dirtyCount,
    diffCount,
    reconciledCount,
    tables: [...dirtyByTable, ...diffed, ...reconciled]
      .filter(({ records, count }) => (records ? records.length : count) > 0)
      .map(({ table }) => table)
      .filter((table, index, all) => all.indexOf(table) === index),
  };
}

// Consent (#487) is deliberately NOT checked here. This module is transport-
// agnostic by contract — the transport is injected, and the tests drive it with no
// Supabase client at all — so an authorization call in this loop would be both out
// of place and unenforceable. The gate lives at the app seam
// (hooks/entries/syncRecoveryHooks.js), which is where a denial becomes a screen
// the user can act on, and the real boundary is the server's RLS, which refuses
// these reads and writes whether or not any client ever asks.
// `ownedDevice` (issue #525, round 4) is the ONLY behavioural input this function
// takes, and it matters solely on the one upgrade-window pass where a collection
// table has no baseline yet AND its stored cursor is missing. It is false by
// default so a clean-device first download, the #538 post-purge rebuild, the
// background maybeSyncCloud refresh, and every test that calls sync() bare all get
// the safe non-blocking behaviour (restore the remote set, never conflict). The
// app layer passes true only from the ordinary owned-device sync paths — automatic
// same-owner sign-in sync and manual "Sync Now" — where an absent-local remote row
// under a cleared cursor is an unclassifiable signed-out delete that must surface
// an honest conflict instead of being silently restored as success. See
// reconcileAgainstRemote for why local data alone cannot make this call.
//
// Sync mutates a shared collection of local records, cursors, dirty queues, and
// diff snapshots. It therefore cannot safely be re-entrant: two passes can both
// snapshot the same dirty batch, then each clear bookkeeping the other still
// needs. Keep every cloud operation in one process-local queue. Calls with the
// same transition context share the exact promise/pass; callers with different
// `ownedDevice` meaning are deliberately serialized as separate passes so a
// first-download caller can never inherit an owned-device conflict decision (or
// vice versa).
let cloudOperationTail = Promise.resolve();
const inFlightSyncs = new Map();
let inFlightRebuild = null;

function enqueueCloudOperation(operation) {
  const scheduled = cloudOperationTail.then(operation, operation);
  // Keep the queue available after a failed pass while returning the original
  // rejecting promise to its caller.
  cloudOperationTail = scheduled.catch(() => {});
  return scheduled;
}

// Raised at the END of a pass whose recovery-block work failed while every other
// table completed. Carries the first underlying failure as `cause` so the app's
// error surface can still show what actually went wrong.
export class RecoverySyncError extends Error {
  constructor(failures) {
    const [first] = failures;
    super(
      `Recovery-block sync failed for ${failures.map((f) => f.table).join(', ')}: ` +
        `${first?.error?.message || first?.error || 'unknown error'}. Every other table synced.`
    );
    this.name = 'RecoverySyncError';
    this.failures = failures;
    this.recoverySyncFailure = true;
    if (first?.error !== undefined) this.cause = first.error;
  }
}

// The three collection tables with no dependency on each other (issue #806).
// weight_entries, workout_notes, and archived_weight_goals reference nothing in
// one another, are stored under distinct keys, keep distinct cursors, dirty
// queues, and baselines, and their pulls are independent server reads — so
// running them together is a pure overlap of three round trips, not a reordering
// of anything. The two recovery collections are deliberately excluded: a block
// must not be pushed before the note its baseline names, and a membership must
// not be pushed before its block. They stay strictly sequential, after this
// group, exactly as COLLECTION_SYNC_TABLES documents.
const INDEPENDENT_COLLECTION_TABLES = Object.freeze(
  COLLECTION_SYNC_TABLES.filter((table) => !RECOVERY_SYNC_TABLES.includes(table))
);

// Run independent table passes together and settle every one of them before
// raising anything. `Promise.all` would reject at the first failure while the
// others kept running unobserved, which is exactly the "reports failure over
// work that is still in flight" shape the pass must not have. Settling first
// means every table either completed and recorded its own consistent
// cursor/baseline or failed on its own, and only then does the first failure
// fail the pass — the same outcome the sequential loop produced, minus the
// tables it used to skip on the way out.
// Collect deferred recovery resolutions into one batch per table, preserving the
// order they were produced in. Shared by the converging rerun loop and the
// failure drain so both queue the same way.
function groupResolutionsByTable(resolutions) {
  const byTable = new Map();
  for (const { table, record } of resolutions) {
    const batch = byTable.get(table);
    if (batch) batch.push(record);
    else byTable.set(table, [record]);
  }
  return byTable;
}

async function runIndependentPasses(tasks) {
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
  return settled.map((outcome) => outcome.value);
}

async function runSyncPass({ ownedDevice = false } = {}) {
  const pendingWorkoutNoteTombstones = [];
  const pendingRecoveryResolutions = [];
  const cache = createPassCache();
  const tableIo = createTableIo(
    (tombstone) => pendingWorkoutNoteTombstones.push(tombstone),
    (table, record) => pendingRecoveryResolutions.push({ table, record }),
    cache
  );
  // Before anything else: adopt writes made while signed out (#525). A failure
  // here propagates, so the SYNC phase fails and the user sees a retryable state
  // rather than a success that silently left local data behind.
  const reconciliation = await reconcileSignedOutWrites(tableIo);

  // Each reconciliation result already reports whether this table had a baseline
  // (`deferred` is exactly "no baseline yet"), read moments ago from the same
  // storage syncTable would read again. Hand that answer over instead, once per
  // table: it is consumed by the FIRST pass for the table, because any later
  // rerun in this same pass runs after a baseline has been recorded and the
  // answer no longer holds (issue #806). A table whose reconciliation failed
  // contributes no hint, so its pass reads the baseline itself.
  const unbaselinedHints = new Map();
  for (const result of reconciliation) {
    if (result && !result.error) unbaselinedHints.set(result.table, Boolean(result.deferred));
  }
  const takeUnbaselinedHint = (table) => {
    if (!unbaselinedHints.has(table)) return null;
    const hint = unbaselinedHints.get(table);
    unbaselinedHints.delete(table);
    return hint;
  };
  // Isolated recovery failures (#693) are carried, not thrown, so the pass keeps
  // going for every unrelated table; they are raised together at the end.
  //
  // A failed RECONCILIATION is terminal for this pass and is never cleared by a
  // later success: it means local writes were not enqueued, so a table sync that
  // then "succeeds" has pushed an incomplete set and would record a baseline that
  // launders the rest into looking synced. A failed PUSH is different — the rows
  // are still queued — so it is keyed by table and dropped as soon as a later
  // attempt for that table lands, which is what stops the converging rerun below
  // from reporting a failure over data that did reach the cloud.
  const terminalFailures = reconciliation
    .filter((result) => result && result.error)
    .map(({ table, error }) => ({ table, error }));
  const pushFailures = new Map();
  const results = [];

  // Isolation between the recovery tables and everything else is the point;
  // isolation BETWEEN the two recovery tables is not, because memberships depend
  // on their blocks. The cascade below can only act on a tombstone a successful
  // block PULL delivered, so after a failed block pass local state still shows
  // every parent live and the cascade correctly finds nothing to do — while an
  // unconditional membership pass would upload a membership created offline
  // against a block that is deleted remotely. The foreign key accepts it (the
  // tombstoned parent row is physically present), so the stranded note returns
  // through the failure path. The membership pass therefore runs only when the
  // most recent block attempt of this pass succeeded.
  let blocksSynced = false;
  let weeksDeferred = false;

  const syncRecoveryTable = async (table) => {
    if (table === SYNC_TABLES.RECOVERY_BLOCK_WEEKS && !blocksSynced) {
      // Not a failure of its own: the block failure is already recorded and is
      // what fails this pass. The rows stay queued and this device pushes them
      // once it can see the blocks they belong to.
      weeksDeferred = true;
      results.push({ table, skipped: true, dependsOn: SYNC_TABLES.RECOVERY_BLOCKS });
      return;
    }
    try {
      // Every membership pass is preceded by the cascade, reruns included: the
      // blocks pass immediately before it may have pulled a tombstone, and a
      // membership left live under a deleted block would upload and strand its
      // note. Throwing here deliberately skips the push rather than sending a
      // set this device knows is inconsistent.
      if (table === SYNC_TABLES.RECOVERY_BLOCK_WEEKS) {
        await cascadeDeletedBlockMemberships(cache);
      }
      results.push(await syncOne(table, tableIo, ownedDevice, takeUnbaselinedHint(table)));
      if (table === SYNC_TABLES.RECOVERY_BLOCKS) blocksSynced = true;
      if (table === SYNC_TABLES.RECOVERY_BLOCK_WEEKS) weeksDeferred = false;
      pushFailures.delete(table);
    } catch (error) {
      if (table === SYNC_TABLES.RECOVERY_BLOCKS) blocksSynced = false;
      results.push({ table, failed: true, error });
      pushFailures.set(table, error);
    }
  };

  // Rows a table's write DEFERRED (phantom-note tombstones, collapsed recovery
  // duplicates) exist only in these in-memory lists until they are queued. That
  // is fine while the pass runs to completion — it enqueues and reruns them
  // below — but a table that COMPLETED and deferred rows has already recorded a
  // baseline containing them, so the next pass's reconciliation finds no local
  // difference and never rediscovers them. If the pass is about to fail for an
  // unrelated reason, the deferred rows must reach the durable dirty queue
  // first, or a tombstone this device minted is silently never uploaded and the
  // phantom row lives on in the cloud.
  const drainDeferredWrites = async () => {
    if (pendingWorkoutNoteTombstones.length > 0) {
      await enqueueDirtyMany(
        SYNC_TABLES.WORKOUT_NOTES,
        pendingWorkoutNoteTombstones.splice(0)
      );
    }
    if (pendingRecoveryResolutions.length === 0) return;
    for (const [table, batch] of groupResolutionsByTable(
      pendingRecoveryResolutions.splice(0)
    )) {
      // eslint-disable-next-line no-await-in-loop
      await enqueueDirtyMany(table, batch);
    }
  };

  try {
    await tombstoneLocalPhantoms(cache);
    results.push(
      ...(await runIndependentPasses(
        INDEPENDENT_COLLECTION_TABLES.map(
          (table) => () => syncOne(table, tableIo, ownedDevice, takeUnbaselinedHint(table))
        )
      ))
    );
    for (const table of RECOVERY_SYNC_TABLES) {
      // eslint-disable-next-line no-await-in-loop
      await syncRecoveryTable(table);
    }
    if (pendingWorkoutNoteTombstones.length > 0) {
      const tombstones = pendingWorkoutNoteTombstones.splice(0);
      await enqueueDirtyMany(SYNC_TABLES.WORKOUT_NOTES, tombstones);
      // No baseline hint: the pass above already recorded one for this table.
      results.push(await syncOne(SYNC_TABLES.WORKOUT_NOTES, tableIo, ownedDevice));
    }

    // Collapsed cross-device duplicates (issue #693). The write that produced them
    // ran inside syncTable, which snapshots and clears its dirty batch around
    // writeLocal, so — exactly like the phantom-note tombstones above — they are
    // enqueued here and pushed by a rerun of their own table. This is what makes a
    // two-device duplicate converge inside ONE sync() call: the first attempt is
    // rejected by the partial unique index, the merge that follows collapses the
    // duplicate locally, and this rerun uploads the collapsed rows.
    //
    // Drained in a bounded loop because a rerun can itself pull a row that
    // collapses. Every resolved row MUST be enqueued before its table records a
    // baseline, or the baseline would launder a local-only change into looking
    // synced — the invariant syncTable documents at step 6. In practice the
    // collapse is idempotent and the first round settles it; the bound exists so a
    // pathological case ends the pass rather than spinning, and anything still
    // pending is carried by the dirty queue into the next one.
    for (let round = 0; round < 3 && pendingRecoveryResolutions.length > 0; round += 1) {
      const byTable = groupResolutionsByTable(pendingRecoveryResolutions.splice(0));
      const tables = [...byTable.keys()];
      for (const [table, batch] of byTable) {
        // eslint-disable-next-line no-await-in-loop
        await enqueueDirtyMany(table, batch);
      }
      // Preserve the blocks-before-memberships dependency order on the rerun too.
      for (const table of RECOVERY_SYNC_TABLES) {
        if (!tables.includes(table)) continue;
        // eslint-disable-next-line no-await-in-loop
        await syncRecoveryTable(table);
      }
    }

    // A block rerun above can recover a block pass that failed earlier in this
    // same pass. The memberships deferred by that failure are safe to sync now —
    // this device has seen the blocks — so run them rather than making the user
    // wait for another pass to push rows that are already reconciled.
    if (weeksDeferred && blocksSynced) {
      await syncRecoveryTable(SYNC_TABLES.RECOVERY_BLOCK_WEEKS);
    }

    // The tables bootstrap used to push once and abandon (issue #489). Run them
    // after the workout-note passes above (including the phantom-tombstone rerun,
    // which can clear the current routine) so user_health_profile uploads the
    // settled current_workout_note_id rather than one this pass is about to drop.
    //
    // The six run TOGETHER (issue #806). Each owns a distinct set of local storage
    // keys, a distinct cursor, dirty queue and baseline, and none reads a value
    // another one writes — so there is no order among them to preserve, and the
    // only thing serializing them bought was six round trips end to end instead of
    // one. The orders that DO matter are unchanged: every collection pass above
    // has already completed, so fatigue_checkins still projects the settled
    // notebook and user_health_profile still uploads a current_workout_note_id
    // this pass is not about to drop.
    const singletonAware = withSingletonIds(getTransport());
    const diffConfigs = DIFF_TABLES.map((config) =>
      config.table === SYNC_TABLES.FATIGUE_CHECKINS
        ? {
            ...config,
            // Derived from the same converged notebook the collection pass just
            // wrote, read from the pass cache instead of decrypting and parsing
            // every note a second time.
            buildLocal: async () =>
              deriveFatigueCheckinRows(
                await cache.read(SYNC_TABLES.WORKOUT_NOTES, Storage.loadWorkoutNotesRaw)
              ),
          }
        : config
    );
    results.push(
      ...(await runIndependentPasses(
        diffConfigs.map(
          (config) => () => syncDiffTable({ ...config, transport: singletonAware })
        )
      ))
    );
  } catch (error) {
    // Best effort, and deliberately not allowed to replace the failure the user
    // needs to see: if this drain also fails the deferred rows are exactly as
    // lost as they would have been without it, while the original error is the
    // one that explains the failed pass.
    await drainDeferredWrites().catch(() => {});
    throw error;
  }

  // Every unrelated table is now synced and persisted. What remains unresolved is
  // reported here, and it IS reported: swallowing it would let the UI claim
  // "Fully synced" over recovery data that never reached the cloud, which is the
  // same contract failure #525 exists to close. A rejection that the collapse
  // rerun then resolved is deliberately NOT reported — the rows did reach the
  // cloud, and an error the user cannot act on is its own kind of dishonesty.
  const recoveryFailures = [
    ...terminalFailures,
    ...[...pushFailures].map(([table, error]) => ({ table, error })),
  ];
  if (recoveryFailures.length > 0) throw new RecoverySyncError(recoveryFailures);

  return results;
}

export function sync({ ownedDevice = false } = {}) {
  const key = ownedDevice ? 'owned-device' : 'first-download';
  const inFlight = inFlightSyncs.get(key);
  if (inFlight) return inFlight;

  const pass = enqueueCloudOperation(() => runSyncPass({ ownedDevice }));
  inFlightSyncs.set(key, pass);
  const clearInFlight = () => {
    if (inFlightSyncs.get(key) === pass) inFlightSyncs.delete(key);
  };
  // Handle both paths rather than `finally`, whose returned rejection would be
  // detached from callers and can become an unhandled rejection in React Native.
  pass.then(clearInFlight, clearInFlight);
  return pass;
}

// ── reconsent cloud rebuild (issue #538) ─────────────────────────────────────
//
// A completed withdrawal purge empties every gated table server-side. If the
// SAME device later re-grants, its dirty queue is already empty (everything it
// held was acknowledged before withdrawal) and every diff-tracked table's
// last-synced snapshot already agrees with what is now an intentionally empty
// cloud copy — so ordinary sync() above has nothing to detect and pushes
// nothing. The server tells the client this explicitly via a monotonic
// consent_state.cloud_rebuild_generation (storage/cloud/consent.js); when the
// server's generation is ahead of the one THIS device last rebuilt for
// (storage/entries/localDataOwner.js), the app runs rebuildCloudCopy() instead
// of an ordinary sync pass (see hooks/entries/syncRecoveryHooks.js).
//
// The rebuild reuses the SAME engine ordinary sync() uses for every one of the
// seven gated tables, rather than a separate one-off upload path: it only
// rearms each table's local bookkeeping so the next sync() pass treats every
// local record — live rows AND tombstones, since a tombstone is itself a row
// the purge deleted and omitting it would leave row-count parity wrong even
// though it stays invisible — as unpushed, then lets the ordinary
// pull/push/merge loop do the actual work. That keeps tombstone handling, LWW,
// and cursor advancement identical to every other sync pass instead of a
// second, differently-tested code path, and it naturally never pulls the
// (intentionally empty) post-purge cloud snapshot over local state first: the
// merge step unions local-only records straight into the push set exactly as
// it does for any other unsynced local write.
// The same dirty-queue-tracked collections defined above; every one of them is
// consent-gated and therefore emptied by a withdrawal purge. The two recovery
// collections (#693) are gated the same way and are included for the same
// reason — a rebuild that skipped them would leave the account's recovery
// history on the device only.
const REBUILD_COLLECTION_TABLES = COLLECTION_SYNC_TABLES;

// The diff-tracked tables among the seven gated ones. FEATURE_TOGGLES and
// USER_PROFILE are diff-tracked too but are NOT gated/purged — a withdrawal
// never touches them — so they are deliberately excluded: there is nothing on
// them to rebuild.
const REBUILD_DIFF_TABLES = Object.freeze([
  SYNC_TABLES.USER_HEALTH_PROFILE,
  SYNC_TABLES.WEIGHT_GOAL,
  SYNC_TABLES.DELOAD_HISTORY,
  SYNC_TABLES.FATIGUE_CHECKINS,
]);

// Re-enqueue every local record (including tombstones) of a dirty-queue
// tracked collection table, so the next syncTable pass pushes the complete
// local set instead of only whatever a write-time hook already queued.
// Idempotent: re-enqueuing an id already in the dirty queue just overwrites
// its snapshot with the same value, and clearing an already-clear cursor is a
// no-op — so re-running this after a partial or retried rebuild is safe.
async function reseedCollectionTable(table, readLocal) {
  const list = (await readLocal()) || [];
  await enqueueDirtyMany(
    table,
    list.filter((record) => record && record.id != null)
  );
  await clearCursor(table);
}

// Rearm every consent-gated table for a full reupload.
async function runRearmGatedTablesForRebuild() {
  const tableIo = createTableIo(() => {});
  for (const table of REBUILD_COLLECTION_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await reseedCollectionTable(table, tableIo[table].read);
  }
  for (const table of REBUILD_DIFF_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await clearSyncSnapshot(table);
    // eslint-disable-next-line no-await-in-loop
    await clearCursor(table);
  }
}

export function rearmGatedTablesForRebuild() {
  return enqueueCloudOperation(runRearmGatedTablesForRebuild);
}

// The full post-purge cloud rebuild: rearm every gated table, push everything
// through the ordinary sync loop, then run one more ordinary sync pass as the
// reconciliation the acceptance criteria require — proving the rebuild
// converged and picking up anything another device pushed concurrently.
//
// Recording that this device has caught up to the server's rebuild generation
// is the CALLER's job (syncRecoveryHooks.js), done only after this resolves
// successfully: keeping the per-device generation write next to the phase
// runner is what makes "the rebuild finished" and "we recorded that it
// finished" a single retryable unit. A failure at any step propagates,
// mirroring sync()'s own contract so the existing runPhase failure handling
// applies unchanged: local data is never touched by a failure here, this
// device's persisted generation is not advanced, and the next launch simply
// sees the server generation still ahead and rebuilds again. Every retry — a
// fresh rearm, a re-push of already-acknowledged rows — is idempotent: it can
// duplicate network traffic but never duplicate rows or lose data.
export function rebuildCloudCopy() {
  if (inFlightRebuild) return inFlightRebuild;

  const rebuild = enqueueCloudOperation(async () => {
    // Do not call the public queued functions from inside this operation: that
    // would enqueue work behind this rebuild and deadlock. The enclosing queue
    // already gives these three steps exclusive access.
    await runRearmGatedTablesForRebuild();
    const rebuildResults = await runSyncPass();
    const reconciliationResults = await runSyncPass();
    return { ok: true, results: [...rebuildResults, ...reconciliationResults] };
  });
  inFlightRebuild = rebuild;
  const clearInFlight = () => {
    if (inFlightRebuild === rebuild) inFlightRebuild = null;
  };
  rebuild.then(clearInFlight, clearInFlight);
  return rebuild;
}
