import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Pure functions — no DB dependencies, fully unit-testable
// ---------------------------------------------------------------------------

/**
 * Computes momentum from task activity in the last 7 days.
 * Score = (completed - created) / max(created, 1)
 *   > 0.2  → improving
 *   < -0.2 → declining
 *   else   → stable
 */
export function computeMomentum(
  completed: number,
  created: number
): 'improving' | 'stable' | 'declining' {
  const score = (completed - created) / Math.max(created, 1)
  if (score > 0.2) return 'improving'
  if (score < -0.2) return 'declining'
  return 'stable'
}

/**
 * Returns true if the goal is stale based on activity and creation date.
 * A goal is stale if:
 *   - lastActivityAt is set and older than thresholdDays ago, OR
 *   - lastActivityAt is null AND createdAt is older than thresholdDays ago
 * Brand-new goals (null activity but recent creation) are NOT considered stale.
 */
export function isStale(
  lastActivityAt: Date | null,
  thresholdDays: number,
  createdAt?: Date,
): boolean {
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000)
  if (lastActivityAt !== null) return lastActivityAt < cutoff
  // lastActivityAt is null — fall back to createdAt if provided
  if (createdAt !== undefined) return createdAt < cutoff
  // No fallback available — treat as not stale (safe default)
  return false
}

/**
 * Returns true if lastNudgeAt is null or older than cooldownDays days ago.
 */
export function shouldNudge(lastNudgeAt: Date | null, cooldownDays: number): boolean {
  if (lastNudgeAt === null) return true
  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000)
  return lastNudgeAt < cutoff
}

// ---------------------------------------------------------------------------
// Momentum recompute — system job (service role, no user filter)
// ---------------------------------------------------------------------------

export async function recomputeMomentum(): Promise<{
  goalsProcessed: number
  goalsUpdated: number
  errors: string[]
}> {
  const supabase = createServiceClient()
  const errors: string[] = []
  let goalsProcessed = 0
  let goalsUpdated = 0

  // Fetch all active goals across all users
  const { data: goals, error: goalsError } = await supabase
    .from('goals')
    .select('id, momentum')
    .eq('status', 'active')

  if (goalsError) {
    const msg = `Failed to fetch goals: ${goalsError.message}`
    errors.push(msg)
    console.log(JSON.stringify({ event: 'momentum.recompute.complete', goalsProcessed, goalsUpdated, errors }))
    return { goalsProcessed, goalsUpdated, errors }
  }

  if (!goals || goals.length === 0) {
    console.log(JSON.stringify({ event: 'momentum.recompute.complete', goalsProcessed: 0, goalsUpdated: 0, errors }))
    return { goalsProcessed: 0, goalsUpdated: 0, errors }
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  for (const goal of goals) {
    goalsProcessed++

    try {
      // Count completed tasks in the last 7 days linked directly via goal_id
      const { count: completedCount, error: completedError } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('goal_id', goal.id)
        .not('completed_at', 'is', null)
        .gte('completed_at', sevenDaysAgo)

      if (completedError) {
        errors.push(`Goal ${goal.id} completed count error: ${completedError.message}`)
        continue
      }

      // Count tasks created in the last 7 days linked directly via goal_id
      const { count: createdCount, error: createdError } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('goal_id', goal.id)
        .gte('created_at', sevenDaysAgo)

      if (createdError) {
        errors.push(`Goal ${goal.id} created count error: ${createdError.message}`)
        continue
      }

      const completed = completedCount ?? 0
      const created = createdCount ?? 0
      const newMomentum = computeMomentum(completed, created)

      // Update momentum; set last_activity_at if there was any task activity
      const hasActivity = completed > 0 || created > 0
      const updatePayload: {
        momentum: 'improving' | 'stable' | 'declining'
        last_activity_at?: string
      } = { momentum: newMomentum }

      if (hasActivity) {
        updatePayload.last_activity_at = now
      }

      const { error: updateError } = await supabase
        .from('goals')
        .update(updatePayload)
        .eq('id', goal.id)

      if (updateError) {
        errors.push(`Goal ${goal.id} update error: ${updateError.message}`)
        continue
      }

      goalsUpdated++
    } catch (err) {
      errors.push(`Goal ${goal.id} unexpected error: ${String(err)}`)
    }
  }

  console.log(JSON.stringify({ event: 'momentum.recompute.complete', goalsProcessed, goalsUpdated, errors }))
  return { goalsProcessed, goalsUpdated, errors }
}

// ---------------------------------------------------------------------------
// Stale-goal nudge — system job (service role, no user filter)
// ---------------------------------------------------------------------------

export async function detectAndNudgeStaleGoals(): Promise<{
  staleDetected: number
  nudgesFired: number
}> {
  const supabase = createServiceClient()
  let staleDetected = 0
  let nudgesFired = 0

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch active goals that are stale:
  // - last_activity_at is set and older than 14 days, OR
  // - last_activity_at is null AND created_at is also older than 14 days
  // This prevents brand-new goals from being immediately flagged as stale.
  const { data: staleGoals, error } = await supabase
    .from('goals')
    .select('id, last_nudge_at, created_at')
    .eq('status', 'active')
    .or(
      `last_activity_at.lt.${fourteenDaysAgo},` +
      `and(last_activity_at.is.null,created_at.lt.${fourteenDaysAgo})`,
    )

  if (error) {
    console.log(JSON.stringify({ event: 'nudge.complete', staleDetected: 0, nudgesFired: 0, error: error.message }))
    return { staleDetected: 0, nudgesFired: 0 }
  }

  if (!staleGoals || staleGoals.length === 0) {
    console.log(JSON.stringify({ event: 'nudge.complete', staleDetected: 0, nudgesFired: 0 }))
    return { staleDetected: 0, nudgesFired: 0 }
  }

  staleDetected = staleGoals.length

  for (const goal of staleGoals) {
    const lastNudge = goal.last_nudge_at ? new Date(goal.last_nudge_at) : null
    if (!shouldNudge(lastNudge, 7)) continue

    const { error: updateError } = await supabase
      .from('goals')
      .update({ last_nudge_at: new Date().toISOString() })
      .eq('id', goal.id)

    if (!updateError) {
      nudgesFired++
    }
  }

  console.log(JSON.stringify({ event: 'nudge.complete', staleDetected, nudgesFired }))
  return { staleDetected, nudgesFired }
}
