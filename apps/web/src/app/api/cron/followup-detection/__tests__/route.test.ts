/**
 * Tests for GET /api/cron/followup-detection
 *
 * Covers:
 * 1. Auth rejection — missing, empty, wrong secret
 * 2. Successful detection run returns structured summary
 * 3. detectFollowUps error → 500 response
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Set CRON_SECRET before anything imports it
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-followup-cron-secret'
process.env.CRON_SECRET = TEST_SECRET

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/lib/email/followup', () => ({
  detectFollowUps: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET } from '../route'
import { detectFollowUps } from '@/lib/email/followup'

const mockDetectFollowUps = vi.mocked(detectFollowUps)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {}
  if (authHeader !== undefined) {
    headers['Authorization'] = authHeader
  }
  return new Request('http://localhost/api/cron/followup-detection', { headers })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/cron/followup-detection — auth rejection', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockDetectFollowUps).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is empty string', async () => {
    const res = await GET(makeRequest(''))
    expect(res.status).toBe(401)
    expect(mockDetectFollowUps).not.toHaveBeenCalled()
  })

  it('returns 401 when secret is wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'))
    expect(res.status).toBe(401)
    expect(mockDetectFollowUps).not.toHaveBeenCalled()
  })

  it('accepts the raw secret when passed without Bearer prefix (replace is a no-op)', async () => {
    // The route does: authHeader.replace('Bearer ', '') which is a no-op when there is no
    // "Bearer " prefix — the raw secret is compared directly and still matches.
    // This documents the intentional behaviour: both "Bearer <secret>" and
    // the raw secret string work (Vercel Cron sends "Bearer <secret>"; this covers both).
    mockDetectFollowUps.mockResolvedValue({
      usersProcessed: 0,
      candidatesDetected: 0,
      candidatesCleared: 0,
      errorCount: 0,
    })

    const res = await GET(makeRequest(TEST_SECRET))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/cron/followup-detection — successful run', () => {
  it('returns 200 with structured summary on success', async () => {
    mockDetectFollowUps.mockResolvedValue({
      usersProcessed: 3,
      candidatesDetected: 5,
      candidatesCleared: 2,
      errorCount: 0,
    })

    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({
      usersProcessed: 3,
      candidatesDetected: 5,
      candidatesCleared: 2,
      errorCount: 0,
    })
  })

  it('returns 200 even when errorCount > 0 (partial success)', async () => {
    mockDetectFollowUps.mockResolvedValue({
      usersProcessed: 2,
      candidatesDetected: 1,
      candidatesCleared: 0,
      errorCount: 1,
    })

    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.errorCount).toBe(1)
    expect(body.usersProcessed).toBe(2)
  })
})

describe('GET /api/cron/followup-detection — detectFollowUps throws', () => {
  it('returns 500 when detectFollowUps throws unexpectedly', async () => {
    mockDetectFollowUps.mockRejectedValue(new Error('Unexpected failure'))

    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`))
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body).toEqual({ error: 'Internal error' })
  })
})
