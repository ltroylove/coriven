import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { syncCalendars } from '@/lib/calendar/sync'

/**
 * GET /api/cron/calendar-sync
 *
 * Hourly cron endpoint — syncs upcoming calendar events from all connected
 * Google Calendar and Outlook Calendar integrations into calendar_events.
 *
 * Auth: Bearer <CRON_SECRET> in the Authorization header.
 *       Uses timingSafeEqual to prevent timing-based secret leakage.
 *
 * Schedule: 0 * * * * (hourly) — added to vercel.json by the orchestrator.
 *
 * Response 200: { connectionsProcessed, eventsUpserted, errorCount }
 *   — counts only; per-connection errors are logged server-side and are not
 *     included in the response body to avoid leaking internal detail.
 * Response 401: { error: 'Unauthorized' }
 * Response 500: { error: 'Internal error' }
 */

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
  // Auth check — must be first, before any DB access
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '') ?? null
  if (!verifySecret(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log(JSON.stringify({ event: 'cron.calendar-sync.start', runAt: new Date().toISOString() }))

  try {
    const result = await syncCalendars()

    // Log per-connection errors server-side; never expose raw error strings in the response body
    if (result.errors.length > 0) {
      console.error(JSON.stringify({ event: 'cron.calendar-sync.errors', errors: result.errors }))
    }

    const response = {
      connectionsProcessed: result.usersProcessed,
      eventsUpserted: result.eventsUpserted,
      errorCount: result.errorCount,
    }

    console.log(JSON.stringify({ event: 'cron.calendar-sync.complete', ...response }))
    return NextResponse.json(response)
  } catch (err) {
    console.error(JSON.stringify({ event: 'cron.calendar-sync.error', error: String(err) }))
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
