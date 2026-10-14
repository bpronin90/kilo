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
// Persistence order: an atomic compare-and-set write (re-planned on a race,
// never overwriting a newer list), a re-read that verifies every repaired row,
// then the dirty enqueue (see `persist`). Blocks before weeks.

import { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } from './keys';
import { readList } from './jsonStorage';
import { getClientId, enqueueDirtyMany, SYNC_TABLES } from '../syncQueue';
import {
  planDeletedBlockCascade,
  resolveDuplicateActiveBlocks,
  resolveDuplicateWeekMemberships,
} from '../cloud/syncRecoveryResolution';
import { arePersistedRecoveryRecordsWellFormed } from '../../lib/data/activeTrainingContext';
import { secureStorage } from '../secureStorage';

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

const sameList = (raw, list) => {
  if (raw == null) return list.length === 0;
  try {
    return JSON.stringify(JSON.parse(raw)) === JSON.stringify(list);
  } catch {
    return false;
  }
};

// Atomic compare-and-set (`updateItem` reads, transforms, and writes under the
// storage operation lock, so no other writer can land in between): the list is
// replaced only if it still equals what the plan was built from; otherwise the
// plan is discarded and the caller re-plans, never overwriting a newer list.
// The dirty enqueue follows the write: had it come first, a lost race would
// leave a newer-stamped repair of a row someone else just edited queued for
// push. A crash between write and enqueue loses nothing, since sync's baseline
// diff enqueues any local change it was not told about.
async function persist(table, key, original, next, changed) {
  if (changed.length === 0) return;
  await secureStorage.updateItem(key, (raw) => {
    if (!sameList(raw, original)) throw new RepairRaceError('raced');
    return JSON.stringify(next);
  });
  const verify = await readList(key);
  if (!changed.every((c) => JSON.stringify(verify.find((r) => r && r.id === c.id)) === JSON.stringify(c))) {
    throw new Error('Recovery repair could not be verified after writing.');
  }
  if (isCloudMode()) await enqueueDirtyMany(table, changed);
}

async function repairOnce() {
  const [blocks, weeks] = await Promise.all([
    readList(RECOVERY_BLOCKS_KEY),
    readList(RECOVERY_BLOCK_WEEKS_KEY),
  ]);
  const plan = planRecoveryRepair(blocks, weeks, await getClientId());
  await persist(SYNC_TABLES.RECOVERY_BLOCKS, RECOVERY_BLOCKS_KEY, blocks, plan.blocks, plan.changedBlocks);
  await persist(SYNC_TABLES.RECOVERY_BLOCK_WEEKS, RECOVERY_BLOCK_WEEKS_KEY, weeks, plan.weeks, plan.changedWeeks);
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
