// @vitest-environment node
/**
 * Unit tests for the push_notification tool handler
 * Wave 7.2.1 — push_notification handler
 *
 * Tests:
 *  - Inserts a detected_patterns record with correct fields on success
 *  - Returns is_error=false with confirmation message on success
 *  - Returns is_error=true when body > 100 chars
 *  - Returns is_error=true on DB failure
 *  - Returns is_error=true when title is missing
 *  - Returns is_error=true when body is missing
 *  - Always generates a unique pattern_type with timestamp suffix to avoid
 *    unique constraint violations (Fix 7: partial unique index workaround)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

const { createServiceClient } = await import('@/lib/supabase/server')
const { executeToolHandler } = await import('../handlers')

const MOCK_USER_ID = 'user-push-notif-test'

/** Maximum body length — must match PUSH_NOTIFICATION_MAX_BODY_CHARS in handlers.ts */
const MAX_BODY_CHARS = 100

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

/**
 * Build a mock Supabase client for the push_notification insert chain.
 * Chain: .from().insert().select().single()
 */
function makePushNotifClient(opts: {
  data?: { id: string } | null
  error?: { message: string } | null
}) {
  const single = vi.fn().mockResolvedValue({
    data: opts.data ?? null,
    error: opts.error ?? null,
  })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })

  return {
    from: vi.fn().mockReturnValue({ insert }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeToolHandler: push_notification', () => {
  // -------------------------------------------------------------------------
  // Success
  // -------------------------------------------------------------------------

  it('returns is_error=false with confirmation on success', async () => {
    const client = makePushNotifClient({ data: { id: 'notif-uuid-001' } })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const result = await executeToolHandler(
      'push_notification',
      { title: 'Gym Reminder', body: 'Time to work out!' },
      MOCK_USER_ID,
    )

    expect(result.is_error).toBe(false)
    expect(result.content).toContain('notif-uuid-001')
  })

  it('inserts a row with correct user_id and description (body)', async () => {
    const client = makePushNotifClient({ data: { id: 'notif-uuid-002' } })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    await executeToolHandler(
      'push_notification',
      { title: 'Goal nudge', body: 'Check on your reading goal.' },
      MOCK_USER_ID,
    )

    const insertCall = vi.mocked(client.from).mock.results[0].value.insert
    const insertArgs = insertCall.mock.calls[0][0] as Record<string, unknown>

    expect(insertArgs.user_id).toBe(MOCK_USER_ID)
    expect(insertArgs.description).toBe('Check on your reading goal.')
    expect(insertArgs.is_active).toBe(true)
    expect(insertArgs.last_notified_at).toBeNull()
  })

  it('always generates a unique pattern_type with "push_notification_" prefix and timestamp suffix', async () => {
    // Fix 7: each push_notification gets a unique pattern_type (push_notification_{ms})
    // to avoid the partial unique index UNIQUE(user_id, pattern_type) WHERE goal_id IS NULL.
    const client = makePushNotifClient({ data: { id: 'notif-uuid-003' } })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const before = Date.now()
    await executeToolHandler(
      'push_notification',
      { title: 'Test', body: 'Short body.' },
      MOCK_USER_ID,
    )
    const after = Date.now()

    const insertCall = vi.mocked(client.from).mock.results[0].value.insert
    const insertArgs = insertCall.mock.calls[0][0] as Record<string, unknown>
    const patternType = String(insertArgs.pattern_type)
    expect(patternType).toMatch(/^push_notification_\d+$/)
    const ts = Number(patternType.replace('push_notification_', ''))
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('ignores any caller-supplied pattern_type — always uses push_notification_{ts}', async () => {
    // The input pattern_type field is no longer forwarded to the DB; the handler
    // always generates a unique value to prevent unique constraint violations.
    const client = makePushNotifClient({ data: { id: 'notif-uuid-004' } })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    await executeToolHandler(
      'push_notification',
      { title: 'Stale Nudge', body: "Your 'Gym' goal is stale.", pattern_type: 'stale_goal' },
      MOCK_USER_ID,
    )

    const insertCall = vi.mocked(client.from).mock.results[0].value.insert
    const insertArgs = insertCall.mock.calls[0][0] as Record<string, unknown>
    expect(String(insertArgs.pattern_type)).toMatch(/^push_notification_\d+$/)
  })

  // -------------------------------------------------------------------------
  // Body validation
  // -------------------------------------------------------------------------

  it('returns is_error=true when body is exactly 101 characters', async () => {
    const longBody = 'a'.repeat(MAX_BODY_CHARS + 1)
    const result = await executeToolHandler(
      'push_notification',
      { title: 'Test', body: longBody },
      MOCK_USER_ID,
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain(`${MAX_BODY_CHARS} characters`)
    expect(result.content).toContain('101')
  })

  it('returns is_error=true when body is 150 characters', async () => {
    const longBody = 'b'.repeat(150)
    const result = await executeToolHandler(
      'push_notification',
      { title: 'Test', body: longBody },
      MOCK_USER_ID,
    )

    expect(result.is_error).toBe(true)
  })

  it('accepts body of exactly 100 characters', async () => {
    const client = makePushNotifClient({ data: { id: 'notif-100' } })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const exactBody = 'x'.repeat(MAX_BODY_CHARS)
    const result = await executeToolHandler(
      'push_notification',
      { title: 'Test', body: exactBody },
      MOCK_USER_ID,
    )

    expect(result.is_error).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Missing required fields
  // -------------------------------------------------------------------------

  it('returns is_error=true when title is missing', async () => {
    const result = await executeToolHandler(
      'push_notification',
      { body: 'No title here.' },
      MOCK_USER_ID,
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('title')
  })

  it('returns is_error=true when body is missing', async () => {
    const result = await executeToolHandler(
      'push_notification',
      { title: 'No body here' },
      MOCK_USER_ID,
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toContain('body')
  })

  // -------------------------------------------------------------------------
  // DB failure
  // -------------------------------------------------------------------------

  it('returns is_error=true on DB insert failure', async () => {
    const client = makePushNotifClient({
      data: null,
      error: { message: 'connection reset by peer' },
    })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    const result = await executeToolHandler(
      'push_notification',
      { title: 'Reminder', body: 'Check your goals.' },
      MOCK_USER_ID,
    )

    expect(result.is_error).toBe(true)
    // Must not leak raw DB error to the model
    expect(result.content).not.toContain('connection reset')
    expect(result.content).toContain('Failed to queue notification')
  })
})
