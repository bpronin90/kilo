import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import { createMcpFetch } from '../index.ts'
import type { RpcClient } from '../gate.ts'
import { claims, fakeLimiter, GATE_OK, ISSUER, makeSigner, USER_A, USER_B } from '../testing.ts'
import { decodeCursor, encodeCursor, WORKOUT_NOTES_SCHEMA } from './workout-history.ts'

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
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'workout_notes_list', arguments: args } }),
    }),
  )
  const text = await res.text()
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  return { status: res.status, body: line ? JSON.parse(line.slice(5)) : text ? JSON.parse(text) : null }
}

const row = (id: string, updated = '2026-10-20T10:00:00.123456+00:00', extra: Record<string, unknown> = {}) => ({
  id, title: 'Push', saved_at: null, updated_at: updated, is_current: false, ...extra,
})
const page = (items: unknown[], hasMore = false) => ({
  data: { as_of: '2026-10-24T23:00:00.5+00:00', has_more: hasMore, items }, error: null,
})
const sc = (r: { body: { result: { structuredContent: Record<string, unknown> } } }) => r.body.result.structuredContent

Deno.test('lists records with provenance, semantics and no derived session date', async () => {
  const c = client(GATE_OK, () => page([row('n1'), row('n2', '2026-10-19T10:00:00+00:00')]))
  const r = await call(c, {})
  const out = sc(r)
  assertEquals(out.schema, WORKOUT_NOTES_SCHEMA)
  assertEquals(out.result_state, 'records')
  assertEquals((out.provenance as Record<string, unknown>).coverage, 'unknown')
  assertEquals((out.provenance as Record<string, unknown>).snapshot_as_of, '2026-10-24T23:00:00.5+00:00')
  assert(String(out.item_semantics).includes('notebook record'))
  assertEquals((out.items as { id: string }[]).map((i) => i.id), ['n1', 'n2'])
  assertEquals(Object.keys((out.items as object[])[0]).sort(), ['id', 'is_current', 'saved_at', 'title', 'updated_at'])
  assertEquals(out.next_cursor, null)
  assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate', 'mcp_workout_notes_page'])
  assertEquals(c.calls[1].args, {
    p_limit: 20, p_as_of: null, p_after_updated_at: null, p_after_id: null, p_include_raw_text: false,
  })
})

Deno.test('zero rows on the first page is no_cloud_records, not "no workouts"', async () => {
  const r = await call(client(GATE_OK, () => page([])), {})
  assertEquals(sc(r).result_state, 'no_cloud_records')
  assertEquals(sc(r).items, [])
  assertEquals(sc(r).next_cursor, null)
})

Deno.test('next_cursor round-trips and is passed back as keyset arguments', async () => {
  const c = client(GATE_OK, () => page([row('n1', '2026-10-20T10:00:00.123456+00:00')], true))
  const first = sc(await call(c, { limit: 1 }))
  const cursor = first.next_cursor as string
  assert(cursor)
  assertEquals(decodeCursor(cursor), { as_of: '2026-10-24T23:00:00.5+00:00', u: '2026-10-20T10:00:00.123456+00:00', id: 'n1' })
  await call(c, { limit: 1, cursor })
  assertEquals(c.calls.at(-1)!.args, {
    p_limit: 1, p_as_of: '2026-10-24T23:00:00.5+00:00', p_after_updated_at: '2026-10-20T10:00:00.123456+00:00',
    p_after_id: 'n1', p_include_raw_text: false,
  })
})

Deno.test('a 512-character multibyte/control id round-trips through a cursor', () => {
  const id = ('é\u0001"\\日' + 'x').repeat(200).slice(0, 512)
  const cursor = encodeCursor({ as_of: '2026-10-24T23:00:00Z', u: '2026-10-20T10:00:00Z', id })
  assert(cursor.length <= 6144)
  assertEquals(decodeCursor(cursor)?.id, id)
})

Deno.test('an astral-character id (257 code points, 514 UTF-16 units) round-trips', async () => {
  const id = '😀'.repeat(257)
  const c = client(GATE_OK, () => page([row(id)], true))
  const cursor = sc(await call(c, { limit: 1 })).next_cursor as string
  assertEquals(decodeCursor(cursor)?.id, id)
  assertEquals(decodeCursor(encodeCursor({ as_of: '2026-10-24T23:00:00Z', u: '2026-10-20T10:00:00Z', id: '😀'.repeat(513) })), null)
})

Deno.test('malformed or tampered cursors are invalid_cursor and reach no data RPC', async () => {
  const good = encodeCursor({ as_of: '2026-10-24T23:00:00Z', u: '2026-10-20T10:00:00Z', id: 'n1' })
  const forge = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const bad = [
    'not base64!', good.slice(0, -4), forge({ v: 2, as_of: '2026-10-24T23:00:00Z', u: '2026-10-20T10:00:00Z', id: 'n1' }),
    forge({ v: 1, as_of: 'yesterday', u: '2026-10-20T10:00:00Z', id: 'n1' }),
    forge({ v: 1, as_of: '2026-10-24T23:00:00Z', u: '2026-10-20T10:00:00Z', id: 'n1', user_id: USER_B }),
    forge({ v: 1, as_of: '2026-10-24T23:00:00Z', u: '2026-10-20T10:00:00Z', id: '' }),
    forge({ v: 1, as_of: '2026-10-24T23:00:00Z', u: '2026-10-20T10:00:00Z', id: 'x'.repeat(513) }),
    forge('string'), forge([1]), forge(null),
  ]
  for (const cursor of bad) {
    const c = client(GATE_OK, () => page([]))
    const out = sc(await call(c, { cursor }))
    assertEquals(out.code, 'invalid_cursor', cursor)
    assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate'])
  }
})

