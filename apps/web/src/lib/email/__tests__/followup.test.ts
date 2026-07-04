/**
 * Tests for apps/web/src/lib/email/followup.ts
 *
 * Covers:
 * 1. 3-day boundary logic — exactly at/below threshold not flagged, above flagged
 * 2. Reply detection clears an existing candidate
 * 3. Dismissed candidates are skipped (not re-flagged, not cleared)
 * 4. Upsert idempotency — same thread upserted twice produces one candidate
 * 5. Per-user fault isolation — error in one user doesn't abort others
 * 6. No connected token → skip silently (detected = 0)
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/integrations/nango', () => ({
  getProviderToken: vi.fn(),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { detectFollowUps } from '../followup'
import { createServiceClient } from '@/lib/supabase/server'
import { getProviderToken } from '@/lib/integrations/nango'

const mockCreateServiceClient = vi.mocked(createServiceClient)
const mockGetProviderToken = vi.mocked(getProviderToken)

// ---------------------------------------------------------------------------
// Helpers — time
// ---------------------------------------------------------------------------

const NOW = new Date('2026-07-04T12:00:00.000Z')

/** Returns an ISO timestamp N days before NOW */
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString()
}

/** Returns Unix epoch seconds N days before NOW */
function epochDaysAgo(n: number): number {
  return Math.floor((NOW.getTime() - n * 24 * 60 * 60 * 1000) / 1000)
}

/** Returns internal Gmail date (ms) N days before NOW */
function internalDateDaysAgo(n: number): string {
  return String(NOW.getTime() - n * 24 * 60 * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Gmail API response builders
// ---------------------------------------------------------------------------

function makeGmailListResponse(messages: { id: string; threadId: string }[]) {
  return { ok: true, json: vi.fn().mockResolvedValue({ messages }) }
}

function makeGmailMetaResponse(
  id: string,
  threadId: string,
  daysOld: number,
  to = 'recipient@example.com',
  subject = `Subject for ${threadId}`,
) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      id,
      threadId,
      internalDate: internalDateDaysAgo(daysOld),
      payload: {
        headers: [
          { name: 'From', value: 'me@example.com' },
          { name: 'Subject', value: subject },
          { name: 'To', value: to },
          { name: 'Date', value: new Date(NOW.getTime() - daysOld * 86400000).toUTCString() },
        ],
      },
    }),
  }
}

function makeGmailThreadResponse(
  messages: Array<{ internalDate: string; fromEmail: string }>,
) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      messages: messages.map(m => ({
        internalDate: String(new Date(m.internalDate).getTime()),
        payload: {
          headers: [{ name: 'From', value: m.fromEmail }],
        },
      })),
    }),
  }
}

// ---------------------------------------------------------------------------
// Supabase chain builder
// ---------------------------------------------------------------------------

type ChainResult = { data: unknown; error: null | { message: string } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain(result: ChainResult): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  const methods = [
    'select', 'eq', 'in', 'is', 'order', 'limit', 'maybeSingle',
    'insert', 'upsert', 'update',
  ]
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Promise interface
  chain.then = (
    onfulfilled?: ((v: unknown) => unknown) | null,
    onrejected?: ((r: unknown) => unknown) | null,
  ) => Promise.resolve(result).then(onfulfilled, onrejected)
  return chain
}

// ---------------------------------------------------------------------------
// Full Supabase mock
// ---------------------------------------------------------------------------

