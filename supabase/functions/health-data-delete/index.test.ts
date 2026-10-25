// Handler-boundary tests for the health-data-delete Edge Function (#1561).
//
// Drives the real request flow (createHealthDeleteHandler in index.ts) and the
// real shared limiter, health-data scope, and security-event helpers. Only the
// two Supabase clients are doubles, so an injected rejection travels through
// exactly the code that runs in production.
//
// Erasure is destructive and durable, so beyond the response shape every failure
// test pins what did NOT happen afterwards: no further purge step, no job
// completion, no success event, no later job claimed, and no body that claims the
// data is gone. The job itself stays queued for cron, as after any crash.
//
// Run: deno test --no-check --config supabase/functions/deno.json \
//        --lock=supabase/functions/deno.lock --frozen --allow-import --allow-read \
//        supabase/functions/health-data-delete/index.test.ts

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
const { createHealthDeleteHandler } = await import('./index.ts').finally(() => {
  denoGlobal.serve = realServe
  denoGlobal.env.get = realEnvGet
})

const USER_ID = '15610000-0000-4000-8000-00000000000a'
const OTHER_USER_ID = '15610000-0000-4000-8000-00000000000b'
const TOKEN = 'secret-user-bearer-token'
const SERVICE_KEY = 'secret-service-role-key'
// Planted in every injected rejection: it must reach neither the response nor
// the log, standing in for a token, email, or row data quoted by an upstream.
const LEAK = 'leaked-upstream-detail user@example.test'
const JOB = { id: 'job-1', user_id: USER_ID, reason: 'withdrawal', attempts: 0 }
const JOB_2 = { id: 'job-2', user_id: OTHER_USER_ID, reason: 'withdrawal', attempts: 0 }

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
type Op = 'select' | 'delete' | 'update'

interface Fixture {
  // Return a Result, or throw to simulate a rejected transport call.
  rpc?: (name: string, args: Record<string, unknown>) => Result
  getUser?: () => { data: { user: { id: string } | null }; error: unknown }
  // Outcome of one statement against a table.
  table?: (table: string, op: Op) => Result
}

function defaultTable(t: string, op: Op): Result {
  if (op === 'select' && t === 'health_data_deletion_jobs') return { data: [JOB], error: null }
  if (op === 'select') return { data: null, error: null, count: 0 }
  return { data: null, error: null }
}

// Worker queue: two open jobs, then empty.
function queueRpc() {
  const queue = [JOB, JOB_2]
  return (name: string): Result => {
    if (name === 'rate_limit_check') return { data: true, error: null }
    if (name === 'claim_health_deletion_job') return { data: queue.shift() ?? null, error: null }
    if (name === 'complete_health_deletion_job') return { data: { ok: true, remaining: 0 }, error: null }
    return { data: null, error: null }
  }
}

function harness(fixture: Fixture = {}) {
  const calls: string[] = []
  const rpc = fixture.rpc ?? queueRpc()
  const table = fixture.table ?? defaultTable

  // Chainable stand-in for a PostgREST builder. The statement kind is whichever
  // mutating method was chained (select otherwise); the call is logged when the
  // statement is awaited, i.e. when it would actually reach the database.
  const from = (t: string) => {
    let op: Op = 'select'
    const run = () =>
      Promise.resolve().then(() => {
        calls.push(`${op}:${t}`)
        return table(t, op)
      })
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      delete: () => ((op = 'delete'), builder),
      update: () => ((op = 'update'), builder),
      then: (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
    }
    return builder
  }

  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      const event = name === 'record_security_event' ? `:${args.p_event_name}` : ''
      const job = typeof args?.p_job_id === 'string' ? `:${args.p_job_id}` : ''
      calls.push(`rpc:${name}${event}${job}`)
      return Promise.resolve().then(() => rpc(name, args))
    },
    from,
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
    }
  }

  const handler = createHealthDeleteHandler({
    // deno-lint-ignore no-explicit-any
    admin: admin as any,
    // deno-lint-ignore no-explicit-any
    userClient: userClient as any,
    serviceRoleKey: SERVICE_KEY,
  })
  return { handler, calls }
}

function request(opts: { origin?: string | null; token?: string | null; method?: string } = {}): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': '198.51.100.7' }
  if (opts.origin !== undefined && opts.origin !== null) headers.origin = opts.origin
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token) headers.authorization = `Bearer ${token}`
  return new Request('https://edge.test/health-data-delete', { method: opts.method ?? 'POST', headers })
}

