// Extract the Bearer token from an incoming Edge Function request.
// Returns null if the header is absent or malformed.
export function extractToken(req: Request): string | null {
  const auth = req.headers.get('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7).trim() || null
}
