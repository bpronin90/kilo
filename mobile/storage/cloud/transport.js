const SCHEMA = 'kilo';
const PULL_PAGE_SIZE = 1000;
const PULL_META_FIELD = '__kilo_pull_meta';
const ROW_XID_FIELD = '__kilo_sync_xid';

// Per-table upsert column whitelist. The cloud `push` path must NOT spread
// arbitrary client-supplied fields onto the upsert: a tampered client could
// otherwise write columns the app never intended, or forge sync-ordering
// metadata. We send only the columns each table legitimately accepts.
//
// Three columns are intentionally OMITTED from every whitelist:
//   - `updated_at`: server-authoritative. A DB default plus a BEFORE
//     INSERT/UPDATE trigger (see the `kilo` schema migration) forces `now()`,
//     so a client-supplied `updated_at` can no longer manipulate last-write-wins
//     ordering. Dropping it from the wire payload keeps the client honest too.
//   - `client_id`: not a stored column in the `kilo` tables; it lives only in
//     the local sync engine as an LWW tie-break. Whitelisting columns drops it
//     from the write entirely.
//   - `sync_xid`: internal server transaction-ordering evidence. The same
//     BEFORE trigger that owns updated_at stamps it; clients never propose it.
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
  // `user_profile.current_deload_note_*` is deliberately absent from the
  // user_profile whitelist: those columns are health data and moved to
  // user_health_profile in #487, where the active deload now syncs (see below).
  // On the mixed user_profile row they stay bootstrap-only.
  //
  // The device-local demographic fields (date_of_birth, sex, height_cm,
  // activity_level) are NOT here and must not be added: cloud sync for them is
  // issue #476, on hold pending Play Data Safety / DPA / privacy-policy updates.
  // Account settings ONLY. current_workout_note_id, fatigue_multiplier, and
  // tracked_lifts are data concerning health (Art. 9) and moved to
  // user_health_profile in #487. They must not be listed here: writing them would
  // be an ungated health write into a mixed table, and the contract migration
  // drops those columns outright — an upsert naming them fails with PGRST204 and
  // takes ordinary settings sync down with it.
  user_profile: Object.freeze([
    'display_name',
    'unit_system',
    'ui_state',
    'deleted_at',
  ]),
  // The consent-gated health singleton (#487). Same singleton shape as
  // user_profile: keys on user_id, carries no `id` column.
  //
  // The three current_deload_note_* columns (issue #498) carry the active,
  // in-progress generated deload so it converges across devices. They are safe to
  // round-trip here — unlike the abandoned user_profile path — because
  // syncAdapter.applyUserHealthProfile writes the pulled winner's timestamps
  // VERBATIM via deloadStorage.applyDeloadNoteFromSync instead of re-stamping
  // through saveDeloadNote, so there is no updated_at ping-pong.
  user_health_profile: Object.freeze([
    'current_workout_note_id',
    'fatigue_multiplier',
    'tracked_lifts',
    'current_deload_note_raw_text',
    'current_deload_note_saved_at',
    'current_deload_note_updated_at',
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
  // Derived fatigue projection (issue #498). A COLLECTION keyed on (user_id, id):
  // the id is the stable fatigueCheckinId, so it is whitelisted and sent. The
  // projection is one-directional — the client only ever pushes/tombstones these
  // rows; a pulled row is never written back into a note's canonical
  // session_checkins.
  fatigue_checkins: Object.freeze([
    'id',
    'workout_note_id',
    'session_date',
    'status',
    'reasons',
    'source_json',
    'deleted_at',
  ]),
  // ── recovery blocks (#692/#693) ────────────────────────────────────────────
  // Two ordinary (user_id, id) collections. `baseline` is the frozen snapshot
  // and rides through verbatim as jsonb: neither the client's sync path nor the
  // server ever recomputes it, so what is written at creation is what every
  // device reads back forever.
  //
  // `started_at`/`saved_at` ARE whitelisted even though they never change after
  // creation. They are client-owned record content (when the recovery began,
  // when the row was first written), not sync-ordering metadata, and the merge
  // needs them to survive a round trip so a device that first learns of a block
  // from the cloud can order and display it. The three columns omitted from
  // every table above — `updated_at`, `client_id`, `sync_xid` — stay omitted
  // here for exactly the reasons documented there.
  recovery_blocks: Object.freeze([
    'id',
    'baseline_note_id',
    'baseline_note_title',
    'baseline',
    'include_in_normal_analytics',
    // The optional "why this block started" reason (#872). Whitelisted so an
    // edit reaches the cloud, and so a device that first learns of a block from
    // a pull keeps the reason on the next push instead of quietly dropping the
    // column back to null on every round trip.
    'reason',
    'started_at',
    'completed_at',
    'saved_at',
    'deleted_at',
  ]),
  recovery_block_weeks: Object.freeze([
    'id',
    'block_id',
    'note_id',
    'week_number',
    'completed_at',
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
  user_health_profile: SINGLETON_CONFLICT_TARGET,
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

// The user id the last `auth.getUser()` validated, together with the access
// token it validated (issue #806).
//
// `push` needs the authenticated user id to bind `user_id` on every upsert row,
// and `auth.getUser()` is a NETWORK call to the auth server. A sync pass pushes
// one batch per table, so the pre-#806 code paid an extra round trip per pushed
// table — measured at 9 of the 29 round trips in a first full upload — to
// re-validate a token that had not changed between them.
//
// The cache is keyed on the access token itself, read locally from the stored
// session, so it is only ever reused for the exact credential that was
// validated: a refresh, a different account, or a sign-out mints a new token and
// forces a fresh validation. Nothing here is an authorization decision — RLS
// rejects a row whose user_id does not match the JWT the request carries, and
// that check is unchanged and unavoidable. A client that cannot report its
// session falls back to validating on every push.
// Independent tables push concurrently, so a cold cache is shared through an
// in-flight validation rather than letting each pusher start its own.
let validatedUser = null;
let validationInFlight = null;

async function validateUserId(client, token) {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  const userId = userData?.user?.id;
  if (!userId) throw new Error('Cloud sync requires an authenticated user.');
  validatedUser = token ? { token, userId } : null;
  return userId;
}

async function resolveUserId(client) {
  let token = null;
  if (typeof client?.auth?.getSession === 'function') {
    const { data } = (await client.auth.getSession()) || {};
    token = data?.session?.access_token ?? null;
    if (token) {
      if (validatedUser && validatedUser.token === token) return validatedUser.userId;
      if (validationInFlight && validationInFlight.token === token) {
        return validationInFlight.promise;
      }
    }
  }

  const promise = validateUserId(client, token);
  if (token) {
    validationInFlight = { token, promise };
    const clear = () => {
      if (validationInFlight && validationInFlight.promise === promise) {
        validationInFlight = null;
      }
    };
    promise.then(clear, clear);
  }
  return promise;
}

// Test/maintenance hook: forget the validated session so the next push
// re-validates against the auth server.
export function resetValidatedUserCacheForTests() {
  validatedUser = null;
  validationInFlight = null;
}

let injectedTransport = null;

export function setCloudTransport(transport) {
  injectedTransport = transport;
}

function getConfiguredSupabaseClient() {
  // eslint-disable-next-line global-require
  return require('../../lib/supabaseClient').getSupabaseClient();
}

function pullSecondaryOrder(table) {
  return conflictTargetFor(table) === SINGLETON_CONFLICT_TARGET ? 'user_id' : 'id';
}

function stripSyncXid(row) {
  if (!row || typeof row !== 'object') return row;
  const { [ROW_XID_FIELD]: _syncXid, sync_xid: _rawSyncXid, ...clean } = row;
  return clean;
}

// Exposed for the focused transport contract tests; production callers use
// getTransport(), which supplies the configured application client.
export function createSupabaseTransport(getClient = getConfiguredSupabaseClient) {
  return {
    async pull(table, cursor) {
      const client = getClient();
      if (!client) return [];
      const rows = [];
      const rowXids = {};
      const secondary = pullSecondaryOrder(table);
      let boundary = null;
      let afterUpdatedAt = null;
      let afterId = null;
      const schemaClient = client.schema(SCHEMA);

      // Reduced injected clients used by push-focused tests predate the RPC
      // pull seam. They cannot emulate commit visibility, so represent that
      // capability honestly as no pull rather than falling back to the unsafe
      // live-table offset query this RPC replaced.
      if (typeof schemaClient.rpc !== 'function') return [];

      // Each RPC page is restricted to one server-captured transaction boundary.
      // Continuation seeks strictly after the final (updated_at, primary-key)
      // pair instead of using offsets, so concurrent inserts/deletes cannot move
      // an unvisited row across a page boundary.
      for (;;) {
        const { data, error } = await schemaClient.rpc('pull_sync_changes', {
          p_table: table,
          p_cursor: cursor,
          p_boundary: boundary,
          p_after_updated_at: afterUpdatedAt,
          p_after_id: afterId,
          p_limit: PULL_PAGE_SIZE,
        });
        if (error) throw error;
        const page = Array.isArray(data?.rows) ? data.rows : [];
        boundary = data?.cursor || boundary;

        for (const row of page) {
          const key = row?.[secondary];
          const xid = row?.[ROW_XID_FIELD];
          if (key != null && xid != null) rowXids[String(key)] = String(xid);
          rows.push(stripSyncXid(row));
        }

        if (!data?.has_more || page.length === 0) break;
        const last = page[page.length - 1];
        afterUpdatedAt = last.updated_at;
        afterId = String(last[secondary]);
      }

      // Keep the public pull value array-compatible for injected transports and
      // the singleton adapter. syncQueue consumes and removes this internal
      // sentinel before any row reaches merge or local storage.
      rows.push({
        [PULL_META_FIELD]: {
          cursor: boundary,
          row_xids: rowXids,
        },
      });
      return rows;
    },
    async push(table, records) {
      const client = getClient();
      if (!client) throw new Error('Cloud sync requires a configured Supabase client.');
      const userId = await resolveUserId(client);
      const rows = records.map((rec) => buildUpsertRow(table, rec, userId));
      const upserted = client
        .schema(SCHEMA)
        .from(table)
        .upsert(rows, { onConflict: conflictTargetFor(table) });
      const { data, error } =
        typeof upserted.select === 'function' ? await upserted.select('*') : await upserted;
      if (error) throw error;
      return (data || []).map(stripSyncXid);
    },
  };
}

export function getTransport() {
  return injectedTransport || createSupabaseTransport();
}

// The derived-field recompute seam consumed by syncQueue.resolveRecord: when a
// workout note's local and remote copies agree on `raw_text`, the merge asks
// this function for the derived fields to lay over the LWW winner instead of
// trusting either side's stale cache.
//
// No derived field is persisted by default any more (issue #813). The previous
// default attached the parser's full output (`derived_sections`) to the merged
// note, and because a device's own pushed rows come back on its next pull, every
// note it had ever uploaded ended up carrying a cache roughly one hundred times
// the size of its text - in the notebook, in the sync baseline, in the pending
// queue, and in every backup - for a field nothing read. Every screen re-parses
// `raw_text` at render, so there is nothing to recompute here; the seam stays
// injectable for tests and for any future derived column, and the parser is no
// longer touched on the sync path at all.
const DEFAULT_RECOMPUTE_DERIVED = null;
let recomputeDerivedFn = DEFAULT_RECOMPUTE_DERIVED;

// Passing anything but a function restores the default (no recompute).
export function setRecomputeDerived(fn) {
  recomputeDerivedFn = typeof fn === 'function' ? fn : DEFAULT_RECOMPUTE_DERIVED;
}

export function getRecomputeDerived() {
  return recomputeDerivedFn;
}
