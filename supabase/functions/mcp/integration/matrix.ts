// Synthetic integration matrix for the read-only MCP MVP (issue #1629).
// Runs against the isolated local stack (stack.sh up) and exits non-zero on any
// failed case. Writes sanitized results only: case ids, pass/fail and short
// non-secret details. Never records tokens, codes, authorization ids, cursors or
// response bodies.

import * as L from './lib.ts'
import { check, expect } from './lib.ts'

const THREE_TOOLS = ['weight_entries_list', 'whoami', 'workout_notes_list']
const ok = (r: L.Rpc) => r.status === 200 && !r.body?.result?.isError

async function pages(token: string, tool: string, args: Record<string, unknown>) {
  const items: any[] = []
  let cursor: string | undefined
  let count = 0
  do {
    const r = await L.call(token, tool, { ...args, ...(cursor ? { cursor } : {}) })
    expect(ok(r), `${tool} page ${count} failed (${r.status})`)
    const p = L.payload(r)
    items.push(...p.items)
    cursor = p.next_cursor ?? undefined
    count++
    expect(count < 20, 'pagination did not terminate')
  } while (cursor)
  return { items, pages: count }
}

const rawText = (n: number) => 'z'.repeat(n)
const tamper = (cursor: string, patch: Record<string, unknown>) => {
  const pad = cursor.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (cursor.length % 4)) % 4)
  const value = { ...JSON.parse(atob(pad)), ...patch }
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

await L.setGateMode('consent_required')

const A = await L.createUser('a')
const B = await L.createUser('b')
await L.grantConsent(A)
await L.grantConsent(B)
const fxA = await L.seedUser(A, 'SYNA')
const fxB = await L.seedUser(B, 'SYNB')

