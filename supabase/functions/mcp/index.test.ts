import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { createMcpFetch } from './index.ts'
import {
  claims, fakeClient, fakeLimiter, GATE_OK, ISSUER, makeSigner, SESSION_A, SESSION_B, USER_A, USER_B,
  type FakeClient,
} from './testing.ts'

const signer = await makeSigner()
const other = await makeSigner()

const ENV: Record<string, string> = { MCP_AUTH_ISSUER: ISSUER }
const authEnv = {
  url: 'http://127.0.0.1:54321',
  publishableKeys: { default: 'sb_publishable_test' },
  secretKeys: {},
  jwks: signer.jwks,
}

function build(client: FakeClient, limiter = fakeLimiter()) {
  return createMcpFetch({ env: (n) => ENV[n], limiter, authEnv, clientFor: () => client })
}

const URL_MCP = 'http://127.0.0.1:54321/functions/v1/mcp'

function rpc(method: string, params: unknown = {}, token?: string, id = 1): Request {
  return new Request(URL_MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
}

const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'test', version: '1' },
}

async function token(overrides: Record<string, unknown> = {}) {
  return signer.sign(claims(overrides))
}

async function json(res: Response) {
  const text = await res.text()
  if (res.headers.get('content-type')?.includes('text/event-stream')) {
    const line = text.split('\n').find((l) => l.startsWith('data:'))
    return JSON.parse(line!.slice(5))
  }
  return text ? JSON.parse(text) : null
}

Deno.test('discovery is public and names the authorization server', async () => {
  const client = fakeClient(GATE_OK)
  const res = await build(client)(new Request(`${URL_MCP}/oauth-protected-resource`))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.authorization_servers, [ISSUER])
  assertEquals(client.calls, [])
})

Deno.test('anonymous requests get a 401 challenge and touch nothing', async () => {
  const client = fakeClient(GATE_OK)
  const res = await build(client)(rpc('initialize', INIT))
  assertEquals(res.status, 401)
  assertStringIncludes(res.headers.get('www-authenticate') ?? '', 'resource_metadata')
  assertEquals(client.calls, [])
})

const REJECTED: [string, () => Promise<string>][] = [
  ['malformed token', () => Promise.resolve('not.a.jwt')],
  ['bad signature', () => other.sign(claims())],
  ['HS256 token', () => signer.sign(claims(), { alg: 'HS256' })],
  ['expired token', () => token({ exp: Math.floor(Date.now() / 1000) - 60 })],
  ['wrong audience', () => token({ aud: 'someone-else' })],
  ['wrong issuer', () => token({ iss: 'https://evil.example/auth/v1' })],
  ['first-party token (no client_id)', () => token({ client_id: undefined })],
  ['empty client_id', () => token({ client_id: '' })],
  ['non-uuid sub', () => token({ sub: 'not-a-uuid' })],
  ['non-uuid session_id', () => token({ session_id: 'nope' })],
  ['wrong role', () => token({ role: 'service_role' })],
]

for (const [name, mint] of REJECTED) {
  Deno.test(`rejects ${name} before any lookup`, async () => {
    const client = fakeClient(GATE_OK)
    const limiter = fakeLimiter()
    const res = await build(client, limiter)(rpc('initialize', INIT, await mint()))
    assertEquals(res.status, 401)
    assertEquals(client.calls, [])
    assert(!limiter.buckets.some((b) => b.startsWith('mcp:user:')), 'no per-user limiter hit for a rejected token')
  })
}

for (const status of ['session_inactive', 'account_missing', 'consent_stale']) {
  Deno.test(`gate ${status} -> 401 with no tool run`, async () => {
    const client = fakeClient({ status, consent_granted_at: null })
    const res = await build(client)(rpc('tools/list', {}, await token()))
    assertEquals(res.status, 401)
    assertStringIncludes(res.headers.get('www-authenticate') ?? '', 'resource_metadata')
    assertEquals(client.calls, ['mcp_request_gate'])
  })
}

for (const [name, gate] of [
  ['rpc error', () => ({ data: null, error: { code: 'XX000' } })],
  ['unknown status', () => ({ status: 'mystery' })],
  ['null payload', () => null],
] as const) {
  Deno.test(`gate lookup outage (${name}) -> 503`, async () => {
    const client = name === 'rpc error'
      ? ({ calls: [], rpc: () => Promise.resolve({ data: null, error: { code: 'XX000' } }) } as unknown as FakeClient)
      : fakeClient(gate)
    const res = await build(client)(rpc('tools/list', {}, await token()))
    assertEquals(res.status, 503)
  })
}

