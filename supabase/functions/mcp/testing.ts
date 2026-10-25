// Test helpers: a real ES256 signer plus doubles for the user client and the
// limiter. Tokens are verified by @supabase/server against a JWKS built from the
// generated public key, so the auth tests exercise the real verification path.

import type { RpcClient } from './gate.ts'
import type { Limiter } from './limiter.ts'

export const ISSUER = 'http://127.0.0.1:54321/auth/v1'
export const USER_A = '11111111-1111-4111-8111-111111111111'
export const USER_B = '22222222-2222-4222-8222-222222222222'
export const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const b64url = (bytes: Uint8Array | string) => {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface Signer {
  jwks: { keys: Record<string, unknown>[] }
  sign(claims: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>
}

export async function makeSigner(kid = 'test-key'): Promise<Signer> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return {
    jwks: { keys: [{ ...pub, kid, alg: 'ES256', use: 'sig' }] },
    async sign(claims, header = {}) {
      const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid, ...header }))
      const body = b64url(JSON.stringify(claims))
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`${head}.${body}`))
      return `${head}.${body}.${b64url(new Uint8Array(sig))}`
    },
  }
}

export function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    sub: USER_A,
    session_id: SESSION_A,
    client_id: 'client-1',
    iat: now,
    exp: now + 3600,
    ...overrides,
  }
}

export interface FakeClient extends RpcClient {
  calls: string[]
}

// A user client whose only capability is `rpc`. Any attempt to read a table
// throws, so a test fails if a code path reaches for data it should not.
export function fakeClient(gate: unknown | (() => unknown) | Error): FakeClient {
  const calls: string[] = []
  return {
    calls,
    rpc(fn: string) {
      calls.push(fn)
      if (gate instanceof Error) return Promise.reject(gate)
      const data = typeof gate === 'function' ? (gate as () => unknown)() : gate
      return Promise.resolve({ data, error: null })
    },
    from() {
      throw new Error('table access is not permitted in this test')
    },
  } as unknown as FakeClient
}

export const GATE_OK = { status: 'ok', consent_granted_at: '2026-10-01T00:00:00Z' }

export interface FakeLimiter extends Limiter {
  buckets: string[]
}

export function fakeLimiter(deny: (bucket: string) => boolean = () => false): FakeLimiter {
  const buckets: string[] = []
  return {
    buckets,
    allow(bucket) {
      buckets.push(bucket)
      return Promise.resolve(!deny(bucket))
    },
  }
}
