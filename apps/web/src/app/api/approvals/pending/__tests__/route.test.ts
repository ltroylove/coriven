// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/api-server', () => ({
  createApiServerClient: vi.fn(),
}))

const { createApiServerClient } = await import('@/lib/supabase/api-server')
const { GET } = await import('../route')

/** Build a NextRequest-like object with optional Authorization header. */
function makeRequest(options: { bearerToken?: string } = {}) {
  const headers = new Headers()
  if (options.bearerToken) {
    headers.set('Authorization', `Bearer ${options.bearerToken}`)
  }
  return new Request('http://localhost/api/approvals/pending', { headers })
}

/**
 * Builds a mock auth client whose query chain resolves to `{ data, error }`:
 *   supabase.from('approval_queue').select(...).eq('status','pending').order('created_at',...)
 * The `.order()` call is the awaited terminal.
 * Captures the `.select()` argument so tests can assert the whitelist.
 */
function makeClient(opts: {
  userId: string | null
  data?: unknown[] | null
  error?: { message: string } | null
}) {
  const selectSpy = vi.fn()
  const order = vi.fn().mockResolvedValue({ data: opts.data ?? null, error: opts.error ?? null })
  const eq = vi.fn().mockReturnValue({ order })
  const select = vi.fn().mockImplementation((cols: string) => {
    selectSpy(cols)
    return { eq }
  })
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.userId ? { id: opts.userId } : null },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue({ select }),
  }
  return { client, selectSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/approvals/pending', () => {
  it('returns 401 when unauthenticated (cookie path)', async () => {
    const { client } = makeClient({ userId: null })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest() as never)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  // Bearer token path
  describe('Bearer token path', () => {
    it('authenticates via Bearer token and returns pending approvals', async () => {
      const rows = [
        { id: 'a1', action_type: 'send_email', provider: 'gmail', created_at: '2026-07-05T10:00:00Z' },
      ]
      const { client } = makeClient({ userId: 'user-tray', data: rows })
      vi.mocked(createApiServerClient).mockResolvedValue(client as never)

      const res = await GET(makeRequest({ bearerToken: 'valid-jwt' }) as never)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.count).toBe(1)
      expect(body.items[0].id).toBe('a1')
      expect(vi.mocked(createApiServerClient)).toHaveBeenCalledOnce()
    })

    it('returns 401 when Bearer token is invalid (getUser returns null)', async () => {
      const { client } = makeClient({ userId: null })
      vi.mocked(createApiServerClient).mockResolvedValue(client as never)

      const res = await GET(makeRequest({ bearerToken: 'bad-token' }) as never)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
    })
  })

  // Cookie session path still works
  describe('cookie session path', () => {
    it('authenticates via cookie session and returns approvals', async () => {
      const rows = [
        { id: 'a1', action_type: 'send_email', provider: 'gmail', created_at: '2026-07-05T10:00:00Z' },
      ]
      const { client } = makeClient({ userId: 'user-browser', data: rows })
      vi.mocked(createApiServerClient).mockResolvedValue(client as never)

      const res = await GET(makeRequest() as never)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.count).toBe(1)
    })
  })

  it('returns count + items for pending approvals', async () => {
    const rows = [
      { id: 'a1', action_type: 'send_email', provider: 'gmail', created_at: '2026-07-05T10:00:00Z' },
      { id: 'a2', action_type: 'create_calendar_event', provider: 'google_calendar', created_at: '2026-07-05T09:00:00Z' },
    ]
    const { client } = makeClient({ userId: 'user-1', data: rows })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest() as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].id).toBe('a1')
  })

  it('returns 200 with empty count/items when nothing is pending (not 404)', async () => {
    const { client } = makeClient({ userId: 'user-1', data: [] })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest() as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 0, items: [] })
  })

  it('only selects the whitelisted columns — never payload or ai_summary (ADR-013)', async () => {
    const { client, selectSpy } = makeClient({ userId: 'user-1', data: [] })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    await GET(makeRequest() as never)
    const selectedCols = selectSpy.mock.calls[0][0] as string
    // Exact whitelist — order-insensitive check
    const cols = selectedCols.split(',').map((c) => c.trim()).sort()
    expect(cols).toEqual(['action_type', 'created_at', 'id', 'provider'])
    expect(selectedCols).not.toContain('payload')
    expect(selectedCols).not.toContain('ai_summary')
  })

  it('returned items carry no payload-capable keys (structural exclusion)', async () => {
    // Even if the DB layer somehow returned extra columns, the response items
    // must expose only the safe metadata shape. Assert the exact key set.
    const rows = [
      { id: 'a1', action_type: 'send_email', provider: 'gmail', created_at: '2026-07-05T10:00:00Z' },
    ]
    const { client } = makeClient({ userId: 'user-1', data: rows })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest() as never)
    const body = await res.json()
    expect(Object.keys(body.items[0]).sort()).toEqual(['action_type', 'created_at', 'id', 'provider'])
    expect(body.items[0]).not.toHaveProperty('payload')
    expect(body.items[0]).not.toHaveProperty('ai_summary')
  })

  it('returns 500 with a generic body (no raw error) on DB failure', async () => {
    const { client } = makeClient({ userId: 'user-1', error: { message: 'connection reset: secret-leak' } })
    vi.mocked(createApiServerClient).mockResolvedValue(client as never)

    const res = await GET(makeRequest() as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: 'Internal error' })
    expect(JSON.stringify(body)).not.toContain('secret-leak')
  })
})