Deno.test('gate rejection (thrown rpc) -> 503', async () => {
  const res = await build(fakeClient(new Error('boom')))(rpc('tools/list', {}, await token()))
  assertEquals(res.status, 503)
})

Deno.test('initialize + tools/list advertise only whoami, read-only', async () => {
  const client = fakeClient(GATE_OK)
  const fetchMcp = build(client)
  const t = await token()
  const init = await fetchMcp(rpc('initialize', INIT, t))
  assertEquals(init.status, 200)
  const list = await json(await fetchMcp(rpc('tools/list', {}, t, 2)))
  assertEquals(list.result.tools.map((x: { name: string }) => x.name), ['whoami'])
  assertEquals(list.result.tools[0].annotations.readOnlyHint, true)
})

Deno.test('whoami returns only approved identity fields', async () => {
  const client = fakeClient(GATE_OK)
  const res = await build(client)(rpc('tools/call', { name: 'whoami', arguments: {} }, await token({ email: 'x@example.com' })))
  const body = await json(res)
  const out = body.result.structuredContent
  assertEquals(out.schema, 'kilo.mcp.whoami/v1')
  assertEquals(out.user_id, USER_A)
  assertEquals(out.client_id, 'client-1')
  assertEquals(out.health_consent, 'granted')
  assertEquals(out.provenance.coverage, 'unknown')
  assertEquals(Object.keys(out).sort(), ['client_id', 'health_consent', 'provenance', 'schema', 'server_version', 'user_id'])
  assertEquals(JSON.stringify(body).includes('x@example.com'), false)
  assertEquals(body.result.content[0].text, JSON.stringify(out))
  assertEquals(client.calls, ['mcp_request_gate'])
})

Deno.test('consent_required still serves initialize, tools/list and whoami', async () => {
  const client = fakeClient({ status: 'consent_required', consent_granted_at: null })
  const fetchMcp = build(client)
  const t = await token()
  assertEquals((await fetchMcp(rpc('initialize', INIT, t))).status, 200)
  assertEquals((await fetchMcp(rpc('tools/list', {}, t, 2))).status, 200)
  const who = await json(await fetchMcp(rpc('tools/call', { name: 'whoami', arguments: {} }, t, 3)))
  assertEquals(who.result.structuredContent.health_consent, 'not_granted')
})

Deno.test('whoami rejects unknown arguments', async () => {
  const res = await build(fakeClient(GATE_OK))(rpc('tools/call', { name: 'whoami', arguments: { user_id: USER_B } }, await token()))
  const body = await json(res)
  assert(body.error || body.result?.isError, 'unknown keys must be rejected')
})

Deno.test('protocol: GET/DELETE not allowed, batches and bad JSON rejected, unknown method errors', async () => {
  const client = fakeClient(GATE_OK)
  const fetchMcp = build(client)
  const t = await token()
  const auth = { authorization: `Bearer ${t}` }
  assertEquals((await fetchMcp(new Request(URL_MCP, { headers: auth }))).status, 405)
  assertEquals((await fetchMcp(new Request(URL_MCP, { method: 'DELETE', headers: auth }))).status, 405)
  const post = (body: string) => fetchMcp(new Request(URL_MCP, {
    method: 'POST', body,
    headers: { ...auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  }))
  assertEquals((await post('[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]')).status, 400)
  assertEquals((await post('{nope')).status, 400)
  assertEquals((await post('"x"')).status, 400)
  const unknown = await json(await fetchMcp(rpc('resources/list', {}, t, 9)))
  assert(unknown.error, 'unsupported method returns a JSON-RPC error')
})

Deno.test('request body is bounded by declared and streamed size', async () => {
  const client = fakeClient(GATE_OK)
  const fetchMcp = build(client)
  const t = await token()
  const big = 'x'.repeat(70 * 1024)
  const declared = await fetchMcp(new Request(URL_MCP, {
    method: 'POST', body: big, headers: { authorization: `Bearer ${t}`, 'content-length': String(big.length) },
  }))
  assertEquals(declared.status, 413)
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close() } })
  const streamed = await fetchMcp(new Request(URL_MCP, {
    method: 'POST', body: stream, headers: { authorization: `Bearer ${t}` }, // @ts-ignore deno streaming body
    duplex: 'half',
  }))
  assertEquals(streamed.status, 413)
  assertEquals(client.calls, [])
})

