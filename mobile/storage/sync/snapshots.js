// Last-synced baseline snapshots and the diff engine that reads them.
//
// Split out of storage/syncQueue.js (issue #1061). A snapshot is the list of
// sync records (live rows AND tombstones) this device and the server last agreed
// on for a table. It is the ground truth the diff-tracked tables reconcile
// against, and the record signed-out-write reconciliation diffs against. This
// module is the single owner of the at-rest cache (`snapshotAtRest`) that lets a
// steady-state pass skip re-persisting a byte-identical baseline.
//
// ── diff-based dirty detection (issue #489) ────────────────────────────────────
//
// The three original tables mark records dirty at write time (`enqueueDirty`).
// The four tables added in #489 (`user_profile`, `feature_toggles`,
// `weight_goal`, `deload_history`) are not written through a single record
// store — they are assembled from a spread of AsyncStorage keys touched by many
// setters across several modules. Hooking every setter would mean editing
// modules well outside this issue's scope, so these tables detect local changes
// by DIFFING live local state against a persisted "last synced" snapshot
// (`kilo_sync_snapshot_<table>`).
//
// THE CONVERGENCE RULE for these four tables, stated plainly:
//
//     Last write to REACH THE SERVER wins, per ROW; exact `updated_at` ties
//     break by lexicographically greater `client_id`.
//
// Two consequences follow, and both are deliberate:
//
//   1. SYNC-TIME, NOT EDIT-TIME ordering. A diff-detected change is stamped by
//      `stampWrite` when the sync pass runs, not when the user made the edit.
//      A device that edits early and syncs late loses to a device that edits
//      late and syncs early.
//
//   2. ROW-LEVEL, NOT FIELD-LEVEL resolution. `user_profile`, `feature_toggles`,
//      and `weight_goal` are each a SINGLE cloud row, so the winning device's
//      whole row wins — including fields it never touched. If device A changes
//      the unit system and device B concurrently changes the fatigue multiplier,
//      the row that syncs last carries its own value for BOTH fields and the
//      loser's independent edit is overwritten. (A 3-way field-level merge
//      against the snapshot would preserve both; that is deliberately not done
//      here — #489 asked for an explicit last-writer-wins rule for the singleton
//      rows, not a merge strategy.)
//
// It is not edit-time ordering and it is not a field merge, but it IS fully
// deterministic — `pickWinner` is a total order and every device runs it
// identically — so all devices converge on the same survivor, which is what the
// convergence criteria deferred by #481/#482/#483 require.

import { secureStorage as AsyncStorage } from '../secureStorage';
import { stripDerivedSectionsFromList } from '../entries/derivedCache';
import {
  SYNC_TABLES,
  stampWrite,
  stampTombstone,
  isTombstone,
  stableStringify,
} from './records';
import { dirtyKey, stripDirtyMap } from './dirtyQueue';

// AsyncStorage key prefix for the per-table last-synced snapshot. Kept separate
// from domain data so clearing/inspecting sync state never touches the records.
const SNAPSHOT_KEY_PREFIX = 'kilo_sync_snapshot_';

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

// Normalize a field before comparison. Postgres round-trips change the *spelling*
// of a value without changing the value: `numeric` may come back as a string,
// and `timestamptz` comes back as `+00:00` where the client wrote `Z`. Comparing
// raw spellings would mark such a record permanently dirty.
function normalizeForCompare(value, kind) {
  if (value === undefined || value === null) return null;
  if (kind === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'timestamp') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? value : t;
  }
  return value;
}

// True when two records agree on every synced payload field. O(fields).
export function samePayload(a, b, fields, fieldKinds = {}) {
  for (const field of fields) {
    const av = normalizeForCompare(a ? a[field] : null, fieldKinds[field]);
    const bv = normalizeForCompare(b ? b[field] : null, fieldKinds[field]);
    if (stableStringify(av) !== stableStringify(bv)) return false;
  }
  return true;
}

// Compare live local records against the snapshot baseline and produce (a) the
// stamped local record list the LWW merge consumes and (b) the records that
// changed locally and must be pushed. Pure; the caller persists the results.
//
// `seeded` is true when no snapshot exists yet and the baseline was seeded from
// the remote rows instead — i.e. this is the first-ever reconciliation on this
// device, so there is no evidence of what changed locally. Three rules apply
// only on a seeded pass, and all three exist to stop a device from claiming
// authorship of data it never wrote:
//
//   1. Never infer a delete. A baseline row missing from local state has simply
//      never been downloaded (a clean install has an empty local table and a
//      full remote one), not been deleted.
//   2. Let a remote tombstone stand rather than reviving it from local state
//      that predates sync.
//   3. `isEmptyLocal` (singletons only): a singleton row ALWAYS exists locally,
//      because it is assembled from storage keys that fall back to defaults. So
//      unlike a collection row, "missing" is not available as a signal, and a
//      clean install would otherwise look like a user who had deliberately
//      cleared every field — stamping empty defaults at `now` and clobbering the
//      authoring device's cloud row. When local state carries no user content at
//      all, adopt the cloud row instead of overwriting it. A device with any real
//      content is never "empty", so its data still wins and still repairs a stale
//      cloud copy.
export function diffAgainstBaseline({
  current,
  baseline,
  clientId,
  payloadFields,
  fieldKinds,
  allowDelete = false,
  seeded = false,
  isEmptyLocal,
}) {
  const baselineById = new Map();
  for (const rec of baseline || []) {
    if (rec && rec.id != null) baselineById.set(rec.id, rec);
  }

  const localList = [];
  const dirty = [];
  const seen = new Set();

  for (const rec of current || []) {
    if (!rec || rec.id == null) continue;
    seen.add(rec.id);
    const base = baselineById.get(rec.id);

    if (base && isTombstone(base)) {
      // First reconciliation: adopt a delete we have never seen rather than
      // resurrecting the record from local state that predates sync.
      if (seeded) {
        localList.push(base);
        continue;
      }
      // Otherwise the record genuinely came back locally after a synced delete
      // (e.g. a new weight goal set after the old one was cleared). stampWrite
      // clears `deleted_at`, so this is an explicit, ordered revive.
      const revived = stampWrite({ ...base, ...rec }, clientId);
      localList.push(revived);
      dirty.push(revived);
      continue;
    }

    if (seeded && base && typeof isEmptyLocal === 'function' && isEmptyLocal(rec)) {
      // Rule 3 above: local state holds nothing the user actually authored, so
      // adopt the cloud row rather than stamping defaults as a fresh local write.
      localList.push(base);
      continue;
    }

    if (base && samePayload(rec, base, payloadFields, fieldKinds)) {
      // Unchanged: keep the baseline's sync metadata so we do not re-stamp (and
      // therefore do not spuriously win LWW against another device's real edit).
      localList.push({ ...base, ...rec });
      continue;
    }

    const stamped = stampWrite({ ...(base || {}), ...rec }, clientId);
    localList.push(stamped);
    dirty.push(stamped);
  }

  for (const [id, base] of baselineById) {
    if (seen.has(id)) continue;
    if (isTombstone(base) || !allowDelete || seeded) {
      // Carry the row unchanged: an already-synced tombstone (so it never
      // resurrects), a table that cannot delete, or a seeded baseline row that
      // is simply not downloaded yet.
      localList.push(base);
      continue;
    }
    const tombstone = stampTombstone({ ...base }, clientId);
    localList.push(tombstone);
    dirty.push(tombstone);
  }

  return { localList, dirty };
}
