// @vitest-environment node
/**
 * Unit tests for the detect_patterns tool handler
 * Wave 7.1.1 — Tool handler: empty case, populated case, DB error
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

// Import handlers module after mocking its dependencies
const { createServiceClient } = await import('@/lib/supabase/server')
const { executeToolHandler } = await import('../handlers')

const MOCK_USER_ID = 'user-test-123'

/** Build a mock Supabase client for the detect_patterns query chain.
 *  Chain: .from().select().eq().eq().order()
 */
function makeDetectPatternsClient(opts: {
  data?: unknown[] | null
  error?: { message: string } | null
}) {
  const order = vi.fn().mockResolvedValue({
    data: opts.data ?? [],
    error: opts.error ?? null,
  })
  const eq2 = vi.fn().mockReturnValue({ order })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })

  return {
    from: vi.fn().mockReturnValue({ select }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('executeToolHandler: detect_patterns', () => {
  // ---------------------------------------------------------------------------
  // Empty case
  // ---------------------------------------------------------------------------

  it('returns empty array and is_error=false when no patterns exist', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeDetectPatternsClient({ data: [] }) as never,
    )

    const result = await executeToolHandler('detect_patterns', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(false)
    expect(JSON.parse(result.content)).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Populated case
  // ---------------------------------------------------------------------------

  it('returns serialized patterns and is_error=false when patterns exist', async () => {
    const patterns = [
      {
        id: 'pat-001',
        pattern_type: 'gym_days',
        description: 'You tend to work out on Tuesdays',
        last_detected_at: '2026-07-08T03:00:00Z',
        last_notified_at: null,
        is_active: true,
        created_at: '2026-07-01T03:00:00Z',
        updated_at: '2026-07-08T03:00:00Z',
      },
    ]
    vi.mocked(createServiceClient).mockReturnValue(
      makeDetectPatternsClient({ data: patterns }) as never,
    )

    const result = await executeToolHandler('detect_patterns', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(false)
    const parsed = JSON.parse(result.content)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('pat-001')
    expect(parsed[0].pattern_type).toBe('gym_days')
  })

  // ---------------------------------------------------------------------------
  // DB error case
  // ---------------------------------------------------------------------------

  it('returns is_error=true with message on DB failure', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeDetectPatternsClient({ data: null, error: { message: 'connection error' } }) as never,
    )

    const result = await executeToolHandler('detect_patterns', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Failed to retrieve patterns')
    // Must not leak raw DB error message to the model
    expect(result.content).not.toContain('connection error')
  })

  // ---------------------------------------------------------------------------
  // Filter: is_active defaults to true
  // ---------------------------------------------------------------------------

  it('applies is_active=true filter by default', async () => {
    const client = makeDetectPatternsClient({ data: [] })
    vi.mocked(createServiceClient).mockReturnValue(client as never)

    await executeToolHandler('detect_patterns', {}, MOCK_USER_ID)

    // Verify .eq('is_active', true) was called
    const fromCall = vi.mocked(client.from)
    expect(fromCall).toHaveBeenCalledWith('detected_patterns')
  })

  // ---------------------------------------------------------------------------
  // Filter: explicit is_active=false
  // ---------------------------------------------------------------------------

  it('returns is_error=false with empty array for is_active=false and no data', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeDetectPatternsClient({ data: [] }) as never,
    )

    const result = await executeToolHandler('detect_patterns', { is_active: false }, MOCK_USER_ID)
    expect(result.is_error).toBe(false)
    expect(JSON.parse(result.content)).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Unknown tool fallback
  // ---------------------------------------------------------------------------

  it('returns error for unknown tool name', async () => {
    const result = await executeToolHandler('nonexistent_tool', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Unknown tool')
  })
})
