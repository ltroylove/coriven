// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))
vi.mock('@/lib/approvals/audit', () => ({
  writeAudit: vi.fn().mockResolvedValue({ success: true }),
}))
// Router dependencies — must be mocked so approveAction tests don't reach
// the real Nango client or Supabase service client during unit tests.
vi.mock('@/lib/integrations/nango', () => ({
  getProviderToken: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  }),
}))

// ---------------------------------------------------------------------------
// Shared mock factory helpers
// ---------------------------------------------------------------------------

function makeSupabaseWithItem(
  item: Record<string, unknown> | null,
  updateError: unknown = null,
) {
  const mockUpdateEq3 = vi.fn().mockResolvedValue({ error: updateError })
  const mockUpdateEq2 = vi.fn().mockReturnValue({ eq: mockUpdateEq3 })
  const mockUpdateEq1 = vi.fn().mockReturnValue({ eq: mockUpdateEq2 })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq1 })

  const mockSingle = vi.fn().mockResolvedValue({ data: item, error: item ? null : { message: 'Not found' } })
  const mockSelectEq2 = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelectEq1 = vi.fn().mockReturnValue({ eq: mockSelectEq2 })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq1 })

  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, update: mockUpdate })

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: mockFrom,
  }
}

// ---------------------------------------------------------------------------
// approveAction
// ---------------------------------------------------------------------------

describe('approveAction', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns error when not authenticated', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)

    const { approveAction } = await import('../approvals')
    const result = await approveAction('some-id')
    expect(result.error).toBeTruthy()
  })

  it('returns error when item not found', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeSupabaseWithItem(null) as never,
    )

    const { approveAction } = await import('../approvals')
    const result = await approveAction('nonexistent')
    expect(result.error).toMatch(/not found/i)
  })

  it('returns error when item is not pending', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeSupabaseWithItem({
        id: 'item-1',
        user_id: 'user-1',
        status: 'approved',
        action_type: 'send_email',
        provider: 'gmail',
      }) as never,
    )

    const { approveAction } = await import('../approvals')
    const result = await approveAction('item-1')
    expect(result.error).toMatch(/already in status/i)
  })

  it('returns empty object on success', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeSupabaseWithItem({
        id: 'item-1',
        user_id: 'user-1',
        status: 'pending',
        action_type: 'send_email',
        provider: 'gmail',
        // payload required by executor — token mocked as null so execution
        // fails gracefully with token_unavailable (does not throw to caller)
        payload: { to: 'a@example.com', subject: 'S', body: 'B' },
      }) as never,
    )

    const { approveAction } = await import('../approvals')
    const result = await approveAction('item-1')
    // approveAction returns {} even if execution fails (execution errors are
    // written to DB status; they do not propagate to the caller)
    expect(result.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// cancelAction
// ---------------------------------------------------------------------------

describe('cancelAction', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns error when item is not pending', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeSupabaseWithItem({
        id: 'item-1',
        user_id: 'user-1',
        status: 'cancelled',
        action_type: 'send_email',
        provider: 'gmail',
      }) as never,
    )

    const { cancelAction } = await import('../approvals')
    const result = await cancelAction('item-1')
    expect(result.error).toMatch(/already in status/i)
  })

  it('returns empty object on success', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeSupabaseWithItem({
        id: 'item-1',
        user_id: 'user-1',
        status: 'pending',
        action_type: 'send_email',
        provider: 'gmail',
      }) as never,
    )

    const { cancelAction } = await import('../approvals')
    const result = await cancelAction('item-1')
    expect(result.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// approveWithModifiedPayload — re-validation
// ---------------------------------------------------------------------------

describe('approveWithModifiedPayload', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('rejects an invalid modified payload', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeSupabaseWithItem({
        id: 'item-1',
        user_id: 'user-1',
        status: 'pending',
        action_type: 'send_email',
        provider: 'gmail',
      }) as never,
    )

    const { approveWithModifiedPayload } = await import('../approvals')
    // Missing required fields for send_email
    const result = await approveWithModifiedPayload('item-1', { to: 'alice@example.com' })
    expect(result.error).toMatch(/invalid/i)
  })

  it('succeeds with a valid modified payload', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeSupabaseWithItem({
        id: 'item-1',
        user_id: 'user-1',
        status: 'pending',
        action_type: 'send_email',
        provider: 'gmail',
      }) as never,
    )

    const { approveWithModifiedPayload } = await import('../approvals')
    const result = await approveWithModifiedPayload('item-1', {
      to: 'alice@example.com',
      subject: 'Updated subject',
      body: 'Updated body',
    })
    // Execution is attempted (token mocked as null → token_unavailable)
    // but execution errors do not propagate to the caller
    expect(result.error).toBeUndefined()
  })
})
