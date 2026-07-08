// @vitest-environment node
/**
 * Integration tests for POST /api/cron/detect-patterns
 * Wave 7.1.1 — Pattern Detection cron endpoint
 *
 * Tests:
 *  - Returns 401 on missing CRON_SECRET header
 *  - Returns 401 on wrong secret
 *  - Returns 200 with summary on valid secret
 *  - Returns 500 on job failure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/jobs/detect-patterns', () => ({
  runPatternDetection: vi.fn(),
}))

const { createServiceClient } = await import('@/lib/supabase/server')
const { runPatternDetection } = await import('@/lib/jobs/detect-patterns')
const { POST } = await import('../route')

const TEST_SECRET = 'test-cron-secret-abc123'

function makeRequest(opts: { authHeader?: string } = {}) {
  const headers = new Headers()
  if (opts.authHeader !== undefined) {
    headers.set('Authorization', opts.authHeader)
  }
  return new Request('http://localhost/api/cron/detect-patterns', {
    method: 'POST',
    headers,
  })
}

function makeDbClient(profiles: Array<{ id: string }> = []) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: profiles, error: null }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', TEST_SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/cron/detect-patterns', () => {
  // ---------------------------------------------------------------------------
  // Authorization
  // ---------------------------------------------------------------------------

  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when Bearer token is wrong', async () => {
    const res = await POST(makeRequest({ authHeader: 'Bearer wrong-secret' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when CRON_SECRET env var is not set', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await POST(makeRequest({ authHeader: `Bearer ${TEST_SECRET}` }))
    expect(res.status).toBe(401)
  })

  // ---------------------------------------------------------------------------
  // Success path
  // ---------------------------------------------------------------------------

  it('returns 200 with summary when valid secret and no users', async () => {
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient([]) as never)

    const res = await POST(makeRequest({ authHeader: `Bearer ${TEST_SECRET}` }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      usersProcessed: 0,
      patternsWritten: 0,
      patternsDeactivated: 0,
    })
  })

  it('returns 200 with correct summary when users processed', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeDbClient([{ id: 'user-1' }, { id: 'user-2' }]) as never,
    )
    vi.mocked(runPatternDetection)
      .mockResolvedValueOnce({ userId: 'user-1', patternsWritten: 2, patternsDeactivated: 0 })
      .mockResolvedValueOnce({ userId: 'user-2', patternsWritten: 1, patternsDeactivated: 1 })

    const res = await POST(makeRequest({ authHeader: `Bearer ${TEST_SECRET}` }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.usersProcessed).toBe(2)
    expect(body.patternsWritten).toBe(3)
    expect(body.patternsDeactivated).toBe(1)
  })

  it('continues processing other users when one fails (per-user error isolation)', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeDbClient([{ id: 'user-ok' }, { id: 'user-err' }]) as never,
    )
    vi.mocked(runPatternDetection)
      .mockResolvedValueOnce({ userId: 'user-ok', patternsWritten: 1, patternsDeactivated: 0 })
      .mockRejectedValueOnce(new Error('DB connection failed'))

    const res = await POST(makeRequest({ authHeader: `Bearer ${TEST_SECRET}` }))
    // Job continues despite one error — returns 200 with what succeeded
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.usersProcessed).toBe(2)
    expect(body.patternsWritten).toBe(1) // only the successful user
  })

  // ---------------------------------------------------------------------------
  // Failure path
  // ---------------------------------------------------------------------------

  it('returns 500 when profile fetch fails', async () => {
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }),
    } as never)

    const res = await POST(makeRequest({ authHeader: `Bearer ${TEST_SECRET}` }))
    expect(res.status).toBe(500)
  })

  it('returns 500 with generic error body (no raw error string leakage)', async () => {
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'secret-internal-connection-details' },
        }),
      }),
    } as never)

    const res = await POST(makeRequest({ authHeader: `Bearer ${TEST_SECRET}` }))
    expect(res.status).toBe(500)
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('secret-internal-connection-details')
  })
})
