/**
 * lib/jobs/detect-patterns.ts
 * Wave 7.1.1 — Pattern Detection
 *
 * Analyzes per-user task-completion history for behavioral patterns and writes
 * results to the `detected_patterns` table. Designed to be called by the nightly
 * cron endpoint. All DB writes are idempotent upserts on (user_id, pattern_type).
 */

import { createServiceClient } from '@/lib/supabase/server'
import type { PatternDetectionResult } from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Named constants — no magic numbers anywhere in this file
// ---------------------------------------------------------------------------

/** Minimum completions of a task on the same weekday within the lookback window
 *  before we consider it a gym-day pattern. */
export const GYM_DAYS_MIN_OCCURRENCES = 3

/** Lookback window (in days) for gym-day pattern detection. */
export const GYM_DAYS_LOOKBACK_DAYS = 28

/** Minimum number of "review" task completions on the same weekday to infer a
 *  weekly-review habit. */
export const WEEKLY_REVIEW_MIN_OCCURRENCES = 3

/** Lookback window (in days) for weekly-review detection. */
export const WEEKLY_REVIEW_LOOKBACK_DAYS = 28

/** Keywords that identify a task as a candidate for the weekly-review pattern. */
export const WEEKLY_REVIEW_KEYWORDS = ['review', 'weekly review', 'week review', 'retrospective', 'retro']

/** Number of days since last activity on a goal before it is considered stale. */
export const STALE_GOAL_THRESHOLD_DAYS = 14

/** Number of days since the last task update before we flag follow-up needed. */
export const FOLLOW_UP_NEEDED_THRESHOLD_DAYS = 7

/** Number of days since `last_detected_at` before a pattern is deactivated. */
export const PATTERN_DEACTIVATE_AFTER_DAYS = 14

