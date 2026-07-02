import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BriefingContent {
  goalsInMotion: Array<{ goalId: string; title: string; momentum: string; linkedTaskCount: number }>
  upcoming: Array<{ taskId: string; title: string; dueAt: string }>
  stalled: Array<{ goalId: string; title: string; daysSinceActivity: number }>
  approvalsPending: number
}

// ---------------------------------------------------------------------------
// assembleBriefing
// Deterministically builds a briefing payload for a single user.
// Uses service role — intended for cron/server context only.
// No Anthropic API calls.
// ---------------------------------------------------------------------------

export async function assembleBriefing(userId: string): Promise<BriefingContent> {
  const supabase = createServiceClient()

  // -------------------------------------------------------------------------
  // 1. Goals in motion — active goals with positive or neutral momentum
  //    Task count is fetched per goal (not via projects(count)) so that
  //    linkedTaskCount reflects actual open tasks, not project count.
  // -------------------------------------------------------------------------
  const { data: motionGoals, error: motionError } = await supabase
    .from('goals')
    .select('id, title, momentum')
    .eq('user_id', userId)
    .eq('status', 'active')
    .in('momentum', ['improving', 'stable'])
    .limit(10)

  if (motionError) {
    console.error(JSON.stringify({ event: 'briefing.goalsInMotion.error', userId, error: motionError.message }))
  }

  const goalsInMotion = await Promise.all((motionGoals ?? []).map(async (g) => {
    const { count } = await supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('goal_id', g.id)
      .neq('status', 'done')
      .neq('status', 'cancelled')
    return {
      goalId: g.id,
      title: g.title,
      momentum: g.momentum ?? 'stable',
      linkedTaskCount: count ?? 0,
    }
  }))

  // -------------------------------------------------------------------------
  // 2. Upcoming tasks — due in the next 7 days, not completed
  // -------------------------------------------------------------------------
  const now = new Date()
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const { data: upcomingTasks, error: upcomingError } = await supabase
    .from('tasks')
    .select('id, title, due_at')
    .eq('user_id', userId)
    .not('due_at', 'is', null)
    .gte('due_at', now.toISOString())
    .lte('due_at', sevenDaysFromNow.toISOString())
    .not('status', 'in', '("done","cancelled")')
    .order('due_at', { ascending: true })
    .limit(10)

  if (upcomingError) {
    console.error(JSON.stringify({ event: 'briefing.upcoming.error', userId, error: upcomingError.message }))
  }

  const upcoming = (upcomingTasks ?? []).map(t => ({
    taskId: t.id,
    title: t.title,
    dueAt: t.due_at!,
  }))

  // -------------------------------------------------------------------------
  // 3. Stalled goals — recently nudged (within last 7 days)
  // A goal that received a nudge recently is stale by definition.
  // -------------------------------------------------------------------------
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const { data: stalledGoals, error: stalledError } = await supabase
    .from('goals')
    .select('id, title, last_activity_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .not('last_nudge_at', 'is', null)
    .gte('last_nudge_at', sevenDaysAgo.toISOString())
    .limit(5)

  if (stalledError) {
    console.error(JSON.stringify({ event: 'briefing.stalled.error', userId, error: stalledError.message }))
  }

  const stalled = (stalledGoals ?? []).map(g => {
    const lastActivity = g.last_activity_at ? new Date(g.last_activity_at) : null
    const daysSinceActivity = lastActivity
      ? Math.floor((now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000))
      : 0
    return {
      goalId: g.id,
      title: g.title,
      daysSinceActivity,
    }
  })

  // -------------------------------------------------------------------------
  // 4. Approvals pending — graceful if table doesn't exist
  // -------------------------------------------------------------------------
  let approvalsPending = 0
  try {
    const { count, error: approvalsError } = await supabase
      .from('approval_queue' as never)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending')

    if (!approvalsError) {
      approvalsPending = count ?? 0
    }
  } catch {
    // Table doesn't exist yet — return 0
    approvalsPending = 0
  }

  return {
    goalsInMotion,
    upcoming,
    stalled,
    approvalsPending,
  }
}
