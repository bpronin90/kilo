// Tool registry. Later issues (#1627 workout history, #1628 weight history) add
// one module each and one line to TOOLS; nothing here advertises a tool that does
// not exist yet.

import type { McpServer } from '@modelcontextprotocol/server'
import type { McpIdentity } from '../auth.ts'
import type { RpcClient } from '../gate.ts'
import { weightHistory } from './weight-history.ts'
import { whoami } from './whoami.ts'
import { workoutHistory } from './workout-history.ts'

// Everything a tool is allowed to touch. Deliberately small: the request-scoped
// *user* client (RLS applies, restricted to the kilo schema) and facts the gates
// already established. There is no admin client, no raw request and no token, so
// a tool cannot widen its own reach.
export interface ToolContext {
  readonly client: RpcClient
  readonly identity: McpIdentity
  readonly consent: 'granted' | 'not_granted'
  readonly grantedAt: string | null
}

export interface ToolModule {
  readonly name: string
  register(server: McpServer, ctx: ToolContext): void
}

export const TOOLS: readonly ToolModule[] = [whoami, workoutHistory, weightHistory]

export function registerTools(server: McpServer, ctx: ToolContext, tools: readonly ToolModule[] = TOOLS): void {
  for (const tool of tools) tool.register(server, ctx)
}