function makeSupabase(options: {
  integrations?: Array<{ user_id: string; provider: string }>
  profile?: { email: string } | null
  existingCandidates?: Array<{
    id: string
    thread_id: string
    dismissed: boolean
    cleared_at: string | null
  }>
  upsertError?: { message: string } | null
  updateError?: { message: string } | null
}) {
  const {
    integrations = [],
    profile = { email: 'me@example.com' },
    existingCandidates = [],
    upsertError = null,
    updateError = null,
  } = options

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'integrations') {
        return makeChain({ data: integrations, error: null })
      }
      if (table === 'profiles') {
        return makeChain({ data: profile, error: null })
      }
      if (table === 'followup_candidates') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {}
        const methods = ['select', 'eq', 'in', 'is', 'order', 'update', 'upsert']
        for (const m of methods) {
          chain[m] = vi.fn().mockReturnValue(chain)
        }

        // select resolves with existingCandidates
        chain.select = vi.fn().mockImplementation(() => {
          const selectChain = { ...chain }
          selectChain.then = (
            onfulfilled?: ((v: unknown) => unknown) | null,
            onrejected?: ((r: unknown) => unknown) | null,
          ) =>
            Promise.resolve({ data: existingCandidates, error: null }).then(
              onfulfilled,
              onrejected,
            )
          return selectChain
        })

        // upsert resolves with possible error
        chain.upsert = vi.fn().mockImplementation(() => {
          const upsertChain = { ...chain }
          upsertChain.then = (
            onfulfilled?: ((v: unknown) => unknown) | null,
            onrejected?: ((r: unknown) => unknown) | null,
          ) =>
            Promise.resolve({ data: null, error: upsertError }).then(onfulfilled, onrejected)
          return upsertChain
        })

        // update resolves with possible error
        chain.update = vi.fn().mockImplementation(() => {
          const updateChain = { ...chain }
          updateChain.then = (
            onfulfilled?: ((v: unknown) => unknown) | null,
            onrejected?: ((r: unknown) => unknown) | null,
          ) =>
            Promise.resolve({ data: null, error: updateError }).then(onfulfilled, onrejected)
          return updateChain
        })

        chain.then = (
          onfulfilled?: ((v: unknown) => unknown) | null,
          onrejected?: ((r: unknown) => unknown) | null,
        ) =>
          Promise.resolve({ data: existingCandidates, error: null }).then(
            onfulfilled,
            onrejected,
          )

        return chain
      }
      return makeChain({ data: null, error: null })
    }),
  }

  return supabase
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(NOW)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectFollowUps — no connected integrations', () => {
  it('returns zero counts when no integrations exist', async () => {
    mockCreateServiceClient.mockReturnValue(makeSupabase({ integrations: [] }))

    const result = await detectFollowUps()

    expect(result).toEqual({
      usersProcessed: 0,
      candidatesDetected: 0,
      candidatesCleared: 0,
      errorCount: 0,
    })
  })
})

describe('detectFollowUps — no token (not connected)', () => {
  it('skips provider silently when getProviderToken returns null', async () => {
    mockCreateServiceClient.mockReturnValue(
      makeSupabase({
        integrations: [{ user_id: 'user-1', provider: 'gmail' }],
        profile: { email: 'me@example.com' },
      }),
    )
    mockGetProviderToken.mockResolvedValue(null)

    const result = await detectFollowUps()

    expect(result.candidatesDetected).toBe(0)
    expect(result.errorCount).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('detectFollowUps — 3-day boundary logic (Gmail)', () => {
  it('does NOT flag a thread where the last sent message is exactly 2.9 days old', async () => {
    // 2.9 days = 2 days 21.6 hours < STALE_DAYS (3)
    const daysOld = 2.9

    mockCreateServiceClient.mockReturnValue(
      makeSupabase({
        integrations: [{ user_id: 'user-1', provider: 'gmail' }],
        profile: { email: 'me@example.com' },
      }),
    )
    mockGetProviderToken.mockResolvedValue('token-gmail')

    // Sent message is 2.9 days old — within threshold, should not flag
    const sentMs = NOW.getTime() - daysOld * 24 * 60 * 60 * 1000
    const sentEpoch = Math.floor(sentMs / 1000)
    const sinceEpoch = Math.floor(
      (NOW.getTime() - 14 * 24 * 60 * 60 * 1000) / 1000,
    )

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('messages?')) {
        // Sent list
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messages: [{ id: 'msg-1', threadId: 'thread-1' }] }),
        })
      }
      if (url.includes('/messages/msg-1')) {
        // Metadata fetch
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg-1',
              threadId: 'thread-1',
              internalDate: String(sentMs),
              payload: {
                headers: [
                  { name: 'From', value: 'me@example.com' },
                  { name: 'Subject', value: 'Recent email' },
                  { name: 'To', value: 'bob@example.com' },
                ],
              },
            }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const result = await detectFollowUps()

    // 2.9 days old is NOT stale (< 3 days) — should not be detected
    expect(result.candidatesDetected).toBe(0)
    // Thread fetch should not have been called (filtered out before step 4)
    const fetchCalls = mockFetch.mock.calls.map(([url]) => url as string)
    const threadFetches = fetchCalls.filter(u => u.includes('/threads/'))
    expect(threadFetches.length).toBe(0)

    void sinceEpoch
    void sentEpoch
  })

  it('DOES flag a thread where the last sent message is 3.1 days old', async () => {
    const daysOld = 3.1
    const sentMs = NOW.getTime() - daysOld * 24 * 60 * 60 * 1000

    mockCreateServiceClient.mockReturnValue(
      makeSupabase({
        integrations: [{ user_id: 'user-1', provider: 'gmail' }],
        profile: { email: 'me@example.com' },
        existingCandidates: [], // no prior candidate
      }),
    )
    mockGetProviderToken.mockResolvedValue('token-gmail')

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('messages?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messages: [{ id: 'msg-2', threadId: 'thread-2' }] }),
        })
      }
      if (url.includes('/messages/msg-2')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg-2',
              threadId: 'thread-2',
              internalDate: String(sentMs),
              payload: {
                headers: [
                  { name: 'From', value: 'me@example.com' },
                  { name: 'Subject', value: 'Old email' },
                  { name: 'To', value: 'alice@example.com' },
                ],
              },
            }),
        })
      }
      if (url.includes('/threads/thread-2')) {
        // Thread has no incoming reply (only the user's own message)
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  internalDate: String(sentMs),
                  payload: {
                    headers: [{ name: 'From', value: 'me@example.com' }],
                  },
                },
              ],
            }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const result = await detectFollowUps()

    expect(result.candidatesDetected).toBe(1)
    expect(result.candidatesCleared).toBe(0)
  })
})

