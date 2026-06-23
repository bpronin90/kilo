// account-export: server-owned full data export for the signed-in requester.
//
// Security model:
//   - The caller supplies their JWT in Authorization: Bearer <token>.
//   - A user-scoped Supabase client is constructed from that JWT; all queries run
//     under the authenticated role so RLS limits every result to auth.uid() rows.
//   - The export query itself uses only the user-scoped (RLS) client; the
//     service-role key is used solely for the durable rate-limit RPCs and is
//     never used to read or return user data.
//   - No cross-user access is possible because auth.uid() is derived from the JWT
//     passed by the caller, not from any server-side parameter.
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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'
import { clientIp, rateLimitAllowed, rateLimitRefund } from '../_shared/rate-limit.ts'

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

// Service-role client used only for the durable rate-limit RPCs. The throttle
// table and its functions are granted to service_role only; this key is never
// returned to callers.
const rlAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'kilo' },
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // IP rate check (pre-auth, blocks hammering callers before JWT verification).
  const ip = clientIp(req)
  if (!await rateLimitAllowed(rlAdmin, `export:ip:${ip}`, IP_MAX, IP_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '600' },
    })
  }

  const token = extractToken(req)
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // User-scoped client: RLS restricts all queries to the requester's rows.
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: 'kilo' },
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Per-user rate check (post-auth). Quota is only spent on successful exports;
  // failed export attempts refund the bucket so transient errors don't exhaust
  // the user's one-success-per-window allowance.
  const userKey = `export:user:${user.id}`
  if (!await rateLimitAllowed(rlAdmin, userKey, USER_MAX, USER_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '600' },
    })
  }

  // Fetch all tables in parallel. RLS guarantees only the requester's rows.
  const [
    profileResult,
    togglesResult,
    weightEntriesResult,
    weightGoalResult,
    workoutNotesResult,
    deloadHistoryResult,
    fatigueCheckinsResult,
  ] = await Promise.all([
    client.from('user_profile').select('*').maybeSingle(),
    client.from('feature_toggles').select('*').maybeSingle(),
    client.from('weight_entries').select('*'),
    client.from('weight_goal').select('*').maybeSingle(),
    client.from('workout_notes').select('*'),
    client.from('deload_history').select('*'),
    client.from('fatigue_checkins').select('*'),
  ])

  const firstError = [
    profileResult,
    togglesResult,
    weightEntriesResult,
    weightGoalResult,
    workoutNotesResult,
    deloadHistoryResult,
    fatigueCheckinsResult,
  ].find(r => r.error)?.error

  if (firstError) {
    // Refund the user bucket: a failed export should not spend the quota.
    await rateLimitRefund(rlAdmin, userKey)
    return new Response(JSON.stringify({ error: firstError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    cloud: {
      user_profile: profileResult.data,
      feature_toggles: togglesResult.data,
      weight_entries: weightEntriesResult.data ?? [],
      weight_goal: weightGoalResult.data,
      workout_notes: workoutNotesResult.data ?? [],
      deload_history: deloadHistoryResult.data ?? [],
      fatigue_checkins: fatigueCheckinsResult.data ?? [],
    },
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
