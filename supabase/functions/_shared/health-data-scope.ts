// The single definition of Kilo's consent-gated health-data set (issue #487).
//
// account-export, account-delete, and health-data-delete all import THIS module.
// None of them may keep its own table list. That rule is not stylistic: the three
// functions answer the same legal question from three directions — "what did the
// user consent to", "what must be erased on withdrawal", and "what must be
// exported on request" — and a list that drifts in one of them means Kilo either
// under-deletes health data after consent is withdrawn (an Art. 17 failure) or
// exports an incomplete copy (an Art. 15 failure). health-data-scope.test.ts
// fails the build if the three ever diverge, or if the set omits one of the seven
// gated tables.
//
// Adding a gated table or column requires updating: this file, its contract test,
// kilo.health_gated_tables() in supabase/migrations/20260714120002, AND the
// material consent version — in the same change. A new health category the user
// never agreed to is not covered by an old grant.
//
// Access model: these helpers run under a SERVICE-ROLE client, not the caller's
// RLS session, and every statement is explicitly filtered to one user_id.
//
// That is deliberate. Once kilo.health_gate_ok() is armed, a non-granting user's
// own session can no longer read or write their gated rows — which is the whole
// point of the gate — but export and deletion still must work for exactly those
// users: the spec's 30-day quarantine window offers them "export, then delete",
// and account deletion has to erase health data whether or not consent was ever
// given. A user-scoped RLS client cannot do either once the gate denies. Identity
// is still proven by the caller's JWT before any of this runs; the service role
// is used only to reach past the consent gate, never to widen scope. The user_id
// filter is applied HERE, inside the shared module, so no call site can forget it.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'

export interface HealthTableDescriptor {
  /** Table name inside the `kilo` schema. */
  readonly table: string
  /** Key shape: a singleton is one row per user; a collection is many. */
  readonly kind: 'singleton' | 'collection'
  /** Key under which account-export emits this table. */
  readonly exportKey: string
  /** Ascending deletion order. Deterministic so a partial purge retries identically. */
  readonly deleteOrder: number
}

/**
 * The seven tables that hold data concerning health. `user_health_profile` is the
 * canonical home of the six values that used to sit in the mixed `user_profile`
 * table; the other six tables were always health data.
 */
export const HEALTH_DATA_SCOPE: readonly HealthTableDescriptor[] = Object.freeze([
  { table: 'fatigue_checkins',     kind: 'collection', exportKey: 'fatigue_checkins',     deleteOrder: 1 },
  { table: 'deload_history',       kind: 'collection', exportKey: 'deload_history',       deleteOrder: 2 },
  { table: 'workout_notes',        kind: 'collection', exportKey: 'workout_notes',        deleteOrder: 3 },
  { table: 'weight_entries',       kind: 'collection', exportKey: 'weight_entries',       deleteOrder: 4 },
  { table: 'archived_weight_goals',kind: 'collection', exportKey: 'archived_weight_goals',deleteOrder: 5 },
  { table: 'weight_goal',          kind: 'singleton',  exportKey: 'weight_goal',          deleteOrder: 6 },
  { table: 'user_health_profile',  kind: 'singleton',  exportKey: 'user_health_profile',  deleteOrder: 7 },
] as const)

/**
 * The six health columns that remain on `kilo.user_profile` during the expand
 * phase. They are still health data, so withdrawal must clear them — but they are
 * columns on a MIXED table, so they are cleared, never deleted with the row:
 * display_name, unit_system, and ui_state are ordinary account settings that a
 * user who refuses health consent keeps.
 *
 * supabase/operations/health-data-contract.sql drops these columns. Once it has
 * run, clearing them is a no-op and the helper below tolerates their absence.
 */
export const LEGACY_HEALTH_COLUMNS: readonly string[] = Object.freeze([
  'current_deload_note_raw_text',
  'current_deload_note_saved_at',
  'current_deload_note_updated_at',
  'fatigue_multiplier',
  'tracked_lifts',
  'current_workout_note_id',
])

/**
 * Ungated account preferences. They may reveal that a user *uses* a feature, but
 * they hold no measurement, note, goal, or lift selection, so they are not health
 * data and withdrawal does not delete them. Listed explicitly so a future change
 * cannot quietly reclassify them by omission.
 */
export const UNGATED_FEATURE_PREFERENCES: readonly string[] = Object.freeze([
  'feature_toggles.fatigue_tracking_enabled',
  'feature_toggles.deload_mode_enabled',
])

/** Gated table names, in deletion order. */
export function healthTableNames(): string[] {
  return [...HEALTH_DATA_SCOPE]
    .sort((a, b) => a.deleteOrder - b.deleteOrder)
    .map((d) => d.table)
}

export interface HealthExportResult {
  ok: boolean
  error?: string
  /** exportKey -> row (singleton) or rows (collection). */
  data: Record<string, unknown>
}

/**
 * Read every gated table for one user. Singletons come back as an object or null;
 * collections as an array.
 *
 * During expansion the six legacy `user_profile` columns are NOT exported
 * separately: `user_health_profile` already holds the same values (the migration
 * backfilled them and the compatibility mirrors keep them in agreement), and
 * exporting both would hand the user two copies of the same health data and imply
 * they are distinct records.
 */
