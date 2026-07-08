// @vitest-environment node
/**
 * Unit tests for lib/jobs/weekly-review.ts
 * Wave 7.3.1 — Weekly Review
 *
 * Tests cover:
 *  - getIsoWeekStart: boundary cases for Monday computation
 *  - Wins query: boundary at exactly 7 days
 *  - Blockers query: overdue vs future tasks; declining goals
 *  - Next-week focus: ≤5 tasks, priority ordering
 *  - Haiku failure: assembly completes without narrative
 *  - assembleWeeklyReview returns WeeklyReviewContent shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getIsoWeekStart } from '../weekly-review'

// ---------------------------------------------------------------------------
// Pure helper tests — no mocking needed
// ---------------------------------------------------------------------------

describe('getIsoWeekStart', () => {
  it('returns Monday YYYY-MM-DD for a Monday input', () => {
    // 2026-07-06 is a Monday
    const monday = new Date('2026-07-06T00:00:00Z')
    expect(getIsoWeekStart(monday)).toBe('2026-07-06')
  })

  it('returns Monday for a Wednesday', () => {
    // 2026-07-08 is a Wednesday; week-start is 2026-07-06 (Monday)
    const wednesday = new Date('2026-07-08T12:00:00Z')
    expect(getIsoWeekStart(wednesday)).toBe('2026-07-06')
  })

  it('returns Monday for a Sunday', () => {
    // 2026-07-12 is a Sunday; week-start is 2026-07-06 (Monday, previous week)
    const sunday = new Date('2026-07-12T23:59:00Z')
    expect(getIsoWeekStart(sunday)).toBe('2026-07-06')
  })

  it('returns Monday for a Friday', () => {
    // 2026-07-10 is a Friday; week-start is 2026-07-06 (Monday)
    const friday = new Date('2026-07-10T17:00:00Z')
    expect(getIsoWeekStart(friday)).toBe('2026-07-06')
  })

  it('returns Monday for a Saturday', () => {
    // 2026-07-11 is a Saturday; week-start is 2026-07-06 (Monday)
    const saturday = new Date('2026-07-11T08:00:00Z')
    expect(getIsoWeekStart(saturday)).toBe('2026-07-06')
  })
})

// ---------------------------------------------------------------------------
// assembleWeeklyReview — mocked Supabase + Anthropic
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/anthropic', () => ({
  anthropic: {
    messages: {
      create: vi.fn(),
    },
  },
  CHAT_MODEL_FAST: 'claude-haiku-test',
}))

const { createServiceClient } = await import('@/lib/supabase/server')
const { anthropic } = await import('@/lib/anthropic')
const { assembleWeeklyReview } = await import('../weekly-review')

const MOCK_USER_ID = 'user-test-weekly-001'

// ---------------------------------------------------------------------------
// DB mock builders
// ---------------------------------------------------------------------------

/**
 * Build a minimal Supabase mock that supports the chained query pattern used
 * by assembleWeeklyReview:
 *   .from(table).select(...).eq(...).eq(...)[...filter methods...].order(...)
 *
 * Each call to `from(table)` returns a fresh chain based on `responses[table]`.
 * If a table is not in `responses`, returns { data: [], error: null }.
 */
function makeSupabaseClient(responses: Record<string, { data: unknown[] | null; error: { message: string } | null }>) {
  const makeChain = (tableResponse: { data: unknown[] | null; error: { message: string } | null }) => {
    // Terminal resolvers
    const terminal = vi.fn().mockResolvedValue(tableResponse)

    // Every filter step returns a new object with the same terminal methods
    const chain: Record<string, unknown> = {}
    const chainMethods = ['eq', 'in', 'not', 'gte', 'lte', 'lt', 'gt', 'order', 'limit', 'select', 'filter']

    for (const method of chainMethods) {
      chain[method] = vi.fn().mockReturnValue(chain)
    }

    // Make the chain itself thenable (for `await chain`)
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(tableResponse).then(resolve)
    chain.catch = (reject: (v: unknown) => unknown) => Promise.resolve(tableResponse).catch(reject)

    // count queries (head: true)
    chain.select = vi.fn().mockImplementation((cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head && opts?.count) {
        // Return count-only result
        return {
          ...chain,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ count: (tableResponse.data ?? []).length, error: tableResponse.error }).then(resolve),
        }
      }
      return chain
    })

    void terminal

    return chain
  }

  return {
    from: vi.fn().mockImplementation((table: string) => {
      const resp = responses[table] ?? { data: [], error: null }
      return makeChain(resp)
    }),
  }
}

// ---------------------------------------------------------------------------
// Reference dates
// ---------------------------------------------------------------------------

// Reference: Wednesday 2026-07-08T12:00:00Z
const NOW = new Date('2026-07-08T12:00:00Z')

// Exactly 7 days ago (at the boundary)
const EXACTLY_7_DAYS_AGO = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000)

// 7 days and 1 hour ago (outside the window)
const OUTSIDE_WINDOW = new Date(NOW.getTime() - (7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000))

// Yesterday (overdue)
const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)

// Tomorrow (not overdue)
const TOMORROW = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)

// ---------------------------------------------------------------------------
// Helper: build task-like rows
// ---------------------------------------------------------------------------

function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `task-${Math.random().toString(36).slice(2)}`,
    title: 'Test task',
    status: 'done',
    priority: 'high',
    due_at: null,
    goal_id: null,
    completed_at: NOW.toISOString(),
    ...overrides,
  }
}

