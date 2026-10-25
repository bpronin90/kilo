// weight_entries_list (architecture 7.3): a bounded read of the user's synced
// weight entries through kilo.mcp_weight_entries_page.
//
// The RPC is the enforcement point: it re-runs the request gate, spends the data
// quota, filters by the authenticated owner and bounds the response bytes in SQL.
// This module only validates input, calls it on the request-scoped user client,
// and shapes the versioned response. It never reads a table, converts a unit,
// shifts a date, or computes a trend.

import { z } from 'zod'
import { fitItems, provenance, toolError, toolResult, type ToolErrorCode, type ToolResult } from '../envelope.ts'
import { cancellable, type RpcCall, withTimeout } from '../gate.ts'
import { DB_CALL_TIMEOUT_MS, MAX_CURSOR_CHARS, MAX_ROWS_PER_PAGE } from '../limits.ts'
import type { ToolModule } from './index.ts'

export const WEIGHT_ENTRIES_SCHEMA = 'kilo.mcp.weight_entries_list/v1'
const DEFAULT_LIMIT = 50
const MAX_ID_CHARS = 512
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && RFC3339.test(value) && !Number.isNaN(Date.parse(value))
}

const INPUT = z
  .object({
    limit: z.number().int().min(1).max(MAX_ROWS_PER_PAGE).default(DEFAULT_LIMIT),
    cursor: z.string().max(MAX_CURSOR_CHARS).optional(),
    logged_from: z.string().max(64).optional(),
    logged_to: z.string().max(64).optional(),
  })
  .strict()

const ITEM = z
  .object({
    id: z.string(),
    value: z.number(),
    unit: z.literal('lb'),
    original_unit: z.null(),
    original_unit_status: z.literal('unavailable'),
    date: z.string().nullable(),
    logged_at: z.string().nullable(),
  })
  .strict()

const OUTPUT = z
  .object({
    schema: z.literal(WEIGHT_ENTRIES_SCHEMA),
    provenance: z
      .object({
        source: z.literal('kilo_cloud_snapshot'),
        coverage: z.literal('unknown'),
        snapshot_as_of: z.string().nullable(),
        note: z.string(),
      })
      .strict(),
    result_state: z.enum(['records', 'no_cloud_records']),
    item_semantics: z.string(),
    items: z.array(ITEM),
    next_cursor: z.string().nullable(),
  })
  .strict()

type Cursor = { phase: 'dated'; l: string; id: string } | { phase: 'undated'; l: null; id: string }

const toB64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function encodeCursor(cursor: Cursor): string {
  return toB64Url(JSON.stringify({ v: 1, phase: cursor.phase, l: cursor.l, id: cursor.id }))
}

// Strict: exact key set, version 1, a phase that agrees with `l`, bounded id.
// Anything else is invalid_cursor. A well-formed but forged cursor can only move
// the position within the caller's own rows, because the RPC always filters by
// the owner.
export function decodeCursor(text: string): Cursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  let value: unknown
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (Object.keys(v).sort().join(',') !== 'id,l,phase,v' || v.v !== 1) return null
  // Code points, not UTF-16 units: SQL char_length bounds ids the same way.
  // The table permits an empty id, so an empty string is a valid position.
  if (typeof v.id !== 'string' || [...v.id].length > MAX_ID_CHARS) return null
  if (v.phase === 'dated' && isInstant(v.l)) return { phase: 'dated', l: v.l, id: v.id }
  if (v.phase === 'undated' && v.l === null) return { phase: 'undated', l: null, id: v.id }
  return null
}

interface Item {
  id: string
  value: number
  unit: 'lb'
  original_unit: null
  original_unit_status: 'unavailable'
  date: string | null
  logged_at: string | null
}

// Explicit allowlist: a column the RPC adds later (note, saved_at) is not exposed
// by accident. `unit` is a constant of the storage contract, never read from the
// row or the user's preference. `date` is passed through verbatim.
function toItem(row: unknown): Item | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.value !== 'number' || !Number.isFinite(r.value)) return null
  const date = r.date === null || (typeof r.date === 'string' && DATE_ONLY.test(r.date)) ? (r.date as string | null) : undefined
  const loggedAt = r.logged_at === null || isInstant(r.logged_at) ? (r.logged_at as string | null) : undefined
  if (date === undefined || loggedAt === undefined) return null
  return { id: r.id, value: r.value, unit: 'lb', original_unit: null, original_unit_status: 'unavailable', date, logged_at: loggedAt }
}

