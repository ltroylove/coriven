// @vitest-environment node
/**
 * Tests for Wave 5.3.2 execution layer:
 *   - router.ts  (executeApprovedAction)
 *   - email.ts   (sendEmail)
 *   - calendar.ts (createCalendarEvent, updateCalendarEvent)
 *
 * All provider HTTP calls and Nango token fetches are mocked.
 * No live network calls are made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Top-level mocks (hoisted before any imports)
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))
vi.mock('@/lib/integrations/nango', () => ({
  getProviderToken: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))
vi.mock('@/lib/approvals/audit', () => ({
  writeAudit: vi.fn().mockResolvedValue({ success: true }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchOk(body: unknown = {}, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(''),
  })
}

function makeFetchFail(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue('provider error'),
  })
}

function makeFetchThrow() {
  return vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
}

function makeDbClient(updateError: unknown = null) {
  const mockUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: updateError }),
  })
  return {
    from: vi.fn().mockReturnValue({ update: mockUpdate }),
    _mockUpdate: mockUpdate,
  }
}

import type { ApprovalQueueRow } from '@personal-assistant/types'

function makeApproval(overrides: Partial<ApprovalQueueRow> = {}): ApprovalQueueRow {
  return {
    id: 'approval-1',
    user_id: 'user-1',
    action_type: 'send_email',
    provider: 'gmail',
    payload: { to: 'test@example.com', subject: 'Hello', body: 'Body text' },
    ai_summary: null,
    status: 'approved',
    created_at: new Date().toISOString(),
    reviewed_at: new Date().toISOString(),
    executed_at: null,
    error_code: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// email executor tests
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns { ok: false, errorCode: token_unavailable } when token is null', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue(null)

    const { sendEmail } = await import('../executors/email')
    const result = await sendEmail('user-1', 'gmail', {
      to: 'a@example.com',
      subject: 'Sub',
      body: 'Body',
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('token_unavailable')
  })

  it('sends via Gmail with correct URL and Authorization header', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('gtoken-123')

    const mockFetch = makeFetchOk({ id: 'msg-1' })
    vi.stubGlobal('fetch', mockFetch)

    const { sendEmail } = await import('../executors/email')
    const result = await sendEmail('user-1', 'gmail', {
      to: 'alice@example.com',
      subject: 'Hi',
      body: 'Hello',
    })

    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer gtoken-123')
    expect(init.method).toBe('POST')

    // Token must not appear in logged request body
    const bodyStr = init.body as string
    expect(bodyStr).not.toContain('gtoken-123')

    vi.unstubAllGlobals()
  })

  it('returns provider_rejected on Gmail 4xx', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('tok')

    vi.stubGlobal('fetch', makeFetchFail(403))

    const { sendEmail } = await import('../executors/email')
    const result = await sendEmail('user-1', 'gmail', {
      to: 'a@example.com',
      subject: 'S',
      body: 'B',
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('provider_rejected')

    vi.unstubAllGlobals()
  })

  it('returns network_error when fetch throws for Gmail', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('tok')

    vi.stubGlobal('fetch', makeFetchThrow())

    const { sendEmail } = await import('../executors/email')
    const result = await sendEmail('user-1', 'gmail', {
      to: 'a@example.com',
      subject: 'S',
      body: 'B',
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('network_error')

    vi.unstubAllGlobals()
  })

  it('sends via Outlook Graph with correct URL and Authorization header', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('otoken-456')

    // Graph sendMail returns 202
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue(''),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { sendEmail } = await import('../executors/email')
    const result = await sendEmail('user-1', 'outlook', {
      to: 'bob@example.com',
      subject: 'Meeting',
      body: 'Let us meet',
    })

    expect(result.ok).toBe(true)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/sendMail')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer otoken-456')
    expect(init.method).toBe('POST')

    // Token must not be in body
    const bodyStr = init.body as string
    expect(bodyStr).not.toContain('otoken-456')

    vi.unstubAllGlobals()
  })

  it('returns network_error when Outlook fetch throws', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('tok')

    vi.stubGlobal('fetch', makeFetchThrow())

    const { sendEmail } = await import('../executors/email')
    const result = await sendEmail('user-1', 'outlook', {
      to: 'a@example.com',
      subject: 'S',
      body: 'B',
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('network_error')

    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// calendar executor tests
// ---------------------------------------------------------------------------

describe('createCalendarEvent', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns token_unavailable when Google Calendar token is null', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue(null)

    const { createCalendarEvent } = await import('../executors/calendar')
    const result = await createCalendarEvent('user-1', 'google_calendar', {
      title: 'Standup',
      start: '2026-07-05T09:00:00Z',
      end: '2026-07-05T09:30:00Z',
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('token_unavailable')
  })

  it('creates Google Calendar event with correct URL, method, Authorization, and returns providerRef', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('gcal-token')

    const mockFetch = makeFetchOk({ id: 'event-abc' })
    vi.stubGlobal('fetch', mockFetch)

    const { createCalendarEvent } = await import('../executors/calendar')
    const result = await createCalendarEvent('user-1', 'google_calendar', {
      title: 'Team sync',
      start: '2026-07-05T09:00:00Z',
      end: '2026-07-05T09:30:00Z',
      attendees: ['alice@example.com'],
    })

    expect(result.ok).toBe(true)
    expect(result.providerRef).toBe('event-abc')

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer gcal-token')

    vi.unstubAllGlobals()
  })

  it('creates Outlook Calendar event — uses outlook Nango key and Graph endpoint', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('ocal-token')

    const mockFetch = makeFetchOk({ id: 'graph-event-xyz' })
    vi.stubGlobal('fetch', mockFetch)

    const { createCalendarEvent } = await import('../executors/calendar')
    const result = await createCalendarEvent('user-1', 'outlook_calendar', {
      title: 'Review',
      start: '2026-07-06T14:00:00Z',
      end: '2026-07-06T15:00:00Z',
    })

    expect(result.ok).toBe(true)
    expect(result.providerRef).toBe('graph-event-xyz')

    // Must use 'outlook' provider key for Nango (not 'outlook_calendar')
    expect(vi.mocked(getProviderToken)).toHaveBeenCalledWith('user-1', 'outlook')

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/events')
    expect(init.method).toBe('POST')

    vi.unstubAllGlobals()
  })

  it('returns provider_rejected on non-2xx response', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('tok')

    vi.stubGlobal('fetch', makeFetchFail(500))

    const { createCalendarEvent } = await import('../executors/calendar')
    const result = await createCalendarEvent('user-1', 'google_calendar', {
      title: 'Fail',
      start: '2026-07-05T09:00:00Z',
      end: '2026-07-05T09:30:00Z',
    })
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('provider_rejected')

    vi.unstubAllGlobals()
  })
})

describe('updateCalendarEvent', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sends PATCH to correct Google Calendar URL with event_id', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('gcal-tok')

    const mockFetch = makeFetchOk({ id: 'event-123' })
    vi.stubGlobal('fetch', mockFetch)

    const { updateCalendarEvent } = await import('../executors/calendar')
    const result = await updateCalendarEvent('user-1', 'google_calendar', {
      event_id: 'event-123',
      title: 'Updated title',
    })

    expect(result.ok).toBe(true)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('event-123')
    expect(url).toContain('googleapis.com/calendar/v3/calendars/primary/events')
    expect(init.method).toBe('PATCH')

    vi.unstubAllGlobals()
  })

  it('sends PATCH to correct Outlook Graph URL with event_id', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('ocal-tok')

    const mockFetch = makeFetchOk({ id: 'graph-event-456' })
    vi.stubGlobal('fetch', mockFetch)

    const { updateCalendarEvent } = await import('../executors/calendar')
    const result = await updateCalendarEvent('user-1', 'outlook_calendar', {
      event_id: 'graph-event-456',
      title: 'Updated',
    })

    expect(result.ok).toBe(true)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('graph-event-456')
    expect(url).toContain('graph.microsoft.com/v1.0/me/events')
    expect(init.method).toBe('PATCH')

    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// Router tests
// ---------------------------------------------------------------------------

describe('executeApprovedAction (router)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns invalid_state when item is not in allowed statuses', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    const { executeApprovedAction } = await import('../executors/router')
    const item = makeApproval({ status: 'executed' })
    const result = await executeApprovedAction(item, ['approved'])

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('invalid_state')
  })

  it('refuses double execution — second call with non-approved status is blocked', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue(null) // token unavailable keeps it simple

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    const { executeApprovedAction } = await import('../executors/router')

    // First call: item is 'approved' → attempts execution (token_unavailable → failed)
    const item = makeApproval({ status: 'approved' })
    const first = await executeApprovedAction(item, ['approved'])
    expect(first.ok).toBe(false)
    expect(first.errorCode).toBe('token_unavailable')

    // Second call: if status were already 'executed' or 'failed', router refuses
    const alreadyExecuted = makeApproval({ status: 'executed' })
    const second = await executeApprovedAction(alreadyExecuted, ['approved'])
    expect(second.ok).toBe(false)
    expect(second.errorCode).toBe('invalid_state')
  })

  it('routes send_email + gmail to email executor', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('gmail-tok')

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    const mockFetch = makeFetchOk({ id: 'msg-sent' })
    vi.stubGlobal('fetch', mockFetch)

    const { executeApprovedAction } = await import('../executors/router')
    const result = await executeApprovedAction(makeApproval())

    expect(result.ok).toBe(true)
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('gmail.googleapis.com')

    vi.unstubAllGlobals()
  })

  it('routes send_email + outlook to Outlook executor', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('outlook-tok')

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue(''),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { executeApprovedAction } = await import('../executors/router')
    const result = await executeApprovedAction(
      makeApproval({ provider: 'outlook' }),
    )

    expect(result.ok).toBe(true)
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('graph.microsoft.com')

    vi.unstubAllGlobals()
  })

  it('routes create_calendar_event + google_calendar to calendar executor', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('gcal-tok')

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    const mockFetch = makeFetchOk({ id: 'new-event' })
    vi.stubGlobal('fetch', mockFetch)

    const { executeApprovedAction } = await import('../executors/router')
    const result = await executeApprovedAction(
      makeApproval({
        action_type: 'create_calendar_event',
        provider: 'google_calendar',
        payload: {
          title: 'Meeting',
          start: '2026-07-05T09:00:00Z',
          end: '2026-07-05T09:30:00Z',
        },
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.providerRef).toBe('new-event')
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('googleapis.com/calendar')

    vi.unstubAllGlobals()
  })

  it('returns unknown_provider for unrecognised action_type+provider combination', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    const { executeApprovedAction } = await import('../executors/router')
    // send_email with a calendar provider is an invalid combination
    const result = await executeApprovedAction(
      makeApproval({ action_type: 'send_email', provider: 'google_calendar' }),
    )

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('unknown_provider')
  })

  it('writes failed status and audit on execution failure', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('tok')

    const { createServiceClient } = await import('@/lib/supabase/server')
    const db = makeDbClient()
    vi.mocked(createServiceClient).mockReturnValue(db as never)

    const { writeAudit } = await import('@/lib/approvals/audit')
    vi.mocked(writeAudit).mockResolvedValue({ success: true })

    vi.stubGlobal('fetch', makeFetchFail(500))

    const { executeApprovedAction } = await import('../executors/router')
    const result = await executeApprovedAction(makeApproval())

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('provider_rejected')

    // DB should have been called to write status
    expect(db.from).toHaveBeenCalledWith('approval_queue')

    // Audit should have been called with failed status
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: 'provider_rejected' }),
    )

    vi.unstubAllGlobals()
  })

  it('retry path: allowedStatuses=[failed] permits execution from failed state', async () => {
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('tok')

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    const mockFetch = makeFetchOk({ id: 'msg-retry' })
    vi.stubGlobal('fetch', mockFetch)

    const { executeApprovedAction } = await import('../executors/router')
    const result = await executeApprovedAction(
      makeApproval({ status: 'failed' }),
      ['failed'],
    )

    expect(result.ok).toBe(true)

    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// approvals action integration tests
// ---------------------------------------------------------------------------

describe('approveAction (with execution)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns error when item not found', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } })
    const mockSelectEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq1 })
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
    } as never)

    const { approveAction } = await import('../../../app/actions/approvals')
    const result = await approveAction('nonexistent')
    expect(result.error).toMatch(/not found/i)
  })

  it('writes failed status + audit when executor fails', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')

    const mockUpdateEq3 = vi.fn().mockResolvedValue({ error: null })
    const mockUpdateEq2 = vi.fn().mockReturnValue({ eq: mockUpdateEq3 })
    const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 })

    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'item-1',
        user_id: 'user-1',
        status: 'pending',
        action_type: 'send_email',
        provider: 'gmail',
        payload: { to: 'a@example.com', subject: 'S', body: 'B' },
        ai_summary: null,
        created_at: new Date().toISOString(),
        reviewed_at: null,
        executed_at: null,
        error_code: null,
      },
      error: null,
    })
    const mockSelectEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq1 })

    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn().mockReturnValue({ select: mockSelect, update: mockUpdate }),
    } as never)

    // Nango returns token; provider fails
    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('tok')

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    vi.stubGlobal('fetch', makeFetchFail(500))

    const { writeAudit } = await import('@/lib/approvals/audit')
    vi.mocked(writeAudit).mockResolvedValue({ success: true })

    const { approveAction } = await import('../../../app/actions/approvals')
    const result = await approveAction('item-1')

    // approveAction itself returns {} (execution failure does not propagate to caller)
    expect(result.error).toBeUndefined()

    // Audit must have been called for both 'approved' and 'failed'
    const auditCalls = vi.mocked(writeAudit).mock.calls
    const statuses = auditCalls.map((c) => (c[0] as { status: string }).status)
    expect(statuses).toContain('approved')
    expect(statuses).toContain('failed')

    vi.unstubAllGlobals()
  })
})

describe('retryAction', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns error if item is not in failed status', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'item-1',
        user_id: 'user-1',
        status: 'executed',
        action_type: 'send_email',
        provider: 'gmail',
        payload: {},
        ai_summary: null,
        created_at: new Date().toISOString(),
        reviewed_at: null,
        executed_at: null,
        error_code: null,
      },
      error: null,
    })
    const mockSelectEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq1 })
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
    } as never)

    const { retryAction } = await import('../../../app/actions/approvals')
    const result = await retryAction('item-1')
    expect(result.error).toMatch(/only failed items/i)
  })

  it('succeeds when item is in failed status and provider call succeeds', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'item-2',
        user_id: 'user-1',
        status: 'failed',
        action_type: 'send_email',
        provider: 'gmail',
        payload: { to: 'b@example.com', subject: 'Retry', body: 'Body' },
        ai_summary: null,
        created_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
        executed_at: null,
        error_code: 'network_error',
      },
      error: null,
    })
    const mockSelectEq2 = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq1 })
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
    } as never)

    const { getProviderToken } = await import('@/lib/integrations/nango')
    vi.mocked(getProviderToken).mockResolvedValue('tok')

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(makeDbClient() as never)

    vi.stubGlobal('fetch', makeFetchOk({ id: 'msg-retry-ok' }))

    const { retryAction } = await import('../../../app/actions/approvals')
    const result = await retryAction('item-2')
    expect(result.error).toBeUndefined()

    vi.unstubAllGlobals()
  })
})
