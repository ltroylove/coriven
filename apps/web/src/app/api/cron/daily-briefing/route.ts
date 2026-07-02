import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assembleBriefing } from '@/lib/jobs/briefing'
import { isInBriefingWindow, getTodayInTimezone } from '@/lib/utils/timezone'
import type { Json } from '@/types/supabase'

export async function POST(request: Request) {
  // 1. Auth — CRON_SECRET Bearer check must be first, before any DB access
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  console.log(JSON.stringify({ event: 'cron.briefing.start', runAt: new Date().toISOString() }))

  const supabase = createServiceClient()

  // 2. Fetch all user profiles with timezone/briefing_time preferences
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, timezone, briefing_time')

  if (profilesError) {
    console.error(JSON.stringify({ event: 'cron.briefing.profiles_error', error: profilesError.message }))
    return NextResponse.json({ error: 'Failed to fetch profiles', details: profilesError.message }, { status: 500 })
  }

  const now = new Date()
  let usersProcessed = 0
  let briefingsGenerated = 0
  let briefingsSkipped = 0
  const errors: string[] = []

  for (const profile of profiles ?? []) {
    usersProcessed++

    const timezone = profile.timezone ?? 'America/Chicago'
    const briefingTime = profile.briefing_time ?? '07:00'

    // 3. Only generate a briefing if the user is in their briefing window
    if (!isInBriefingWindow(timezone, briefingTime, now, 30)) {
      briefingsSkipped++
      continue
    }

    // 4. Generate and upsert the briefing — skip if one already exists for today
    try {
      const briefingContent = await assembleBriefing(profile.id)
      const briefingDate = getTodayInTimezone(timezone)

      const { error: upsertError } = await supabase
        .from('daily_briefings')
        .upsert(
          {
            user_id: profile.id,
            briefing_date: briefingDate,
            content: briefingContent as unknown as Json,
            was_delivered: false,
          },
          { onConflict: 'user_id,briefing_date', ignoreDuplicates: true },
        )

      if (upsertError) {
        const msg = `User ${profile.id}: upsert failed — ${upsertError.message}`
        errors.push(msg)
        console.error(JSON.stringify({ event: 'cron.briefing.upsert_error', userId: profile.id, error: upsertError.message }))
      } else {
        briefingsGenerated++
      }
    } catch (err) {
      const msg = `User ${profile.id}: assembleBriefing threw — ${String(err)}`
      errors.push(msg)
      console.error(JSON.stringify({ event: 'cron.briefing.assembly_error', userId: profile.id, error: String(err) }))
    }
  }

  const durationMs = Date.now() - startedAt
  console.log(JSON.stringify({ event: 'cron.briefing.complete', usersProcessed, briefingsGenerated, durationMs }))

  return NextResponse.json({ usersProcessed, briefingsGenerated, briefingsSkipped, errors })
}
