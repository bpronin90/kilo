// Route-level tests for the android-restore-credentials Edge Function (#1157).
//
// Responses are built by a real WebCrypto authenticator (webauthn-fixtures.ts)
// and verified by the real @simplewebauthn/server, so origin, RP ID, signature,
// and challenge failures are genuine library rejections. The database is an
// in-memory double with the same semantics as the kilo.restore_* functions
// (pgTAP covers the SQL itself); GoTrue is a fake RestoreIdentity.
//
// Run: deno test --no-check --no-lock --allow-import --allow-read \
//        supabase/functions/android-restore-credentials/handler.test.ts

import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'https://esm.sh/@simplewebauthn/server@14.0.2'
import { createRestoreHandler } from './handler.ts'
import type { RestoreConfig, RestoreIdentity, RestoreUser } from '../_shared/android-restore-credentials.ts'
import { assertionResponse, createAuthenticator, registrationResponse } from './webauthn-fixtures.ts'

const RP_ID = 'kilo.example.test'
const APK_HASH = 'A'.repeat(43)
const ORIGIN = `android:apk-key-hash:${APK_HASH}`
const CONFIG: RestoreConfig = { rpId: RP_ID, expectedOrigins: [ORIGIN] }

const OWNER = '11570000-0000-4000-8000-00000000000a'
const OTHER = '11570000-0000-4000-8000-00000000000b'
const OWNER_TOKEN = 'owner-access-jwt'
const OTHER_TOKEN = 'other-access-jwt'
const OWNER_EMAIL = 'owner@example.test'
const ISSUED_ACCESS = 'issued-access-token-value'
const ISSUED_REFRESH = 'issued-refresh-token-value'
const HASHED_TOKEN = 'hashed-magic-link-token-value'
const CLIENT_IP = '198.51.100.23'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`)
}

// ---------------------------------------------------------------------------
// In-memory kilo.restore_* double
// ---------------------------------------------------------------------------

interface Challenge {
  operation: string
  userId: string | null
  credentialId: string | null
  expiresAt: number
  consumed: boolean
}

interface Credential {
  userId: string
  publicKey: string
  signCount: number
  revoked: boolean
}

function fakeDatabase() {
  const challenges = new Map<string, Challenge>()
  const credentials = new Map<string, Credential>()
  const events: Record<string, unknown>[] = []
  const failures = new Map<string, string>()
  const hooks: { afterLookup?: () => void } = {}
  let rateLimitAllows = true

  const ok = (data: unknown) => Promise.resolve({ data, error: null })
  const rpc = (fn: string, args: Record<string, any>) => {
    const failure = failures.get(fn)
    if (failure) return Promise.resolve({ data: null, error: { code: failure, message: 'injected' } })
    switch (fn) {
      case 'rate_limit_check':
        return ok(rateLimitAllows)
      case 'record_security_event':
        events.push(args)
        return ok(true)
      case 'restore_issue_challenge':
        challenges.set(args.p_challenge, {
          operation: args.p_operation,
          userId: args.p_user_id,
          credentialId: args.p_credential_id,
          expiresAt: Date.now() + args.p_ttl_seconds * 1000,
          consumed: false,
        })
        return ok(new Date().toISOString())
      case 'restore_consume_challenge': {
        const c = challenges.get(args.p_challenge)
        const bound = c && (args.p_operation === 'registration'
          ? c.userId === args.p_user_id
          : c.credentialId === args.p_credential_id)
        if (!c || c.consumed || c.operation !== args.p_operation || c.expiresAt <= Date.now() || !bound) return ok(false)
        c.consumed = true
        return ok(true)
      }
      case 'restore_register_credential': {
        if (credentials.has(args.p_credential_id)) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } })
        }
        for (const cred of credentials.values()) if (cred.userId === args.p_user_id) cred.revoked = true
        credentials.set(args.p_credential_id, {
          userId: args.p_user_id,
          publicKey: args.p_public_key,
          signCount: args.p_sign_count,
          revoked: false,
        })
        return ok(crypto.randomUUID())
      }
      case 'restore_lookup_credential': {
        const cred = credentials.get(args.p_credential_id)
        const rows = cred && !cred.revoked
          ? [{ user_id: cred.userId, public_key: cred.publicKey, sign_count: cred.signCount }]
          : []
        hooks.afterLookup?.()
        return ok(rows)
      }
      case 'restore_record_use': {
        const cred = credentials.get(args.p_credential_id)
        if (!cred || cred.revoked || cred.userId !== args.p_user_id) return ok(false)
        cred.signCount = Math.max(cred.signCount, args.p_sign_count)
        return ok(true)
      }
      case 'restore_revoke_user': {
        let count = 0
        for (const [id, cred] of credentials) {
          if (cred.userId !== args.p_user_id) continue
          for (const c of challenges.values()) if (c.credentialId === id) c.consumed = true
          if (!cred.revoked) {
            cred.revoked = true
            count++
          }
        }
        for (const c of challenges.values()) if (c.userId === args.p_user_id) c.consumed = true
        return ok(count)
      }
      default:
        throw new Error(`unexpected rpc ${fn}`)
    }
  }

  return {
    admin: { rpc } as any,
    challenges,
    credentials,
    events,
    failures,
    hooks,
    set rateLimitAllows(value: boolean) {
      rateLimitAllows = value
    },
    eventNames: () => events.map((e) => `${e.p_event_name}${(e.p_context as any)?.reason ? `:${(e.p_context as any).reason}` : ''}`),
  }
}

// ---------------------------------------------------------------------------
// Fake GoTrue
// ---------------------------------------------------------------------------

function fakeIdentity(overrides: Partial<RestoreIdentity> = {}, user: Partial<RestoreUser> = {}) {
  const revokedSessions: string[] = []
  const identity: RestoreIdentity = {
    userFromToken: (token) =>
      Promise.resolve(token === OWNER_TOKEN ? { id: OWNER } : token === OTHER_TOKEN ? { id: OTHER } : null),
    getUserById: (id) =>
      Promise.resolve({
        ok: true,
        user: id === OWNER
          ? { id: OWNER, email: OWNER_EMAIL, email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: null, ...user }
          : null,
      }),
    generateMagicLink: () => Promise.resolve({ ok: true, userId: OWNER, hashedToken: HASHED_TOKEN }),
    verifyMagicLink: () =>
      Promise.resolve({ ok: true, session: { userId: OWNER, accessToken: ISSUED_ACCESS, refreshToken: ISSUED_REFRESH } }),
    revokeSession: (token) => {
      revokedSessions.push(token)
      return Promise.resolve()
    },
    ...overrides,
  }
  return { identity, revokedSessions }
}

function setup(options: { identity?: RestoreIdentity; config?: RestoreConfig | null } = {}) {
  const db = fakeDatabase()
  const fake = fakeIdentity()
  const handler = createRestoreHandler({
    admin: db.admin,
    identity: options.identity ?? fake.identity,
    config: options.config === undefined ? CONFIG : options.config,
    verifyRegistration: verifyRegistrationResponse,
    verifyAuthentication: verifyAuthenticationResponse,
  })
  const call = async (route: string, body: unknown, token?: string) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP }
    if (token) headers.authorization = `Bearer ${token}`
    const res = await handler(new Request(`https://edge.test/android-restore-credentials/v1/${route}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }))
    return { status: res.status, body: await res.json(), headers: res.headers }
  }
  return { db, call, revokedSessions: fake.revokedSessions }
}