/** Weekday names for human-readable descriptions. */
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns a Date that is `days` days before `now`. */
function daysAgo(days: number, now: Date = new Date()): Date {
  const d = new Date(now)
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

/** Returns the UTC weekday index (0=Sunday…6=Saturday) for an ISO-8601 string. */
function weekdayOf(isoString: string): number {
  return new Date(isoString).getUTCDay()
}

// ---------------------------------------------------------------------------
// Pattern-detection functions — pure logic, exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Gym-days detection.
 *
 * Looks for any task keyword associated with physical activity that has been
 * completed 3+ times on the same weekday in the past 28 days.
 *
 * Returns an array of { weekday, count } tuples for qualifying days.
 */
export function detectGymDays(
  completions: Array<{ completed_at: string; title: string }>,
  now: Date = new Date(),
): Array<{ weekday: number; count: number }> {
  const gymKeywords = ['gym', 'workout', 'exercise', 'fitness', 'lift', 'run', 'jog', 'yoga', 'swim', 'training']
  const cutoff = daysAgo(GYM_DAYS_LOOKBACK_DAYS, now)

  const gymCompletions = completions.filter(c => {
    const completedAt = new Date(c.completed_at)
    if (completedAt < cutoff) return false
    const title = c.title.toLowerCase()
    return gymKeywords.some(kw => title.includes(kw))
  })

  // Group by weekday
  const weekdayCounts = new Map<number, number>()
  for (const c of gymCompletions) {
    const day = weekdayOf(c.completed_at)
    weekdayCounts.set(day, (weekdayCounts.get(day) ?? 0) + 1)
  }

  return Array.from(weekdayCounts.entries())
    .filter(([, count]) => count >= GYM_DAYS_MIN_OCCURRENCES)
    .map(([weekday, count]) => ({ weekday, count }))
}

/**
 * Weekly-review detection.
 *
 * Looks for review-titled task completions that recur on the same weekday
 * 3+ times within the past 28 days.
 */
export function detectWeeklyReviewTime(
  completions: Array<{ completed_at: string; title: string }>,
  now: Date = new Date(),
): Array<{ weekday: number; count: number }> {
  const cutoff = daysAgo(WEEKLY_REVIEW_LOOKBACK_DAYS, now)

  const reviewCompletions = completions.filter(c => {
    const completedAt = new Date(c.completed_at)
    if (completedAt < cutoff) return false
    const title = c.title.toLowerCase()
    return WEEKLY_REVIEW_KEYWORDS.some(kw => title.includes(kw))
  })

  const weekdayCounts = new Map<number, number>()
  for (const c of reviewCompletions) {
    const day = weekdayOf(c.completed_at)
    weekdayCounts.set(day, (weekdayCounts.get(day) ?? 0) + 1)
  }

  return Array.from(weekdayCounts.entries())
    .filter(([, count]) => count >= WEEKLY_REVIEW_MIN_OCCURRENCES)
    .map(([weekday, count]) => ({ weekday, count }))
}

/**
 * Stale-goal detection.
 *
 * Returns goal ids where the last activity is older than STALE_GOAL_THRESHOLD_DAYS.
 * A goal with no last_activity_at that was created before the threshold is also stale.
 */
export function detectStaleGoals(
  goals: Array<{ id: string; title: string; last_activity_at: string | null; created_at: string; status: string }>,
  now: Date = new Date(),
): Array<{ id: string; title: string }> {
  const cutoff = daysAgo(STALE_GOAL_THRESHOLD_DAYS, now)

  return goals
    .filter(g => g.status === 'active')
    .filter(g => {
      const activityDate = g.last_activity_at
        ? new Date(g.last_activity_at)
        : new Date(g.created_at)
      return activityDate < cutoff
    })
    .map(g => ({ id: g.id, title: g.title }))
}

/**
 * Follow-up-needed detection.
 *
 * Returns task ids where the task is in-progress but updated_at is older than
 * FOLLOW_UP_NEEDED_THRESHOLD_DAYS. These tasks may be blocked or forgotten.
 */
export function detectFollowUpNeeded(
  tasks: Array<{ id: string; title: string; updated_at: string; status: string }>,
  now: Date = new Date(),
): Array<{ id: string; title: string }> {
  const cutoff = daysAgo(FOLLOW_UP_NEEDED_THRESHOLD_DAYS, now)

  return tasks
    .filter(t => t.status === 'in_progress')
    .filter(t => new Date(t.updated_at) < cutoff)
    .map(t => ({ id: t.id, title: t.title }))
}

// ---------------------------------------------------------------------------
// Helpers for description generation
// ---------------------------------------------------------------------------

function gymDaysDescription(days: Array<{ weekday: number; count: number }>): string {
  const names = days.map(d => WEEKDAY_NAMES[d.weekday]).join(' and ')
  return `You tend to work out on ${names} (detected ${days[0].count}+ times recently)`
}

function weeklyReviewDescription(days: Array<{ weekday: number; count: number }>): string {
  const names = days.map(d => WEEKDAY_NAMES[d.weekday]).join(' and ')
  return `You consistently do your weekly review on ${names}`
}

function staleGoalDescription(goals: Array<{ title: string }>): string {
  const titles = goals.map(g => `"${g.title}"`).join(', ')
  return `Goal(s) with no recent activity: ${titles}`
}

function followUpDescription(tasks: Array<{ title: string }>): string {
  const titles = tasks.map(t => `"${t.title}"`).join(', ')
  return `In-progress tasks needing follow-up: ${titles}`
}

// ---------------------------------------------------------------------------
// Cold-start guard
// ---------------------------------------------------------------------------

/**
 * Returns true if there is sufficient history to produce meaningful patterns.
 * A user with fewer than GYM_DAYS_MIN_OCCURRENCES total completions provides
 * insufficient signal and should not receive fabricated patterns.
 */
export function hasSufficientHistory(totalCompletions: number): boolean {
  return totalCompletions >= GYM_DAYS_MIN_OCCURRENCES
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Run all four pattern-detection checks for a single user.
 * Writes detected patterns to the database via idempotent upsert.
 * Deactivates patterns not re-confirmed in PATTERN_DEACTIVATE_AFTER_DAYS.
 */
export async function runPatternDetection(userId: string): Promise<PatternDetectionResult> {
  const db = createServiceClient()
  const now = new Date()

  // -------------------------------------------------------------------------
  // 1. Fetch raw data
  // -------------------------------------------------------------------------

  // Fetch completed tasks (for gym_days and weekly_review_time)
  const { data: completedTasks, error: tasksError } = await db
    .from('tasks')
    .select('id, title, completed_at, updated_at, status')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', daysAgo(GYM_DAYS_LOOKBACK_DAYS, now).toISOString())

  if (tasksError) {
    throw new Error(`Failed to fetch completed tasks for user ${userId}: ${tasksError.message}`)
  }

  // Fetch all in-progress tasks (for follow_up_needed)
  const { data: inProgressTasks, error: inProgressError } = await db
    .from('tasks')
    .select('id, title, updated_at, status')
    .eq('user_id', userId)
    .eq('status', 'in_progress')

  if (inProgressError) {
    throw new Error(`Failed to fetch in-progress tasks for user ${userId}: ${inProgressError.message}`)
  }

  // Fetch active goals (for stale_goal)
  const { data: activeGoals, error: goalsError } = await db
    .from('goals')
    .select('id, title, last_activity_at, created_at, status')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (goalsError) {
    throw new Error(`Failed to fetch active goals for user ${userId}: ${goalsError.message}`)
  }

  const completions = (completedTasks ?? []) as Array<{ id: string; title: string; completed_at: string; updated_at: string; status: string }>
  const allInProgress = (inProgressTasks ?? []) as Array<{ id: string; title: string; updated_at: string; status: string }>
  const goals = (activeGoals ?? []) as Array<{ id: string; title: string; last_activity_at: string | null; created_at: string; status: string }>

  // -------------------------------------------------------------------------
  // 2. Cold-start guard
  // -------------------------------------------------------------------------
  if (!hasSufficientHistory(completions.length)) {
    console.log(
      JSON.stringify({
        event: 'pattern_detection.cold_start',
        userId,
        totalCompletions: completions.length,
        threshold: GYM_DAYS_MIN_OCCURRENCES,
      }),
    )
    return { userId, patternsWritten: 0, patternsDeactivated: 0 }
  }

  // -------------------------------------------------------------------------
  // 3. Run detection logic
  // -------------------------------------------------------------------------
  type PatternCandidate = { pattern_type: string; description: string }
  const candidates: PatternCandidate[] = []

  // gym_days
  const gymDays = detectGymDays(completions, now)
  if (gymDays.length > 0) {
    candidates.push({
      pattern_type: 'gym_days',
      description: gymDaysDescription(gymDays),
    })
  }

  // weekly_review_time
  const reviewDays = detectWeeklyReviewTime(completions, now)
  if (reviewDays.length > 0) {
    candidates.push({
      pattern_type: 'weekly_review_time',
      description: weeklyReviewDescription(reviewDays),
    })
  }

  // stale_goal — only include if there are stale goals
  const staleGoals = detectStaleGoals(goals, now)
  if (staleGoals.length > 0) {
    candidates.push({
      pattern_type: 'stale_goal',
      description: staleGoalDescription(staleGoals),
    })
  }

  // follow_up_needed
  const followUpTasks = detectFollowUpNeeded(allInProgress, now)
  if (followUpTasks.length > 0) {
    candidates.push({
      pattern_type: 'follow_up_needed',
      description: followUpDescription(followUpTasks),
    })
  }

  // -------------------------------------------------------------------------
  // 4. Fetch existing patterns for this user (for deactivation logic)
  // -------------------------------------------------------------------------
  const { data: existingPatterns, error: existingError } = await db
    .from('detected_patterns')
    .select('id, pattern_type, last_detected_at, is_active')
    .eq('user_id', userId)

  if (existingError) {
    throw new Error(`Failed to fetch existing patterns for user ${userId}: ${existingError.message}`)
  }

  // -------------------------------------------------------------------------
  // 5. Upsert detected patterns (idempotent on user_id, pattern_type)
  // -------------------------------------------------------------------------
  let patternsWritten = 0

  for (const candidate of candidates) {
    const { error: upsertError } = await db
      .from('detected_patterns')
      .upsert(
        {
          user_id: userId,
          pattern_type: candidate.pattern_type,
          description: candidate.description,
          last_detected_at: now.toISOString(),
          is_active: true,
          updated_at: now.toISOString(),
        },
        { onConflict: 'user_id,pattern_type' },
      )

    if (upsertError) {
      console.error(
        JSON.stringify({
          event: 'pattern_detection.upsert_error',
          userId,
          patternType: candidate.pattern_type,
          error: upsertError.message,
        }),
      )
      // Continue to next pattern — per-user-pattern errors don't abort the job
    } else {
      patternsWritten++
    }
  }

  // -------------------------------------------------------------------------
  // 6. Deactivate stale patterns (not re-confirmed in PATTERN_DEACTIVATE_AFTER_DAYS)
  // -------------------------------------------------------------------------
  const detectedPatternTypes = new Set(candidates.map(c => c.pattern_type))
  const deactivateCutoff = daysAgo(PATTERN_DEACTIVATE_AFTER_DAYS, now)

  const toDeactivate = (existingPatterns ?? []).filter(
    p =>
      p.is_active &&
      !detectedPatternTypes.has(p.pattern_type) &&
      new Date(p.last_detected_at) < deactivateCutoff,
  )

  let patternsDeactivated = 0

  for (const pattern of toDeactivate) {
    const { error: deactivateError } = await db
      .from('detected_patterns')
      .update({ is_active: false, updated_at: now.toISOString() })
      .eq('id', pattern.id)
      .eq('user_id', userId) // defensive: RLS backup

    if (deactivateError) {
      console.error(
        JSON.stringify({
          event: 'pattern_detection.deactivate_error',
          userId,
          patternId: pattern.id,
          error: deactivateError.message,
        }),
      )
    } else {
      patternsDeactivated++
    }
  }

  console.log(
    JSON.stringify({
      event: 'pattern_detection.complete',
      userId,
      patternsWritten,
      patternsDeactivated,
      detectedTypes: Array.from(detectedPatternTypes),
    }),
  )

  return { userId, patternsWritten, patternsDeactivated }
}
