/**
 * GET /api/cron/followup-detection
 *
 * Nightly cron job that detects email threads where the user sent the last
 * message more than 3 days ago with no reply, and surfaces them as follow-up
 * candidates in the /email inbox view.
 *
 * Security: CRON_SECRET timingSafeEqual auth — identical pattern to nightly/route.ts.
 * Returns a structured summary; never exposes raw DB error strings in the body.
 *
 * Vercel Cron schedule: 0 6 * * * (06:00 UTC — off-peak for US user base)
 */

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { detectFollowUps } from '@/lib/email/followup'

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

  console.log(
    JSON.stringify({ event: 'cron.followup-detection.start', runAt: new Date().toISOString() }),
  )

  try {
    const result = await detectFollowUps()

    if (result.errorCount > 0) {
      console.error(
        JSON.stringify({ event: 'cron.followup-detection.errors', errorCount: result.errorCount }),
      )
    }

    const response = {
      usersProcessed: result.usersProcessed,
      candidatesDetected: result.candidatesDetected,
      candidatesCleared: result.candidatesCleared,
      errorCount: result.errorCount,
    }

    console.log(JSON.stringify({ event: 'cron.followup-detection.complete', ...response }))
    return NextResponse.json(response)
  } catch (err) {
    console.error(
      JSON.stringify({ event: 'cron.followup-detection.error', error: String(err) }),
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
