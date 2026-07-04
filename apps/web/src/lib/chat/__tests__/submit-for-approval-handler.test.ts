// @vitest-environment node
/**
 * Tests for the submit_for_approval tool handler.
 * Validates that malformed payloads are rejected and valid ones create a pending row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/approvals/audit', () => ({
  writeAudit: vi.fn().mockResolvedValue({ success: true }),
}))

// Memory tools needed by handlers.ts import
vi.mock('@/lib/memory/tools', () => ({
  handleSaveMemory: vi.fn(),
  handleRecallMemories: vi.fn(),
  handleUpsertEntity: vi.fn(),
  handleUpdateUserContext: vi.fn(),
  handleSummarizeConversation: vi.fn(),
}))

describe('executeToolHandler — submit_for_approval', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('rejects an unknown action_type — nothing inserted', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const mockInsert = vi.fn()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    } as never)

    const { executeToolHandler } = await import('../tools/handlers')
    const result = await executeToolHandler(
      'submit_for_approval',
      { action_type: 'delete_database', provider: 'gmail', payload: {} },
      'user-1',
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toMatch(/validation failed/i)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a send_email payload missing required fields', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const mockInsert = vi.fn()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    } as never)

    const { executeToolHandler } = await import('../tools/handlers')
    const result = await executeToolHandler(
      'submit_for_approval',
      {
        action_type: 'send_email',
        provider: 'gmail',
        payload: { subject: 'Hello' }, // missing 'to' and 'body'
      },
      'user-1',
    )

    expect(result.is_error).toBe(true)
    expect(result.content).toMatch(/validation failed/i)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('inserts a pending row for a valid send_email payload', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'queue-1',
        action_type: 'send_email',
        provider: 'gmail',
        status: 'pending',
        created_at: '2026-07-05T00:00:00Z',
      },
      error: null,
    })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    } as never)

    const { executeToolHandler } = await import('../tools/handlers')
    const result = await executeToolHandler(
      'submit_for_approval',
      {
        action_type: 'send_email',
        provider: 'gmail',
        payload: { to: 'bob@example.com', subject: 'Meeting', body: 'Can we meet?' },
        ai_summary: 'Proposing to email Bob about a meeting',
      },
      'user-1',
    )

    expect(result.is_error).toBe(false)
    const parsed = JSON.parse(result.content)
    expect(parsed.approval_id).toBe('queue-1')
    expect(parsed.status).toBe('pending')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'send_email',
        provider: 'gmail',
        status: 'pending',
        user_id: 'user-1',
      }),
    )
  })

  it('rejects when payload is not an object', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const mockInsert = vi.fn()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert }),
    } as never)

    const { executeToolHandler } = await import('../tools/handlers')
    const result = await executeToolHandler(
      'submit_for_approval',
      { action_type: 'send_email', provider: 'gmail', payload: 'not an object' },
      'user-1',
    )

    expect(result.is_error).toBe(true)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
