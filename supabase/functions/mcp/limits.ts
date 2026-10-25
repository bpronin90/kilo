// Hard limits for the MCP function (docs/architecture/mcp-mvp.md section 8).
// One place so the gates, the tools and the tests cannot drift apart.

export const MAX_REQUEST_BYTES = 64 * 1024
export const MAX_RESPONSE_BYTES = 256 * 1024
export const REQUEST_TIMEOUT_MS = 10_000
export const DB_CALL_TIMEOUT_MS = 3_000

export const MAX_ROWS_PER_PAGE = 100
export const MAX_ROWS_WITH_RAW_TEXT = 25
export const MAX_RAW_TEXT_CHARS = 4000
export const MAX_CURSOR_CHARS = 6144

export interface RateWindow {
  suffix: string
  max: number
  windowMs: number
}

// Pre-auth, per client IP: bounds token-guessing and parse cost.
export const PRE_AUTH_WINDOW: RateWindow = { suffix: 'ip', max: 120, windowMs: 60_000 }

// Per user, any MCP method. Data reads have a separate, tighter quota enforced
// inside the page RPCs so a direct PostgREST call spends the same budget.
export const USER_WINDOWS: readonly RateWindow[] = [
  { suffix: 'm', max: 60, windowMs: 60_000 },
  { suffix: 'h', max: 1000, windowMs: 3_600_000 },
]
