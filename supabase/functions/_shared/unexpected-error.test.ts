// Outer exception boundary shared by Kilo Edge Functions (#1559).
//
// Run: deno test --no-check --config supabase/functions/deno.json \
//        --lock=supabase/functions/deno.lock --frozen --allow-import --allow-read \
//        supabase/functions/_shared/unexpected-error.test.ts

import { PRODUCTION_WEB_ORIGIN } from './cors.ts'
import {
  errorKind,
  UNEXPECTED_ERROR_BODY,
  unexpectedErrorResponse,
  withUnexpectedErrorResponse,
} from './unexpected-error.ts'

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`)
}

function request(origin?: string): Request {
  const headers: Record<string, string> = {}
  if (origin !== undefined) headers.origin = origin
  return new Request('https://edge.test/fn', { method: 'POST', headers })
}

async function quietly<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => logs.push(JSON.stringify(args))
  try {
    return { result: await fn(), logs }
  } finally {
    console.error = original
  }
}

Deno.test('errorKind echoes only allowlisted built-in names', () => {
  assertEquals(errorKind(new TypeError('x')), 'TypeError', 'built-in')
  assertEquals(errorKind(new DOMException('x', 'AbortError')), 'AbortError', 'abort')
  const custom = new Error('x')
  custom.name = 'secret_bearer_token_value'
  assertEquals(errorKind(custom), 'other', 'identifier-shaped custom name')
  custom.name = 'token abc@example.test'
  assertEquals(errorKind(custom), 'other', 'free-text name')
  assertEquals(errorKind('string thrown'), 'other', 'non-Error')
  assertEquals(errorKind(undefined), 'other', 'undefined')
})

Deno.test('an identifier-shaped secret error name never reaches the log', async () => {
  const err = new Error('x')
  err.name = 'secret_bearer_token_value'
  const handler = withUnexpectedErrorResponse('fn', () => Promise.reject(err))
  const { result, logs } = await quietly(() => handler(request()))
  assertEquals(result.status, 500, 'status')
  assertEquals(logs, [JSON.stringify(['fn unexpected error', { kind: 'other' }])], 'classified as other')
  assertEquals(logs.join('').includes('secret_bearer_token_value'), false, 'secret absent')
})

Deno.test('unexpectedErrorResponse is a JSON 500 with the shared CORS policy and extra headers', async () => {
  const res = unexpectedErrorResponse(request(PRODUCTION_WEB_ORIGIN), { 'Cache-Control': 'no-store' })
  assertEquals(res.status, 500, 'status')
  assertEquals(await res.json(), UNEXPECTED_ERROR_BODY, 'body')
  assertEquals(res.headers.get('content-type'), 'application/json', 'content type')
  assertEquals(res.headers.get('access-control-allow-origin'), PRODUCTION_WEB_ORIGIN, 'ACAO')
  assertEquals(res.headers.get('cache-control'), 'no-store', 'extra header kept')
  assertEquals(unexpectedErrorResponse(request('https://evil.example')).headers.get('access-control-allow-origin'), null, 'no ACAO for other origins')
})

Deno.test('wrapper passes responses through untouched', async () => {
  const ok = new Response('fine', { status: 418 })
  const { result, logs } = await quietly(() => withUnexpectedErrorResponse('fn', () => Promise.resolve(ok))(request()))
  assertEquals(result === ok, true, 'same response object')
  assertEquals(logs, [], 'nothing logged')
})

Deno.test('wrapper converts a rejection into the sanitized 500 and logs only source and kind', async () => {
  const secret = 'Bearer eyJ.secret user@example.test'
  const handler = withUnexpectedErrorResponse('fn', () => Promise.reject(new TypeError(secret)))
  const { result, logs } = await quietly(() => handler(request(PRODUCTION_WEB_ORIGIN)))
  assertEquals(result.status, 500, 'status')
  assertEquals(await result.json(), UNEXPECTED_ERROR_BODY, 'body')
  assertEquals(logs, [JSON.stringify(['fn unexpected error', { kind: 'TypeError' }])], 'bounded log')
})

Deno.test('wrapper also catches a synchronous throw', async () => {
  const handler = withUnexpectedErrorResponse('fn', () => {
    throw new Error('sync')
  })
  const { result } = await quietly(() => handler(request()))
  assertEquals(result.status, 500, 'status')
})
