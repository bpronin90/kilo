// Helpers for the isolated MCP integration matrix (issue #1629). Synthetic data
// and a disposable local stack only. Nothing here prints or stores a token, an
// authorization code, an authorization id or a response body.

import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client'

const need = (name: string): string => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`missing ${name}; run via scripts/verify-mcp-mvp.mjs`)
  return value
}

export const API = need('API_URL')
// Local-only boundary: refuse to run against anything but the disposable stack that
// stack.sh creates, whatever the ambient environment holds.
if (API !== 'http://127.0.0.1:56321') throw new Error('refusing to run: API_URL is not the disposable local stack')
export const ANON_KEY = need('ANON_KEY')
export const SERVICE_ROLE_KEY = need('SERVICE_ROLE_KEY')
export const JWT_SECRET = need('JWT_SECRET')
export const SIGNING_KEYS_PATH = need('KILO_MCP_SIGNING_KEYS')
export const DB_CONTAINER = 'supabase_db_kilo_mcp_staging'
export const MCP_URL = `${API}/functions/v1/mcp`
export const AUTH = `${API}/auth/v1`
export const CONSENT_CATALOG_REVISION = 1

// Every credential or protocol artifact the run handles, so the log scan (case G1) can
// look for the real values instead of guessing at their shape.
export const secrets = new Set<string>()
const remember = (...values: unknown[]) => { for (const v of values) if (typeof v === 'string' && v.length >= 8) secrets.add(v) }

export interface Session {
  userId: string
  email: string
  password: string
  token: string
  refresh: string
}

const hex = () => crypto.randomUUID().replaceAll('-', '').slice(0, 10)

async function json(res: Response): Promise<any> {
  const text = await res.text()
  try { return text ? JSON.parse(text) : null } catch { return null }
}

const authHeaders = (token: string, extra: Record<string, string> = {}) => ({
  apikey: ANON_KEY,
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  ...extra,
})

// ---- users and fixtures (first-party / service role; never used by the function under test) ----

