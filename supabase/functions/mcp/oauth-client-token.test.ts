import { assertEquals } from 'jsr:@std/assert@1'
import { forbiddenForClients, hasOAuthClientClaim } from './oauth-client-token.ts'

const part = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (payload: unknown) => `${part({ alg: 'ES256' })}.${part(payload)}.sig`

Deno.test('a client_id claim marks an OAuth client token', () => {
  assertEquals(hasOAuthClientClaim(jwt({ sub: 'u', client_id: 'c' })), true)
  assertEquals(hasOAuthClientClaim(jwt({ sub: 'u', client_id: '' })), true)
  assertEquals(hasOAuthClientClaim(jwt({ sub: 'u', client_id: null })), true)
})

Deno.test('first-party, service-role and undecodable tokens are not flagged', () => {
  assertEquals(hasOAuthClientClaim(jwt({ sub: 'u', role: 'authenticated' })), false)
  assertEquals(hasOAuthClientClaim(jwt({ role: 'service_role' })), false)
  assertEquals(hasOAuthClientClaim('sb_secret_abc'), false)
  assertEquals(hasOAuthClientClaim('a.b.c'), false)
  assertEquals(hasOAuthClientClaim(`${part({})}.${part([1])}.s`), false)
  assertEquals(hasOAuthClientClaim(''), false)
})

Deno.test('the refusal is a 403 with the caller CORS headers', async () => {
  const res = forbiddenForClients({ 'Access-Control-Allow-Origin': 'https://x.test' })
  assertEquals(res.status, 403)
  assertEquals(res.headers.get('access-control-allow-origin'), 'https://x.test')
  assertEquals(await res.json(), { error: 'Forbidden' })
})
