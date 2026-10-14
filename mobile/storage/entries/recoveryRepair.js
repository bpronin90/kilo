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
// that raced the read is re-planned (compare-and-set), never overwritten.

import { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } from './keys';
import { readList } from './jsonStorage';
import { getClientId, enqueueDirtyMany, SYNC_TABLES } from '../syncQueue';
import {
  planDeletedBlockCascade,
  resolveDuplicateActiveBlocks,
  resolveDuplicateWeekMemberships,
} from '../cloud/syncRecoveryResolution';
import { arePersistedRecoveryRecordsWellFormed } from '../../lib/data/activeTrainingContext';
import { replaceRecoveryBlocksRaw, replaceRecoveryBlockWeeksRaw } from './recoveryStorage';

// Pure plan over the shared guarded helpers (syncRecoveryResolution.js), the
// exact entry points cloud resolution uses, so both apply one policy.
// `changed*` are the rewritten rows; lists keep every input row.
export function planRecoveryRepair(blocks, weeks, clientId) {
  const none = { blocks, weeks, changedBlocks: [], changedWeeks: [] };
  // Malformed shapes make every winner arbitrary: repair nothing.
  if (!arePersistedRecoveryRecordsWellFormed(blocks, weeks)) return none;

  const active = resolveDuplicateActiveBlocks(blocks, clientId);
  const cascade = planDeletedBlockCascade(active.list, weeks, clientId);
  const resolved = resolveDuplicateWeekMemberships(cascade.list, clientId, { blocks: active.list });
  const changedWeeks = new Map(cascade.cascaded.map((w) => [w.id, w]));
  for (const w of resolved.changed) changedWeeks.set(w.id, w);
  return {
    blocks: active.list,
    weeks: resolved.list,
    changedBlocks: active.changed,
    changedWeeks: [...changedWeeks.values()],
  };
}

// Lazy: './storageMode' pulls in the adapters, which import storage/entries and
// would create a load-order cycle with this module's importers.
function isCloudMode() {
  const { getStorageMode, STORAGE_MODES } = require('./storageMode');
  return getStorageMode() === STORAGE_MODES.CLOUD;
}

class RepairRaceError extends Error {}

// Compare-and-set against the exact bytes the plan was built from. The dirty
// enqueue is awaited FIRST; only then is the list re-read and, with no await
// between that check and the write call, replaced. A concurrent writer that
// landed during the enqueue changes the bytes, so the plan is discarded (and
// re-planned by the caller) instead of overwriting the newer list.
async function persist(table, key, original, next, changed, replace) {
  if (changed.length === 0) return;
  if (isCloudMode()) await enqueueDirtyMany(table, changed);
  const current = await readList(key);
  if (JSON.stringify(current) !== JSON.stringify(original)) throw new RepairRaceError('raced');
  await replace(next);
  const verify = await readList(key);
  if (JSON.stringify(verify) !== JSON.stringify(next)) {
    throw new Error('Recovery repair could not be verified after writing.');
  }
}

async function repairOnce() {
  const [blocks, weeks] = await Promise.all([
    readList(RECOVERY_BLOCKS_KEY),
    readList(RECOVERY_BLOCK_WEEKS_KEY),
  ]);
  const plan = planRecoveryRepair(blocks, weeks, await getClientId());
  await persist(SYNC_TABLES.RECOVERY_BLOCKS, RECOVERY_BLOCKS_KEY, blocks, plan.blocks,
    plan.changedBlocks, replaceRecoveryBlocksRaw);
  await persist(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, RECOVERY_BLOCK_WEEKS_KEY, weeks, plan.weeks,
    plan.changedWeeks, replaceRecoveryBlockWeeksRaw);
  return plan.changedBlocks.length + plan.changedWeeks.length;
}

// Result never throws: `{ ok, changed, error }`. `ok:false` is a truthful
// failure (unreadable list, persistent race, write/enqueue/verify failure); it
// is reported separately from the journal outcome so it never gates sync.
export async function repairRecoveryRecords() {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return { ok: true, changed: await repairOnce(), error: null };
    } catch (error) {
      lastError = error;
      if (!(error instanceof RepairRaceError)) break;
    }
  }
  return { ok: false, changed: 0, error: lastError };
}