export async function createUser(label: string): Promise<Session> {
  const email = `mcp-${label}-${hex()}@example.test`
  const password = `Pw-${hex()}-${hex()}`
  const created = await fetch(`${AUTH}/admin/users`, {
    method: 'POST',
    headers: authHeaders(SERVICE_ROLE_KEY),
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const user = await json(created)
  if (!created.ok) throw new Error(`createUser ${created.status}`)
  const login = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await json(login)
  if (!login.ok) throw new Error(`login ${login.status}`)
  remember(user.id, password, body.access_token, body.refresh_token)
  return { userId: user.id, email, password, token: body.access_token, refresh: body.refresh_token }
}

export const deleteUser = (userId: string) =>
  fetch(`${AUTH}/admin/users/${userId}`, { method: 'DELETE', headers: authHeaders(SERVICE_ROLE_KEY) })

export async function rest(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: authHeaders(token, { 'accept-profile': 'kilo', 'content-profile': 'kilo', prefer: 'return=minimal', ...headers }),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await json(res) }
}

export const rpc = (token: string, fn: string, args: Record<string, unknown> = {}) => rest(token, 'POST', `rpc/${fn}`, args, { prefer: '' })

export async function setGateMode(mode: 'legacy' | 'consent_required') {
  const r = await rest(SERVICE_ROLE_KEY, 'PATCH', 'health_sync_config?id=eq.true', { mode })
  if (r.status >= 300) throw new Error(`setGateMode ${r.status}`)
}

export async function grantConsent(s: Session) {
  const r = await rpc(s.token, 'consent_grant', { p_catalog_revision: CONSENT_CATALOG_REVISION, p_surface: 'cloud_sync_enablement' })
  if (r.status >= 300) throw new Error(`consent_grant ${r.status}`)
}

export const decide = async (user: Session, id: string, action: 'approve' | 'deny') => {
  const res = await fetch(`${AUTH}/oauth/authorizations/${id}/consent`, { method: 'POST', headers: authHeaders(user.token), body: JSON.stringify({ action }) })
  return { status: res.status, body: await json(res) }
}

export const withdrawConsent = (s: Session) => rpc(s.token, 'consent_withdraw')

export interface Fixtures { weights: number; datedWeights: number; notes: number; marker: string }

// Weights: `dated` rows with logged_at one hour apart, plus a few unknown-date rows.
// Notes: `plain` short notes, one long note (raw text above the 4000 char bound),
// one tombstone. `marker` appears in every note so cross-user leaks are detectable.
export async function seedUser(s: Session, marker: string, dated = 120, undated = 5, plain = 30): Promise<Fixtures> {
  const base = Date.parse('2026-01-01T00:00:00Z')
  const weights: Record<string, unknown>[] = []
  for (let i = 0; i < dated; i++) {
    const at = new Date(base + i * 3_600_000)
    weights.push({ user_id: s.userId, id: `w-${marker}-${String(i).padStart(4, '0')}`, entry_type: 'weight', date: at.toISOString().slice(0, 10), logged_at: at.toISOString(), weight_value: 150 + i * 0.1 })
  }
  for (let i = 0; i < undated; i++) {
    weights.push({ user_id: s.userId, id: `w-${marker}-u${i}`, entry_type: 'weight', date: i % 2 ? '2026-02-01' : null, logged_at: null, weight_value: 160 + i })
  }
  const wr = await rest(s.token, 'POST', 'weight_entries', weights)
  if (wr.status >= 300) throw new Error(`seed weights ${wr.status}`)
  const notes: Record<string, unknown>[] = []
  for (let i = 0; i < plain; i++) {
    notes.push({ user_id: s.userId, id: `n-${marker}-${String(i).padStart(3, '0')}`, title: `${marker} note ${i}`, raw_text: `${marker} push day ${i}\nbench 5x5`, is_current: i === 0, saved_at: i === 1 ? '2026-01-02T10:00:00+00:00' : null, deleted_at: null })
  }
  notes.push({ user_id: s.userId, id: `n-${marker}-long`, title: `${marker} long`, raw_text: `${marker} ` + 'x'.repeat(6000), is_current: false, saved_at: null, deleted_at: null })
  notes.push({ user_id: s.userId, id: `n-${marker}-gone`, title: `${marker} deleted`, raw_text: `${marker} tombstoned`, is_current: false, saved_at: null, deleted_at: new Date().toISOString() })
  const nr = await rest(s.token, 'POST', 'workout_notes', notes)
  if (nr.status >= 300) throw new Error(`seed notes ${nr.status}`)
  return { weights: dated + undated, datedWeights: dated, notes: plain + 1, marker }
}

// ---- DB fault injection through the disposable container (never any other target) ----

function dbExec(args: string[], user = 'postgres') {
  // The container name is a constant; this is the only place a command is aimed at it.
  return new Deno.Command('docker', { args: ['exec', DB_CONTAINER, 'psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args], stdout: 'piped', stderr: 'piped' })
}

export async function sql(statement: string, user = 'postgres'): Promise<string> {
  const out = await dbExec(['-tAc', statement], user).output()
  if (!out.success) throw new Error(`sql failed: ${new TextDecoder().decode(out.stderr).slice(0, 200)}`)
  return new TextDecoder().decode(out.stdout).trim()
}

// Holds an exclusive lock on kilo.weight_entries for `seconds` (slow-database case).
export function holdWeightLock(seconds: number) {
  return dbExec(['-c', `begin; lock table kilo.weight_entries in access exclusive mode; select pg_sleep(${Number(seconds)}); commit;`]).spawn()
}

// Per-function execution counters, so a case can prove that a rejected request ran
// no data RPC at all (not merely that the response looked safe).
export async function enableCallTracking() {
  // Server settings need the superuser role of the disposable database.
  await sql("alter system set track_functions = 'all'", 'supabase_admin')
  await sql('select pg_reload_conf()', 'supabase_admin')
}

export async function dataRpcCalls(): Promise<number> {
  await new Promise((r) => setTimeout(r, 1200)) // stats are flushed asynchronously
  const n = await sql("select coalesce(sum(calls), 0) from pg_stat_user_functions where funcname in ('mcp_weight_entries_page', 'mcp_workout_notes_page')")
  return Number(n)
}

// ---- tokens: minted with the stack's own staging key for negative cases ----

const b64u = (data: Uint8Array | string) =>
  btoa(String.fromCharCode(...(typeof data === 'string' ? new TextEncoder().encode(data) : data))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function forge(claims: Record<string, unknown>, how: 'staging-key' | 'hs256' = 'staging-key'): Promise<string> {
  if (how === 'hs256') {
    const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body = b64u(JSON.stringify(claims))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return `${head}.${body}.${b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`))))}`
  }
  const jwk = JSON.parse(await Deno.readTextFile(SIGNING_KEYS_PATH))[0]
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: jwk.kid }))
  const body = b64u(JSON.stringify(claims))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64u(new Uint8Array(sig))}`
}

export function decodeClaims(token: string): Record<string, any> {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)))
}