export async function exportHealthData(
  admin: SupabaseClient,
  userId: string,
): Promise<HealthExportResult> {
  const results = await Promise.all(
    HEALTH_DATA_SCOPE.map(async (d) => {
      const query = admin.from(d.table).select('*').eq('user_id', userId)
      const { data, error } = d.kind === 'singleton' ? await query.maybeSingle() : await query
      return { descriptor: d, data, error }
    }),
  )

  const failed = results.find((r) => r.error)
  if (failed) {
    return { ok: false, error: failed.error!.message, data: {} }
  }

  const data: Record<string, unknown> = {}
  for (const r of results) {
    data[r.descriptor.exportKey] =
      r.descriptor.kind === 'singleton' ? (r.data ?? null) : (r.data ?? [])
  }
  return { ok: true, data }
}

export interface HealthDeleteResult {
  ok: boolean
  error?: string
  /** table -> rows remaining after the pass. Counts and status only; never values. */
  tableCounts: Record<string, number>
}

/**
 * Delete every gated resource for one user.
 *
 * ORDER IS LOAD-BEARING: the legacy `user_profile` columns are cleared FIRST, and
 * only then are the gated tables deleted.
 *
 * Doing it the other way round does not work, and fails in a way that is easy to
 * miss. During the expand phase, `kilo.mirror_profile_to_health` fires on any
 * user_profile write that changes a health value — and nulling the six legacy
 * columns is exactly such a change. That mirror UPSERTS `user_health_profile`. So
 * clearing the columns after deleting the tables RESURRECTS the canonical health
 * row that was just deleted (all-null, but present). The row count then never
 * reaches zero, which means:
 *
 *   - kilo.complete_health_deletion_job() refuses the deletion_pending -> withdrawn
 *     transition forever, and the user's withdrawal is wedged permanently; and
 *   - account-delete's own zero-row check fails, so deleting an account returns 500
 *     on every retry.
 *
 * Clearing first means the mirror's write happens while the canonical row is still
 * scheduled for deletion, and the delete (deleteOrder 7, last) removes it for good.
 *
 * Idempotent by construction: every statement is an unconditional, user-scoped
 * delete or update, so re-running after a partial failure converges on the same
 * empty state. This function reports what remains; it does not decide that the
 * purge is complete — kilo.complete_health_deletion_job() re-counts server-side and
 * makes that call itself.
 *
 * Deletions run sequentially in deleteOrder rather than in parallel: a partial
 * failure then leaves a prefix deleted and a suffix intact, which retries cleanly,
 * instead of an arbitrary interleaving that is harder to reason about in an incident.
 */
export async function deleteHealthData(
  admin: SupabaseClient,
  userId: string,
): Promise<HealthDeleteResult> {
  const legacy = await clearLegacyHealthColumns(admin, userId)
  if (!legacy.ok) {
    return { ok: false, error: legacy.error, tableCounts: {} }
  }

  const ordered = [...HEALTH_DATA_SCOPE].sort((a, b) => a.deleteOrder - b.deleteOrder)

  for (const d of ordered) {
    const { error } = await admin.from(d.table).delete().eq('user_id', userId)
    if (error) {
      return { ok: false, error: `${d.table}: ${error.message}`, tableCounts: {} }
    }
  }

  return await countHealthData(admin, userId)
}

/**
 * Null out the six legacy health columns on `kilo.user_profile`, keeping the row
 * (and its non-health settings) intact.
 *
 * After the contract step the columns no longer exist. PostgREST answers an
 * unknown column with PGRST204; that is the expected post-contract state, not a
 * failure, so it is treated as a no-op.
 */
export async function clearLegacyHealthColumns(
  admin: SupabaseClient,
  userId: string,
): Promise<{ ok: boolean; error?: string; cleared: boolean }> {
  const patch: Record<string, null> = {}
  for (const col of LEGACY_HEALTH_COLUMNS) patch[col] = null

  const { error } = await admin.from('user_profile').update(patch).eq('user_id', userId)
  if (!error) return { ok: true, cleared: true }

  // PGRST204: column not found — the contract migration has already dropped them.
  if (error.code === 'PGRST204' || /column .* does not exist/i.test(error.message)) {
    return { ok: true, cleared: false }
  }
  return { ok: false, error: `user_profile legacy columns: ${error.message}`, cleared: false }
}

/** Rows remaining per gated table for one user. Zero across the board == purged. */
export async function countHealthData(
  admin: SupabaseClient,
  userId: string,
): Promise<HealthDeleteResult> {
  const results = await Promise.all(
    HEALTH_DATA_SCOPE.map(async (d) => {
      const { count, error } = await admin
        .from(d.table)
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', userId)
      return { table: d.table, count: count ?? 0, error }
    }),
  )

  const failed = results.find((r) => r.error)
  if (failed) {
    return { ok: false, error: failed.error!.message, tableCounts: {} }
  }

  const tableCounts: Record<string, number> = {}
  for (const r of results) tableCounts[r.table] = r.count
  return { ok: true, tableCounts }
}
