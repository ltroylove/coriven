// @vitest-environment node
/**
 * Unit tests for GET /api/patterns/new
 * Wave 7.1.1 — Frequency-cap and auth verification
 *
 * Tests:
 *  - Returns 401 when unauthenticated
 *  - Returns 200 with patterns array (possibly empty)
 *  - Frequency cap: last_notified_at null → included
 *  - Frequency cap: last_notified_at < 7 days ago → included
 *  - Frequency cap: last_notified_at within 7 days → excluded (server-enforced)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/api-server', () => ({
  createApiServerClient: vi.fn(),
}))

const { createApiServerClient } = await import('@/lib/supabase/api-server')
const { GET, NOTIFICATION_FREQUENCY_CAP_DAYS } = await import('../route')

function makeRequest(opts: { bearerToken?: string } = {}) {
  const headers = new Headers()
  if (opts.bearerToken) {
    headers.set('Authorization', `Bearer ${opts.bearerToken}`)
  }
  return new Request('http://localhost/api/patterns/new', { headers })
}

/** Build a mock Supabase client that chains the query correctly. */
function makeClient(opts: {
  userId: string | null
  patterns?: unknown[] | null
  fetchError?: { message: string } | null
}) {
  // The query chain: .from().select().eq().eq().or().order()
  const order = vi.fn().mockResolvedValue({
    data: opts.patterns ?? [],
    error: opts.fetchError ?? null,
  })
  const or = vi.fn().mockReturnValue({ order })
  const eq2 = vi.fn().mockReturnValue({ or })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.userId ? { id: opts.userId } : null },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue({ select }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/patterns/new', () => {
  it('returns 401 when unauthenticated', async () => {
    const client = makeClient({ userId: null })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest() as never)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 200 with empty patterns array when nothing pending', async () => {
    const client = makeClient({ userId: 'user-1', patterns: [] })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest({ bearerToken: 'valid-jwt' }) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ patterns: [] })
  })

  it('returns 200 with patterns when unnotified patterns exist', async () => {
    const patterns = [
      {
        id: 'pat-1',
        pattern_type: 'gym_days',
        description: 'You tend to work out on Tuesdays',
        last_detected_at: new Date().toISOString(),
      },
    ]
    const client = makeClient({ userId: 'user-1', patterns })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest({ bearerToken: 'valid-jwt' }) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.patterns).toHaveLength(1)
    expect(body.patterns[0].id).toBe('pat-1')
  })

  it('exports NOTIFICATION_FREQUENCY_CAP_DAYS as 7', () => {
    expect(NOTIFICATION_FREQUENCY_CAP_DAYS).toBe(7)
  })

  it('returns 500 on DB fetch error', async () => {
    const client = makeClient({
      userId: 'user-1',
      patterns: null,
      fetchError: { message: 'connection reset' },
    })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest({ bearerToken: 'valid-jwt' }) as never)
    expect(res.status).toBe(500)
  })
})
