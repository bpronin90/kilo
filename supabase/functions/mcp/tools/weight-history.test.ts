import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import { createMcpFetch } from '../index.ts'
import type { RpcClient } from '../gate.ts'
import { claims, fakeLimiter, GATE_OK, ISSUER, makeSigner, USER_A, USER_B } from '../testing.ts'
import { decodeCursor, encodeCursor, WEIGHT_ENTRIES_SCHEMA } from './weight-history.ts'

const signer = await makeSigner()
const authEnv = {
  url: 'http://127.0.0.1:54321',
  publishableKeys: { default: 'sb_publishable_test' },
  secretKeys: {},
  jwks: signer.jwks,
}
const URL_MCP = 'http://127.0.0.1:54321/functions/v1/mcp'

type PageResult = { data: unknown; error: unknown }
interface Spy extends RpcClient {
  calls: { fn: string; args?: Record<string, unknown> }[]
}

// Routes the gate and the page RPC; any table access throws.
function client(gate: unknown, page: (args: Record<string, unknown>) => PageResult | Error): Spy {
  const calls: Spy['calls'] = []
  return {
    calls,
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ fn, args })
      if (fn === 'mcp_request_gate') return Promise.resolve({ data: gate, error: null })
      const out = page(args ?? {})
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out)
    },
    from() {
      throw new Error('table access is not permitted')
    },
  } as unknown as Spy
}

async function call(c: Spy, args: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const t = await signer.sign(claims(overrides))
  const fetchMcp = createMcpFetch({
    env: (n) => (n === 'MCP_AUTH_ISSUER' ? ISSUER : undefined),
    limiter: fakeLimiter(),
    authEnv,
    clientFor: () => c,
  })
  const res = await fetchMcp(
    new Request(URL_MCP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weight_entries_list', arguments: args } }),
    }),
  )
  const text = await res.text()
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  return { status: res.status, body: line ? JSON.parse(line.slice(5)) : text ? JSON.parse(text) : null }
}

const row = (id: string, loggedAt: string | null = '2026-10-20T10:00:00.123456+00:00', extra: Record<string, unknown> = {}) => ({
  id, value: 180.5, date: loggedAt ? loggedAt.slice(0, 10) : null, logged_at: loggedAt, ...extra,
})
const page = (items: unknown[], hasMore = false) => ({
  data: { as_of: '2026-10-24T23:00:00.5+00:00', has_more: hasMore, items }, error: null,
})
const sc = (r: { body: { result: { structuredContent: Record<string, unknown> } } }) => r.body.result.structuredContent
const RPC_KEYS = ['p_after_id', 'p_after_logged_at', 'p_limit', 'p_logged_from', 'p_logged_to', 'p_phase']

Deno.test('lists entries with explicit lb units, unavailable original unit and provenance', async () => {
  const c = client(GATE_OK, () => page([row('w1'), row('w2', '2026-10-19T10:00:00+00:00')]))
  const out = sc(await call(c, {}))
  assertEquals(out.schema, WEIGHT_ENTRIES_SCHEMA)
  assertEquals(out.result_state, 'records')
  assertEquals((out.provenance as Record<string, unknown>).coverage, 'unknown')
  assertEquals((out.provenance as Record<string, unknown>).snapshot_as_of, '2026-10-24T23:00:00.5+00:00')
  assert(String(out.item_semantics).includes('originally entered unit is unavailable'))
  const items = out.items as Record<string, unknown>[]
  assertEquals(items.map((i) => i.id), ['w1', 'w2'])
  assertEquals(Object.keys(items[0]).sort(), ['date', 'id', 'logged_at', 'original_unit', 'original_unit_status', 'unit', 'value'])
  assertEquals([items[0].unit, items[0].original_unit, items[0].original_unit_status], ['lb', null, 'unavailable'])
  assertEquals(out.next_cursor, null)
  assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate', 'mcp_weight_entries_page'])
  assertEquals(c.calls[1].args, {
    p_limit: 50, p_phase: null, p_after_logged_at: null, p_after_id: null, p_logged_from: null, p_logged_to: null,
  })
})

