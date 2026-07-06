// account-delete: server-owned account deletion for the signed-in requester.
//
// Security model:
//   - The caller supplies their JWT in Authorization: Bearer <token>.
//   - A user-scoped client verifies identity and deletes app rows under RLS
//     (only auth.uid() rows are visible, so only the requester's data is removed).
//   - A service-role client is used only for privileged server operations:
//     auth.admin.deleteUser() and the durable rate-limit RPCs. The service-role
//     key is never returned to the caller and never included in a response body.
//   - No cross-user deletion is possible: the user_id deleted is the one from the
//     verified JWT, and RLS blocks row-level access to any other owner.
//
// Deletion order: app rows are hard-deleted before the auth user so the FK
// cascade does not run silently. auth.admin.deleteUser removes the identity last.
//
// Rate limits (durable, shared across isolates via kilo.rate_limit_check):
//   - Per user: 3 delete attempts per hour.
//   - Per IP: 5 delete attempts per hour.
// State lives in Postgres so the limits hold across isolate recycling and cold
// starts; see supabase/functions/_shared/rate-limit.ts and migration
// 20260622120001_edge_rate_limit.sql.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'
import { clientIp, rateLimitAllowed } from '../_shared/rate-limit.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ---------------------------------------------------------------------------
// Rate limit windows. Enforcement is durable/shared (see rate-limit.ts):
// state is kept in Postgres, not an in-memory Map, so it survives isolate
// recycling and cold starts.
// ---------------------------------------------------------------------------

const USER_WINDOW_MS = 60 * 60 * 1000   // 1 hour
const USER_MAX       = 3                 // 3 attempts per user per window
const IP_WINDOW_MS   = 60 * 60 * 1000   // 1 hour
const IP_MAX         = 5                 // 5 attempts per IP per window

// Service-role client used for the durable rate-limit RPCs (and, later, the
// auth-user deletion). The throttle table and its functions are granted to
// service_role only; this key is never returned to callers.
const rlAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  // schema 'kilo' targets the rate-limit RPCs; the auth.admin API is unaffected.
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
  if (!await rateLimitAllowed(rlAdmin, `delete:ip:${ip}`, IP_MAX, IP_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' },
    })
  }

  const token = extractToken(req)
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // User-scoped client: proves identity and deletes app rows under RLS.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: 'kilo' },
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Per-user rate check (post-auth).
  if (!await rateLimitAllowed(rlAdmin, `delete:user:${user.id}`, USER_MAX, USER_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '3600' },
    })
  }

  // Delete app rows. Order matters for referential clarity; RLS scopes every
  // delete to the requester so no other user's data is touched.
  const deleteResults = await Promise.all([
    userClient.from('fatigue_checkins').delete().neq('id', ''),
    userClient.from('deload_history').delete().neq('id', ''),
    userClient.from('workout_notes').delete().neq('id', ''),
    userClient.from('weight_entries').delete().neq('id', ''),
    userClient.from('archived_weight_goals').delete().neq('id', ''),
    userClient.from('weight_goal').delete().eq('user_id', user.id),
    userClient.from('feature_toggles').delete().eq('user_id', user.id),
    userClient.from('user_profile').delete().eq('user_id', user.id),
  ])

  const dataError = deleteResults.find(r => r.error)?.error
  if (dataError) {
    console.error(`account-delete app data deletion failed: ${dataError.message}`)
    return new Response(JSON.stringify({ error: 'Account deletion failed.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Delete the auth identity via the shared service-role client (rlAdmin). The
  // service-role key is injected by Supabase at runtime and never exposed to
  // clients.
  const { error: deleteAuthError } = await rlAdmin.auth.admin.deleteUser(user.id)
  if (deleteAuthError) {
    console.error(`account-delete auth deletion failed: ${deleteAuthError.message}`)
    return new Response(JSON.stringify({ error: 'Account deletion failed.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
