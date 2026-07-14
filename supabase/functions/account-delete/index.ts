// account-delete: server-owned account deletion for the signed-in requester.
//
// Security model:
//   - The caller supplies their JWT in Authorization: Bearer <token>.
//   - A user-scoped client verifies identity and deletes non-health app rows under
//     RLS (only auth.uid() rows are visible, so only the requester's data goes).
//   - Health rows are deleted through the shared health-data scope (issue #487),
//     which uses a service-role client with an explicit user_id filter. That is
//     required: once kilo.health_gate_ok() is armed, a user who never granted
//     health consent cannot touch their own gated rows under RLS — and deleting
//     an account must erase that data whether or not consent was ever given. The
//     right to erasure does not depend on the Art. 9 grant.
//   - A service-role client is also used for the privileged server operations:
//     auth.admin.deleteUser(), the durable rate-limit RPCs, and the consent
//     evidence archive. The service-role key is never returned to the caller.
//   - No cross-user deletion is possible: the user_id deleted is the one from the
//     verified JWT, and both RLS and the shared scope's user_id filter bind every
//     statement to that id.
//
// Order of operations, and why:
//   1. Build the pseudonymized consent-evidence archive BEFORE anything is
//      deleted. The account-linked consent ledger cascades away with auth.users,
//      so once the identity is gone the evidence cannot be reconstructed. Art. 7(1)
//      requires Kilo to still be able to demonstrate that consent was given.
//   2. Delete the gated health set (shared scope).
//   3. Delete the ordinary account rows.
//   4. Delete the auth identity last, so the FK cascade does not run silently.
//
// The archive is deliberately minimal: an HMAC of the user id under a versioned,
// server-held key, the catalog revision and copy digest, and the event types with
// their server timestamps. No health entries, notes, measurements, free text,
// device identifiers, or IP addresses — the record proves that a consent decision
// happened, not what the person's body was doing.
//
// Rate limits (durable, shared across isolates via kilo.rate_limit_check):
//   - Per user: 3 delete attempts per hour.
//   - Per IP: 5 delete attempts per hour.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'
import { clientIp, rateLimitAllowed } from '../_shared/rate-limit.ts'
import { deleteHealthData } from '../_shared/health-data-scope.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// The HMAC key that pseudonymizes the evidence archive. It lives OUTSIDE the
// database on purpose: a database dump must not be enough to re-identify the
// archive. It is versioned so it can be rotated without invalidating evidence —
// each archive row records the key version that produced its subject_hmac, and
// kilo.evidence_retention_sweep() only marks a version destroyable once no
// unexpired archive still references it.
const EVIDENCE_KEY_ID = Deno.env.get('KILO_EVIDENCE_KEY_ID') ?? ''
const EVIDENCE_KEY = Deno.env.get('KILO_EVIDENCE_KEY') ?? ''

// Six years, per Art. 17(3)(e) (establishment, exercise, or defence of legal
// claims) and the retention disclosed on the consent surface.
const EVIDENCE_RETENTION_YEARS = 6

const USER_WINDOW_MS = 60 * 60 * 1000   // 1 hour
const USER_MAX       = 3                 // 3 attempts per user per window
const IP_WINDOW_MS   = 60 * 60 * 1000   // 1 hour
const IP_MAX         = 5                 // 5 attempts per IP per window

const rlAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  // schema 'kilo' targets the rate-limit RPCs; the auth.admin API is unaffected.
  db: { schema: 'kilo' },
  auth: { autoRefreshToken: false, persistSession: false },
})

