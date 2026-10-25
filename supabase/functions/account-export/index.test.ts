// Handler-boundary tests for the account-export Edge Function (#1559).
//
// Drives the real request flow (createExportHandler in index.ts) and the real
// shared limiter, health-data scope, and security-event helpers. Only the two
// Supabase clients are doubles, so an injected rejection travels through exactly
// the code that runs in production.
//
// Run: deno test --no-check --config supabase/functions/deno.json \
//        --lock=supabase/functions/deno.lock --frozen --allow-import --allow-read \
//        supabase/functions/account-export/index.test.ts

import { PRODUCTION_WEB_ORIGIN } from '../_shared/cors.ts'
import { HEALTH_DATA_SCOPE } from '../_shared/health-data-scope.ts'
import { UNEXPECTED_ERROR_BODY } from '../_shared/unexpected-error.ts'

// Importing the entrypoint runs its production wiring. Stub the registration
// (no listener opens) and the environment (no --allow-env, no real project) for
// the duration of the import, and check the module registered its handler.
const realServe = Deno.serve
const realEnvGet = Deno.env.get
let registered: unknown
// deno-lint-ignore no-explicit-any
const denoGlobal = Deno as any
denoGlobal.serve = (handler: unknown) => {
  registered = handler
}
denoGlobal.env.get = (name: string) => name === 'SUPABASE_URL' ? 'https://stub.invalid' : 'stub-key'
const { createExportHandler } = await import('./index.ts').finally(() => {
  denoGlobal.serve = realServe
  denoGlobal.env.get = realEnvGet
})

const USER_ID = '15590000-0000-4000-8000-00000000000a'
const TOKEN = 'secret-bearer-token-value'
// Planted in every injected rejection: it must reach neither the response nor
// the log, standing in for a token, email, or row data quoted by an upstream.
const LEAK = 'leaked-upstream-detail user@example.test'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`)
}

// ---------------------------------------------------------------------------
// Supabase client doubles
// ---------------------------------------------------------------------------

type Result = { data: unknown; error: { message: string; code?: string } | null }

interface Fixture {
  // Return a Result, or throw to simulate a rejected transport call.
  rpc?: (name: string, args: Record<string, unknown>) => Result
  getUser?: () => { data: { user: { id: string; email: string } | null }; error: unknown }
  // Rows (or an error) for a table read by either client.
  table?: (table: string) => Result
}

function harness(fixture: Fixture = {}) {
  const calls: string[] = []

  const rpc = fixture.rpc ?? ((name: string) => ({ data: name === 'rate_limit_check' ? true : null, error: null }))
  const table = fixture.table ?? ((t: string) => ({ data: t === 'user_profile' || t === 'feature_toggles' ? { user_id: USER_ID } : [], error: null }))

  // Chainable stand-in for a PostgREST builder: awaitable directly (collection)
  // or through maybeSingle() (singleton).
  const from = (who: string) => (t: string) => {
    calls.push(`${who}.from:${t}`)
    const run = () => Promise.resolve().then(() => table(t))
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: run,
      then: (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    }
    return builder
  }

  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}${name === 'record_security_event' ? `:${args.p_event_name}` : ''}`)
      return Promise.resolve().then(() => rpc(name, args))
    },
    from: from('admin'),
  }

  const userClient = (token: string) => {
    calls.push('userClient')
    assertEquals(token, TOKEN, 'user client is built from the bearer token')
    return {
      auth: {
        getUser: () => {
          calls.push('getUser')
          return Promise.resolve().then(() =>
            fixture.getUser ? fixture.getUser() : { data: { user: { id: USER_ID, email: 'owner@example.test' } }, error: null }
          )
        },
      },
      from: from('user'),
    }
  }

  // deno-lint-ignore no-explicit-any
  const handler = createExportHandler({ admin: admin as any, userClient: userClient as any })
  return { handler, calls }
}

function request(opts: { origin?: string | null; token?: string | null; method?: string } = {}): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': '198.51.100.7' }
  if (opts.origin !== undefined && opts.origin !== null) headers.origin = opts.origin
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('https://edge.test/account-export', { method: opts.method ?? 'POST', headers })
}

// Runs fn with console output captured, so tests can assert nothing sensitive
// was logged.
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const lines: string[] = []
  const original = { log: console.log, error: console.error }
  const sink = (...args: unknown[]) => lines.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' '))
  console.log = sink
  console.error = sink
  try {
    return { result: await fn(), logs: lines.join('\n') }
  } finally {
    console.log = original.log
    console.error = original.error
  }
}

async function assertSanitized500(res: Response, logs: string, label: string) {
  assertEquals(res.status, 500, `${label}: status`)
  assertEquals(res.headers.get('content-type'), 'application/json', `${label}: content type`)
  const text = await res.text()
  assertEquals(JSON.parse(text), UNEXPECTED_ERROR_BODY, `${label}: generic body`)
  for (const secret of [LEAK, TOKEN, 'at ', 'stack']) {
    assert(!text.includes(secret), `${label}: body leaks ${secret}`)
  }
  for (const secret of [LEAK, TOKEN, USER_ID]) {
    assert(!logs.includes(secret), `${label}: log leaks ${secret}`)
  }
  assert(logs.includes('account-export unexpected error'), `${label}: boundary logs a bounded line`)
}