async function enroll(ctx: ReturnType<typeof setup>, token = OWNER_TOKEN) {
  const authenticator = await createAuthenticator()
  const options = await ctx.call('enrollment-options', {}, token)
  assertEquals(options.status, 200, 'enrollment options are issued')
  const credential = await registrationResponse(authenticator, { challenge: options.body.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('registration-verification', { version: 1, credential }, token)
  return { authenticator, result, credential }
}

async function restoreOptions(ctx: ReturnType<typeof setup>, credentialId: string) {
  const options = await ctx.call('restore-options', { version: 1, credentialId })
  assertEquals(options.status, 200, 'restore options are issued')
  return options.body
}

const REJECTED = { status: 401, body: { error: 'Restore failed' } }

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

Deno.test('enrollment registers a verified credential and returns the v1 shape', async () => {
  const ctx = setup()
  const options = await ctx.call('enrollment-options', {}, OWNER_TOKEN)
  assertEquals(Object.keys(options.body).sort(), [
    'challenge', 'excludeCredentials', 'operation', 'pubKeyCredParams', 'rp', 'timeout', 'user', 'version',
  ], 'enrollment options carry exactly the v1 fields')
  assertEquals(options.body.rp.id, RP_ID, 'the RP ID comes from configuration')
  assert(options.body.user.id !== OWNER, 'the user handle is not the raw user id')

  const authenticator = await createAuthenticator()
  const credential = await registrationResponse(authenticator, { challenge: options.body.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('registration-verification', { version: 1, credential }, OWNER_TOKEN)
  assertEquals(result, {
    status: 200,
    body: { version: 1, enrolled: true, credentialId: authenticator.credentialId },
    headers: result.headers,
  }, 'registration succeeds')
  assert(ctx.db.credentials.get(authenticator.credentialId)?.userId === OWNER, 'the credential is bound to the token user')
  assert(ctx.db.eventNames().includes('restore.enrolled'), 'enrollment is audited')
})

Deno.test('a verified assertion returns only a GoTrue session', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const options = await restoreOptions(ctx, authenticator.credentialId)
  const credential = await assertionResponse(authenticator, { challenge: options.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('restore-verification', { version: 1, credential })
  assertEquals(result.status, 200, 'restore succeeds')
  assertEquals(result.body, { version: 1, access_token: ISSUED_ACCESS, refresh_token: ISSUED_REFRESH }, 'only tokens are returned')
  assertEquals(result.headers.get('cache-control'), 'no-store', 'the token response is not cacheable')
  const names = ctx.db.eventNames()
  assert(names.includes('restore.assertion_accepted') && names.includes('restore.session_issued'), `events: ${names}`)
})

// ---------------------------------------------------------------------------
// Adversarial fixtures
// ---------------------------------------------------------------------------

Deno.test('a replayed challenge is rejected', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const options = await restoreOptions(ctx, authenticator.credentialId)
  const credential = await assertionResponse(authenticator, { challenge: options.challenge, rpId: RP_ID, origin: ORIGIN })
  assertEquals((await ctx.call('restore-verification', { version: 1, credential })).status, 200, 'first use succeeds')
  const replay = await ctx.call('restore-verification', { version: 1, credential })
  assertEquals({ status: replay.status, body: replay.body }, REJECTED, 'the replay is rejected')
  assert(ctx.db.eventNames().includes('restore.assertion_rejected:challenge_invalid'), 'the replay is audited')
})

Deno.test('an expired challenge is rejected', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const options = await restoreOptions(ctx, authenticator.credentialId)
  ctx.db.challenges.get(options.challenge)!.expiresAt = Date.now() - 1
  const credential = await assertionResponse(authenticator, { challenge: options.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('restore-verification', { version: 1, credential })
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'the expired challenge is rejected')
})

Deno.test('a wrong Android origin is rejected by the WebAuthn library', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const options = await restoreOptions(ctx, authenticator.credentialId)
  const credential = await assertionResponse(authenticator, {
    challenge: options.challenge, rpId: RP_ID, origin: `android:apk-key-hash:${'B'.repeat(43)}`,
  })
  const result = await ctx.call('restore-verification', { version: 1, credential })
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'the foreign-signed app is rejected')
  assert(ctx.db.eventNames().includes('restore.assertion_rejected:verification_failed'), 'audited as a verification failure')
})

Deno.test('a wrong RP ID is rejected', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const options = await restoreOptions(ctx, authenticator.credentialId)
  const credential = await assertionResponse(authenticator, { challenge: options.challenge, rpId: 'evil.example.test', origin: ORIGIN })
  const result = await ctx.call('restore-verification', { version: 1, credential })
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'the wrong RP ID is rejected')
})

