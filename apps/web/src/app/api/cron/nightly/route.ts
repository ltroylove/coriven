import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { recomputeMomentum, detectAndNudgeStaleGoals } from '@/lib/jobs/momentum'
import { createServiceClient } from '@/lib/supabase/server'

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
  // 1. Auth check — must be first, before any DB access
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '') ?? null
  if (!verifySecret(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Idempotency guard — skip if any goals were already updated today
  try {
    const supabase = createServiceClient()
    const startOfToday = new Date()
    startOfToday.setUTCHours(0, 0, 0, 0)

    const { data: recentUpdate } = await supabase
      .from('goals')
      .select('updated_at')
      .gte('updated_at', startOfToday.toISOString())
      .limit(1)

    if (recentUpdate && recentUpdate.length > 0) {
      return NextResponse.json({ skipped: true, reason: 'already ran today' })
    }
  } catch {
    // Best-effort guard — if the check fails, proceed with the job
  }

  // 3. Run jobs
  console.log(JSON.stringify({ event: 'cron.nightly.start', runAt: new Date().toISOString() }))

  try {
    const momentumResult = await recomputeMomentum()
    const nudgeResult = await detectAndNudgeStaleGoals()

    const response = {
      goalsProcessed: momentumResult.goalsProcessed,
      goalsUpdated: momentumResult.goalsUpdated,
      nudgesFired: nudgeResult.nudgesFired,
      errors: momentumResult.errors,
    }

    console.log(JSON.stringify({ event: 'cron.nightly.complete', ...response }))
    return NextResponse.json(response)
  } catch (err) {
    console.error(JSON.stringify({ event: 'cron.nightly.error', error: String(err) }))
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
