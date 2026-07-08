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
  // 3. Stalled goals — from two sources, deduplicated by goal title:
  //    a) Active stale_goal patterns in detected_patterns (Wave 7.2.1)
  //       These carry the goal title and exact inactivity day count in the
  //       description field ("No activity on 'Read 12 books' for 18 days").
  //    b) Goals that received a recent nudge (legacy last_nudge_at column,
  //       Epic 4 momentum model).
  //
  // Both channels may surface the same goal. Deduplication is by goal title.
  // The detected_patterns source is authoritative for the day count when both
  // sources agree on the goal. The briefing and the tray nudge are independent
  // channels — both may appear on the same day (per wave plan §Story 7.2.1.3).
  // -------------------------------------------------------------------------

  // 3a. Active stale_goal patterns from detected_patterns
  const { data: stalePatterns, error: stalePatternsError } = await supabase
    .from('detected_patterns')
    .select('id, goal_id, description')
    .eq('user_id', userId)
    .eq('pattern_type', 'stale_goal')
    .eq('is_active', true)
    .limit(10)

  if (stalePatternsError) {
    console.error(JSON.stringify({ event: 'briefing.stalePatterns.error', userId, error: stalePatternsError.message }))
  }

  // Parse day count from description ("No activity on 'X' for N days")
  const DAY_COUNT_RE = /for (\d+) days?$/i

  const stalledFromPatterns: Array<{ goalId: string; title: string; daysSinceActivity: number }> = []
  for (const p of stalePatterns ?? []) {
    if (!p.goal_id) continue
    const match = DAY_COUNT_RE.exec(p.description ?? '')
    const daysSinceActivity = match ? parseInt(match[1], 10) : 0
    // Extract title from description: "No activity on 'TITLE' for N days"
    const titleMatch = /No activity on '(.+)' for/i.exec(p.description ?? '')
    const title = titleMatch ? titleMatch[1] : p.goal_id
    stalledFromPatterns.push({ goalId: p.goal_id as string, title, daysSinceActivity })
  }

  // 3b. Goals with recent nudge via last_nudge_at (legacy momentum model)
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

  const stalledFromNudge = (stalledGoals ?? []).map(g => {
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

  // 3c. Deduplicate by title (patterns source takes priority for day count)
  const seenTitles = new Set<string>()
  const stalled: Array<{ goalId: string; title: string; daysSinceActivity: number }> = []

  // patterns source first (authoritative for day count)
  for (const s of stalledFromPatterns) {
    if (!seenTitles.has(s.title)) {
      seenTitles.add(s.title)
      stalled.push(s)
    }
  }

  // nudge-model source second (skipped if already added by patterns)
  for (const s of stalledFromNudge) {
    if (!seenTitles.has(s.title)) {
      seenTitles.add(s.title)
      stalled.push(s)
    }
  }

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
