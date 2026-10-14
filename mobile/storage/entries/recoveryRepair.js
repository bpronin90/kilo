// Bounded local repair of persisted Recovery inconsistencies (#1368).
//
// Runs under the exclusive Recovery access boundary (see
// recoveryJournalReplay.js), after journal replay, before authoritative
// publication. It performs exactly four automatic repairs, each through the
// SAME helpers cloud resolution uses (syncRecoveryResolution.js), so local and
// cloud share one policy:
//
//   1. explicit parent tombstone  -> tombstone surviving live memberships
//   2. several active blocks      -> complete the older ones (latest start wins)
//   3. duplicate note memberships -> tombstone the later ones
//   4. duplicate week ordinals    -> renumber, only when the output stays a
//                                    positive safe integer
//
// BINDING INVARIANT: no record is ever removed from kilo_recovery_blocks /
// kilo_recovery_block_weeks. A repair only rewrites an existing row (completion,
// tombstone, ordinal) with sync stamping, so the existing sync protocol sees an
// ordinary edit, never an absence it could read as a deletion. Everything else
// (missing parent, malformed, duplicate ids, baseline-note membership, unsafe
// ordinals, unreadable payloads) is left byte-for-byte in place; the read state
// classifies it with `isRecoveryDataResolved` and reports it as unresolved.
//
// Persistence order: dirty-enqueue BEFORE the raw write (a crash in between
// leaves a deterministic, valid queued value rather than an applied repair the
// queue never heard of), blocks before weeks, then a re-read verifies. A change
// that raced the read aborts without writing; Retry recomputes.

import { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } from './keys';
import { readList } from './jsonStorage';
import { getClientId, enqueueDirtyMany, SYNC_TABLES } from '../syncQueue';
import {
  planDeletedBlockCascade,
  resolveDuplicateActiveBlocks,
  resolveDuplicateWeekMemberships,
  isLiveRecoveryRecord,
  recoveryInstant,
} from '../cloud/syncRecoveryResolution';
import { arePersistedRecoveryRecordsWellFormed } from '../../lib/data/activeTrainingContext';
import { replaceRecoveryBlocksRaw, replaceRecoveryBlockWeeksRaw } from './recoveryStorage';

const isTimestamp = (v) => recoveryInstant(v) !== null;
const hasUniqueIds = (list) => new Set(list.map((r) => r.id)).size === list.length;

// Pure plan. `changed*` are the rewritten rows; lists keep every input row.
export function planRecoveryRepair(blocks, weeks, clientId) {
  const none = { blocks, weeks, changedBlocks: [], changedWeeks: [] };
  // Shape or identity problems make every winner arbitrary: repair nothing.
  if (!arePersistedRecoveryRecordsWellFormed(blocks, weeks)) return none;
  if (!hasUniqueIds(blocks) || !hasUniqueIds(weeks)) return none;

  let nextBlocks = blocks;
  let changedBlocks = [];
  const active = blocks.filter((b) => isLiveRecoveryRecord(b) && !b.completed_at);
  if (active.length > 1 && active.every((b) => isTimestamp(b.started_at))) {
    const resolved = resolveDuplicateActiveBlocks(blocks, clientId);
    nextBlocks = resolved.list;
    changedBlocks = resolved.changed;
  }

  const cascade = planDeletedBlockCascade(blocks, weeks, clientId);
  let nextWeeks = cascade.list;
  const changedWeeks = new Map(cascade.cascaded.map((w) => [w.id, w]));

  // Only memberships whose parent is a live block and that are not the block's
  // own baseline note take part. A missing-parent or baseline-note row depends
  // on unresolved data, so it neither wins nor loses a collision here.
  const liveBlocks = new Map(blocks.filter(isLiveRecoveryRecord).map((b) => [b.id, b]));
  const eligible = (w) => {
    const parent = liveBlocks.get(w.block_id);
    return isLiveRecoveryRecord(w) && !!parent && w.note_id !== parent.baseline_note_id;
  };
  const candidates = nextWeeks.filter(eligible);
  if (candidates.length > 1 && candidates.every((w) => isTimestamp(w.saved_at))) {
    const resolved = resolveDuplicateWeekMemberships(candidates, clientId);
    for (const w of resolved.changed) changedWeeks.set(w.id, w);
  }
  if (changedWeeks.size > 0) {
    nextWeeks = nextWeeks.map((w) => changedWeeks.get(w.id) || w);
  }
  return { blocks: nextBlocks, weeks: nextWeeks, changedBlocks, changedWeeks: [...changedWeeks.values()] };
}

// Lazy: './storageMode' pulls in the adapters, which import storage/entries and
// would create a load-order cycle with this module's importers.
function isCloudMode() {
  const { getStorageMode, STORAGE_MODES } = require('./storageMode');
  return getStorageMode() === STORAGE_MODES.CLOUD;
}

async function persist(table, key, original, next, changed, replace) {
  if (changed.length === 0) return;
  // Lost-update guard: the lock covers journaled actions, not every writer.
  const current = await readList(key);
  if (JSON.stringify(current) !== JSON.stringify(original)) {
    throw new Error('Recovery records changed while repairing; retry.');
  }
  if (isCloudMode()) await enqueueDirtyMany(table, changed);
  await replace(next);
  const verify = await readList(key);
  if (JSON.stringify(verify) !== JSON.stringify(next)) {
    throw new Error('Recovery repair could not be verified after writing.');
  }
}

// Result never throws: `{ ok, changed, error }`. `ok:false` is a truthful
// failure (unreadable list, raced write, write/enqueue/verify failure); it is
// reported separately from the journal outcome so it never gates sync.
export async function repairRecoveryRecords() {
  try {
    const [blocks, weeks] = await Promise.all([
      readList(RECOVERY_BLOCKS_KEY),
      readList(RECOVERY_BLOCK_WEEKS_KEY),
    ]);
    const plan = planRecoveryRepair(blocks, weeks, await getClientId());
    const changed = plan.changedBlocks.length + plan.changedWeeks.length;
    await persist(SYNC_TABLES.RECOVERY_BLOCKS, RECOVERY_BLOCKS_KEY, blocks, plan.blocks,
      plan.changedBlocks, replaceRecoveryBlocksRaw);
    await persist(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, RECOVERY_BLOCK_WEEKS_KEY, weeks, plan.weeks,
      plan.changedWeeks, replaceRecoveryBlockWeeksRaw);
    return { ok: true, changed, error: null };
  } catch (error) {
    return { ok: false, changed: 0, error };
  }
}
