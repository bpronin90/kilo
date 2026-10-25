// whoami (architecture 7.4): the verified identity and connection state, nothing
// else. No email, name or profile data, and no database read.

import { z } from 'zod'
import { provenance, SERVER_VERSION, toolResult } from '../envelope.ts'
import type { ToolModule } from './index.ts'

export const WHOAMI_SCHEMA = 'kilo.mcp.whoami/v1'

export const whoami: ToolModule = {
  name: 'whoami',
  register(server, ctx) {
    server.registerTool(
      'whoami',
      {
        description: 'Show which Kilo account and connected client this session is using, and whether cloud health consent is active.',
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true },
      },
      () =>
        toolResult({
          schema: WHOAMI_SCHEMA,
          provenance: provenance(null),
          user_id: ctx.identity.userId,
          client_id: ctx.identity.clientId,
          health_consent: ctx.consent,
          server_version: SERVER_VERSION,
        }),
    )
  },
}