Deno.test('forged cursor cannot change the owner: the RPC receives no user id', async () => {
  const c = client(GATE_OK, () => page([]))
  await call(c, { cursor: encodeCursor({ as_of: '2026-10-24T23:00:00Z', u: '2026-10-20T10:00:00Z', id: USER_B }) })
  assertEquals(Object.keys(c.calls.at(-1)!.args!).sort(), ['p_after_id', 'p_after_updated_at', 'p_as_of', 'p_include_raw_text', 'p_limit'])
})

Deno.test('rejects user-id overrides, arbitrary fields, filters and invalid limits', async () => {
  const cases: Record<string, unknown>[] = [
    { user_id: USER_B }, { filter: "title = 'x'" }, { select: '*' }, { order: 'asc' },
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '5' }, { include_raw_text: 'yes' },
    { cursor: 'a'.repeat(6145) }, { limit: 26, include_raw_text: true },
  ]
  for (const args of cases) {
    const c = client(GATE_OK, () => page([]))
    const { body } = await call(c, args)
    assert(body.error || body.result?.isError, JSON.stringify(args))
    assertEquals(c.calls.map((x) => x.fn), ['mcp_request_gate'], JSON.stringify(args))
  }
})

Deno.test('raw text is opt-in and carries truncation metadata', async () => {
  const withRaw = row('n1', undefined, { raw_text: 'abc', raw_text_chars: 5000, raw_text_truncated: true })
  const c = client(GATE_OK, (a) => page([a.p_include_raw_text ? withRaw : row('n1', undefined, { raw_text: 'LEAK' })]))
  const off = sc(await call(c, {}))
  assertEquals('raw_text' in (off.items as object[])[0], false)
  assertEquals(JSON.stringify(off).includes('LEAK'), false)
  const on = sc(await call(c, { include_raw_text: true, limit: 25 }))
  assertEquals((on.items as Record<string, unknown>[])[0].raw_text, 'abc')
  assertEquals((on.items as Record<string, unknown>[])[0].raw_text_chars, 5000)
  assertEquals((on.items as Record<string, unknown>[])[0].raw_text_truncated, true)
  assertEquals(c.calls.at(-1)!.args!.p_include_raw_text, true)
})

Deno.test('the oversized-response trim drops trailing items and issues a cursor from the last kept row', async () => {
  const big = 'é'.repeat(4000)
  const rows = Array.from({ length: 25 }, (_, i) =>
    row(`n${String(i).padStart(2, '0')}`, `2026-10-${String(20 - (i % 10)).padStart(2, '0')}T10:00:00+00:00`, {
      title: 'y'.repeat(4096), raw_text: big, raw_text_chars: 4000, raw_text_truncated: false,
    }))
  const out = sc(await call(client(GATE_OK, () => page(rows, false)), { include_raw_text: true, limit: 25 }))
  const kept = out.items as { id: string; updated_at: string }[]
  assert(kept.length >= 1 && kept.length < 25)
  const cursor = decodeCursor(out.next_cursor as string)
  assertEquals(cursor?.id, kept.at(-1)!.id)
  assertEquals(cursor?.u, kept.at(-1)!.updated_at)
})

Deno.test('RPC errors map to fixed tool errors without echoing database text', async () => {
  const map: [string, string][] = [
    ['MC002', 'consent_required'], ['MC003', 'invalid_arguments'], ['MC004', 'rate_limited'],
    ['MC001', 'internal'], ['57014', 'internal'], ['XX000', 'internal'],
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
  const payloads: unknown[] = [
    null, { items: [] }, { as_of: 'x', has_more: false, items: [] },
    { as_of: '2026-10-24T23:00:00Z', has_more: 'no', items: [] },
    { as_of: '2026-10-24T23:00:00Z', has_more: false, items: [{ id: 1 }] },
  ]
  for (const data of payloads) {
    const out = sc(await call(client(GATE_OK, () => ({ data, error: null })), {}))
    assertEquals(out.code, 'internal')
  }
  assertEquals(sc(await call(client(GATE_OK, () => new Error('db down')), {})).code, 'timeout')
})

Deno.test('rejected authorization runs no data RPC; withdrawal between calls is honoured', async () => {
  const dead = client({ status: 'session_inactive', consent_granted_at: null }, () => page([row('n1')]))
  const r = await call(dead, {})
  assertEquals(r.status, 401)
  assertEquals(dead.calls.map((x) => x.fn), ['mcp_request_gate'])

  let status = 'ok'
  const c = client(GATE_OK, () => page([row('n1')]))
  const gate = c.rpc.bind(c)
  c.rpc = (fn, args) => (fn === 'mcp_request_gate' ? Promise.resolve({ data: { status, consent_granted_at: null }, error: null }) as never : gate(fn, args))
  assertEquals(sc(await call(c, {})).result_state, 'records')
  status = 'session_inactive'
  assertEquals((await call(c, {})).status, 401)
  assertEquals(c.calls.filter((x) => x.fn === 'mcp_workout_notes_page').length, 1)
})

Deno.test('the authenticated owner is never taken from arguments', async () => {
  const c = client(GATE_OK, () => page([row('n1')]))
  await call(c, {}, { sub: USER_A })
  assertNotEquals(JSON.stringify(c.calls.at(-1)!.args).includes(USER_A), true)
})

Deno.test('tools/list advertises workout_notes_list read-only', async () => {
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
  const tool = msg.result.tools.find((x: { name: string }) => x.name === 'workout_notes_list')
  assertEquals(tool.annotations.readOnlyHint, true)
  assertEquals(tool.inputSchema.additionalProperties, false)
  assertEquals(tool.outputSchema.additionalProperties, false)
  assert(tool.outputSchema.required.includes('items'))
})
