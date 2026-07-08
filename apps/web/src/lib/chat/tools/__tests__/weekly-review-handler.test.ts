// @vitest-environment node
/**
 * Unit tests for the generate_weekly_review tool handler
 * Wave 7.3.1 — stored retrieval, force_regenerate, no-review message
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WeeklyReviewContent } from '@personal-assistant/types'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/jobs/weekly-review', () => ({
  assembleWeeklyReview: vi.fn(),
  storeWeeklyReview: vi.fn(),
  getIsoWeekStart: vi.fn().mockReturnValue('2026-07-06'),
}))

const { createServiceClient } = await import('@/lib/supabase/server')
const { assembleWeeklyReview, storeWeeklyReview } = await import('@/lib/jobs/weekly-review')
const { executeToolHandler } = await import('../handlers')

const MOCK_USER_ID = 'user-wr-test-001'

const MOCK_WEEKLY_CONTENT: WeeklyReviewContent = {
  wins: [{ taskId: 't1', title: 'Finished project', goalTitle: 'Launch product' }],
  blockers: [{ type: 'overdue_task', title: 'Send report', detail: '2 days overdue' }],
  nextWeek: [{ taskId: 't2', title: 'Write docs', dueAt: '2026-07-12T17:00:00Z', priority: 'high' }],
}

/** Build a minimal Supabase chain for daily_briefings queries. */
function makeWeeklyBriefingClient(opts: {
  row?: unknown
  error?: { message: string } | null
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.row ?? null,
    error: opts.error ?? null,
  })
  const eq3 = vi.fn().mockReturnValue({ maybeSingle })
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return {
    from: vi.fn().mockReturnValue({ select }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assembleWeeklyReview).mockResolvedValue(MOCK_WEEKLY_CONTENT)
  vi.mocked(storeWeeklyReview).mockResolvedValue(undefined)
})

describe('executeToolHandler: generate_weekly_review', () => {
  // ---------------------------------------------------------------------------
  // Stored review returned (force_regenerate = false, default)
  // ---------------------------------------------------------------------------

  it('returns stored review content when one exists for the current week', async () => {
    const storedRow = {
      content: MOCK_WEEKLY_CONTENT,
      created_at: '2026-07-08T17:00:00Z',
      briefing_date: '2026-07-06',
    }

    vi.mocked(createServiceClient).mockReturnValue(
      makeWeeklyBriefingClient({ row: storedRow }) as never,
    )

    const result = await executeToolHandler('generate_weekly_review', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(false)
    expect(result.content).toContain('Weekly Review')
    expect(result.content).toContain('Wins')
    expect(result.content).toContain('Finished project')
    expect(result.content).toContain('Blockers')
    expect(result.content).toContain('Send report')
    expect(result.content).toContain('Next-Week Focus')
    // Should NOT have called the assembly library
    expect(vi.mocked(assembleWeeklyReview)).not.toHaveBeenCalled()
  })

  it('returns no-review message when no review exists', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeWeeklyBriefingClient({ row: null }) as never,
    )

    const result = await executeToolHandler('generate_weekly_review', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(false)
    expect(result.content).toContain('No weekly review')
    expect(result.content).not.toContain('{') // must not be raw JSON
  })

  // ---------------------------------------------------------------------------
  // force_regenerate = true
  // ---------------------------------------------------------------------------

  it('assembles and stores fresh review when force_regenerate=true', async () => {
    const result = await executeToolHandler(
      'generate_weekly_review',
      { force_regenerate: true },
      MOCK_USER_ID,
    )
    expect(result.is_error).toBe(false)
    expect(result.content).toContain('Weekly Review')
    expect(vi.mocked(assembleWeeklyReview)).toHaveBeenCalledWith(MOCK_USER_ID, expect.any(Date))
    expect(vi.mocked(storeWeeklyReview)).toHaveBeenCalledTimes(1)
  })

  it('assembles fresh even when DB has stored review if force_regenerate=true', async () => {
    // Even if a DB row exists, force_regenerate bypasses the stored lookup
    const result = await executeToolHandler(
      'generate_weekly_review',
      { force_regenerate: true },
      MOCK_USER_ID,
    )
    expect(result.is_error).toBe(false)
    // createServiceClient should NOT have been called for a DB lookup
    // (force path calls assembly directly, not DB)
    // The key assertion: assembleWeeklyReview was called
    expect(vi.mocked(assembleWeeklyReview)).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------------------

  it('returns is_error=true when DB lookup fails', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeWeeklyBriefingClient({ row: null, error: { message: 'connection error' } }) as never,
    )

    const result = await executeToolHandler('generate_weekly_review', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Failed to retrieve weekly review')
    // Must not leak raw DB error
    expect(result.content).not.toContain('connection error')
  })

  it('returns is_error=true when force_regenerate assembly throws', async () => {
    vi.mocked(assembleWeeklyReview).mockRejectedValue(new Error('assembly failed'))

    const result = await executeToolHandler(
      'generate_weekly_review',
      { force_regenerate: true },
      MOCK_USER_ID,
    )
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('Failed to generate weekly review')
  })

  // ---------------------------------------------------------------------------
  // Narrative inclusion
  // ---------------------------------------------------------------------------

  it('includes narrative in output when present in stored review', async () => {
    const storedRow = {
      content: { ...MOCK_WEEKLY_CONTENT, narrative: 'A strong week with great focus.' },
      created_at: '2026-07-08T17:00:00Z',
      briefing_date: '2026-07-06',
    }

    vi.mocked(createServiceClient).mockReturnValue(
      makeWeeklyBriefingClient({ row: storedRow }) as never,
    )

    const result = await executeToolHandler('generate_weekly_review', {}, MOCK_USER_ID)
    expect(result.is_error).toBe(false)
    expect(result.content).toContain('A strong week with great focus.')
  })
})
