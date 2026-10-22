// CORS is a browser-only enforcement mechanism; native app requests (fetch with
// an explicit Authorization header, no ambient credentials) are never subject
// to it. The one legitimate browser caller is the production web app (#1552):
// its sign-out (restore revoke), account export, account deletion, and
// health-data deletion kick all run these functions from the browser.
//
// CORS controls which pages may READ a response; it is not authorization. A
// hostile or native client can omit or forge Origin, so every function still
// authenticates the bearer itself and that remains the trust boundary.
//
// Matching is exact string equality. Pages preview deployments
// (<hash>.kilo-app.pages.dev), localhost, custom domains, lookalikes, and
// `Origin: null` stay unallowlisted. Do not add wildcards, suffix matching, or
// Origin reflection; another origin needs an explicit contract amendment.
export const PRODUCTION_WEB_ORIGIN = 'https://kilo-app.pages.dev'

const ALLOWED_ORIGINS: readonly string[] = [PRODUCTION_WEB_ORIGIN]

// Headers that don't depend on the origin (safe to return unconditionally).
// Vary is unconditional because the response differs by Origin either way; a
// shared cache must not serve an allowed-origin response to another origin.
// Access-Control-Allow-Credentials is deliberately absent: callers send an
// explicit bearer, never ambient cookies.
const BASE_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

export function isAllowedOrigin(origin: string | null): boolean {
  return origin !== null && ALLOWED_ORIGINS.includes(origin)
}

// Computes response headers for a given request. Only echoes
// Access-Control-Allow-Origin back when the request's Origin is in the
// allowlist; otherwise no origin is advertised, so browsers cannot read
// cross-origin responses. Native callers are unaffected either way. Callers
// spread this into every response, success and error alike, so an allowed
// page can read the error a request produced.
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  if (isAllowedOrigin(origin)) {
    return { ...BASE_HEADERS, 'Access-Control-Allow-Origin': origin as string }
  }
  return { ...BASE_HEADERS }
}
