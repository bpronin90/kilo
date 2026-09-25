// Android Restore Credentials: server-side building blocks (issue #1157).
//
// The android-restore-credentials Edge Function composes these. Everything
// here is dependency-injected (an RPC client, an identity provider) so it can be
// exercised without a network, a database, or GoTrue.
//
// Trust model, in one paragraph: the Android Credential Manager holds a
// WebAuthn-style key pair and backs it up with the device. Kilo stores only the
// public key. To restore, the new device signs a one-time server challenge; the
// server verifies that signature with @simplewebauthn/server, and only then
// asks GoTrue for a session for the key's owner, using the user-authorized
// magic-link exchange (generateLink + verifyOtp, both server-side). The OTP
// never leaves this process and nothing about the session is stored.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'

export const RESTORE_API_VERSION = 1
export const CHALLENGE_TTL_SECONDS = 300
export const WEBAUTHN_TIMEOUT_MS = CHALLENGE_TTL_SECONDS * 1000
// Registration and assertion JSON is a few KB. Anything larger is not a
// credential response and is refused before it is parsed.
export const MAX_BODY_BYTES = 16 * 1024

type RpcClient = Pick<SupabaseClient<any, any, any, any, any>, 'rpc'>

const BASE64URL = /^[A-Za-z0-9_-]+$/
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/
const APK_KEY_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/
const RP_ID_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RestoreConfig {
  rpId: string
  // `android:apk-key-hash:<base64url sha256 of the signing certificate>`, one
  // per accepted signing certificate (for example upload and Play signing).
  expectedOrigins: string[]
}

