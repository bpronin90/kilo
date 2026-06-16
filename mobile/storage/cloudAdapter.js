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
import { getSupabaseClient } from '../lib/supabaseClient';

// App tables live in the kilo schema (see supabase/migrations).
const SCHEMA = 'kilo';

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

export class BootstrapError extends Error {
  constructor(message, { step, cause } = {}) {
    super(message);
    this.name = 'BootstrapError';
    this.step = step;
    if (cause) this.cause = cause;
  }
}

// ── legacy session → note-first synthesis ──────────────────────────────────
//
// Pure version of storage/entries.js migrateWorkoutNote(): synthesize a single
// raw workout note from the legacy `kilo_workout_sessions` array WITHOUT writing
// to AsyncStorage. The output format matches migrateWorkoutNote exactly so the
// existing parser/session-counting semantics hold. Returns null when there are
// no sessions to migrate.
export function synthesizeSessionsNote(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  const sorted = sessions.slice().sort((a, b) => a.date.localeCompare(b.date));

  const exerciseOrder = [];
  const seen = new Set();
  for (const session of sorted) {
    for (const item of session.items || []) {
      if (!seen.has(item.exercise_name)) {
        seen.add(item.exercise_name);
        exerciseOrder.push(item.exercise_name);
      }
    }
  }

  const entriesByExercise = new Map();
  for (const name of exerciseOrder) {
    entriesByExercise.set(
      name,
      sorted.map((session) => {
        const item = (session.items || []).find((i) => i.exercise_name === name);
        if (!item) return { kind: 'skip' };

        const weightGroups = [];
        const extraParts = [];

        for (const s of item.sets || []) {
          if (s.weight_value != null && s.rep_count != null) {
            const prev = weightGroups[weightGroups.length - 1];
            if (prev && prev.weight === s.weight_value) {
              prev.reps.push(s.rep_count);
            } else {
              weightGroups.push({ weight: s.weight_value, reps: [s.rep_count] });
            }
            if (s.note_text) extraParts.push(`[${s.note_text}]`);
          } else {
            const parts = [];
            if (s.assistance_value != null) {
              parts.push(
                s.assistance_unit
                  ? `assist:${s.assistance_value} ${s.assistance_unit}`
                  : `assist:${s.assistance_value}`
              );
            }
            if (s.rep_count != null) parts.push(`×${s.rep_count}`);
            if (s.duration_seconds != null) parts.push(`${s.duration_seconds}s`);
            if (s.note_text) parts.push(`[${s.note_text}]`);
            if (parts.length) extraParts.push(parts.join(' '));
          }
        }
        if (item.note_text) extraParts.push(item.note_text);

        if (weightGroups.length > 0) {
          const row = weightGroups
            .map(({ weight, reps }) => `${weight} ${reps.join(',')}`)
            .join(' ');
          const comments = extraParts.length > 0 ? [`-- ${extraParts.join(', ')}`] : [];
          return { kind: 'weight', row, comments };
        }
        if (extraParts.length > 0) {
          return { kind: 'nonweight', text: extraParts.join(', ') };
        }
        return { kind: 'skip' };
      })
    );
  }

  const lines = [`-- ${sorted.map((s) => s.date).join(', ')}`];
  for (const name of exerciseOrder) {
    lines.push(`-${name}`);
    for (const entry of entriesByExercise.get(name)) {
      if (entry.kind === 'weight') {
        lines.push(`- ${entry.row}`);
        for (const c of entry.comments) lines.push(c);
      } else if (entry.kind === 'nonweight') {
        lines.push(`- ${entry.text}`);
      } else {
        lines.push('-');
      }
    }
  }

  return lines.join('\n');
}

