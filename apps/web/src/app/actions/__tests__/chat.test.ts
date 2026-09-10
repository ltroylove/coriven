// @vitest-environment node
/**
 * Task 9.1.2.2.2 — listConversations() server action
 *
 * Acceptance criteria:
 *   1. Correct ordering: pinned conversations first (pinned_at DESC NULLS LAST),
 *      then by updated_at DESC
 *   2. Archived conversations (archived_at IS NOT NULL) are excluded
 *   3. Empty list for a user with no conversations
 *   4. Returns [] and logs on DB error (never throws)
 *   5. Returns [] for unauthenticated callers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock auth client that is signed in as the given user. */
function makeAuthClient(userId: string | null, supabaseQueryChain: unknown) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: vi.fn().mockReturnValue(supabaseQueryChain),
  }
}

/**
 * Build the query-builder chain for `listConversations`:
 *   .from('conversations')
 *   .select('id, title, updated_at, pinned_at')
 *   .is('archived_at', null)
 *   .order('pinned_at', ...)
 *   .order('updated_at', ...)
 *
 * Returns the resolved data so tests can specify what rows come back.
 */
function makeConversationsChain(rows: unknown[], error: { message: string } | null = null) {
  const secondOrder = vi.fn().mockResolvedValue({ data: rows, error })
  const firstOrder = vi.fn().mockReturnValue({ order: secondOrder })
  const isNull = vi.fn().mockReturnValue({ order: firstOrder })
  const select = vi.fn().mockReturnValue({ is: isNull })
  return { select, isNull, firstOrder, secondOrder }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listConversations() server action', () => {
  beforeEach(() => vi.resetModules())

  it('returns conversations in pinned-first then updated_at order', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')

    // The DB returns rows already in the correct order (ordering enforced by the
    // Supabase query); we verify the SELECT and ORDER calls are made correctly.
    const rows = [
      { id: 'conv-pinned', title: 'Pinned chat', updated_at: '2026-07-01T10:00:00Z', pinned_at: '2026-06-30T08:00:00Z' },
      { id: 'conv-recent', title: 'Recent chat', updated_at: '2026-07-05T10:00:00Z', pinned_at: null },
      { id: 'conv-older', title: 'Older chat', updated_at: '2026-07-03T10:00:00Z', pinned_at: null },
    ]

    const chain = makeConversationsChain(rows)
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1', chain) as never,
    )

    const { listConversations } = await import('../chat')
    const result = await listConversations()

    expect(result).toHaveLength(3)
    expect(result[0].id).toBe('conv-pinned')
    expect(result[1].id).toBe('conv-recent')
    expect(result[2].id).toBe('conv-older')

    // Verify the query called .is('archived_at', null) for exclusion
    expect(chain.isNull).toHaveBeenCalledWith('archived_at', null)

    // Verify the two .order() calls (pinned_at DESC NULLS LAST, then updated_at DESC)
    expect(chain.firstOrder).toHaveBeenCalledWith('pinned_at', {
      ascending: false,
      nullsFirst: false,
    })
    expect(chain.secondOrder).toHaveBeenCalledWith('updated_at', { ascending: false })
  })

  it('excludes archived conversations (archived_at IS NOT NULL)', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')

    // Only non-archived rows are returned (the DB/RLS enforces this via .is('archived_at', null))
    const rows = [
      { id: 'conv-active', title: 'Active', updated_at: '2026-07-05T10:00:00Z', pinned_at: null },
    ]

    const chain = makeConversationsChain(rows)
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1', chain) as never,
    )

    const { listConversations } = await import('../chat')
    const result = await listConversations()

    // Only the active conversation is returned
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('conv-active')

    // The archived_at filter was applied
    expect(chain.isNull).toHaveBeenCalledWith('archived_at', null)
  })

  it('returns empty array for a user with no conversations', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')

    const chain = makeConversationsChain([])
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1', chain) as never,
    )

    const { listConversations } = await import('../chat')
    const result = await listConversations()

    expect(result).toEqual([])
  })

  it('returns [] for unauthenticated callers (no user)', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')

    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient(null, {}) as never,
    )

    const { listConversations } = await import('../chat')
    const result = await listConversations()

    expect(result).toEqual([])
  })

  it('returns [] and logs on DB error (never throws)', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const chain = makeConversationsChain([], { message: 'DB connection refused' })
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1', chain) as never,
    )

    const { listConversations } = await import('../chat')
    const result = await listConversations()

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('returns [] and logs when createAuthServerClient throws', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    vi.mocked(createAuthServerClient).mockRejectedValue(new Error('auth exploded'))

    const { listConversations } = await import('../chat')
    const result = await listConversations()

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('returned shape includes exactly id, title, updated_at, pinned_at (C1 contract)', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')

    const rows = [
      { id: 'conv-shape', title: 'Shape test', updated_at: '2026-07-08T00:00:00Z', pinned_at: null },
    ]

    const chain = makeConversationsChain(rows)
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1', chain) as never,
    )

    const { listConversations } = await import('../chat')
    const result = await listConversations()

    expect(result).toHaveLength(1)
    const item = result[0]
    // Required C1 fields
    expect(item).toHaveProperty('id')
    expect(item).toHaveProperty('title')
    expect(item).toHaveProperty('updated_at')
    expect(item).toHaveProperty('pinned_at')
    // Values
    expect(item.id).toBe('conv-shape')
    expect(item.title).toBe('Shape test')
    expect(item.updated_at).toBe('2026-07-08T00:00:00Z')
    expect(item.pinned_at).toBeNull()
  })
})
