// Shared, durable rate limiter for the account export/delete Edge Functions.
//
// Background:
//   These functions previously throttled abuse with an in-memory Map per Deno
//   isolate. Supabase Edge Functions scale horizontally and recycle isolates,
//   so those counters were per-isolate and best-effort only: a caller could
//   spread requests across isolates or wait out a cold start to bypass them
//   (audit #347 Finding #4, LOW). Auth (JWT + RLS) is enforced independently,
//   so this is cost/abuse throttling, not an authz hole.
//
// This helper backs the limiter with shared Postgres state via the
// kilo.rate_limit_check / kilo.rate_limit_refund SECURITY DEFINER functions.
// State is durable across isolate recycling and cold starts, and the
// check-and-insert is atomic, closing the cross-isolate race the Map could not.
//
// The functions are granted to service_role only, so this helper must be given
// a service-role-keyed Supabase client. End users never touch the throttle
// table directly.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { recordSecurityEvent, type SecurityEventSource } from './security-event.ts'

type RateLimitClient = SupabaseClient<any, any, any, any, any>

export type RateLimitFailurePolicy = 'allow' | 'deny'

// The caller must choose an outage policy explicitly. Sensitive or destructive
// endpoints should pass `deny`: an unavailable durable limiter then returns the
// same rejection as an exhausted bucket. The policy is an argument rather than a
// hidden default so a future endpoint cannot accidentally inherit fail-open.
//
// Logs deliberately contain no bucket or database message. Buckets embed raw IP
// addresses or user UUIDs, and an upstream error may echo RPC arguments. The
// bounded PostgREST error code is sufficient for operational aggregation.
//
// `source` is optional only so the existing unit tests can call this without a
// database double for the security log; every production call site passes it.
// When present, a limiter outage also records `ratelimit.unavailable`, which is
// the one condition here an operator must hear about: the durable limiter is
// the abuse control, and while it is unreachable every endpoint is answering on
// its outage policy rather than on a real quota. The caller cannot detect this
// itself -- under `deny` an outage and an exhausted bucket both return false.
//
// The event carries no subject. The bucket embeds a raw IP or user id, and the
// outage is a server condition rather than a property of whoever happened to
// call during it.
export async function rateLimitAllowed(
  admin: RateLimitClient,
  bucket: string,
  max: number,
  windowMs: number,
  failurePolicy: RateLimitFailurePolicy,
  source?: SecurityEventSource,
): Promise<boolean> {
  const { data, error } = await admin.rpc('rate_limit_check', {
    p_bucket: bucket,
    p_max: max,
    p_window_ms: windowMs,
  })
  if (error) {
    console.error('rate_limit_check failed', {
      failurePolicy,
      code: typeof error.code === 'string' ? error.code : 'unknown',
    })
    if (source) {
      await recordSecurityEvent(admin, {
        name: 'ratelimit.unavailable',
        source,
        outcome: failurePolicy === 'allow' ? 'allowed' : 'denied',
        subjectType: 'none',
        context: {
          reason: 'limiter_unavailable',
          code: typeof error.code === 'string' ? error.code : undefined,
        },
      })
    }
    return failurePolicy === 'allow'
  }
  return data === true
}

// Refund the most recent hit for a bucket. Used when a post-auth operation fails
// and should not spend the caller's quota. Best-effort: a failed refund only
// means the caller keeps a spent slot until the window rolls, which is harmless.
export async function rateLimitRefund(
  admin: RateLimitClient,
  bucket: string,
): Promise<void> {
  const { error } = await admin.rpc('rate_limit_refund', { p_bucket: bucket })
  if (error) {
    console.error('rate_limit_refund failed', {
      code: typeof error.code === 'string' ? error.code : 'unknown',
    })
  }
}

// Derive a best-effort client IP from forwarding headers. IP buckets are weaker
// than user buckets (callers can rotate IPs) but still raise the cost of
// pre-auth hammering.
//
// Trusted-proxy assumption: Supabase Edge Functions receive requests through a
// platform-controlled proxy layer that appends to X-Forwarded-For. Taking the
// rightmost entry gives the IP the nearest trusted hop observed — that value
// cannot be forged by the caller (only prepended, not overwritten). The
// leftmost entry is caller-supplied and must not be used.
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',')
    return parts[parts.length - 1].trim()
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}
