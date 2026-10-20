import {
  assertionOptions,
  fromBase64Url,
  isRecentlyAuthenticated,
  issueRestoreSession,
  loadRestoreConfig,
  lookupCredential,
  MAX_BODY_BYTES,
  parseAssertionRequest,
  parseRegistrationRequest,
  parseRestoreOptionsRequest,
  readClientDataChallenge,
  readJsonBody,
  readTokenClaims,
  RECENT_AUTH_WINDOW_SECONDS,
  registrationOptions,
  type RestoreIdentity,
  type RestoreUser,
  revokeUserCredentials,
  toBase64Url,
} from './android-restore-credentials.ts'

const OWNER = '21570000-0000-4000-8000-00000000000a'
const HASH = 'h'.repeat(43)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`)
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

Deno.test('configuration requires a valid RP ID and APK key hashes', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name]
  assertEquals(
    loadRestoreConfig(env({ KILO_RESTORE_RP_ID: 'Kilo.Example.test', KILO_ANDROID_APK_KEY_HASHES: ` ${HASH} , ${'g'.repeat(43)} ` })),
    { rpId: 'kilo.example.test', expectedOrigins: [`android:apk-key-hash:${HASH}`, `android:apk-key-hash:${'g'.repeat(43)}`] },
    'a valid configuration is normalized',
  )
  for (const values of [
    {},
    { KILO_RESTORE_RP_ID: 'kilo.example.test' },
    { KILO_ANDROID_APK_KEY_HASHES: HASH },
    { KILO_RESTORE_RP_ID: '', KILO_ANDROID_APK_KEY_HASHES: HASH },
    { KILO_RESTORE_RP_ID: 'localhost', KILO_ANDROID_APK_KEY_HASHES: HASH },
    { KILO_RESTORE_RP_ID: 'https://kilo.example.test', KILO_ANDROID_APK_KEY_HASHES: HASH },
    { KILO_RESTORE_RP_ID: 'kilo.example.test', KILO_ANDROID_APK_KEY_HASHES: 'not-a-hash' },
    { KILO_RESTORE_RP_ID: 'kilo.example.test', KILO_ANDROID_APK_KEY_HASHES: `${HASH},AB:CD` },
    { KILO_RESTORE_RP_ID: 'kilo.example.test', KILO_ANDROID_APK_KEY_HASHES: ' , ' },
  ]) {
    assertEquals(loadRestoreConfig(env(values as Record<string, string>)), null, `fails closed for ${JSON.stringify(values)}`)
  }
})

// ---------------------------------------------------------------------------
// Encoding and parsing
// ---------------------------------------------------------------------------

Deno.test('base64url round-trips and rejects non-base64url input', () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255])
  assertEquals([...fromBase64Url(toBase64Url(bytes))!], [...bytes], 'round trip')
  assertEquals(fromBase64Url('a+b/c='), null, 'standard base64 is refused')
})

Deno.test('the client-data challenge is read only from well-formed JSON', () => {
  const encode = (value: unknown) => toBase64Url(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)))
  const challenge = 'c'.repeat(43)
  assertEquals(readClientDataChallenge(encode({ type: 'webauthn.get', challenge })), challenge, 'reads the challenge')
  assertEquals(readClientDataChallenge(encode({ challenge: 'short' })), null, 'a malformed challenge is refused')
  assertEquals(readClientDataChallenge(encode('not json')), null, 'non-JSON is refused')
  assertEquals(readClientDataChallenge('!!'), null, 'non-base64url is refused')
})

Deno.test('credential requests are rebuilt from known fields only', () => {
  const id = 'i'.repeat(22)
  const parsed = parseAssertionRequest({
    version: 1,
    credential: {
      id,
      rawId: id,
      type: 'public-key',
      response: { clientDataJSON: 'abc', authenticatorData: 'def', signature: 'ghi', injected: 'x' },
      clientExtensionResults: { appid: true },
      extra: 'dropped',
    },
  })
  assertEquals(parsed, {
    id,
    rawId: id,
    type: 'public-key',
    response: { clientDataJSON: 'abc', authenticatorData: 'def', signature: 'ghi' },
    clientExtensionResults: {},
  }, 'unknown fields are dropped')

  const bad = [
    { version: 2, credential: { id, rawId: id, type: 'public-key', response: {} } },
    { version: 1, credential: { id, rawId: 'different'.repeat(3), type: 'public-key', response: {} } },
    { version: 1, credential: { id, rawId: id, type: 'password', response: {} } },
    { version: 1, credential: { id: 'short', rawId: 'short', type: 'public-key', response: {} } },
    { version: 1, credential: [] },
  ]
  for (const body of bad) {
    assertEquals(parseAssertionRequest(body as Record<string, unknown>), null, `refuses ${JSON.stringify(body)}`)
    assertEquals(parseRegistrationRequest(body as Record<string, unknown>), null, `refuses ${JSON.stringify(body)}`)
  }
  assertEquals(parseRestoreOptionsRequest({ version: 1, credentialId: id }), { credentialId: id }, 'options request with id')
  assertEquals(parseRestoreOptionsRequest({ version: 1 }), { credentialId: null }, 'discovery mode options request')
  assertEquals(parseRestoreOptionsRequest({ version: 1, credentialId: null }), { credentialId: null }, 'explicit null credentialId is discovery mode')
  assertEquals(parseRestoreOptionsRequest({ version: 1, credentialId: 'has spaces in it!!' }), null, 'bad credential id')
  assertEquals(parseRestoreOptionsRequest({ version: 2 }), null, 'bad version')
})

Deno.test('oversized and non-object bodies are refused', async () => {
  const request = (body: string) => new Request('https://edge.test', { method: 'POST', body })
  assertEquals(await readJsonBody(request('x'.repeat(17 * 1024))), null, 'oversized')
  assertEquals(await readJsonBody(request('[1,2]')), null, 'array')
  assertEquals(await readJsonBody(request('{')), null, 'invalid JSON')
  assertEquals(await readJsonBody(request('')), {}, 'empty body is an empty object')
})

// A JSON object of exactly `bytes` UTF-8 bytes, padded with `fill` (1 or 2 bytes).
function jsonOfBytes(bytes: number, fill: 'a' | 'é' = 'a') {
  const overhead = '{"p":""}'.length
  const width = new TextEncoder().encode(fill).length
  const units = Math.floor((bytes - overhead) / width)
  const text = `{"p":"${fill.repeat(units)}${'a'.repeat(bytes - overhead - units * width)}"}`
  assertEquals(new TextEncoder().encode(text).length, bytes, 'fixture size')
  return text
}

// A stream over `chunks` that records how many were pulled and whether it was cancelled.
function trackedStream(chunks: Uint8Array[] | (() => Uint8Array)) {
  const state = { pulled: 0, cancelled: false }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (typeof chunks === 'function') {
        controller.enqueue(chunks())
      } else if (state.pulled < chunks.length) {
        controller.enqueue(chunks[state.pulled])
      } else {
        controller.close()
        return
      }
      state.pulled++
    },
    cancel() {
      state.cancelled = true
    },
  }, { highWaterMark: 0 })
  return { body, state }
}

const streamRequest = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('https://edge.test', { method: 'POST', body, headers })

Deno.test('the body limit counts UTF-8 bytes, not string length', async () => {
  const request = (body: string) => new Request('https://edge.test', { method: 'POST', body })
  assertEquals(Object.keys(await readJsonBody(request(jsonOfBytes(MAX_BODY_BYTES))) ?? {}), ['p'], 'exact-limit ASCII is accepted')
  assertEquals(await readJsonBody(request(jsonOfBytes(MAX_BODY_BYTES + 1))), null, 'limit + 1 ASCII is refused')
  assertEquals(Object.keys(await readJsonBody(request(jsonOfBytes(MAX_BODY_BYTES, 'é'))) ?? {}), ['p'], 'exact-limit multibyte is accepted')
  const multibyte = jsonOfBytes(MAX_BODY_BYTES + 1, 'é')
  assert(multibyte.length <= MAX_BODY_BYTES, 'fixture is under the limit in string length')
  assertEquals(await readJsonBody(request(multibyte)), null, 'limit + 1 multibyte is refused')
})

Deno.test('a code point split across chunks decodes intact', async () => {
  const bytes = new TextEncoder().encode('{"p":"é€😀"}')
  const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]))
  const { body } = trackedStream(chunks)
  assertEquals(await readJsonBody(streamRequest(body)), { p: 'é€😀' }, 'byte-at-a-time stream')
})

Deno.test('an oversized stream is cancelled once the limit is passed', async () => {
  const chunk = new Uint8Array(1024).fill(0x61)
  const cases: [string, Record<string, string>][] = [
    ['absent', {}],
    ['understated', { 'content-length': '10' }],
    ['invalid', { 'content-length': 'abc' }],
  ]
  for (const [label, headers] of cases) {
    const { body, state } = trackedStream(() => chunk)
    assertEquals(await readJsonBody(streamRequest(body, headers)), null, `${label} Content-Length is refused`)
    assert(state.cancelled, `${label}: the body stream is cancelled`)
    assert(state.pulled <= MAX_BODY_BYTES / chunk.length + 2, `${label}: read stopped near the limit (pulled ${state.pulled})`)
  }
})

Deno.test('an oversized Content-Length is refused without reading the body', async () => {
  const { body, state } = trackedStream([new TextEncoder().encode('{}')])
  assertEquals(await readJsonBody(streamRequest(body, { 'content-length': String(MAX_BODY_BYTES + 1) })), null, 'refused')
  assertEquals(state.pulled, 0, 'no chunk was read')
  assert(state.cancelled, 'the body stream is cancelled')
})

Deno.test('a rejected body stream is refused', async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('connection reset'))
    },
  })
  assertEquals(await readJsonBody(streamRequest(body)), null, 'stream error')
})

Deno.test('option payloads carry exactly the v1 fields', () => {
  const config = { rpId: 'kilo.example.test', expectedOrigins: [] }
  assertEquals(Object.keys(registrationOptions(config, 'c', 'u')).sort(), [
    'challenge', 'excludeCredentials', 'operation', 'pubKeyCredParams', 'rp', 'timeout', 'user', 'version',
  ], 'registration options')
  assertEquals(Object.keys(assertionOptions(config, 'c', 'id')).sort(), [
    'allowCredentials', 'challenge', 'operation', 'rpId', 'timeout', 'version',
  ], 'assertion options')
  assertEquals(assertionOptions(config, 'c', 'id').allowCredentials, [{ type: 'public-key', id: 'id' }], 'specific credential')
  assertEquals(assertionOptions(config, 'c', null).allowCredentials, [], 'discovery mode')
})

Deno.test('database wrappers surface only bounded error codes', async () => {
  const failing = { rpc: () => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied for owner@example.test' } }) }
  assertEquals(await lookupCredential(failing as never, 'i'.repeat(22)), { ok: false, code: '42501' }, 'lookup error')
  assertEquals(await revokeUserCredentials(failing as never, OWNER), { ok: false, code: '42501' }, 'revoke error')
  const empty = { rpc: () => Promise.resolve({ data: [], error: null }) }
  assertEquals(await lookupCredential(empty as never, 'i'.repeat(22)), { ok: true, value: null }, 'unknown credential')
})

// ---------------------------------------------------------------------------
// Session issuance
// ---------------------------------------------------------------------------

function identity(user: Partial<RestoreUser> | null, overrides: Partial<RestoreIdentity> = {}) {
  const calls: string[] = []
  const fake: RestoreIdentity = {
    userFromToken: () => Promise.resolve(null),
    getUserById: (id) => {
      calls.push('getUserById')
      return Promise.resolve({
        ok: true,
        user: user === null ? null : { id, email: 'owner@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', ...user },
      })
    },
    generateMagicLink: (email) => {
      calls.push(`generateMagicLink:${email}`)
      return Promise.resolve({ ok: true, userId: OWNER, hashedToken: 'hashed' })
    },
    verifyMagicLink: () => {
      calls.push('verifyMagicLink')
      return Promise.resolve({ ok: true, session: { userId: OWNER, accessToken: 'access', refreshToken: 'refresh' } })
    },
    revokeSession: (token) => {
      calls.push(`revokeSession:${token}`)
      return Promise.resolve()
    },
    signOutEverywhere: () => Promise.resolve({ ok: true }),
    ...overrides,
  }
  return { fake, calls }
}

Deno.test('an eligible owner is issued a session using their current email', async () => {
  const { fake, calls } = identity({})
  assertEquals(await issueRestoreSession(fake, OWNER), { ok: true, accessToken: 'access', refreshToken: 'refresh' }, 'issued')
  assertEquals(calls, ['getUserById', 'generateMagicLink:owner@example.test', 'verifyMagicLink'], 'call order')
})

Deno.test('ineligible owners are refused before any link is generated', async () => {
  const now = Date.parse('2026-09-25T00:00:00Z')
  const cases: [string, Partial<RestoreUser> | null][] = [
    ['deleted user', null],
    ['banned user', { banned_until: '2026-12-01T00:00:00Z' }],
    ['unreadable ban', { banned_until: 'forever' }],
    ['unconfirmed email', { email_confirmed_at: null }],
    ['no email', { email: null }],
    ['anonymous user', { is_anonymous: true }],
    ['different user returned', { id: 'someone-else' }],
  ]
  for (const [label, user] of cases) {
    const { fake, calls } = identity(user)
    assertEquals(await issueRestoreSession(fake, OWNER, now), { ok: false, reason: 'user_ineligible' }, label)
    assert(!calls.some((c) => c.startsWith('generateMagicLink')), `${label}: no link generated`)
  }
  const { fake } = identity({ banned_until: '2026-01-01T00:00:00Z' })
  assertEquals((await issueRestoreSession(fake, OWNER, now)).ok, true, 'an expired ban no longer blocks')
})

Deno.test('issuer failures and subject mismatches return no tokens', async () => {
  const lookupDown = identity({}, { getUserById: () => Promise.resolve({ ok: false, code: 'http_500' }) })
  assertEquals(await issueRestoreSession(lookupDown.fake, OWNER), { ok: false, reason: 'issuer_error', code: 'http_500' }, 'lookup outage')

  const linkDown = identity({}, { generateMagicLink: () => Promise.resolve({ ok: false, code: 'over_email_send_rate_limit' }) })
  assertEquals(await issueRestoreSession(linkDown.fake, OWNER), {
    ok: false, reason: 'issuer_error', code: 'over_email_send_rate_limit',
  }, 'generateLink failure')

  const otherLink = identity({}, { generateMagicLink: () => Promise.resolve({ ok: true, userId: 'other', hashedToken: 'h' }) })
  assertEquals(await issueRestoreSession(otherLink.fake, OWNER), { ok: false, reason: 'subject_mismatch' }, 'link for another user')
  assert(!otherLink.calls.includes('verifyMagicLink'), 'a mismatched link is never redeemed')

  const verifyDown = identity({}, { verifyMagicLink: () => Promise.resolve({ ok: false, code: 'otp_expired' }) })
  assertEquals(await issueRestoreSession(verifyDown.fake, OWNER), { ok: false, reason: 'issuer_error', code: 'otp_expired' }, 'verify failure')

  const otherSession = identity({}, {
    verifyMagicLink: () => Promise.resolve({ ok: true, session: { userId: 'other', accessToken: 'foreign', refreshToken: 'r' } }),
  })
  assertEquals(await issueRestoreSession(otherSession.fake, OWNER), { ok: false, reason: 'subject_mismatch' }, 'session for another user')
  assert(otherSession.calls.includes('revokeSession:foreign'), 'the foreign session is revoked')

  const partial = identity({}, {
    verifyMagicLink: () => Promise.resolve({ ok: true, session: { userId: OWNER, accessToken: 'access', refreshToken: '' } }),
  })
  assertEquals(await issueRestoreSession(partial.fake, OWNER), { ok: false, reason: 'issuer_error' }, 'partial session')
})

// ---------------------------------------------------------------------------
// Token claims and recent authentication (issue #1162)
// ---------------------------------------------------------------------------

function fakeJwt(payload: unknown): string {
  const part = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
  return `${part({ alg: 'HS256' })}.${part(payload)}.signature`
}

const SESSION = '31570000-0000-4000-8000-0000000005a1'

Deno.test('token claims come from session_id and the latest amr timestamp, not iat', () => {
  const claims = readTokenClaims(fakeJwt({
    sub: OWNER,
    iat: 2_000_000_000,
    session_id: SESSION,
    amr: [{ method: 'password', timestamp: 1_700_000_000 }, { method: 'otp', timestamp: 1_700_000_500 }],
  }))
  assertEquals(claims, { sessionId: SESSION, authTime: 1_700_000_500 }, 'latest authentication, not the refresh time')

  for (const [label, payload] of [
    ['no session', { amr: [{ method: 'password', timestamp: 1_700_000_000 }] }],
    ['malformed session', { session_id: 'not-a-uuid', amr: [{ method: 'password', timestamp: 1_700_000_000 }] }],
    ['no amr', { session_id: SESSION }],
    ['amr without timestamps', { session_id: SESSION, amr: [{ method: 'password' }] }],
  ] as const) {
    assertEquals(readTokenClaims(fakeJwt(payload)), null, label)
  }
  assertEquals(readTokenClaims('not.a-jwt'), null, 'not a JWT')
})

Deno.test('recent authentication is a bounded window with small clock-skew tolerance', () => {
  const now = Date.parse('2026-09-26T12:00:00Z')
  const nowS = now / 1000
  assert(isRecentlyAuthenticated(nowS - 30, now), 'a sign-in 30 seconds ago is recent')
  assert(isRecentlyAuthenticated(nowS - RECENT_AUTH_WINDOW_SECONDS, now), 'the window edge is recent')
  assert(!isRecentlyAuthenticated(nowS - RECENT_AUTH_WINDOW_SECONDS - 1, now), 'just past the window is not')
  assert(!isRecentlyAuthenticated(nowS - 24 * 3600, now), 'yesterday is not')
  assert(isRecentlyAuthenticated(nowS + 30, now), 'small forward skew is tolerated')
  assert(!isRecentlyAuthenticated(nowS + 3600, now), 'a future authentication time is not trusted')
  assert(!isRecentlyAuthenticated(null, now), 'a missing time is not recent')
})
