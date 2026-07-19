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
const SNAPSHOT_KEY_PREFIX = 'kilo_sync_snapshot_';

// The roadmap tables this engine syncs. Weight entries and workout notes are the
// Task 11 acceptance targets; archived_weight_goals was added in issue #372.
// The last four were pushed once at bootstrap and never again until issue #489
// routed them through the ongoing sync loop.
//
// Two shapes exist in the `kilo` schema:
//   - COLLECTION tables key on (user_id, id): weight_entries, workout_notes,
//     archived_weight_goals, deload_history.
//   - SINGLETON tables key on user_id alone and have NO `id` column:
//     user_profile, feature_toggles, weight_goal. The merge machinery below is
//     keyed by id, so a pulled singleton row is given the synthetic id
//     `SINGLETON_SYNC_ID` locally; the cloud upsert whitelist omits `id`, so the
//     synthetic key is never sent to a column that does not exist.
export const SYNC_TABLES = Object.freeze({
  WEIGHT_ENTRIES: 'weight_entries',
  WORKOUT_NOTES: 'workout_notes',
  ARCHIVED_WEIGHT_GOALS: 'archived_weight_goals',
  USER_PROFILE: 'user_profile',
  // The six Art. 9 health values split out of the mixed user_profile row (#487).
  // user_profile keeps only account settings; anything the user's body did lives
  // here, behind the consent gate.
  USER_HEALTH_PROFILE: 'user_health_profile',
  FEATURE_TOGGLES: 'feature_toggles',
  WEIGHT_GOAL: 'weight_goal',
  DELOAD_HISTORY: 'deload_history',
  // Derived projection of workout_notes.session_checkins (issue #498). Canonical
  // stays the session_checkins on each note; this collection is a one-directional,
  // deterministic projection of it for server-side queryability and an accurate
  // Art. 9 health-data scope. A pulled fatigue row is never written back into a
  // note — see syncAdapter.applyFatigueCheckins.
  FATIGUE_CHECKINS: 'fatigue_checkins',
});

// Synthetic local id for the one row a singleton table can hold. Stable across
// devices, so LWW merges the same logical row everywhere.
export const SINGLETON_SYNC_ID = 'self';

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

// True for a record that came back from the server. `client_id` is not a stored
// column (transport.js drops it from every upsert), so its ABSENCE is what marks
// a row as the server's copy rather than a local one. Used by the LWW tie-break.
export function isServerRow(record) {
  return Boolean(record) && !record.client_id;
}

// ── deterministic last-write-wins ──────────────────────────────────────────────

// Compare two versions of the same record id. Returns the winner.
//   1. Newer `updated_at` wins.
//   2. On an exact `updated_at` tie:
//      a. A SERVER row beats a local one. `client_id` is not a stored column —
//         `transport.js` drops it from every upsert — so a row that came back
//         from the server never carries one, and its absence is what identifies
//         it. Preferring the server row is what makes a tie CONVERGE: every
//         device sees the same server row, so every device picks the same
//         survivor. Preferring the local row instead would have each device keep
//         its own copy and quietly diverge — which is what the old rule did,
//         because `(a.client_id || '') >= (b.client_id || '')` always favours the
//         side that has a client_id, i.e. the local one.
//      b. Between two local rows, the lexicographically greater `client_id`
//         wins: arbitrary, but deterministic and identical on every device.
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
  if (ca === cb) return a;
  // Whichever side lacks a client_id is the server's copy; it wins the tie.
  if (!ca) return a;
  if (!cb) return b;
  return ca > cb ? a : b;
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

// Exported for the reconsent cloud-rebuild rearm (issue #538): a full rebuild
// discards any cursor left over from before a withdrawal purge, so the next
// pull cannot be short-circuited by a stale boundary.
export async function clearCursor(table) {
  await AsyncStorage.removeItem(cursorKey(table));
}