Deno.test('unit is a constant: a unit or note column from the RPC is never exposed', async () => {
  const leaky = row('w1', undefined, { unit: 'kg', original_unit: 'kg', note: 'LEAK', saved_at: 'x', updated_at: 'x' })
  const out = sc(await call(client(GATE_OK, () => page([leaky])), {}))
  const item = (out.items as Record<string, unknown>[])[0]
  assertEquals([item.unit, item.original_unit], ['lb', null])
  assertEquals(JSON.stringify(out).includes('LEAK'), false)
  assertEquals('note' in item, false)
})

Deno.test('date-only values pass through verbatim and null date/logged_at stay unknown', async () => {
  const items = [
    { id: 'a', value: 1, date: '2026-03-01', logged_at: '2026-03-01T23:30:00-08:00' },
    { id: 'b', value: 2, date: '2026-02-28', logged_at: null },
    { id: 'c', value: 3, date: null, logged_at: null },
  ]
  const out = sc(await call(client(GATE_OK, () => page(items)), {}))
  assertEquals(out.items, items.map((i) => ({ ...i, unit: 'lb', original_unit: null, original_unit_status: 'unavailable' })))
})

Deno.test('zero rows on the first page is no_cloud_records, not "no weight history"', async () => {
  const out = sc(await call(client(GATE_OK, () => page([])), {}))
  assertEquals(out.result_state, 'no_cloud_records')
  assertEquals(out.items, [])
  assertEquals(out.next_cursor, null)
})

Deno.test('dated then undated cursors round-trip as keyset arguments', async () => {
  const c = client(GATE_OK, () => page([row('w1', '2026-10-20T10:00:00.123456+00:00')], true))
  const cursor = sc(await call(c, { limit: 1 })).next_cursor as string
  assertEquals(decodeCursor(cursor), { phase: 'dated', l: '2026-10-20T10:00:00.123456+00:00', id: 'w1' })
  await call(c, { limit: 1, cursor })
  assertEquals(c.calls.at(-1)!.args, {
    p_limit: 1, p_phase: 'dated', p_after_logged_at: '2026-10-20T10:00:00.123456+00:00', p_after_id: 'w1',
    p_logged_from: null, p_logged_to: null,
  })

  const u = client(GATE_OK, () => page([row('u1', null)], true))
  const undated = sc(await call(u, { limit: 1 })).next_cursor as string
  assertEquals(decodeCursor(undated), { phase: 'undated', l: null, id: 'u1' })
  await call(u, { limit: 1, cursor: undated })
  assertEquals(u.calls.at(-1)!.args, {
    p_limit: 1, p_phase: 'undated', p_after_logged_at: null, p_after_id: 'u1', p_logged_from: null, p_logged_to: null,
  })
})

Deno.test('equal timestamps page by id and never repeat or skip', async () => {
  const t = '2026-10-20T10:00:00+00:00'
  const all = [row('w3', t), row('w2', t), row('w1', t)]
  const c = client(GATE_OK, (a) => {
    const after = a.p_after_id as string | null
    const rest = after === null ? all : all.filter((r) => r.id < after)
    return page(rest.slice(0, 1), rest.length > 1)
  })
  const seen: string[] = []
  let cursor: string | undefined
  for (let i = 0; i < 5; i++) {
    const out = sc(await call(c, { limit: 1, ...(cursor ? { cursor } : {}) }))
    seen.push(...(out.items as { id: string }[]).map((x) => x.id))
    if (!out.next_cursor) break
    cursor = out.next_cursor as string
  }
  assertEquals(seen, ['w3', 'w2', 'w1'])
})