// Reads KILO_RESTORE_RP_ID and KILO_ANDROID_APK_KEY_HASHES. Returns null when
// either is missing, empty, or malformed, and every registration and assertion
// route then fails closed. Both are deployment secrets, never client input.
export function loadRestoreConfig(get: (name: string) => string | undefined): RestoreConfig | null {
  const rpId = (get('KILO_RESTORE_RP_ID') ?? '').trim().toLowerCase()
  if (!RP_ID_PATTERN.test(rpId)) return null

  const hashes = (get('KILO_ANDROID_APK_KEY_HASHES') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (hashes.length === 0 || !hashes.every((value) => APK_KEY_HASH_PATTERN.test(value))) return null

  return { rpId, expectedOrigins: hashes.map((hash) => `android:apk-key-hash:${hash}`) }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(value)) return null
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  try {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

export function randomBase64Url(byteLength = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

// The challenge the authenticator signed over, read from clientDataJSON. It is
// what binds a response to one server-issued challenge row; the signature over
// it is checked separately by the WebAuthn library.
export function readClientDataChallenge(clientDataJSON: string): string | null {
  const bytes = fromBase64Url(clientDataJSON)
  if (!bytes) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    const challenge = parsed?.challenge
    return typeof challenge === 'string' && CHALLENGE_PATTERN.test(challenge) ? challenge : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Request parsing
// ---------------------------------------------------------------------------

export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  let text: string
  try {
    text = await req.text()
  } catch {
    return null
  }
  if (text.length > MAX_BODY_BYTES) return null
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isCredentialId(value: unknown): value is string {
  return typeof value === 'string' && BASE64URL.test(value) && value.length >= 16 && value.length <= 1024
}

function isEncoded(value: unknown, max = 8192): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && BASE64URL.test(value)
}

function credentialEnvelope(body: Record<string, unknown>): Record<string, unknown> | null {
  if (body.version !== RESTORE_API_VERSION) return null
  const credential = body.credential
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) return null
  const c = credential as Record<string, unknown>
  if (c.type !== 'public-key' || !isCredentialId(c.id) || c.rawId !== c.id) return null
  const response = c.response
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null
  return c
}

export interface ParsedRegistration {
  id: string
  rawId: string
  type: 'public-key'
  response: { clientDataJSON: string; attestationObject: string }
  clientExtensionResults: Record<string, never>
}

// Rebuilds the response from known fields only, so nothing unexpected reaches
// the verifier.
export function parseRegistrationRequest(body: Record<string, unknown>): ParsedRegistration | null {
  const c = credentialEnvelope(body)
  if (!c) return null
  const r = c.response as Record<string, unknown>
  if (!isEncoded(r.clientDataJSON) || !isEncoded(r.attestationObject)) return null
  return {
    id: c.id as string,
    rawId: c.id as string,
    type: 'public-key',
    response: { clientDataJSON: r.clientDataJSON, attestationObject: r.attestationObject },
    clientExtensionResults: {},
  }
}

export interface ParsedAssertion {
  id: string
  rawId: string
  type: 'public-key'
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string }
  clientExtensionResults: Record<string, never>
}

export function parseAssertionRequest(body: Record<string, unknown>): ParsedAssertion | null {
  const c = credentialEnvelope(body)
  if (!c) return null
  const r = c.response as Record<string, unknown>
  if (!isEncoded(r.clientDataJSON) || !isEncoded(r.authenticatorData) || !isEncoded(r.signature, 1024)) return null
  if (r.userHandle !== undefined && r.userHandle !== null && !isEncoded(r.userHandle, 128)) return null
  return {
    id: c.id as string,
    rawId: c.id as string,
    type: 'public-key',
    response: {
      clientDataJSON: r.clientDataJSON,
      authenticatorData: r.authenticatorData,
      signature: r.signature,
      ...(typeof r.userHandle === 'string' ? { userHandle: r.userHandle } : {}),
    },
    clientExtensionResults: {},
  }
}

export function parseRestoreOptionsRequest(body: Record<string, unknown>): string | null {
  if (body.version !== RESTORE_API_VERSION || !isCredentialId(body.credentialId)) return null
  return body.credentialId
}

// ---------------------------------------------------------------------------
// v1 option payloads
// ---------------------------------------------------------------------------

// The user handle is random per enrollment and never stored: restoration looks
// a credential up by its id, so the handle carries no identity to anyone.
export function registrationOptions(config: RestoreConfig, challenge: string, userHandle: string) {
  return {
    version: RESTORE_API_VERSION,
    operation: 'registration' as const,
    challenge,
    rp: { id: config.rpId, name: 'Kilo' },
    user: { id: userHandle, name: 'Kilo account', displayName: 'Kilo account' },
    pubKeyCredParams: [
      { type: 'public-key' as const, alg: -7 },
      { type: 'public-key' as const, alg: -257 },
    ],
    timeout: WEBAUTHN_TIMEOUT_MS,
    // Android keeps one restore key per app and enrollment replaces the
    // server's previous one, so there is nothing to exclude.
    excludeCredentials: [] as never[],
  }
}

// Echoes the requested credential id whether or not it exists, so the response
// cannot be used to learn which ids are registered.
export function assertionOptions(config: RestoreConfig, challenge: string, credentialId: string) {
  return {
    version: RESTORE_API_VERSION,
    operation: 'assertion' as const,
    challenge,
    rpId: config.rpId,
    timeout: WEBAUTHN_TIMEOUT_MS,
    allowCredentials: [{ type: 'public-key' as const, id: credentialId }],
  }
}

// ---------------------------------------------------------------------------
// Database (kilo.restore_* functions, service_role only)
// ---------------------------------------------------------------------------

export type DbResult<T> = { ok: true; value: T } | { ok: false; code: string }

function dbCode(error: { code?: unknown }): string {
  return typeof error.code === 'string' ? error.code : 'unknown'
}

export async function issueChallenge(
  admin: RpcClient,
  operation: 'registration' | 'assertion',
  challenge: string,
  binding: { userId?: string; credentialId?: string },
): Promise<DbResult<true>> {
  const { error } = await admin.rpc('restore_issue_challenge', {
    p_operation: operation,
    p_challenge: challenge,
    p_user_id: binding.userId ?? null,
    p_credential_id: binding.credentialId ?? null,
    p_ttl_seconds: CHALLENGE_TTL_SECONDS,
  })
  return error ? { ok: false, code: dbCode(error) } : { ok: true, value: true }
}

export async function consumeChallenge(
  admin: RpcClient,
  operation: 'registration' | 'assertion',
  challenge: string,
  binding: { userId?: string; credentialId?: string },
): Promise<DbResult<boolean>> {
  const { data, error } = await admin.rpc('restore_consume_challenge', {
    p_operation: operation,
    p_challenge: challenge,
    p_user_id: binding.userId ?? null,
    p_credential_id: binding.credentialId ?? null,
  })
  return error ? { ok: false, code: dbCode(error) } : { ok: true, value: data === true }
}

// value is false when the database refused the registration because the
// user's credentials were revoked after its challenge was issued (a sign-out
// or account deletion that raced this enrollment), or the challenge is not
// this user's consumed registration challenge.
export async function registerCredential(
  admin: RpcClient,
  userId: string,
  challenge: string,
  credentialId: string,
  publicKey: string,
  signCount: number,
): Promise<DbResult<boolean>> {
  const { data, error } = await admin.rpc('restore_register_credential', {
    p_user_id: userId,
    p_challenge: challenge,
    p_credential_id: credentialId,
    p_public_key: publicKey,
    p_sign_count: signCount,
  })
  return error ? { ok: false, code: dbCode(error) } : { ok: true, value: typeof data === 'string' && data.length > 0 }
}

export interface StoredCredential {
  userId: string
  publicKey: string
  signCount: number
}

export async function lookupCredential(
  admin: RpcClient,
  credentialId: string,
): Promise<DbResult<StoredCredential | null>> {
  const { data, error } = await admin.rpc('restore_lookup_credential', { p_credential_id: credentialId })
  if (error) return { ok: false, code: dbCode(error) }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row.user_id !== 'string' || typeof row.public_key !== 'string') {
    return { ok: true, value: null }
  }
  return { ok: true, value: { userId: row.user_id, publicKey: row.public_key, signCount: Number(row.sign_count) || 0 } }
}

