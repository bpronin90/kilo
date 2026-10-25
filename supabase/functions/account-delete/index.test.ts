// Handler-boundary tests for the account-delete Edge Function (#1560).
//
// Drives the real request flow (createDeleteHandler in index.ts) and the real
// shared limiter, restore revocation, health-data scope, and security-event
// helpers. Only the two Supabase clients are doubles, so an injected rejection
// travels through exactly the code that runs in production.
//
// Deletion is destructive, so beyond the response shape every failure test pins
// what did NOT happen afterwards: no later deletion step, no auth identity
// removal, no success event, and no body that claims the account is gone.
//
// Run: deno test --no-check --config supabase/functions/deno.json \
//        --lock=supabase/functions/deno.lock --frozen --allow-import --allow-read \
//        supabase/functions/account-delete/index.test.ts

import { PRODUCTION_WEB_ORIGIN } from '../_shared/cors.ts'
import { HEALTH_DATA_SCOPE } from '../_shared/health-data-scope.ts'
import { UNEXPECTED_ERROR_BODY } from '../_shared/unexpected-error.ts'
import type { EvidenceKey } from './index.ts'

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
const { createDeleteHandler } = await import('./index.ts').finally(() => {
  denoGlobal.serve = realServe
  denoGlobal.env.get = realEnvGet
})

const USER_ID = '15600000-0000-4000-8000-00000000000a'
const TOKEN = 'secret-bearer-token-value'
// Planted in every injected rejection: it must reach neither the response nor
// the log, standing in for a token, email, or row data quoted by an upstream.
const LEAK = 'leaked-upstream-detail user@example.test'
const EVIDENCE_KEY: EvidenceKey = { id: 'v-test', key: 'evidence-key-material' }
const CONSENT_EVENT = {
  event_type: 'granted',
  occurred_at: '2026-01-01T00:00:00Z',
  catalog_revision: 1,
  material_version: 1,
  copy_sha256: 'abc',
}

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

type Result = { data?: unknown; error: { message: string; code?: string } | null; count?: number }
type Op = 'select' | 'delete' | 'update' | 'upsert' | 'insert'

interface Fixture {
  // Return a Result, or throw to simulate a rejected transport call.
  rpc?: (name: string, args: Record<string, unknown>) => Result
  getUser?: () => { data: { user: { id: string } | null }; error: unknown }
  // Outcome of one statement against a table, from either client.
  table?: (table: string, op: Op) => Result
  deleteUser?: () => { error: { message: string } | null }
  evidenceKey?: EvidenceKey
}

// Default: a user who never reached the consent surface (no archive needed),
// with every statement succeeding and every health count at zero.
function defaultTable(t: string, op: Op): Result {
  if (op === 'select' && t === 'consent_events') return { data: [], error: null }
  if (op === 'select') return { data: null, error: null, count: 0 }
  return { data: null, error: null }
}

function defaultRpc(name: string): Result {
  if (name === 'rate_limit_check') return { data: true, error: null }
  if (name === 'restore_revoke_user') return { data: 0, error: null }
  return { data: null, error: null }
}

function harness(fixture: Fixture = {}) {
  const calls: string[] = []
  const events: Array<Record<string, unknown>> = []
  const rpc = fixture.rpc ?? defaultRpc
  const table = fixture.table ?? defaultTable

  // Chainable stand-in for a PostgREST builder. The statement kind is whichever
  // mutating method was chained (select otherwise); the call is logged when the
  // statement is awaited, i.e. when it would actually reach the database.
  const from = (who: string) => (t: string) => {
    let op: Op = 'select'
    const run = () =>
      Promise.resolve().then(() => {
        calls.push(`${who}.${op}:${t}`)
        return table(t, op)
      })
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      delete: () => ((op = 'delete'), builder),
      update: () => ((op = 'update'), builder),
      upsert: () => ((op = 'upsert'), builder),
      insert: () => ((op = 'insert'), builder),
      maybeSingle: run,
      then: (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    }
    return builder
  }

  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === 'record_security_event') events.push(args)
      calls.push(`rpc:${name}${name === 'record_security_event' ? `:${args.p_event_name}` : ''}`)
      return Promise.resolve().then(() => rpc(name, args))
    },
    from: from('admin'),
    auth: {
      admin: {
        deleteUser: (id: string) => {
          calls.push('deleteUser')
          assertEquals(id, USER_ID, 'only the verified caller is deleted')
          return Promise.resolve().then(() => fixture.deleteUser ? fixture.deleteUser() : { error: null })
        },
      },
    },
  }

  const userClient = (token: string) => {
    calls.push('userClient')
    assertEquals(token, TOKEN, 'user client is built from the bearer token')
    return {
      auth: {
        getUser: () => {
          calls.push('getUser')
          return Promise.resolve().then(() =>
            fixture.getUser ? fixture.getUser() : { data: { user: { id: USER_ID } }, error: null }
          )
        },
      },
      from: from('user'),
    }
  }

  const handler = createDeleteHandler({
    // deno-lint-ignore no-explicit-any
    admin: admin as any,
    // deno-lint-ignore no-explicit-any
    userClient: userClient as any,
    evidenceKey: fixture.evidenceKey ?? EVIDENCE_KEY,
  })
  return { handler, calls, events }
}

