// Request gate: one RPC on the request-scoped *user* client (architecture 5.1).
//
// `kilo.mcp_request_gate()` reads auth.users / auth.sessions /
// auth.refresh_tokens / consent_state and returns a status only. It is the early
// rejection; every data RPC re-runs the same status inside the statement that
// reads rows, so this call is never the enforcement point.

import { DB_CALL_TIMEOUT_MS } from './limits.ts'

export type GateStatus =
  | 'ok'
  | 'session_inactive'
  | 'account_missing'
  | 'consent_stale'
  | 'consent_required'

export type GateOutcome =
  | { kind: 'ok' | 'consent_required'; grantedAt: string | null }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }

// The minimum of the Supabase client the gate needs, so tests can use a double.
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}

const STATUSES: readonly string[] = ['ok', 'session_inactive', 'account_missing', 'consent_stale', 'consent_required']

export async function runGate(client: RpcClient, timeoutMs: number = DB_CALL_TIMEOUT_MS): Promise<GateOutcome> {
  let result: { data: unknown; error: unknown }
  try {
    result = await withTimeout(Promise.resolve(client.rpc('mcp_request_gate')), timeoutMs)
  } catch {
    return { kind: 'unavailable' }
  }
  if (result.error) return { kind: 'unavailable' }

  const data = result.data as { status?: unknown; consent_granted_at?: unknown } | null
  const status = typeof data?.status === 'string' ? data.status : ''
  // Anything unrecognised is a lookup failure, never an implicit allow.
  if (!STATUSES.includes(status)) return { kind: 'unavailable' }

  const grantedAt = typeof data?.consent_granted_at === 'string' ? data.consent_granted_at : null
  switch (status as GateStatus) {
    case 'ok':
      return { kind: 'ok', grantedAt }
    case 'consent_required':
      return { kind: 'consent_required', grantedAt: null }
    default:
      return { kind: 'unauthorized' }
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
