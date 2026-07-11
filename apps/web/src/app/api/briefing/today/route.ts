import { NextResponse, type NextRequest } from 'next/server'
import { createApiServerClient } from '@/lib/supabase/api-server'
import type { BriefingContent } from '@/lib/jobs/briefing'
import type { WeeklyReviewContent } from '@personal-assistant/types'
import type { Database } from '@/types/supabase'

type BriefingRow = Database['public']['Tables']['daily_briefings']['Row']

type BriefingWithTypedContent =
  | (Omit<BriefingRow, 'content'> & { content: BriefingContent; type: 'daily' })
  | (Omit<BriefingRow, 'content'> & { content: WeeklyReviewContent; type: 'weekly' })

interface BriefingResponse {
  /**
   * Legacy single-briefing field — the daily briefing for today (if any).
   * Kept for backward compatibility with the existing tray and web consumers.
   * New consumers should use `briefings` instead.
   */
  briefing: (Omit<BriefingRow, 'content'> & { content: BriefingContent }) | null
  /**
   * All undelivered briefings for the current user (daily + weekly).
   * The `type` field on each row distinguishes daily vs weekly.
   */
  briefings: BriefingWithTypedContent[]
}

export async function GET(request: NextRequest): Promise<NextResponse<BriefingResponse | { error: string }>> {
  // 1. Get authenticated user (Bearer token or cookie session)
  const supabase = await createApiServerClient(request)
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Resolve today's date in the user's local timezone
  //    briefing_date is stored in the user's local date, not UTC
  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single()

  const timezone = profile?.timezone ?? 'America/Chicago'
  // en-CA locale formats as YYYY-MM-DD natively
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())

  // 3. Query the current week's ISO week-start (Monday) for weekly reviews
  const nowUtc = new Date()
  const dayOfWeek = nowUtc.getUTCDay() // 0 = Sun, 1 = Mon, …
  const daysToMonday = (dayOfWeek + 6) % 7
  const weekStart = new Date(nowUtc)
  weekStart.setUTCDate(weekStart.getUTCDate() - daysToMonday)
  const weekStartDate = weekStart.toISOString().slice(0, 10) // YYYY-MM-DD

  // 4. Fetch today's daily briefing (backward compat)
  const { data: dailyRow, error: dailyError } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'daily')
    .eq('briefing_date', today)
    .maybeSingle()

  if (dailyError && dailyError.code !== 'PGRST116') {
    console.error(JSON.stringify({ event: 'api.briefing.today.daily_error', userId: user.id, error: dailyError.message }))
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // 5. Fetch this week's undelivered weekly review (if any)
  const { data: weeklyRow, error: weeklyError } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'weekly')
    .eq('briefing_date', weekStartDate)
    .maybeSingle()

  if (weeklyError && weeklyError.code !== 'PGRST116') {
    console.error(JSON.stringify({ event: 'api.briefing.today.weekly_error', userId: user.id, error: weeklyError.message }))
    // Non-fatal — still return the daily briefing
  }

  // 6. Handle X-Mark-Delivered for the daily briefing (backward compat)
  let resolvedDailyRow = dailyRow

  const markDelivered = request.headers.get('X-Mark-Delivered') === 'true'

  if (markDelivered && dailyRow && !dailyRow.was_delivered) {
    const { data: updated, error: updateError } = await supabase
      .from('daily_briefings')
      .update({ was_delivered: true, delivered_at: new Date().toISOString() })
      .eq('id', dailyRow.id)
      .select('*')
      .single()

    if (updateError) {
      console.error(JSON.stringify({ event: 'api.briefing.today.update_error', userId: user.id, error: updateError.message }))
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }

    resolvedDailyRow = updated
  }

  // 7. Assemble the response
  const briefings: BriefingWithTypedContent[] = []

  if (resolvedDailyRow) {
    briefings.push({
      ...resolvedDailyRow,
      type: 'daily',
      content: resolvedDailyRow.content as unknown as BriefingContent,
    })
  }

  if (weeklyRow) {
    briefings.push({
      ...weeklyRow,
      type: 'weekly',
      content: weeklyRow.content as unknown as WeeklyReviewContent,
    })
  }

  // Legacy single-briefing field (nil when today has no row but 404 is preserved via null)
  const legacyBriefing = resolvedDailyRow
    ? {
        ...resolvedDailyRow,
        content: resolvedDailyRow.content as unknown as BriefingContent,
      }
    : null

  // Return 404 when there is NO daily briefing for today (backward compat for tray)
  // and no weekly briefing either
  if (!resolvedDailyRow && !weeklyRow) {
    return NextResponse.json({ briefing: null, briefings: [] }, { status: 404 })
  }

  return NextResponse.json({
    briefing: legacyBriefing,
    briefings,
  })
}
