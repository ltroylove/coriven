/**
 * Tests for GET /api/cron/email-poll
 *
 * Covers:
 * 1. Auth rejection (missing, empty, wrong secret)
 * 2. Successful poll run returns summary counts
 * 3. Per-user/per-provider error isolation (one failure doesn't abort the run)
 * 4. No email integrations → zero users processed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Set CRON_SECRET in env before anything imports it
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-cron-secret-value'
process.env.CRON_SECRET = TEST_SECRET

// ---------------------------------------------------------------------------
// Mock dependencies — must be before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/email/providers', () => ({
  fetchNewMessageHeaders: vi.fn(),
}))

vi.mock('@/lib/email/triage', () => ({
  triageBatch: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET } from '../route'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchNewMessageHeaders } from '@/lib/email/providers'
import { triageBatch } from '@/lib/email/triage'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) {
    headers['Authorization'] = authHeader
  }
  return new Request('http://localhost/api/cron/email-poll', { headers })
}

// Chainable Supabase mock builder
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: { data: unknown; error: null | { message: string } }): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  const methods = ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'insert', 'upsert']
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.then = (
    onfulfilled?: ((v: unknown) => unknown) | null,
    onrejected?: ((r: unknown) => unknown) | null,
  ) => Promise.resolve(result).then(onfulfilled, onrejected)
  return chain
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/email-poll — auth', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization header is Bearer with no token', async () => {
    const res = await GET(makeRequest('Bearer '))
    expect(res.status).toBe(401)
  })

  it('returns 401 when secret is wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when secret has extra characters appended', async () => {
    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}-extra`))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/cron/email-poll — successful run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with summary counts when no integrations exist', async () => {
    // DB returns empty integrations list
    const dbMock = {
      from: vi.fn().mockReturnValue(makeChain({ data: [], error: null })),
    }
    vi.mocked(createServiceClient).mockReturnValue(dbMock as never)

    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { usersProcessed: number; messagesIngested: number; errorCount: number }
    expect(body.usersProcessed).toBe(0)
    expect(body.messagesIngested).toBe(0)
    expect(body.errorCount).toBe(0)
  })

  it('processes users and returns ingested count', async () => {
    const integrations = [{ user_id: 'user-1', provider: 'gmail' }]

    // Set up a DB mock that:
    // - first .from('integrations').select().in() → returns integrations
    // - subsequent calls (checkpoint query, insert) → success
    const integrationsChain = makeChain({ data: integrations, error: null })
    const checkpointChain = makeChain({ data: null, error: null })
    const insertChain = makeChain({ data: [{ id: 'row-1' }, { id: 'row-2' }], error: null })

    let callCount = 0
    const dbMock = {
      from: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return integrationsChain // integrations query
        if (callCount === 2) return checkpointChain   // checkpoint query
        return insertChain                             // insert
      }),
    }
    vi.mocked(createServiceClient).mockReturnValue(dbMock as never)

    vi.mocked(fetchNewMessageHeaders).mockResolvedValue([
      { message_id: 'msg-1', thread_id: null, from_address: 'a@b.com', subject: 'Hello', received_at: '2024-07-03T10:00:00Z' },
      { message_id: 'msg-2', thread_id: null, from_address: 'b@c.com', subject: 'World', received_at: '2024-07-03T09:00:00Z' },
    ])

    vi.mocked(triageBatch).mockResolvedValue([
      { message_id: 'msg-1', urgency: 'normal', category: 'informational', summary: 'Hello' },
      { message_id: 'msg-2', urgency: 'low', category: 'promotional', summary: 'World' },
    ])

    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { usersProcessed: number; messagesIngested: number; errorCount: number }
    expect(body.usersProcessed).toBe(1)
    expect(body.messagesIngested).toBe(2)
    expect(body.errorCount).toBe(0)
  })

  it('counts errors without aborting when a user+provider fails', async () => {
    const integrations = [
      { user_id: 'user-1', provider: 'gmail' },
      { user_id: 'user-2', provider: 'outlook' },
    ]

    const integrationsChain = makeChain({ data: integrations, error: null })

    let callCount = 0
    const dbMock = {
      from: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return integrationsChain
        // All subsequent calls return an error to simulate a failure per user
        return makeChain({ data: null, error: { message: 'DB error' } })
      }),
    }
    vi.mocked(createServiceClient).mockReturnValue(dbMock as never)

    // fetchNewMessageHeaders throws for all users
    vi.mocked(fetchNewMessageHeaders).mockRejectedValue(new Error('Provider unavailable'))

    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { usersProcessed: number; messagesIngested: number; errorCount: number }
    expect(body.usersProcessed).toBe(2)
    expect(body.messagesIngested).toBe(0)
    // Both user-1:gmail and user-2:outlook errored
    expect(body.errorCount).toBe(2)
  })

  it('returns 500 when the integrations query itself fails', async () => {
    const dbMock = {
      from: vi.fn().mockReturnValue(makeChain({ data: null, error: { message: 'connection refused' } })),
    }
    vi.mocked(createServiceClient).mockReturnValue(dbMock as never)

    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`))
    expect(res.status).toBe(500)
  })
})
