import {
  rateLimitAllowed,
  rateLimitRefund,
} from './rate-limit.ts'

interface RpcResult {
  data: boolean | null
  error: { code?: string; message: string } | null
}

function fakeClient(result: RpcResult) {
  return {
    rpc: () => Promise.resolve(result),
  }
}

// A client double that records every RPC it receives. `rate_limit_check`
// returns the configured result; `record_security_event` (the call
// `recordSecurityEvent` makes) succeeds silently. The recorded calls are how
// the behavioral tests below decide which security event was emitted -- they
// never read rate-limit.ts or endpoint source to make that determination.
interface RpcCall {
  fn: string
  args: Record<string, unknown>
}

function recordingClient(checkResult: RpcResult) {
  const calls: RpcCall[] = []
  return {
    calls,
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        if (fn === 'rate_limit_check') return Promise.resolve(checkResult)
        return Promise.resolve({ data: null, error: null })
      },
    },
  }
}

function securityEvents(calls: RpcCall[]): RpcCall[] {
  return calls.filter((call) => call.fn === 'record_security_event')
}

// `recordSecurityEvent` writes a console mirror on every call. Silence both
// streams for the duration of a run so a passing suite prints nothing extra.
function silenceConsole<T>(run: () => Promise<T>): Promise<T> {
  const originalLog = console.log
  const originalError = console.error
  console.log = () => undefined
  console.error = () => undefined
  return run().finally(() => {
    console.log = originalLog
    console.error = originalError
  })
}

Deno.test('durable limiter returns the database decision', async () => {
  const allowed = await rateLimitAllowed(
    fakeClient({ data: true, error: null }) as never,
    'export:user:sensitive-user-id',
    1,
    1000,
    'deny',
  )
  if (!allowed) throw new Error('expected database allow decision')
})

Deno.test('durable limiter honors explicit deny policy without logging identifiers', async () => {
  const original = console.error
  const logs: unknown[][] = []
  console.error = (...args: unknown[]) => logs.push(args)
  try {
    const allowed = await rateLimitAllowed(
      fakeClient({
        data: null,
        error: {
          code: '08006',
          message: 'failed for export:user:sensitive-user-id',
        },
      }) as never,
      'export:user:sensitive-user-id',
      1,
      1000,
      'deny',
    )
    if (allowed) throw new Error('deny policy must fail closed')
    const rendered = JSON.stringify(logs)
    if (rendered.includes('sensitive-user-id')) {
      throw new Error('raw bucket identifier reached logs')
    }
    if (!rendered.includes('08006')) throw new Error('bounded error code was not logged')
  } finally {
    console.error = original
  }
})

Deno.test('durable limiter honors an explicitly selected allow policy', async () => {
  const original = console.error
  console.error = () => undefined
  try {
    const allowed = await rateLimitAllowed(
      fakeClient({ data: null, error: { code: '08006', message: 'offline' } }) as never,
      'low-risk:anonymous:raw-ip',
      1,
      1000,
      'allow',
    )
    if (!allowed) throw new Error('explicit allow policy must fail open')
  } finally {
    console.error = original
  }
})

Deno.test('refund failures never log raw bucket identifiers or upstream messages', async () => {
  const original = console.error
  const logs: unknown[][] = []
  console.error = (...args: unknown[]) => logs.push(args)
  try {
    await rateLimitRefund(
      fakeClient({
        data: null,
        error: { code: 'XX000', message: 'refund failed for raw-user-id' },
      }) as never,
      'export:user:raw-user-id',
    )
    const rendered = JSON.stringify(logs)
    if (rendered.includes('raw-user-id')) throw new Error('raw bucket reached refund logs')
    if (rendered.includes('refund failed for')) throw new Error('upstream message reached logs')
    if (!rendered.includes('XX000')) throw new Error('bounded error code was not logged')
  } finally {
    console.error = original
  }
})

// --- Event classification, asserted behaviorally ------------------------------
//
// rate-limit.ts, not the caller, decides which security event a false return
// is: an exhausted bucket is a quota throttle attributed to the subject, a
// limiter outage is `ratelimit.unavailable` with no subject. These four tests
// exercise each branch through the client double and assert on the
// `record_security_event` RPC it received. They are the regression guard for
// that classification in place of a source check.