const worker = (origin?: string) => request({ token: SERVICE_KEY, origin })

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
  // The generic body: no "ok", no "withdrawn", no claim about the purge either way.
  assertEquals(JSON.parse(text), UNEXPECTED_ERROR_BODY, `${label}: generic body`)
  for (const secret of [LEAK, TOKEN, SERVICE_KEY, USER_ID, 'at ', 'stack']) {
    assert(!text.includes(secret), `${label}: body leaks ${secret}`)
  }
  for (const secret of [LEAK, TOKEN, SERVICE_KEY, USER_ID]) {
    assert(!logs.includes(secret), `${label}: log leaks ${secret}`)
  }
  assert(logs.includes('health-data-delete unexpected error'), `${label}: boundary logs a bounded line`)
}

// Nothing settled a job as erased: no completion RPC, no success event.
function assertNoCompletion(calls: string[], label: string) {
  assert(!calls.some((c) => c.startsWith('rpc:complete_health_deletion_job')), `${label}: no job completed`)
  assert(!calls.includes('rpc:record_security_event:health.purge_succeeded'), `${label}: no success recorded`)
}

const reject = (): never => {
  throw new Error(LEAK)
}

const healthDeletes = (calls: string[]) =>
  calls.filter((c) => HEALTH_DATA_SCOPE.some((d) => c === `delete:${d.table}`))

const secondTable = () => [...HEALTH_DATA_SCOPE].sort((a, b) => a.deleteOrder - b.deleteOrder)[1].table

Deno.test('entrypoint registers a request handler with Deno.serve', () => {
  assertEquals(typeof registered, 'function', 'handler registered')
})

// ---------------------------------------------------------------------------
// Unexpected dependency failures: user path
// ---------------------------------------------------------------------------

Deno.test('user: rejected IP limiter RPC resolves to a sanitized 500 before auth or any purge', async () => {
  const base = queueRpc()
  const { handler, calls } = harness({ rpc: (name) => name === 'rate_limit_check' ? reject() : base(name) })
  const { result, logs } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  await assertSanitized500(result, logs, 'ip limiter')
  assertEquals(result.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'allowed origin can read the failure')
  assertEquals(calls, ['rpc:rate_limit_check'], 'nothing runs after the rejection')
})

Deno.test('user: rejected identity lookup resolves to a sanitized 500 before any job lookup', async () => {
  const { handler, calls } = harness({ getUser: reject })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'identity lookup')
  assertEquals(calls, ['rpc:rate_limit_check', 'userClient', 'getUser'], 'stops at the identity lookup')
})

Deno.test('user: rejected per-user limiter RPC resolves to a sanitized 500 before the job lookup', async () => {
  let checks = 0
  const base = queueRpc()
  const { handler, calls } = harness({
    rpc: (name) => {
      if (name === 'rate_limit_check' && ++checks === 2) reject()
      return base(name)
    },
  })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'user limiter')
  assert(!calls.some((c) => c.includes(':health_data_deletion_jobs')), 'no job is looked up')
  assertEquals(healthDeletes(calls).length, 0, 'nothing is deleted')
})

Deno.test('user: rejected job lookup resolves to a sanitized 500 and purges nothing', async () => {
  const { handler, calls } = harness({
    table: (t, op) => t === 'health_data_deletion_jobs' ? reject() : defaultTable(t, op),
  })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'job lookup')
  assert(!calls.includes('update:user_profile'), 'legacy columns untouched')
  assertEquals(healthDeletes(calls).length, 0, 'nothing is deleted')
  assertNoCompletion(calls, 'job lookup')
})

Deno.test('user: rejected health delete mid-purge resolves to a sanitized 500, never withdrawn or pending', async () => {
  const target = secondTable()
  const { handler, calls } = harness({ table: (t, op) => t === target && op === 'delete' ? reject() : defaultTable(t, op) })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'user health delete')
  assertEquals(healthDeletes(calls).length, 2, 'the purge stops at the rejected table')
  assertNoCompletion(calls, 'user health delete')
  // The job is not failed or settled by the boundary: it stays claimed/open and
  // cron's reclaim retries it, exactly as after a crashed worker.
  assert(!calls.some((c) => c.startsWith('rpc:fail_health_deletion_job')), 'boundary does not touch the job')
})

