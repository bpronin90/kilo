import { secureStorage as AsyncStorage } from '../secureStorage';
import { SNAPSHOT_KEY_PREFIX, SYNC_TABLES } from './records';
import { stripDerivedSectionsFromList } from '../entries/derivedCache';
import { dirtyKey, stripDirtyMap } from './dirtyQueue';

// ── sync snapshots ─────────────────────────────────────────────────────────────

function snapshotKey(table) {
  return `${SNAPSHOT_KEY_PREFIX}${table}`;
}

// The exact serialized value each table's snapshot key is believed to hold at
// rest (issue #806). Written only from bytes this module has just read from, or
// just written to, storage — so it is evidence, never a guess.
//
// It exists to skip the single most expensive redundant write in a steady-state
// pass: re-persisting a baseline that is byte-identical to the one already on
// disk. On a large account that is a full re-serialize and device re-encrypt of
// every synced table on every pass, for no change at all.
//
// Staleness is not assumed away: a write may be skipped only against a value
// this module has actually READ back from storage, and each read grounds exactly
// one skip. So a snapshot key removed by something that does not route through
// clearSyncSnapshot (a device wipe, purgeLocalData, a test clearing storage)
// costs at most one skipped write before the next read observes the removal and
// the baseline is written again. Both engine entry points read the snapshot on
// every pass — syncTable for its unbaselined test, syncDiffTable for its diff —
// so the steady-state skip stays available pass after pass.
const snapshotAtRest = new Map();

// The last state we agreed with the server on for a diff-tracked table, stored
// as a list of sync records (live rows AND tombstones). `null` means this device
// has never completed a sync pass for the table.
export async function getSyncSnapshot(table) {
  try {
    const raw = await AsyncStorage.getItem(snapshotKey(table));
    if (!raw) {
      snapshotAtRest.delete(table);
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      snapshotAtRest.delete(table);
      return null;
    }
    snapshotAtRest.set(table, { value: raw, grounded: true });
    return parsed;
  } catch {
    snapshotAtRest.delete(table);
    return null;
  }
}

export async function setSyncSnapshot(table, records) {
  const next = JSON.stringify(records || []);
  const known = snapshotAtRest.get(table);
  if (known && known.grounded && known.value === next) {
    known.grounded = false;
    return;
  }
  await AsyncStorage.setItem(snapshotKey(table), next);
  snapshotAtRest.set(table, { value: next, grounded: false });
}

// Discard the baseline entirely, as opposed to setSyncSnapshot(table, []): the
// next syncDiffTable pass must see `persisted == null` (a `seeded` pass), not an
// empty-but-present baseline, so it re-derives the seeded rules — most
// importantly rule 3 (`isEmptyLocal`) — from scratch rather than from a value
// this table has never actually agreed with the server on. Used by the
// reconsent cloud-rebuild rearm (issue #538): a completed purge leaves the
// server-side row set genuinely empty, and clearing the snapshot is what makes
// the diff engine treat every local record as new rather than "already
// reconciled with an empty cloud".
export async function clearSyncSnapshot(table) {
  snapshotAtRest.delete(table);
  await AsyncStorage.removeItem(snapshotKey(table));
}

// One-time cleanup of the engine's own workout_notes bookkeeping (issue #813):
// strip the parser-output cache an older build persisted into the baseline
// snapshot and the pending-push queue. Each key is rewritten as ONE serialized
// storage operation (secureStorage.updateItem), so a sync pass or domain write
// cannot land between the read and the write. Payloads this build cannot parse
// are left exactly as they are - corruption is the read paths' concern, and a
// cleanup must never turn it into an empty table. Returns what it changed.
export async function purgeDerivedSectionsFromWorkoutNoteSyncState() {
  const table = SYNC_TABLES.WORKOUT_NOTES;
  const rewriteJson = (transform) => (raw) => {
    if (raw == null) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const next = transform(parsed);
    return next === parsed ? null : JSON.stringify(next);
  };
  const snapshot = await AsyncStorage.updateItem(
    snapshotKey(table),
    rewriteJson((list) => (Array.isArray(list) ? stripDerivedSectionsFromList(list) : list))
  );
  // A rewritten snapshot invalidates the at-rest record used to skip identical
  // baseline writes; the next read re-grounds it.
  if (snapshot.changed) snapshotAtRest.delete(table);
  const dirty = await AsyncStorage.updateItem(
    dirtyKey(table),
    rewriteJson((map) => (Array.isArray(map) ? map : stripDirtyMap(table, map)))
  );
  return { snapshot: snapshot.changed, dirty: dirty.changed };
}
