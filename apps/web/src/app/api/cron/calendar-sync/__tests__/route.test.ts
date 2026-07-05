import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @/lib/calendar/sync before importing the route handler.
// vi.mock is hoisted; factory must not reference top-level variables.
// ---------------------------------------------------------------------------

vi.mock('@/lib/calendar/sync', () => ({
  syncCalendars: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import route handler and the mocked module AFTER mocks are set up.
// ---------------------------------------------------------------------------

import { GET } from '../route'
import { syncCalendars } from '@/lib/calendar/sync'

const mockSyncCalendars = vi.mocked(syncCalendars)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(authHeader: string | null): Request {
  const headers = new Headers()
  if (authHeader !== null) {
    headers.set('Authorization', authHeader)
  }
  return new Request('http://localhost/api/cron/calendar-sync', { headers })
}

function setCronSecret(value: string | undefined) {
  if (value === undefined) {
    delete process.env.CRON_SECRET
  } else {
    process.env.CRON_SECRET = value
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/cron/calendar-sync — auth', () => {
  beforeEach(() => {
    mockSyncCalendars.mockReset()
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
    expect(mockSyncCalendars).not.toHaveBeenCalled()
  })

  it('returns 401 when provided secret does not match', async () => {
    const request = makeRequest('Bearer wrong-secret')
    const response = await GET(request)
    expect(response.status).toBe(401)
    expect(mockSyncCalendars).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET env is not set', async () => {
    setCronSecret(undefined)
    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)
    expect(response.status).toBe(401)
    expect(mockSyncCalendars).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/calendar-sync — successful sync', () => {
  beforeEach(() => {
    mockSyncCalendars.mockReset()
    setCronSecret('super-secret-cron-key')
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('returns 200 with counts when sync succeeds', async () => {
    mockSyncCalendars.mockResolvedValueOnce({
      usersProcessed: 3,
      eventsUpserted: 42,
      errorCount: 0,
      errors: [],
    })

    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      connectionsProcessed: 3,
      eventsUpserted: 42,
      errorCount: 0,
    })
  })

  it('calls syncCalendars exactly once with valid auth', async () => {
    mockSyncCalendars.mockResolvedValueOnce({
      usersProcessed: 1,
      eventsUpserted: 5,
      errorCount: 0,
      errors: [],
    })

    const request = makeRequest('Bearer super-secret-cron-key')
    await GET(request)

    expect(mockSyncCalendars).toHaveBeenCalledOnce()
  })

  it('returns 200 with non-zero errorCount when some connections fail', async () => {
    mockSyncCalendars.mockResolvedValueOnce({
      usersProcessed: 5,
      eventsUpserted: 20,
      errorCount: 2,
      errors: ['user-A failed: token revoked', 'user-B failed: rate limit'],
    })

    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    // Errors are logged server-side; the response body shows the count, not the messages
    expect(body.errorCount).toBe(2)
    expect(body).not.toHaveProperty('errors')
  })
})

describe('GET /api/cron/calendar-sync — unhandled error', () => {
  beforeEach(() => {
    mockSyncCalendars.mockReset()
    setCronSecret('super-secret-cron-key')
  })

  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('returns 500 when syncCalendars throws unexpectedly', async () => {
    mockSyncCalendars.mockRejectedValueOnce(new Error('Database connection lost'))

    const request = makeRequest('Bearer super-secret-cron-key')
    const response = await GET(request)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'Internal error' })
    // The raw error message must not appear in the response body
    expect(JSON.stringify(body)).not.toContain('Database connection lost')
  })
})