Deno.test('a registration from the wrong origin is refused', async () => {
  const ctx = setup()
  const authenticator = await createAuthenticator()
  const options = await ctx.call('enrollment-options', {}, OWNER_TOKEN)
  const credential = await registrationResponse(authenticator, {
    challenge: options.body.challenge, rpId: RP_ID, origin: 'https://evil.example.test',
  })
  const result = await ctx.call('registration-verification', { version: 1, credential }, OWNER_TOKEN)
  assertEquals(result.status, 400, 'the registration is refused')
  assert(!ctx.db.credentials.has(authenticator.credentialId), 'nothing is stored')
})

Deno.test('a bad signature and an unknown credential are indistinguishable', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const impostor = await createAuthenticator()

  const options = await restoreOptions(ctx, authenticator.credentialId)
  const badSignature = await assertionResponse(authenticator, {
    challenge: options.challenge, rpId: RP_ID, origin: ORIGIN, signWith: impostor.keyPair,
  })
  const bad = await ctx.call('restore-verification', { version: 1, credential: badSignature })

  const unknownOptions = await restoreOptions(ctx, impostor.credentialId)
  assertEquals(Object.keys(unknownOptions).sort(), Object.keys(options).sort(), 'unknown credentials get the same options shape')
  assertEquals(unknownOptions.allowCredentials, [{ type: 'public-key', id: impostor.credentialId }], 'the requested id is echoed')
  const unknownAssertion = await assertionResponse(impostor, { challenge: unknownOptions.challenge, rpId: RP_ID, origin: ORIGIN })
  const unknown = await ctx.call('restore-verification', { version: 1, credential: unknownAssertion })

  assertEquals({ status: bad.status, body: bad.body }, REJECTED, 'a bad signature is rejected')
  assertEquals({ status: unknown.status, body: unknown.body }, { status: bad.status, body: bad.body },
    'an unknown credential receives the identical failure')
  const names = ctx.db.eventNames()
  assert(names.includes('restore.assertion_rejected:verification_failed'), `events: ${names}`)
  assert(names.includes('restore.assertion_rejected:credential_inactive'), `events: ${names}`)
})