// Compute the highest `updated_at` across a set of records. Sync loops pass only
// rows returned by the server (pull results and push acknowledgements); local
// dirty timestamps are device-owned and must never become pull cursors.
export function maxUpdatedAt(records, current = null) {
  let max = current || '';
  for (const rec of records || []) {
    const u = (rec && rec.updated_at) || '';
    if (u > max) max = u;
  }
  return max || null;
}

async function advanceCursorFromServerEvidence(table, cursor, remote, acknowledged) {
  const acknowledgementMax = maxUpdatedAt(acknowledged);

  // A successful write is stamped at the server's current time. If that
  // authoritative acknowledgement is older than our stored cursor, the cursor
  // came from the old device-clock path (or is otherwise invalid). Lowering it
  // merely to the acknowledgement would still skip rows hidden between the two
  // timestamps, so remove it and let the next pass perform a complete pull.
  if (cursor && acknowledgementMax && acknowledgementMax < cursor) {
    await clearCursor(table);
    return null;
  }

  const advanced = maxUpdatedAt([...remote, ...acknowledged], cursor);
  if (advanced && advanced !== cursor) await setCursor(table, advanced);
  return advanced;
}

const SINGLETON_SYNC_TABLES = new Set([
  SYNC_TABLES.USER_PROFILE,
  SYNC_TABLES.USER_HEALTH_PROFILE,
  SYNC_TABLES.FEATURE_TOGGLES,
  SYNC_TABLES.WEIGHT_GOAL,
]);

// A real transport push returns the rows Postgres persisted after its
// `updated_at` trigger ran. Older/injected transports may still return void, so
// acknowledgement handling is additive. Only timestamped rows can contribute
// ordering evidence. Singleton acknowledgements have no database `id`; restore
// their synthetic local merge key here.
function normalizePushAcknowledgements(table, rows) {
  if (!Array.isArray(rows)) return [];
  const singleton = SINGLETON_SYNC_TABLES.has(table);
  return rows
    .filter((row) => row && row.updated_at && (row.id != null || singleton))
    .map((row) => (row.id == null ? { ...row, id: SINGLETON_SYNC_ID } : row));
}

function applyPushAcknowledgements(merged, rows) {
  for (const row of rows) {
    const existing = merged.get(row.id) || {};
    const localFields = { ...existing };
    delete localFields.client_id;
    // Preserve fields that never leave the device, while letting every returned
    // server column (especially updated_at) replace its local counterpart.
    merged.set(row.id, { ...localFields, ...row });
  }
}

