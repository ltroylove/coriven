// @vitest-environment node
/**
 * Unit tests for briefing.ts stale-goal section
 * Wave 7.2.1 — Stale-Goal Nudges
 *
 * Tests the stale-goal integration in assembleBriefing:
 *  - Active stale_goal patterns from detected_patterns are included in stalled section
 *  - Day count is correctly parsed from description
 *  - Deduplication by title when same goal appears in both sources
 *  - Section is empty when no active stale patterns exist
 *  - Unique goals from legacy last_nudge_at source are included
 *  - Multiple active stale-goal patterns are all returned
 *
 * NOTE: assembleBriefing makes multiple supabase.from() calls in a fixed sequence.
 * The mock dispatches based on which table is called and in what sequence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

const { createServiceClient } = await import('@/lib/supabase/server')
const { assembleBriefing } = await import('../briefing')

const MOCK_USER_ID = 'user-briefing-test'

// ---------------------------------------------------------------------------
// Chain builders
// ---------------------------------------------------------------------------

/** Build a terminal promise that resolves to { data, error }. */
function resolveWith(data: unknown, error: null | { message: string } = null) {
  return vi.fn().mockResolvedValue({ data, error, count: null })
}

/** Build a terminal promise that resolves to { count, error } (head:true queries). */
function resolveCount(count: number, error: null | { message: string } = null) {
  return vi.fn().mockResolvedValue({ data: null, error, count })
}

// ---------------------------------------------------------------------------
// assembleBriefing call sequence
// ---------------------------------------------------------------------------
// Call 1:  supabase.from('goals').select().eq(user_id).eq(status).in(momentum).limit()
//          → motionGoals
// Call 2+: supabase.from('tasks').select(*,{count,head}).eq(goal_id).neq().neq()
//          → count per motion goal (one call per goal in Promise.all)
// Next:    supabase.from('tasks').select(id,title,due_at).eq(user_id).not().gte().lte().not().order().limit()
//          → upcomingTasks
// Next:    supabase.from('detected_patterns').select().eq(user_id).eq(pattern_type).eq(is_active).limit()
//          → stalePatterns
// Next:    supabase.from('goals').select().eq(user_id).eq(status).not().gte().limit()
//          → stalledGoals
// Next:    supabase.from('approval_queue').select(*,{count,head}).eq(user_id).eq(status)
//          → approvalsPending count

/**
 * Build a full mock supabase client for assembleBriefing.
 *
 * @param motionGoals  - rows for goals in motion (first goals query)
 * @param stalePatterns - rows for detected_patterns stale_goal query
 * @param stalledGoals  - rows for goals stalled by last_nudge_at
 */