function request(opts: { origin?: string | null; token?: string | null; method?: string } = {}): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': '198.51.100.7' }
  if (opts.origin !== undefined && opts.origin !== null) headers.origin = opts.origin
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('https://edge.test/account-delete', { method: opts.method ?? 'POST', headers })
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
  // The generic body: no "ok", no claim that anything was or was not deleted.
  assertEquals(JSON.parse(text), UNEXPECTED_ERROR_BODY, `${label}: generic body`)
  for (const secret of [LEAK, TOKEN, 'at ', 'stack']) {
    assert(!text.includes(secret), `${label}: body leaks ${secret}`)
  }
  for (const secret of [LEAK, TOKEN, USER_ID]) {
    assert(!logs.includes(secret), `${label}: log leaks ${secret}`)
  }
  assert(logs.includes('account-delete unexpected error'), `${label}: boundary logs a bounded line`)
}

// Nothing that completes a deletion ran: no identity removal, no success event.
function assertNoCompletion(calls: string[], label: string) {
  assert(!calls.includes('deleteUser'), `${label}: auth identity must not be deleted`)
  assert(!calls.includes('rpc:record_security_event:account.delete_succeeded'), `${label}: no success recorded`)
}

const reject = (): never => {
  throw new Error(LEAK)
}

const healthDeletes = (calls: string[]) =>
  calls.filter((c) => HEALTH_DATA_SCOPE.some((d) => c === `admin.delete:${d.table}`))

Deno.test('entrypoint registers a request handler with Deno.serve', () => {
  assertEquals(typeof registered, 'function', 'handler registered')
})

// ---------------------------------------------------------------------------
// Unexpected dependency failures
// ---------------------------------------------------------------------------

Deno.test('rejected IP limiter RPC resolves to a sanitized 500 before any auth or deletion', async () => {
  const { handler, calls } = harness({ rpc: (name) => name === 'rate_limit_check' ? reject() : defaultRpc(name) })
  const { result, logs } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  await assertSanitized500(result, logs, 'ip limiter')
  assertEquals(result.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'allowed origin can read the failure')
  assertEquals(calls, ['rpc:rate_limit_check'], 'nothing runs after the rejection')
})

Deno.test('rejected identity lookup resolves to a sanitized 500 without revoking or deleting', async () => {
  const { handler, calls } = harness({ getUser: reject })
  const { result, logs } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  await assertSanitized500(result, logs, 'identity lookup')
  assertEquals(calls, ['rpc:rate_limit_check', 'userClient', 'getUser'], 'stops at the identity lookup')
})

Deno.test('rejected per-user limiter RPC resolves to a sanitized 500 before revocation or any delete', async () => {
  let checks = 0
  const { handler, calls } = harness({
    rpc: (name) => {
      if (name === 'rate_limit_check' && ++checks === 2) reject()
      return defaultRpc(name)
    },
  })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'user limiter')
  assert(!calls.includes('rpc:restore_revoke_user'), 'restore credentials are not revoked')
  assert(!calls.some((c) => c.startsWith('admin.') || c.startsWith('user.')), 'no table is touched')
  assertNoCompletion(calls, 'user limiter')
})

Deno.test('rejected restore revocation resolves to a sanitized 500 before the archive or any delete', async () => {
  const { handler, calls } = harness({ rpc: (name) => name === 'restore_revoke_user' ? reject() : defaultRpc(name) })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'revocation')
  assert(!calls.includes('admin.select:consent_events'), 'consent evidence is not read')
  assert(!calls.some((c) => c.includes('.delete:') || c.includes('.update:')), 'nothing is deleted')
  assertNoCompletion(calls, 'revocation')
})

