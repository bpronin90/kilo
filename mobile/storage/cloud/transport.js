const SCHEMA = 'kilo';

// Per-table upsert column whitelist. The cloud `push` path must NOT spread
// arbitrary client-supplied fields onto the upsert: a tampered client could
// otherwise write columns the app never intended, or forge sync-ordering
// metadata. We send only the columns each table legitimately accepts.
//
// Two columns are intentionally OMITTED from every whitelist:
//   - `updated_at`: server-authoritative. A DB default plus a BEFORE
//     INSERT/UPDATE trigger (see the `kilo` schema migration) forces `now()`,
//     so a client-supplied `updated_at` can no longer manipulate last-write-wins
//     ordering. Dropping it from the wire payload keeps the client honest too.
//   - `client_id`: not a stored column in the `kilo` tables; it lives only in
//     the local sync engine as an LWW tie-break. Whitelisting columns drops it
//     from the write entirely.
//
// `user_id` is added server-bound from the authenticated session, never taken
// from the client record (RLS would reject a mismatch regardless).
const UPSERT_COLUMNS = Object.freeze({
  weight_entries: Object.freeze([
    'id',
    'entry_type',
    'date',
    'logged_at',
    'weight_value',
    'note',
    'saved_at',
    'deleted_at',
  ]),
  workout_notes: Object.freeze([
    'id',
    'title',
    'raw_text',
    'saved_at',
    'tracked_exercises',
    'one_k_exercises',
    'skip_markers',
    'attendance_flags',
    'exercise_classifications',
    'session_checkins',
    'is_current',
    'source_snapshot',
    'deleted_at',
  ]),
  archived_weight_goals: Object.freeze([
    'id',
    'target_weight',
    'target_date',
    'start_weight',
    'start_date',
    'completed_weight',
    'archived_at',
    'goal_json',
    'saved_at',
    'deleted_at',
  ]),
  // ── singleton tables (issue #489) ──────────────────────────────────────────
  // `user_profile`, `feature_toggles`, and `weight_goal` key on `user_id` alone
  // and have NO `id` column. `id` is therefore deliberately ABSENT from these
  // three whitelists: the sync engine gives pulled singleton rows the synthetic
  // id `self` so the id-keyed merge works, and buildUpsertRow drops it right
  // back out here so it is never sent to a column that does not exist.
  //
  // `user_profile.current_deload_note_*` is also deliberately absent: those
  // columns are written by bootstrap only. Round-tripping them through ongoing
  // sync needs `deloadStorage.saveDeloadNote`, which re-stamps `updated_at` on
  // every write and would ping-pong forever. A partial upsert leaves the columns
  // untouched on the UPDATE path, so bootstrap's values survive.
  //
  // The device-local demographic fields (date_of_birth, sex, height_cm,
  // activity_level) are NOT here and must not be added: cloud sync for them is
  // issue #476, on hold pending Play Data Safety / DPA / privacy-policy updates.
  user_profile: Object.freeze([
    'display_name',
    'unit_system',
    'current_workout_note_id',
    'fatigue_multiplier',
    'tracked_lifts',
    'ui_state',
    'deleted_at',
  ]),
  feature_toggles: Object.freeze([
    'weight_date_edit_enabled',
    'deload_date_edit_enabled',
    'fatigue_tracking_enabled',
    'deload_mode_enabled',
    'deleted_at',
  ]),
  weight_goal: Object.freeze([
    'target_weight',
    'target_date',
    'start_weight',
    'start_date',
    'goal_json',
    'saved_at',
    'deleted_at',
  ]),
  deload_history: Object.freeze([
    'id',
    'date',
    'raw_text',
    'record_json',
    'saved_at',
    'deleted_at',
  ]),
});

// Upsert conflict target per table. Singleton tables key on `user_id` alone;
// everything else on the composite `(user_id, id)` primary key. Hardcoding
// `user_id,id` for every table (the pre-#489 behaviour) made it impossible to
// upsert a singleton at all.
const SINGLETON_CONFLICT_TARGET = 'user_id';
const COLLECTION_CONFLICT_TARGET = 'user_id,id';
const CONFLICT_TARGETS = Object.freeze({
  user_profile: SINGLETON_CONFLICT_TARGET,
  feature_toggles: SINGLETON_CONFLICT_TARGET,
  weight_goal: SINGLETON_CONFLICT_TARGET,
});

export function conflictTargetFor(table) {
  return CONFLICT_TARGETS[table] || COLLECTION_CONFLICT_TARGET;
}

// Build the server-bound upsert row for one record: only whitelisted columns
// that are actually present on the record, plus the server-bound user_id.
// `updated_at`, `client_id`, and any unexpected fields are dropped here.
function buildUpsertRow(table, rec, userId) {
  const allowed = UPSERT_COLUMNS[table];
  if (!allowed) {
    throw new Error(`Cloud sync push: no column whitelist for table "${table}".`);
  }
  const row = { user_id: userId };
  for (const col of allowed) {
    if (Object.prototype.hasOwnProperty.call(rec, col)) {
      row[col] = rec[col];
    }
  }
  return row;
}

let injectedTransport = null;

export function setCloudTransport(transport) {
  injectedTransport = transport;
}

function makeSupabaseTransport() {
  // eslint-disable-next-line global-require
  const { getSupabaseClient } = require('../../lib/supabaseClient');
  return {
    async pull(table, cursor) {
      const client = getSupabaseClient();
      if (!client) return [];
      let query = client.schema(SCHEMA).from(table).select('*');
      if (cursor) query = query.gte('updated_at', cursor);
      const { data, error } = await query.order('updated_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async push(table, records) {
      const client = getSupabaseClient();
      if (!client) throw new Error('Cloud sync requires a configured Supabase client.');
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      const userId = userData?.user?.id;
      if (!userId) throw new Error('Cloud sync requires an authenticated user.');
      const rows = records.map((rec) => buildUpsertRow(table, rec, userId));
      const { error } = await client
        .schema(SCHEMA)
        .from(table)
        .upsert(rows, { onConflict: conflictTargetFor(table) });
      if (error) throw error;
    },
  };
}

export function getTransport() {
  return injectedTransport || makeSupabaseTransport();
}

let recomputeDerivedFn = (raw_text) => {
  // Require the parser submodule directly (not the barrel) so the shared
  // MAX_RAW_TEXT_LENGTH cap is available without touching the parser barrel.
  // eslint-disable-next-line global-require
  const { parseWorkoutNote, MAX_RAW_TEXT_LENGTH } = require('../../lib/parser/workoutNote.js');
  const text = raw_text || '';
  // Enforce the same untrusted-input cap on synced remote rows so a remote-origin
  // raw_text cannot bypass the parser bound. parseWorkoutNote also rejects
  // oversized text and returns an empty `sections`; this explicit guard keeps the
  // limit visible on the recompute path and skips the call entirely.
  if (text.length > MAX_RAW_TEXT_LENGTH) {
    return { derived_sections: [] };
  }
  const { sections } = parseWorkoutNote(text);
  return { derived_sections: sections };
};

export function setRecomputeDerived(fn) {
  recomputeDerivedFn = typeof fn === 'function' ? fn : recomputeDerivedFn;
}

export function getRecomputeDerived() {
  return recomputeDerivedFn;
}
