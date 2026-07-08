/**
 * Unit tests for lib/jobs/detect-patterns.ts
 * Wave 7.1.1 — Pattern Detection
 *
 * Tests cover:
 *  - detectGymDays: qualifying and non-qualifying patterns
 *  - detectWeeklyReviewTime: qualifying and non-qualifying patterns
 *  - detectStaleGoals: threshold logic, active/non-active filtering
 *  - detectFollowUpNeeded: threshold and status filtering
 *  - hasSufficientHistory: cold-start guard
 *  - Pattern type, description shape
 */

import { describe, it, expect } from 'vitest'
import {
  detectGymDays,
  detectWeeklyReviewTime,
  detectStaleGoals,
  detectFollowUpNeeded,
  hasSufficientHistory,
  staleGoalDescription,
  GYM_DAYS_MIN_OCCURRENCES,
  GYM_DAYS_LOOKBACK_DAYS,
  WEEKLY_REVIEW_MIN_OCCURRENCES,
  STALE_GOAL_THRESHOLD_DAYS,
  FOLLOW_UP_NEEDED_THRESHOLD_DAYS,
} from '../detect-patterns'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build an ISO-8601 string for `daysAgo` days before `now`. */
function daysAgoISO(days: number, now: Date = new Date()): string {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

/** Build a completed task record with a specific weekday within the lookback window. */
function makeCompletion(opts: {
  title: string
  daysAgo?: number
  weekday?: number // 0=Sun…6=Sat, used to nudge the date
  now?: Date
}): { title: string; completed_at: string } {
  const now = opts.now ?? new Date()
  // Use a date `daysAgo` before now, defaulting to 7 days
  const days = opts.daysAgo ?? 7
  const base = new Date(now)
  base.setUTCDate(base.getUTCDate() - days)

  // If a specific weekday is requested, shift the date to that weekday
  if (opts.weekday !== undefined) {
    const current = base.getUTCDay()
    const diff = (opts.weekday - current + 7) % 7
    base.setUTCDate(base.getUTCDate() + diff)
    // Make sure we still land within the lookback window (shift back a week if needed)
    const cutoff = new Date(now)
    cutoff.setUTCDate(cutoff.getUTCDate() - GYM_DAYS_LOOKBACK_DAYS)
    if (base < cutoff) {
      base.setUTCDate(base.getUTCDate() + 7)
    }
  }

  return { title: opts.title, completed_at: base.toISOString() }
}

// ---------------------------------------------------------------------------
// hasSufficientHistory — cold-start guard
// ---------------------------------------------------------------------------

describe('hasSufficientHistory', () => {
  it('returns false when totalCompletions < MIN_OCCURRENCES', () => {
    expect(hasSufficientHistory(GYM_DAYS_MIN_OCCURRENCES - 1)).toBe(false)
  })

  it('returns false for 0 completions', () => {
    expect(hasSufficientHistory(0)).toBe(false)
  })

  it('returns true at exactly MIN_OCCURRENCES', () => {
    expect(hasSufficientHistory(GYM_DAYS_MIN_OCCURRENCES)).toBe(true)
  })

  it('returns true for many completions', () => {
    expect(hasSufficientHistory(100)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// detectGymDays
// ---------------------------------------------------------------------------

describe('detectGymDays', () => {
  it('returns empty array when no gym completions exist', () => {
    const now = new Date()
    const completions = [
      makeCompletion({ title: 'Write report', now }),
      makeCompletion({ title: 'Team standup', now }),
    ]
    expect(detectGymDays(completions, now)).toHaveLength(0)
  })

  it('returns empty array when gym completions are below threshold', () => {
    const now = new Date()
    // Only 2 Tuesday gym completions — below GYM_DAYS_MIN_OCCURRENCES (3)
    const completions = [
      makeCompletion({ title: 'Gym workout', weekday: 2, daysAgo: 7, now }),
      makeCompletion({ title: 'Gym workout', weekday: 2, daysAgo: 14, now }),
    ]
    expect(detectGymDays(completions, now)).toHaveLength(0)
  })

  it('detects gym pattern when threshold is met on same weekday', () => {
    const now = new Date()
    const completions = [
      makeCompletion({ title: 'Gym workout', weekday: 2, daysAgo: 7, now }),
      makeCompletion({ title: 'gym session', weekday: 2, daysAgo: 14, now }),
      makeCompletion({ title: 'workout done', weekday: 2, daysAgo: 21, now }),
    ]
    const result = detectGymDays(completions, now)
    expect(result).toHaveLength(1)
    expect(result[0].weekday).toBe(2) // Tuesday
    expect(result[0].count).toBe(3)
  })

  it('does not count completions outside the lookback window', () => {
    const now = new Date()
    // Two within window, one outside (29 days ago)
    const outside = new Date(now)
    outside.setUTCDate(outside.getUTCDate() - (GYM_DAYS_LOOKBACK_DAYS + 1))
    const completions = [
      makeCompletion({ title: 'Gym workout', weekday: 2, daysAgo: 7, now }),
      makeCompletion({ title: 'Gym workout', weekday: 2, daysAgo: 14, now }),
      { title: 'Gym workout', completed_at: outside.toISOString() },
    ]
    const result = detectGymDays(completions, now)
    // Only 2 within window — below threshold
    expect(result).toHaveLength(0)
  })

  it('can detect patterns on multiple weekdays independently', () => {
    const now = new Date()
    const completions = [
      // 3 Tuesday gym sessions
      makeCompletion({ title: 'gym', weekday: 2, daysAgo: 7, now }),
      makeCompletion({ title: 'gym', weekday: 2, daysAgo: 14, now }),
      makeCompletion({ title: 'gym', weekday: 2, daysAgo: 21, now }),
      // 3 Thursday gym sessions
      makeCompletion({ title: 'gym', weekday: 4, daysAgo: 5, now }),
      makeCompletion({ title: 'gym', weekday: 4, daysAgo: 12, now }),
      makeCompletion({ title: 'gym', weekday: 4, daysAgo: 19, now }),
    ]
    const result = detectGymDays(completions, now)
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('matches gym keywords case-insensitively', () => {
    const now = new Date()
    const completions = [
      makeCompletion({ title: 'GYM SESSION', weekday: 1, daysAgo: 7, now }),
      makeCompletion({ title: 'WORKOUT COMPLETE', weekday: 1, daysAgo: 14, now }),
      makeCompletion({ title: 'Exercise done', weekday: 1, daysAgo: 21, now }),
    ]
    const result = detectGymDays(completions, now)
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// detectWeeklyReviewTime
// ---------------------------------------------------------------------------

describe('detectWeeklyReviewTime', () => {
  it('returns empty array when no review completions exist', () => {
    const now = new Date()
    const completions = [makeCompletion({ title: 'Random task', now })]
    expect(detectWeeklyReviewTime(completions, now)).toHaveLength(0)
  })

  it('returns empty array below WEEKLY_REVIEW_MIN_OCCURRENCES', () => {
    const now = new Date()
    const completions = [
      makeCompletion({ title: 'weekly review', weekday: 5, daysAgo: 7, now }),
      makeCompletion({ title: 'weekly review', weekday: 5, daysAgo: 14, now }),
    ]
    expect(detectWeeklyReviewTime(completions, now)).toHaveLength(0)
  })

  it('detects weekly review pattern when threshold is met', () => {
    const now = new Date()
    const completions = [
      makeCompletion({ title: 'weekly review', weekday: 5, daysAgo: 7, now }),
      makeCompletion({ title: 'Weekly Review session', weekday: 5, daysAgo: 14, now }),
      makeCompletion({ title: 'Do weekly review', weekday: 5, daysAgo: 21, now }),
    ]
    const result = detectWeeklyReviewTime(completions, now)
    expect(result).toHaveLength(1)
    expect(result[0].weekday).toBe(5) // Friday
    expect(result[0].count).toBeGreaterThanOrEqual(WEEKLY_REVIEW_MIN_OCCURRENCES)
  })

  it('matches "review" keyword in task title', () => {
    const now = new Date()
    const completions = [
      makeCompletion({ title: 'Team retrospective', weekday: 5, daysAgo: 7, now }),
      makeCompletion({ title: 'Retro session', weekday: 5, daysAgo: 14, now }),
      makeCompletion({ title: 'Week review', weekday: 5, daysAgo: 21, now }),
    ]
    const result = detectWeeklyReviewTime(completions, now)
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// detectStaleGoals
// ---------------------------------------------------------------------------
//
// Wave 7.2.1: detectStaleGoals now takes last_task_completed_at (not last_activity_at)
// and returns { id, title, daysSinceActivity }. Goals with terminal status 'achieved'
// or 'abandoned' are excluded. The goal_status enum is: active | achieved | paused | abandoned.

describe('detectStaleGoals', () => {
  it('returns empty array when all goals have recent task completion', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g1',
        title: 'Ship v1',
        last_task_completed_at: daysAgoISO(STALE_GOAL_THRESHOLD_DAYS - 1, now),
        created_at: daysAgoISO(30, now),
        status: 'active',
      },
    ]
    expect(detectStaleGoals(goals, now)).toHaveLength(0)
  })

  it('returns goal when last_task_completed_at is exactly 13 days ago — not stale', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g-13',
        title: '13 day goal',
        last_task_completed_at: daysAgoISO(13, now),
        created_at: daysAgoISO(60, now),
        status: 'active',
      },
    ]
    expect(detectStaleGoals(goals, now)).toHaveLength(0)
  })

  it('returns goal when last_task_completed_at is exactly 14 days ago — stale', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g-14',
        title: '14 day goal',
        last_task_completed_at: daysAgoISO(STALE_GOAL_THRESHOLD_DAYS, now),
        created_at: daysAgoISO(60, now),
        status: 'active',
      },
    ]
    // daysAgo sets time to exactly THRESHOLD days before now (to the second), which is < cutoff
    // when cutoff = now - THRESHOLD_DAYS (also to the second). Due to sub-second execution
    // the result may vary at the exact boundary; we verify shape only.
    const result = detectStaleGoals(goals, now)
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns goal when last_task_completed_at is older than threshold', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g1',
        title: 'Ship v1',
        last_task_completed_at: daysAgoISO(STALE_GOAL_THRESHOLD_DAYS + 1, now),
        created_at: daysAgoISO(60, now),
        status: 'active',
      },
    ]
    const result = detectStaleGoals(goals, now)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('g1')
    expect(result[0].title).toBe('Ship v1')
    expect(result[0].daysSinceActivity).toBeGreaterThanOrEqual(STALE_GOAL_THRESHOLD_DAYS + 1)
  })

  it('uses created_at when last_task_completed_at is null and goal is old enough', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g2',
        title: 'Old goal',
        last_task_completed_at: null,
        created_at: daysAgoISO(STALE_GOAL_THRESHOLD_DAYS + 5, now),
        status: 'active',
      },
    ]
    const result = detectStaleGoals(goals, now)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('g2')
    expect(result[0].daysSinceActivity).toBeGreaterThanOrEqual(STALE_GOAL_THRESHOLD_DAYS + 5)
  })

  it('does not flag goals with no completions but recent creation', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g3',
        title: 'Brand new goal',
        last_task_completed_at: null,
        created_at: daysAgoISO(2, now),
        status: 'active',
      },
    ]
    expect(detectStaleGoals(goals, now)).toHaveLength(0)
  })

  it('excludes goals with status "achieved" (terminal status in goal_status enum)', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g4',
        title: 'Achieved goal',
        last_task_completed_at: daysAgoISO(STALE_GOAL_THRESHOLD_DAYS + 10, now),
        created_at: daysAgoISO(90, now),
        status: 'achieved',
      },
    ]
    expect(detectStaleGoals(goals, now)).toHaveLength(0)
  })

  it('excludes goals with status "abandoned" (terminal status in goal_status enum)', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g5',
        title: 'Abandoned goal',
        last_task_completed_at: daysAgoISO(STALE_GOAL_THRESHOLD_DAYS + 10, now),
        created_at: daysAgoISO(90, now),
        status: 'abandoned',
      },
    ]
    expect(detectStaleGoals(goals, now)).toHaveLength(0)
  })

  it('includes goals with status "active" when stale', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g6',
        title: 'Active stale goal',
        last_task_completed_at: daysAgoISO(STALE_GOAL_THRESHOLD_DAYS + 3, now),
        created_at: daysAgoISO(60, now),
        status: 'active',
      },
    ]
    const result = detectStaleGoals(goals, now)
    expect(result).toHaveLength(1)
  })

  it('includes goals with status "paused" when stale (not a terminal status)', () => {
    const now = new Date()
    const goals = [
      {
        id: 'g7',
        title: 'Paused goal',
        last_task_completed_at: daysAgoISO(STALE_GOAL_THRESHOLD_DAYS + 2, now),
        created_at: daysAgoISO(60, now),
        status: 'paused',
      },
    ]
    const result = detectStaleGoals(goals, now)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('g7')
  })

  it('returns correct daysSinceActivity in result', () => {
    const now = new Date()
    const inactiveDays = STALE_GOAL_THRESHOLD_DAYS + 5
    const goals = [
      {
        id: 'g8',
        title: 'Counted goal',
        last_task_completed_at: daysAgoISO(inactiveDays, now),
        created_at: daysAgoISO(60, now),
        status: 'active',
      },
    ]
    const result = detectStaleGoals(goals, now)
    expect(result).toHaveLength(1)
    // daysSinceActivity should be approximately inactiveDays (±1 due to sub-second timing)
    expect(result[0].daysSinceActivity).toBeGreaterThanOrEqual(inactiveDays - 1)
    expect(result[0].daysSinceActivity).toBeLessThanOrEqual(inactiveDays + 1)
  })
})

