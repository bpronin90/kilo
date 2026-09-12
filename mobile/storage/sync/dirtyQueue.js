import { secureStorage as AsyncStorage } from '../secureStorage';
import {
  DIRTY_KEY_PREFIX,
  SYNC_TABLES,
  stableStringify,
} from './records';
import {
  DERIVED_SECTIONS_FIELD,
  stripDerivedSections,
  stripDerivedSectionsFromList,
} from '../entries/derivedCache';

// ── dirty queue (persisted) ────────────────────────────────────────────────────

function dirtyKey(table) {
  return `${DIRTY_KEY_PREFIX}${table}`;
}

// A workout note's parser-output cache is neither a column nor user data, so
// it never enters the queue (issue #813): every write of the workout_notes queue
// strips it from EVERY record it persists - not only the records being added -
// so a writer whose read predates the one-time purge cannot restore it with a
// stale full-map write, and every read strips it so a queue written by an older
// build is lean in memory until then. Both return their input by identity when
// there is nothing to strip.
function stripDirtyMap(table, map) {
  if (table !== SYNC_TABLES.WORKOUT_NOTES || !map || typeof map !== 'object') return map;
  let changed = false;
  const next = {};
  for (const [id, record] of Object.entries(map)) {
    const stripped = stripDerivedSections(record);
    if (stripped !== record) changed = true;
    next[id] = stripped;
  }
  return changed ? next : map;
}

async function readDirty(table) {
  try {
    const raw = await AsyncStorage.getItem(dirtyKey(table));
    return raw ? stripDirtyMap(table, JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

async function writeDirty(table, map) {
  await AsyncStorage.setItem(dirtyKey(table), JSON.stringify(stripDirtyMap(table, map)));
}

let dirtyListeners = [];

function notifyDirtyListeners() {
  for (const listener of dirtyListeners) {
    try {
      listener();
    } catch (e) {
      console.warn('[syncQueue] dirty listener error', e);
    }
  }
}

export function subscribeDirtyQueue(listener) {
  if (typeof listener !== 'function') return () => {};
  dirtyListeners.push(listener);
  return () => {
    dirtyListeners = dirtyListeners.filter((l) => l !== listener);
  };
}

// Queue a record id as needing push. We store the full record snapshot keyed by
// id so the most recent local write is what gets pushed, and re-queuing the same
// id simply overwrites the prior snapshot (no unbounded growth, no nested scan).
export async function enqueueDirty(table, record) {
  return enqueueDirtyMany(table, [record]);
}

// Queue a whole batch in ONE read/serialize/write of the persisted queue
// (issue #806).
//
// The queue is a single AsyncStorage value holding every pending record for the
// table, so enqueueing record-by-record costs a full read, parse, stringify and
// write of the ENTIRE queue per record — quadratic in the number of rows being
// enqueued. Every bulk producer in the engine hits that: the unbaselined
// reconciliation, the diff-table pass, `reconcileLocalWrites`, and the #538
// rebuild reseed all enqueue an entire table one row at a time. On a real
// account that is the dominant cost of a first sync (measured: ~190MB of JSON
// serialized and device-encrypted for 1,200 weight entries alone).
//
// Batching is behaviour-preserving: the queue is keyed by id, so applying the
// batch in order leaves exactly the map the per-record loop produced, and the
// caller still awaits a single durable write before anything is pushed. The
// dirty listeners fire once for the batch rather than once per record — they are
// change notifications for the pending-count UI, so one notification per durable
// write is the correct granularity.
export async function enqueueDirtyMany(table, records) {
  if (!records || records.length === 0) return;
  const map = await readDirty(table);
  let changed = false;
  for (const record of records) {
    if (!record || record.id == null) continue;
    map[record.id] = record;
    changed = true;
  }
  if (!changed) return;
  await writeDirty(table, map);
  notifyDirtyListeners();
}

export async function getDirtyRecords(table) {
  const map = await readDirty(table);
  return Object.values(map);
}

// Clear only the exact queued snapshots acknowledged by a confirmed successful
// push.
// A newer enqueue may replace a record under the same id while the transport is
// in flight; compare the full queued value so acknowledging the older snapshot
// cannot delete the replacement. The work stays O(queue + acknowledgements),
// with no cross-product scan.
//
// Primitive ids remain supported for direct queue-maintenance callers. That
// form captures the value currently in the queue. Sync loops pass the snapshots
// they read from the queue, not the live rows rebuilt for transport: local-only
// fields may legitimately change the latter without creating new sync work.
export async function clearDirty(table, acknowledged) {
  if (!acknowledged || acknowledged.length === 0) return;
  const map = await readDirty(table);
  const expectedById = new Map();
  for (const item of acknowledged) {
    const id = item && typeof item === 'object' ? item.id : item;
    if (id == null || !(id in map)) continue;
    expectedById.set(String(id), item && typeof item === 'object' ? item : map[id]);
  }

  let changed = false;
  for (const [id, expected] of expectedById) {
    if (id in map && stableStringify(map[id]) === stableStringify(expected)) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) {
    await writeDirty(table, map);
    notifyDirtyListeners();
  }
}

// Exported for snapshots.js purgeDerivedSectionsFromWorkoutNoteSyncState, which
// needs direct key access and strip logic to use AsyncStorage.updateItem atomically.
export { dirtyKey, stripDirtyMap };