async function recoverPushAcknowledgements(table, transport, cursor, pushed, response) {
  const direct = normalizePushAcknowledgements(table, response);
  if (direct.length > 0) return { rows: direct, replacesLocal: true };

  // Compatibility for injected transports that predate push acknowledgements:
  // re-pull after the successful upsert and retain only the rows just pushed.
  // If this read is interrupted, the dirty queue is still intact and the
  // idempotent upsert retries on the next pass.
  const pushedIds = new Set(pushed.map((row) => row.id));
  const refreshed = normalizePushAcknowledgements(
    table,
    (await transport.pull(table, cursor)) || []
  );
  return {
    rows: refreshed.filter((row) => pushedIds.has(row.id)),
    // A legacy injected transport did not explicitly promise that its pull
    // representation is the post-trigger form of this exact upsert. It can
    // advance the cursor, but must not replace local payload/metadata.
    replacesLocal: false,
  };
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

  // 2. Collect what is awaiting upload BEFORE merging. These are local writes
  //    and tombstones that have never reached the server.
  //
  //    (writeLocal may DEFER new workout-note tombstones rather than enqueueing
  //    them — see createTableIo — so they are not in this set and ride the
  //    follow-up pass sync() runs for them. Reading the queue here is therefore
  //    equivalent to reading it after writeLocal, and lets the merge below see
  //    which ids have local intent.)
  const dirty = await getDirtyRecords(table);
  const dirtyIds = new Set(dirty.map((d) => d.id));

  // 3. Merge remote into the local cache via LWW (+ derived recompute) — but a
  //    row with a pending local edit is NOT put to a vote against its remote
  //    counterpart.
  //
  //    A local record carries a DEVICE-clock `updated_at`; `transport.push`
  //    strips `updated_at` so the server trigger assigns the authoritative one.
  //    The two are from different clocks and are not comparable. Running them
  //    through pickWinner meant a device whose clock lagged the server lost:
  //    `merged.get(id)` returned the REMOTE row, which was then pushed in place
  //    of the pending local write and cleared from the dirty queue.
  //
  //    For a tombstone that means a DELETE never reaches the cloud and the row
  //    resurrects on the next pull. This is the same defect fixed in
  //    syncDiffTable; it lives here too, on the path that carries weight
  //    entries and workout notes.
  //
  //    "Last write to REACH the server wins" — so arrival decides, not a guess
  //    made on the client first. A pending row is always submitted; the server
  //    stamps it on arrival, necessarily later than the row just pulled.
  const localList = (await readLocal()) || [];
  const contested = remote.filter((r) => !dirtyIds.has(r.id));
  const merged = mergeRecords(localList, contested, { table, recomputeDerived });
  let mergedList = Array.from(merged.values());
  await writeLocal(mergedList);

  // 4. Push dirty local records (live writes and tombstones together). A delete
  //    rides this same push as a tombstone, so it always reaches the cloud
  //    before any physical deletion happens locally.
  let acknowledged = [];
  if (dirty.length > 0) {
    const toPush = dirty.map((d) => merged.get(d.id) || d);
    const recovered = await recoverPushAcknowledgements(
      table,
      transport,
      cursor,
      toPush,
      await transport.push(table, toPush)
    );
    acknowledged = recovered.rows;
    await clearDirty(table, dirty);

    // The acknowledgement is the persisted form of the pending write, so it
    // replaces that device-stamped local version unconditionally. Comparing the
    // two timestamps via LWW would reintroduce device-clock skew here.
    if (recovered.replacesLocal) applyPushAcknowledgements(merged, acknowledged);
    if (recovered.replacesLocal && acknowledged.length > 0) {
      mergedList = Array.from(merged.values());
      await writeLocal(mergedList);
    }
  }

  // 5. Advance only from server-authored rows: the complete pull plus any rows
  //    returned after Postgres stamped a successful push. This spans the FULL
  //    remote set, including rows excluded from the merge above. If an injected
  //    transport does not return acknowledgements, the pushed rows are safely
  //    picked up by the next inclusive pull instead.
  await advanceCursorFromServerEvidence(table, cursor, remote, acknowledged);

  return {
    table,
    clientId,
    pulled: remote.length,
    pushed: dirty.length,
    records: mergedList,
  };
}

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

function snapshotKey(table) {
  return `${SNAPSHOT_KEY_PREFIX}${table}`;
}

