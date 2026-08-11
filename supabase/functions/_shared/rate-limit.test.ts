import {
  rateLimitAllowed,
  rateLimitRefund,
} from './rate-limit.ts'

interface RpcResult {
  data: boolean | null
  error: { code?: string; message: string } | null
}

function fakeClient(result: RpcResult) {
  return {
    rpc: () => Promise.resolve(result),
  }
}

Deno.test('durable limiter returns the database decision', async () => {
  const allowed = await rateLimitAllowed(
    fakeClient({ data: true, error: null }) as never,
    'export:user:sensitive-user-id',
    1,
    1000,
    'deny',
  )
  if (!allowed) throw new Error('expected database allow decision')
})

Deno.test('durable limiter honors explicit deny policy without logging identifiers', async () => {
  const original = console.error
  const logs: unknown[][] = []
  console.error = (...args: unknown[]) => logs.push(args)
  try {
    const allowed = await rateLimitAllowed(
      fakeClient({
        data: null,
        error: {
          code: '08006',
          message: 'failed for export:user:sensitive-user-id',
        },
      }) as never,
      'export:user:sensitive-user-id',
      1,
      1000,
      'deny',
    )
    if (allowed) throw new Error('deny policy must fail closed')
    const rendered = JSON.stringify(logs)
    if (rendered.includes('sensitive-user-id')) {
      throw new Error('raw bucket identifier reached logs')
    }
    if (!rendered.includes('08006')) throw new Error('bounded error code was not logged')
  } finally {
    console.error = original
  }
})

Deno.test('durable limiter honors an explicitly selected allow policy', async () => {
  const original = console.error
  console.error = () => undefined
  try {
    const allowed = await rateLimitAllowed(
      fakeClient({ data: null, error: { code: '08006', message: 'offline' } }) as never,
      'low-risk:anonymous:raw-ip',
      1,
      1000,
      'allow',
    )
    if (!allowed) throw new Error('explicit allow policy must fail open')
  } finally {
    console.error = original
  }
})

Deno.test('refund failures never log raw bucket identifiers or upstream messages', async () => {
  const original = console.error
  const logs: unknown[][] = []
  console.error = (...args: unknown[]) => logs.push(args)
  try {
    await rateLimitRefund(
      fakeClient({
        data: null,
        error: { code: 'XX000', message: 'refund failed for raw-user-id' },
      }) as never,
      'export:user:raw-user-id',
    )
    const rendered = JSON.stringify(logs)
    if (rendered.includes('raw-user-id')) throw new Error('raw bucket reached refund logs')
    if (rendered.includes('refund failed for')) throw new Error('upstream message reached logs')
    if (!rendered.includes('XX000')) throw new Error('bounded error code was not logged')
  } finally {
    console.error = original
  }
})
