import {
  recordSecurityEvent,
  requestId,
  sanitizeSecurityContext,
  SECURITY_EVENT_NAMES,
} from './security-event.ts'

interface RpcCall {
  fn: string
  args: Record<string, unknown>
}

function fakeClient(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: RpcCall[] = []
  return {
    calls,
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        return Promise.resolve(result)
      },
    },
  }
}

function captureConsole<T>(run: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const originalLog = console.log
  const originalError = console.error
  const lines: unknown[][] = []
  console.log = (...args: unknown[]) => lines.push(args)
  console.error = (...args: unknown[]) => lines.push(args)
  return run()
    .then((result) => ({ result, logged: JSON.stringify(lines) }))
    .finally(() => {
      console.log = originalLog
      console.error = originalError
    })
}

Deno.test('context sanitizer admits only allow-listed, bounded scalars', () => {
  const out = sanitizeSecurityContext({
    status: 429,
    reason: 'ip_throttle',
    code: 'PGRST301',
    request_id: 'abc-123_XYZ',
    count: 17,
    // Not part of the allow-list. Every one of these is a field a future call
    // site could plausibly add, and each would carry exactly what this log must
    // never hold.
    message: 'failed for person@example.com',
    email: 'person@example.com',
    user_id: '99999999-9999-4999-8999-999999999999',
    ip: '203.0.113.9',
    authorization: 'Bearer eyJhbGciOi.payload.signature',
  } as never)

  const keys = Object.keys(out).sort().join(',')
  if (keys !== 'code,count,reason,request_id,status') {
    throw new Error(`unexpected sanitized keys: ${keys}`)
  }
})

Deno.test('context sanitizer drops out-of-range and wrong-typed values', () => {
  const out = sanitizeSecurityContext({
    status: 99,
    reason: 'not_a_known_reason',
    code: 'a message with spaces and person@example.com',
    request_id: 'has spaces',
    count: -1,
  } as never)
  if (Object.keys(out).length !== 0) {
    throw new Error(`expected every value to be dropped, got ${JSON.stringify(out)}`)
  }
})

Deno.test('request id is read from platform headers and rejects forged shapes', () => {
  const good = requestId(new Request('https://example.test', {
    headers: { 'x-request-id': 'req_01ABCdef-123' },
  }))
  if (good !== 'req_01ABCdef-123') throw new Error('platform request id was not read')

  const forged = requestId(new Request('https://example.test', {
    headers: { 'x-request-id': 'person@example.com <script>' },
  }))
  if (forged !== undefined) throw new Error('a non-conforming request id must be dropped')
})

Deno.test('recording sends the raw subject to the database but never to a log', async () => {
  const { client, calls } = fakeClient({ data: true, error: null })
  const { logged } = await captureConsole(() => recordSecurityEvent(client as never, {
    name: 'auth.token_rejected',
    source: 'account-export',
    outcome: 'denied',
    subjectType: 'ip',
    subject: '203.0.113.9',
    context: { status: 401, reason: 'invalid_token' },
  }))

  if (calls.length !== 1 || calls[0].fn !== 'record_security_event') {
    throw new Error('the recorder did not call record_security_event')
  }
  if (calls[0].args.p_subject !== '203.0.113.9') {
    throw new Error('the database must receive the raw subject to digest it')
  }
  if (logged.includes('203.0.113.9')) {
    throw new Error('the raw subject reached a log line')
  }
  if (!logged.includes('auth.token_rejected')) {
    throw new Error('the console mirror did not carry the event name')
  }
})

Deno.test('subject type none sends no subject at all', async () => {
  const { client, calls } = fakeClient({ data: true, error: null })
  await captureConsole(() => recordSecurityEvent(client as never, {
    name: 'ratelimit.unavailable',
    source: 'health-data-delete',
    outcome: 'denied',
    subjectType: 'none',
    // Deliberately supplied and deliberately ignored.
    subject: 'should-not-be-sent',
    context: { reason: 'limiter_unavailable' },
  }))
  if (calls[0].args.p_subject !== null) {
    throw new Error('subject type none must send a null subject')
  }
})

Deno.test('a database failure is swallowed and logs only a bounded code', async () => {
  const { client } = fakeClient({
    data: null,
    error: { code: '08006', message: 'insert failed for 99999999-9999-4999-8999-999999999999' },
  })
  const { logged } = await captureConsole(() => recordSecurityEvent(client as never, {
    name: 'server.error',
    source: 'account-delete',
    outcome: 'failed',
    subjectType: 'user',
    subject: '99999999-9999-4999-8999-999999999999',
    context: { status: 500, reason: 'db_error' },
  }))
  if (logged.includes('99999999-9999-4999-8999-999999999999')) {
    throw new Error('an upstream error message leaked the subject into a log')
  }
  if (!logged.includes('08006')) throw new Error('the bounded error code was not logged')
})

Deno.test('a thrown transport error never propagates to the caller', async () => {
  const throwing = {
    rpc: () => {
      throw new Error('network down')
    },
  }
  await captureConsole(() => recordSecurityEvent(throwing as never, {
    name: 'server.error',
    source: 'account-export',
    outcome: 'failed',
    subjectType: 'none',
  }))
})

Deno.test('the catalog is a closed set of distinct names', () => {
  const unique = new Set(SECURITY_EVENT_NAMES)
  if (unique.size !== SECURITY_EVENT_NAMES.length) {
    throw new Error('the security event catalog contains a duplicate')
  }
})
