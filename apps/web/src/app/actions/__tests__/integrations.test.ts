// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))

// Stub env vars required by the module before any import.
vi.stubEnv('NANGO_SECRET_KEY', 'test-secret-key')
vi.stubEnv('NANGO_HOST', 'https://nango.test')

// ─── Shared Nango instance mock ──────────────────────────────────────────────
// We expose a mutable object that tests can reconfigure per case.
const nangoMethods = {
  createConnectSession: vi.fn(),
  deleteConnection: vi.fn(),
}

vi.mock('@nangohq/node', () => {
  // Use a real class so `new Nango(...)` doesn't throw "not a constructor".
  class NangoMock {
    createConnectSession: typeof nangoMethods.createConnectSession
    deleteConnection: typeof nangoMethods.deleteConnection

    constructor() {
      this.createConnectSession = nangoMethods.createConnectSession
      this.deleteConnection = nangoMethods.deleteConnection
    }
  }
  return { Nango: NangoMock }
})

const { createAuthServerClient } = await import('@/lib/supabase/auth-server')

function makeAuthClient(
  userId: string | null,
  dbMock: Record<string, unknown> = {},
) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email: `${userId}@test.com` } : null },
      }),
    },
    from: vi.fn().mockReturnValue(dbMock),
  }
}

// ─── createConnectSession ────────────────────────────────────────────────────

describe('createConnectSession', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns error when not authenticated', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient(null) as never,
    )
    const { createConnectSession } = await import('../integrations')
    const result = await createConnectSession('gmail')
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('returns error for invalid provider', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    const { createConnectSession } = await import('../integrations')
    const result = await createConnectSession('twitter')
    expect(result).toEqual({ error: 'Invalid provider' })
  })

  it('returns a session token on success', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    nangoMethods.createConnectSession.mockResolvedValue({
      data: { token: 'sess-tok-123', connect_link: '', expires_at: '' },
    })

    const { createConnectSession } = await import('../integrations')
    const result = await createConnectSession('gmail')
    expect(result).toEqual({ token: 'sess-tok-123' })
  })

  it('accepts all four valid providers', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    nangoMethods.createConnectSession.mockResolvedValue({
      data: { token: 'tok', connect_link: '', expires_at: '' },
    })
    const { createConnectSession } = await import('../integrations')
    for (const p of ['gmail', 'outlook', 'google_calendar', 'outlook_calendar']) {
      const r = await createConnectSession(p)
      expect(r.token).toBe('tok')
    }
  })

  it('returns generic error when Nango call fails', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    nangoMethods.createConnectSession.mockRejectedValue(new Error('Network error'))

    const { createConnectSession } = await import('../integrations')
    const result = await createConnectSession('gmail')
    expect(result.error).toMatch(/failed to initiate/i)
  })
})

// ─── recordConnection ────────────────────────────────────────────────────────

describe('recordConnection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns error when not authenticated', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient(null) as never,
    )
    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('gmail', 'some-id')
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('returns error for invalid provider', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('slack', 'user-1')
    expect(result).toEqual({ error: 'Invalid provider' })
  })

  it('returns error when connectionId does not match user id', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('gmail', 'other-user-id')
    expect(result).toEqual({ error: 'Connection ID mismatch' })
  })

  it('upserts integration row with canonical schema on success', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null })
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user-1@test.com' } },
        }),
      },
      from: vi.fn().mockReturnValue({ upsert: mockUpsert }),
    }
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)

    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('gmail', 'user-1')
    expect(result).toEqual({})
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        provider: 'gmail',
        nango_connection_id: 'user-1',
        scopes: ['gmail.readonly', 'gmail.send'],
      }),
      expect.any(Object),
    )
  })

  it('returns error when DB upsert fails', async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: { message: 'DB error' } })
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user-1@test.com' } },
        }),
      },
      from: vi.fn().mockReturnValue({ upsert: mockUpsert }),
    }
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)

    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('gmail', 'user-1')
    expect(result.error).toMatch(/failed to save/i)
  })
})

// ─── disconnectProvider ──────────────────────────────────────────────────────

describe('disconnectProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns error when not authenticated', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient(null) as never,
    )
    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('returns error for invalid provider', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('unknown')
    expect(result).toEqual({ error: 'Invalid provider' })
  })

  it('deletes Nango connection (using canonical config key) then DB row on success', async () => {
    const mockEqChain = vi.fn().mockResolvedValue({ error: null })
    const mockEq = vi.fn().mockReturnValue({ eq: mockEqChain })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user-1@test.com' } },
        }),
      },
      from: vi.fn().mockReturnValue({ delete: mockDelete }),
    }
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)
    nangoMethods.deleteConnection.mockResolvedValue(undefined)

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result).toEqual({})
    // Canonical config key for gmail is 'google-mail' (per PROVIDER_CONFIG_KEYS).
    expect(nangoMethods.deleteConnection).toHaveBeenCalledWith('google-mail', 'user-1')
    expect(mockDelete).toHaveBeenCalled()
  })

  it('returns error and does NOT delete DB row when Nango delete fails with non-404', async () => {
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user-1@test.com' } },
        }),
      },
      from: vi.fn(),
    }
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)
    nangoMethods.deleteConnection.mockRejectedValue(new Error('Service unavailable 503'))

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result.error).toMatch(/failed to revoke/i)
    // from() must never be called — DB row preserved.
    expect(client.from).not.toHaveBeenCalled()
  })

  it('proceeds with DB delete when Nango returns 404 (not-found)', async () => {
    const mockEqChain = vi.fn().mockResolvedValue({ error: null })
    const mockEq = vi.fn().mockReturnValue({ eq: mockEqChain })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user-1@test.com' } },
        }),
      },
      from: vi.fn().mockReturnValue({ delete: mockDelete }),
    }
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)
    nangoMethods.deleteConnection.mockRejectedValue(new Error('404 connection not found'))

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result).toEqual({})
    expect(mockDelete).toHaveBeenCalled()
  })

  it('returns error when DB delete fails', async () => {
    const mockEqChain = vi.fn().mockResolvedValue({ error: { message: 'DB write error' } })
    const mockEq = vi.fn().mockReturnValue({ eq: mockEqChain })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user-1@test.com' } },
        }),
      },
      from: vi.fn().mockReturnValue({ delete: mockDelete }),
    }
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)
    nangoMethods.deleteConnection.mockResolvedValue(undefined)

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result.error).toMatch(/failed to remove/i)
  })
})
