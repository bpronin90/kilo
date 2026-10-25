import { assert, assertEquals } from 'jsr:@std/assert@1'
import { checkClaims, expectedIssuer } from './auth.ts'
import { fitItems, resultBytes, TOOL_ERRORS, toolError, toolResult } from './envelope.ts'
import { runGate, withTimeout } from './gate.ts'
import { limiterFromClient } from './limiter.ts'
import { registerTools, TOOLS, type ToolModule } from './tools/index.ts'
import { ISSUER, USER_A, SESSION_A } from './testing.ts'

const good = { iss: ISSUER, role: 'authenticated', sub: USER_A, session_id: SESSION_A, client_id: 'c1' }

Deno.test('checkClaims accepts only OAuth-client tokens from the expected issuer', () => {
  assertEquals(checkClaims(good, ISSUER), { ok: true, identity: { userId: USER_A, sessionId: SESSION_A, clientId: 'c1' } })
  assertEquals(checkClaims({ ...good, iss: ISSUER + '/' }, ISSUER).ok, true)
  for (const bad of [
    { ...good, iss: 'x' }, { ...good, role: 'anon' }, { ...good, client_id: undefined },
    { ...good, client_id: 1 }, { ...good, sub: 'x' }, { ...good, session_id: undefined },
  ]) assertEquals(checkClaims(bad, ISSUER).ok, false)
  assertEquals(checkClaims(null, ISSUER).ok, false)
  assertEquals(checkClaims(good, null).ok, false)
})

Deno.test('expectedIssuer prefers the pin, then the public URL, then the forwarded origin', () => {
  const req = new Request('http://kong:8000/functions/v1/mcp', {
    headers: { 'x-forwarded-host': '127.0.0.1:54321', 'x-forwarded-proto': 'http' },
  })
  assertEquals(expectedIssuer(req, () => undefined), 'http://127.0.0.1:54321/auth/v1')
  assertEquals(expectedIssuer(req, (n) => (n === 'SUPABASE_PUBLIC_URL' ? 'https://p.example/' : undefined)), 'https://p.example/auth/v1')
  assertEquals(expectedIssuer(req, (n) => (n === 'MCP_AUTH_ISSUER' ? 'https://c.example/auth/v1/' : undefined)), 'https://c.example/auth/v1')
})

Deno.test('tool errors use fixed text and never echo input', () => {
  for (const code of Object.keys(TOOL_ERRORS) as (keyof typeof TOOL_ERRORS)[]) {
    const r = toolError(code)
    assertEquals(r.isError, true)
    assertEquals(r.structuredContent?.schema, 'kilo.mcp.error/v1')
    assertEquals(r.structuredContent?.message, TOOL_ERRORS[code].message)
    assertEquals(r.content[0].text, JSON.stringify(r.structuredContent))
  }
})

Deno.test('fitItems trims trailing items, keeps one, and reports an unfit single item', () => {
  const build = (kept: readonly string[], trimmed: boolean) => toolResult({ items: kept, trimmed })
  const items = Array.from({ length: 50 }, () => 'x'.repeat(1000))
  const fit = fitItems(items, build, 30_000)
  assert(resultBytes(fit) <= 30_000)
  assert((fit.structuredContent!.items as string[]).length < 50)
  assertEquals(fit.structuredContent!.trimmed, true)
  assertEquals(fitItems(['a'], build, 30_000).structuredContent!.trimmed, false)
  assertEquals(fitItems(['x'.repeat(40_000)], build, 30_000).structuredContent!.code, 'response_too_large')
})