// ---- raw protocol ----

// The gateway appends the caller's real address and the function trusts the last
// X-Forwarded-For hop, so every request in a run shares one pre-auth bucket
// (120 / 60 s). The matrix budgets for that instead of spoofing addresses.

export interface Rpc { status: number; headers: Headers; body: any }

export async function raw(token: string | null, message: unknown, opts: { method?: string; body?: string } = {}): Promise<Rpc> {
  const res = await fetch(MCP_URL, {
    method: opts.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.method === 'GET' ? undefined : (opts.body ?? JSON.stringify(message)),
  })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch {
    const data = text.split('\n').find((l) => l.startsWith('data:'))
    try { body = data ? JSON.parse(data.slice(5)) : text.slice(0, 80) } catch { body = text.slice(0, 80) }
  }
  return { status: res.status, headers: res.headers, body }
}

export const call = (token: string | null, name: string, args: Record<string, unknown> = {}) =>
  raw(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })

// The tool payload (structuredContent) of a tools/call, or null.
export const payload = (r: Rpc): any => {
  const p = r.body?.result?.structuredContent ?? null
  remember(p?.next_cursor)
  return p
}
export const isToolError = (r: Rpc, code: string) => r.status === 200 && r.body?.result?.isError === true && payload(r)?.code === code

// ---- OAuth against Supabase Auth, driven by the real MCP client library ----

// Plays the browser: opens the Auth authorize URL, lands on the Kilo consent route
// (/oauth/consent?authorization_id=...), then approves or denies as the signed-in user
// through the same Auth endpoints the Kilo page uses. Returns the redirect Auth sends
// back to the client (code or error) without following it.
export const lastAuthorizationId = { value: '' }
export async function browser(user: Session, authorizationUrl: URL, action: 'approve' | 'deny' = 'approve'): Promise<URL> {
  const hop = await fetch(authorizationUrl, { redirect: 'manual' })
  const location = hop.headers.get('location')
  if (hop.status !== 302 && hop.status !== 303) throw new Error(`authorize ${hop.status}`)
  const landing = new URL(location!)
  if (landing.pathname !== '/oauth/consent') throw new Error('authorize did not land on /oauth/consent')
  const id = landing.searchParams.get('authorization_id')
  if (!id) throw new Error('no authorization_id')
  remember(id)
  lastAuthorizationId.value = id
  const details = await fetch(`${AUTH}/oauth/authorizations/${id}`, { headers: authHeaders(user.token) })
  const shown = await json(details)
  if (!details.ok) throw new Error(`details ${details.status}`)
  if (shown.redirect_url) return new URL(shown.redirect_url) // remembered approval (P5)
  const done = await fetch(`${AUTH}/oauth/authorizations/${id}/consent`, {
    method: 'POST',
    headers: authHeaders(user.token),
    body: JSON.stringify({ action }),
  })
  const result = await json(done)
  if (!done.ok) throw new Error(`consent ${done.status}`)
  return new URL(result.redirect_url)
}

