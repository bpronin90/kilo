import * as Storage from '../entries';
import {
  loadArchivedWeightGoalsRaw,
  replaceArchivedWeightGoalsRaw,
} from '../entries/weightGoal';
import {
  SYNC_TABLES,
  isTombstone,
  stampWrite,
  stampTombstone,
  getClientId,
  enqueueDirtyMany,
} from '../syncQueue';
import {
  resolveDuplicateActiveBlocks,
  resolveDuplicateWeekMemberships,
  isLiveRecoveryRecord,
} from './syncRecoveryResolution';

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
export function createPassCache() {
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
export async function tombstoneLocalPhantoms(cache) {
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

// Every `write` returns the list it actually persisted, which is what syncTable
// records as the table's baseline (issue #806) — see the deliberate transforms
// on workout_notes and the two recovery collections below.
export function createTableIo(
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
// Every other synced table is diff-tracked (see DIFF_TABLES in syncSingletons.js),
// which detects local change by comparing live state against a snapshot instead.
//
// ORDER IS PART OF THE CONTRACT (issue #693). The list is walked in sequence by
// runSyncPass, and the last two tables reference rows in tables above them: a
// recovery block names the workout note its frozen baseline was captured from,
// and a membership names both its block and its note. Syncing them in this order
// is what makes a reference arrive after the row it points at, so a second
// device never sees a block whose baseline routine it has not downloaded yet.
export const COLLECTION_SYNC_TABLES = Object.freeze([
  SYNC_TABLES.WEIGHT_ENTRIES,
  SYNC_TABLES.WORKOUT_NOTES,
  SYNC_TABLES.ARCHIVED_WEIGHT_GOALS,
  SYNC_TABLES.RECOVERY_BLOCKS,
  SYNC_TABLES.RECOVERY_BLOCK_WEEKS,
]);
