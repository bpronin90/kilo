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
});

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
      const { error } = await client.schema(SCHEMA).from(table).upsert(rows, { onConflict: 'user_id,id' });
      if (error) throw error;
    },
  };
}

export function getTransport() {
  return injectedTransport || makeSupabaseTransport();
}

let recomputeDerivedFn = (raw_text) => {
  // eslint-disable-next-line global-require
  const { parseWorkoutNote } = require('../../lib/parser');
  const { sections } = parseWorkoutNote(raw_text || '');
  return { derived_sections: sections };
};

export function setRecomputeDerived(fn) {
  recomputeDerivedFn = typeof fn === 'function' ? fn : recomputeDerivedFn;
}

export function getRecomputeDerived() {
  return recomputeDerivedFn;
}