// Fixed SQLSTATEs raised by the RPC (migration 20261025130000). MC001 (session or
// account no longer valid) is a race with the HTTP gate: the next request is
// rejected there with a 401 challenge, so a retryable internal error is truthful.
const RPC_ERRORS: Record<string, ToolErrorCode> = {
  MC002: 'consent_required',
  MC003: 'invalid_arguments',
  MC004: 'rate_limited',
}

// Both bounds or neither; offsets are required so no timezone is assumed.
function parseRange(from?: string, to?: string): { from: string; to: string } | null | 'invalid' {
  if (from === undefined && to === undefined) return null
  if (from === undefined || to === undefined || !isInstant(from) || !isInstant(to)) return 'invalid'
  const span = Date.parse(to) - Date.parse(from)
  return span > 0 && span <= MAX_RANGE_MS ? { from, to } : 'invalid'
}

export const weightHistory: ToolModule = {
  name: 'weight_entries_list',
  register(server, ctx) {
    server.registerTool(
      'weight_entries_list',
      {
        description:
          'List body-weight entries this account has synced to Kilo Cloud, newest logged first. Every value is in pounds (lb), normalized by the app before storage; the unit originally typed is not stored and is reported as unavailable. date is the entry calendar date and logged_at the recorded instant; either may be null, and entries without logged_at are listed after dated ones and are excluded when logged_from/logged_to is used (range is [logged_from, logged_to), RFC 3339 with offset, at most 366 days). This is a partial cloud snapshot and may omit data that exists only on the user\'s devices.',
        inputSchema: INPUT,
        outputSchema: OUTPUT,
        annotations: { readOnlyHint: true },
      },
      async (input: z.infer<typeof INPUT>): Promise<ToolResult> => {
        const range = parseRange(input.logged_from, input.logged_to)
        if (range === 'invalid') return toolError('invalid_arguments')
        let cursor: Cursor | null = null
        if (input.cursor !== undefined) {
          cursor = decodeCursor(input.cursor)
          if (!cursor || (range && cursor.phase === 'undated')) return toolError('invalid_cursor')
        }

        let result: { data: unknown; error: unknown }
        try {
          const signal = AbortSignal.timeout(DB_CALL_TIMEOUT_MS)
          const call = ctx.client.rpc('mcp_weight_entries_page', {
            p_limit: input.limit,
            p_phase: cursor?.phase ?? null,
            p_after_logged_at: cursor?.l ?? null,
            p_after_id: cursor?.id ?? null,
            p_logged_from: range?.from ?? null,
            p_logged_to: range?.to ?? null,
          })
          result = await withTimeout(Promise.resolve(cancellable(call as RpcCall, signal)), DB_CALL_TIMEOUT_MS)
        } catch {
          return toolError('timeout')
        }
        if (result.error) {
          const code = (result.error as { code?: unknown }).code
          return toolError(typeof code === 'string' && code in RPC_ERRORS ? RPC_ERRORS[code] : 'internal')
        }

        const page = result.data as { as_of?: unknown; has_more?: unknown; items?: unknown } | null
        if (!page || !isInstant(page.as_of) || typeof page.has_more !== 'boolean' || !Array.isArray(page.items)) {
          return toolError('internal')
        }
        const items: Item[] = []
        for (const row of page.items) {
          const item = toItem(row)
          if (!item) return toolError('internal')
          items.push(item)
        }
        const asOf = page.as_of as string
        const hasMore = page.has_more

        return fitItems(items, (kept, trimmed) => {
          const last = kept[kept.length - 1]
          const more = (hasMore || trimmed) && last !== undefined
          const next: Cursor | null = !more
            ? null
            : last.logged_at === null
              ? { phase: 'undated', l: null, id: last.id }
              : { phase: 'dated', l: last.logged_at, id: last.id }
          return toolResult({
            schema: WEIGHT_ENTRIES_SCHEMA,
            provenance: provenance(asOf),
            result_state: items.length === 0 && !cursor ? 'no_cloud_records' : 'records',
            item_semantics:
              'value is the stored weight in pounds (lb), converted by the app before sync; the originally entered unit is unavailable and must not be inferred. date and logged_at are as recorded by the app and are never shifted or derived; null means unknown. no_cloud_records means no matching rows in the cloud snapshot, not that the user has no weight history.',
            items: kept,
            next_cursor: next ? encodeCursor(next) : null,
          })
        })
      },
    )
  },
}
