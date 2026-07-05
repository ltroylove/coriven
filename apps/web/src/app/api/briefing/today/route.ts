import { NextResponse, type NextRequest } from 'next/server'
import { createApiServerClient } from '@/lib/supabase/api-server'
import type { BriefingContent } from '@/lib/jobs/briefing'
import type { Database } from '@/types/supabase'

type BriefingRow = Database['public']['Tables']['daily_briefings']['Row']

interface BriefingResponse {
  briefing: (Omit<BriefingRow, 'content'> & { content: BriefingContent }) | null
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

  // 3. Query daily_briefings for today
  const { data: row, error: fetchError } = await supabase
    .from('daily_briefings')
    .select('*')
    .eq('user_id', user.id)
    .eq('briefing_date', today)
    .single()

  if (fetchError) {
    if (fetchError.code === 'PGRST116') {
      // No row found
      return NextResponse.json({ briefing: null }, { status: 404 })
    }
    console.error(JSON.stringify({ event: 'api.briefing.today.fetch_error', userId: user.id, error: fetchError.message }))
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // 5. If X-Mark-Delivered header is 'true' AND row is not yet delivered, mark it
  const markDelivered = request.headers.get('X-Mark-Delivered') === 'true'

  if (markDelivered && !row.was_delivered) {
    const { data: updated, error: updateError } = await supabase
      .from('daily_briefings')
      .update({ was_delivered: true, delivered_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*')
      .single()

    if (updateError) {
      console.error(JSON.stringify({ event: 'api.briefing.today.update_error', userId: user.id, error: updateError.message }))
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }

    return NextResponse.json({
      briefing: {
        ...updated,
        content: updated.content as unknown as BriefingContent,
      },
    })
  }

  // 6. Return the row as-is
  return NextResponse.json({
    briefing: {
      ...row,
      content: row.content as unknown as BriefingContent,
    },
  })
}
