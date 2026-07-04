import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { generateDueBriefs } from '@/lib/jobs/meeting-prep'

// ---------------------------------------------------------------------------
// Auth helper — timing-safe CRON_SECRET comparison (copy of briefing pattern)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GET /api/cron/meeting-prep
//
// Vercel Cron schedule (set in vercel.json by the orchestrator): */5 * * * *
// (every 5 minutes). Finds timed calendar events starting within the next
// ~15 minutes that do not yet have a brief, assembles + persists one per
// event. Response body contains counts only — no per-event detail.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // 1. Auth — CRON_SECRET Bearer check must be first, before any DB access.
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '') ?? null
  if (!verifySecret(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  console.log(JSON.stringify({ event: 'cron.meetingPrep.start', runAt: new Date().toISOString() }))

  try {
    const result = await generateDueBriefs()

    const durationMs = Date.now() - startedAt
    console.log(JSON.stringify({
      event: 'cron.meetingPrep.complete',
      ...result,
      durationMs,
    }))

    return NextResponse.json({
      eventsConsidered: result.eventsConsidered,
      briefsCreated: result.briefsCreated,
      errorCount: result.errorCount,
    })
  } catch (err) {
    console.error(JSON.stringify({
      event: 'cron.meetingPrep.unhandledError',
      error: String(err),
    }))
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