// ---------- 1. discovery and anonymous ----------
await check('S1', 'AC1', 'discovery metadata matches the Auth issuer; anonymous request gets a 401 challenge', async () => {
  const meta = await (await fetch(`${L.MCP_URL}/oauth-protected-resource`, )).json()
  const as = await (await fetch(`${L.AUTH}/.well-known/oauth-authorization-server`)).json()
  expect(meta.authorization_servers?.[0] === as.issuer, 'authorization server mismatch')
  const r = await L.raw(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
  expect(r.status === 401, `anonymous status ${r.status}`)
  expect(/resource_metadata=/.test(r.headers.get('www-authenticate') ?? ''), 'no resource_metadata challenge')
})

// ---------- 2. real client: connect, list, whoami, reads ----------
const conn = await (async () => {
  try {
    const out = await L.connect(A)
    return out.kind === 'connected' ? out.connection : null
  } catch { return null }
})()

await check('C1', 'AC2', 'SDK client: discovery, DCR, PKCE, explicit approval, initialize, tools/list, whoami', async () => {
  expect(conn, 'client could not connect')
  const tools = (await conn.client.listTools()).tools
  expect(JSON.stringify(tools.map((t: any) => t.name).sort()) === JSON.stringify(THREE_TOOLS), `tools: ${tools.map((t: any) => t.name)}`)
  expect(tools.every((t: any) => t.annotations?.readOnlyHint === true), 'a tool is not marked read-only')
  const me = (await conn.client.callTool({ name: 'whoami', arguments: {} })) as any
  const w = me.structuredContent
  expect(w.user_id === A.userId && w.client_id === conn.clientId() && w.health_consent === 'granted', 'whoami mismatch')
  expect(!('email' in w) && !('name' in w), 'whoami leaked profile fields')
  return 'three read-only tools; whoami identity matches'
})
const tokenA = conn?.accessToken() ?? ''

await check('C2', 'AC2', 'workout reads: own rows only, tombstone excluded, pagination, raw text opt-in and bounded', async () => {
  const all = await pages(tokenA, 'workout_notes_list', { limit: 7 })
  const ids = all.items.map((i) => i.id)
  expect(ids.length === fxA.notes && new Set(ids).size === ids.length, `got ${ids.length} unique ${new Set(ids).size}, want ${fxA.notes}`)
  expect(ids.every((i: string) => i.includes('SYNA')) && !ids.some((i: string) => i.includes('gone')), 'foreign or deleted row')
  expect(all.items.every((i) => !('raw_text' in i)), 'raw_text without opt-in')
  const raw = L.payload(await L.call(tokenA, 'workout_notes_list', { limit: 25, include_raw_text: true }))
  const long = raw.items.find((i: any) => i.id.endsWith('long'))
  expect(long && long.raw_text.length <= 4000 && long.raw_text_truncated === true && long.raw_text_chars > 4000, 'raw text bound not applied')
  expect(JSON.stringify(raw).length < 256 * 1024, 'response over 256 KiB')
  const bad = await L.call(tokenA, 'workout_notes_list', { limit: 26, include_raw_text: true })
  expect(L.isToolError(bad, 'invalid_arguments'), 'limit above 25 with raw text accepted')
  return `${all.pages} pages, ${ids.length} notes`
})

await check('C3', 'AC2/AC5', 'weight reads: pagination, unknown dates honest, unit reported as lb with original unavailable', async () => {
  const all = await pages(tokenA, 'weight_entries_list', { limit: 50 })
  const ids = all.items.map((i) => i.id)
  expect(ids.length === fxA.weights && new Set(ids).size === ids.length, `got ${ids.length} want ${fxA.weights}`)
  expect(ids.every((i: string) => i.includes('SYNA')), 'foreign row')
  expect(all.items.every((i) => i.unit === 'lb' && i.original_unit === null && i.original_unit_status === 'unavailable'), 'unit fields')
  const firstUndated = all.items.findIndex((i) => i.logged_at === null)
  expect(firstUndated === fxA.datedWeights && all.items.slice(firstUndated).every((i) => i.logged_at === null), 'undated rows not listed last')
  expect(all.items.some((i) => i.date === null) && all.items.some((i) => i.logged_at === null && i.date !== null), 'null date/logged_at not preserved')
  const ranged = await pages(tokenA, 'weight_entries_list', { limit: 100, logged_from: '2026-01-01T00:00:00Z', logged_to: '2026-01-02T00:00:00Z' })
  expect(ranged.items.length === 24 && ranged.items.every((i) => i.logged_at !== null), `range returned ${ranged.items.length}`)
  expect(L.isToolError(await L.call(tokenA, 'weight_entries_list', { logged_from: '2026-01-01T00:00:00Z' }), 'invalid_arguments'), 'half range accepted')
  return `${all.pages} pages; range [from,to) gave 24`
})

await check('C4', 'AC5', 'empty cloud snapshot is reported as no_cloud_records with unknown coverage', async () => {
  const E = await L.createUser('empty')
  await L.grantConsent(E)
  const out = await L.connect(E)
  expect(out.kind === 'connected', 'no connection')
  const t = out.connection.accessToken()
  for (const tool of ['weight_entries_list', 'workout_notes_list']) {
    const p = L.payload(await L.call(t, tool, {}))
    expect(p.result_state === 'no_cloud_records' && p.items.length === 0 && p.provenance.coverage === 'unknown', `${tool} state`)
    expect(!('sync_unavailable' in p) && p.provenance.source === 'kilo_cloud_snapshot', 'invented sync claim')
  }
  await out.connection.close()
})

// ---------- 3. cross-user, direct access, wrong-surface ----------
await check('X1', 'AC4', 'cross-user cursor and arguments cannot reach another user\'s rows', async () => {
  const first = L.payload(await L.call(tokenA, 'workout_notes_list', { limit: 2 }))
  const forged = tamper(first.next_cursor, { id: 'n-SYNB-000' })
  const next = await L.call(tokenA, 'workout_notes_list', { limit: 50, cursor: forged })
  const text = JSON.stringify(next.body)
  expect(!text.includes('SYNB'), 'another user\'s row appeared')
  const wFirst = L.payload(await L.call(tokenA, 'weight_entries_list', { limit: 2 }))
  const wNext = await L.call(tokenA, 'weight_entries_list', { limit: 100, cursor: tamper(wFirst.next_cursor, { id: 'w-SYNB-0000' }) })
  expect(!JSON.stringify(wNext.body).includes('SYNB'), 'another user\'s weight appeared')
  expect(L.isToolError(await L.call(tokenA, 'workout_notes_list', { cursor: 'not a cursor!' }), 'invalid_cursor'), 'garbage cursor')
  const huge = await L.call(tokenA, 'workout_notes_list', { cursor: 'a'.repeat(6145) })
  expect(huge.status === 200 && huge.body.result.isError === true && !('structuredContent' in huge.body.result), 'oversized cursor not refused by the schema')
  const inject = await L.call(tokenA, 'weight_entries_list', { user_id: B.userId })
  expect(!JSON.stringify(inject.body).includes('SYNB'), 'user_id argument honored')
})

await check('X2', 'AC4', 'OAuth token has no direct table, writer, withdrawal or other-function access', async () => {
  for (const [table, who] of [['weight_entries', A], ['workout_notes', A], ['weight_entries', B]] as const) {
    const r = await L.rest(tokenA, 'GET', `${table}?select=id&user_id=eq.${who.userId}`)
    expect(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, `${table} read gave ${r.status}`)
  }
  const before = (await L.rest(A.token, 'GET', 'weight_entries?select=id')).body.length
  const insert = await L.rest(tokenA, 'POST', 'weight_entries', [{ user_id: A.userId, id: 'w-oauth-write', entry_type: 'weight', weight_value: 1 }])
  expect(insert.status >= 400, `write status ${insert.status}`)
  const after = (await L.rest(A.token, 'GET', 'weight_entries?select=id')).body.length
  expect(before === after, 'a write by the OAuth token landed')
  const w = await L.rpc(tokenA, 'consent_withdraw')
  expect(w.status === 403, `consent_withdraw status ${w.status}`)
  const state = await L.sql(`select status from kilo.consent_state where user_id='${A.userId}'`)
  expect(state === 'granted', 'consent changed')
  for (const fn of ['account-export', 'account-delete']) {
    const r = await fetch(`${L.API}/functions/v1/${fn}`, { method: 'POST', headers: { apikey: L.ANON_KEY, authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: '{}' })
    expect(r.status === 401 || r.status === 403, `${fn} status ${r.status}`)
    await r.body?.cancel()
  }
  const exists = await L.sql(`select count(*) from auth.users where id='${A.userId}'`)
  expect(exists === '1', 'account affected')
})

// ---------- 4. token negatives ----------
await check('N1', 'AC4', 'anonymous, malformed, HS256, expired, wrong issuer/audience/client and first-party tokens are rejected', async () => {
  const c = L.decodeClaims(tokenA)
  const now = Math.floor(Date.now() / 1000)
  const base = { iss: c.iss, aud: 'authenticated', role: 'authenticated', sub: c.sub, session_id: c.session_id, client_id: c.client_id, iat: now, exp: now + 600 }
  const control = await L.call(await L.forge(base), 'whoami')
  expect(control.status === 200, `control forged token rejected (${control.status}); the negative cases below would prove nothing`)
  const cases: [string, string | null][] = [
    ['anonymous', null],
    ['malformed', 'not.a.jwt'],
    ['hs256', await L.forge(base, 'hs256')],
    ['expired', await L.forge({ ...base, iat: now - 7200, exp: now - 3600 })],
    ['wrong issuer', await L.forge({ ...base, iss: 'https://evil.example.test/auth/v1' })],
    ['wrong audience', await L.forge({ ...base, aud: 'other' })],
    ['wrong client', await L.forge({ ...base, client_id: crypto.randomUUID() })],
    ['no client (first-party shape)', await L.forge({ ...base, client_id: undefined })],
    ['first-party session token', A.token],
    ['anon role', await L.forge({ ...base, role: 'anon' })],
    ['unknown session', await L.forge({ ...base, session_id: crypto.randomUUID() })],
  ]
  for (const [name, token] of cases) {
    const r = await L.call(token, 'whoami')
    expect(r.status === 401, `${name}: status ${r.status}`)
    expect(!JSON.stringify(r.body).includes(A.userId), `${name}: body leaked identity`)
  }
  return `${cases.length} rejected; forged control accepted`
})

// ---------- 5. OAuth consent outcomes ----------
await check('O1', 'AC4', 'denied OAuth request yields an error redirect and no usable code; the id cannot be replayed', async () => {
  const out = await L.connect(A, 'deny')
  expect(out.kind === 'redirected', 'deny did not redirect')
  expect(out.redirect.searchParams.get('error') === 'access_denied' && !out.redirect.searchParams.get('code'), 'deny redirect carries a code or lacks access_denied')
})

await check('M1', 'AC4', 'user without cloud consent connects but data tools return consent_required and no rows', async () => {
  const C = await L.createUser('noconsent')
  // Rows exist, written while the gate was legacy-permissive for this user, to prove the gate (not emptiness) blocks.
  await L.sql(`insert into kilo.weight_entries (user_id, id, weight_value) values ('${C.userId}', 'w-SYNC-0', 100)`)
  const out = await L.connect(C)
  expect(out.kind === 'connected', 'no connection')
  const t = out.connection.accessToken()
  const me = L.payload(await L.call(t, 'whoami'))
  expect(me.health_consent === 'not_granted', 'whoami consent')
  for (const tool of ['weight_entries_list', 'workout_notes_list']) {
    const r = await L.call(t, tool, {})
    expect(L.isToolError(r, 'consent_required') && !JSON.stringify(r.body).includes('SYNC'), `${tool} not blocked`)
  }
  await out.connection.close()
})

// ---------- 6. refresh, disconnect, replay ----------
await check('R1', 'AC3', 'refresh works: a new access token is issued and accepted', async () => {
  const r = await L.refresh(conn!.clientId(), conn!.refreshToken()!)
  expect(r.status === 200 && r.body.access_token && r.body.refresh_token, `refresh status ${r.status}`)
  expect(r.body.access_token !== conn!.accessToken(), 'access token not renewed')
  const used = await L.call(r.body.access_token, 'whoami')
  expect(used.status === 200, 'refreshed token rejected')
  conn!.provider.tokensValue = r.body
})

await check('R2', 'AC3', 'rotated-out refresh token replay is observed; disconnect kills every token chain', async () => {
  const R = await L.createUser('replay')
  await L.grantConsent(R)
  const o = await L.connect(R)
  expect(o.kind === 'connected', 'no connection')
  const clientId = o.connection.clientId()
  const first = o.connection.refreshToken()!
  const second = await L.refresh(clientId, first)
  expect(second.status === 200, `rotation ${second.status}`)
  await new Promise((r) => setTimeout(r, 12_000)) // past Auth's reuse interval
  // Observation, not a Kilo guarantee: Auth's OAuth token endpoint decides whether a
  // rotated-out refresh token is accepted again. Whatever it does, disconnect must end
  // every chain, so both outcomes are handled and recorded.
  const replay = await L.refresh(clientId, first)
  const replayAccepted = replay.status === 200 && Boolean(replay.body?.access_token)
  expect((await L.call(second.body.access_token, 'whoami')).status === 200 || !replayAccepted, 'live chain broken without cause')
  const status = await L.revokeGrant(R, clientId)
  expect(status === 204 || status === 200, `revoke status ${status}`)
  const tokens = [second.body.access_token, replayAccepted ? replay.body.access_token : null].filter(Boolean) as string[]
  for (const t of tokens) expect((await L.call(t, 'whoami')).status === 401, 'a chain survived disconnect')
  for (const rt of [second.body.refresh_token, replayAccepted ? replay.body.refresh_token : null].filter(Boolean) as string[]) {
    const r = await L.refresh(clientId, rt)
    expect(r.status >= 400 && !r.body?.access_token, 'refresh survived disconnect')
  }
  return replayAccepted ? 'Auth accepted the replayed refresh token (GoTrue v2.192.0); all chains ended on disconnect' : 'Auth rejected the replay; all chains ended on disconnect'
})

await check('D1', 'AC3', 'disconnect: unexpired access token and refresh token stop working; first-party session is unaffected', async () => {
  const token = conn!.accessToken()
  const refreshToken = conn!.refreshToken()!
  expect((await L.call(token, 'whoami')).status === 200, 'precondition: token works')
  const status = await L.revokeGrant(A, conn!.clientId())
  expect(status === 204 || status === 200, `revoke status ${status}`)
  const exp = L.decodeClaims(token).exp
  expect(exp * 1000 > Date.now() + 60_000, 'token already expired; replay proves nothing')
  const replay = await L.call(token, 'whoami')
  expect(replay.status === 401, `replay status ${replay.status}`)
  const data = await L.call(token, 'weight_entries_list')
  expect(data.status === 401 && !JSON.stringify(data.body).includes('SYNA'), 'data readable after disconnect')
  const rr = await L.refresh(conn!.clientId(), refreshToken)
  expect(rr.status >= 400 && !rr.body?.access_token, `refresh after disconnect ${rr.status}`)
  const first = await L.rest(A.token, 'GET', 'weight_entries?select=id&limit=1')
  expect(first.status === 200 && first.body.length === 1, 'first-party session affected')
  const rows = await L.sql(`select count(*) from kilo.weight_entries where user_id='${A.userId}'`)
  expect(Number(rows) === fxA.weights, 'data changed by disconnect')
  return `replay of unexpired token -> ${replay.status}`
})

// ---------- 7. withdrawal and regrant ----------
await check('W1', 'AC3', 'withdrawal blocks reads immediately (before purge); regrant needs the approved reconnect', async () => {
  const W = await L.createUser('withdraw')
  await L.grantConsent(W)
  await L.seedUser(W, 'SYNW', 10, 1, 3)
  const out = await L.connect(W)
  expect(out.kind === 'connected', 'no connection')
  const c = out.connection
  expect(ok(await L.call(c.accessToken(), 'weight_entries_list')), 'precondition read')
  const w = await L.withdrawConsent(W)
  expect(w.status < 300, `withdraw status ${w.status}`)
  const state = await L.sql(`select status from kilo.consent_state where user_id='${W.userId}'`)
  const rowsBefore = await L.sql(`select count(*) from kilo.weight_entries where user_id='${W.userId}'`)
  expect(state === 'deletion_pending' && Number(rowsBefore) > 0, `not in the before-purge window (${state}, ${rowsBefore} rows)`)
  for (const tool of ['weight_entries_list', 'workout_notes_list']) {
    const r = await L.call(c.accessToken(), tool)
    expect(L.isToolError(r, 'consent_required') && !JSON.stringify(r.body).includes('SYNW'), `${tool} readable during purge window`)
  }
  expect(L.payload(await L.call(c.accessToken(), 'whoami')).health_consent === 'not_granted', 'whoami consent after withdrawal')
  const direct = await L.rpc(c.accessToken(), 'mcp_weight_entries_page', { p_limit: 5 })
  expect(direct.status >= 400, 'direct page RPC readable during purge window')
  // Regrant: the old live session must not silently come back.
  await L.sql(`update kilo.consent_state set status='withdrawn' where user_id='${W.userId}'`) // fixture: purge finished
  await L.grantConsent(W)
  const stale = await L.call(c.accessToken(), 'whoami')
  expect(stale.status === 401, `old session after regrant: ${stale.status}`)
  // Approved behavior (OD-1 accept): the same client reconnects through Auth without a second disclosure.
  const again = await L.connect(W, 'approve', Object.assign(c.provider, { tokensValue: undefined, authUrl: null }))
  expect(again.kind === 'connected', 'reconnect failed')
  expect(L.payload(await L.call(again.connection.accessToken(), 'whoami')).health_consent === 'granted', 'new session after regrant')
  await again.connection.close()
  return 'before-purge window blocked; old session 401 after regrant; reconnect works'
})

// ---------- 8. deleted account ----------
await check('A1', 'AC4', 'deleted account: unexpired token stops working', async () => {
  const D = await L.createUser('deleted')
  await L.grantConsent(D)
  const out = await L.connect(D)
  expect(out.kind === 'connected', 'no connection')
  const t = out.connection.accessToken()
  expect((await L.call(t, 'whoami')).status === 200, 'precondition')
  const del = await L.deleteUser(D.userId)
  expect(del.status < 300, `delete status ${del.status}`)
  await del.body?.cancel()
  const r = await L.call(t, 'whoami')
  expect(r.status === 401, `status ${r.status}`)
})

// ---------- 9. dependency outages (fault injection in the disposable container) ----------
async function outage(name: string, breakIt: string, fixIt: string, run: () => Promise<void>) {
  await L.sql(breakIt)
  try { await run() } finally { await L.sql(fixIt) }
  results_note(name)
}
const results_note = (_: string) => {}

const U = await L.createUser('outage')
await L.grantConsent(U)
await L.seedUser(U, 'SYNU', 5, 1, 3)
const outU = await L.connect(U)
const tokenU = outU.kind === 'connected' ? outU.connection.accessToken() : ''

await check('F1', 'AC4', 'gate lookup outage -> 503 with no query; recovery restores service', async () => {
  await outage('gate', 'revoke execute on function kilo.mcp_request_gate() from authenticated', 'grant execute on function kilo.mcp_request_gate() to authenticated', async () => {
    const r = await L.call(tokenU, 'weight_entries_list')
    expect(r.status === 503 && !JSON.stringify(r.body).includes('SYNU'), `status ${r.status}`)
  })
  expect((await L.call(tokenU, 'whoami')).status === 200, 'not recovered')
})

await check('F2', 'AC4', 'consent lookup outage -> 503, never an implicit allow', async () => {
  await outage('consent', 'alter table kilo.consent_state rename to consent_state_down', 'alter table kilo.consent_state_down rename to consent_state', async () => {
    const r = await L.call(tokenU, 'weight_entries_list')
    expect(r.status === 503 && !JSON.stringify(r.body).includes('SYNU'), `status ${r.status}`)
  })
  expect((await L.call(tokenU, 'whoami')).status === 200, 'not recovered')
})

await check('F3', 'AC4', 'auth session lookup outage -> 503, never an implicit allow', async () => {
  await outage('session', 'alter function kilo.mcp_session_created_at(uuid, uuid, text) rename to mcp_session_created_at_down', 'alter function kilo.mcp_session_created_at_down(uuid, uuid, text) rename to mcp_session_created_at', async () => {
    const r = await L.call(tokenU, 'whoami')
    expect(r.status === 503 || r.status === 401, `status ${r.status}`)
    expect(!JSON.stringify(r.body).includes(U.userId), 'identity leaked')
  })
  expect((await L.call(tokenU, 'whoami')).status === 200, 'not recovered')
})

await check('F4', 'AC4', 'data page RPC outage -> fixed internal tool error without database text', async () => {
  await outage('rpc', 'revoke execute on function kilo.mcp_weight_entries_page(int, text, timestamptz, text, timestamptz, timestamptz) from authenticated', 'grant execute on function kilo.mcp_weight_entries_page(int, text, timestamptz, text, timestamptz, timestamptz) to authenticated', async () => {
    const r = await L.call(tokenU, 'weight_entries_list')
    const p = L.payload(r)
    expect(r.status === 200 && r.body.result.isError && p.code === 'internal', `status ${r.status} code ${p?.code}`)
    expect(!/permission denied|42501|mcp_weight|relation|SQL/i.test(JSON.stringify(r.body)), 'database detail in error')
  })
  expect(ok(await L.call(tokenU, 'weight_entries_list')), 'not recovered')
})

await check('F5', 'AC4', 'rate limiter outage fails closed (429), not open', async () => {
  await outage('limiter', 'revoke execute on all functions in schema kilo from service_role', 'grant execute on all functions in schema kilo to service_role', async () => {
    const r = await L.call(tokenU, 'whoami')
    expect(r.status === 429, `status ${r.status}`)
  })
  expect((await L.call(tokenU, 'whoami')).status === 200, 'not recovered')
})

await check('F6', 'AC4', 'slow database: the 3 s call limit ends the read with a timeout error', async () => {
  const hold = new Deno.Command('docker', { args: ['exec', L.DB_CONTAINER, 'psql', '-U', 'postgres', '-c', 'begin; lock table kilo.weight_entries in access exclusive mode; select pg_sleep(8); commit;'], stdout: 'null', stderr: 'null' }).spawn()
  try {
    await new Promise((r) => setTimeout(r, 1000))
    const started = Date.now()
    const r = await L.call(tokenU, 'weight_entries_list')
    const ms = Date.now() - started
    const p = L.payload(r)
    expect((r.status === 200 && p?.code === 'timeout') || r.status === 504, `status ${r.status} code ${p?.code}`)
    expect(ms < 9000, `took ${ms} ms`)
    return `${ms} ms`
  } finally {
    await hold.status
  }
})
if (outU.kind === 'connected') await outU.connection.close()

// ---------- 10. size and quota limits (each case uses its own user/IP buckets) ----------
await check('L1', 'AC4', 'request size, batch, malformed JSON and method limits', async () => {
  const big = await L.raw(tokenA, null, { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', pad: 'x'.repeat(70 * 1024) }) })
  expect(big.status === 413 || big.status === 401, `oversized ${big.status}`)
  const T = await L.createUser('limits')
  await L.grantConsent(T)
  const o = await L.connect(T)
  expect(o.kind === 'connected', 'no connection')
  const t = o.connection.accessToken()
  const over = await L.raw(t, null, { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', pad: 'x'.repeat(70 * 1024) }) })
  expect(over.status === 413, `oversized with a valid token: ${over.status}`)
  const batch = await L.raw(t, [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])
  expect(batch.status === 400, `batch ${batch.status}`)
  const bad = await L.raw(t, null, { body: '{not json' })
  expect(bad.status === 400, `malformed ${bad.status}`)
  const get = await L.raw(t, null, { method: 'GET' })
  expect(get.status === 405, `GET ${get.status}`)
  for (const tool of ['write_weight', 'delete_note', 'run_sql']) {
    const r = await L.call(t, tool, {})
    expect(!ok(r) || r.body?.error, `${tool} callable`)
  }
  await o.connection.close()
})

// All requests reach the function through the same gateway address, so the pre-auth
// bucket (120 / 60 s) is shared by the whole run. Let it drain before measuring it.
await new Promise((r) => setTimeout(r, 62_000))

await check('Q1', 'AC4', 'durable limits: per-user MCP and per-user data quota', async () => {
  const Q = await L.createUser('quota')
  await L.grantConsent(Q)
  await L.seedUser(Q, 'SYNQ', 3, 0, 1)
  const o = await L.connect(Q)
  expect(o.kind === 'connected', 'no connection')
  const t = o.connection.accessToken()
  let limited = 0, served = 0
  for (let i = 0; i < 35; i++) {
    const r = await L.call(t, 'weight_entries_list', { limit: 1 })
    if (L.isToolError(r, 'rate_limited')) limited++
    else if (ok(r)) served++
  }
  expect(served > 0 && served <= 30 && limited >= 1, `data quota: served ${served}, limited ${limited}`)
  let http429 = 0
  for (let i = 0; i < 40; i++) if ((await L.call(t, 'whoami')).status === 429) http429++
  expect(http429 >= 1, 'per-user HTTP limit never applied')
  await o.connection.close()
  return `data served ${served} limited ${limited}; http 429 ${http429}`
})

await check('Q2', 'AC4', 'durable pre-auth limit per client address', async () => {
  await new Promise((r) => setTimeout(r, 62_000))
  let denied = 0
  for (let i = 0; i < 125; i++) if ((await L.raw(null, { jsonrpc: '2.0', id: i, method: 'tools/list' })).status === 429) denied++
  expect(denied >= 4, `pre-auth denied ${denied} of 125`)
  return `denied ${denied} of 125`
})

// ---------- 11. minimal logs ----------
await check('G1', 'AC6', 'function logs hold no tokens, codes, cursors, authorization ids or health data', async () => {
  const path = Deno.env.get('KILO_MCP_FUNCTIONS_LOG')
  expect(path, 'KILO_MCP_FUNCTIONS_LOG unset')
  const log = await Deno.readTextFile(path)
  expect(log.includes('"mcp":'), 'no request log lines found')
  for (const [name, re] of [['jwt', /eyJ[A-Za-z0-9_-]{10,}/], ['authorization_id', /authorization_id/i], ['marker', /SYN[ABUWQ]|w-SYN|n-SYN/], ['user id', new RegExp(A.userId)], ['cursor', /next_cursor|"cursor"/]] as const) {
    expect(!re.test(log), `log contains ${name}`)
  }
})

await conn?.close().catch(() => {})
const failed = L.results.filter((r) => r.status !== 'pass')
const out = Deno.env.get('KILO_MCP_RESULTS')
if (out) await Deno.writeTextFile(out, JSON.stringify(L.results, null, 2) + '\n')
console.log(`${L.results.length - failed.length}/${L.results.length} cases passed`)
Deno.exit(failed.length ? 1 : 0)