function makeClient(opts: {
  motionGoals?: Array<{ id: string; title: string; momentum: string }>
  stalePatterns?: Array<{ id: string; goal_id: string | null; description: string }>
  stalledGoals?: Array<{ id: string; title: string; last_activity_at: string | null }>
}) {
  const { motionGoals = [], stalePatterns = [], stalledGoals = [] } = opts

  // Track which from() call we're on to dispatch correctly
  let callIndex = 0

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    callIndex++
    const idx = callIndex

    // Call 1: goals in motion
    if (table === 'goals' && idx === 1) {
      const limit = resolveWith(motionGoals)
      const inFn = vi.fn().mockReturnValue({ limit })
      const eq2 = vi.fn().mockReturnValue({ in: inFn })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      return { select }
    }

    // Calls 2..N: tasks count per motion goal (one per goal in Promise.all)
    if (table === 'tasks' && idx <= 1 + motionGoals.length) {
      const neq2 = resolveCount(0)
      const neq1 = vi.fn().mockReturnValue({ neq: neq2 })
      const eq = vi.fn().mockReturnValue({ neq: neq1 })
      const select = vi.fn().mockReturnValue({ eq })
      return { select }
    }

    // Next: tasks upcoming (complex chain: .eq().not().gte().lte().not().order().limit())
    if (table === 'tasks') {
      const limit = resolveWith([])
      const order = vi.fn().mockReturnValue({ limit })
      const notStatus = vi.fn().mockReturnValue({ order })
      const lte = vi.fn().mockReturnValue({ not: notStatus })
      const gte = vi.fn().mockReturnValue({ lte })
      const notDue = vi.fn().mockReturnValue({ gte })
      const eq = vi.fn().mockReturnValue({ not: notDue })
      const select = vi.fn().mockReturnValue({ eq })
      return { select }
    }

    // Next: detected_patterns stale_goal
    if (table === 'detected_patterns') {
      const limit = resolveWith(stalePatterns)
      const eq3 = vi.fn().mockReturnValue({ limit })
      const eq2 = vi.fn().mockReturnValue({ eq: eq3 })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      return { select }
    }

    // Next: goals stalled by last_nudge_at (.eq().eq().not().gte().limit())
    if (table === 'goals') {
      const limit = resolveWith(stalledGoals)
      const gte = vi.fn().mockReturnValue({ limit })
      const notFn = vi.fn().mockReturnValue({ gte })
      const eq2 = vi.fn().mockReturnValue({ not: notFn })
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      return { select }
    }

    // Next: approval_queue count (.eq().eq())
    if (table === 'approval_queue') {
      const eq2 = resolveCount(0)
      const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
      const select = vi.fn().mockReturnValue({ eq: eq1 })
      return { select }
    }

    // Fallback
    const fallback = resolveWith([])
    const select = vi.fn().mockReturnValue({ then: fallback })
    return { select }
  })

  return { from: mockFrom }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assembleBriefing — stale-goal section (Wave 7.2.1)', () => {
  it('includes active stale_goal patterns in stalled section', async () => {
    const stalePatterns = [
      {
        id: 'pat-1',
        goal_id: 'goal-abc',
        description: "No activity on 'Read 12 books' for 18 days",
      },
    ]
    vi.mocked(createServiceClient).mockReturnValue(
      makeClient({ stalePatterns }) as never,
    )

    const briefing = await assembleBriefing(MOCK_USER_ID)

    expect(briefing.stalled).toHaveLength(1)
    expect(briefing.stalled[0].goalId).toBe('goal-abc')
    expect(briefing.stalled[0].title).toBe('Read 12 books')
    expect(briefing.stalled[0].daysSinceActivity).toBe(18)
  })

  it('omits stalled section when no active stale-goal patterns or nudged goals exist', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeClient({ stalePatterns: [], stalledGoals: [] }) as never,
    )

    const briefing = await assembleBriefing(MOCK_USER_ID)
    expect(briefing.stalled).toHaveLength(0)
  })

  it('correctly parses day count from description', async () => {
    const stalePatterns = [
      {
        id: 'pat-2',
        goal_id: 'goal-xyz',
        description: "No activity on 'Ship v1' for 21 days",
      },
    ]
    vi.mocked(createServiceClient).mockReturnValue(
      makeClient({ stalePatterns }) as never,
    )

    const briefing = await assembleBriefing(MOCK_USER_ID)
    expect(briefing.stalled[0].daysSinceActivity).toBe(21)
  })

  it('deduplicates goals appearing in both pattern and nudge sources (pattern wins)', async () => {
    const stalePatterns = [
      {
        id: 'pat-3',
        goal_id: 'goal-dupe',
        description: "No activity on 'My Goal' for 15 days",
      },
    ]
    // Same title also comes from last_nudge_at source — should appear only once
    const stalledGoals = [
      {
        id: 'goal-dupe',
        title: 'My Goal',
        last_activity_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]

    vi.mocked(createServiceClient).mockReturnValue(
      makeClient({ stalePatterns, stalledGoals }) as never,
    )

    const briefing = await assembleBriefing(MOCK_USER_ID)
    const myGoalEntries = briefing.stalled.filter(s => s.title === 'My Goal')
    // Appears exactly once
    expect(myGoalEntries).toHaveLength(1)
    // Pattern source (day count = 15) takes priority
    expect(myGoalEntries[0].daysSinceActivity).toBe(15)
  })

  it('includes unique goals from nudge source when not in patterns', async () => {
    const stalledGoals = [
      {
        id: 'goal-nudge-only',
        title: 'Nudge Only Goal',
        last_activity_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]

    vi.mocked(createServiceClient).mockReturnValue(
      makeClient({ stalePatterns: [], stalledGoals }) as never,
    )

    const briefing = await assembleBriefing(MOCK_USER_ID)
    expect(briefing.stalled.some(s => s.title === 'Nudge Only Goal')).toBe(true)
  })

  it('handles multiple active stale-goal patterns', async () => {
    const stalePatterns = [
      {
        id: 'pat-a',
        goal_id: 'goal-a',
        description: "No activity on 'Goal A' for 16 days",
      },
      {
        id: 'pat-b',
        goal_id: 'goal-b',
        description: "No activity on 'Goal B' for 22 days",
      },
    ]
    vi.mocked(createServiceClient).mockReturnValue(
      makeClient({ stalePatterns }) as never,
    )

    const briefing = await assembleBriefing(MOCK_USER_ID)
    expect(briefing.stalled).toHaveLength(2)
    const titles = briefing.stalled.map(s => s.title)
    expect(titles).toContain('Goal A')
    expect(titles).toContain('Goal B')
  })

  it('skips stale patterns without a goal_id', async () => {
    const stalePatterns = [
      {
        id: 'pat-no-goal',
        goal_id: null,
        description: "No activity on 'Orphan' for 10 days",
      },
    ]
    vi.mocked(createServiceClient).mockReturnValue(
      makeClient({ stalePatterns }) as never,
    )

    const briefing = await assembleBriefing(MOCK_USER_ID)
    // Pattern without goal_id is skipped
    expect(briefing.stalled).toHaveLength(0)
  })
})