Deno.test('a revoked key is rejected and revocation is server-side', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const pending = await restoreOptions(ctx, authenticator.credentialId)

  const revoked = await ctx.call('revoke', {}, OWNER_TOKEN)
  assertEquals({ status: revoked.status, body: revoked.body }, { status: 200, body: { version: 1, revoked: true } }, 'sign-out revokes')

  const stale = await assertionResponse(authenticator, { challenge: pending.challenge, rpId: RP_ID, origin: ORIGIN })
  assertEquals((await ctx.call('restore-verification', { version: 1, credential: stale })).status, 401,
    'a challenge issued before revocation is burned')

  const fresh = await restoreOptions(ctx, authenticator.credentialId)
  const credential = await assertionResponse(authenticator, { challenge: fresh.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('restore-verification', { version: 1, credential })
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'the revoked key cannot restore')
})

Deno.test('revocation that races the lookup wins', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const options = await restoreOptions(ctx, authenticator.credentialId)
  ctx.db.hooks.afterLookup = () => {
    ctx.db.credentials.get(authenticator.credentialId)!.revoked = true
  }
  const credential = await assertionResponse(authenticator, { challenge: options.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('restore-verification', { version: 1, credential })
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'no session after a concurrent revocation')
  assert(ctx.db.eventNames().includes('restore.session_failed:credential_inactive'), 'audited')
})

async function restoreWith(identity: RestoreIdentity) {
  const ctx = setup({ identity })
  const { authenticator } = await enroll(ctx)
  const options = await restoreOptions(ctx, authenticator.credentialId)
  const credential = await assertionResponse(authenticator, { challenge: options.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('restore-verification', { version: 1, credential })
  return { ctx, result }
}

Deno.test('a banned user gets no session', async () => {
  const { identity } = fakeIdentity({}, { banned_until: '2999-01-01T00:00:00Z' })
  const { ctx, result } = await restoreWith(identity)
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'banned users are refused')
  assert(ctx.db.eventNames().includes('restore.session_failed:user_ineligible'), 'audited')
})

Deno.test('an unconfirmed email gets no session and is not confirmed', async () => {
  let linkRequested = false
  const { identity } = fakeIdentity({
    generateMagicLink: () => {
      linkRequested = true
      return Promise.resolve({ ok: false, code: 'unexpected' })
    },
  }, { email_confirmed_at: null })
  const { result } = await restoreWith(identity)
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'unconfirmed accounts are refused')
  assert(!linkRequested, 'no magic link is generated, so nothing can confirm the email')
})

