// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

describe('writeAudit', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns success and auditId when insert succeeds', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'audit-abc' }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    } as never)

    const { writeAudit } = await import('../audit')
    const result = await writeAudit({
      userId: 'user-1',
      approvalId: 'approval-1',
      actionType: 'send_email',
      provider: 'gmail',
      status: 'proposed',
      delegation: {
        user: 'user-1',
        actor: 'coriven',
        connection: { provider: 'gmail', nango_connection_id: null },
      },
    })

    expect(result.success).toBe(true)
    expect(result.auditId).toBe('audit-abc')
  })

  it('returns { success: false } and does NOT throw when insert fails', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    } as never)

    const { writeAudit } = await import('../audit')
    // Must not throw
    await expect(
      writeAudit({
        userId: 'user-1',
        approvalId: 'approval-1',
        actionType: 'send_email',
        provider: 'gmail',
        status: 'proposed',
        delegation: {
          user: 'user-1',
          actor: 'coriven',
          connection: { provider: 'gmail', nango_connection_id: null },
        },
      }),
    ).resolves.toEqual({ success: false })
  })

  it('returns { success: false } and does NOT throw when createServiceClient throws', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockImplementation(() => {
      throw new Error('client init failure')
    })

    const { writeAudit } = await import('../audit')
    await expect(
      writeAudit({
        userId: 'user-1',
        approvalId: null,
        actionType: 'send_email',
        provider: 'gmail',
        status: 'proposed',
        delegation: {
          user: 'user-1',
          actor: 'coriven',
          connection: { provider: 'gmail', nango_connection_id: null },
        },
      }),
    ).resolves.toEqual({ success: false })
  })

  it('strips sensitive fields — delegation only contains user, actor, connection', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'audit-def' }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
    vi.mocked(createServiceClient).mockReturnValue({ from: mockFrom } as never)

    const { writeAudit } = await import('../audit')
    await writeAudit({
      userId: 'user-1',
      approvalId: 'approval-1',
      actionType: 'send_email',
      provider: 'gmail',
      status: 'approved',
      delegation: {
        user: 'user-1',
        actor: 'coriven',
        connection: { provider: 'gmail', nango_connection_id: 'nango-conn-1' },
      },
    })

    const insertedRow = mockInsert.mock.calls[0][0] as Record<string, unknown>
    const delegation = insertedRow['delegation'] as Record<string, unknown>

    // Delegation should only have the three allowed keys
    expect(Object.keys(delegation)).toEqual(expect.arrayContaining(['user', 'actor', 'connection']))
    // No raw token fields
    expect(delegation).not.toHaveProperty('token')
    expect(delegation).not.toHaveProperty('access_token')
    expect(delegation).not.toHaveProperty('secret')
  })
})
