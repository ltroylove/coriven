/**
 * lib/jobs/detect-patterns.ts
 * Wave 7.1.1 / Wave 7.2.1 — Pattern Detection
 *
 * Analyzes per-user task-completion history for behavioral patterns and writes
 * results to the `detected_patterns` table. Designed to be called by the nightly
 * cron endpoint. All DB writes are idempotent upserts on (user_id, pattern_type)
 * for non-goal patterns, and on (user_id, pattern_type, goal_id) for stale-goal
 * patterns (one row per stale goal).
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

/** Number of days since last activity on a goal before it is considered stale.
 *  Single source of truth per Wave 7.2.1 §Quality Requirements. */
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
 * Stale-goal detection (pure, for unit testing).
 *
 * Examines goals with their most recent task completion timestamp.
 * Returns stale goals with their exact inactivity day count.
 *
 * A goal is stale when:
 *   - Its last linked task completion (last_task_completed_at) is older than
 *     STALE_GOAL_THRESHOLD_DAYS, OR
 *   - It has no linked completed tasks at all (last_task_completed_at is null)
 *     AND was created more than STALE_GOAL_THRESHOLD_DAYS ago.
 *
 * Goals with status 'completed' or 'cancelled' are excluded.
 */
export function detectStaleGoals(
  goals: Array<{
    id: string
    title: string
    last_task_completed_at: string | null
    created_at: string
    status: string
  }>,
  now: Date = new Date(),
): Array<{ id: string; title: string; daysSinceActivity: number }> {
  const cutoff = daysAgo(STALE_GOAL_THRESHOLD_DAYS, now)
  const TERMINAL_STATUSES = new Set(['completed', 'cancelled'])

  return goals
    .filter(g => !TERMINAL_STATUSES.has(g.status))
    .flatMap(g => {
      const activityDate = g.last_task_completed_at
        ? new Date(g.last_task_completed_at)
        : new Date(g.created_at)

      if (activityDate >= cutoff) return []

      const daysSinceActivity = Math.floor(
        (now.getTime() - activityDate.getTime()) / (24 * 60 * 60 * 1000),
      )
      return [{ id: g.id, title: g.title, daysSinceActivity }]
    })
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
// Description generators
// ---------------------------------------------------------------------------

function gymDaysDescription(days: Array<{ weekday: number; count: number }>): string {
  const names = days.map(d => WEEKDAY_NAMES[d.weekday]).join(' and ')
  return `You tend to work out on ${names} (detected ${days[0].count}+ times recently)`
}

function weeklyReviewDescription(days: Array<{ weekday: number; count: number }>): string {
  const names = days.map(d => WEEKDAY_NAMES[d.weekday]).join(' and ')
  return `You consistently do your weekly review on ${names}`
}

/** Per-goal stale description: "No activity on 'Read 12 books' for 18 days" */
export function staleGoalDescription(title: string, daysSinceActivity: number): string {
  return `No activity on '${title}' for ${daysSinceActivity} days`
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
// Stale-goal DB detection (Wave 7.2.1)
// ---------------------------------------------------------------------------

/**
 * Raw shape returned by the stale-goal SQL query.
 * The Supabase JS client returns aggregate results as nullable fields.
 */
type StaleGoalRow = {
  id: string
  title: string
  last_task_completed_at: string | null
  created_at: string
  status: string
}

/**
 * Fetch goals with their most recent linked task completion timestamp.
 *
 * Uses a LEFT JOIN via Supabase's nested select to get the MAX completed_at
 * per goal. Goals without any completed tasks have last_task_completed_at = null.
 * Goals in terminal status (completed, cancelled) are excluded at the query layer.
 *
 * NOTE: Supabase JS does not support GROUP BY / HAVING directly; we fetch the
 * per-goal task max via a nested select and filter in application code. This is
 * consistent with the existing pattern in the codebase (e.g., briefing.ts) and
 * keeps the logic testable as a pure function.
 */
async function fetchGoalsWithLastCompletion(
  userId: string,
  db: ReturnType<typeof createServiceClient>,
): Promise<StaleGoalRow[]> {
  // Fetch active (non-terminal) goals for this user
  const { data: goals, error: goalsError } = await db
    .from('goals')
    .select('id, title, created_at, status')
    .eq('user_id', userId)
    .not('status', 'in', '("completed","cancelled")')

  if (goalsError) {
    throw new Error(`Failed to fetch goals for stale-goal detection (user ${userId}): ${goalsError.message}`)
  }

  if (!goals || goals.length === 0) return []

  const goalIds = goals.map(g => g.id)

  // Fetch max(completed_at) per goal — one row per goal_id
  const { data: taskMaxRows, error: taskError } = await db
    .from('tasks')
    .select('goal_id, completed_at')
    .in('goal_id', goalIds)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })

  if (taskError) {
    throw new Error(`Failed to fetch task completions for stale-goal detection (user ${userId}): ${taskError.message}`)
  }

  // Build a map: goal_id → max(completed_at) string
  const maxCompletedAt = new Map<string, string>()
  for (const row of taskMaxRows ?? []) {
    const gid = row.goal_id as string | null
    const cat = row.completed_at as string | null
    if (!gid || !cat) continue
    const existing = maxCompletedAt.get(gid)
    if (!existing || cat > existing) {
      maxCompletedAt.set(gid, cat)
    }
  }

  return goals.map(g => ({
    id: g.id,
    title: g.title,
    created_at: g.created_at,
    status: g.status,
    last_task_completed_at: maxCompletedAt.get(g.id) ?? null,
  }))
}

