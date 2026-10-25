// Detects a bearer token issued to an OAuth client (it carries `client_id`).
//
// OAuth access tokens are ordinary `authenticated` JWTs, so account export,
// account deletion, health-data deletion and Android restore credentials would
// otherwise accept a connected MCP client's token. Those functions import this
// check and refuse such tokens with 403 before doing any other work.
//
// The payload is decoded WITHOUT verifying the signature, on purpose: this only
// ever *narrows* access. A forged token claiming a `client_id` is refused here;
// a forged token without one still fails the function's own verification. A
// token that cannot be decoded at all is not treated as an OAuth token, because
// the function's normal verification rejects it anyway.

export function hasOAuthClientClaim(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0)),
    )
    const payload = JSON.parse(json)
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload) && 'client_id' in payload
  } catch {
    return false
  }
}

export function forbiddenForClients(cors: HeadersInit): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
