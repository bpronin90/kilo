// Versioned response envelope shared by every MCP tool (architecture section 7).
//
// Protocol failures (token, grant, session) are HTTP 401 with a challenge and
// never reach this module. Everything here is a *tool* result: success carries
// provenance, failure carries a fixed message. Error text is deliberately never
// derived from a database error, an argument or a row.

import { MAX_RESPONSE_BYTES } from './limits.ts'

export const SERVER_VERSION = '0.1.0'

export const ERROR_SCHEMA = 'kilo.mcp.error/v1'

export const TOOL_ERRORS = {
  invalid_arguments: { message: 'The arguments are not valid for this tool.', retryable: false },
  invalid_cursor: { message: 'The cursor is not valid. Start again without a cursor.', retryable: false },
  consent_required: {
    message: 'Cloud Sync health consent is required in Kilo before this data can be read.',
    retryable: false,
  },
  rate_limited: { message: 'Too many requests. Try again later.', retryable: true },
  response_too_large: { message: 'The response is too large. Request fewer items.', retryable: false },
  timeout: { message: 'The request took too long. Try again.', retryable: true },
  internal: { message: 'Something went wrong. Try again later.', retryable: true },
} as const

export type ToolErrorCode = keyof typeof TOOL_ERRORS

export interface ToolResult {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export function provenance(snapshotAsOf: string | null) {
  return {
    source: 'kilo_cloud_snapshot',
    // The server cannot observe local-only data or a running sync, so coverage
    // is never claimed. "no_cloud_records" means zero rows in the cloud snapshot.
    coverage: 'unknown',
    snapshot_as_of: snapshotAsOf,
    note: 'Only data this account has synced to Kilo Cloud. Devices may hold unsynced or local-only data.',
  } as const
}

export function toolResult(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload }
}

export function toolError(code: ToolErrorCode): ToolResult {
  const { message, retryable } = TOOL_ERRORS[code]
  const payload = { schema: ERROR_SCHEMA, code, message, retryable }
  return { ...toolResult(payload), isError: true }
}

const encoder = new TextEncoder()

// A tool result is sent twice (structured content plus a text block), so the
// transmitted size is about double the payload.
export function resultBytes(result: ToolResult): number {
  return encoder.encode(JSON.stringify(result)).length
}

// Drops trailing items until the serialized result fits. One item always fits
// by construction (see the SQL byte budget), so a single remaining item is
// returned as is. `build` receives the kept items and whether any were dropped
// so the caller can recompute `next_cursor`.
export function fitItems<T>(
  items: readonly T[],
  build: (kept: readonly T[], trimmed: boolean) => ToolResult,
  maxBytes: number = MAX_RESPONSE_BYTES,
): ToolResult {
  let kept = items
  let result = build(kept, false)
  while (kept.length > 1 && resultBytes(result) > maxBytes) {
    kept = kept.slice(0, kept.length - 1)
    result = build(kept, true)
  }
  return resultBytes(result) > maxBytes ? toolError('response_too_large') : result
}
