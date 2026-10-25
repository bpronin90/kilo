// The only privileged capability in the MCP function: the durable rate limiter.
//
// kilo.rate_limit_check is granted to service_role only, so the limiter needs a
// service-role client. That client is created here, held in this closure, and
// never exported, passed to the MCP handler, or used for any table read. The
// rest of the function sees only `allow(bucket, max, windowMs)`, which fails
// closed: a limiter outage is treated like an exhausted bucket.

import { createClient } from '@supabase/supabase-js'
import { rateLimitAllowed } from '../_shared/rate-limit.ts'

export interface Limiter {
  allow(bucket: string, max: number, windowMs: number): Promise<boolean>
}

type RateLimitClient = Parameters<typeof rateLimitAllowed>[0]

export function limiterFromClient(admin: RateLimitClient): Limiter {
  return {
    allow: (bucket, max, windowMs) => rateLimitAllowed(admin, bucket, max, windowMs, 'deny'),
  }
}

export function createLimiter(env: (name: string) => string | undefined): Limiter {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    // Missing credentials: deny everything rather than run unthrottled.
    return { allow: () => Promise.resolve(false) }
  }
  const admin = createClient(url, key, {
    db: { schema: 'kilo' },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return limiterFromClient(admin as unknown as RateLimitClient)
}