Deno.test('a 512-character multibyte/control id and an empty id round-trip through a cursor', () => {
  const id = ('é\u0001"\\日' + 'x').repeat(200).slice(0, 512)
  const cursor = encodeCursor({ phase: 'dated', l: '2026-10-20T10:00:00Z', id })
  assert(cursor.length <= 6144)
  assertEquals(decodeCursor(cursor)?.id, id)
  assertEquals(decodeCursor(encodeCursor({ phase: 'undated', l: null, id: '' }))?.id, '')
  assertEquals(decodeCursor(encodeCursor({ phase: 'dated', l: '2026-10-20T10:00:00Z', id: '😀'.repeat(513) })), null)
  assertEquals(decodeCursor(encodeCursor({ phase: 'dated', l: '2026-10-20T10:00:00Z', id: '😀'.repeat(257) }))?.id, '😀'.repeat(257))
})

Deno.test('malformed or tampered cursors are invalid_cursor and reach no data RPC', async () => {
  const good = encodeCursor({ phase: 'dated', l: '2026-10-20T10:00:00Z', id: 'w1' })
  const forge = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const L = '2026-10-20T10:00:00Z'
  const bad = [
    'not base64!', good.slice(0, -4),
    forge({ v: 2, phase: 'dated', l: L, id: 'w1' }),
    forge({ v: 1, phase: 'dated', l: 'yesterday', id: 'w1' }),
    forge({ v: 1, phase: 'dated', l: null, id: 'w1' }),
    forge({ v: 1, phase: 'undated', l: L, id: 'w1' }),
    forge({ v: 1, phase: 'sideways', l: L, id: 'w1' }),
    forge({ v: 1, phase: 'dated', l: L, id: 'w1', user_id: USER_B }),
    forge({ v: 1, phase: 'dated', l: L }),
    forge({ v: 1, phase: 'dated', l: L, id: 7 }),
    forge({ v: 1, phase: 'dated', l: L, id: 'x'.repeat(513) }),
    forge('string'), forge([1]), forge(null),
  ]
  for (const cursor of bad) {
    const c = client(GATE_OK, () => page([]))
    const out = sc(await call(c, { cursor }))
    assertEquals(out.code, 'invalid_cursor', cursor)
    assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate'])
  }
})

Deno.test('an undated cursor with a range is invalid_cursor', async () => {
  const c = client(GATE_OK, () => page([]))
  const cursor = encodeCursor({ phase: 'undated', l: null, id: 'u1' })
  const out = sc(await call(c, { cursor, logged_from: '2026-10-01T00:00:00Z', logged_to: '2026-10-02T00:00:00Z' }))
  assertEquals(out.code, 'invalid_cursor')
  assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate'])
})

Deno.test('a valid range is forwarded as instants', async () => {
  const c = client(GATE_OK, () => page([]))
  await call(c, { logged_from: '2026-10-01T00:00:00-07:00', logged_to: '2026-10-08T00:00:00+02:00' })
  assertEquals(c.calls.at(-1)!.args!.p_logged_from, '2026-10-01T00:00:00-07:00')
  assertEquals(c.calls.at(-1)!.args!.p_logged_to, '2026-10-08T00:00:00+02:00')
  const exact = client(GATE_OK, () => page([]))
  const r = await call(exact, { logged_from: '2025-10-01T00:00:00Z', logged_to: '2026-10-02T00:00:00Z' })
  assertEquals(sc(r).result_state, 'no_cloud_records')
  assertEquals(exact.calls.map((x) => x.fn), ['mcp_request_gate', 'mcp_weight_entries_page'])
})

Deno.test('range comparison keeps microsecond precision', async () => {
  const c = client(GATE_OK, () => page([]))
  await call(c, { logged_from: '2026-10-01T00:00:00.000001Z', logged_to: '2026-10-01T00:00:00.000002Z' })
  assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate', 'mcp_weight_entries_page'])
  const same = client(GATE_OK, () => page([]))
  await call(same, { logged_from: '2026-10-01T00:00:00.000002Z', logged_to: '2026-10-01T00:00:00.000002+00:00' })
  assertEquals(same.calls.map((x) => x.fn), ['mcp_request_gate'])
  const leap = client(GATE_OK, () => page([]))
  await call(leap, { logged_from: '2028-02-29T00:00:00Z', logged_to: '2028-03-01T00:00:00Z' })
  assertEquals(leap.calls.length, 2)
})