Deno.test('rejected health delete mid-purge resolves to a sanitized 500 and stops the deletion', async () => {
  const target = [...HEALTH_DATA_SCOPE].sort((a, b) => a.deleteOrder - b.deleteOrder)[1].table
  const { handler, calls } = harness({
    table: (t, op) => t === target && op === 'delete' ? reject() : defaultTable(t, op),
  })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'health delete')
  assertEquals(healthDeletes(calls).length, 2, 'the purge stops at the rejected table')
  assert(!calls.some((c) => c.startsWith('user.delete:')), 'ordinary account rows are not deleted')
  assertNoCompletion(calls, 'health delete')
})

Deno.test('rejected app-row delete resolves to a sanitized 500 without deleting the identity', async () => {
  const { handler, calls } = harness({
    table: (t, op) => t === 'user_profile' && op === 'delete' ? reject() : defaultTable(t, op),
  })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'app rows')
  assertNoCompletion(calls, 'app rows')
})

Deno.test('rejected auth identity deletion resolves to a sanitized 500, never a success', async () => {
  const { handler, calls } = harness({ deleteUser: reject })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'identity deletion')
  assert(calls.includes('deleteUser'), 'reached the identity deletion')
  assert(!calls.includes('rpc:record_security_event:account.delete_succeeded'), 'no success recorded')
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
  const { result } = await captureLogs(() => handler(request({ token: null })))
  assertEquals([result.status, await result.json()], [401, { error: 'Unauthorized' }], 'missing token')
  assert(!calls.includes('userClient'), 'no user client without a token')
})

Deno.test('resolved identity rejection is still a 401', async () => {
  const { handler, calls } = harness({ getUser: () => ({ data: { user: null }, error: { message: 'bad jwt' } }) })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [401, { error: 'Unauthorized' }], 'invalid token')
  assert(!calls.includes('rpc:restore_revoke_user'), 'nothing destructive runs')
})

Deno.test('exhausted IP bucket is still a 429 with Retry-After', async () => {
  const { handler } = harness({ rpc: (name) => name === 'rate_limit_check' ? { data: false, error: null } : defaultRpc(name) })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [429, { error: 'Too Many Requests' }], 'throttled')
  assertEquals(result.headers.get('retry-after'), '3600', 'Retry-After')
})

Deno.test('resolved revocation error is still "Account deletion failed." and deletes nothing', async () => {
  const { handler, calls } = harness({
    rpc: (name) => name === 'restore_revoke_user' ? { data: null, error: { message: 'boom', code: 'XX000' } } : defaultRpc(name),
  })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [500, { error: 'Account deletion failed.' }], 'revocation error')
  assert(!calls.some((c) => c.includes('.delete:')), 'nothing is deleted')
  assertNoCompletion(calls, 'revocation error')
})

Deno.test('missing evidence key still fails closed with its constructed 500 before any delete', async () => {
  const { handler, calls, events } = harness({
    evidenceKey: { id: '', key: '' },
    table: (t, op) => t === 'consent_events' ? { data: [CONSENT_EVENT], error: null } : defaultTable(t, op),
  })
  const { result } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  assertEquals([result.status, await result.json()], [500, { error: 'Account deletion failed.' }], 'fail-closed body')
  assertEquals(result.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'constructed CORS kept')
  const failed = events.find((e) => e.p_event_name === 'account.delete_failed')
  assert(failed, 'account.delete_failed recorded')
  assertEquals((failed.p_context as Record<string, unknown>).reason, 'evidence_key_missing', 'classified as a deployment fault')
  assert(!calls.some((c) => c.includes('consent_evidence')), 'no archive is written')
  assert(!calls.some((c) => c.includes('.delete:') || c.includes('.update:')), 'nothing is deleted')
  assertNoCompletion(calls, 'evidence key missing')
})

Deno.test('successful deletion is unchanged and keeps its order of operations', async () => {
  const { handler, calls } = harness({
    table: (t, op) => t === 'consent_events' ? { data: [CONSENT_EVENT], error: null } : defaultTable(t, op),
  })
  const { result } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  assertEquals([result.status, await result.json()], [200, { ok: true }], 'success')
  assertEquals(result.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'ACAO')
  const at = (c: string) => {
    const i = calls.indexOf(c)
    assert(i >= 0, `${c} ran`)
    return i
  }
  const firstHealth = calls.indexOf(healthDeletes(calls)[0])
  assert(at('rpc:restore_revoke_user') < at('admin.insert:consent_evidence_archive'), 'revoke before archive')
  assert(at('admin.insert:consent_evidence_archive') < firstHealth, 'archive before health deletes')
  assert(firstHealth < at('user.delete:user_profile'), 'health before account rows')
  assert(at('user.delete:user_profile') < at('deleteUser'), 'account rows before identity')
  assert(at('deleteUser') < at('rpc:record_security_event:account.delete_succeeded'), 'success recorded last')
})
