/**
 * Types for Wave 7.3.1 — Weekly Review
 */

/** A completed task surfaced in the Wins section. */
export interface WeeklyReviewWin {
  /** UUID of the tasks row */
  taskId: string
  /** Task title */
  title: string
  /** Title of the linked goal, if any */
  goalTitle?: string
}

/** A blocker: either an overdue task or a goal with declining momentum. */
export interface WeeklyReviewBlocker {
  /** 'overdue_task' | 'declining_goal' */
  type: 'overdue_task' | 'declining_goal'
  /** Display title */
  title: string
  /** Human-readable detail, e.g. "3 days overdue" or "momentum: declining" */
  detail: string
}

/** A high-priority task due in the next 7 days, for the Next-Week Focus section. */
export interface WeeklyReviewNextWeekTask {
  /** UUID of the tasks row */
  taskId: string
  /** Task title */
  title: string
  /** ISO-8601 due date */
  dueAt: string
  /** 'high' | 'urgent' */
  priority: string
}

/**
 * Structured content stored in daily_briefings.content for type='weekly' rows.
 * All sections are deterministic (no LLM required). The optional `narrative`
 * field is populated only when the Haiku phrasing pass succeeds.
 */
export interface WeeklyReviewContent {
  wins: WeeklyReviewWin[]
  blockers: WeeklyReviewBlocker[]
  nextWeek: WeeklyReviewNextWeekTask[]
  /** Optional narrative paragraph from Claude Haiku. May be absent. */
  narrative?: string
}
