import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @/lib/jobs/meeting-prep before importing the route handler.
// vi.mock is hoisted; factory must not reference top-level variables.
// ---------------------------------------------------------------------------

vi.mock('@/lib/jobs/meeting-prep', () => ({
  generateDueBriefs: vi.fn(),
}))

import { GET } from '../route'
import { generateDueBriefs } from '@/lib/jobs/meeting-prep'

const mockGenerateDueBriefs = vi.mocked(generateDueBriefs)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(authHeader: string | null): Request {
  const headers = new Headers()
  if (authHeader !== null) {
    headers.set('Authorization', authHeader)
  }
  return new Request('http://localhost/api/cron/meeting-prep', { headers })
}

function setCronSecret(value: string | undefined) {
  if (value === undefined) {
    delete process.env.CRON_SECRET
  } else {
    process.env.CRON_SECRET = value
  }
}

// ---------------------------------------------------------------------------
// Auth tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/meeting-prep — auth', () => {
  beforeEach(() => {
    mockGenerateDueBriefs.mockReset()
    setCronSecret('super-secret-cron-key')
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('returns 401 when Authorization header is missing', async () => {
    const request = makeRequest(null)
    const response = await GET(request)

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockGenerateDueBriefs).not.toHaveBeenCalled()
  })

  it('returns 401 when provided secret does not match', async () => {
    const request = makeRequest('Bearer wrong-secret')
    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(mockGenerateDueBriefs).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET env is not set', async () => {
    setCronSecret(undefined)
    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(mockGenerateDueBriefs).not.toHaveBeenCalled()
  })

  it('returns 200 when secret is sent without Bearer prefix (replace strips nothing, raw secret matches)', async () => {
    // The route does: authHeader?.replace('Bearer ', '') which on
    // 'super-secret-cron-key' returns 'super-secret-cron-key' unchanged.
    // timingSafeEqual then compares it to the env secret — lengths match, passes.
    // This documents the auth surface: callers must use Bearer OR the raw secret.
    mockGenerateDueBriefs.mockResolvedValueOnce({
      eventsConsidered: 0,
      briefsCreated: 0,
      errorCount: 0,
    })
    const request = makeRequest('super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Successful invocation tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/meeting-prep — successful run', () => {
  beforeEach(() => {
    mockGenerateDueBriefs.mockReset()
    setCronSecret('super-secret-cron-key')
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('returns 200 with counts when generateDueBriefs succeeds', async () => {
    mockGenerateDueBriefs.mockResolvedValueOnce({
      eventsConsidered: 3,
      briefsCreated: 2,
      errorCount: 0,
    })

    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      eventsConsidered: 3,
      briefsCreated: 2,
      errorCount: 0,
    })
  })

  it('calls generateDueBriefs exactly once with valid auth', async () => {
    mockGenerateDueBriefs.mockResolvedValueOnce({
      eventsConsidered: 1,
      briefsCreated: 1,
      errorCount: 0,
    })

    const request = makeRequest('Bearer super-secret-cron-key')
    await GET(request)

    expect(mockGenerateDueBriefs).toHaveBeenCalledOnce()
  })

  it('returns 200 with non-zero errorCount when some events fail', async () => {
    mockGenerateDueBriefs.mockResolvedValueOnce({
      eventsConsidered: 5,
      briefsCreated: 3,
      errorCount: 2,
    })

    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.errorCount).toBe(2)
    expect(body.briefsCreated).toBe(3)
  })

  it('returns zero counts when no events are in the look-ahead window', async () => {
    mockGenerateDueBriefs.mockResolvedValueOnce({
      eventsConsidered: 0,
      briefsCreated: 0,
      errorCount: 0,
    })

    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ eventsConsidered: 0, briefsCreated: 0, errorCount: 0 })
  })
})

// ---------------------------------------------------------------------------
// Unhandled error tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/meeting-prep — unhandled error', () => {
  beforeEach(() => {
    mockGenerateDueBriefs.mockReset()
    setCronSecret('super-secret-cron-key')
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('returns 500 when generateDueBriefs throws unexpectedly', async () => {
    mockGenerateDueBriefs.mockRejectedValueOnce(new Error('Database connection lost'))

    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'Internal error' })
    // Raw error message must not appear in the response body
    expect(JSON.stringify(body)).not.toContain('Database connection lost')
  })
})