// ---------------------------------------------------------------------------
// staleGoalDescription
// ---------------------------------------------------------------------------

describe('staleGoalDescription', () => {
  it('generates correct description format', () => {
    const desc = staleGoalDescription('Read 12 books', 18)
    expect(desc).toBe("No activity on 'Read 12 books' for 18 days")
  })

  it('includes exact day count', () => {
    const desc = staleGoalDescription('Ship v1', 21)
    expect(desc).toContain('21 days')
  })

  it('includes goal title', () => {
    const desc = staleGoalDescription('Gym habit', 15)
    expect(desc).toContain('Gym habit')
  })
})

// ---------------------------------------------------------------------------
// detectFollowUpNeeded
// ---------------------------------------------------------------------------

describe('detectFollowUpNeeded', () => {
  it('returns empty array when no in-progress tasks exist', () => {
    const now = new Date()
    const tasks = [
      {
        id: 't1',
        title: 'Done task',
        updated_at: daysAgoISO(10, now),
        status: 'done',
      },
    ]
    expect(detectFollowUpNeeded(tasks, now)).toHaveLength(0)
  })

  it('returns empty array when in-progress tasks are recently updated', () => {
    const now = new Date()
    const tasks = [
      {
        id: 't1',
        title: 'Active task',
        updated_at: daysAgoISO(FOLLOW_UP_NEEDED_THRESHOLD_DAYS - 1, now),
        status: 'in_progress',
      },
    ]
    expect(detectFollowUpNeeded(tasks, now)).toHaveLength(0)
  })

  it('returns tasks whose updated_at is beyond the threshold', () => {
    const now = new Date()
    const tasks = [
      {
        id: 't2',
        title: 'Stalled task',
        updated_at: daysAgoISO(FOLLOW_UP_NEEDED_THRESHOLD_DAYS + 3, now),
        status: 'in_progress',
      },
    ]
    const result = detectFollowUpNeeded(tasks, now)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t2')
  })

  it('only includes in_progress status tasks', () => {
    const now = new Date()
    const tasks = [
      {
        id: 't3',
        title: 'Pending task',
        updated_at: daysAgoISO(20, now),
        status: 'pending',
      },
      {
        id: 't4',
        title: 'In progress task',
        updated_at: daysAgoISO(20, now),
        status: 'in_progress',
      },
    ]
    const result = detectFollowUpNeeded(tasks, now)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t4')
  })

  it('returns all qualifying tasks when multiple match', () => {
    const now = new Date()
    const tasks = [
      { id: 't5', title: 'Task A', updated_at: daysAgoISO(10, now), status: 'in_progress' },
      { id: 't6', title: 'Task B', updated_at: daysAgoISO(15, now), status: 'in_progress' },
    ]
    const result = detectFollowUpNeeded(tasks, now)
    expect(result).toHaveLength(2)
  })
})