Deno.test('a co-tenant or non-enrolled user id is never issued a session', async () => {
  const { identity } = fakeIdentity({
    generateMagicLink: () => Promise.resolve({ ok: true, userId: OTHER, hashedToken: HASHED_TOKEN }),
  })
  const { ctx, result } = await restoreWith(identity)
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'a link for another user is refused')
  assert(ctx.db.eventNames().includes('restore.session_failed:subject_mismatch'), 'audited')
})

Deno.test('a session for the wrong subject is discarded and revoked', async () => {
  const { identity, revokedSessions } = fakeIdentity({
    verifyMagicLink: () =>
      Promise.resolve({ ok: true, session: { userId: OTHER, accessToken: 'foreign-access', refreshToken: 'foreign-refresh' } }),
  })
  const { result } = await restoreWith(identity)
  assertEquals({ status: result.status, body: result.body }, REJECTED, 'the mismatched session is not returned')
  assertEquals(revokedSessions, ['foreign-access'], 'the mismatched session is revoked')
})

Deno.test('a generateLink failure returns no tokens', async () => {
  const { identity } = fakeIdentity({ generateMagicLink: () => Promise.resolve({ ok: false, code: 'http_500' }) })
  const { ctx, result } = await restoreWith(identity)
  assertEquals(result.status, 503, 'an issuer outage is retryable')
  assert(!('access_token' in result.body), 'no token in the body')
  assert(ctx.db.eventNames().includes('restore.session_failed:issuer_error'), 'audited')
})

Deno.test('a partial enrollment write stores nothing and burns the challenge', async () => {
  const ctx = setup()
  ctx.db.failures.set('restore_register_credential', 'XX000')
  const authenticator = await createAuthenticator()
  const options = await ctx.call('enrollment-options', {}, OWNER_TOKEN)
  const credential = await registrationResponse(authenticator, { challenge: options.body.challenge, rpId: RP_ID, origin: ORIGIN })
  const failed = await ctx.call('registration-verification', { version: 1, credential }, OWNER_TOKEN)
  assertEquals(failed.status, 503, 'the storage failure is reported')
  assert(!ctx.db.eventNames().includes('restore.enrolled'), 'no enrollment is audited')

  ctx.db.failures.delete('restore_register_credential')
  const retry = await ctx.call('registration-verification', { version: 1, credential }, OWNER_TOKEN)
  assertEquals(retry.status, 400, 'the spent challenge cannot be reused')
  assert(!ctx.db.credentials.has(authenticator.credentialId), 'nothing was stored')
})