Deno.test('user: rejected job completion RPC resolves to a sanitized 500, never a success', async () => {
  const base = queueRpc()
  const { handler, calls } = harness({ rpc: (name) => name === 'complete_health_deletion_job' ? reject() : base(name) })
  const { result, logs } = await captureLogs(() => handler(request()))
  await assertSanitized500(result, logs, 'user completion')
  assert(!calls.includes('rpc:record_security_event:health.purge_succeeded'), 'no success recorded')
})

// ---------------------------------------------------------------------------
// Unexpected dependency failures: worker path
// ---------------------------------------------------------------------------

Deno.test('worker: rejected claim RPC resolves to a sanitized 500 and processes nothing', async () => {
  const base = queueRpc()
  const { handler, calls } = harness({ rpc: (name) => name === 'claim_health_deletion_job' ? reject() : base(name) })
  const { result, logs } = await captureLogs(() => handler(worker()))
  await assertSanitized500(result, logs, 'claim')
  assertEquals(calls, ['rpc:claim_health_deletion_job'], 'no purge, limiter, or user client')
})

Deno.test('worker: rejected health delete stops the drain without claiming later jobs', async () => {
  const target = secondTable()
  const { handler, calls } = harness({ table: (t, op) => t === target && op === 'delete' ? reject() : defaultTable(t, op) })
  const { result, logs } = await captureLogs(() => handler(worker()))
  await assertSanitized500(result, logs, 'worker health delete')
  assertEquals(calls.filter((c) => c === 'rpc:claim_health_deletion_job').length, 1, 'no second job claimed')
  assertEquals(healthDeletes(calls).length, 2, 'the purge stops at the rejected table')
  assertNoCompletion(calls, 'worker health delete')
  assert(!calls.includes('userClient'), 'worker mode never builds a user client')
})

Deno.test('worker: rejection on a later job keeps earlier settled work and claims no more', async () => {
  const base = queueRpc()
  const { handler, calls } = harness({
    rpc: (name, args) => name === 'complete_health_deletion_job' && args.p_job_id === JOB_2.id ? reject() : base(name),
  })
  const { result, logs } = await captureLogs(() => handler(worker()))
  await assertSanitized500(result, logs, 'worker second job')
  assert(calls.includes('rpc:complete_health_deletion_job:job-1'), 'first job settled before the failure')
  assertEquals(calls.filter((c) => c === 'rpc:record_security_event:health.purge_succeeded').length, 1, 'only the first job recorded as purged')
  assertEquals(calls.filter((c) => c === 'rpc:claim_health_deletion_job').length, 2, 'no third claim')
})

Deno.test('failure response carries the shared CORS policy unchanged for every Origin shape', async () => {
  const cases: Array<[string, string | null | undefined, string | null]> = [
    ['allowed', PRODUCTION_WEB_ORIGIN, PRODUCTION_WEB_ORIGIN],
    ['disallowed', 'https://evil.example', null],
    ['absent (native)', undefined, null],
    ['null', 'null', null],
  ]
  for (const [label, origin, acao] of cases) {
    for (const mode of ['user', 'worker'] as const) {
      const base = queueRpc()
      const { handler } = harness({
        getUser: reject,
        rpc: (name) => name === 'claim_health_deletion_job' ? reject() : base(name),
      })
      const req = mode === 'worker' ? request({ token: SERVICE_KEY, origin }) : request({ origin })
      const { result, logs } = await captureLogs(() => handler(req))
      await assertSanitized500(result, logs, `${mode} ${label}`)
      assertEquals(result.headers.get('access-control-allow-origin'), acao, `${mode} ${label}: ACAO`)
      assertEquals(result.headers.get('vary'), 'Origin', `${mode} ${label}: Vary`)
    }
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
  assertEquals(calls, ['rpc:record_security_event:auth.token_missing'], 'only the denial is recorded')
})

Deno.test('a bearer that is not the service-role key takes the user path and is rejected there', async () => {
  const { handler, calls } = harness({ getUser: () => ({ data: { user: null }, error: { message: 'bad jwt' } }) })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [401, { error: 'Unauthorized' }], 'invalid token')
  assert(!calls.includes('rpc:claim_health_deletion_job'), 'worker queue is never drained')
  assert(calls.includes('rpc:record_security_event:auth.token_rejected'), 'rejection recorded')
})

