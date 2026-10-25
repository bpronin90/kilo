// Kilo's claim checks that run after @supabase/server has verified the token's
// signature, expiry and audience (architecture section 5, step 3).
//
// The library proves the token is a genuine Supabase JWT for this project. It
// does not know that this endpoint serves OAuth *clients* only, so Kilo checks
// issuer, role, identifiers and the `client_id` claim itself. A first-party
// Kilo session carries no `client_id` and is refused: the app has other
// endpoints and must not reach health history through this one.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface McpIdentity {
  userId: string
  sessionId: string
  clientId: string
}

export type ClaimResult = { ok: true; identity: McpIdentity } | { ok: false }

export function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

// The issuer Supabase Auth stamps into access tokens. `MCP_AUTH_ISSUER` pins it
// explicitly (custom domains). Otherwise it follows the same public-origin rule
// the OAuth discovery middleware uses, so the metadata and the check agree.
export function expectedIssuer(req: Request, env: (name: string) => string | undefined): string | null {
  const pinned = env('MCP_AUTH_ISSUER')
  if (pinned) return trimSlash(pinned)
  const publicUrl = env('SUPABASE_PUBLIC_URL')
  if (publicUrl) return `${trimSlash(publicUrl)}/auth/v1`
  const url = new URL(req.url)
  const host = req.headers.get('x-forwarded-host') ?? url.host
  const proto = (req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')).toLowerCase()
  if (!host) return null
  return `${proto}://${host}/auth/v1`
}

export function checkClaims(claims: Record<string, unknown> | null | undefined, issuer: string | null): ClaimResult {
  if (!claims || !issuer) return { ok: false }
  if (typeof claims.iss !== 'string' || trimSlash(claims.iss) !== issuer) return { ok: false }
  if (claims.role !== 'authenticated') return { ok: false }
  const { sub, session_id: sessionId, client_id: clientId } = claims
  if (typeof sub !== 'string' || !UUID.test(sub)) return { ok: false }
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return { ok: false }
  if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 256) return { ok: false }
  return { ok: true, identity: { userId: sub, sessionId, clientId } }
}
