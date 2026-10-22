// Exact-origin CORS policy shared by every Kilo Edge Function (#1552).
//
// Run: deno test --no-check --no-lock --allow-import --allow-read \
//        supabase/functions/_shared/cors.test.ts

import { corsHeaders, isAllowedOrigin, PRODUCTION_WEB_ORIGIN } from './cors.ts'

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`)
}

function request(origin?: string): Request {
  const headers: Record<string, string> = {}
  if (origin !== undefined) headers.origin = origin
  return new Request('https://edge.test/account-export', { method: 'OPTIONS', headers })
}

const DISALLOWED = [
  'https://abc123.kilo-app.pages.dev', // Pages preview deployment
  'https://other-app.pages.dev', // sibling Pages project
  'https://kilo-app.pages.dev.evil.example', // suffix lookalike
  'https://evilkilo-app.pages.dev', // prefix lookalike
  'http://kilo-app.pages.dev', // wrong scheme
  'https://kilo-app.pages.dev:8443', // wrong port
  'https://kilo-app.pages.dev/', // trailing slash is not an origin
  'https://KILO-APP.pages.dev', // browsers serialize lowercase; no case folding
  'http://localhost:8081',
  'https://evil.example',
  'null',
  '',
  '*',
]

Deno.test('only the exact production web origin is allowed', () => {
  assertEquals(PRODUCTION_WEB_ORIGIN, 'https://kilo-app.pages.dev', 'the production origin')
  assertEquals(isAllowedOrigin(PRODUCTION_WEB_ORIGIN), true, 'production is allowed')
  assertEquals(isAllowedOrigin(null), false, 'an absent origin is not allowed')
  for (const origin of DISALLOWED) assertEquals(isAllowedOrigin(origin), false, `${origin} is not allowed`)
})

Deno.test('the allowed origin is echoed exactly, with no credentials', () => {
  const headers = corsHeaders(request(PRODUCTION_WEB_ORIGIN))
  assertEquals(headers['Access-Control-Allow-Origin'], PRODUCTION_WEB_ORIGIN, 'exact echo')
  assertEquals(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS', 'POST is allowed')
  assertEquals(headers['Access-Control-Allow-Headers'], 'authorization, x-client-info, apikey, content-type', 'client headers are allowed')
  assertEquals(headers.Vary, 'Origin', 'varies by Origin')
  assertEquals('Access-Control-Allow-Credentials' in headers, false, 'no ambient credentials')
})

Deno.test('disallowed and absent origins get no Access-Control-Allow-Origin but still Vary', () => {
  for (const origin of [...DISALLOWED, undefined]) {
    const headers = corsHeaders(request(origin))
    assertEquals('Access-Control-Allow-Origin' in headers, false, `${origin} gets no ACAO`)
    assertEquals(headers.Vary, 'Origin', `${origin} response still varies by Origin`)
  }
})

Deno.test('each call returns a fresh object', () => {
  const first = corsHeaders(request(PRODUCTION_WEB_ORIGIN))
  first.Vary = 'mutated'
  assertEquals(corsHeaders(request(PRODUCTION_WEB_ORIGIN)).Vary, 'Origin', 'callers cannot mutate the shared base')
})
