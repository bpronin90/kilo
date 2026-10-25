// workout_notes_list (architecture 7.2): a bounded read of the user's synced
// workout-note records through kilo.mcp_workout_notes_page.
//
// The RPC is the enforcement point: it re-runs the request gate, spends the data
// quota, filters by the authenticated owner and bounds raw text and response bytes
// in SQL. This module only validates input, calls it on the request-scoped user
// client, and shapes the versioned response. It never reads a table, derives a
// session date, or parses note text.

import { z } from 'zod'
import { fitItems, provenance, toolError, toolResult, type ToolErrorCode, type ToolResult } from '../envelope.ts'
import { cancellable, type RpcCall, withTimeout } from '../gate.ts'
import { DB_CALL_TIMEOUT_MS, MAX_CURSOR_CHARS, MAX_ROWS_PER_PAGE, MAX_ROWS_WITH_RAW_TEXT } from '../limits.ts'
import type { ToolModule } from './index.ts'

export const WORKOUT_NOTES_SCHEMA = 'kilo.mcp.workout_notes_list/v1'
const DEFAULT_LIMIT = 20
const MAX_ID_CHARS = 512

const INPUT = z
  .object({
    limit: z.number().int().min(1).max(MAX_ROWS_PER_PAGE).default(DEFAULT_LIMIT),
    cursor: z.string().max(MAX_CURSOR_CHARS).optional(),
    include_raw_text: z.boolean().default(false),
  })
  .strict()

const ITEM = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    saved_at: z.string().nullable(),
    updated_at: z.string(),
    is_current: z.boolean(),
    raw_text: z.string().nullable().optional(),
    raw_text_chars: z.number().int().optional(),
    raw_text_truncated: z.boolean().optional(),
  })
  .strict()

const OUTPUT = z
  .object({
    schema: z.literal(WORKOUT_NOTES_SCHEMA),
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

interface Cursor {
  as_of: string
  u: string
  id: string
}

const toB64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && RFC3339.test(value) && !Number.isNaN(Date.parse(value))
}

export function encodeCursor(cursor: Cursor): string {
  return toB64Url(JSON.stringify({ v: 1, as_of: cursor.as_of, u: cursor.u, id: cursor.id }))
}

// Strict: exact key set, version 1, valid instants, bounded id. Anything else is
// invalid_cursor. A well-formed but forged cursor can only move the position
// within the caller's own rows, because the RPC always filters by the owner.
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
  const keys = Object.keys(v).sort().join(',')
  if (keys !== 'as_of,id,u,v' || v.v !== 1) return null
  if (!isInstant(v.as_of) || !isInstant(v.u)) return null
  // Code points, not UTF-16 units: SQL char_length bounds ids the same way.
  if (typeof v.id !== 'string' || [...v.id].length < 1 || [...v.id].length > MAX_ID_CHARS) return null
  return { as_of: v.as_of, u: v.u, id: v.id }
}

interface Item {
  id: string
  title: string | null
  saved_at: string | null
  updated_at: string
  is_current: boolean
  raw_text?: string | null
  raw_text_chars?: number
  raw_text_truncated?: boolean
}

// Explicit allowlist: a column the RPC adds later is not exposed by accident.
function toItem(row: unknown, raw: boolean): Item | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.updated_at !== 'string' || typeof r.is_current !== 'boolean') return null
  const title = r.title === null || typeof r.title === 'string' ? (r.title as string | null) : undefined
  const savedAt = r.saved_at === null || typeof r.saved_at === 'string' ? (r.saved_at as string | null) : undefined
  if (title === undefined || savedAt === undefined) return null
  const item: Item = { id: r.id, title, saved_at: savedAt, updated_at: r.updated_at, is_current: r.is_current }
  if (!raw) return item
  if (typeof r.raw_text_chars !== 'number' || typeof r.raw_text_truncated !== 'boolean') return null
  if (r.raw_text !== null && typeof r.raw_text !== 'string') return null
  return { ...item, raw_text: r.raw_text as string | null, raw_text_chars: r.raw_text_chars, raw_text_truncated: r.raw_text_truncated }
}

// Fixed SQLSTATEs raised by the RPC (migration 20261025120000). MC001 (session or
// account no longer valid) is a race with the HTTP gate: the next request is
// rejected there with a 401 challenge, so a retryable internal error is truthful.
const RPC_ERRORS: Record<string, ToolErrorCode> = {
  MC002: 'consent_required',
  MC003: 'invalid_arguments',
  MC004: 'rate_limited',
}

export const workoutHistory: ToolModule = {
  name: 'workout_notes_list',
  register(server, ctx) {
    server.registerTool(
      'workout_notes_list',
      {
        description:
          'List workout notes this account has synced to Kilo Cloud, newest first. Each item is a notebook record that may contain several training sessions; saved_at and updated_at are save and modify times, not session dates. This is a partial cloud snapshot and may omit data that exists only on the user\'s devices. Raw note text is omitted unless include_raw_text is true.',
        inputSchema: INPUT,
        outputSchema: OUTPUT,
        annotations: { readOnlyHint: true },
      },
      async (input: z.infer<typeof INPUT>): Promise<ToolResult> => {
        const { limit, include_raw_text: raw } = input
        if (limit > (raw ? MAX_ROWS_WITH_RAW_TEXT : MAX_ROWS_PER_PAGE)) return toolError('invalid_arguments')
        let cursor: Cursor | null = null
        if (input.cursor !== undefined) {
          cursor = decodeCursor(input.cursor)
          if (!cursor) return toolError('invalid_cursor')
        }

        let result: { data: unknown; error: unknown }
        try {
          const signal = AbortSignal.timeout(DB_CALL_TIMEOUT_MS)
          const call = ctx.client.rpc('mcp_workout_notes_page', {
            p_limit: limit,
            p_as_of: cursor?.as_of ?? null,
            p_after_updated_at: cursor?.u ?? null,
            p_after_id: cursor?.id ?? null,
            p_include_raw_text: raw,
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
          const item = toItem(row, raw)
          if (!item) return toolError('internal')
          items.push(item)
        }
        const asOf = page.as_of as string
        const hasMore = page.has_more

        return fitItems(items, (kept, trimmed) => {
          const last = kept[kept.length - 1]
          const more = (hasMore || trimmed) && last !== undefined
          return toolResult({
            schema: WORKOUT_NOTES_SCHEMA,
            provenance: provenance(asOf),
            result_state: items.length === 0 && !cursor ? 'no_cloud_records' : 'records',
            item_semantics:
              'Each item is a notebook record that may contain several sessions. saved_at is when the app saved it and updated_at is when the server last changed it; neither is a session date.',
            items: kept,
            next_cursor: more ? encodeCursor({ as_of: asOf, u: last.updated_at, id: last.id }) : null,
          })
        })
      },
    )
  },
}
