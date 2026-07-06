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

type RateLimitClient = SupabaseClient<any, any, any, any, any>

// Fail-open policy: if the durable check itself errors (e.g. the throttle table
// is briefly unreachable), admit the request rather than lock legitimate users
// out of export/delete. This re-opens the bypass only during an infra outage,
// which is acceptable for LOW-severity abuse throttling. The error is logged so
// a sustained outage is visible.
export async function rateLimitAllowed(
  admin: RateLimitClient,
  bucket: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc('rate_limit_check', {
    p_bucket: bucket,
    p_max: max,
    p_window_ms: windowMs,
  })
  if (error) {
    console.error(`rate_limit_check failed for ${bucket}: ${error.message}`)
    return true // fail open (see note above)
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
    console.error(`rate_limit_refund failed for ${bucket}: ${error.message}`)
  }
}

// Derive a best-effort client IP from forwarding headers. IP buckets are weaker
// than user buckets (callers can rotate IPs) but still raise the cost of
// pre-auth hammering.
export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
         req.headers.get('x-real-ip') ??
         'unknown'
}
