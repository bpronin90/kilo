// health-data-delete: erase the consent-gated cloud health data for one account.
//
// This is the worker behind GDPR Art. 7(3) + Art. 17. Withdrawing consent is not
// a sync pause: the cloud copy must actually be erased, without undue delay, while
// the user's on-device data and account survive untouched.
//
// It never decides WHETHER to delete. kilo.consent_withdraw() (client-initiated
// withdrawal) and kilo.enqueue_expired_quarantine_purges() (existing-user cutover)
// are the only things that create a job; this function drains the queue that they
// wrote. Access is already blocked by kilo.health_gate_ok() the moment the state
// flips to deletion_pending, so nothing new can be written behind the purge.
//
// Two callers, one code path:
//
//   worker mode  Authorization: Bearer <service-role key>. Drains up to
//                MAX_JOBS_PER_RUN open jobs.
//
//                This is what Supabase Cron invokes, every 5 minutes, via
//                kilo.drain_health_deletion_jobs() -> pg_net POST (see migration
//                20260714120002). The credentials come from Supabase Vault, not
//                from the migration source. Cron re-opens jobs whose backoff has
//                elapsed and reclaims jobs whose worker died, then calls this
//                function to actually run them — re-queueing without a consumer
//                would leave every withdrawal pending forever while looking
//                perfectly healthy.
//
//   user mode    Authorization: Bearer <user JWT>. Drains only THAT user's own
//                job, so a withdrawal is purged immediately rather than waiting
//                for the next cron tick. A user can never reach another user's
//                job: the job is looked up by the id from their verified JWT.
//                This is a latency optimization on top of cron, never a
//                replacement for it: if the client's kick fails or the app is
//                killed mid-request, cron still finishes the erasure.
//
// Idempotent by construction. Every delete is an unconditional, user-scoped
// statement (see _shared/health-data-scope.ts), so a crashed or partially applied
// run converges on the same empty state when retried. The
// deletion_pending -> withdrawn transition happens in
// kilo.complete_health_deletion_job(), which re-counts the gated tables and
// refuses to advance while any scoped row remains.
//
// Deletion scope is NOT defined here. It comes from the shared health-data-scope
// module that account-export and account-delete also import, so the three can not
// drift apart.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'
import { clientIp, rateLimitAllowed } from '../_shared/rate-limit.ts'
import { deleteHealthData } from '../_shared/health-data-scope.ts'
import { recordSecurityEvent, requestId } from '../_shared/security-event.ts'

const SECURITY_SOURCE = 'health-data-delete' as const

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Bounded so one invocation cannot run past the Edge Function wall clock and get
// killed mid-purge. Whatever is left stays queued; cron picks it up.
const MAX_JOBS_PER_RUN = 20

const USER_WINDOW_MS = 60 * 60 * 1000  // 1 hour
const USER_MAX       = 5                // 5 purge kicks per user per window
const IP_WINDOW_MS   = 60 * 60 * 1000
const IP_MAX         = 20

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'kilo' },
  auth: { autoRefreshToken: false, persistSession: false },
})

interface DeletionJob {
  id: string
  user_id: string
  reason: string
  attempts: number
}

// Delete one job's scoped data and settle the job. A failure is recorded on the
// job (bounded, message-only) and left for the cron retry rather than thrown: one
// user's wedged purge must not stop the queue from draining for everyone else.
async function processJob(
  job: DeletionJob,
  rid: string | undefined,
): Promise<{ ok: boolean; remaining?: number }> {
  const result = await deleteHealthData(admin, job.user_id)

  if (!result.ok) {
    await admin.rpc('fail_health_deletion_job', {
      p_job_id: job.id,
      p_error: result.error ?? 'unknown',
    })
    await recordPurgeOutcome(job, false, rid, 'db_error')
    return { ok: false }
  }

  // The database re-counts the gated set itself and refuses to advance the state
  // while anything remains. We do not get to assert that we finished.
  const { data, error } = await admin.rpc('complete_health_deletion_job', { p_job_id: job.id })
  if (error) {
    await admin.rpc('fail_health_deletion_job', { p_job_id: job.id, p_error: error.message })
    await recordPurgeOutcome(job, false, rid, 'db_error')
    return { ok: false }
  }

  const settled = data as { ok: boolean; remaining: number }
  const ok = settled?.ok === true
  // `remaining > 0` with no error is the case the database refuses to advance:
  // rows the user was told would be erased are still there.
  await recordPurgeOutcome(job, ok, rid, ok ? undefined : 'incomplete', settled?.remaining)
  return { ok, remaining: settled?.remaining }
}

// One event per job, both directions. Success is the erasure audit trail a
// regulator-facing deletion needs; failure is what the monitor thresholds on.
// The job id is deliberately not carried: it is a direct handle to one user's
// deletion request, and the salted user digest already provides correlation.
async function recordPurgeOutcome(
  job: DeletionJob,
  ok: boolean,
  rid: string | undefined,
  reason?: 'db_error' | 'incomplete',
  remaining?: number,
): Promise<void> {
  await recordSecurityEvent(admin, {
    name: ok ? 'health.purge_succeeded' : 'health.purge_failed',
    source: SECURITY_SOURCE,
    outcome: ok ? 'succeeded' : 'failed',
    subjectType: 'user',
    subject: job.user_id,
    context: {
      reason,
      count: typeof remaining === 'number' ? remaining : undefined,
      request_id: rid,
    },
  })
}

