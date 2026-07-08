/**
 * GET /api/cron/weekly-review
 *
 * Friday 5pm Vercel Cron job that assembles a structured week-in-review
 * (wins, blockers, next-week focus) for every active user and stores it
 * in `daily_briefings` with type = 'weekly'.
 *
 * Security: CRON_SECRET timingSafeEqual auth — identical to other cron endpoints.
 * Per-user errors are logged and skipped; the job continues to the next user.
 *
 * Vercel Cron schedule: 0 17 * * 5 (Friday at 17:00 UTC)
 */

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { assembleWeeklyReview, storeWeeklyReview } from '@/lib/jobs/weekly-review'

function verifySecret(provided: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !provided) return false
  try {
    const a = Buffer.from(provided)
    const b = Buffer.from(secret)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  // Auth check must be first — before any DB or business logic
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '') ?? null
  if (!verifySecret(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const now = new Date()

  console.log(
    JSON.stringify({ event: 'cron.weekly-review.start', runAt: now.toISOString() }),
  )

  try {
    const db = createServiceClient()

    // Fetch all user profiles to iterate
    const { data: profiles, error: profilesError } = await db
      .from('profiles')
      .select('id')

    if (profilesError) {
      console.error(
        JSON.stringify({
          event: 'cron.weekly-review.profiles_error',
          error: profilesError.message,
        }),
      )
      return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 })
    }

    let usersProcessed = 0
    let reviewsStored = 0

    for (const profile of profiles ?? []) {
      usersProcessed++

      try {
        const content = await assembleWeeklyReview(profile.id, now)
        await storeWeeklyReview(profile.id, content, now)
        reviewsStored++

        console.log(
          JSON.stringify({
            event: 'cron.weekly-review.user_complete',
            userId: profile.id,
            wins: content.wins.length,
            blockers: content.blockers.length,
            nextWeek: content.nextWeek.length,
            hasNarrative: Boolean(content.narrative),
          }),
        )
      } catch (err) {
        // Per-user errors are logged and skipped — job continues to next user
        console.error(
          JSON.stringify({
            event: 'cron.weekly-review.user_error',
            userId: profile.id,
            error: String(err),
          }),
        )
      }
    }

    const durationMs = Date.now() - startedAt
    const summary = { usersProcessed, reviewsStored }

    console.log(
      JSON.stringify({ event: 'cron.weekly-review.complete', ...summary, durationMs }),
    )

    return NextResponse.json(summary)
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'cron.weekly-review.fatal_error', error: String(err) }),
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
