// Cloud-backed storage adapter (Phase 4 / Task 11: offline LWW sync).
//
// The adapter keeps AsyncStorage as the immediate offline read/write cache and
// layers last-write-wins cloud sync behind the same method surface as the local
// adapter. Domain writes:
//   1. stamp the record with sync metadata (`client_id`, `updated_at`,
//      `deleted_at`) via syncQueue,
//   2. write it to the local AsyncStorage cache immediately (so the app works
//      offline), and
//   3. enqueue it on the persisted per-table dirty queue.
// When connectivity is available, `sync()` runs the roadmap loop per table:
// pull changed rows since cursor -> LWW merge into the cache -> push dirty
// records (live writes and delete tombstones together) -> advance the cursor
// only after a successful push.
//
// Tombstone-first delete: a delete stamps a `deleted_at` tombstone, caches it,
// and enqueues it. The tombstoned row is retained in the local cache (filtered
// out of user-facing reads) so the delete pushes before any physical cleanup.
// Export-safe physical retention/cleanup is left to a later phase; we never
// physically delete before the tombstone syncs.
//
// Derived workout JSON is a recomputable cache of `raw_text`. When local and
// remote agree on `raw_text` but disagree on derived fields, the merge resolves
// by recompute, not a user-facing conflict (see syncQueue.resolveRecord).
//
// Bootstrap (#319) is intentionally decoupled: this adapter syncs against the
// roadmap tables using stable ids and does not depend on bootstrap-specific
// code. The Supabase transport is reached lazily through the supabaseClient
// seam and is fully injectable so the sync layer is testable offline.
//
// Domains beyond weight entries and workout notes (the Task 11 acceptance
// targets) keep throwing `CloudNotImplementedError` so the cloud surface stays
// 1:1 with the local adapter and a later phase wires them through the same
// mechanism.

import * as Storage from './entries';
import { ADAPTER_METHODS } from './localAdapter';
import {
  SYNC_TABLES,
  syncTable,
  stampWrite,
  stampTombstone,
  isTombstone,
  getClientId,
  enqueueDirty,
} from './syncQueue';

export class CloudNotImplementedError extends Error {
  constructor(method) {
    super(
      `Cloud storage adapter is not implemented yet (method: ${method}). ` +
        'Weight entries and workout notes sync; other domains land later.'
    );
    this.name = 'CloudNotImplementedError';
    this.method = method;
  }
}

// ── Supabase transport (lazy, injectable) ──────────────────────────────────────

// The cloud transport implements the syncQueue contract:
//   pull(table, cursor) -> Promise<Array<record>>
//   push(table, records) -> Promise<void>
// It is reached lazily so signed-out/local-only users never construct a client,
// and it is injectable so tests can drive the full sync loop offline.
let injectedTransport = null;

// Test/wiring hook: install a transport (or null to fall back to Supabase).
export function setCloudTransport(transport) {
  injectedTransport = transport;
}

function makeSupabaseTransport() {
  // Reached only when real cloud sync runs. Imported lazily to avoid pulling the
  // Supabase client into local-only sessions or at module load time.
  // eslint-disable-next-line global-require
  const { getSupabaseClient } = require('../lib/supabaseClient');
  return {
    async pull(table, cursor) {
      const client = getSupabaseClient();
      if (!client) return [];
      let query = client.from(table).select('*');
      if (cursor) query = query.gt('updated_at', cursor);
      const { data, error } = await query.order('updated_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async push(table, records) {
      const client = getSupabaseClient();
      if (!client) throw new Error('Cloud sync requires a configured Supabase client.');
      const { error } = await client.from(table).upsert(records, { onConflict: 'user_id,id' });
      if (error) throw error;
    },
  };
}

function getTransport() {
  return injectedTransport || makeSupabaseTransport();
}

// ── derived workout-note recompute ─────────────────────────────────────────────

// Recompute derived workout-note JSON deterministically from canonical raw_text.
// Used by the LWW merge so a derived-only divergence is resolved by recompute,
// never surfaced as a user conflict. Injectable for tests; defaults to the
// shipped parser. We attach a stable `derived_sections` snapshot rather than
// guessing at per-field derivations the parser does not expose directly.
let recomputeDerivedFn = (raw_text) => {
  // eslint-disable-next-line global-require
  const { parseWorkoutNote } = require('../lib/parser');
  const { sections } = parseWorkoutNote(raw_text || '');
  return { derived_sections: sections };
};

export function setRecomputeDerived(fn) {
  recomputeDerivedFn = typeof fn === 'function' ? fn : recomputeDerivedFn;
}

// ── local cache list helpers per sync table ─────────────────────────────────────
//
// The sync engine reads/writes the full cache list for a table. Weight entries
// and workout notes are list-backed in entries.js. We keep tombstones in the
// cache list until they have synced (so deletes push before physical cleanup);
// user-facing reads filter tombstones out.

const TABLE_IO = {
  [SYNC_TABLES.WEIGHT_ENTRIES]: {
    read: () => Storage.loadWeightEntriesRaw(),
    write: (list) => Storage.replaceWeightEntriesRaw(list),
  },
  [SYNC_TABLES.WORKOUT_NOTES]: {
    read: () => Storage.loadWorkoutNotesRaw(),
    write: (list) => Storage.replaceWorkoutNotesRaw(list),
  },
};

// Run one sync pass for one table.
async function syncOne(table) {
  const io = TABLE_IO[table];
  return syncTable({
    table,
    transport: getTransport(),
    readLocal: io.read,
    writeLocal: io.write,
    recomputeDerived: recomputeDerivedFn,
  });
}

// Public sync entrypoint: sync every supported table sequentially. A failure on
// one table surfaces to the caller (reconnect handler / hook) to retry; the
// dirty queue and cursors mean a failed pass loses no data and simply retries.
export async function sync() {
  const results = [];
  for (const table of [SYNC_TABLES.WEIGHT_ENTRIES, SYNC_TABLES.WORKOUT_NOTES]) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await syncOne(table));
  }
  return results;
}

function localDateToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── domain methods: weight entries ──────────────────────────────────────────────

async function loadWeightEntries() {
  const list = await Storage.loadWeightEntriesRaw();
  return list
    .filter((e) => !isTombstone(e))
    .sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''));
}

async function saveWeightEntry(entry) {
  const clientId = await getClientId();
  const stamped = stampWrite(entry, clientId);
  const list = await Storage.loadWeightEntriesRaw();
  const idx = list.findIndex((e) => e.id === stamped.id);
  if (idx >= 0) list[idx] = stamped;
  else list.push(stamped);
  await Storage.replaceWeightEntriesRaw(list);
  await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, stamped);
}

async function updateWeightEntry(id, weight_value, note, date) {
  const list = await Storage.loadWeightEntriesRaw();
  const entry = list.find((e) => e.id === id);
  if (!entry || isTombstone(entry)) return false;
  entry.weight_value = weight_value;
  entry.note = note;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= localDateToday()) {
    entry.logged_at = date + (entry.logged_at || '').slice(10);
    entry.date = date;
  }
  const clientId = await getClientId();
  const stamped = stampWrite(entry, clientId);
  const idx = list.findIndex((e) => e.id === id);
  list[idx] = stamped;
  await Storage.replaceWeightEntriesRaw(list);
  await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, stamped);
  return true;
}

async function deleteWeightEntry(id) {
  const list = await Storage.loadWeightEntriesRaw();
  const entry = list.find((e) => e.id === id);
  if (!entry) return;
  const clientId = await getClientId();
  const tombstone = stampTombstone(entry, clientId);
  const idx = list.findIndex((e) => e.id === id);
  list[idx] = tombstone;
  await Storage.replaceWeightEntriesRaw(list);
  await enqueueDirty(SYNC_TABLES.WEIGHT_ENTRIES, tombstone);
}

// ── domain methods: workout notes ───────────────────────────────────────────────

async function loadWorkoutNotes() {
  const list = await Storage.loadWorkoutNotesRaw();
  return list.filter((n) => !isTombstone(n));
}

async function saveWorkoutNoteItem(note) {
  const clientId = await getClientId();
  const stamped = stampWrite(note, clientId);
  const list = await Storage.loadWorkoutNotesRaw();
  const idx = list.findIndex((n) => n.id === stamped.id);
  if (idx >= 0) list[idx] = stamped;
  else list.push(stamped);
  await Storage.replaceWorkoutNotesRaw(list);
  await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, stamped);
}

async function deleteWorkoutNoteItem(id) {
  const list = await Storage.loadWorkoutNotesRaw();
  const note = list.find((n) => n.id === id);
  if (!note) return;
  const clientId = await getClientId();
  const tombstone = stampTombstone(note, clientId);
  const idx = list.findIndex((n) => n.id === id);
  list[idx] = tombstone;
  await Storage.replaceWorkoutNotesRaw(list);
  await enqueueDirty(SYNC_TABLES.WORKOUT_NOTES, tombstone);
}

// ── adapter assembly ────────────────────────────────────────────────────────────

// Implemented cloud-backed domain methods (Task 11 acceptance targets).
const IMPLEMENTED = {
  sync,
  loadWeightEntries,
  saveWeightEntry,
  updateWeightEntry,
  deleteWeightEntry,
  loadWorkoutNotes,
  saveWorkoutNoteItem,
  deleteWorkoutNoteItem,
};

// Build the adapter: implemented methods are real; every other method on the
// local surface stays a not-implemented stub so the cloud surface mirrors the
// local adapter 1:1 and no method is silently dropped.
function buildCloudAdapter() {
  const adapter = { mode: 'cloud', sync };
  for (const method of ADAPTER_METHODS) {
    adapter[method] = IMPLEMENTED[method]
      ? IMPLEMENTED[method]
      : () => {
          throw new CloudNotImplementedError(method);
        };
  }
  return adapter;
}

export const cloudAdapter = buildCloudAdapter();

export default cloudAdapter;
