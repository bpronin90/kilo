// android-restore-credentials: request handling for the v1 HTTP contract
// (issue #1157). index.ts wires real dependencies; tests inject fakes.
//
// Routes (all POST):
//   /v1/enrollment-options          authenticated
//   /v1/registration-verification   authenticated
//   /v1/restore-options             unauthenticated, rate-limited
//   /v1/restore-verification        unauthenticated, rate-limited
//   /v1/revoke                      authenticated (sign-out)
//
// Enumeration safety: restore-options answers an unknown credential exactly as
// it answers a known one, and every rejected restore-verification -- unknown
// credential, bad signature, replayed challenge, revoked key, ineligible
// account -- returns the same 401 body. Why it failed goes to the security log
// only, and the log carries a bounded reason code, never request content.

import type {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'https://esm.sh/@simplewebauthn/server@14.0.2'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { corsHeaders } from '../_shared/cors.ts'
import { extractToken } from '../_shared/auth.ts'
import { clientIp, rateLimitAllowed } from '../_shared/rate-limit.ts'
import {
  recordSecurityEvent,
  requestId,
  type SecurityEventReason,
} from '../_shared/security-event.ts'
import {
  assertionOptions,
  consumeChallenge,
  credentialEligible,
  fromBase64Url,
  issueChallenge,
  issueRestoreSession,
  isRecentlyAuthenticated,
  lookupCredential,
  parseAssertionRequest,
  parseRegistrationRequest,
  parseRestoreOptionsRequest,
  randomBase64Url,
  readClientDataChallenge,
  readJsonBody,
  recordCredentialUse,
  registerCredential,
  registrationOptions,
  RESTORE_API_VERSION,
  type RestoreConfig,
  type RestoreIdentity,
  revokeUserCredentials,
  toBase64Url,
} from '../_shared/android-restore-credentials.ts'

const SECURITY_SOURCE = 'android-restore-credentials' as const

// Unauthenticated restore routes share one IP bucket: a real restore needs two
// calls, so 20 per 10 minutes leaves room for retries and none for key trials.
const RESTORE_IP_MAX = 20
const RESTORE_IP_WINDOW_MS = 10 * 60 * 1000
// Enrollment is a once-per-install operation.
const ENROLL_IP_MAX = 30
const ENROLL_IP_WINDOW_MS = 60 * 60 * 1000
const ENROLL_USER_MAX = 10
const ENROLL_USER_WINDOW_MS = 60 * 60 * 1000

export interface RestoreHandlerDeps {
  // Service-role client scoped to the kilo schema: rate limits, security
  // events, and the kilo.restore_* functions.
  admin: SupabaseClient<any, any, any, any, any>
  identity: RestoreIdentity
  config: RestoreConfig | null
  verifyRegistration: typeof verifyRegistrationResponse
  verifyAuthentication: typeof verifyAuthenticationResponse
}

type Route =
  | 'enrollment-options'
  | 'registration-verification'
  | 'restore-options'
  | 'restore-verification'
  | 'revoke'

const ROUTE_PATTERN = /\/v1\/(enrollment-options|registration-verification|restore-options|restore-verification|revoke)\/?$/

export function createRestoreHandler(deps: RestoreHandlerDeps): (req: Request) => Promise<Response> {
  const { admin, identity, config } = deps

  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req)
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status,
        // Token-bearing responses must never be cached by anything in between.
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
      })

    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

    const match = ROUTE_PATTERN.exec(new URL(req.url).pathname)
    if (!match) return json(404, { error: 'Not Found' })
    if (req.method !== 'POST') return json(405, { error: 'Method Not Allowed' })
    const route = match[1] as Route

    const rid = requestId(req)
    const ip = clientIp(req)

    const tooMany = (retryAfter: string) => json(429, { error: 'Too Many Requests' }, { 'Retry-After': retryAfter })

    const serverError = async (reason: SecurityEventReason, code?: string) => {
      await recordSecurityEvent(admin, {
        name: 'server.error',
        source: SECURITY_SOURCE,
        outcome: 'failed',
        subjectType: 'none',
        context: { status: 503, reason, code, request_id: rid },
      })
      return json(503, { error: 'Service Unavailable' })
    }

    // Returns the verified user, or the 401 to send.
    type AuthenticatedUser = { id: string; sessionId: string | null; authTime: number | null }
    const authenticate = async (): Promise<AuthenticatedUser | Response> => {
      const token = extractToken(req)
      if (!token) {
        await recordSecurityEvent(admin, {
          name: 'auth.token_missing',
          source: SECURITY_SOURCE,
          outcome: 'denied',
          subjectType: 'ip',
          subject: ip,
          context: { status: 401, reason: 'missing_token', request_id: rid },
        })
        return json(401, { error: 'Unauthorized' })
      }
      const user = await identity.userFromToken(token)
      if (!user) {
        await recordSecurityEvent(admin, {
          name: 'auth.token_rejected',
          source: SECURITY_SOURCE,
          outcome: 'denied',
          subjectType: 'ip',
          subject: ip,
          context: { status: 401, reason: 'invalid_token', request_id: rid },
        })
        return json(401, { error: 'Unauthorized' })
      }
      return user
    }

    // -------------------------------------------------------------------
    // Sign-out revocation. Not rate-limited: it is authenticated, idempotent,
    // and a throttled sign-out would leave a backed-up key eligible.
    //
    // Two steps, in this order, close the race with a concurrent restore:
    //   1. revoke the key in the database, so any restore that re-checks the
    //      credential after its GoTrue exchange sees it revoked and discards
    //      its session;
    //   2. end every GoTrue session the user holds, which kills a session a
    //      restore minted and re-checked before step 1 committed.
    // A session can only survive by being minted after step 2, and one minted
    // after step 1 fails its re-check. Kilo's client sign-out is already
    // global, so step 2 does not change what sign-out means.
    // -------------------------------------------------------------------
    if (route === 'revoke') {
      const user = await authenticate()
      if (user instanceof Response) return user
      const token = extractToken(req)!
      const revoked = await revokeUserCredentials(admin, user.id)
      if (!revoked.ok) {
        await recordSecurityEvent(admin, {
          name: 'server.error',
          source: SECURITY_SOURCE,
          outcome: 'failed',
          subjectType: 'user',
          subject: user.id,
          context: { status: 500, reason: 'db_error', code: revoked.code, request_id: rid },
        })
        return json(500, { error: 'Revocation failed' })
      }
      const signedOut = await identity.signOutEverywhere(token)
      if (!signedOut.ok) {
        // The key is revoked; only the concurrent-restore window is still
        // open. Fail so the client retries -- the route is idempotent.
        await recordSecurityEvent(admin, {
          name: 'server.error',
          source: SECURITY_SOURCE,
          outcome: 'failed',
          subjectType: 'user',
          subject: user.id,
          context: { status: 500, reason: 'issuer_error', code: signedOut.code, request_id: rid },
        })
        return json(500, { error: 'Revocation incomplete' })
      }
      await recordSecurityEvent(admin, {
        name: 'restore.revoked',
        source: SECURITY_SOURCE,
        outcome: 'succeeded',
        subjectType: 'user',
        subject: user.id,
        context: { status: 200, count: revoked.value, request_id: rid },
      })
      return json(200, { version: RESTORE_API_VERSION, revoked: true })
    }

    // -------------------------------------------------------------------
    // Enrollment (authenticated)
    // -------------------------------------------------------------------
    if (route === 'enrollment-options' || route === 'registration-verification') {
      if (!await rateLimitAllowed(admin, `restore-enroll:ip:${ip}`, ENROLL_IP_MAX, ENROLL_IP_WINDOW_MS, 'deny', SECURITY_SOURCE, { type: 'ip', value: ip, requestId: rid })) {
        return tooMany('3600')
      }
      const user = await authenticate()
      if (user instanceof Response) return user
      if (!await rateLimitAllowed(admin, `restore-enroll:user:${user.id}`, ENROLL_USER_MAX, ENROLL_USER_WINDOW_MS, 'deny', SECURITY_SOURCE, { type: 'user', value: user.id, requestId: rid })) {
        return tooMany('3600')
      }
      if (!config) return await serverError('config_missing')

      // Recent sign-in required on BOTH enrollment routes (issue #1162). The
      // time comes from the GoTrue-signed amr claim, never from the client,
      // and the token must name its session so the key can be bound to it.
      if (!user.sessionId || !isRecentlyAuthenticated(user.authTime)) {
        await recordSecurityEvent(admin, {
          name: 'auth.token_rejected',
          source: SECURITY_SOURCE,
          outcome: 'denied',
          subjectType: 'user',
          subject: user.id,
          context: { status: 401, reason: 'invalid_token', code: 'reauth_required', request_id: rid },
        })
        return json(401, { error: 'Reauthentication required', code: 'reauth_required' })
      }
      const sessionId = user.sessionId

      const body = await readJsonBody(req)
      if (!body) return json(400, { error: 'Bad Request' })

      if (route === 'enrollment-options') {
        const challenge = randomBase64Url()
        const issued = await issueChallenge(admin, 'registration', challenge, { userId: user.id, sessionId })
        if (!issued.ok) return await serverError('db_error', issued.code)
        return json(200, registrationOptions(config, challenge, randomBase64Url()))
      }

      const registration = parseRegistrationRequest(body)
      const challenge = registration && readClientDataChallenge(registration.response.clientDataJSON)
      if (!registration || !challenge) return json(400, { error: 'Registration failed' })

      // Consume BEFORE verifying: a challenge is spent by its first attempt,
      // valid or not, so two concurrent submissions cannot both proceed.
      const consumed = await consumeChallenge(admin, 'registration', challenge, { userId: user.id, sessionId })
      if (!consumed.ok) return await serverError('db_error', consumed.code)
      if (!consumed.value) return json(400, { error: 'Registration failed' })

      let credential: { id: string; publicKey: Uint8Array; counter: number }
      try {
        const verification = await deps.verifyRegistration({
          response: registration,
          expectedChallenge: challenge,
          expectedOrigin: config.expectedOrigins,
          expectedRPID: config.rpId,
          // Restore keys are created without user interaction, so presence and
          // verification flags carry no meaning here; possession of the key,
          // proven by the signature, is the credential.
          requireUserPresence: false,
          requireUserVerification: false,
        })
        if (!verification.verified) return json(400, { error: 'Registration failed' })
        credential = verification.registrationInfo.credential
      } catch {
        return json(400, { error: 'Registration failed' })
      }
      if (credential.id !== registration.id) return json(400, { error: 'Registration failed' })

      const stored = await registerCredential(admin, user.id, challenge, sessionId, credential.id, toBase64Url(credential.publicKey), credential.counter)
      if (!stored.ok) {
        // 23505: the credential id is already registered (to anyone). It is
        // never re-bound, so this is a refusal, not an outage.
        if (stored.code === '23505') return json(409, { error: 'Registration failed' })
        return await serverError('db_error', stored.code)
      }
      // Refused: the user signed out (or account deletion began) after this
      // registration's challenge was issued, or the enrolling session ended.
      if (!stored.value) return json(409, { error: 'Registration failed' })
      await recordSecurityEvent(admin, {
        name: 'restore.enrolled',
        source: SECURITY_SOURCE,
        outcome: 'succeeded',
        subjectType: 'user',
        subject: user.id,
        context: { status: 200, request_id: rid },
      })
      return json(200, { version: RESTORE_API_VERSION, enrolled: true, credentialId: credential.id })
    }

    // -------------------------------------------------------------------
    // Restoration (unauthenticated)
    // -------------------------------------------------------------------
    if (!await rateLimitAllowed(admin, `restore:ip:${ip}`, RESTORE_IP_MAX, RESTORE_IP_WINDOW_MS, 'deny', SECURITY_SOURCE, { type: 'ip', value: ip, requestId: rid })) {
      return tooMany('600')
    }
    if (!config) return await serverError('config_missing')

    const body = await readJsonBody(req)

    if (route === 'restore-options') {
      const credentialId = body && parseRestoreOptionsRequest(body)
      if (!credentialId) return json(400, { error: 'Bad Request' })
      const challenge = randomBase64Url()
      const issued = await issueChallenge(admin, 'assertion', challenge, { credentialId })
      if (!issued.ok) return await serverError('db_error', issued.code)
      return json(200, assertionOptions(config, challenge, credentialId))
    }

    // restore-verification
    const reject = async (reason: SecurityEventReason) => {
      await recordSecurityEvent(admin, {
        name: 'restore.assertion_rejected',
        source: SECURITY_SOURCE,
        outcome: 'denied',
        subjectType: 'ip',
        subject: ip,
        context: { status: 401, reason, request_id: rid },
      })
      return json(401, { error: 'Restore failed' })
    }

    const assertion = body && parseAssertionRequest(body)
    const challenge = assertion && readClientDataChallenge(assertion.response.clientDataJSON)
    if (!assertion || !challenge) return await reject('malformed')

    const consumed = await consumeChallenge(admin, 'assertion', challenge, { credentialId: assertion.id })
    if (!consumed.ok) return await serverError('db_error', consumed.code)
    if (!consumed.value) return await reject('challenge_invalid')

    const found = await lookupCredential(admin, assertion.id)
    if (!found.ok) return await serverError('db_error', found.code)
    if (!found.value) return await reject('credential_inactive')
    const stored = found.value

    const publicKey = fromBase64Url(stored.publicKey)
    if (!publicKey) return await serverError('db_error')

    let newCounter: number
    try {
      const verification = await deps.verifyAuthentication({
        response: assertion,
        expectedChallenge: challenge,
        expectedOrigin: config.expectedOrigins,
        expectedRPID: config.rpId,
        credential: { id: assertion.id, publicKey, counter: stored.signCount },
        // FIDO rules with UV discouraged: the UP/UV flags are not required for
        // a zero-tap restore key. Signature, challenge, origin, RP ID, and
        // counter are all still enforced.
        advancedFIDOConfig: { userVerification: 'discouraged' },
      })
      if (!verification.verified) return await reject('verification_failed')
      newCounter = verification.authenticationInfo.newCounter
    } catch {
      return await reject('verification_failed')
    }

    await recordSecurityEvent(admin, {
      name: 'restore.assertion_accepted',
      source: SECURITY_SOURCE,
      outcome: 'allowed',
      subjectType: 'user',
      subject: stored.userId,
      context: { status: 200, request_id: rid },
    })

    const sessionFailed = async (reason: SecurityEventReason, status: number, code?: string) => {
      await recordSecurityEvent(admin, {
        name: 'restore.session_failed',
        source: SECURITY_SOURCE,
        outcome: 'failed',
        subjectType: 'user',
        subject: stored.userId,
        context: { status, reason, code, request_id: rid },
      })
      return status === 401 ? json(401, { error: 'Restore failed' }) : json(503, { error: 'Service Unavailable' })
    }

    // Re-checked immediately before issuance: a sign-out or account deletion
    // that revoked the key after the lookup above wins.
    const used = await recordCredentialUse(admin, assertion.id, stored.userId, newCounter)
    if (!used.ok) return await sessionFailed('db_error', 503, used.code)
    if (!used.value) return await sessionFailed('credential_inactive', 401)

    const issued = await issueRestoreSession(identity, stored.userId)
    if (!issued.ok) {
      return await sessionFailed(issued.reason, issued.reason === 'issuer_error' ? 503 : 401, issued.code)
    }

    // And re-checked after: the GoTrue exchange takes real time, and a sign-out,
    // account deletion, password change, or global sign-out during it must win
    // (#1162). The session already exists at this point, so it is revoked, not
    // merely withheld.
    const still = await credentialEligible(admin, assertion.id, stored.userId)
    if (!still.ok || !still.value) {
      await identity.revokeSession(issued.accessToken)
      return still.ok
        ? await sessionFailed('credential_inactive', 401)
        : await sessionFailed('db_error', 503, still.code)
    }

    await recordSecurityEvent(admin, {
      name: 'restore.session_issued',
      source: SECURITY_SOURCE,
      outcome: 'succeeded',
      subjectType: 'user',
      subject: stored.userId,
      context: { status: 200, request_id: rid },
    })
    return json(200, {
      version: RESTORE_API_VERSION,
      access_token: issued.accessToken,
      refresh_token: issued.refreshToken,
    })
  }
}
