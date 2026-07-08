/**
 * GET /api/patterns/new
 *
 * Returns active detected patterns that have not yet been notified, or whose
 * last notification was more than NOTIFICATION_FREQUENCY_CAP_DAYS ago.
 *
 * Used by the Tauri tray poll loop to decide whether to fire a pattern notification.
 * Authenticated via Supabase SSR session cookie or Bearer token (same dual-path
 * as other tray-consumed endpoints via createApiServerClient).
 *
 * Response 200: { patterns: Array<{ id, pattern_type, description, last_detected_at }> }
 * Response 401: { error: 'Unauthorized' }
 */

import { type NextRequest, NextResponse } from 'next/server'
import { createApiServerClient } from '@/lib/supabase/api-server'

/** Frequency cap: do not re-notify the same pattern within this many days. */
export const NOTIFICATION_FREQUENCY_CAP_DAYS = 7

/** Returns a Date that is `days` days before now. */
function daysAgo(days: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

export async function GET(request: NextRequest) {
  // 1. Authenticate
  const supabase = await createApiServerClient(request)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Query active patterns within the frequency cap
  const capCutoff = daysAgo(NOTIFICATION_FREQUENCY_CAP_DAYS).toISOString()

  // A pattern qualifies for notification if:
  //   - is_active = true
  //   - last_notified_at IS NULL  OR  last_notified_at < (now - 7 days)
  // RLS enforces user isolation at the DB layer; user_id filter is a defense-in-depth.
  const { data: patterns, error: fetchError } = await supabase
    .from('detected_patterns')
    .select('id, pattern_type, description, last_detected_at')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .or(`last_notified_at.is.null,last_notified_at.lt.${capCutoff}`)
    .order('last_detected_at', { ascending: false })

  if (fetchError) {
    console.error(
      JSON.stringify({
        event: 'api.patterns.new.fetch_error',
        userId: user.id,
        error: fetchError.message,
      }),
    )
    return NextResponse.json({ error: 'Failed to fetch patterns' }, { status: 500 })
  }

  return NextResponse.json({ patterns: patterns ?? [] })
}