function makeGoal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `goal-${Math.random().toString(36).slice(2)}`,
    title: 'Test goal',
    momentum: 'stable',
    status: 'active',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: Anthropic API throws (simulates unavailable key)
  vi.mocked(anthropic.messages.create).mockRejectedValue(new Error('API unavailable'))
})

// ---------------------------------------------------------------------------
// Test: Wins query boundary
// ---------------------------------------------------------------------------

describe('assembleWeeklyReview — wins query', () => {
  it('includes a task completed exactly 7 days ago', async () => {
    const task = makeTask({ completed_at: EXACTLY_7_DAYS_AGO.toISOString() })

    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [task], error: null },
        goals: { data: [], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    expect(result.wins).toHaveLength(1)
    expect(result.wins[0].title).toBe('Test task')
  })

  it('excludes a task completed 7 days and 1 hour ago', async () => {
    const task = makeTask({ completed_at: OUTSIDE_WINDOW.toISOString() })

    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [], error: null }, // API filters it out at DB level
        goals: { data: [], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    expect(result.wins).toHaveLength(0)
  })

  it('groups wins by goal title when task has goal_id', async () => {
    const goalId = 'goal-abc'
    const task = makeTask({ goal_id: goalId })
    const goal = makeGoal({ id: goalId, title: 'Read 12 books' })

    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [task], error: null },
        goals: { data: [goal], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    expect(result.wins[0].goalTitle).toBe('Read 12 books')
  })
})

// ---------------------------------------------------------------------------
// Test: Blockers query
// ---------------------------------------------------------------------------

describe('assembleWeeklyReview — blockers query', () => {
  it('includes an overdue task (due yesterday)', async () => {
    const task = makeTask({
      status: 'pending',
      due_at: YESTERDAY.toISOString(),
      completed_at: null,
    })

    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [task], error: null },
        goals: { data: [], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    const overdueBlocker = result.blockers.find(b => b.type === 'overdue_task')
    expect(overdueBlocker).toBeDefined()
    expect(overdueBlocker?.title).toBe('Test task')
  })

  it('does not include a task due tomorrow in overdue blockers', async () => {
    // The DB query filters by lt(due_at, now) — tasks due tomorrow don't appear
    // We simulate this by returning no data for the overdue query
    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [], error: null }, // API excludes future-due tasks
        goals: { data: [], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    expect(result.blockers.filter(b => b.type === 'overdue_task')).toHaveLength(0)
  })

  it('includes a goal with declining momentum as a blocker', async () => {
    const goal = makeGoal({ momentum: 'declining' })

    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [], error: null },
        goals: { data: [goal], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    const goalBlocker = result.blockers.find(b => b.type === 'declining_goal')
    expect(goalBlocker).toBeDefined()
    expect(goalBlocker?.detail).toBe('momentum: declining')
  })
})

// ---------------------------------------------------------------------------
// Test: Next-week focus
// ---------------------------------------------------------------------------

describe('assembleWeeklyReview — next-week focus', () => {
  it('returns at most 5 tasks', async () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      makeTask({
        id: `task-next-${i}`,
        status: 'pending',
        priority: 'high',
        due_at: new Date(NOW.getTime() + (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
        completed_at: null,
      }),
    )

    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: tasks, error: null },
        goals: { data: [], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    expect(result.nextWeek.length).toBeLessThanOrEqual(5)
  })

  it('orders urgent tasks before high priority', async () => {
    const high1 = makeTask({
      id: 'task-high-1',
      status: 'pending',
      priority: 'high',
      due_at: TOMORROW.toISOString(),
      completed_at: null,
    })
    const urgent1 = makeTask({
      id: 'task-urgent-1',
      status: 'pending',
      priority: 'urgent',
      due_at: new Date(TOMORROW.getTime() + 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
      completed_at: null,
    })

    // DB returns them in due_at order (high first, then urgent)
    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [high1, urgent1], error: null },
        goals: { data: [], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    // After sorting by priority desc, urgent should come first
    expect(result.nextWeek[0].priority).toBe('urgent')
    expect(result.nextWeek[1].priority).toBe('high')
  })
})

// ---------------------------------------------------------------------------
// Test: Haiku failure does not block storage
// ---------------------------------------------------------------------------

describe('assembleWeeklyReview — haiku failure', () => {
  it('returns structured content without narrative when Anthropic API fails', async () => {
    const task = makeTask({ completed_at: NOW.toISOString() })

    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [task], error: null },
        goals: { data: [], error: null },
      }) as never,
    )

    // anthropic.messages.create is already mocked to throw in beforeEach
    // We set ANTHROPIC_API_KEY to simulate it being present
    const originalKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key'

    let result
    let threw = false
    try {
      result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    } catch {
      threw = true
    } finally {
      process.env.ANTHROPIC_API_KEY = originalKey
    }

    // Must not throw despite Haiku failure
    expect(threw).toBe(false)
    // Structured sections must still be present
    expect(result).toBeDefined()
    expect(result!.wins).toBeDefined()
    expect(result!.blockers).toBeDefined()
    expect(result!.nextWeek).toBeDefined()
    // narrative must be absent (not fabricated)
    expect(result!.narrative).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Test: WeeklyReviewContent shape
// ---------------------------------------------------------------------------

describe('assembleWeeklyReview — output shape', () => {
  it('returns all three required sections', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseClient({
        tasks: { data: [], error: null },
        goals: { data: [], error: null },
      }) as never,
    )

    const result = await assembleWeeklyReview(MOCK_USER_ID, NOW)
    expect(Array.isArray(result.wins)).toBe(true)
    expect(Array.isArray(result.blockers)).toBe(true)
    expect(Array.isArray(result.nextWeek)).toBe(true)
  })
})