// ── local snapshot reader ───────────────────────────────────────────────────
//
// Read every mapped AsyncStorage key through the canonical local read functions.
// Read-only: this never mutates or removes any local key, so failure anywhere in
// the bootstrap leaves the device's local data untouched.
async function readLocalSnapshot() {
  const [
    weightEntries,
    weightGoal,
    workoutSessions,
    workoutNote,
    workoutNotes,
    currentWorkoutId,
    fatigueMultiplier,
    weightDateEditEnabled,
    deloadNote,
    deloadHistory,
    trackedLifts,
    logCurrentCollapsed,
    userProfile,
    deloadDateEditEnabled,
    fatigueTrackingEnabled,
    deloadModeEnabled,
  ] = await Promise.all([
    Storage.loadWeightEntries(),
    Storage.loadWeightGoal(),
    Storage.loadWorkoutSessions(),
    Storage.loadWorkoutNote(),
    Storage.loadWorkoutNotes(),
    Storage.loadCurrentWorkoutId(),
    Storage.loadFatigueMultiplier(),
    Storage.loadWeightDateEditEnabled(),
    Storage.loadDeloadNote(),
    Storage.loadDeloadHistory(),
    Storage.loadTrackedLifts(),
    Storage.loadWorkoutCollapsed(),
    Storage.loadUserProfile(),
    Storage.loadDeloadDateEditEnabled(),
    Storage.loadFatigueTrackingEnabled(),
    Storage.loadDeloadModeEnabled(),
  ]);

  return {
    weightEntries,
    weightGoal,
    workoutSessions,
    workoutNote,
    workoutNotes,
    currentWorkoutId,
    fatigueMultiplier,
    weightDateEditEnabled,
    deloadNote,
    deloadHistory,
    trackedLifts,
    logCurrentCollapsed,
    userProfile,
    deloadDateEditEnabled,
    fatigueTrackingEnabled,
    deloadModeEnabled,
  };
}

// ── payload builders (pure) ─────────────────────────────────────────────────
//
// Each builder turns the local snapshot into the exact row shape for its target
// table per the roadmap mapping. All rows are stamped with user_id so upserts
// are user-scoped and satisfy the RLS with-check policies.

// kilo_user_profile + pointers/preferences that live on the profile singleton.
function buildUserProfileRow(snapshot, userId) {
  const {
    userProfile,
    currentWorkoutId,
    fatigueMultiplier,
    trackedLifts,
    logCurrentCollapsed,
    deloadNote,
  } = snapshot;

  const PROMOTED = new Set(['display_name', 'unit_system', 'saved_at']);
  const profile = userProfile || {};

  // Copy any unpromoted local profile fields forward into profile_json so no
  // local data is dropped on bootstrap.
  const profileJson = {};
  for (const [k, v] of Object.entries(profile)) {
    if (!PROMOTED.has(k)) profileJson[k] = v;
  }

  const row = {
    user_id: userId,
    display_name: profile.display_name ?? null,
    unit_system: profile.unit_system ?? null,
    current_workout_note_id: currentWorkoutId ?? null,
    fatigue_multiplier: fatigueMultiplier ?? null,
    tracked_lifts: trackedLifts ?? {},
    ui_state: { log_current_collapsed: !!logCurrentCollapsed },
    profile_json: Object.keys(profileJson).length ? profileJson : null,
    updated_at: new Date().toISOString(),
  };

  // kilo_workout_deload_note → current/draft deload note fields on the profile.
  if (deloadNote) {
    row.current_deload_note_raw_text = deloadNote.raw_text ?? null;
    row.current_deload_note_saved_at = deloadNote.saved_at ?? null;
    row.current_deload_note_updated_at = deloadNote.updated_at ?? null;
  }

  return row;
}

// Boolean feature settings + their defaults.
function buildFeatureTogglesRow(snapshot, userId) {
  return {
    user_id: userId,
    weight_date_edit_enabled: !!snapshot.weightDateEditEnabled,
    deload_date_edit_enabled: !!snapshot.deloadDateEditEnabled,
    fatigue_tracking_enabled: snapshot.fatigueTrackingEnabled !== false,
    deload_mode_enabled: snapshot.deloadModeEnabled !== false,
    updated_at: new Date().toISOString(),
  };
}

// One local weight entry → one weight_entries row. Preserve ids and known fields.
function buildWeightEntryRows(snapshot, userId) {
  const now = new Date().toISOString();
  return (snapshot.weightEntries || []).map((e) => ({
    user_id: userId,
    id: e.id,
    entry_type: e.entry_type || 'weight',
    date: e.date ?? null,
    logged_at: e.logged_at ?? null,
    weight_value: e.weight_value,
    note: e.note ?? null,
    saved_at: e.saved_at ?? null,
    updated_at: now,
  }));
}

