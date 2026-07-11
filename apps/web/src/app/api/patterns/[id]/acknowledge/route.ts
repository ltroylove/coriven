/**
 * POST /api/patterns/[id]/acknowledge
 *
 * Sets last_notified_at = now() for the specified pattern, recording that
 * the user was notified. The frequency cap in GET /api/patterns/new uses this
 * field to suppress re-notifications within 7 days.
 *
 * RLS enforces that users can only update their own patterns. The endpoint adds
 * a user_id filter as defense-in-depth.
 *
 * Response 200: { acknowledged: true }
 * Response 401: { error: 'Unauthorized' }
 * Response 404: { error: 'Pattern not found' }
 */

import { type NextRequest, NextResponse } from 'next/server'
import { createApiServerClient } from '@/lib/supabase/api-server'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // 1. Authenticate
  const supabase = await createApiServerClient(request)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: patternId } = await context.params

  if (!patternId) {
    return NextResponse.json({ error: 'Pattern ID is required' }, { status: 400 })
  }

  // 2. Fetch pattern to determine type before updating
  const { data: existing, error: fetchError } = await supabase
    .from('detected_patterns')
    .select('id, pattern_type')
    .eq('id', patternId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Pattern not found' }, { status: 404 })
  }

  // push_notification rows are one-shot delivery vehicles — deactivate immediately on acknowledge
  // so they never resurface after the 7-day frequency cap expires.
  const isPushNotification = existing.pattern_type.startsWith('push_notification_')
  const now = new Date().toISOString()

  const { data, error: updateError } = await supabase
    .from('detected_patterns')
    .update({
      last_notified_at: now,
      updated_at: now,
      ...(isPushNotification ? { is_active: false } : {}),
    })
    .eq('id', patternId)
    .eq('user_id', user.id)
    .select('id')
    .single()

  if (updateError || !data) {
    return NextResponse.json({ error: 'Pattern not found' }, { status: 404 })
  }

  console.log(
    JSON.stringify({
      event: 'api.patterns.acknowledge',
      userId: user.id,
      patternId,
    }),
  )

  return NextResponse.json({ acknowledged: true })
}
