/**
 * Weekly review assembly library (Wave 7.3.1, Task 7.3.1.1.1)
 *
 * Deterministically builds a WeeklyReviewContent object for a single user from
 * Postgres queries. No LLM is required for the core content. An optional Haiku
 * phrasing pass (try/catch wrapped) adds a `narrative` field if available.
 *
 * Uses the service-role client — intended for cron / server context only.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { anthropic, CHAT_MODEL_FAST } from '@/lib/anthropic'
import type {
  WeeklyReviewContent,
  WeeklyReviewWin,
  WeeklyReviewBlocker,
  WeeklyReviewNextWeekTask,
} from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the ISO week-start Monday as a YYYY-MM-DD string (UTC).
 * ISO weeks start on Monday (day 1). Sunday is day 0, so we shift by +1 mod 7.
 */
export function getIsoWeekStart(date: Date): string {
  const d = new Date(date)
  // getUTCDay(): 0 = Sunday, 1 = Monday, …, 6 = Saturday
  // ISO week: Monday = 0 offset
  const dayOfWeek = d.getUTCDay() // 0–6
  const daysToMonday = (dayOfWeek + 6) % 7 // 0 if Monday, 6 if Sunday
  d.setUTCDate(d.getUTCDate() - daysToMonday)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Named constants — no magic numbers
// ---------------------------------------------------------------------------

/** Number of past days to include in the Wins section. */
const WINS_WINDOW_DAYS = 7

/** Maximum tasks returned in the Next-Week Focus section. */
const NEXT_WEEK_MAX_TASKS = 5

/** Number of days forward to look for Next-Week Focus tasks. */
const NEXT_WEEK_WINDOW_DAYS = 7

/** Priority order for sorting tasks (higher index = higher priority rendered first). */
const PRIORITY_ORDER: Record<string, number> = {
  urgent: 2,
  high: 1,
  medium: 0,
  low: -1,
}

// ---------------------------------------------------------------------------
// assembleWeeklyReview
// ---------------------------------------------------------------------------

/**
 * Assemble a weekly review for one user.
 *
 * @param userId - The user's auth.users id.
 * @param now    - Reference clock (defaults to current time). Injected for testing.
 */
export async function assembleWeeklyReview(
  userId: string,
  now: Date = new Date(),
): Promise<WeeklyReviewContent> {
  const db = createServiceClient()

  // -------------------------------------------------------------------------
  // 1. Wins: tasks completed in the past WINS_WINDOW_DAYS days
  // -------------------------------------------------------------------------
  const winsWindowStart = new Date(now.getTime() - WINS_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const { data: doneTasks, error: winsError } = await db
    .from('tasks')
    .select('id, title, goal_id, completed_at')
    .eq('user_id', userId)
    .eq('status', 'done')
    .not('completed_at', 'is', null)
    .gte('completed_at', winsWindowStart.toISOString())
    .lte('completed_at', now.toISOString())
    .order('completed_at', { ascending: false })

  if (winsError) {
    console.error(
      JSON.stringify({ event: 'weekly-review.wins.error', userId, error: winsError.message }),
    )
  }

  // Fetch goal titles for linked tasks (batch, deduplicating goal IDs)
  const goalIds = [
    ...new Set(
      (doneTasks ?? [])
        .map((t) => t.goal_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const goalTitleMap = new Map<string, string>()
  if (goalIds.length > 0) {
    const { data: goalsData, error: goalsError } = await db
      .from('goals')
      .select('id, title')
      .in('id', goalIds)

    if (goalsError) {
      console.error(
        JSON.stringify({
          event: 'weekly-review.wins.goals.error',
          userId,
          error: goalsError.message,
        }),
      )
    }

    for (const g of goalsData ?? []) {
      goalTitleMap.set(g.id, g.title)
    }
  }

  const wins: WeeklyReviewWin[] = (doneTasks ?? []).map((t) => ({
    taskId: t.id,
    title: t.title,
    ...(t.goal_id && goalTitleMap.has(t.goal_id)
      ? { goalTitle: goalTitleMap.get(t.goal_id) }
      : {}),
  }))

  // -------------------------------------------------------------------------
  // 2. Blockers: overdue tasks + goals with declining momentum
  // -------------------------------------------------------------------------
  const { data: overdueTasks, error: overdueError } = await db
    .from('tasks')
    .select('id, title, due_at')
    .eq('user_id', userId)
    .in('status', ['pending', 'in_progress'])
    .not('due_at', 'is', null)
    .lt('due_at', now.toISOString())
    .order('due_at', { ascending: true })

  if (overdueError) {
    console.error(
      JSON.stringify({
        event: 'weekly-review.blockers.overdue.error',
        userId,
        error: overdueError.message,
      }),
    )
  }

  const overdueBlockers: WeeklyReviewBlocker[] = (overdueTasks ?? []).map((t) => {
    const dueDate = new Date(t.due_at!)
    const daysOverdue = Math.floor(
      (now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000),
    )
    return {
      type: 'overdue_task',
      title: t.title,
      detail:
        daysOverdue === 0
          ? 'due today'
          : daysOverdue === 1
            ? '1 day overdue'
            : `${daysOverdue} days overdue`,
    }
  })

  const { data: decliningGoals, error: decliningError } = await db
    .from('goals')
    .select('id, title')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('momentum', 'declining')
    .order('title', { ascending: true })

  if (decliningError) {
    console.error(
      JSON.stringify({
        event: 'weekly-review.blockers.declining.error',
        userId,
        error: decliningError.message,
      }),
    )
  }

  const goalBlockers: WeeklyReviewBlocker[] = (decliningGoals ?? []).map((g) => ({
    type: 'declining_goal',
    title: g.title,
    detail: 'momentum: declining',
  }))

  const blockers: WeeklyReviewBlocker[] = [...overdueBlockers, ...goalBlockers]

  // -------------------------------------------------------------------------
  // 3. Next-week focus: top NEXT_WEEK_MAX_TASKS high/urgent tasks due soon
  // -------------------------------------------------------------------------
  const nextWeekEnd = new Date(now.getTime() + NEXT_WEEK_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const { data: upcomingTasks, error: nextWeekError } = await db
    .from('tasks')
    .select('id, title, due_at, priority, goal_id')
    .eq('user_id', userId)
    .in('priority', ['high', 'urgent'])
    .in('status', ['pending', 'in_progress'])
    .not('due_at', 'is', null)
    .gt('due_at', now.toISOString())
    .lte('due_at', nextWeekEnd.toISOString())
    .order('due_at', { ascending: true })

  if (nextWeekError) {
    console.error(
      JSON.stringify({
        event: 'weekly-review.nextWeek.error',
        userId,
        error: nextWeekError.message,
      }),
    )
  }

  // Sort: tasks linked to active goals first within same priority tier, then by
  // priority desc, then by due_at asc. We already fetched in due_at order;
  // re-sort by priority desc to fulfil spec ordering.
  const sortedUpcoming = (upcomingTasks ?? []).sort((a, b) => {
    const pA = PRIORITY_ORDER[a.priority] ?? 0
    const pB = PRIORITY_ORDER[b.priority] ?? 0
    if (pB !== pA) return pB - pA // higher priority first
    // Prefer tasks with a goal_id (linked to active goals)
    const gA = a.goal_id ? 1 : 0
    const gB = b.goal_id ? 1 : 0
    if (gB !== gA) return gB - gA
    // Finally, earlier due_at first
    return new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime()
  })

  const nextWeek: WeeklyReviewNextWeekTask[] = sortedUpcoming
    .slice(0, NEXT_WEEK_MAX_TASKS)
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      dueAt: t.due_at!,
      priority: t.priority,
    }))

  // -------------------------------------------------------------------------
  // 4. Optional Haiku narrative pass
  // -------------------------------------------------------------------------
  let narrative: string | undefined

  const hasContent = wins.length > 0 || blockers.length > 0 || nextWeek.length > 0

  if (hasContent && process.env.ANTHROPIC_API_KEY) {
    try {
      const winsText =
        wins.length > 0
          ? wins.map((w) => `- ${w.title}${w.goalTitle ? ` (${w.goalTitle})` : ''}`).join('\n')
          : 'None'

      const blockersText =
        blockers.length > 0
          ? blockers.map((b) => `- ${b.title}: ${b.detail}`).join('\n')
          : 'None'

      const nextWeekText =
        nextWeek.length > 0
          ? nextWeek
              .map((t) => `- ${t.title} (${t.priority}, due ${t.dueAt.slice(0, 10)})`)
              .join('\n')
          : 'None'

      const prompt = `You are writing a one-paragraph weekly review summary for a personal productivity assistant. Be warm, concise, and encouraging. Do not add any information not listed below — only phrase the facts.

Wins this week:
${winsText}

Blockers / overdue:
${blockersText}

Next-week focus:
${nextWeekText}

Write a single readable paragraph (2–4 sentences) summarising the week. Do not fabricate any details.`

      const response = await anthropic.messages.create({
        model: CHAT_MODEL_FAST,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      })

      const firstBlock = response.content[0]
      if (firstBlock?.type === 'text') {
        narrative = firstBlock.text.trim()
      }
    } catch (err) {
      // Haiku failure must not block storage — log and continue
      console.error(
        JSON.stringify({
          event: 'weekly-review.haiku.error',
          userId,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }

  return {
    wins,
    blockers,
    nextWeek,
    ...(narrative !== undefined ? { narrative } : {}),
  }
}

// ---------------------------------------------------------------------------
// storeWeeklyReview
// ---------------------------------------------------------------------------

/**
 * Persist a WeeklyReviewContent as a daily_briefings row with type='weekly'.
 * Idempotent: upserts on (user_id, type, date_trunc('week', briefing_date)::date).
 * On conflict the existing row's content is replaced (fresh assembly wins).
 *
 * @param userId  - The user's auth.users id.
 * @param content - The assembled WeeklyReviewContent.
 * @param now     - Reference clock (defaults to current time). Injected for testing.
 */
export async function storeWeeklyReview(
  userId: string,
  content: WeeklyReviewContent,
  now: Date = new Date(),
): Promise<void> {
  const db = createServiceClient()

  // briefing_date is stored as the ISO week-start Monday (UTC) for weekly reviews.
  // This ensures the column-level unique constraint on (user_id, type, briefing_date)
  // provides exactly-once storage per ISO week, without requiring a functional-
  // expression unique constraint that Supabase JS cannot target by column name.
  const briefingDate = getIsoWeekStart(now)

  const { error } = await db.from('daily_briefings').upsert(
    {
      user_id: userId,
      type: 'weekly',
      briefing_date: briefingDate,
      content: content as unknown as import('@/types/supabase').Json,
      was_delivered: false,
    },
    {
      onConflict: 'user_id,type,briefing_date',
      ignoreDuplicates: false,
    },
  )

  if (error) {
    console.error(
      JSON.stringify({
        event: 'weekly-review.store.upsert_error',
        userId,
        error: error.message,
        code: error.code,
      }),
    )

    // Re-throw so the cron can log the per-user error without aborting others.
    throw new Error(`storeWeeklyReview failed for user ${userId}: ${error.message}`)
  }

  console.log(
    JSON.stringify({
      event: 'weekly-review.stored',
      userId,
      briefingDate,
      wins: content.wins.length,
      blockers: content.blockers.length,
      nextWeek: content.nextWeek.length,
      hasNarrative: Boolean(content.narrative),
    }),
  )
}