Deno.test('impossible calendar instants are rejected in ranges and cursors without reaching the RPC', async () => {
  const impossible = [
    '2026-02-30T00:00:00Z', '2026-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-10-01T24:00:00Z', '2026-10-01T00:60:00Z', '2026-10-01T00:00:60Z', '2026-10-01T00:00:00+24:00',
    '2026-10-01T00:00:00.1234567Z',
  ]
  for (const bad of impossible) {
    const c = client(GATE_OK, () => page([]))
    assertEquals(sc(await call(c, { logged_from: bad, logged_to: '2026-12-01T00:00:00Z' })).code, 'invalid_arguments', bad)
    assertEquals(sc(await call(c, { logged_from: '2026-09-01T00:00:00Z', logged_to: bad })).code, 'invalid_arguments', bad)
    const forged = btoa(JSON.stringify({ v: 1, phase: 'dated', l: bad, id: 'w1' })).replace(/=+$/, '')
    assertEquals(sc(await call(c, { cursor: forged })).code, 'invalid_cursor', bad)
    assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate', 'mcp_request_gate', 'mcp_request_gate'])
  }
})

Deno.test('invalid, reversed, one-sided, offset-less and overlarge ranges are rejected before any data RPC', async () => {
  const cases: Record<string, unknown>[] = [
    { logged_from: '2026-10-02T00:00:00Z', logged_to: '2026-10-01T00:00:00Z' },
    { logged_from: '2026-10-01T00:00:00Z', logged_to: '2026-10-01T00:00:00Z' },
    { logged_from: '2026-10-01T00:00:00Z' }, { logged_to: '2026-10-01T00:00:00Z' },
    { logged_from: '2026-10-01', logged_to: '2026-10-05' },
    { logged_from: '2026-10-01T00:00:00', logged_to: '2026-10-05T00:00:00' },
    { logged_from: 'nope', logged_to: '2026-10-05T00:00:00Z' },
    { logged_from: '2025-10-01T00:00:00Z', logged_to: '2026-10-03T00:00:00Z' },
    { logged_from: 5, logged_to: 6 },
  ]
  for (const args of cases) {
    const c = client(GATE_OK, () => page([]))
    const { body } = await call(c, args)
    assert(body.error || body.result?.isError, JSON.stringify(args))
    assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate'], JSON.stringify(args))
  }
})

Deno.test('rejects user-id overrides, arbitrary fields, filters and invalid limits', async () => {
  const cases: Record<string, unknown>[] = [
    { user_id: USER_B }, { filter: "weight_value > 1" }, { select: '*' }, { order: 'asc' }, { include_notes: true },
    { entry_type: 'goal' }, { unit: 'kg' },
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '5' }, { cursor: 'a'.repeat(6145) },
  ]
  for (const args of cases) {
    const c = client(GATE_OK, () => page([]))
    const { body } = await call(c, args)
    assert(body.error || body.result?.isError, JSON.stringify(args))
    assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate'], JSON.stringify(args))
  }
})

Deno.test('the oversized-response trim drops trailing items and issues a cursor from the last kept row', async () => {
  const rows = Array.from({ length: 100 }, (_, i) =>
    row('w' + String(i).padStart(3, '0') + '\u0001'.repeat(500), `2026-10-${String(20 - (i % 10)).padStart(2, '0')}T10:00:00+00:00`))
  const out = sc(await call(client(GATE_OK, () => page(rows, false)), { limit: 100 }))
  const kept = out.items as { id: string; logged_at: string }[]
  assert(kept.length >= 1 && kept.length < 100)
  const cursor = decodeCursor(out.next_cursor as string)
  assertEquals(cursor?.id, kept.at(-1)!.id)
  assertEquals(cursor?.l, kept.at(-1)!.logged_at)
})

