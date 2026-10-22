// Outer exception boundary for Kilo Edge Function handlers (#1559).
//
// Every ordinary failure a handler anticipates (bad token, throttle, a resolved
// database error) is answered by the handler with its own constructed response.
// This module covers the rest: a dependency that REJECTS instead of resolving an
// error -- a transport failure inside supabase-js, a thrown RPC, a bug. Without
// a boundary the handler's promise rejects, the runtime answers with its own
// 5xx, and that response carries none of corsHeaders(req), so an allowlisted
// browser page cannot even read that the request failed.
//
// The boundary only shapes the failure; it never turns one into success. The
// wrapped handler has already stopped at the throw, so no protected work after
// that point runs, and the body claims nothing about work before it.
//
// What leaves the process is deliberately minimal:
//   - Response body: a fixed generic message. No stack, no upstream text.
//   - Log line: the source label and the error's constructor name only. An
//     error message may quote row data, a bearer token, or an email, so it is
//     never logged; the name ("TypeError", "FetchError") is enough to tell a
//     transport outage from a code defect.

import { corsHeaders } from './cors.ts'

export const UNEXPECTED_ERROR_BODY = { error: 'Internal Server Error' } as const

type Handler = (req: Request) => Promise<Response>

// A bounded, identifier-shaped class name, or 'unknown'. Custom error classes
// can set `name` to anything, so it is validated rather than trusted.
export function errorKind(err: unknown): string {
  const name = err instanceof Error ? err.name : undefined
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : 'unknown'
}

// The sanitized 500 for a request, carrying the shared per-request CORS policy
// unchanged. `extraHeaders` lets a function keep headers it puts on every
// response (e.g. Cache-Control: no-store on token-bearing routes).
export function unexpectedErrorResponse(
  req: Request,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(UNEXPECTED_ERROR_BODY), {
    status: 500,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', ...extraHeaders },
  })
}

// Wraps a handler so it always resolves to a Response.
export function withUnexpectedErrorResponse(
  source: string,
  handler: Handler,
  extraHeaders: Record<string, string> = {},
): Handler {
  return async (req) => {
    try {
      return await handler(req)
    } catch (err) {
      console.error(`${source} unexpected error`, { kind: errorKind(err) })
      return unexpectedErrorResponse(req, extraHeaders)
    }
  }
}
