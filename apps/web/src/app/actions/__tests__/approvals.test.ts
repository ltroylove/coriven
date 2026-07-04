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
// Constraint system — default to no constraints (gate passes)
vi.mock('@/lib/chat/constraints/loader', () => ({
  loadConstraintsForUser: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/chat/constraints/evaluator', () => ({
  evaluateConstraint: vi.fn().mockReturnValue({ matched: false }),
}))
// Service client mock supports the router's 3-step DB pattern (M-2/M-3):
//   call 1: claimForExecution — update({count:'exact'}).eq().in() → {count:1, error:null}
//   call 2: re-fetch           — select().eq().single()           → {data:defaultRow, error:null}
//   call 3: writeTerminalStatus — update().eq()                   → {error:null}
// createServiceClient is called once per step; the mock rotates through clients.
vi.mock('@/lib/supabase/server', () => {
  let callIdx = 0

  const defaultRow = {
    id: 'item-1',
    user_id: 'user-1',
    action_type: 'send_email',
    provider: 'gmail',
    payload: { to: 'a@example.com', subject: 'S', body: 'B' },
  }

  // Step 1: claim — update({count:'exact'}).eq().in() → {count:1, error:null}
  const claimIn = () => Promise.resolve({ count: 1, error: null })
  const claimEq = () => ({ in: claimIn })
  const claimUpdate = () => ({ eq: claimEq })
  const makeClaimClient = () => ({ from: () => ({ update: claimUpdate }) })

  // Step 2: re-fetch — select().eq().single() → {data:defaultRow, error:null}
  const refetchSingle = () => Promise.resolve({ data: defaultRow, error: null })
  const refetchEq = () => ({ single: refetchSingle })
  const refetchSelect = () => ({ eq: refetchEq })
  const makeRefetchClient = () => ({ from: () => ({ select: refetchSelect }) })

  // Step 3: terminal status write — update().eq() → {error:null}
  const terminalEq = () => Promise.resolve({ error: null })
  const terminalUpdate = () => ({ eq: terminalEq })
  const makeTerminalClient = () => ({ from: () => ({ update: terminalUpdate }) })

  const clients = [makeClaimClient(), makeRefetchClient(), makeTerminalClient()]

  return {
    createServiceClient: vi.fn().mockImplementation(() => {
      const client = clients[callIdx % clients.length]
      callIdx++
      return client
    }),
  }
})

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