Deno.test('a registration challenge cannot be used by another user', async () => {
  const ctx = setup()
  const authenticator = await createAuthenticator()
  const options = await ctx.call('enrollment-options', {}, OWNER_TOKEN)
  const credential = await registrationResponse(authenticator, { challenge: options.body.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('registration-verification', { version: 1, credential }, OTHER_TOKEN)
  assertEquals(result.status, 400, 'the cross-user registration is refused')
  assert(!ctx.db.credentials.has(authenticator.credentialId), 'nothing is stored')
})

Deno.test('a credential id already registered to someone is never re-bound', async () => {
  const ctx = setup()
  const { authenticator } = await enroll(ctx)
  const options = await ctx.call('enrollment-options', {}, OTHER_TOKEN)
  const credential = await registrationResponse(authenticator, { challenge: options.body.challenge, rpId: RP_ID, origin: ORIGIN })
  const result = await ctx.call('registration-verification', { version: 1, credential }, OTHER_TOKEN)
  assertEquals(result.status, 409, 'the duplicate is refused')
  assertEquals(ctx.db.credentials.get(authenticator.credentialId)?.userId, OWNER, 'ownership is unchanged')
})

Deno.test('malformed restore requests are rejected like any other failure', async () => {
  const ctx = setup()
  for (const body of [{}, { version: 2, credential: {} }, { version: 1, credential: { id: 'short', type: 'public-key' } }]) {
    const result = await ctx.call('restore-verification', body)
    assertEquals({ status: result.status, body: result.body }, REJECTED, `malformed body ${JSON.stringify(body)}`)
  }
})

// ---------------------------------------------------------------------------
// Configuration, authentication, throttling, routing
// ---------------------------------------------------------------------------

Deno.test('missing configuration fails closed but sign-out revocation still works', async () => {
  const ctx = setup({ config: null })
  assertEquals((await ctx.call('restore-options', { version: 1, credentialId: 'A'.repeat(22) })).status, 503, 'restore is closed')
  assertEquals((await ctx.call('enrollment-options', {}, OWNER_TOKEN)).status, 503, 'enrollment is closed')
  assertEquals((await ctx.call('revoke', {}, OWNER_TOKEN)).status, 200, 'revocation does not depend on WebAuthn config')
  assert(ctx.db.eventNames().includes('server.error:config_missing'), 'the misconfiguration is audited')
})

Deno.test('authenticated routes require a valid bearer token', async () => {
  const ctx = setup()
  assertEquals((await ctx.call('enrollment-options', {})).status, 401, 'missing token')
  assertEquals((await ctx.call('revoke', {}, 'forged-token')).status, 401, 'invalid token')
  const names = ctx.db.eventNames()
  assert(names.includes('auth.token_missing:missing_token') && names.includes('auth.token_rejected:invalid_token'), `events: ${names}`)
})

Deno.test('unauthenticated restore routes are throttled', async () => {
  const ctx = setup()
  ctx.db.rateLimitAllows = false
  const result = await ctx.call('restore-options', { version: 1, credentialId: 'A'.repeat(22) })
  assertEquals(result.status, 429, 'throttled')
  assertEquals(ctx.db.challenges.size, 0, 'no challenge is issued')
})

Deno.test('unknown routes and methods are refused', async () => {
  const ctx = setup()
  assertEquals((await ctx.call('not-a-route', {})).status, 404, 'unknown route')
})

// ---------------------------------------------------------------------------
// Log redaction
// ---------------------------------------------------------------------------

Deno.test('no credential, OTP, token, email, or raw identifier reaches the logs or event context', async () => {
  const originalLog = console.log
  const originalError = console.error
  const lines: unknown[][] = []
  console.log = (...args: unknown[]) => lines.push(args)
  console.error = (...args: unknown[]) => lines.push(args)
  let secrets: string[] = []
  let contexts = ''
  try {
    const ctx = setup()
    const { authenticator, credential: registration } = await enroll(ctx)
    const options = await restoreOptions(ctx, authenticator.credentialId)
    const credential = await assertionResponse(authenticator, { challenge: options.challenge, rpId: RP_ID, origin: ORIGIN })
    await ctx.call('restore-verification', { version: 1, credential })
    await ctx.call('restore-verification', { version: 1, credential })
    await ctx.call('revoke', {}, OWNER_TOKEN)
    contexts = JSON.stringify(ctx.db.events.map((e) => e.p_context))
    secrets = [
      ISSUED_ACCESS, ISSUED_REFRESH, HASHED_TOKEN, OWNER_EMAIL, OWNER, OWNER_TOKEN, CLIENT_IP,
      authenticator.credentialId, options.challenge,
      credential.response.signature, credential.response.clientDataJSON, credential.response.authenticatorData,
      registration.response.attestationObject,
    ]
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  const logged = JSON.stringify(lines)
  assert(lines.length > 0, 'the console mirror ran')
  for (const secret of secrets) {
    assert(!logged.includes(secret), `the console output contains a secret: ${secret.slice(0, 12)}...`)
    assert(!contexts.includes(secret), `an event context contains a secret: ${secret.slice(0, 12)}...`)
  }
})
