// Offline sync engine (Phase 4 / Task 11).
//
// Pure, transport-agnostic last-write-wins (LWW) sync primitives used by the
// cloud storage adapter. This module owns:
//
//   - sync metadata stamping (`client_id`, `updated_at`, `deleted_at`)
//   - the per-table dirty queue, persisted in AsyncStorage so edits made while
//     offline survive an app restart and still push after reconnect
//   - per-table pull cursors (last seen `updated_at`)
//   - the deterministic LWW merge: newer `updated_at` wins; exact ties break by
//     `client_id` lexicographic order
//   - tombstone-first deletes: a delete writes a `deleted_at` tombstone that is
//     synced before any physical cleanup
//   - derived-JSON recompute: when only the cached derived fields differ but the
//     canonical `raw_text` is unchanged, the conflict is resolved by recompute,
//     never surfaced to the user
//
// The cloud transport (Supabase) is injected, so this engine is fully testable
// without a network and without coupling to bootstrap (#319). The roadmap
// loop shape is: pull changed rows since cursor -> merge into local cache ->
// push dirty local records -> advance the per-table cursor only after a
// successful push.

import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage keys for sync bookkeeping. Kept separate from domain data so
// clearing/inspecting sync state never touches the user's records.
const CLIENT_ID_KEY = 'kilo_sync_client_id';
const DIRTY_KEY_PREFIX = 'kilo_sync_dirty_';
const CURSOR_KEY_PREFIX = 'kilo_sync_cursor_';

// The roadmap tables this engine syncs. Weight entries and workout notes are the
// Task 11 acceptance targets; archived_weight_goals was added in issue #372.
// All are keyed by stable record id.
export const SYNC_TABLES = Object.freeze({
  WEIGHT_ENTRIES: 'weight_entries',
  WORKOUT_NOTES: 'workout_notes',
  ARCHIVED_WEIGHT_GOALS: 'archived_weight_goals',
});

// Canonical workout-note derived fields. These are a recomputable cache of
// `raw_text`; a difference in only these fields is never a user-facing conflict.
export const DERIVED_NOTE_FIELDS = Object.freeze([
  'tracked_exercises',
  'one_k_exercises',
  'skip_markers',
  'attendance_flags',
  'session_checkins',
  'exercise_classifications',
]);

// ── client id ────────────────────────────────────────────────────────────────

// A stable, per-install identifier used only for deterministic LWW tie-breaks.
// Persisted so the same device keeps the same ordering weight across restarts.
let cachedClientId;

