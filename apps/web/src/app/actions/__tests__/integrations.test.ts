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
  listConnections: vi.fn(),
}

vi.mock('@nangohq/node', () => {
  // Use a real class so `new Nango(...)` doesn't throw "not a constructor".
  class NangoMock {
    createConnectSession: typeof nangoMethods.createConnectSession
    deleteConnection: typeof nangoMethods.deleteConnection
    listConnections: typeof nangoMethods.listConnections

    constructor() {
      this.createConnectSession = nangoMethods.createConnectSession
      this.deleteConnection = nangoMethods.deleteConnection
      this.listConnections = nangoMethods.listConnections
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

  it('returns error when Nango reports no connection for the user', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    nangoMethods.listConnections.mockResolvedValue({ connections: [] })

    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('gmail', 'nango-conn-abc')
    expect(result.error).toMatch(/no connection found/i)
  })

  it('persists the authoritative Nango connection ID (not the user id) on success', async () => {
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
    // Nango returns its own generated connection ID, scoped to this end user.
    nangoMethods.listConnections.mockResolvedValue({
      connections: [{ connection_id: 'nango-conn-xyz', provider_config_key: 'google-mail' }],
    })

    const { recordConnection } = await import('../integrations')
    // The client-supplied hint matches the authoritative connection.
    const result = await recordConnection('gmail', 'nango-conn-xyz')
    expect(result).toEqual({})
    expect(nangoMethods.listConnections).toHaveBeenCalledWith({
      userId: 'user-1',
      integrationId: 'google-mail',
    })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        provider: 'gmail',
        nango_connection_id: 'nango-conn-xyz',
        scopes: ['gmail.readonly', 'gmail.send'],
      }),
      expect.any(Object),
    )
  })

  it('falls back to the sole user connection when the client hint does not match', async () => {
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
    nangoMethods.listConnections.mockResolvedValue({
      connections: [{ connection_id: 'authoritative-id', provider_config_key: 'google-mail' }],
    })

    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('gmail', 'stale-client-hint')
    expect(result).toEqual({})
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ nango_connection_id: 'authoritative-id' }),
      expect.any(Object),
    )
  })

  it('returns error when the Nango lookup throws', async () => {
    vi.mocked(createAuthServerClient).mockResolvedValue(
      makeAuthClient('user-1') as never,
    )
    nangoMethods.listConnections.mockRejectedValue(new Error('Nango unreachable'))

    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('gmail', 'nango-conn-xyz')
    expect(result.error).toMatch(/failed to verify/i)
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
    nangoMethods.listConnections.mockResolvedValue({
      connections: [{ connection_id: 'nango-conn-xyz', provider_config_key: 'google-mail' }],
    })

    const { recordConnection } = await import('../integrations')
    const result = await recordConnection('gmail', 'nango-conn-xyz')
    expect(result.error).toMatch(/failed to save/i)
  })
})

// ─── disconnectProvider ──────────────────────────────────────────────────────

describe('disconnectProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  /**
   * Builds an auth client whose `from('integrations')` supports BOTH:
   *   - the select chain: .select().eq().eq().maybeSingle() → { data: storedRow }
   *   - the delete chain: .delete().eq().eq() → { error: deleteError }
   * `storedRow` null simulates "no connection on record".
   */
  function makeDisconnectClient(opts: {
    storedConnectionId: string | null
    deleteError?: { message: string } | null
  }) {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: opts.storedConnectionId
        ? { nango_connection_id: opts.storedConnectionId }
        : null,
      error: null,
    })
    const selectChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle }),
      }),
    }
    const mockDeleteEqChain = vi.fn().mockResolvedValue({
      error: opts.deleteError ?? null,
    })
    const mockDeleteEq = vi.fn().mockReturnValue({ eq: mockDeleteEqChain })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq })

    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      delete: mockDelete,
    })

    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'user-1@test.com' } },
        }),
      },
      from,
    }
    return { client, mockDelete }
  }

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

  it('is idempotent when no connection row exists (no Nango call, no delete)', async () => {
    const { client, mockDelete } = makeDisconnectClient({ storedConnectionId: null })
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result).toEqual({})
    expect(nangoMethods.deleteConnection).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('revokes the stored Nango connection ID (not user id) then deletes the DB row', async () => {
    const { client, mockDelete } = makeDisconnectClient({
      storedConnectionId: 'nango-conn-xyz',
    })
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)
    nangoMethods.deleteConnection.mockResolvedValue(undefined)

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result).toEqual({})
    // Canonical config key 'google-mail' + the STORED connection id, not user.id.
    expect(nangoMethods.deleteConnection).toHaveBeenCalledWith('google-mail', 'nango-conn-xyz')
    expect(mockDelete).toHaveBeenCalled()
  })

  it('returns error and does NOT delete DB row when Nango delete fails with non-404', async () => {
    const { client, mockDelete } = makeDisconnectClient({
      storedConnectionId: 'nango-conn-xyz',
    })
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)
    nangoMethods.deleteConnection.mockRejectedValue(new Error('Service unavailable 503'))

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result.error).toMatch(/failed to revoke/i)
    // delete() must never be called — DB row preserved.
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('proceeds with DB delete when Nango returns 404 (not-found)', async () => {
    const { client, mockDelete } = makeDisconnectClient({
      storedConnectionId: 'nango-conn-xyz',
    })
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)
    nangoMethods.deleteConnection.mockRejectedValue(new Error('404 connection not found'))

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result).toEqual({})
    expect(mockDelete).toHaveBeenCalled()
  })

  it('returns error when DB delete fails', async () => {
    const { client } = makeDisconnectClient({
      storedConnectionId: 'nango-conn-xyz',
      deleteError: { message: 'DB write error' },
    })
    vi.mocked(createAuthServerClient).mockResolvedValue(client as never)
    nangoMethods.deleteConnection.mockResolvedValue(undefined)

    const { disconnectProvider } = await import('../integrations')
    const result = await disconnectProvider('gmail')
    expect(result.error).toMatch(/failed to remove/i)
  })
})