/**
 * Detect stale goals and write per-goal rows to `detected_patterns`.
 *
 * Upsert semantics (idempotent):
 *   - Stale goal → upsert row with is_active=true, updated description
 *   - Goal that was stale but has resumed activity → set is_active=false
 *
 * The unique key for stale-goal rows is (user_id, 'stale_goal', goal_id) via
 * a partial unique index added in migration 20260708200000.
 *
 * Returns { written, deactivated } counts.
 *
 * NOTE: The cold-start guard (hasSufficientHistory) does NOT apply to stale-goal
 * detection — stale goals are relevant even when the user has few task completions,
 * because the absence of completions is precisely what makes a goal stale.
 */
export async function runStaleGoalDetection(
  userId: string,
  now: Date = new Date(),
): Promise<{ written: number; deactivated: number }> {
  const db = createServiceClient()

  // 1. Fetch goals with last completion timestamp
  const goalRows = await fetchGoalsWithLastCompletion(userId, db)

  // 2. Determine which goals are currently stale
  const staleGoals = detectStaleGoals(goalRows, now)
  const staleGoalIds = new Set(staleGoals.map(g => g.id))

  // 3. Fetch existing stale_goal pattern rows for this user
  const { data: existingStalePatterns, error: existingError } = await db
    .from('detected_patterns')
    .select('id, goal_id, is_active')
    .eq('user_id', userId)
    .eq('pattern_type', 'stale_goal')
    .not('goal_id', 'is', null)

  if (existingError) {
    throw new Error(`Failed to fetch existing stale-goal patterns (user ${userId}): ${existingError.message}`)
  }

  const existingByGoalId = new Map<string, { id: string; is_active: boolean }>()
  for (const row of existingStalePatterns ?? []) {
    if (row.goal_id) {
      existingByGoalId.set(row.goal_id as string, { id: row.id, is_active: row.is_active })
    }
  }

  let written = 0
  let deactivated = 0

  // 4. Upsert one row per currently-stale goal
  for (const goal of staleGoals) {
    const description = staleGoalDescription(goal.title, goal.daysSinceActivity)

    const { error: upsertError } = await db
      .from('detected_patterns')
      .upsert(
        {
          user_id: userId,
          pattern_type: 'stale_goal',
          goal_id: goal.id,
          description,
          last_detected_at: now.toISOString(),
          is_active: true,
          updated_at: now.toISOString(),
        },
        // Conflict target matches the partial unique index on (user_id, pattern_type, goal_id)
        { onConflict: 'user_id,pattern_type,goal_id' },
      )

    if (upsertError) {
      console.error(
        JSON.stringify({
          event: 'stale_goal_detection.upsert_error',
          userId,
          goalId: goal.id,
          error: upsertError.message,
        }),
      )
    } else {
      written++
    }
  }

  // 5. Deactivate stale-goal rows for goals that are no longer stale (activity resumed)
  for (const [goalId, existing] of existingByGoalId.entries()) {
    if (existing.is_active && !staleGoalIds.has(goalId)) {
      const { error: deactivateError } = await db
        .from('detected_patterns')
        .update({ is_active: false, updated_at: now.toISOString() })
        .eq('id', existing.id)
        .eq('user_id', userId) // defense-in-depth on top of RLS

      if (deactivateError) {
        console.error(
          JSON.stringify({
            event: 'stale_goal_detection.deactivate_error',
            userId,
            patternId: existing.id,
            goalId,
            error: deactivateError.message,
          }),
        )
      } else {
        deactivated++
      }
    }
  }

  console.log(
    JSON.stringify({
      event: 'stale_goal_detection.complete',
      userId,
      staleGoalCount: staleGoals.length,
      written,
      deactivated,
    }),
  )

  return { written, deactivated }
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Run all pattern-detection checks for a single user.
 * Writes detected patterns to the database via idempotent upsert.
 * Deactivates non-goal patterns not re-confirmed in PATTERN_DEACTIVATE_AFTER_DAYS.
 *
 * Stale-goal detection runs independently of the cold-start guard because
 * the absence of task completions is itself a stale-goal signal.
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

  const completions = (completedTasks ?? []) as Array<{ id: string; title: string; completed_at: string; updated_at: string; status: string }>
  const allInProgress = (inProgressTasks ?? []) as Array<{ id: string; title: string; updated_at: string; status: string }>

  // -------------------------------------------------------------------------
  // 2. Run stale-goal detection (independent of cold-start guard)
  // -------------------------------------------------------------------------
  const { written: staleWritten, deactivated: staleDeactivated } = await runStaleGoalDetection(userId, now)

  // -------------------------------------------------------------------------
  // 3. Cold-start guard for habit/behavior patterns
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
    return { userId, patternsWritten: staleWritten, patternsDeactivated: staleDeactivated }
  }

  // -------------------------------------------------------------------------
  // 4. Run habit/behavior pattern detection
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

  // follow_up_needed
  const followUpTasks = detectFollowUpNeeded(allInProgress, now)
  if (followUpTasks.length > 0) {
    candidates.push({
      pattern_type: 'follow_up_needed',
      description: followUpDescription(followUpTasks),
    })
  }

  // -------------------------------------------------------------------------
  // 5. Fetch existing non-goal patterns for deactivation logic
  // -------------------------------------------------------------------------
  const { data: existingPatterns, error: existingError } = await db
    .from('detected_patterns')
    .select('id, pattern_type, last_detected_at, is_active')
    .eq('user_id', userId)
    .is('goal_id', null) // only non-goal patterns are managed here

  if (existingError) {
    throw new Error(`Failed to fetch existing patterns for user ${userId}: ${existingError.message}`)
  }

  // -------------------------------------------------------------------------
  // 6. Upsert detected non-goal patterns (idempotent on user_id, pattern_type where goal_id IS NULL)
  // -------------------------------------------------------------------------
  let patternsWritten = staleWritten

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
          // goal_id intentionally omitted — defaults to NULL for non-goal patterns
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
  // 7. Deactivate non-goal patterns not re-confirmed in PATTERN_DEACTIVATE_AFTER_DAYS
  //    (stale_goal rows are handled separately by runStaleGoalDetection)
  // -------------------------------------------------------------------------
  const detectedPatternTypes = new Set(candidates.map(c => c.pattern_type))
  const deactivateCutoff = daysAgo(PATTERN_DEACTIVATE_AFTER_DAYS, now)

  const toDeactivate = (existingPatterns ?? []).filter(
    p =>
      p.is_active &&
      !detectedPatternTypes.has(p.pattern_type) &&
      new Date(p.last_detected_at) < deactivateCutoff,
  )

  let patternsDeactivated = staleDeactivated

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