async function hmacSubject(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(EVIDENCE_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(userId))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Replace the account-linked consent ledger with a single evidence-only row.
// Returns false if the archive could not be written, which ABORTS the deletion:
// destroying the ledger without leaving the evidence behind would trade one
// compliance failure (no Art. 7(1) proof) for another, and the user can retry.
async function archiveConsentEvidence(userId: string): Promise<boolean> {
  const { data: events, error: eventsError } = await rlAdmin
    .from('consent_events')
    .select('event_type, occurred_at, catalog_revision, material_version, copy_sha256')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: true })

  if (eventsError) {
    console.error(`account-delete consent event read failed: ${eventsError.message}`)
    return false
  }

  // A user who never reached the consent surface has no consent to demonstrate.
  // Writing an archive row for them would be inventing a record of a decision
  // they never made.
  if (!events || events.length === 0) return true

  if (!EVIDENCE_KEY_ID || !EVIDENCE_KEY) {
    // Fail closed. Without the key there is no pseudonymization, and the only
    // alternatives are storing the raw user id (which the spec forbids) or losing
    // the evidence entirely.
    console.error('account-delete: evidence key is not configured; refusing to delete')
    return false
  }

  const { data: state } = await rlAdmin
    .from('consent_state')
    .select('withdrawn_at, cloud_data_deleted_at')
    .eq('user_id', userId)
    .maybeSingle()

  const last = events[events.length - 1]
  const now = new Date()
  const expires = new Date(now)
  expires.setUTCFullYear(expires.getUTCFullYear() + EVIDENCE_RETENTION_YEARS)

  // Register the key version on first use so the retention worker can reason
  // about which versions are still referenced.
  const { error: keyError } = await rlAdmin
    .from('consent_evidence_key')
    .upsert({ evidence_key_id: EVIDENCE_KEY_ID }, { onConflict: 'evidence_key_id' })
  if (keyError) {
    console.error(`account-delete evidence key registration failed: ${keyError.message}`)
    return false
  }

  const { error: archiveError } = await rlAdmin.from('consent_evidence_archive').insert({
    subject_hmac: await hmacSubject(userId),
    evidence_key_id: EVIDENCE_KEY_ID,
    catalog_revision: last.catalog_revision,
    material_version: last.material_version,
    copy_sha256: last.copy_sha256,
    // Event types and server timestamps only.
    consent_events: events.map((e) => ({
      event_type: e.event_type,
      occurred_at: e.occurred_at,
      catalog_revision: e.catalog_revision,
      material_version: e.material_version,
    })),
    withdrawn_at: state?.withdrawn_at ?? null,
    cloud_data_deleted_at: state?.cloud_data_deleted_at ?? null,
    account_deleted_at: now.toISOString(),
    expires_at: expires.toISOString(),
  })

  if (archiveError) {
    console.error(`account-delete evidence archive failed: ${archiveError.message}`)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------

serve(async (req) => {
  const cors = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  // IP rate check (pre-auth, blocks hammering callers before JWT verification).
  const ip = clientIp(req)
  if (!await rateLimitAllowed(rlAdmin, `delete:ip:${ip}`, IP_MAX, IP_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '3600' },
    })
  }

  const token = extractToken(req)
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // User-scoped client: proves identity and deletes non-health app rows under RLS.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: 'kilo' },
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Per-user rate check (post-auth).
  if (!await rateLimitAllowed(rlAdmin, `delete:user:${user.id}`, USER_MAX, USER_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '3600' },
    })
  }

  // 1. Evidence first: the ledger cascades away with the identity, so this is the
  //    last moment it can be preserved.
  if (!await archiveConsentEvidence(user.id)) {
    return new Response(JSON.stringify({ error: 'Account deletion failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // 2. The gated health set, via the one shared definition. account-delete does
  //    not keep its own health-table list — that is exactly the divergence the
  //    shared scope exists to make impossible.
  const healthResult = await deleteHealthData(rlAdmin, user.id)
  if (!healthResult.ok) {
    console.error(`account-delete health deletion failed: ${healthResult.error}`)
    return new Response(JSON.stringify({ error: 'Account deletion failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const remaining = Object.values(healthResult.tableCounts).reduce((a, b) => a + b, 0)
  if (remaining > 0) {
    console.error(`account-delete health deletion incomplete: ${remaining} rows remain`)
    return new Response(JSON.stringify({ error: 'Account deletion failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // 3. Ordinary account rows. RLS scopes every delete to the requester.
  const deleteResults = await Promise.all([
    userClient.from('feature_toggles').delete().eq('user_id', user.id),
    userClient.from('user_profile').delete().eq('user_id', user.id),
  ])

  const dataError = deleteResults.find(r => r.error)?.error
  if (dataError) {
    console.error(`account-delete app data deletion failed: ${dataError.message}`)
    return new Response(JSON.stringify({ error: 'Account deletion failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // 4. Delete the auth identity via the shared service-role client. This cascades
  //    the account-linked consent ledger (consent_state, consent_events); the
  //    pseudonymized archive written in step 1 is not linked to auth.users and
  //    survives, which is the entire point of archiving it first.
  const { error: deleteAuthError } = await rlAdmin.auth.admin.deleteUser(user.id)
  if (deleteAuthError) {
    console.error(`account-delete auth deletion failed: ${deleteAuthError.message}`)
    return new Response(JSON.stringify({ error: 'Account deletion failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
