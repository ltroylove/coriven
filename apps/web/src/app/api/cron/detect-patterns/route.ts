/**
 * POST /api/cron/detect-patterns
 *
 * Nightly cron job that analyzes each user's task-completion history for
 * behavioral patterns and writes results to `detected_patterns`.
 *
 * Security: CRON_SECRET timingSafeEqual auth — identical to other cron endpoints.
 * Returns a structured summary; never exposes raw DB error strings in the body.
 *
 * Vercel Cron schedule: 0 3 * * * (03:00 UTC nightly)
 */

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { runPatternDetection } from '@/lib/jobs/detect-patterns'

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

export async function POST(request: Request) {
  // Auth check must be first — before any DB or business logic
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '') ?? null
  if (!verifySecret(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  console.log(
    JSON.stringify({ event: 'cron.detect-patterns.start', runAt: new Date().toISOString() }),
  )

  try {
    const db = createServiceClient()

    // Fetch all user profiles to iterate
    const { data: profiles, error: profilesError } = await db
      .from('profiles')
      .select('id')

    if (profilesError) {
      console.error(
        JSON.stringify({ event: 'cron.detect-patterns.profiles_error', error: profilesError.message }),
      )
      return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 })
    }

    let usersProcessed = 0
    let totalPatternsWritten = 0
    let totalPatternsDeactivated = 0

    for (const profile of profiles ?? []) {
      usersProcessed++

      try {
        const result = await runPatternDetection(profile.id)
        totalPatternsWritten += result.patternsWritten
        totalPatternsDeactivated += result.patternsDeactivated

        console.log(
          JSON.stringify({
            event: 'cron.detect-patterns.user_complete',
            userId: profile.id,
            patternsWritten: result.patternsWritten,
            patternsDeactivated: result.patternsDeactivated,
          }),
        )
      } catch (err) {
        // Per-user errors are logged and skipped — job continues to next user
        console.error(
          JSON.stringify({
            event: 'cron.detect-patterns.user_error',
            userId: profile.id,
            error: String(err),
          }),
        )
      }
    }

    const durationMs = Date.now() - startedAt
    const summary = {
      usersProcessed,
      patternsWritten: totalPatternsWritten,
      patternsDeactivated: totalPatternsDeactivated,
    }

    console.log(
      JSON.stringify({ event: 'cron.detect-patterns.complete', ...summary, durationMs }),
    )

    return NextResponse.json(summary)
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'cron.detect-patterns.fatal_error', error: String(err) }),
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
