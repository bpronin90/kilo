// mcp: authenticated, read-only MCP endpoint for Kilo (issue #1625; contract in
// docs/architecture/mcp-mvp.md).
//
// Per-request order (architecture section 5). Earlier failures stop the request
// and no data query runs:
//   0  GET .../oauth-protected-resource is public discovery; nothing else is.
//   1  pre-auth IP limiter, then a hard request-size bound
//   2  withSupabase({ auth: 'user' }): signature (JWKS), expiry, audience
//   3  Kilo claim checks: issuer, role, uuids, client_id (no first-party tokens)
//   4  per-user limiter
//   5  kilo.mcp_request_gate() on the request-scoped user client
//   6  MCP handler with a fresh server per request
//
// The service-role capability exists only inside limiter.ts. Tools receive the
// user client and verified identity, nothing else.

import { withOAuthProtectedResource, withSupabase, type SupabaseContext } from '@supabase/server'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { clientIp } from '../_shared/rate-limit.ts'
import { checkClaims, expectedIssuer } from './auth.ts'
import { SERVER_VERSION } from './envelope.ts'
import { runGate, withTimeout, type RpcClient } from './gate.ts'
import { createLimiter, type Limiter } from './limiter.ts'
import { MAX_REQUEST_BYTES, PRE_AUTH_WINDOW, REQUEST_TIMEOUT_MS, USER_WINDOWS } from './limits.ts'
import { registerTools, TOOLS, type ToolModule } from './tools/index.ts'

export interface McpDeps {
  env: (name: string) => string | undefined
  limiter: Limiter
  tools?: readonly ToolModule[]
  // Test seams. Production leaves both unset.
  authEnv?: Record<string, unknown>
  clientFor?: (ctx: SupabaseContext) => RpcClient
}

const JSON_HEADERS = { 'content-type': 'application/json' }

function jsonRpcError(status: number, code: number, message: string, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  })
}

// The discovery middleware adds the RFC 9728 `WWW-Authenticate` challenge to
// every 401 that leaves this function.
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: JSON_HEADERS })
}

// Reads at most MAX_REQUEST_BYTES. Returns a replayable request, or a response.
async function boundedRequest(req: Request): Promise<Request | Response> {
  if (req.method !== 'POST') {
    return jsonRpcError(405, -32000, 'Method not allowed', { allow: 'POST' })
  }
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return jsonRpcError(413, -32000, 'Request too large')
  }
  const chunks: Uint8Array[] = []
  let total = 0
  if (req.body) {
    const reader = req.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel()
        return jsonRpcError(413, -32000, 'Request too large')
      }
      chunks.push(value)
    }
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return new Request(req.url, { method: 'POST', headers: req.headers, body })
}

type Parsed = { ok: true; method: string; tool: string | null } | { ok: false; response: Response }

function inspectBody(text: string, known: ReadonlySet<string>): Parsed {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, response: jsonRpcError(400, -32700, 'Parse error') }
  }
  if (Array.isArray(value)) {
    return { ok: false, response: jsonRpcError(400, -32600, 'Batch requests are not supported') }
  }
  if (typeof value !== 'object' || value === null || typeof (value as { method?: unknown }).method !== 'string') {
    return { ok: false, response: jsonRpcError(400, -32600, 'Invalid request') }
  }
  const { method, params } = value as { method: string; params?: { name?: unknown } }
  const name = typeof params?.name === 'string' && known.has(params.name) ? params.name : null
  return { ok: true, method: method.length <= 64 ? method : 'invalid', tool: method === 'tools/call' ? name : null }
}

export function createMcpFetch(deps: McpDeps): (req: Request) => Promise<Response> {
  const tools = deps.tools ?? TOOLS
  const known = new Set(tools.map((t) => t.name))

  const authed = withSupabase(
    {
      auth: 'user',
      audience: 'authenticated',
      supabaseOptions: { db: { schema: 'kilo' } },
      ...(deps.authEnv ? { env: deps.authEnv } : {}),
    },
    async (req: Request, ctx: SupabaseContext) => {
      const started = Date.now()
      const issuer = expectedIssuer(req, deps.env)
      const claims = checkClaims(ctx.jwtClaims, issuer)
      if (!claims.ok) return unauthorized()
      const { identity } = claims

      for (const w of USER_WINDOWS) {
        if (!(await deps.limiter.allow(`mcp:user:${identity.userId}:${w.suffix}`, w.max, w.windowMs))) {
          return jsonRpcError(429, -32000, 'Too many requests', { 'retry-after': String(Math.ceil(w.windowMs / 1000)) })
        }
      }

      const client = deps.clientFor ? deps.clientFor(ctx) : (ctx.supabase as unknown as RpcClient)
      const gate = await runGate(client)
      if (gate.kind === 'unauthorized') return unauthorized()
      if (gate.kind === 'unavailable') return jsonRpcError(503, -32000, 'Service unavailable', { 'retry-after': '5' })

      // Read once and replay: the SDK needs a fresh, unread body.
      const text = await req.text()
      const parsed = inspectBody(text, known)
      if (!parsed.ok) return parsed.response
      const replay = new Request(req.url, { method: req.method, headers: req.headers, body: text })

      const handler = createMcpHandler(
        () => {
          const server = new McpServer({ name: 'kilo', version: SERVER_VERSION })
          registerTools(
            server,
            {
              client,
              identity,
              consent: gate.kind === 'ok' ? 'granted' : 'not_granted',
              grantedAt: gate.grantedAt,
            },
            tools,
          )
          return server
        },
        { onerror: () => console.error('mcp handler error') },
      )

      let response: Response
      try {
        response = await withTimeout(Promise.resolve(handler.fetch(replay)), REQUEST_TIMEOUT_MS)
      } catch {
        response = jsonRpcError(504, -32000, 'Request timed out')
      }
      // Method, tool name, status and duration only: never arguments, tokens,
      // cursors, query strings or response bodies.
      console.log(JSON.stringify({ mcp: parsed.method, tool: parsed.tool, status: response.status, ms: Date.now() - started }))
      return response
    },
  )

  const preAuth = async (req: Request): Promise<Response> => {
    const ip = clientIp(req)
    if (!(await deps.limiter.allow(`mcp:${PRE_AUTH_WINDOW.suffix}:${ip}`, PRE_AUTH_WINDOW.max, PRE_AUTH_WINDOW.windowMs))) {
      return jsonRpcError(429, -32000, 'Too many requests', { 'retry-after': '60' })
    }
    if (req.method === 'OPTIONS') return (authed as (r: Request) => Promise<Response>)(req)
    const bounded = await boundedRequest(req)
    if (bounded instanceof Response) return bounded
    return (authed as (r: Request) => Promise<Response>)(bounded)
  }

  return withOAuthProtectedResource(
    deps.env('MCP_AUTH_ISSUER') ? { authorizationServer: () => deps.env('MCP_AUTH_ISSUER') as string } : {},
    preAuth,
  ) as (req: Request) => Promise<Response>
}

if (import.meta.main) {
  Deno.serve(createMcpFetch({ env: (n) => Deno.env.get(n), limiter: createLimiter((n) => Deno.env.get(n)) }))
}