// The last state we agreed with the server on for a diff-tracked table, stored
// as a list of sync records (live rows AND tombstones). `null` means this device
// has never completed a sync pass for the table.
export async function getSyncSnapshot(table) {
  try {
    const raw = await AsyncStorage.getItem(snapshotKey(table));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setSyncSnapshot(table, records) {
  await AsyncStorage.setItem(snapshotKey(table), JSON.stringify(records || []));
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
  await AsyncStorage.removeItem(snapshotKey(table));
}

// Key-order-independent structural stringify, so a jsonb column that round-trips
// through Postgres with reordered keys is not misread as a local edit (which
// would re-stamp the record every pass and let this device win LWW forever).
export function stableStringify(value) {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
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

// One full sync pass for a diff-tracked table. Same loop shape as `syncTable`
// (pull -> merge -> push dirty -> advance cursor only after a successful push)
// and the same LWW primitives; the only difference is where "dirty" comes from.
//
//   buildLocal()  -> Promise<Array<record>>  live local state, payload fields + id
//   applyMerged(list) -> Promise<void>       write the merged winners back into
//                                            local domain storage (tombstoned
//                                            rows removed, unsynced local fields
//                                            preserved)
export async function syncDiffTable({
  table,
  transport,
  buildLocal,
  applyMerged,
  payloadFields,
  fieldKinds,
  allowDelete = false,
  isEmptyLocal,
}) {
  const clientId = await getClientId();
  const cursor = await getCursor(table);

  // 1. Pull changed rows since the last cursor.
  const remote = (await transport.pull(table, cursor)) || [];

  // 2. Diff live local state against the last-synced snapshot. With no snapshot
  //    (first pass on this device) seed the baseline from the remote rows, so
  //    local state that already agrees with the cloud is not misread as a fresh
  //    local edit — that would re-stamp it at `now` and let a clean install that
  //    merely hydrated the cloud clobber another device's real data.
  const current = (await buildLocal()) || [];
  const persisted = await getSyncSnapshot(table);
  const seeded = persisted == null;
  const { localList, dirty } = diffAgainstBaseline({
    current,
    baseline: persisted || remote,
    clientId,
    payloadFields,
    fieldKinds,
    allowDelete,
    seeded,
    isEmptyLocal,
  });

  for (const rec of dirty) {
    // eslint-disable-next-line no-await-in-loop
    await enqueueDirty(table, rec);
  }

  // 3. Collect everything awaiting upload BEFORE the merge: this pass's diffs
  //    plus anything left over from a previously failed push. Both are genuine
  //    local edits that have never reached the server.
  const pending = await getDirtyRecords(table);
  const pendingIds = new Set(pending.map((d) => d.id));

  // 4. Merge remote into the diffed local list — but a row with a pending local
  //    edit is NOT put to a vote against its remote counterpart.
  //
  //    A local record is stamped with the DEVICE clock, while `transport.push`
  //    deliberately strips `updated_at` so the DB trigger assigns the
  //    authoritative one. The two timestamps therefore come from different
  //    clocks and are not comparable. Running them through pickWinner meant a
  //    device whose clock merely lagged the server lost the comparison, so the
  //    remote row became the "winner", got written back over the user's edit in
  //    applyMerged, was pushed in place of it, and was then cleared from the
  //    dirty queue — silently discarding the edit and never retrying it.
  //
  //    The rule is "last write to REACH THE SERVER wins", so arrival at the
  //    server is what decides — not a guess made on the client beforehand. A
  //    pending edit is always submitted; the server stamps it on arrival, which
  //    is necessarily later than the row we just pulled, so it wins there. The
  //    client never needs its clock to agree with the server's.
  //
  //    This gates on the DIFF, not on the clock: with no local edit there is
  //    nothing pending, remote applies normally, and a second pass pushes
  //    nothing. Idempotency is unaffected.
  const contested = remote.filter((r) => !pendingIds.has(r.id));
  const merged = mergeRecords(localList, contested, { table });
  let mergedList = Array.from(merged.values());
  await applyMerged(mergedList);
  await setSyncSnapshot(table, mergedList);

  // 5. Push the pending edits. merged.get() now returns the local record for
  //    these ids, so the user's edit is what actually goes up.
  let acknowledged = [];
  if (pending.length > 0) {
    const toPush = pending.map((d) => merged.get(d.id) || d);
    const recovered = await recoverPushAcknowledgements(
      table,
      transport,
      cursor,
      toPush,
      await transport.push(table, toPush)
    );
    acknowledged = recovered.rows;
    await clearDirty(table, pending);

    if (recovered.replacesLocal) applyPushAcknowledgements(merged, acknowledged);
    if (recovered.replacesLocal && acknowledged.length > 0) {
      mergedList = Array.from(merged.values());
      await applyMerged(mergedList);
      await setSyncSnapshot(table, mergedList);
    }
  }

  // 6. Advance only from the full set of server-authored pull rows and
  //    server-stamped push acknowledgements.
  await advanceCursorFromServerEvidence(table, cursor, remote, acknowledged);

  return {
    table,
    clientId,
    pulled: remote.length,
    pushed: pending.length,
    records: mergedList,
  };
}