// Singleton weight goal. Returns null when there is no local goal.
function buildWeightGoalRow(snapshot, userId) {
  const g = snapshot.weightGoal;
  if (!g) return null;
  const PROMOTED = new Set([
    'target_weight',
    'target_date',
    'start_weight',
    'start_date',
    'saved_at',
  ]);
  const goalJson = {};
  for (const [k, v] of Object.entries(g)) {
    if (!PROMOTED.has(k)) goalJson[k] = v;
  }
  return {
    user_id: userId,
    target_weight: g.target_weight ?? null,
    target_date: g.target_date ?? null,
    start_weight: g.start_weight ?? null,
    start_date: g.start_date ?? null,
    goal_json: Object.keys(goalJson).length ? goalJson : null,
    saved_at: g.saved_at ?? null,
    updated_at: new Date().toISOString(),
  };
}

// All workout-note sources collapse into workout_notes rows keyed on (user_id, id):
//   - kilo_workout_notes:    one notebook item → one row (preserve derived JSON)
//   - kilo_workout_note:     legacy single note → one row (source_snapshot marker)
//   - kilo_workout_sessions: legacy structured sessions → one synthesized
//                            note-first row, original array kept in source_snapshot
//
// De-duplicated by id so a notebook that already absorbed the legacy note (via the
// local migrateToNotebook path) does not produce a conflicting second row.
function buildWorkoutNoteRows(snapshot, userId) {
  const now = new Date().toISOString();
  const byId = new Map();
  const currentId = snapshot.currentWorkoutId ?? null;

  const put = (row) => {
    if (!row || !row.id) return;
    byId.set(row.id, row);
  };

  // 1) Multi-note notebook items (primary source).
  for (const n of snapshot.workoutNotes || []) {
    put({
      user_id: userId,
      id: n.id,
      title: n.title ?? null,
      raw_text: n.raw_text ?? '',
      saved_at: n.saved_at ?? null,
      updated_at: n.updated_at ?? now,
      tracked_exercises: n.tracked_exercises ?? null,
      one_k_exercises: n.one_k_exercises ?? null,
      skip_markers: n.skip_markers ?? null,
      attendance_flags: n.attendance_flags ?? null,
      exercise_classifications: n.exercise_classifications ?? null,
      session_checkins: n.session_checkins ?? null,
      is_current: currentId != null && n.id === currentId,
      source_snapshot: null,
    });
  }

  // 2) Legacy single note (kilo_workout_note) — only if not already represented
  //    in the notebook. Synthesize a stable id and mark its origin.
  const legacy = snapshot.workoutNote;
  if (legacy && legacy.raw_text != null) {
    const alreadyImported = [...byId.values()].some(
      (r) => r.raw_text === legacy.raw_text
    );
    if (!alreadyImported) {
      const id = `wn_legacy_${userId}`;
      put({
        user_id: userId,
        id,
        title: 'Routine 1',
        raw_text: legacy.raw_text ?? '',
        saved_at: legacy.saved_at ?? null,
        updated_at: legacy.updated_at ?? now,
        tracked_exercises: legacy.tracked_exercises ?? null,
        one_k_exercises: legacy.one_k_exercises ?? null,
        skip_markers: null,
        attendance_flags: null,
        exercise_classifications: null,
        session_checkins: null,
        is_current: currentId === id,
        source_snapshot: { async_storage_key: 'kilo_workout_note' },
      });
    }
  }

  // 3) Legacy structured sessions (kilo_workout_sessions) → one synthesized
  //    note-first row, retaining the original array in source_snapshot.
  const sessions = snapshot.workoutSessions;
  if (Array.isArray(sessions) && sessions.length > 0) {
    const rawText = synthesizeSessionsNote(sessions);
    if (rawText != null) {
      const id = `wn_sessions_${userId}`;
      put({
        user_id: userId,
        id,
        title: 'Imported sessions',
        raw_text: rawText,
        saved_at: null,
        updated_at: now,
        tracked_exercises: null,
        one_k_exercises: null,
        skip_markers: null,
        attendance_flags: null,
        exercise_classifications: null,
        session_checkins: null,
        is_current: currentId === id,
        source_snapshot: {
          async_storage_key: 'kilo_workout_sessions',
          sessions,
        },
      });
    }
  }

  return [...byId.values()];
}

// One local deload record → one deload_history row. Unknown fields go to record_json.
function buildDeloadHistoryRows(snapshot, userId) {
  const now = new Date().toISOString();
  const PROMOTED = new Set(['id', 'date', 'raw_text', 'saved_at']);
  return (snapshot.deloadHistory || []).map((r) => {
    const recordJson = {};
    for (const [k, v] of Object.entries(r)) {
      if (!PROMOTED.has(k)) recordJson[k] = v;
    }
    return {
      user_id: userId,
      id: r.id,
      date: r.date ?? null,
      raw_text: r.raw_text ?? null,
      record_json: Object.keys(recordJson).length ? recordJson : null,
      saved_at: r.saved_at ?? null,
      updated_at: now,
    };
  });
}