export interface Connection {
  client: Client
  provider: Provider
  accessToken(): string
  refreshToken(): string | undefined
  clientId(): string
  close(): Promise<void>
}

class Provider implements OAuthClientProvider {
  info: any
  tokensValue: any
  verifier = ''
  authUrl: URL | null = null
  get redirectUrl() { return 'http://127.0.0.1:8976/callback' }
  get clientMetadata() {
    return {
      client_name: 'Kilo integration harness (MCP TypeScript SDK client)',
      redirect_uris: ['http://127.0.0.1:8976/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }
  clientInformation() { return this.info }
  saveClientInformation(info: any) { this.info = info }
  tokens() { return this.tokensValue }
  saveTokens(t: any) { this.tokensValue = t; remember(t.access_token, t.refresh_token) }
  redirectToAuthorization(url: URL) { this.authUrl = url }
  saveCodeVerifier(v: string) { this.verifier = v }
  codeVerifier() { return this.verifier }
}

export type Outcome =
  | { kind: 'connected'; connection: Connection }
  | { kind: 'redirected'; redirect: URL }

// Connects with the SDK client: discovery, dynamic registration, PKCE, code exchange.
// `action` is what the signed-in user chooses on the consent screen.
export type Decider = (user: Session, url: URL, action: 'approve' | 'deny') => Promise<URL>

export async function connect(user: Session, action: 'approve' | 'deny' = 'approve', provider = new Provider(), decider: Decider = browser): Promise<Outcome> {
  const make = () => new StreamableHTTPClientTransport(new URL(MCP_URL), {
    authProvider: provider,
  })
  let transport = make()
  let client = new Client({ name: 'kilo-integration-harness', version: '1.0.0' })
  try {
    await client.connect(transport)
  } catch (e) {
    if (!(e instanceof UnauthorizedError) || !provider.authUrl) throw e
    const redirect = await decider(user, provider.authUrl, action)
    if (action === 'deny') return { kind: 'redirected', redirect }
    const code = redirect.searchParams.get('code')
    if (!code) throw new Error('no code in approve redirect')
    remember(code)
    await transport.finishAuth(code)
    transport = make()
    client = new Client({ name: 'kilo-integration-harness', version: '1.0.0' })
    await client.connect(transport)
  }
  return {
    kind: 'connected',
    connection: {
      client,
      provider,
      accessToken: () => provider.tokensValue.access_token,
      refreshToken: () => provider.tokensValue.refresh_token,
      clientId: () => provider.info.client_id,
      close: () => client.close(),
    },
  }
}

export async function revokeGrant(user: Session, clientId: string) {
  const res = await fetch(`${AUTH}/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`, { method: 'DELETE', headers: authHeaders(user.token) })
  return res.status
}

export async function refresh(clientId: string, refreshToken: string) {
  const res = await fetch(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', apikey: ANON_KEY },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
  })
  return { status: res.status, body: await json(res) }
}

// ---- result recording ----

export interface CaseResult { id: string; criterion: string; title: string; status: 'pass' | 'fail' | 'blocked'; detail: string }
export const results: CaseResult[] = []

export async function check(id: string, criterion: string, title: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) ?? ''
    results.push({ id, criterion, title, status: 'pass', detail })
    console.log(`PASS ${id} ${title}`)
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 300) : 'failed'
    results.push({ id, criterion, title, status: 'fail', detail })
    console.log(`FAIL ${id} ${title}: ${detail}`)
  }
}

export function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}
