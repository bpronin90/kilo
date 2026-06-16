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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

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
