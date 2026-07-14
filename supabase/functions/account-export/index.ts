// account-export: server-owned full data export for the signed-in requester.
//
// Security model:
//   - The caller supplies their JWT in Authorization: Bearer <token>.
//   - A user-scoped Supabase client is constructed from that JWT; identity comes
//     from auth.uid() derived from that token, never from a server-side parameter,
//     so no cross-user access is possible.
//   - Non-health account rows (user_profile, feature_toggles) are read with that
//     user-scoped client, under RLS, exactly as before.
//   - Health rows are read through the shared health-data scope (issue #487),
//     which uses a service-role client with an explicit user_id filter. That is
//     required, not incidental: once kilo.health_gate_ok() is armed, a user who
//     has NOT granted health consent can no longer read their own gated rows
//     under RLS — and those are precisely the users the spec must still let
//     export ("export, then delete") during the 30-day quarantine window. Art. 15
//     does not depend on Art. 9 consent. The service role is used only to reach
//     past the consent gate; the user_id filter lives inside the shared module so
//     the scope stays exactly one account's data.
//   - The service-role key is never returned to the caller.
//
// Output shape is v3-compatible where local fields overlap (cloud.workout_notes,
// cloud.weight_entries, cloud.deload_history match v3 collection shapes).
//
// The kilo schema must be listed in the PostgREST exposed schemas for .from()
// calls to reach it (API Settings → Extra Search Path, or config.toml [api] schemas).
//
// Rate limits (durable, shared across isolates via kilo.rate_limit_check):
//   - Per user: 1 export per 10 minutes.
//   - Per IP: 5 exports per 10 minutes.
// State lives in Postgres so the limits hold across isolate recycling and cold
// starts; see supabase/functions/_shared/rate-limit.ts and migration
// 20260622120001_edge_rate_limit.sql.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'
import { clientIp, rateLimitAllowed, rateLimitRefund } from '../_shared/rate-limit.ts'
import { exportHealthData, LEGACY_HEALTH_COLUMNS } from '../_shared/health-data-scope.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ---------------------------------------------------------------------------
// Rate limit windows. Enforcement is durable/shared (see rate-limit.ts):
// state is kept in Postgres, not an in-memory Map, so it survives isolate
// recycling and cold starts.
// ---------------------------------------------------------------------------

const USER_WINDOW_MS = 10 * 60 * 1000   // 10 minutes
const USER_MAX       = 1                 // 1 export per user per window
const IP_WINDOW_MS   = 10 * 60 * 1000   // 10 minutes
const IP_MAX         = 5                 // 5 exports per IP per window

// Service-role client. Used for the durable rate-limit RPCs and, since #487, for
// the gate-bypassing health reads described in the header. It is never used to
// widen scope: every health statement is filtered to the verified caller's id.
const rlAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'kilo' },
  auth: { autoRefreshToken: false, persistSession: false },
})

// The six legacy health columns still live on the mixed user_profile row during
// the expand phase. They are NOT exported from there: user_health_profile already
// carries the same values, and emitting both would hand the user two copies of one
// health record and imply they are separate data. After the contract step these
// keys are simply absent.
function stripLegacyHealthColumns(profile: Record<string, unknown> | null) {
  if (!profile) return profile
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(profile)) {
    if (!LEGACY_HEALTH_COLUMNS.includes(k)) out[k] = v
  }
  return out
}

// ---------------------------------------------------------------------------

serve(async (req) => {
  const cors = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  // IP rate check (pre-auth, blocks hammering callers before JWT verification).
  const ip = clientIp(req)
  if (!await rateLimitAllowed(rlAdmin, `export:ip:${ip}`, IP_MAX, IP_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '600' },
    })
  }

  const token = extractToken(req)
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // User-scoped client: RLS restricts its queries to the requester's rows, and it
  // is what proves who the requester is.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: 'kilo' },
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Per-user rate check (post-auth). Quota is only spent on successful exports;
  // failed export attempts refund the bucket so transient errors don't exhaust
  // the user's one-success-per-window allowance.
  const userKey = `export:user:${user.id}`
  if (!await rateLimitAllowed(rlAdmin, userKey, USER_MAX, USER_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '600' },
    })
  }

  // Non-health account rows under RLS; the complete gated health set through the
  // one shared definition that account-delete and health-data-delete also use.
  const [profileResult, togglesResult, healthResult] = await Promise.all([
    client.from('user_profile').select('*').maybeSingle(),
    client.from('feature_toggles').select('*').maybeSingle(),
    exportHealthData(rlAdmin, user.id),
  ])

  const firstError =
    profileResult.error?.message ??
    togglesResult.error?.message ??
    (healthResult.ok ? undefined : healthResult.error)

  if (firstError) {
    // Refund the user bucket: a failed export should not spend the quota.
    await rateLimitRefund(rlAdmin, userKey)
    console.error(`account-export query failed: ${firstError}`)
    return new Response(JSON.stringify({ error: 'Export failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    cloud: {
      user_profile: stripLegacyHealthColumns(
        profileResult.data as Record<string, unknown> | null,
      ),
      feature_toggles: togglesResult.data,
      // user_health_profile, weight_entries, weight_goal, archived_weight_goals,
      // workout_notes, deload_history, fatigue_checkins.
      ...healthResult.data,
    },
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
