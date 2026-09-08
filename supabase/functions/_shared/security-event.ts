// Shared security-event recorder for the Kilo Edge Functions (issue #975).
//
// Background:
//   Every security-relevant decision these functions make -- a rejected token, a
//   throttled caller, a fail-closed limiter, a failed account deletion -- used to
//   exist only as a `console.error` line in the Supabase Edge Function log. That
//   log is retained for days, is not queryable as events, and has no threshold, so
//   nothing ever alerted and an incident found a week later had no evidence left.
//
//   This module writes those decisions to kilo.security_events instead (migration
//   20260908120000_security_event_log.sql), where they are durable for 90 days,
//   aggregatable, and monitored by scripts/check-security-events.mjs.
//
// Three rules govern every call site:
//
//   1. RECORDING NEVER CHANGES THE RESPONSE. Every function here is best-effort
//      and never throws. A security log that can fail a user's export is worse
//      than one that misses a row.
//   2. THE RAW SUBJECT NEVER LEAVES THIS PROCESS. A user id or IP is passed to
//      the database, which salts and digests it; only the digest is stored, and
//      the console mirror below never carries it at all.
//   3. CONTEXT IS BOUNDED SCALARS ONLY. No message, header, URL, body, or free
//      text. The database re-sanitizes against the same allow-list, so this
//      module is defense in depth, not the boundary.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'

type SecurityEventClient = SupabaseClient<any, any, any, any, any>

// The catalog. Must stay identical to the CHECK constraint on
// kilo.security_events.event_name; the database raises on anything else, which
// is deliberate -- an event the catalog does not know is one nothing alerts on.
export const SECURITY_EVENT_NAMES = [
  'auth.token_missing',
  'auth.token_rejected',
  'authz.denied',
  'ratelimit.ip_blocked',
  'ratelimit.user_blocked',
  'ratelimit.unavailable',
  'account.export_succeeded',
  'account.delete_succeeded',
  'account.delete_failed',
  'health.purge_succeeded',
  'health.purge_failed',
  'server.error',
] as const

export const SECURITY_EVENT_SOURCES = [
  'account-export',
  'account-delete',
  'health-data-delete',
] as const

export const SECURITY_EVENT_OUTCOMES = ['allowed', 'denied', 'succeeded', 'failed'] as const

export const SECURITY_EVENT_REASONS = [
  'missing_token',
  'invalid_token',
  'ip_throttle',
  'user_throttle',
  'limiter_unavailable',
  'evidence_key_missing',
  'db_error',
  'incomplete',
  'subject_mismatch',
  'unknown',
] as const

export type SecurityEventName = typeof SECURITY_EVENT_NAMES[number]
export type SecurityEventSource = typeof SECURITY_EVENT_SOURCES[number]
export type SecurityEventOutcome = typeof SECURITY_EVENT_OUTCOMES[number]
export type SecurityEventReason = typeof SECURITY_EVENT_REASONS[number]

export interface SecurityEventContext {
  status?: number
  reason?: SecurityEventReason
  code?: string
  request_id?: string
  count?: number
}

export interface SecurityEvent {
  name: SecurityEventName
  source: SecurityEventSource
  outcome: SecurityEventOutcome
  // 'user' and 'ip' require a subject; 'none' forbids one (cron-driven work has
  // no requester). The database enforces the same pairing with a CHECK.
  subjectType: 'user' | 'ip' | 'none'
  subject?: string | null
  context?: SecurityEventContext
}

// Mirrors kilo.sanitize_security_event_context exactly. Allow-list, not
// denylist: a key invented by a future call site is dropped here and dropped
// again by the database, rather than travelling to the log by default.
export function sanitizeSecurityContext(context?: SecurityEventContext): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!context || typeof context !== 'object') return out

  const status = context.status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    out.status = status
  }

  if (typeof context.reason === 'string' && (SECURITY_EVENT_REASONS as readonly string[]).includes(context.reason)) {
    out.reason = context.reason
  }

  // Bounded upstream error CODE, never a message. The pattern rejects
  // whitespace and '@', so a message pasted into this field is dropped rather
  // than truncated into the log.
  if (typeof context.code === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(context.code)) {
    out.code = context.code
  }

  if (typeof context.request_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(context.request_id)) {
    out.request_id = context.request_id
  }

  const count = context.count
  if (typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 1000000) {
    out.count = count
  }

  return out
}

// Correlation handle between a row in kilo.security_events and the platform
// Edge Function log line for the same request. Both header names are set by the
// Supabase edge layer, not by the caller's application code; the pattern check
// means a forged value is dropped rather than stored, and a dropped one only
// costs correlation.
export function requestId(req: Request): string | undefined {
  for (const header of ['x-request-id', 'sb-request-id', 'cf-ray']) {
    const value = req.headers.get(header)
    if (value && /^[A-Za-z0-9_-]{1,64}$/.test(value)) return value
  }
  return undefined
}

// Best-effort write. Never throws, never rejects, and is deliberately awaited at
// call sites so the row is durable before the response is returned: an Edge
// Function isolate can be frozen the moment it responds, and a floating promise
// would lose exactly the events that matter most (the ones on a rejected
// request, where nothing else runs afterwards).
export async function recordSecurityEvent(
  admin: SecurityEventClient,
  event: SecurityEvent,
): Promise<void> {
  const context = sanitizeSecurityContext(event.context)

  // Console mirror, for the platform log an operator greps during a live
  // incident before the aggregate monitor's next window closes. Carries the
  // classification and the sanitized context only -- never the subject, raw or
  // digested. Emitted before the insert so it survives a database outage, which
  // is precisely when 'ratelimit.unavailable' is being recorded.
  console.log(JSON.stringify({
    kilo_security_event: event.name,
    source: event.source,
    outcome: event.outcome,
    subject_type: event.subjectType,
    ...context,
  }))

  try {
    const { error } = await admin.rpc('record_security_event', {
      p_event_name: event.name,
      p_source: event.source,
      p_outcome: event.outcome,
      p_subject_type: event.subjectType,
      p_subject: event.subjectType === 'none' ? null : (event.subject ?? null),
      p_context: context,
    })
    if (error) {
      // Bounded code only. An upstream error message may echo the RPC
      // arguments, and one of those arguments is the raw subject -- the single
      // value this module exists to keep out of a log. Same reasoning as
      // rate-limit.ts.
      console.error('record_security_event failed', {
        event: event.name,
        code: typeof error.code === 'string' ? error.code : 'unknown',
      })
    }
  } catch (_err) {
    // A thrown transport error must not propagate: the caller is mid-response
    // on a security decision that has already been made.
    console.error('record_security_event threw', { event: event.name })
  }
}