Deno.test('exhausted IP bucket is still a 429 with Retry-After', async () => {
  const base = queueRpc()
  const { handler } = harness({ rpc: (name) => name === 'rate_limit_check' ? { data: false, error: null } : base(name) })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [429, { error: 'Too Many Requests' }], 'throttled')
  assertEquals(result.headers.get('retry-after'), '3600', 'Retry-After')
})

Deno.test('resolved claim error is still "Claim failed."', async () => {
  const base = queueRpc()
  const { handler } = harness({
    rpc: (name) => name === 'claim_health_deletion_job' ? { data: null, error: { message: 'boom', code: 'XX000' } } : base(name),
  })
  const { result } = await captureLogs(() => handler(worker()))
  assertEquals([result.status, await result.json()], [500, { error: 'Claim failed.' }], 'claim error')
})

Deno.test('resolved job lookup error is still "Deletion failed."', async () => {
  const { handler, calls } = harness({
    table: (t, op) => t === 'health_data_deletion_jobs' ? { data: null, error: { message: 'boom', code: 'XX000' } } : defaultTable(t, op),
  })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [500, { error: 'Deletion failed.' }], 'lookup error')
  assertEquals(healthDeletes(calls).length, 0, 'nothing is deleted')
})

Deno.test('a job owned by another user still fails closed before any purge', async () => {
  const { handler, calls } = harness({
    table: (t, op) => t === 'health_data_deletion_jobs' ? { data: [JOB_2], error: null } : defaultTable(t, op),
  })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [500, { error: 'Deletion failed.' }], 'subject mismatch')
  assert(calls.includes('rpc:record_security_event:authz.denied'), 'critical event recorded')
  assertEquals(healthDeletes(calls).length, 0, 'nothing is deleted')
})

Deno.test('no open job is still reported as no_pending_deletion', async () => {
  const { handler } = harness({
    table: (t, op) => t === 'health_data_deletion_jobs' ? { data: [], error: null } : defaultTable(t, op),
  })
  const { result } = await captureLogs(() => handler(request()))
  assertEquals([result.status, await result.json()], [200, { ok: true, status: 'no_pending_deletion' }], 'nothing queued')
})

Deno.test('a resolved purge failure is still the durable 202 deletion_pending', async () => {
  const target = secondTable()
  const { handler, calls } = harness({
    table: (t, op) => t === target && op === 'delete' ? { data: null, error: { message: 'boom' } } : defaultTable(t, op),
  })
  const { result } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  assertEquals(
    [result.status, await result.json()],
    [202, { ok: false, status: 'deletion_pending', retrying: true }],
    'pending',
  )
  assertEquals(result.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'constructed CORS kept')
  assert(calls.includes('rpc:fail_health_deletion_job:job-1'), 'job left for the cron retry')
  assert(calls.includes('rpc:record_security_event:health.purge_failed'), 'failure recorded')
  assertNoCompletion(calls, 'resolved purge failure')
})

Deno.test('user purge success is unchanged and keeps its order of operations', async () => {
  const { handler, calls } = harness()
  const { result } = await captureLogs(() => handler(request({ origin: PRODUCTION_WEB_ORIGIN })))
  assertEquals([result.status, await result.json()], [200, { ok: true, status: 'withdrawn' }], 'success')
  const at = (c: string) => {
    const i = calls.indexOf(c)
    assert(i >= 0, `${c} ran`)
    return i
  }
  assert(at('getUser') < at('select:health_data_deletion_jobs'), 'identity before job lookup')
  assert(at('select:health_data_deletion_jobs') < calls.indexOf(healthDeletes(calls)[0]), 'lookup before purge')
  assertEquals(healthDeletes(calls).length, HEALTH_DATA_SCOPE.length, 'every gated table deleted')
  assert(at('rpc:complete_health_deletion_job:job-1') < at('rpc:record_security_event:health.purge_succeeded'), 'settled before success recorded')
})

Deno.test('worker drain success is unchanged', async () => {
  const { handler, calls } = harness()
  const { result } = await captureLogs(() => handler(worker()))
  assertEquals(
    [result.status, await result.json()],
    [200, { ok: true, processed: [{ job_id: 'job-1', ok: true, remaining: 0 }, { job_id: 'job-2', ok: true, remaining: 0 }] }],
    'drained',
  )
  assertEquals(calls.filter((c) => c === 'rpc:claim_health_deletion_job').length, 3, 'claims until the queue is empty')
  assert(!calls.includes('userClient') && !calls.includes('rpc:rate_limit_check'), 'worker skips user auth and limits')
})