export async function recordCredentialUse(
  admin: RpcClient,
  credentialId: string,
  userId: string,
  signCount: number,
): Promise<DbResult<boolean>> {
  const { data, error } = await admin.rpc('restore_record_use', {
    p_credential_id: credentialId,
    p_user_id: userId,
    p_sign_count: signCount,
  })
  return error ? { ok: false, code: dbCode(error) } : { ok: true, value: data === true }
}

export async function revokeUserCredentials(admin: RpcClient, userId: string): Promise<DbResult<number>> {
  const { data, error } = await admin.rpc('restore_revoke_user', { p_user_id: userId })
  return error ? { ok: false, code: dbCode(error) } : { ok: true, value: Number(data) || 0 }
}

// ---------------------------------------------------------------------------
// Session issuance (the user-authorized GoTrue magic-link exchange)
// ---------------------------------------------------------------------------

export interface RestoreUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
  banned_until?: string | null
  is_anonymous?: boolean | null
}

// Implemented by the Edge Function over supabase-js; faked in tests.
export interface RestoreIdentity {
  userFromToken(token: string): Promise<{ id: string } | null>
  getUserById(id: string): Promise<{ ok: true; user: RestoreUser | null } | { ok: false; code: string }>
  // auth.admin.generateLink({ type: 'magiclink', email }). Returns the user the
  // link was generated for and the hashed token; nothing is emailed.
  generateMagicLink(email: string): Promise<{ ok: true; userId: string; hashedToken: string } | { ok: false; code: string }>
  // verifyOtp({ type: 'magiclink', token_hash }) on a non-persisting client.
  verifyMagicLink(hashedToken: string): Promise<
    | { ok: true; session: { userId: string; accessToken: string; refreshToken: string } }
    | { ok: false; code: string }
  >
  revokeSession(accessToken: string): Promise<void>
}

export type IssueResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; reason: 'user_ineligible' | 'issuer_error' | 'subject_mismatch'; code?: string }

function isBanned(bannedUntil: string | null | undefined, now: number): boolean {
  if (!bannedUntil || bannedUntil === 'none') return false
  const until = Date.parse(bannedUntil)
  // An unreadable ban is treated as a ban: this path fails closed.
  return Number.isNaN(until) || until > now
}

// Issues a GoTrue session for the verified key owner, or explains why not.
// Every check runs on the owner id the database bound to the credential; no
// client-supplied identity or email reaches this function.
export async function issueRestoreSession(
  identity: RestoreIdentity,
  ownerId: string,
  now = Date.now(),
): Promise<IssueResult> {
  const lookup = await identity.getUserById(ownerId)
  if (!lookup.ok) return { ok: false, reason: 'issuer_error', code: lookup.code }

  const user = lookup.user
  if (
    !user ||
    user.id !== ownerId ||
    user.is_anonymous === true ||
    typeof user.email !== 'string' ||
    user.email.length === 0 ||
    !user.email_confirmed_at ||
    isBanned(user.banned_until, now)
  ) {
    // Unconfirmed accounts are refused here, never confirmed as a side effect
    // of the magic-link exchange below.
    return { ok: false, reason: 'user_ineligible' }
  }

  const link = await identity.generateMagicLink(user.email)
  if (!link.ok) return { ok: false, reason: 'issuer_error', code: link.code }
  if (link.userId !== ownerId) return { ok: false, reason: 'subject_mismatch' }

  const verified = await identity.verifyMagicLink(link.hashedToken)
  if (!verified.ok) return { ok: false, reason: 'issuer_error', code: verified.code }

  const { session } = verified
  if (session.userId !== ownerId) {
    // A session for anyone else is discarded and revoked, never returned.
    await identity.revokeSession(session.accessToken)
    return { ok: false, reason: 'subject_mismatch' }
  }
  if (!session.accessToken || !session.refreshToken) return { ok: false, reason: 'issuer_error' }

  return { ok: true, accessToken: session.accessToken, refreshToken: session.refreshToken }
}