const reject = (): never => {
  throw new Error(LEAK)
}

Deno.test('entrypoint registers a request handler with Deno.serve', () => {
  assertEquals(typeof registered, 'function', 'handler registered')
})

// ---------------------------------------------------------------------------
// Unexpected dependency failures
// ---------------------------------------------------------------------------

Deno.test('rejected IP limiter RPC resolves to a sanitized 500 before any auth or data work', async () => {
  const { handler, calls } = harness({ rpc: (name) => name === 'rate_limit_check' ? reject() : { data: null, error: null } })
  const { result, logs } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  await assertSanitized500(result, logs, 'ip limiter')
  assertEquals(result.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'allowed origin can read the failure')
  assertEquals(calls, ['rpc:rate_limit_check'], 'nothing runs after the rejection')
})

Deno.test('rejected identity lookup resolves to a sanitized 500 without spending user quota or reading data', async () => {
  const { handler, calls } = harness({ getUser: reject })
  const { result, logs } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  await assertSanitized500(result, logs, 'identity lookup')
  assertEquals(calls, ['rpc:rate_limit_check', 'userClient', 'getUser'], 'stops at the identity lookup')
})

Deno.test('rejected per-user limiter RPC resolves to a sanitized 500 before any data read', async () => {
  let checks = 0
  const { handler, calls } = harness({
    rpc: (name) => {
      if (name === 'rate_limit_check' && ++checks === 2) reject()
      return { data: name === 'rate_limit_check' ? true : null, error: null }
    },
  })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'user limiter')
  assert(!calls.some((c) => c.includes('.from:')), 'no account or health table is read')
})

Deno.test('rejected health read resolves to a sanitized 500, never an export or a success event', async () => {
  const { handler, calls } = harness({
    table: (t) => t === HEALTH_DATA_SCOPE[0].table ? reject() : { data: null, error: null },
  })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'health read')
  assert(!calls.includes('rpc:record_security_event:account.export_succeeded'), 'no success is recorded')
})

Deno.test('failure response carries the shared CORS policy unchanged for every Origin shape', async () => {
  const cases: Array<[string, string | null | undefined, string | null]> = [
    ['allowed', PRODUCTION_WEB_ORIGIN, PRODUCTION_WEB_ORIGIN],
    ['disallowed', 'https://evil.example', null],
    ['absent (native)', undefined, null],
    ['null', 'null', null],
  ]
  for (const [label, origin, acao] of cases) {
    const { handler } = harness({ getUser: reject })
    const { result, logs } = await captureLogs(() => handler(request({ origin })))
    await assertSanitized500(result, logs, label)
    assertEquals(result.headers.get('access-control-allow-origin'), acao, `${label}: ACAO`)
    assertEquals(result.headers.get('vary'), 'Origin', `${label}: Vary`)
  }
})

// ---------------------------------------------------------------------------
// Ordinary constructed responses are unchanged
// ---------------------------------------------------------------------------

Deno.test('preflight still answers ok with CORS and does no work', async () => {
  const { handler, calls } = harness()
  const res = await handler(request({ method: 'OPTIONS', origin: PRODUCTION_WEB_ORIGIN }))
  assertEquals([res.status, await res.text()], [200, 'ok'], 'preflight')
  assertEquals(res.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'preflight ACAO')
  assertEquals(calls, [], 'no RPC or client work')
})

Deno.test('missing token is still a 401', async () => {
  const { handler, calls } = harness()
  const res = await handler(request({ token: null }))
  assertEquals([res.status, await res.json()], [401, { error: 'Unauthorized' }], 'missing token')
  assert(!calls.includes('userClient'), 'no user client without a token')
})

Deno.test('resolved identity rejection is still a 401', async () => {
  const { handler } = harness({ getUser: () => ({ data: { user: null }, error: { message: 'bad jwt' } }) })
  const res = await handler(request())
  assertEquals([res.status, await res.json()], [401, { error: 'Unauthorized' }], 'invalid token')
})

Deno.test('exhausted IP bucket is still a 429 with Retry-After', async () => {
  const { handler } = harness({ rpc: (name) => ({ data: name === 'rate_limit_check' ? false : null, error: null }) })
  const res = await handler(request())
  assertEquals([res.status, await res.json()], [429, { error: 'Too Many Requests' }], 'throttled')
  assertEquals(res.headers.get('retry-after'), '600', 'Retry-After')
})

Deno.test('resolved database error is still "Export failed." and refunds the user bucket', async () => {
  const { handler, calls } = harness({
    table: (t) => t === 'feature_toggles' ? { data: null, error: { message: 'boom' } } : { data: null, error: null },
  })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [500, { error: 'Export failed.' }], 'db error')
  assert(calls.includes('rpc:rate_limit_refund'), 'quota refunded')
})

Deno.test('successful export is unchanged and readable from the allowed origin', async () => {
  const { handler, calls } = harness()
  const { result } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  assertEquals(result.status, 200, 'status')
  assertEquals(result.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'ACAO')
  const body = await result.json()
  assertEquals([body.version, body.account.id], [3, USER_ID], 'payload')
  assert(calls.includes('rpc:record_security_event:account.export_succeeded'), 'success recorded')
})
