// @vitest-environment node
/**
 * Unit tests for POST /api/cron/weekly-review
 * Wave 7.3.1 — Cron endpoint: auth, success, per-user error isolation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock assembly + storage
vi.mock('@/lib/jobs/weekly-review', () => ({
  assembleWeeklyReview: vi.fn(),
  storeWeeklyReview: vi.fn(),
  getIsoWeekStart: vi.fn().mockReturnValue('2026-07-06'),
}))

// Mock Supabase service client
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

const { assembleWeeklyReview, storeWeeklyReview } = await import('@/lib/jobs/weekly-review')
const { createServiceClient } = await import('@/lib/supabase/server')
const { POST } = await import('../route')

const VALID_SECRET = 'test-cron-secret-abc123'

function makeRequest(opts: { secret?: string | null; method?: string } = {}) {
  const headers = new Headers()
  if (opts.secret !== null) {
    headers.set('Authorization', `Bearer ${opts.secret ?? VALID_SECRET}`)
  }
  return new Request('http://localhost/api/cron/weekly-review', {
    method: opts.method ?? 'POST',
    headers,
  })
}

function makeProfilesClient(profiles: Array<{ id: string }>) {
  const single = vi.fn().mockResolvedValue({ data: profiles, error: null })
  const select = vi.fn().mockReturnValue({ data: profiles, error: null, then: single.mockResolvedValue.bind(single) })

  // We need the pattern: .from('profiles').select('id') → resolves { data, error }
  const selectFn = vi.fn().mockResolvedValue({ data: profiles, error: null })
  return {
    from: vi.fn().mockReturnValue({ select: selectFn }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
  vi.mocked(assembleWeeklyReview).mockResolvedValue({
    wins: [{ taskId: 't1', title: 'Win A' }],
    blockers: [],
    nextWeek: [],
  })
  vi.mocked(storeWeeklyReview).mockResolvedValue(undefined)
})

describe('POST /api/cron/weekly-review', () => {
  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  it('returns 401 on missing Authorization header', async () => {
    const req = makeRequest({ secret: null })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 on wrong secret', async () => {
    const req = makeRequest({ secret: 'wrong-secret' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  // ---------------------------------------------------------------------------
  // Success
  // ---------------------------------------------------------------------------

  it('returns 200 with usersProcessed and reviewsStored on valid secret', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeProfilesClient([{ id: 'user-001' }, { id: 'user-002' }]) as never,
    )

    const req = makeRequest()
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.usersProcessed).toBe(2)
    expect(body.reviewsStored).toBe(2)
  })

  it('calls assembleWeeklyReview and storeWeeklyReview for each user', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeProfilesClient([{ id: 'user-003' }]) as never,
    )

    const req = makeRequest()
    await POST(req)

    expect(vi.mocked(assembleWeeklyReview)).toHaveBeenCalledWith('user-003', expect.any(Date))
    expect(vi.mocked(storeWeeklyReview)).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // Per-user error isolation
  // ---------------------------------------------------------------------------

  it('continues processing other users when one user fails', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeProfilesClient([{ id: 'user-fail' }, { id: 'user-ok' }]) as never,
    )

    // First user fails, second succeeds
    vi.mocked(assembleWeeklyReview)
      .mockRejectedValueOnce(new Error('DB error for user-fail'))
      .mockResolvedValueOnce({ wins: [], blockers: [], nextWeek: [] })

    const req = makeRequest()
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.usersProcessed).toBe(2)
    expect(body.reviewsStored).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // Profiles fetch error
  // ---------------------------------------------------------------------------

  it('returns 500 when profiles query fails', async () => {
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB offline' } }),
      }),
    } as never)

    const req = makeRequest()
    const res = await POST(req)
    expect(res.status).toBe(500)
  })
})