Deno.test('runGate treats timeouts and malformed payloads as unavailable', async () => {
  const slow = { rpc: () => new Promise<never>(() => {}) }
  assertEquals((await runGate(slow, 20)).kind, 'unavailable')
  assertEquals((await runGate({ rpc: () => Promise.resolve({ data: { status: 'ok' }, error: null }) })).kind, 'ok')
  assertEquals((await runGate({ rpc: () => Promise.resolve({ data: { status: 'nope' }, error: null }) })).kind, 'unavailable')
  assertEquals((await runGate({ rpc: () => Promise.resolve({ data: { status: 'consent_stale' }, error: null }) })).kind, 'unauthorized')
  await withTimeout(Promise.resolve(1), 10)
})

Deno.test('limiter fails closed when the durable limiter errors', async () => {
  const admin = { rpc: () => Promise.resolve({ data: null, error: { code: 'XX000' } }) }
  const limiter = limiterFromClient(admin as never)
  const errors = console.error
  console.error = () => {}
  try {
    assertEquals(await limiter.allow('mcp:user:x:m', 60, 60_000), false)
  } finally {
    console.error = errors
  }
  const ok = limiterFromClient({ rpc: () => Promise.resolve({ data: true, error: null }) } as never)
  assertEquals(await ok.allow('b', 1, 1000), true)
})

Deno.test('the registry registers nothing it was not given and tools see only the user client', () => {
  assertEquals(TOOLS.map((t) => t.name), ['whoami', 'workout_notes_list', 'weight_entries_list'])
  let seen: Record<string, unknown> | undefined
  const probe: ToolModule = { name: 'probe', register: (_s, ctx) => { seen = ctx as unknown as Record<string, unknown> } }
  registerTools({} as never, { client: { rpc: () => Promise.resolve({ data: null, error: null }) }, identity: { userId: USER_A, sessionId: SESSION_A, clientId: 'c' }, consent: 'granted', grantedAt: null }, [probe])
  assertEquals(Object.keys(seen!).sort(), ['client', 'consent', 'grantedAt', 'identity'])
})

Deno.test('the service-role capability is confined to limiter.ts', async () => {
  const dir = new URL('.', import.meta.url)
  const offenders: string[] = []
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name === 'limiter.ts') continue
    const text = await Deno.readTextFile(new URL(entry.name, dir))
    if (/SERVICE_ROLE|supabaseAdmin|createAdminClient/.test(text)) offenders.push(entry.name)
  }
  for await (const entry of Deno.readDir(new URL('tools/', dir))) {
    const text = await Deno.readTextFile(new URL(`tools/${entry.name}`, dir))
    if (/SERVICE_ROLE|supabaseAdmin|createAdminClient|createClient/.test(text)) offenders.push(`tools/${entry.name}`)
  }
  assertEquals(offenders, [])
})

Deno.test('limiter and gate pass the request signal into the in-flight RPC', async () => {
  const seen: AbortSignal[] = []
  const builder = () => ({
    then: (res: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data: true, error: null }).then(res),
    abortSignal(s: AbortSignal) { seen.push(s); return builder() },
  })
  const limiter = limiterFromClient({ rpc: () => builder() } as never)
  const controller = new AbortController()
  assertEquals(await limiter.allow('b', 1, 1000, controller.signal), true)
  assertEquals(seen.length, 1)
  controller.abort()
  assertEquals(seen[0], controller.signal, 'the exact request signal reaches the limiter RPC')

  const gateSeen: AbortSignal[] = []
  const client = {
    rpc: () => ({
      then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: { status: 'ok' }, error: null }).then(res),
      abortSignal(s: AbortSignal) { gateSeen.push(s); return this },
    }),
  }
  const request = new AbortController()
  assertEquals((await runGate(client as never, 3000, request.signal)).kind, 'ok')
  assertEquals(gateSeen.length, 1)
  request.abort()
  assertEquals(gateSeen[0].aborted, true, 'aborting the request aborts the gate RPC')
  const timed = new AbortController()
  await runGate(client as never, 20, timed.signal)
  await new Promise((r) => setTimeout(r, 60))
  assertEquals(gateSeen[1].aborted, true, 'the 3-second DB-call limit aborts the gate RPC')
})
