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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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