Deno.test('RPC errors map to fixed tool errors without echoing database text', async () => {
  const map: [string, string][] = [
    ['MC002', 'consent_required'], ['MC003', 'invalid_arguments'], ['MC004', 'rate_limited'],
    ['MC001', 'internal'], ['42501', 'internal'], ['57014', 'internal'], ['XX000', 'internal'],
  ]
  for (const [code, expected] of map) {
    const c = client(GATE_OK, () => ({ data: null, error: { code, message: 'secret db detail user=' + USER_B } }))
    const r = await call(c, {})
    assertEquals(sc(r).code, expected)
    assertEquals(r.body.result.isError, true)
    assertEquals(JSON.stringify(r.body).includes('secret db detail'), false)
  }
})

Deno.test('malformed RPC payloads and thrown calls fail closed', async () => {
  const good = { as_of: '2026-10-24T23:00:00Z', has_more: false }
  const payloads: unknown[] = [
    null, { items: [] }, { as_of: 'x', has_more: false, items: [] }, { ...good, has_more: 'no', items: [] },
    { ...good, items: [{ id: 1 }] },
    { ...good, items: [{ id: 'a', value: '180', date: null, logged_at: null }] },
    { ...good, items: [{ id: 'a', value: null, date: null, logged_at: null }] },
    { ...good, items: [{ id: 'a', value: 1, date: '03/01/2026', logged_at: null }] },
    { ...good, items: [{ id: 'a', value: 1, date: null, logged_at: 'yesterday' }] },
    { ...good, items: [{ id: 'a', value: 1, date: undefined, logged_at: null }] },
  ]
  for (const data of payloads) {
    const out = sc(await call(client(GATE_OK, () => ({ data, error: null })), {}))
    assertEquals(out.code, 'internal', JSON.stringify(data))
  }
  assertEquals(sc(await call(client(GATE_OK, () => new Error('db down')), {})).code, 'timeout')
})

Deno.test('rejected authorization and post-withdrawal requests run no data RPC', async () => {
  const dead = client({ status: 'session_inactive', consent_granted_at: null }, () => page([row('w1')]))
  const r = await call(dead, {})
  assertEquals(r.status, 401)
  assertEquals(dead.calls.map((x) => x.fn), ['mcp_request_gate'])

  let status = 'ok'
  const c = client(GATE_OK, () => page([row('w1')]))
  const gate = c.rpc.bind(c)
  c.rpc = (fn, args) => (fn === 'mcp_request_gate' ? Promise.resolve({ data: { status, consent_granted_at: null }, error: null }) as never : gate(fn, args))
  assertEquals(sc(await call(c, {})).result_state, 'records')
  status = 'session_inactive'
  assertEquals((await call(c, {})).status, 401)
  assertEquals(c.calls.filter((x) => x.fn === 'mcp_weight_entries_page').length, 1)
})

Deno.test('the authenticated owner is never taken from arguments or cursor', async () => {
  const c = client(GATE_OK, () => page([row('w1')]))
  await call(c, { cursor: encodeCursor({ phase: 'dated', l: '2026-10-20T10:00:00Z', id: USER_B }) }, { sub: USER_A })
  assertEquals(Object.keys(c.calls.at(-1)!.args!).sort(), RPC_KEYS)
  assertNotEquals(JSON.stringify(c.calls.at(-1)!.args).includes(USER_A), true)
})

Deno.test('tools/list advertises weight_entries_list read-only with strict schemas', async () => {
  const t = await signer.sign(claims())
  const fetchMcp = createMcpFetch({
    env: (n) => (n === 'MCP_AUTH_ISSUER' ? ISSUER : undefined), limiter: fakeLimiter(), authEnv,
    clientFor: () => client(GATE_OK, () => page([])),
  })
  const res = await fetchMcp(new Request(URL_MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${t}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  }))
  const text = await res.text()
  const msg = JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? text)
  const tool = msg.result.tools.find((x: { name: string }) => x.name === 'weight_entries_list')
  assertEquals(tool.annotations.readOnlyHint, true)
  assertEquals(tool.inputSchema.additionalProperties, false)
  assertEquals(tool.outputSchema.additionalProperties, false)
  assert(tool.outputSchema.required.includes('items'))
})