serve(async (req) => {
  const cors = corsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  // Correlates every event below with the platform log line for this request.
  const rid = requestId(req)

  const token = extractToken(req)
  if (!token) {
    await recordSecurityEvent(admin, {
      name: 'auth.token_missing',
      source: SECURITY_SOURCE,
      outcome: 'denied',
      subjectType: 'ip',
      subject: clientIp(req),
      context: { status: 401, reason: 'missing_token', request_id: rid },
    })
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── worker mode ───────────────────────────────────────────────────────────
  // A constant-time compare is unnecessary here: the service-role key is not
  // guessable, and a mismatch simply falls through to the user path, where the
  // token is verified as a JWT and fails there instead.
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    const processed: Array<{ job_id: string; ok: boolean; remaining?: number }> = []

    for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
      const { data, error } = await admin.rpc('claim_health_deletion_job')
      if (error) {
        console.error(`health-data-delete claim failed: ${error.message}`)
        // Worker mode: the caller is cron, not a person, so there is no subject.
        await recordSecurityEvent(admin, {
          name: 'server.error',
          source: SECURITY_SOURCE,
          outcome: 'failed',
          subjectType: 'none',
          context: { status: 500, reason: 'db_error', code: error.code, request_id: rid },
        })
        return new Response(JSON.stringify({ error: 'Claim failed.' }), {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      const job = data as DeletionJob | null
      if (!job || !job.id) break

      const outcome = await processJob(job, rid)
      processed.push({ job_id: job.id, ok: outcome.ok, remaining: outcome.remaining })
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ── user mode ─────────────────────────────────────────────────────────────

  const ip = clientIp(req)
  if (!await rateLimitAllowed(admin, `healthdelete:ip:${ip}`, IP_MAX, IP_WINDOW_MS, 'deny', SECURITY_SOURCE)) {
    await recordSecurityEvent(admin, {
      name: 'ratelimit.ip_blocked',
      source: SECURITY_SOURCE,
      outcome: 'denied',
      subjectType: 'ip',
      subject: ip,
      context: { status: 429, reason: 'ip_throttle', request_id: rid },
    })
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '3600' },
    })
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: 'kilo' },
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) {
    // A token that is neither the service-role key nor a valid JWT lands here:
    // worker mode falls through to the user path by design, so this event also
    // covers a failed attempt to impersonate the drain worker.
    await recordSecurityEvent(admin, {
      name: 'auth.token_rejected',
      source: SECURITY_SOURCE,
      outcome: 'denied',
      subjectType: 'ip',
      subject: ip,
      context: { status: 401, reason: 'invalid_token', request_id: rid },
    })
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (!await rateLimitAllowed(admin, `healthdelete:user:${user.id}`, USER_MAX, USER_WINDOW_MS, 'deny', SECURITY_SOURCE)) {
    await recordSecurityEvent(admin, {
      name: 'ratelimit.user_blocked',
      source: SECURITY_SOURCE,
      outcome: 'denied',
      subjectType: 'user',
      subject: user.id,
      context: { status: 429, reason: 'user_throttle', request_id: rid },
    })
    return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
      status: 429,
      headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '3600' },
    })
  }

  // The user does not get to name a job. We look up the open job belonging to the
  // id on their verified JWT, so there is no id they could pass that would let
  // them touch anyone else's data.
  const { data: jobs, error: jobError } = await admin
    .from('health_data_deletion_jobs')
    .select('id, user_id, reason, attempts')
    .eq('user_id', user.id)
    .in('status', ['pending', 'running', 'failed'])
    .order('created_at', { ascending: true })
    .limit(1)

  if (jobError) {
    console.error(`health-data-delete job lookup failed: ${jobError.message}`)
    await recordSecurityEvent(admin, {
      name: 'server.error',
      source: SECURITY_SOURCE,
      outcome: 'failed',
      subjectType: 'user',
      subject: user.id,
      context: { status: 500, reason: 'db_error', code: jobError.code, request_id: rid },
    })
    return new Response(JSON.stringify({ error: 'Deletion failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const job = (jobs ?? [])[0] as DeletionJob | undefined
  if (!job) {
    // Nothing queued. Withdrawal creates the job before this is ever called, so
    // this means the purge already completed — report it as done rather than as
    // an error, which keeps the client's retry path idempotent too.
    return new Response(JSON.stringify({ ok: true, status: 'no_pending_deletion' }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Defense in depth, and the producer of the one event this catalog treats as
  // critical. The lookup above is already filtered to the verified caller's id
  // through a service-role client, so a mismatch is unreachable by construction
  // -- which is exactly why it is worth asserting: if it ever fires, the filter
  // or the client scoping has regressed and one account is about to erase
  // another's health data. Fail closed rather than proceed.
  if (job.user_id !== user.id) {
    await recordSecurityEvent(admin, {
      name: 'authz.denied',
      source: SECURITY_SOURCE,
      outcome: 'denied',
      subjectType: 'user',
      subject: user.id,
      context: { status: 500, reason: 'subject_mismatch', request_id: rid },
    })
    return new Response(JSON.stringify({ error: 'Deletion failed.' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const outcome = await processJob(job, rid)

  if (!outcome.ok) {
    // The job stays queued and cron retries it. The user is told the purge is
    // still in flight, never that their data is gone when it is not.
    return new Response(
      JSON.stringify({ ok: false, status: 'deletion_pending', retrying: true }),
      { status: 202, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  return new Response(JSON.stringify({ ok: true, status: 'withdrawn' }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
