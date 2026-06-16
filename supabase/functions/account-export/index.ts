// account-export: server-owned full data export for the signed-in requester.
//
// Security model:
//   - The caller supplies their JWT in Authorization: Bearer <token>.
//   - A user-scoped Supabase client is constructed from that JWT; all queries run
//     under the authenticated role so RLS limits every result to auth.uid() rows.
//   - The service-role key is never used here: RLS alone is sufficient for export.
//   - No cross-user access is possible because auth.uid() is derived from the JWT
//     passed by the caller, not from any server-side parameter.
//
// Output shape is v3-compatible where local fields overlap (cloud.workout_notes,
// cloud.weight_entries, cloud.deload_history match v3 collection shapes).
//
// The kilo schema must be listed in the PostgREST exposed schemas for .from()
// calls to reach it (API Settings → Extra Search Path, or config.toml [api] schemas).
//
// Rate limits (in-memory, per isolate):
//   - Per user: 1 export per 10 minutes.
//   - Per IP: 5 exports per 10 minutes.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

// ---------------------------------------------------------------------------
// In-memory rate limiter (per-isolate sliding window)
// ---------------------------------------------------------------------------

const USER_WINDOW_MS = 10 * 60 * 1000   // 10 minutes
const USER_MAX       = 1                 // 1 export per user per window
const IP_WINDOW_MS   = 10 * 60 * 1000   // 10 minutes
const IP_MAX         = 5                 // 5 exports per IP per window

const buckets = new Map<string, { count: number; resetAt: number }>()

function allowed(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= max) return false
  b.count++
  return true
}

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
         req.headers.get('x-real-ip') ??
         'unknown'
}

// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // IP rate check (pre-auth, blocks hammering callers before JWT verification).
  const ip = clientIp(req)
  if (!allowed(`ip:${ip}`, IP_MAX, IP_WINDOW_MS)) {
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

  // Per-user rate check (post-auth).
  if (!allowed(`user:${user.id}`, USER_MAX, USER_WINDOW_MS)) {
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
