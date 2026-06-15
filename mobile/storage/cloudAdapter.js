// Cloud-backed storage adapter.
//
// Scope (Phase 4 / Task 10): this adapter now implements a one-way, user-initiated
// *bootstrap* that uploads the existing local AsyncStorage dataset into the
// note-first cloud schema. Continuous read/write/sync still lands in a later
// phase, so every domain method (loadWeightEntries, saveWeightEntry, ...) remains
// a not-implemented shell and throws `CloudNotImplementedError`. Screens and
// hooks must not call those yet; cloud mode is only safe to use for bootstrap.
//
// Bootstrap contract (see docs/backend-roadmap.md "AsyncStorage Key Mapping"):
//   - Reads local data through storage/entries.js read functions only. Local
//     AsyncStorage is never written or removed during bootstrap, so a failed
//     bootstrap leaves local state fully intact and is retryable.
//   - Writes each mapped AsyncStorage key to its target table/field in the
//     `kilo` schema using upserts keyed on the table primary key. Re-running the
//     bootstrap for the same user therefore updates the same rows instead of
//     duplicating them.
//   - Legacy `kilo_workout_sessions` is migrated note-first: its structured
//     sessions are synthesized into a single `workout_notes.raw_text` row and the
//     original session array is retained in `source_snapshot`. It is never
//     written to normalized per-set tables.
//
// This module does not import the Supabase SDK or construct a client at load
// time. It reaches the supabaseClient seam lazily, only when bootstrap runs.

import * as Storage from './entries';
import { ADAPTER_METHODS } from './localAdapter';
import { getSupabaseClient } from '../lib/supabaseClient';

// App tables live in the `kilo` schema (see supabase/migrations).
const SCHEMA = 'kilo';

export class CloudNotImplementedError extends Error {
  constructor(method) {
    super(
      `Cloud storage adapter is not implemented yet (method: ${method}). ` +
        'Bootstrap is available via bootstrapFromLocal(); continuous sync lands ' +
        'in a later phase. Use local mode for day-to-day reads/writes.'
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

// Build the not-implemented shell by declaring every local adapter method as a
// stub. This guarantees the cloud surface still matches the local surface 1:1
// until continuous sync is implemented.
function buildCloudAdapterShell() {
  const adapter = { mode: 'cloud' };
  for (const method of ADAPTER_METHODS) {
    adapter[method] = () => {
      throw new CloudNotImplementedError(method);
    };
  }
  // Bootstrap is the one implemented cloud capability in this phase.
  adapter.bootstrapFromLocal = bootstrapFromLocal;
  return adapter;
}

export const cloudAdapter = buildCloudAdapterShell();

export default cloudAdapter;