function randomClientId() {
  // Not security-sensitive; only needs to be stable and reasonably unique so two
  // devices rarely collide. Lexicographic order is what matters for tie-breaks.
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getClientId() {
  if (cachedClientId) return cachedClientId;
  try {
    const existing = await AsyncStorage.getItem(CLIENT_ID_KEY);
    if (existing) {
      cachedClientId = existing;
      return cachedClientId;
    }
  } catch {
    // fall through to mint a fresh id
  }
  const minted = randomClientId();
  try {
    await AsyncStorage.setItem(CLIENT_ID_KEY, minted);
  } catch {
    // If persistence fails we still return an id for this session.
  }
  cachedClientId = minted;
  return cachedClientId;
}

// Test/maintenance hook: forget the cached client id so a fresh one is read.
export function resetClientIdCacheForTests() {
  cachedClientId = undefined;
}

// ── sync metadata stamping ─────────────────────────────────────────────────────

// Per-device monotonic clock. `new Date().toISOString()` only has millisecond
// resolution, so a fast create→edit→delete burst on one device can stamp two
// writes with the SAME `updated_at`. That makes their order depend on the
// client_id tie-break, which is meaningless against a device's own prior write
// and can drop the later edit/delete. Minting strictly increasing stamps per
// device keeps a device's successive writes correctly ordered; other devices
// still differ by client_id.
let lastStampMs = 0;
function monotonicNowIso() {
  let ms = Date.now();
  if (ms <= lastStampMs) ms = lastStampMs + 1;
  lastStampMs = ms;
  return new Date(ms).toISOString();
}

// Test hook: reset the monotonic clock so suites start from a clean slate.
export function resetStampClockForTests() {
  lastStampMs = 0;
}

// Stamp a record with the sync metadata LWW needs. `updated_at` advances to now
// on every write; `client_id` records which install last wrote the record so
// exact `updated_at` ties resolve deterministically. The default `now` is minted
// from the per-device monotonic clock; callers may pass an explicit value.
export function stampWrite(record, clientId, now = monotonicNowIso()) {
  return {
    ...record,
    updated_at: now,
    client_id: clientId,
    // A live write clears any prior tombstone (an edit revives a record).
    deleted_at: null,
  };
}

// Stamp a record as a tombstone. The row is retained (not physically removed)
// so the delete can sync before any later physical cleanup.
export function stampTombstone(record, clientId, now = monotonicNowIso()) {
  return {
    ...record,
    updated_at: now,
    client_id: clientId,
    deleted_at: now,
  };
}

export function isTombstone(record) {
  return Boolean(record && record.deleted_at);
}

// ── deterministic last-write-wins ──────────────────────────────────────────────

// Compare two versions of the same record id. Returns the winner.
//   1. Newer `updated_at` wins.
//   2. On an exact `updated_at` tie, the lexicographically greater `client_id`
//      wins. This is arbitrary but deterministic and identical on every device,
//      so all devices converge on the same survivor.
// A tombstone does not get special precedence; it competes on `updated_at` like
// any other write, so a later edit can revive a record and a later delete wins
// over an earlier edit. Per-device monotonic stamping (see stampWrite) keeps a
// device's successive create/edit/delete strictly ordered, so the same device
// never relies on the client_id tie-break against itself.
export function pickWinner(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ua = a.updated_at || '';
  const ub = b.updated_at || '';
  if (ua > ub) return a;
  if (ub > ua) return b;
  const ca = a.client_id || '';
  const cb = b.client_id || '';
  if (ca >= cb) return a;
  return b;
}

// Resolve a single id's local vs remote versions. Handles the derived-JSON
// recompute rule for workout notes: if the LWW winner and loser share the same
// canonical `raw_text`, the derived fields are recomputed from `raw_text`
// (via `recomputeDerived`) rather than trusting either side's stale cache. This
// makes a derived-only divergence a non-conflict resolved by recompute.
export function resolveRecord(local, remote, { table, recomputeDerived } = {}) {
  const winner = pickWinner(local, remote);
  if (!winner) return null;

  if (
    table === SYNC_TABLES.WORKOUT_NOTES &&
    typeof recomputeDerived === 'function' &&
    local &&
    remote &&
    !isTombstone(winner) &&
    typeof winner.raw_text === 'string' &&
    local.raw_text === remote.raw_text
  ) {
    // Canonical text agrees on both sides; only the derived cache could differ.
    // Recompute it deterministically so neither side's stale snapshot leaks.
    return { ...winner, ...recomputeDerived(winner.raw_text) };
  }

  return winner;
}

// Merge a list of remote records into a keyed local map, applying LWW per id.
// Returns a new map; never mutates inputs. O(local + remote), no nested scan.
export function mergeRecords(localList, remoteList, opts = {}) {
  const byId = new Map();
  for (const rec of localList || []) {
    if (rec && rec.id != null) byId.set(rec.id, rec);
  }
  for (const remote of remoteList || []) {
    if (!remote || remote.id == null) continue;
    const local = byId.get(remote.id);
    byId.set(remote.id, resolveRecord(local, remote, opts));
  }
  return byId;
}

// ── dirty queue (persisted) ────────────────────────────────────────────────────

function dirtyKey(table) {
  return `${DIRTY_KEY_PREFIX}${table}`;
}

async function readDirty(table) {
  try {
    const raw = await AsyncStorage.getItem(dirtyKey(table));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function writeDirty(table, map) {
  await AsyncStorage.setItem(dirtyKey(table), JSON.stringify(map));
}

// Queue a record id as needing push. We store the full record snapshot keyed by
// id so the most recent local write is what gets pushed, and re-queuing the same
// id simply overwrites the prior snapshot (no unbounded growth, no nested scan).
export async function enqueueDirty(table, record) {
  if (!record || record.id == null) return;
  const map = await readDirty(table);
  map[record.id] = record;
  await writeDirty(table, map);
}

export async function getDirtyRecords(table) {
  const map = await readDirty(table);
  return Object.values(map);
}

// Clear specific ids from the dirty queue after a confirmed successful push.
// Callers should clear only ids they actually pushed.
export async function clearDirty(table, ids) {
  if (!ids || ids.length === 0) return;
  const map = await readDirty(table);
  let changed = false;
  for (const id of ids) {
    if (id in map) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) await writeDirty(table, map);
}

// ── per-table pull cursor ──────────────────────────────────────────────────────

function cursorKey(table) {
  return `${CURSOR_KEY_PREFIX}${table}`;
}

export async function getCursor(table) {
  try {
    return (await AsyncStorage.getItem(cursorKey(table))) || null;
  } catch {
    return null;
  }
}

export async function setCursor(table, cursor) {
  if (!cursor) return;
  await AsyncStorage.setItem(cursorKey(table), cursor);
}

// Compute the highest `updated_at` across a set of records; used to advance the
// cursor only after a successful pull+push so an interrupted sync re-pulls.
export function maxUpdatedAt(records, current = null) {
  let max = current || '';
  for (const rec of records || []) {
    const u = (rec && rec.updated_at) || '';
    if (u > max) max = u;
  }
  return max || null;
}

// ── sync loop ──────────────────────────────────────────────────────────────────

// Run one full sync pass for a single table against an injected transport.
//
// transport contract:
//   - pull(table, cursor) -> Promise<Array<record>>   changed rows since cursor
//   - push(table, records) -> Promise<void>           upsert dirty rows (incl.
//                                                      tombstones)
//
// readLocal()/writeLocal(list) read and persist the local cache list for the
// table. recomputeDerived(raw_text) is used for the workout-note recompute rule.
//
// Loop shape (roadmap): pull changed rows since cursor -> merge into local cache
// -> push dirty local records -> advance the per-table cursor only after the
// push succeeds. Tombstones are pushed alongside live records so a delete syncs
// before any physical deletion. If the push throws, the cursor is NOT advanced
// and the dirty queue is left intact so the next pass retries.
export async function syncTable({
  table,
  transport,
  readLocal,
  writeLocal,
  recomputeDerived,
}) {
  const clientId = await getClientId();
  const cursor = await getCursor(table);

  // 1. Pull changed rows since the last cursor.
  const remote = (await transport.pull(table, cursor)) || [];

  // 2. Merge remote into the local cache via LWW (+ derived recompute).
  const localList = (await readLocal()) || [];
  const merged = mergeRecords(localList, remote, { table, recomputeDerived });
  const mergedList = Array.from(merged.values());
  await writeLocal(mergedList);

  // 3. Push dirty local records (live writes and tombstones together). A delete
  //    rides this same push as a tombstone, so it always reaches the cloud
  //    before any physical deletion happens locally.
  const dirty = await getDirtyRecords(table);
  if (dirty.length > 0) {
    // Push the post-merge version of each dirty id so a remote write that won
    // the merge is not clobbered by a stale local snapshot.
    const toPush = dirty.map((d) => merged.get(d.id) || d);
    await transport.push(table, toPush);
    await clearDirty(
      table,
      dirty.map((d) => d.id)
    );
  }

  // 4. Advance the cursor only after a successful push, covering both pulled
  //    and pushed rows so the next pass starts past everything we've reconciled.
  const advanced = maxUpdatedAt([...remote, ...dirty], cursor);
  if (advanced && advanced !== cursor) {
    await setCursor(table, advanced);
  }

  return {
    table,
    clientId,
    pulled: remote.length,
    pushed: dirty.length,
    records: mergedList,
  };
}
