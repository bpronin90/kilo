import { secureStorage as AsyncStorage } from '../secureStorage';
import {
  DERIVED_SECTIONS_FIELD,
  stripDerivedSections,
  stripDerivedSectionsFromList,
} from '../entries/derivedCache';

export { DERIVED_SECTIONS_FIELD, stripDerivedSections, stripDerivedSectionsFromList };

// AsyncStorage keys for sync bookkeeping.
export const CLIENT_ID_KEY = 'kilo_sync_client_id';
export const DIRTY_KEY_PREFIX = 'kilo_sync_dirty_';
export const CURSOR_KEY_PREFIX = 'kilo_sync_cursor_';
export const SNAPSHOT_KEY_PREFIX = 'kilo_sync_snapshot_';
export const PULL_META_FIELD = '__kilo_pull_meta';
export const ROW_XID_FIELD = '__kilo_sync_xid';

// The roadmap tables this engine syncs. Weight entries and workout notes are the
// Task 11 acceptance targets; archived_weight_goals was added in issue #372.
// The last four were pushed once at bootstrap and never again until issue #489
// routed them through the ongoing sync loop.
//
// Two shapes exist in the `kilo` schema:
//   - COLLECTION tables key on (user_id, id): weight_entries, workout_notes,
//     archived_weight_goals, deload_history, recovery_blocks,
//     recovery_block_weeks.
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
  // The recovery-block domain (#692, synced by #693). Two ordinary collections:
  // a block carries the FROZEN pre-recovery baseline snapshot, and a week is an
  // ordered membership binding one workout note to one block. They are listed
  // last, and synced last, because both reference rows in tables above them:
  // workout notes before blocks, blocks before the memberships that link them.
  RECOVERY_BLOCKS: 'recovery_blocks',
  RECOVERY_BLOCK_WEEKS: 'recovery_block_weeks',
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
// Single-flight guard. Independent table passes now run concurrently (issue
// #806), and two of them racing an uncached read would each miss, each mint, and
// each persist a DIFFERENT id — silently splitting one device's LWW tie-break
// weight in two. Sharing the first in-flight resolution keeps "one id per
// install" true regardless of who asks first.
let clientIdPromise = null;

function randomClientId() {
  // Not security-sensitive; only needs to be stable and reasonably unique so two
  // devices rarely collide. Lexicographic order is what matters for tie-breaks.
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getClientId() {
  if (cachedClientId) return cachedClientId;
  if (!clientIdPromise) {
    clientIdPromise = (async () => {
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
    })();
    clientIdPromise.then(
      () => { clientIdPromise = null; },
      () => { clientIdPromise = null; }
    );
  }
  return clientIdPromise;
}

// Test/maintenance hook: forget the cached client id so a fresh one is read.
export function resetClientIdCacheForTests() {
  cachedClientId = undefined;
  clientIdPromise = null;
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
export function monotonicNowIso() {
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

// ── payload comparison utilities ───────────────────────────────────────────────

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

// Sync bookkeeping that describes WHEN a row was written rather than WHAT it
// says. Two rows that differ only here hold the same user data.
export const SYNC_METADATA_FIELDS = Object.freeze(['updated_at', 'client_id']);

// Device-local caches that describe neither WHEN nor WHAT: recomputable from the
// row's own payload, never a cloud column. A row that differs from its baseline
// only here has not been edited, so treating the difference as a local write
// would re-stamp and re-push an unchanged note - and, because a pending local
// row is never voted against its remote counterpart, could overwrite another
// device's genuine edit. Ignoring the field is what lets the one-time purge in
// entries/derivedCachePurge.js clean the notebook and its baseline separately
// without ever making the two disagree (issue #813).
export const LOCAL_CACHE_FIELDS = Object.freeze([DERIVED_SECTIONS_FIELD]);

// Structural identity of a record's user-visible content. `deleted_at` is
// deliberately retained: live and tombstoned are different states of the row.
export function payloadFingerprint(record) {
  const payload = {};
  for (const key of Object.keys(record)) {
    if (SYNC_METADATA_FIELDS.includes(key) || LOCAL_CACHE_FIELDS.includes(key)) continue;
    payload[key] = record[key];
  }
  return stableStringify(payload);
}

// ── error types ────────────────────────────────────────────────────────────────

// Raised when an unbaselined pass finds remote rows it can neither classify as
// signed-out deletes nor explain as never-downloaded. Thrown BEFORE the baseline
// is recorded, so the pass invents no tombstone, records no baseline, and makes
// no successful reconciliation claim. See reconcileAgainstRemote.
export class SyncReconciliationConflictError extends Error {
  constructor({ table, reason, ids }) {
    super(
      `Sync paused for ${table}: this device's saved sync position is not trustworthy ` +
        `(${reason}), so ${ids.length} cloud row(s) missing from this device could not be ` +
        `classified as deletions or as rows that were never downloaded. Nothing was deleted ` +
        `and the rows were restored from the cloud; sync again to continue.`
    );
    this.name = 'SyncReconciliationConflictError';
    this.table = table;
    this.reason = reason;
    this.ids = ids;
    this.reconciliationConflict = true;
  }
}