Deno.test('IP limiter denies before authentication', async () => {
  const client = fakeClient(GATE_OK)
  const limiter = fakeLimiter((b) => b.startsWith('mcp:ip:'))
  const res = await build(client, limiter)(rpc('initialize', INIT, await token()))
  assertEquals(res.status, 429)
  assertEquals(client.calls, [])
  assert(limiter.buckets.every((b) => b.startsWith('mcp:ip:')))
})

Deno.test('per-user limiter (minute or hour) denies before the gate', async () => {
  for (const suffix of [':m', ':h']) {
    const client = fakeClient(GATE_OK)
    const limiter = fakeLimiter((b) => b.startsWith('mcp:user:') && b.endsWith(suffix))
    const res = await build(client, limiter)(rpc('initialize', INIT, await token()))
    assertEquals(res.status, 429)
    assertEquals(client.calls, [])
  }
})

Deno.test('limiter buckets embed the verified user, never a request value', async () => {
  const limiter = fakeLimiter()
  await build(fakeClient(GATE_OK), limiter)(rpc('initialize', INIT, await token()))
  assert(limiter.buckets.includes(`mcp:user:${USER_A}:m`))
  assert(limiter.buckets.includes(`mcp:user:${USER_A}:h`))
})

Deno.test('simultaneous users never share state', async () => {
  const ca = fakeClient(GATE_OK)
  const cb = fakeClient({ status: 'consent_required', consent_granted_at: null })
  const clients = new Map([[USER_A, ca], [USER_B, cb]])
  const fetchMcp = createMcpFetch({
    env: (n) => ENV[n], limiter: fakeLimiter(), authEnv,
    clientFor: (ctx) => clients.get((ctx.jwtClaims as { sub: string }).sub)!,
  })
  const ta = await token()
  const tb = await token({ sub: USER_B, session_id: SESSION_B })
  const call = (t: string, id: number) => fetchMcp(rpc('tools/call', { name: 'whoami', arguments: {} }, t, id)).then(json)
  const results = await Promise.all([call(ta, 1), call(tb, 2), call(ta, 3), call(tb, 4)])
  assertEquals(results.map((r) => r.result.structuredContent.user_id), [USER_A, USER_B, USER_A, USER_B])
  assertEquals(results.map((r) => r.result.structuredContent.health_consent), ['granted', 'not_granted', 'granted', 'not_granted'])
  void SESSION_A
})

Deno.test('logs carry method, tool, status and duration only', async () => {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  const t = await token()
  try {
    await build(fakeClient(GATE_OK))(rpc('tools/call', { name: 'whoami', arguments: {} }, t))
  } finally {
    console.log = original
  }
  const joined = lines.join('\n')
  assertStringIncludes(joined, '"mcp":"tools/call"')
  assertStringIncludes(joined, '"tool":"whoami"')
  assertEquals(joined.includes(t), false)
  assertEquals(joined.includes(USER_A), false)
})

Deno.test('a stalled anonymous body is cut off at the request deadline', async () => {
  const client = fakeClient(GATE_OK)
  const fetchMcp = createMcpFetch({
    env: (n) => ENV[n], limiter: fakeLimiter(), authEnv, clientFor: () => client, requestTimeoutMs: 150,
  })
  const stalled = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')) } })
  const started = Date.now()
  const res = await fetchMcp(new Request(URL_MCP, {
    method: 'POST', body: stalled, headers: { 'content-type': 'application/json' }, // @ts-ignore deno streaming body
    duplex: 'half',
  }))
  assertEquals(res.status, 504)
  assert(Date.now() - started < 2000)
  assertEquals(client.calls, [])
})

Deno.test('a stalled limiter is cut off at the request deadline', async () => {
  const client = fakeClient(GATE_OK)
  const fetchMcp = createMcpFetch({
    env: (n) => ENV[n], authEnv, clientFor: () => client, requestTimeoutMs: 150,
    limiter: { allow: () => new Promise<boolean>(() => {}) },
  })
  const res = await fetchMcp(rpc('initialize', INIT, await token()))
  assertEquals(res.status, 504)
  assertEquals(client.calls, [])
})

Deno.test('client-chosen method text is never logged', async () => {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try {
    await build(fakeClient(GATE_OK))(rpc('squat 100kg; private-health-note', {}, await token()))
  } finally {
    console.log = original
  }
  const joined = lines.join('\n')
  assertEquals(joined.includes('squat'), false)
  assertEquals(joined.includes('private-health-note'), false)
  assertStringIncludes(joined, '"mcp":"unknown"')
})
