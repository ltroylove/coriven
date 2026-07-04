import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { BriefingSection } from '@/components/briefing/briefing-section'
import type { BriefingContent } from '@/lib/jobs/briefing'

export default async function TodayPage() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/today')

  // 9b — resolve today's date in the user's local timezone
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single()

  const timezone = profile?.timezone ?? 'America/Chicago'
  // en-CA locale formats as YYYY-MM-DD natively
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())

  // 9a — handle fetch error explicitly; PGRST116 = no row found (not a real error)
  const { data: briefing, error: briefingError } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('user_id', user.id)
    .eq('briefing_date', today)
    .maybeSingle()

  if (briefingError && briefingError.code !== 'PGRST116') {
    console.error('[today] briefing fetch failed', briefingError)
    return <div>Couldn&apos;t load your briefing. Try refreshing.</div>
  }

  // No briefing for today — empty state
  if (!briefing) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Today</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your daily briefing</p>
        </div>
        <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center max-w-md">
          {/* 9c — removed hardcoded "tomorrow at 7am" assumption */}
          <p className="text-sm text-gray-400">
            Your daily briefing hasn&apos;t arrived yet. Check back after your configured briefing time, or ask Coriven anything in{' '}
            <Link href="/chat" className="text-blue-500 hover:text-blue-400 transition-colors">
              Chat
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  const content = briefing.content as unknown as BriefingContent

  // Build section items
  const goalsInMotionItems = content.goalsInMotion.map((goal) => (
    <Link
      key={goal.goalId}
      href={`/goals/${goal.goalId}`}
      className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2 hover:border-gray-700 transition-colors group"
    >
      <span className="text-sm text-gray-200 group-hover:text-white transition-colors">
        {goal.title}
      </span>
      <span className="text-xs text-gray-600 ml-4 shrink-0">
        {goal.momentum}
      </span>
    </Link>
  ))

  const upcomingItems = content.upcoming.map((task) => {
    const due = new Date(task.dueAt)
    const formatted = due.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    return (
      <div
        key={task.taskId}
        className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2"
      >
        <span className="text-sm text-gray-200">{task.title}</span>
        <span className="text-xs text-gray-500 ml-4 shrink-0">{formatted}</span>
      </div>
    )
  })

  const stalledItems = content.stalled.map((goal) => (
    <div
      key={goal.goalId}
      className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2"
    >
      <span className="text-sm text-gray-200">{goal.title}</span>
      <span className="text-xs text-gray-500 ml-4 shrink-0">
        {goal.daysSinceActivity}d ago
      </span>
    </div>
  ))

  const approvalsItems: React.ReactNode[] =
    content.approvalsPending > 0
      ? [
          <div
            key="approvals"
            className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2"
          >
            <span className="text-sm text-gray-200">
              {content.approvalsPending} pending{' '}
              {content.approvalsPending === 1 ? 'approval' : 'approvals'}
            </span>
            <span className="text-xs text-gray-500">→ Review</span>
          </div>,
        ]
      : []

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Today</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your daily briefing</p>
      </div>

      <div className="space-y-8 max-w-xl">
        <BriefingSection
          title="Goals in Motion"
          items={goalsInMotionItems}
          emptyMessage="No active goals with positive momentum right now."
        />

        <BriefingSection
          title="Upcoming — Next 7 Days"
          items={upcomingItems}
          emptyMessage="No tasks due in the next 7 days."
        />

        <BriefingSection
          title="Stalled — Needs Attention"
          items={stalledItems}
          emptyMessage="Nothing stalled. Keep it up."
        />

        <BriefingSection
          title="Approvals Pending"
          items={approvalsItems}
          emptyMessage="No approvals pending."
        />
      </div>
    </div>
  )
}