// Build the full ordered upsert plan from a local snapshot. Exported for tests so
// the mapping can be asserted without a live Supabase connection.
export function buildBootstrapPlan(snapshot, userId) {
  return {
    user_profile: [buildUserProfileRow(snapshot, userId)],
    feature_toggles: [buildFeatureTogglesRow(snapshot, userId)],
    weight_entries: buildWeightEntryRows(snapshot, userId),
    weight_goal: (() => {
      const row = buildWeightGoalRow(snapshot, userId);
      return row ? [row] : [];
    })(),
    workout_notes: buildWorkoutNoteRows(snapshot, userId),
    deload_history: buildDeloadHistoryRows(snapshot, userId),
  };
}

// Upsert order: independent tables can go in any order, but we keep the profile
// last so its current_workout_note_id pointer is written after the notes exist.
const UPSERT_ORDER = [
  'feature_toggles',
  'weight_entries',
  'weight_goal',
  'workout_notes',
  'deload_history',
  'user_profile',
];

// Conflict targets per table so upsert is idempotent on re-run.
const CONFLICT_TARGETS = {
  user_profile: 'user_id',
  feature_toggles: 'user_id',
  weight_entries: 'user_id,id',
  weight_goal: 'user_id',
  workout_notes: 'user_id,id',
  deload_history: 'user_id,id',
};

// Bootstrap the current local dataset into the cloud for `userId`.
//
// Idempotent: every write is an upsert keyed on the table primary key, so a
// repeated run for the same user updates the same rows instead of duplicating.
// Local AsyncStorage is read-only throughout; a thrown BootstrapError leaves
// local state intact and the operation can simply be retried.
//
// `client` defaults to the lazily-constructed app Supabase client; tests inject
// a fake. Returns a per-table count summary on success.
export async function bootstrapFromLocal(userId, client = getSupabaseClient()) {
  if (!userId) {
    throw new BootstrapError('bootstrapFromLocal requires a userId', {
      step: 'precheck',
    });
  }
  if (!client) {
    throw new BootstrapError(
      'Cloud is not configured; cannot bootstrap to Supabase.',
      { step: 'precheck' }
    );
  }

  const snapshot = await readLocalSnapshot();
  const plan = buildBootstrapPlan(snapshot, userId);
  const db = client.schema(SCHEMA);

  const summary = {};
  for (const table of UPSERT_ORDER) {
    const rows = plan[table] || [];
    summary[table] = rows.length;
    if (rows.length === 0) continue;

    // One batched upsert per table — no per-row round trips.
    const { error } = await db
      .from(table)
      .upsert(rows, { onConflict: CONFLICT_TARGETS[table] });
    if (error) {
      throw new BootstrapError(
        `Bootstrap failed writing ${table}: ${error.message || error}`,
        { step: table, cause: error }
      );
    }
  }

  return { ok: true, userId, summary };
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
      let query = client.schema(SCHEMA).from(table).select('*');
      // Inclusive cursor (`>=`): after advancing to T, a tied remote row at
      // exactly T (winning by client_id) must still be pulled. The LWW merge is
      // idempotent, so re-pulling the boundary rows is safe.
      if (cursor) query = query.gte('updated_at', cursor);
      const { data, error } = await query.order('updated_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async push(table, records) {
      const client = getSupabaseClient();
      if (!client) throw new Error('Cloud sync requires a configured Supabase client.');
      // Stamp user_id on every pushed row so the upsert satisfies the RLS
      // with-check policy (user_id = auth.uid()) and the (user_id,id) conflict
      // target. The pure sync engine and injectable fake transport stay
      // user-agnostic; only the real transport resolves the authenticated user.
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Cloud sync requires an authenticated user.');
      const rows = records.map((rec) => ({ ...rec, user_id: userId }));
      const { error } = await client.schema(SCHEMA).from(table).upsert(rows, { onConflict: 'user_id,id' });
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
  // Bootstrap is an extra cloud-only capability beyond the mirrored surface.
  adapter.bootstrapFromLocal = bootstrapFromLocal;
  return adapter;
}

export const cloudAdapter = buildCloudAdapter();

export default cloudAdapter;