Deno.test('an exhausted user bucket emits ratelimit.user_blocked attributed to the subject', async () => {
  const { client, calls } = recordingClient({ data: false, error: null })
  const allowed = await silenceConsole(() =>
    rateLimitAllowed(
      client as never,
      'export:user:sensitive-user-id',
      1,
      1000,
      'deny',
      'account-export',
      { type: 'user', value: 'sensitive-user-id', requestId: 'req_01ABC' },
    )
  )

  if (allowed) throw new Error('an exhausted bucket must be denied')
  const events = securityEvents(calls)
  if (events.length !== 1) {
    throw new Error(`expected exactly one security event, got ${events.length}`)
  }
  const args = events[0].args
  if (args.p_event_name !== 'ratelimit.user_blocked') {
    throw new Error(`expected ratelimit.user_blocked, got ${String(args.p_event_name)}`)
  }
  if (args.p_outcome !== 'denied') throw new Error('an exhausted bucket is a denied outcome')
  if (args.p_subject_type !== 'user') throw new Error('the throttle event must carry the user subject type')
  if (args.p_subject !== 'sensitive-user-id') {
    throw new Error('the throttle event must be attributed to the caller subject')
  }
})

Deno.test('an exhausted ip bucket emits ratelimit.ip_blocked attributed to the subject', async () => {
  const { client, calls } = recordingClient({ data: false, error: null })
  const allowed = await silenceConsole(() =>
    rateLimitAllowed(
      client as never,
      'low-risk:anonymous:203.0.113.9',
      1,
      1000,
      'allow',
      'account-export',
      { type: 'ip', value: '203.0.113.9' },
    )
  )

  if (allowed) throw new Error('an exhausted bucket must be denied even under the allow policy')
  const events = securityEvents(calls)
  if (events.length !== 1) {
    throw new Error(`expected exactly one security event, got ${events.length}`)
  }
  const args = events[0].args
  if (args.p_event_name !== 'ratelimit.ip_blocked') {
    throw new Error(`expected ratelimit.ip_blocked, got ${String(args.p_event_name)}`)
  }
  if (args.p_outcome !== 'denied') throw new Error('an exhausted bucket is a denied outcome')
  if (args.p_subject_type !== 'ip') throw new Error('the throttle event must carry the ip subject type')
  if (args.p_subject !== '203.0.113.9') {
    throw new Error('the throttle event must be attributed to the caller subject')
  }
})

Deno.test('a limiter outage under deny emits only ratelimit.unavailable with a denied outcome', async () => {
  const { client, calls } = recordingClient({
    data: null,
    error: { code: '08006', message: 'connection failed for export:user:sensitive-user-id' },
  })
  const allowed = await silenceConsole(() =>
    rateLimitAllowed(
      client as never,
      'export:user:sensitive-user-id',
      1,
      1000,
      'deny',
      'account-export',
      { type: 'user', value: 'sensitive-user-id' },
    )
  )

  if (allowed) throw new Error('the deny policy must fail closed on a limiter outage')
  const events = securityEvents(calls)
  if (events.length !== 1) {
    throw new Error(`an outage must emit exactly one event, got ${events.length}`)
  }
  const args = events[0].args
  if (args.p_event_name !== 'ratelimit.unavailable') {
    throw new Error(`an outage must not be classified as a quota throttle; got ${String(args.p_event_name)}`)
  }
  if (args.p_outcome !== 'denied') throw new Error('an outage under deny is a denied outcome')
  if (args.p_subject_type !== 'none') {
    throw new Error('an outage is a server condition and carries no subject')
  }
})

Deno.test('a limiter outage under allow emits only ratelimit.unavailable with an allowed outcome', async () => {
  const { client, calls } = recordingClient({
    data: null,
    error: { code: '08006', message: 'offline' },
  })
  const allowed = await silenceConsole(() =>
    rateLimitAllowed(
      client as never,
      'low-risk:anonymous:203.0.113.9',
      1,
      1000,
      'allow',
      'account-export',
      { type: 'ip', value: '203.0.113.9' },
    )
  )

  if (!allowed) throw new Error('the allow policy must fail open on a limiter outage')
  const events = securityEvents(calls)
  if (events.length !== 1) {
    throw new Error(`an outage must emit exactly one event, got ${events.length}`)
  }
  const args = events[0].args
  if (args.p_event_name !== 'ratelimit.unavailable') {
    throw new Error(`an outage must not be classified as a quota throttle; got ${String(args.p_event_name)}`)
  }
  if (args.p_outcome !== 'allowed') throw new Error('an outage under allow is an allowed outcome')
  if (args.p_subject_type !== 'none') {
    throw new Error('an outage is a server condition and carries no subject')
  }
})