describe('detectFollowUps — reply detection clears candidate (Gmail)', () => {
  it('clears an existing uncleaned candidate when a reply is detected', async () => {
    const daysOld = 5
    const sentMs = NOW.getTime() - daysOld * 24 * 60 * 60 * 1000

    // Existing candidate (not dismissed, not cleared)
    const existingCandidate = {
      id: 'candidate-1',
      thread_id: 'thread-reply',
      dismissed: false,
      cleared_at: null,
    }

    mockCreateServiceClient.mockReturnValue(
      makeSupabase({
        integrations: [{ user_id: 'user-1', provider: 'gmail' }],
        profile: { email: 'me@example.com' },
        existingCandidates: [existingCandidate],
      }),
    )
    mockGetProviderToken.mockResolvedValue('token-gmail')

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('messages?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messages: [{ id: 'msg-5', threadId: 'thread-reply' }] }),
        })
      }
      if (url.includes('/messages/msg-5')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg-5',
              threadId: 'thread-reply',
              internalDate: String(sentMs),
              payload: {
                headers: [
                  { name: 'From', value: 'me@example.com' },
                  { name: 'Subject', value: 'Awaiting reply' },
                  { name: 'To', value: 'other@example.com' },
                ],
              },
            }),
        })
      }
      if (url.includes('/threads/thread-reply')) {
        // Thread now has an incoming reply from the other party
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  // Original sent message
                  internalDate: String(sentMs),
                  payload: {
                    headers: [{ name: 'From', value: 'me@example.com' }],
                  },
                },
                {
                  // Incoming reply (after sent message)
                  internalDate: String(sentMs + 60000), // 1 minute later
                  payload: {
                    headers: [{ name: 'From', value: 'other@example.com' }],
                  },
                },
              ],
            }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const result = await detectFollowUps()

    expect(result.candidatesCleared).toBe(1)
    expect(result.candidatesDetected).toBe(0)
  })
})

