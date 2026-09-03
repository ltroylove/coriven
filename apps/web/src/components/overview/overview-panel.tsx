import Link from 'next/link'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { BriefingSection } from '@/components/briefing/briefing-section'
import { WeeklyReviewSection } from '@/components/briefing/weekly-review-section'
import { formatInTimezone } from '@/lib/utils/timezone'
import type { BriefingContent } from '@/lib/jobs/briefing'
import type { MeetingBriefContent } from '@/lib/jobs/meeting-prep'
import type { WeeklyReviewContent } from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// MeetingPrepSection
// Renders upcoming meeting briefs (next 2 hours) as plain text.
// Omitted entirely when no briefs exist.
// ---------------------------------------------------------------------------

interface MeetingBriefRow {
  id: string
  event_title: string | null
  event_start: string
  content: unknown
}

function MeetingPrepSection({ briefs, timezone }: { briefs: MeetingBriefRow[]; timezone: string }) {
  if (briefs.length === 0) return null

  return (
    <section className="max-w-xl">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
        Meeting Prep — Next 2 Hours
      </h2>
      <ul className="space-y-4">
        {briefs.map((brief) => {
          const briefContent = brief.content as MeetingBriefContent
          const startTime = formatInTimezone(brief.event_start, timezone, {
            hour: 'numeric',
            minute: '2-digit',
          })

          return (
            <li
              key={brief.id}
              className="rounded-lg border border-gray-800 px-4 py-3 space-y-3"
            >
              {/* Event header */}
              <div className="flex items-start justify-between gap-4">
                <span className="text-sm font-medium text-gray-100">
                  {brief.event_title ?? 'Untitled event'}
                </span>
                <span className="text-xs text-gray-500 shrink-0">{startTime}</span>
              </div>

              {/* Attendees */}
              {briefContent.attendees.length > 0 && (
                <div>
                  <p className="text-xs text-gray-600 mb-1">Attendees</p>
                  <p className="text-xs text-gray-400">
                    {briefContent.attendees
                      .map(a => a.name ? `${a.name} (${a.email})` : a.email)
                      .join(', ')}
                  </p>
                </div>
              )}

              {/* Related emails count + first subject */}
              <div>
                <p className="text-xs text-gray-600 mb-1">
                  Related emails: {briefContent.relatedEmails.length}
                </p>
                {briefContent.relatedEmails[0] && (
                  <p className="text-xs text-gray-400 truncate">
                    {briefContent.relatedEmails[0].subject ?? '(no subject)'}
                  </p>
                )}
              </div>

              {/* Open tasks count + first title */}
              <div>
                <p className="text-xs text-gray-600 mb-1">
                  Open tasks: {briefContent.openTasks.length}
                </p>
                {briefContent.openTasks[0] && (
                  <p className="text-xs text-gray-400 truncate">
                    {briefContent.openTasks[0].title}
                  </p>
                )}
              </div>

              {/* Memories count */}
              {briefContent.memories.length > 0 && (
                <div>
                  <p className="text-xs text-gray-600 mb-1">
                    Memories: {briefContent.memories.length}
                  </p>
                  <p className="text-xs text-gray-400 line-clamp-2">
                    {briefContent.memories[0].content}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// OverviewPanel — server component; renders today's briefing + meeting prep.
// Extracted from (app)/today/page.tsx so that / can render it as the interim
// panel home. Will be replaced by the board in Wave 9.2.3.
// ---------------------------------------------------------------------------
export async function OverviewPanel() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return <div className="text-sm text-gray-500 p-6">Not authenticated.</div>
  }

  // Resolve today's date in the user's local timezone
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single()

  const timezone = profile?.timezone ?? 'America/Chicago'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())

  const { data: briefing, error: briefingError } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'daily')
    .eq('briefing_date', today)
    .maybeSingle()

  // Weekly review — current ISO week
  const nowUtc = new Date()
  const dayOfWeek = nowUtc.getUTCDay()
  const daysToMonday = (dayOfWeek + 6) % 7
  const weekStartUtc = new Date(nowUtc)
  weekStartUtc.setUTCDate(weekStartUtc.getUTCDate() - daysToMonday)
  const weekStartDate = weekStartUtc.toISOString().slice(0, 10)

  const { data: weeklyBriefing } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'weekly')
    .eq('briefing_date', weekStartDate)
    .maybeSingle()

  // Meeting prep — briefs for events starting in the next 2 hours
  const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const { data: meetingBriefs } = await supabase
    .from('meeting_briefs')
    .select('id, event_title, event_start, content')
    .eq('user_id', user.id)
    .gte('event_start', new Date().toISOString())
    .lte('event_start', twoHoursFromNow.toISOString())
    .order('event_start', { ascending: true })

  if (briefingError && briefingError.code !== 'PGRST116') {
    console.error('[overview] briefing fetch failed', briefingError)
    return <div className="p-6">Couldn&apos;t load your briefing. Try refreshing.</div>
  }

  const weeklyReviewContent = weeklyBriefing
    ? (weeklyBriefing.content as unknown as WeeklyReviewContent)
    : null

  if (!briefing) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Today</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your daily briefing</p>
        </div>
        <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center max-w-md mb-8">
          <p className="text-sm text-gray-400">
            Your daily briefing hasn&apos;t arrived yet. Check back after your configured briefing time, or ask Coriven anything in{' '}
            <Link href="/" className="text-blue-500 hover:text-blue-400 transition-colors">
              Chat
            </Link>
            .
          </p>
        </div>
        {weeklyReviewContent && weeklyBriefing && (
          <div className="mt-8">
            <WeeklyReviewSection
              wins={weeklyReviewContent.wins}
              blockers={weeklyReviewContent.blockers}
              nextWeek={weeklyReviewContent.nextWeek}
              narrative={weeklyReviewContent.narrative}
              generatedAt={weeklyBriefing.created_at}
            />
          </div>
        )}
        <MeetingPrepSection briefs={meetingBriefs ?? []} timezone={timezone} />
      </div>
    )
  }

  const content = briefing.content as unknown as BriefingContent

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
    const formatted = formatInTimezone(task.dueAt, timezone, {
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
            <Link href="/activity" className="text-xs text-blue-500 hover:text-blue-400 transition-colors">
              Review
            </Link>
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

      {weeklyReviewContent && weeklyBriefing && (
        <div className="mt-8">
          <WeeklyReviewSection
            wins={weeklyReviewContent.wins}
            blockers={weeklyReviewContent.blockers}
            nextWeek={weeklyReviewContent.nextWeek}
            narrative={weeklyReviewContent.narrative}
            generatedAt={weeklyBriefing.created_at}
          />
        </div>
      )}

      {(meetingBriefs ?? []).length > 0 && (
        <div className="mt-8">
          <MeetingPrepSection briefs={meetingBriefs ?? []} timezone={timezone} />
        </div>
      )}
    </div>
  )
}
