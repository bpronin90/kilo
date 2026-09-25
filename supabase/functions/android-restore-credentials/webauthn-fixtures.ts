// Test-only authenticator: builds real WebAuthn registration and assertion
// responses with WebCrypto (P-256 / ES256), so the handler tests exercise the
// actual @simplewebauthn/server verification rather than a stub. Nothing here
// is imported by production code.

import { toBase64Url } from '../_shared/android-restore-credentials.ts'

// Minimal CBOR encoder: unsigned/negative integers, byte strings, text
// strings, and maps -- exactly what an attestation object and a COSE key need.
function head(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length]
  if (length < 0x100) return [(major << 5) | 24, length]
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff]
  return [(major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]
}

type CborValue = number | string | Uint8Array | Map<number | string, CborValue>

function cbor(value: CborValue): number[] {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value)
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value)
    return [...head(3, bytes.length), ...bytes]
  }
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value]
  const out = head(5, value.size)
  for (const [key, entry] of value) out.push(...cbor(key), ...cbor(entry))
  return out
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const flat = parts.flatMap((part) => [...part])
  return new Uint8Array(flat)
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

// WebCrypto returns ECDSA signatures as raw r||s; WebAuthn carries DER.
function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let trimmed = [...bytes.slice(start)]
    if (trimmed[0] & 0x80) trimmed = [0, ...trimmed]
    return [0x02, trimmed.length, ...trimmed]
  }
  const body = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))]
  return new Uint8Array([0x30, body.length, ...body])
}

export interface TestAuthenticator {
  credentialId: string
  keyPair: CryptoKeyPair
  cosePublicKey: Uint8Array
}

export async function createAuthenticator(): Promise<TestAuthenticator> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  const cosePublicKey = new Uint8Array(cbor(new Map<number, CborValue>([
    [1, 2], // kty: EC2
    [3, -7], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, fromB64url(jwk.x!)],
    [-3, fromB64url(jwk.y!)],
  ])))
  return {
    credentialId: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    keyPair,
    cosePublicKey,
  }
}

function clientData(type: string, challenge: string, origin: string): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false })))
}

export async function registrationResponse(
  authenticator: TestAuthenticator,
  options: { challenge: string; rpId: string; origin: string },
) {
  const credentialId = fromB64url(authenticator.credentialId)
  const authData = concat(
    await sha256(new TextEncoder().encode(options.rpId)),
    [0x40], // AT only: a restore key is created without user presence
    [0, 0, 0, 0],
    new Uint8Array(16), // AAGUID
    [credentialId.length >> 8, credentialId.length & 0xff],
    credentialId,
    authenticator.cosePublicKey,
  )
  const attestationObject = new Uint8Array(cbor(new Map<string, CborValue>([
    ['fmt', 'none'],
    ['attStmt', new Map()],
    ['authData', authData],
  ])))
  return {
    id: authenticator.credentialId,
    rawId: authenticator.credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: clientData('webauthn.create', options.challenge, options.origin),
      attestationObject: toBase64Url(attestationObject),
    },
  }
}

export async function assertionResponse(
  authenticator: TestAuthenticator,
  options: { challenge: string; rpId: string; origin: string; counter?: number; signWith?: CryptoKeyPair },
) {
  const counter = options.counter ?? 0
  const authenticatorData = concat(
    await sha256(new TextEncoder().encode(options.rpId)),
    [0x00], // no UP/UV: zero-tap restore
    [(counter >>> 24) & 0xff, (counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff],
  )
  const clientDataJSON = clientData('webauthn.get', options.challenge, options.origin)
  const signed = concat(authenticatorData, await sha256(fromB64url(clientDataJSON)))
  const raw = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    (options.signWith ?? authenticator.keyPair).privateKey,
    signed,
  ))
  return {
    id: authenticator.credentialId,
    rawId: authenticator.credentialId,
    type: 'public-key',
    response: {
      clientDataJSON,
      authenticatorData: toBase64Url(authenticatorData),
      signature: toBase64Url(derSignature(raw)),
    },
  }
}