describe('detectFollowUps — dismissed candidates', () => {
  it('does not re-flag or clear a dismissed candidate', async () => {
    const daysOld = 6
    const sentMs = NOW.getTime() - daysOld * 24 * 60 * 60 * 1000

    // Dismissed candidate
    const dismissedCandidate = {
      id: 'candidate-dismissed',
      thread_id: 'thread-dismissed',
      dismissed: true,
      cleared_at: null,
    }

    mockCreateServiceClient.mockReturnValue(
      makeSupabase({
        integrations: [{ user_id: 'user-1', provider: 'gmail' }],
        profile: { email: 'me@example.com' },
        existingCandidates: [dismissedCandidate],
      }),
    )
    mockGetProviderToken.mockResolvedValue('token-gmail')

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('messages?')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ messages: [{ id: 'msg-d', threadId: 'thread-dismissed' }] }),
        })
      }
      if (url.includes('/messages/msg-d')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg-d',
              threadId: 'thread-dismissed',
              internalDate: String(sentMs),
              payload: {
                headers: [
                  { name: 'From', value: 'me@example.com' },
                  { name: 'Subject', value: 'Dismissed thread' },
                  { name: 'To', value: 'other@example.com' },
                ],
              },
            }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const result = await detectFollowUps()

    // Dismissed threads are skipped entirely
    expect(result.candidatesDetected).toBe(0)
    expect(result.candidatesCleared).toBe(0)
    // Thread reply check should NOT happen for dismissed candidates
    const fetchCalls = mockFetch.mock.calls.map(([url]) => url as string)
    const threadFetches = fetchCalls.filter(u => u.includes('/threads/'))
    expect(threadFetches.length).toBe(0)
  })
})

describe('detectFollowUps — upsert idempotency', () => {
  it('returns detected=0 when upsert conflicts (ignoreDuplicates)', async () => {
    const daysOld = 4
    const sentMs = NOW.getTime() - daysOld * 24 * 60 * 60 * 1000

    // Already has a (non-dismissed, non-cleared) candidate → the upsert will ignoreDuplicates
    const existingCandidate = {
      id: 'cand-existing',
      thread_id: 'thread-idem',
      dismissed: false,
      cleared_at: null,
    }

    mockCreateServiceClient.mockReturnValue(
      makeSupabase({
        integrations: [{ user_id: 'user-1', provider: 'gmail' }],
        profile: { email: 'me@example.com' },
        existingCandidates: [existingCandidate],
      }),
    )
    mockGetProviderToken.mockResolvedValue('token-gmail')

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('messages?')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ messages: [{ id: 'msg-idem', threadId: 'thread-idem' }] }),
        })
      }
      if (url.includes('/messages/msg-idem')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'msg-idem',
              threadId: 'thread-idem',
              internalDate: String(sentMs),
              payload: {
                headers: [
                  { name: 'From', value: 'me@example.com' },
                  { name: 'Subject', value: 'Repeat thread' },
                  { name: 'To', value: 'other@example.com' },
                ],
              },
            }),
        })
      }
      if (url.includes('/threads/thread-idem')) {
        // No reply
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                {
                  internalDate: String(sentMs),
                  payload: { headers: [{ name: 'From', value: 'me@example.com' }] },
                },
              ],
            }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const result = await detectFollowUps()

    // existing=true means it's an existing candidate, so detected is not incremented
    expect(result.candidatesDetected).toBe(0)
    expect(result.candidatesCleared).toBe(0)
  })
})

describe('detectFollowUps — per-user fault isolation', () => {
  it('continues processing other users when one user throws', async () => {
    // Two users — first one will throw (token fetch fails catastrophically),
    // second should still be processed successfully
    mockCreateServiceClient.mockReturnValue(
      makeSupabase({
        integrations: [
          { user_id: 'user-fail', provider: 'gmail' },
          { user_id: 'user-ok', provider: 'gmail' },
        ],
        profile: { email: 'me@example.com' },
        existingCandidates: [],
      }),
    )

    // First call (user-fail): throw. Second call (user-ok): return no sent messages
    mockGetProviderToken
      .mockRejectedValueOnce(new Error('Token fetch exploded'))
      .mockResolvedValueOnce('token-ok')

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('messages?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messages: [] }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    const result = await detectFollowUps()

    // Both users are counted as processed; error is counted for user-fail
    expect(result.usersProcessed).toBe(2)
    expect(result.errorCount).toBe(1)
    // user-ok processed without error
    expect(result.candidatesDetected).toBe(0)
  })
})
