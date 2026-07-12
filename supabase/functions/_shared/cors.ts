// CORS is a browser-only enforcement mechanism; native app requests (fetch with
// an explicit Authorization header, no ambient credentials) are never subject
// to it. These functions currently have no legitimate browser caller, so this
// module defaults closed: no Access-Control-Allow-Origin is returned unless
// the requesting Origin is explicitly allowlisted below. Add an origin here
// only when a real web caller needs it.
const ALLOWED_ORIGINS: readonly string[] = []

// Headers that don't depend on the origin (safe to return unconditionally).
const BASE_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Computes response headers for a given request. Only echoes
// Access-Control-Allow-Origin back when the request's Origin is in the
// allowlist; otherwise no origin is advertised, so browsers cannot read
// cross-origin responses. Native callers are unaffected either way.
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return {
      ...BASE_HEADERS,
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    }
  }
  return { ...BASE_HEADERS }
}
