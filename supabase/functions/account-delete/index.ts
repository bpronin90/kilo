// account-delete: server-owned account deletion for the signed-in requester.
//
// Security model:
//   - The caller supplies their JWT in Authorization: Bearer <token>.
//   - A user-scoped client verifies identity and deletes app rows under RLS
//     (only auth.uid() rows are visible, so only the requester's data is removed).
//   - A service-role admin client is used only for auth.admin.deleteUser(), which
//     requires elevated privileges. The service-role key is never returned to the
//     caller and never included in any response body.
//   - No cross-user deletion is possible: the user_id deleted is the one from the
//     verified JWT, and RLS blocks row-level access to any other owner.
//
// Deletion order: app rows are hard-deleted before the auth user so the FK
// cascade does not run silently. auth.admin.deleteUser removes the identity last.
//
// Rate limits (in-memory, per isolate):
//   - Per user: 3 delete attempts per hour.
//   - Per IP: 5 delete attempts per hour.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ---------------------------------------------------------------------------
// In-memory rate limiter (per-isolate sliding window)
// ---------------------------------------------------------------------------

const USER_WINDOW_MS = 60 * 60 * 1000   // 1 hour
const USER_MAX       = 3                 // 3 attempts per user per window
const IP_WINDOW_MS   = 60 * 60 * 1000   // 1 hour
const IP_MAX         = 5                 // 5 attempts per IP per window

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
  if (!allowed(`user:${user.id}`, USER_MAX, USER_WINDOW_MS)) {
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
    userClient.from('weight_goal').delete().eq('user_id', user.id),
    userClient.from('feature_toggles').delete().eq('user_id', user.id),
    userClient.from('user_profile').delete().eq('user_id', user.id),
  ])

  const dataError = deleteResults.find(r => r.error)?.error
  if (dataError) {
    return new Response(JSON.stringify({ error: `Failed to delete app data: ${dataError.message}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Service-role admin client: only used to delete the auth identity. The key
  // is injected by Supabase at runtime and never exposed to clients.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(user.id)
  if (deleteAuthError) {
    return new Response(JSON.stringify({ error: `Failed to delete auth user: ${deleteAuthError.message}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
